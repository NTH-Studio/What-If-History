import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Character,
  GameEvent,
  ImpactKind,
  ImpactZone,
  IntelContact,
  MovementOrder,
  MovementOrderInput,
  MovementOrderPreview,
  RegionState,
  StrategicState,
  StrategicEventEffect,
  StrategicUnit,
  TimelineEntry,
  War,
  Front,
  GeneratedCharacterChange,
} from '@what-if-history/contracts';
import {
  addTime,
  applyRegionalImpact,
  distributeRegionalPopulation,
  estimateMovementDuration,
  evolveRegionalRecovery,
  findStrategicRoute,
  resolveStrategicCombat,
} from '@what-if-history/core';
import type { Catalog } from '../catalog.js';
import { HistoricalWorldResolver } from '../historical-world.js';
import { AppError, notFound } from '../errors.js';
import { nullableText, number, parseJson, text, type Row } from './values.js';
const normalizeRegion = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{Letter}\p{Number} ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function terrainFrom(value: unknown, regionType: string): RegionState['terrain'] {
  if (regionType === 'ocean' || regionType === 'strait') return 'ocean';
  if (regionType === 'coastal') return 'coastal';
  const normalized = text(value).toLowerCase();
  if (normalized.includes('mount')) return 'mountain';
  if (normalized.includes('forest') || normalized.includes('jungle')) return 'forest';
  if (normalized.includes('desert')) return 'desert';
  if (normalized.includes('urban') || normalized.includes('city')) return 'urban';
  if (normalized.includes('coast')) return 'coastal';
  return 'plains';
}

function domainFor(unitType: string): StrategicUnit['domain'] {
  if (unitType === 'naval' || unitType === 'submarine') return 'naval';
  if (unitType === 'air') return 'air';
  return 'land';
}

function iconKeyForRole(role: string): Character['iconKey'] {
  const normalized = role
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (/general|command|militaire|marshal|marechal|admiral|amiral/.test(normalized)) {
    return 'commander';
  }
  if (/diplomat|ambassad|envoy|ministre|foreign|affaires etrangeres/.test(normalized)) {
    return 'diplomat';
  }
  if (/agent|espion|intelligence|operative|renseignement/.test(normalized)) {
    return 'operative';
  }
  if (/scient|chercheur|ingenieur|physic|medecin/.test(normalized)) {
    return 'scientist';
  }
  if (
    /leader|dirigeant|president|chancel|premier ministre|roi|reine|empereur|chef/.test(normalized)
  ) {
    return 'leader';
  }
  return 'civilian';
}

function daysBetween(from: string, to: string) {
  return Math.max(
    0,
    Math.round(
      (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
        86_400_000,
    ),
  );
}

function svgPathPoints(path: string) {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
  const arity: Record<string, number> = {
    M: 2,
    L: 2,
    H: 1,
    V: 1,
    C: 6,
    S: 4,
    Q: 4,
    T: 2,
    A: 7,
  };
  const points: Array<[number, number]> = [];
  let command = '';
  let index = 0;
  let current: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  let firstMove = true;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (/^[a-zA-Z]$/.test(token)) {
      command = token;
      index += 1;
      if (command.toUpperCase() === 'Z') {
        current = [...start];
        points.push([...current]);
      }
      firstMove = command.toUpperCase() === 'M';
      continue;
    }
    const upper = command.toUpperCase();
    const size = arity[upper];
    if (!size || index + size > tokens.length) {
      index += 1;
      continue;
    }
    const values = tokens.slice(index, index + size).map(Number);
    index += size;
    const relative = command === command.toLowerCase();
    let next: [number, number];
    if (upper === 'H') next = [relative ? current[0] + values[0]! : values[0]!, current[1]];
    else if (upper === 'V') next = [current[0], relative ? current[1] + values[0]! : values[0]!];
    else {
      const x = values[size - 2]!;
      const y = values[size - 1]!;
      next = [relative ? current[0] + x : x, relative ? current[1] + y : y];
    }
    current = next;
    points.push([...current]);
    if (firstMove) {
      start = [...current];
      firstMove = false;
    }
  }
  return points;
}

function deriveMapAdjacency(regions: Array<{ id: string; path: string }>) {
  const buckets = new Map<string, Set<string>>();
  for (const region of regions) {
    for (const [x, y] of svgPathPoints(region.path)) {
      const key = `${Math.round(x * 10)}:${Math.round(y * 10)}`;
      const members = buckets.get(key) ?? new Set<string>();
      members.add(region.id);
      buckets.set(key, members);
    }
  }
  const sharedPoints = new Map<string, number>();
  for (const members of buckets.values()) {
    const ids = [...members].sort();
    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        const key = `${ids[left]}\u0000${ids[right]}`;
        sharedPoints.set(key, (sharedPoints.get(key) ?? 0) + 1);
      }
    }
  }
  const adjacency = new Map(regions.map((region) => [region.id, new Set<string>()]));
  for (const [pair, count] of sharedPoints) {
    if (count < 2) continue;
    const [left, right] = pair.split('\u0000');
    if (!left || !right) continue;
    adjacency.get(left)?.add(right);
    adjacency.get(right)?.add(left);
  }
  return adjacency;
}

export class StrategicRepository {
  private readonly derivedAdjacency: Map<string, Set<string>>;

  constructor(
    readonly database: DatabaseSync,
    private readonly catalog: Catalog,
    private readonly historical = new HistoricalWorldResolver(catalog, catalog.dataDirectory),
  ) {
    this.derivedAdjacency = deriveMapAdjacency(this.catalog.regions.regions);
    const games = this.database.prepare('SELECT id FROM games').all() as Row[];
    for (const game of games) this.ensureGame(text(game.id));
  }

  ensureGame(gameId: string) {
    const game = this.database
      .prepare('SELECT id, games.current_date AS game_date FROM games WHERE id = ?')
      .get(gameId) as Row | undefined;
    if (!game) throw notFound('Game');
    const hasRegions = this.database
      .prepare('SELECT 1 FROM region_states WHERE game_id = ? LIMIT 1')
      .get(gameId);
    if (!hasRegions) this.initializeRegions(gameId);
    this.ensureRegionNeighbors(gameId);
    this.ensureExactPopulationTotals(gameId);
    this.initializeCharacters(gameId);
    this.initializeArsenals(gameId, text(game.game_date));
    this.normalizeUnitDomains(gameId);
  }

  private ensureExactPopulationTotals(gameId: string) {
    const nations = this.database
      .prepare('SELECT nation_code, population FROM nation_states WHERE game_id = ?')
      .all(gameId) as Row[];
    const regionalTotal = this.database.prepare(
      'SELECT COALESCE(SUM(population), 0) AS population FROM region_states WHERE game_id = ? AND nation_code = ?',
    );
    const largestRegion = this.database.prepare(
      `SELECT region_id, population FROM region_states
       WHERE game_id = ? AND nation_code = ? ORDER BY population DESC, region_id LIMIT 1`,
    );
    const update = this.database.prepare(
      'UPDATE region_states SET population = ?, updated_at = ? WHERE game_id = ? AND region_id = ?',
    );
    const timestamp = new Date().toISOString();
    for (const nation of nations) {
      const nationCode = text(nation.nation_code);
      const expected = number(nation.population);
      const actual = number((regionalTotal.get(gameId, nationCode) as Row).population);
      const delta = expected - actual;
      if (Math.abs(delta) < 1e-9) continue;
      const region = largestRegion.get(gameId, nationCode) as Row | undefined;
      if (!region) continue;
      update.run(number(region.population) + delta, timestamp, gameId, text(region.region_id));
    }
  }

  private ensureRegionNeighbors(gameId: string) {
    const emptyRows = this.database
      .prepare("SELECT region_id FROM region_states WHERE game_id = ? AND neighbors_json = '[]'")
      .all(gameId) as Row[];
    if (!emptyRows.length) return;
    const known = new Set(
      (
        this.database
          .prepare('SELECT region_id FROM region_states WHERE game_id = ?')
          .all(gameId) as Row[]
      ).map((row) => text(row.region_id)),
    );
    const update = this.database.prepare(
      "UPDATE region_states SET neighbors_json = ? WHERE game_id = ? AND region_id = ? AND neighbors_json = '[]'",
    );
    for (const row of emptyRows) {
      const regionId = text(row.region_id);
      const neighbors = [...(this.derivedAdjacency.get(regionId) ?? [])].filter((neighbor) =>
        known.has(neighbor),
      );
      if (neighbors.length) update.run(JSON.stringify(neighbors.sort()), gameId, regionId);
    }
  }

  private initializeRegions(gameId: string) {
    const timestamp = new Date().toISOString();
    const regionRows = this.database
      .prepare('SELECT * FROM game_regions WHERE game_id = ? ORDER BY region_id')
      .all(gameId) as Row[];
    const nationRows = this.database
      .prepare(
        `SELECT nation_code, population, industrial_capacity, health
         FROM nation_states WHERE game_id = ?`,
      )
      .all(gameId) as Row[];
    const metadata = (this.catalog.regionMetadata ?? {}) as Record<
      string,
      { terrain?: string; neighbors?: string[] }
    >;
    const actualIdByNormalized = new Map(
      regionRows.map((row) => [normalizeRegion(text(row.region_id)), text(row.region_id)]),
    );
    const metadataByNormalized = new Map(
      Object.entries(metadata).map(([id, entry]) => [normalizeRegion(id), entry]),
    );
    const cityWeights = new Map<string, number>();
    for (const city of this.catalog.cities) {
      const weight = city.type === 'capital' ? 8 : city.type === 'major_city' ? 4 : 2;
      cityWeights.set(city.region_id, (cityWeights.get(city.region_id) ?? 1) + weight);
    }
    const derivedNeighbors = this.derivedAdjacency;
    const seeds = regionRows.map((row) => {
      const regionId = text(row.region_id);
      const entry = metadataByNormalized.get(normalizeRegion(regionId));
      const neighbors = (entry?.neighbors ?? [...(derivedNeighbors.get(regionId) ?? [])])
        .map((neighbor) => actualIdByNormalized.get(normalizeRegion(neighbor)))
        .filter((neighbor): neighbor is string => Boolean(neighbor));
      return {
        regionId,
        nationCode: nullableText(row.owner_nation_code),
        terrain: terrainFrom(entry?.terrain, text(row.region_type)),
        neighbors,
        cityWeight: cityWeights.get(regionId) ?? 1,
      };
    });
    const distributed = distributeRegionalPopulation(
      gameId,
      nationRows.map((row) => ({
        nationCode: text(row.nation_code),
        population: number(row.population),
        industrialCapacity: number(row.industrial_capacity),
        health: number(row.health),
      })),
      seeds,
      timestamp,
    );
    const insert = this.database.prepare(
      `INSERT INTO region_states (
        game_id, region_id, nation_code, population, displaced_population, wounded_population,
        infrastructure, industrial_capacity, supply, health, habitability, contamination,
        radiation, terrain, neighbors_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const region of distributed) {
      insert.run(
        region.gameId,
        region.regionId,
        region.nationCode,
        region.population,
        region.displacedPopulation,
        region.woundedPopulation,
        region.infrastructure,
        region.industrialCapacity,
        region.supply,
        region.health,
        region.habitability,
        region.contamination,
        region.radiation,
        region.terrain,
        JSON.stringify(region.neighbors),
        region.updatedAt,
      );
    }
  }

  private initializeCharacters(gameId: string) {
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO characters (
        id, game_id, name, role, nation_code, loyalty_nation_code, status, region_id,
        coords_x, coords_y, portrait_status, history_json, created_at, updated_at,
        office_holder_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 'fallback', '[]', ?, ?, ?)`,
    );
    const timestamp = new Date().toISOString();
    const offices = this.database
      .prepare(
        `SELECT goh.*, gp.capital_region_id, mf.coords_x, mf.coords_y
         FROM game_office_holders goh
         JOIN game_polities gp ON gp.game_id = goh.game_id AND gp.nation_code = goh.nation_code
         LEFT JOIN map_features mf ON mf.game_id = goh.game_id
           AND mf.region_id = gp.capital_region_id AND mf.feature_type = 'capital'
         WHERE goh.game_id = ?
         GROUP BY goh.office_key
         ORDER BY goh.is_primary DESC, goh.nation_code, goh.role`,
      )
      .all(gameId) as Row[];
    if (offices.length) {
      for (const office of offices) {
        insert.run(
          randomUUID(),
          gameId,
          text(office.holder_name),
          text(office.title_fr),
          text(office.nation_code),
          text(office.nation_code),
          nullableText(office.capital_region_id),
          office.coords_x === null ? null : number(office.coords_x),
          office.coords_y === null ? null : number(office.coords_y),
          timestamp,
          timestamp,
          text(office.holder_id),
        );
      }
      return;
    }
    for (const nation of this.catalog.nations.values()) {
      if (!nation.leader_name || nation.leader_name === 'Unknown') continue;
      const capital = this.catalog.cities.find(
        (city) => city.nation_code === nation.code && city.type === 'capital',
      );
      const fallback = this.catalog.cities.find((city) => city.nation_code === nation.code);
      const position = capital ?? fallback;
      insert.run(
        randomUUID(),
        gameId,
        nation.leader_name,
        nation.leader_title ?? 'Leader',
        nation.code,
        nation.code,
        position?.region_id ?? null,
        position?.coords[0] ?? null,
        position?.coords[1] ?? null,
        timestamp,
        timestamp,
        null,
      );
    }
  }

  private initializeArsenals(gameId: string, currentDate: string) {
    const year = Number(currentDate.slice(0, 4));
    const nuclearPowers =
      year >= 1998
        ? ['USA', 'RUS', 'ENG', 'FRA', 'PRC', 'RAJ', 'PAK']
        : year >= 1964
          ? ['USA', 'SOV', 'ENG', 'FRA', 'PRC']
          : year >= 1952
            ? ['USA', 'SOV', 'ENG']
            : year >= 1949
              ? ['USA', 'SOV']
              : year >= 1945
                ? ['USA']
                : [];
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO strategic_arsenals (
        game_id, nation_code, nuclear_stockpile, delivery_range, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    );
    const timestamp = new Date().toISOString();
    const historicalCodes = (
      this.database
        .prepare('SELECT nation_code FROM game_polities WHERE game_id = ?')
        .all(gameId) as Row[]
    ).map((row) => text(row.nation_code));
    const nationCodes = historicalCodes.length ? historicalCodes : [...this.catalog.nations.keys()];
    for (const nationCode of nationCodes) {
      const stockpile = nuclearPowers.includes(nationCode)
        ? year >= 1991 && nationCode === 'RUS'
          ? 6000
          : year >= 1991 && nationCode === 'USA'
            ? 5500
            : 200
        : 0;
      insert.run(gameId, nationCode, stockpile, stockpile > 0 ? 14_000 : 0, timestamp);
    }
  }

  private normalizeUnitDomains(gameId: string) {
    const units = this.database
      .prepare('SELECT id, unit_type FROM units WHERE game_id = ?')
      .all(gameId) as Row[];
    const update = this.database.prepare(
      `UPDATE units SET domain = ?,
        manpower = CASE WHEN manpower = 10000 THEN CASE unit_type
          WHEN 'naval' THEN 3500 WHEN 'air' THEN 1200 WHEN 'armor' THEN 12000 ELSE 15000 END
          ELSE manpower END,
        operational_range = CASE WHEN operational_range = 800 THEN CASE unit_type
          WHEN 'naval' THEN 5000 WHEN 'air' THEN 1600 ELSE 800 END
          ELSE operational_range END
       WHERE id = ?`,
    );
    for (const unit of units) update.run(domainFor(text(unit.unit_type)), text(unit.id));
  }

  listRegions(gameId: string): RegionState[] {
    this.ensureGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM region_states WHERE game_id = ? ORDER BY region_id')
        .all(gameId) as Row[]
    ).map((row) => ({
      gameId: text(row.game_id),
      regionId: text(row.region_id),
      nationCode: nullableText(row.nation_code),
      population: number(row.population),
      displacedPopulation: number(row.displaced_population),
      woundedPopulation: number(row.wounded_population),
      infrastructure: number(row.infrastructure),
      industrialCapacity: number(row.industrial_capacity),
      supply: number(row.supply),
      health: number(row.health),
      habitability: number(row.habitability),
      contamination: number(row.contamination),
      radiation: number(row.radiation),
      terrain: text(row.terrain) as RegionState['terrain'],
      neighbors: parseJson<string[]>(row.neighbors_json, []),
      updatedAt: text(row.updated_at),
    }));
  }

  listImpactZones(gameId: string): ImpactZone[] {
    this.ensureGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM impact_zones WHERE game_id = ? ORDER BY created_at DESC')
        .all(gameId) as Row[]
    ).map((row) => ({
      id: text(row.id),
      gameId: text(row.game_id),
      sourceEventId: nullableText(row.source_event_id),
      kind: text(row.kind) as ImpactKind,
      label: text(row.label),
      coordinates: [number(row.coords_x), number(row.coords_y)],
      radius: number(row.radius),
      intensity: number(row.intensity),
      radiation: number(row.radiation),
      active: Boolean(row.active),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    }));
  }

  listCharacters(gameId: string): Character[] {
    this.ensureGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM characters WHERE game_id = ? ORDER BY status, name')
        .all(gameId) as Row[]
    ).map((row) => {
      const nationCode = nullableText(row.nation_code);
      const name = text(row.name);
      const historicalLeader = row.office_holder_id
        ? (this.database
            .prepare(
              `SELECT is_primary FROM game_office_holders
               WHERE game_id = ? AND holder_id = ? LIMIT 1`,
            )
            .get(gameId, text(row.office_holder_id)) as Row | undefined)
        : undefined;
      const catalogLeader = nationCode ? this.catalog.nations.get(nationCode)?.leader_name : null;
      return {
        id: text(row.id),
        gameId: text(row.game_id),
        name,
        role: text(row.role),
        nationCode,
        loyaltyNationCode: nullableText(row.loyalty_nation_code),
        status: text(row.status) as Character['status'],
        regionId: nullableText(row.region_id),
        destinationRegionId: nullableText(row.destination_region_id),
        coordinates:
          row.coords_x === null || row.coords_y === null
            ? null
            : ([number(row.coords_x), number(row.coords_y)] as [number, number]),
        iconKey:
          historicalLeader?.is_primary === 1 || catalogLeader === name
            ? 'leader'
            : iconKeyForRole(text(row.role)),
        history: parseJson<string[]>(row.history_json, []),
        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at),
      } satisfies Character;
    });
  }

  applyCharacterChanges(
    gameId: string,
    changes: GeneratedCharacterChange[],
    gameDate: string,
    turnNumber: number,
  ) {
    if (!changes.length) return;
    const timestamp = new Date().toISOString();
    const regions = new Set(this.listRegions(gameId).map((region) => region.regionId));
    for (const change of changes) {
      if (change.operation === 'create') {
        if (!regions.has(change.region_id)) {
          throw new AppError(
            422,
            'CHARACTER_REGION_INVALID',
            'Le personnage vise une région inconnue.',
          );
        }
        const existing = this.listCharacters(gameId).find(
          (character) =>
            character.name.localeCompare(change.name, undefined, { sensitivity: 'base' }) === 0 &&
            character.nationCode === change.nation_code,
        );
        const coordinates = this.regionCoordinates(change.region_id, [700, 300]);
        const id = existing?.id ?? randomUUID();
        if (existing) {
          this.database
            .prepare(
              `UPDATE characters SET role = ?, loyalty_nation_code = ?, region_id = ?,
               coords_x = ?, coords_y = ?, status = 'active',
               history_json = ?, updated_at = ? WHERE id = ?`,
            )
            .run(
              change.role,
              change.loyalty_nation_code ?? change.nation_code,
              change.region_id,
              coordinates[0],
              coordinates[1],
              JSON.stringify([...existing.history, `${gameDate} · ${change.role}`].slice(-100)),
              timestamp,
              id,
            );
        } else {
          this.database
            .prepare(
              `INSERT INTO characters (
                id, game_id, name, role, nation_code, loyalty_nation_code, status,
                region_id, coords_x, coords_y, portrait_status, history_json,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 'pending', ?, ?, ?)`,
            )
            .run(
              id,
              gameId,
              change.name,
              change.role,
              change.nation_code,
              change.loyalty_nation_code ?? change.nation_code,
              change.region_id,
              coordinates[0],
              coordinates[1],
              JSON.stringify([`${gameDate} · ${change.role}`]),
              timestamp,
              timestamp,
            );
        }
        this.appendTimeline(gameId, gameDate, turnNumber, {
          kind: 'character',
          title: existing ? `${change.name} réapparaît` : `${change.name} entre en scène`,
          description: `${change.role} · ${change.region_id.replaceAll('_', ' ')}`,
          eventId: null,
          entityIds: [id],
          consequences: { persistent: true },
          cue: {
            kind: 'speech',
            iconKey: 'character',
            locations: [{ kind: 'region', role: 'primary', region_id: change.region_id }],
            path: [],
            intensity: 45,
            audioCue: 'character-reveal',
          },
        });
        continue;
      }
      const character = this.listCharacters(gameId).find(
        (candidate) => candidate.id === change.character_id,
      );
      if (!character) throw notFound('Character');
      if (change.region_id && !regions.has(change.region_id)) {
        throw new AppError(
          422,
          'CHARACTER_REGION_INVALID',
          'Le personnage vise une région inconnue.',
        );
      }
      const regionId = change.region_id ?? character.regionId;
      const coordinates = regionId
        ? this.regionCoordinates(regionId, character.coordinates ?? [700, 300])
        : character.coordinates;
      this.database
        .prepare(
          `UPDATE characters SET role = ?, status = ?, region_id = ?, destination_region_id = ?,
           coords_x = ?, coords_y = ?, history_json = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          change.role ?? character.role,
          change.status ?? character.status,
          regionId,
          change.destination_region_id === undefined
            ? character.destinationRegionId
            : change.destination_region_id,
          coordinates?.[0] ?? null,
          coordinates?.[1] ?? null,
          JSON.stringify(
            [
              ...character.history,
              `${gameDate} · ${change.status ?? change.role ?? 'Déplacement'}`,
            ].slice(-100),
          ),
          timestamp,
          character.id,
        );
    }
  }

  listUnits(gameId: string): StrategicUnit[] {
    this.ensureGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM units WHERE game_id = ? ORDER BY name')
        .all(gameId) as Row[]
    ).map((row) => ({
      id: text(row.id),
      gameId: text(row.game_id),
      name: text(row.name),
      unitType: text(row.unit_type) as StrategicUnit['unitType'],
      nationCode: text(row.nation_code),
      regionId: text(row.region_id),
      centroid: parseJson<[number, number]>(row.centroid, [700, 300]),
      strength: number(row.strength),
      organization: number(row.organization),
      experience: number(row.experience),
      createdAt: text(row.created_at),
      domain: text(row.domain) as StrategicUnit['domain'],
      manpower: number(row.manpower),
      equipment: number(row.equipment),
      morale: number(row.morale),
      fuel: number(row.fuel),
      supply: number(row.supply),
      range: number(row.operational_range),
      doctrine: text(row.doctrine),
      mission: text(row.mission) as StrategicUnit['mission'],
      intelLevel: text(row.intel_level) as StrategicUnit['intelLevel'],
    }));
  }

  listOrders(gameId: string): MovementOrder[] {
    this.ensureGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM strategic_orders WHERE game_id = ? ORDER BY created_at DESC')
        .all(gameId) as Row[]
    ).map((row) => ({
      id: text(row.id),
      gameId: text(row.game_id),
      unitId: text(row.unit_id),
      type: text(row.order_type) as MovementOrder['type'],
      originRegionId: text(row.origin_region_id),
      destinationRegionId: text(row.destination_region_id),
      targetUnitId: nullableText(row.target_unit_id) ?? undefined,
      directive: text(row.directive),
      route: parseJson<string[]>(row.route_json, []),
      status: text(row.status) as MovementOrder['status'],
      progress: number(row.progress),
      startDate: text(row.start_date),
      arrivalDate: text(row.arrival_date),
      idempotencyKey: text(row.idempotency_key),
      expectedWorldRevision: number(row.expected_world_revision),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    }));
  }

  listWars(gameId: string): War[] {
    this.ensureGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM wars WHERE game_id = ? ORDER BY started_date')
        .all(gameId) as Row[]
    ).map((row) => ({
      id: text(row.id),
      gameId: text(row.game_id),
      name: text(row.name),
      attackerNationCodes: parseJson<string[]>(row.attacker_nations_json, []),
      defenderNationCodes: parseJson<string[]>(row.defender_nations_json, []),
      status: text(row.status) as War['status'],
      startedDate: text(row.started_date),
      endedDate: nullableText(row.ended_date),
    }));
  }

  listFronts(gameId: string): Front[] {
    this.ensureGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM fronts WHERE game_id = ? ORDER BY name')
        .all(gameId) as Row[]
    ).map((row) => ({
      id: text(row.id),
      gameId: text(row.game_id),
      warId: text(row.war_id),
      name: text(row.name),
      regionIds: parseJson<string[]>(row.region_ids_json, []),
      attackerPressure: number(row.attacker_pressure),
      defenderPressure: number(row.defender_pressure),
      supplyStatus: text(row.supply_status) as Front['supplyStatus'],
      updatedAt: text(row.updated_at),
    }));
  }

  listContacts(gameId: string): IntelContact[] {
    this.ensureGame(gameId);
    return (
      this.database
        .prepare('SELECT * FROM intel_contacts WHERE game_id = ? ORDER BY observed_at DESC')
        .all(gameId) as Row[]
    ).map((row) => ({
      id: text(row.id),
      gameId: text(row.game_id),
      observerNationCode: text(row.observer_nation_code),
      targetUnitId: text(row.target_unit_id),
      level: text(row.intel_level) as IntelContact['level'],
      estimatedRegionId: nullableText(row.estimated_region_id),
      estimatedStrength: row.estimated_strength === null ? null : number(row.estimated_strength),
      observedAt: text(row.observed_at),
    }));
  }

  getState(gameId: string, sinceRevision?: number): StrategicState {
    this.ensureGame(gameId);
    const game = this.database
      .prepare('SELECT games.current_date AS game_date, world_revision FROM games WHERE id = ?')
      .get(gameId) as Row;
    const worldRevision = number(game.world_revision);
    if (this.listContacts(gameId).length === 0) {
      this.refreshContacts(gameId, text(game.game_date));
    }
    if (sinceRevision !== undefined && sinceRevision === worldRevision) {
      return {
        gameId,
        worldRevision,
        currentDate: text(game.game_date),
        regions: [],
        impactZones: [],
        characters: [],
        units: [],
        orders: [],
        wars: [],
        fronts: [],
        contacts: [],
      };
    }
    const contacts = this.listContacts(gameId);
    return {
      gameId,
      worldRevision,
      currentDate: text(game.game_date),
      regions: this.listRegions(gameId),
      impactZones: this.listImpactZones(gameId),
      characters: this.listCharacters(gameId),
      units: this.unitsForObserver(gameId, contacts),
      orders: this.listOrders(gameId),
      wars: this.listWars(gameId),
      fronts: this.listFronts(gameId),
      contacts,
    };
  }

  previewOrder(gameId: string, input: MovementOrderInput): MovementOrderPreview {
    this.ensureGame(gameId);
    const game = this.database
      .prepare('SELECT world_revision FROM games WHERE id = ?')
      .get(gameId) as Row;
    const unit = this.listUnits(gameId).find((candidate) => candidate.id === input.unitId);
    if (!unit) throw notFound('Unit');
    const playerNation = this.database
      .prepare('SELECT player_nation_code FROM games WHERE id = ?')
      .get(gameId) as Row;
    if (unit.nationCode !== text(playerNation.player_nation_code)) {
      throw new AppError(
        403,
        'UNIT_NOT_CONTROLLED',
        'Cette unité ne relève pas de votre commandement.',
      );
    }
    const regions = this.listRegions(gameId);
    const route = findStrategicRoute(
      regions,
      unit.regionId,
      input.destinationRegionId,
      unit.domain,
    );
    const warnings: string[] = [];
    if (!route) {
      warnings.push('Aucune route compatible avec le domaine de cette unité.');
      return {
        valid: false,
        unitId: unit.id,
        originRegionId: unit.regionId,
        destinationRegionId: input.destinationRegionId,
        route: [],
        durationDays: 1,
        fuelCost: 0,
        supplyRisk: 'blocked',
        warnings,
        worldRevision: number(game.world_revision),
      };
    }
    const estimate = estimateMovementDuration(route, regions, unit);
    if (estimate.fuelCost > unit.fuel)
      warnings.push('Carburant insuffisant pour terminer la mission.');
    if (estimate.supplyRisk === 'high')
      warnings.push('La route traverse une zone très mal ravitaillée.');
    const valid = estimate.supplyRisk !== 'blocked' && estimate.fuelCost <= unit.fuel;
    return {
      valid,
      unitId: unit.id,
      originRegionId: unit.regionId,
      destinationRegionId: input.destinationRegionId,
      route,
      durationDays: estimate.durationDays,
      fuelCost: estimate.fuelCost,
      supplyRisk: estimate.supplyRisk,
      warnings,
      worldRevision: number(game.world_revision),
    };
  }

  createOrder(gameId: string, input: MovementOrderInput): MovementOrder {
    const existing = this.database
      .prepare('SELECT id FROM strategic_orders WHERE game_id = ? AND idempotency_key = ?')
      .get(gameId, input.idempotencyKey) as Row | undefined;
    if (existing) return this.listOrders(gameId).find((order) => order.id === text(existing.id))!;
    const preview = this.previewOrder(gameId, input);
    if (preview.worldRevision !== input.expectedWorldRevision) {
      throw new AppError(409, 'WORLD_REVISION_CONFLICT', 'Le monde a changé. Revalidez cet ordre.');
    }
    if (!preview.valid) {
      throw new AppError(422, 'ORDER_BLOCKED', preview.warnings.join(' ') || 'Ordre impossible.');
    }
    const game = this.database
      .prepare('SELECT games.current_date AS game_date, turn_number FROM games WHERE id = ?')
      .get(gameId) as Row;
    const timestamp = new Date().toISOString();
    const id = randomUUID();
    const arrivalDate = addTime(text(game.game_date), {
      amount: preview.durationDays,
      unit: 'day',
      strategy: 'fixed',
    });
    this.database
      .prepare(
        `INSERT INTO strategic_orders (
          id, game_id, unit_id, order_type, origin_region_id, destination_region_id,
          target_unit_id, directive, route_json, status, progress, start_date, arrival_date,
          idempotency_key, expected_world_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        gameId,
        input.unitId,
        input.type,
        preview.originRegionId,
        input.destinationRegionId,
        input.targetUnitId ?? null,
        input.directive,
        JSON.stringify(preview.route),
        text(game.game_date),
        arrivalDate,
        input.idempotencyKey,
        input.expectedWorldRevision,
        timestamp,
        timestamp,
      );
    this.database
      .prepare('UPDATE units SET mission = ? WHERE id = ?')
      .run(input.type, input.unitId);
    this.bumpRevision(gameId);
    this.appendTimeline(gameId, text(game.game_date), number(game.turn_number), {
      kind: 'movement_started',
      title: 'Ordre de mouvement confirmé',
      description: `${this.listUnits(gameId).find((unit) => unit.id === input.unitId)?.name ?? 'Unité'} : ${preview.originRegionId} → ${input.destinationRegionId}.`,
      eventId: null,
      entityIds: [input.unitId, id],
      consequences: { durationDays: preview.durationDays, fuelCost: preview.fuelCost },
      cue: {
        kind: 'movement',
        iconKey: `unit-${this.listUnits(gameId).find((unit) => unit.id === input.unitId)?.unitType ?? 'infantry'}`,
        locations: [
          { kind: 'region', role: 'primary', region_id: preview.originRegionId },
          { kind: 'region', role: 'secondary', region_id: input.destinationRegionId },
        ],
        path: [],
        intensity: 45,
        audioCue: 'movement-order',
      },
    });
    return this.listOrders(gameId).find((order) => order.id === id)!;
  }

  listTimeline(gameId: string, limit = 300): TimelineEntry[] {
    this.ensureGame(gameId);
    return (
      this.database
        .prepare(
          `SELECT * FROM timeline_entries WHERE game_id = ?
           ORDER BY game_date DESC, turn_number DESC, sequence ASC LIMIT ?`,
        )
        .all(gameId, limit) as Row[]
    ).map((row) => ({
      id: text(row.id),
      gameId: text(row.game_id),
      gameDate: text(row.game_date),
      turnNumber: number(row.turn_number),
      sequence: number(row.sequence),
      kind: text(row.entry_kind) as TimelineEntry['kind'],
      title: text(row.title),
      description: text(row.description),
      eventId: nullableText(row.event_id),
      entityIds: parseJson<string[]>(row.entity_ids_json, []),
      consequences: parseJson<TimelineEntry['consequences']>(row.consequences_json, {}),
      cue: parseJson<TimelineEntry['cue']>(row.cinematic_cue_json, {
        kind: 'focus',
        iconKey: 'event-general',
        locations: [],
        path: [],
        intensity: 50,
        audioCue: null,
      }),
      createdAt: text(row.created_at),
    }));
  }

  appendEventTimeline(gameId: string, event: GameEvent) {
    const inferredImpactKind = this.inferImpactKind(event);
    if (inferredImpactKind === 'nuclear_strike' && !event.strategic_effect) {
      throw new AppError(
        422,
        'NUCLEAR_EFFECT_REQUIRED',
        'Un récit nucléaire exige une cible, un vecteur et des effets structurés.',
      );
    }
    if (
      inferredImpactKind === 'nuclear_strike' &&
      event.strategic_effect?.kind !== 'nuclear_strike'
    ) {
      throw new AppError(
        422,
        'NUCLEAR_EFFECT_MISMATCH',
        'Le récit nucléaire et les effets structurés ne correspondent pas.',
      );
    }
    const impactKind = event.strategic_effect?.kind ?? inferredImpactKind;
    if (impactKind) {
      this.validateEventImpact(gameId, event, impactKind, event.strategic_effect);
    }
    const iconKey = event.icon_key ?? impactKind ?? `event-${event.event_type}`;
    this.appendTimeline(gameId, event.gameDate, event.turnNumber, {
      kind: impactKind ? 'impact' : 'event',
      title: event.title,
      description: event.description,
      eventId: event.id,
      entityIds: [],
      consequences: Object.fromEntries(
        Object.entries(event.state_changes).flatMap(([nationCode, changes]) =>
          Object.entries(changes).flatMap(([key, value]) =>
            value === undefined
              ? []
              : [[`${nationCode}.${key}`, Array.isArray(value) ? JSON.stringify(value) : value]],
          ),
        ),
      ),
      cue: {
        kind: impactKind === 'nuclear_strike' ? 'explosion' : impactKind ? 'fallout' : 'focus',
        iconKey,
        locations: event.map_cue.locations,
        path: [],
        intensity: event.severity === 'critical' ? 100 : event.severity === 'major' ? 75 : 45,
        audioCue: impactKind === 'nuclear_strike' ? 'nuclear-impact' : `event-${event.event_type}`,
      },
    });
    if (impactKind) this.applyEventImpact(gameId, event, impactKind, event.strategic_effect);
  }

  private validateEventImpact(
    gameId: string,
    event: GameEvent,
    kind: ImpactKind,
    effect?: StrategicEventEffect,
  ) {
    const targetRegionId =
      effect?.target_region_id ??
      (() => {
        const location =
          event.map_cue.locations.find((candidate) => candidate.role === 'primary') ??
          event.map_cue.locations[0];
        return this.resolveLocation(gameId, location)?.regionId ?? null;
      })();
    if (
      !targetRegionId ||
      !this.listRegions(gameId).some((region) => region.regionId === targetRegionId)
    ) {
      throw new AppError(422, 'IMPACT_TARGET_REQUIRED', 'Un impact doit viser une région valide.');
    }
    if (kind !== 'nuclear_strike') return;
    if (!effect || effect.kind !== 'nuclear_strike') {
      throw new AppError(422, 'NUCLEAR_EFFECT_REQUIRED', 'Les effets nucléaires sont incomplets.');
    }
    const primaryLocation = event.map_cue.locations.find(
      (candidate) => candidate.role === 'primary',
    );
    if (
      primaryLocation?.kind === 'region' &&
      primaryLocation.region_id !== effect.target_region_id
    ) {
      throw new AppError(
        422,
        'NUCLEAR_TARGET_MISMATCH',
        'La cible narrative et la cible simulée divergent.',
      );
    }
    if (effect.vector === 'editor' && !effect.editor_override) {
      throw new AppError(
        422,
        'EDITOR_OVERRIDE_REQUIRED',
        'Le vecteur éditeur exige une dérogation explicite.',
      );
    }
    if (effect.editor_override) return;
    const arsenal = this.database
      .prepare(
        `SELECT nuclear_stockpile, delivery_range FROM strategic_arsenals
         WHERE game_id = ? AND nation_code = ?`,
      )
      .get(gameId, effect.source_nation_code) as Row | undefined;
    if (!arsenal || number(arsenal.nuclear_stockpile) <= 0 || number(arsenal.delivery_range) <= 0) {
      throw new AppError(
        422,
        'NUCLEAR_CAPABILITY_REQUIRED',
        'La nation désignée ne possède ni arme nucléaire ni vecteur opérationnel.',
      );
    }
  }

  private inferImpactKind(event: GameEvent): ImpactKind | null {
    const content = `${event.title} ${event.description}`.toLowerCase();
    const classification = `${event.subtype ?? ''} ${event.icon_key ?? ''}`.toLowerCase();
    const mentionsNuclear = /nucl[ée]aire|nuclear|atomique|atomic/.test(content);
    const describesNuclearDetonation =
      /explos|d[ée]ton|champignon atomique|nuclear blast|retomb[ée]es? radioactives?|fallout|irradi[ée]|an[ée]anti|d[ée]truit/.test(
        content,
      );
    const describesNuclearAttack =
      /(?:frappe|attaque|bombardement|tir|lancement)\s+(?:[\p{L}-]+\s+){0,3}(?:nucl[ée]aire|atomique)|(?:nuclear|atomic)\s+(?:strike|attack|bombing|launch)/u.test(
        content,
      );
    if (
      /nuclear[_ -]?strike|frappe[_ -]?nucl[ée]aire/.test(classification) ||
      (mentionsNuclear && (describesNuclearDetonation || describesNuclearAttack))
    ) {
      return 'nuclear_strike';
    }
    if (
      /conventional[_ -]?strike/.test(classification) ||
      /bombardement\s+(?:sur|contre|de)|(?:bombarde|bombard[ée]e?)\s|frappe\s+(?:sur|contre)|missile\s+(?:lanc[ée]|tir[ée]|frappe|atteint|explose)|tirs?\s+d['’]artillerie/.test(
        content,
      )
    ) {
      return 'conventional_strike';
    }
    if (/incend|wildfire|firestorm/.test(content)) return 'fire';
    if (/épid[ée]mie|epidemic|pand[ée]mie|pandemic/.test(content)) return 'epidemic';
    if (/famine|starvation/.test(content)) return 'famine';
    if (/séisme|earthquake|tsunami|ouragan|hurricane|inondation|flood/.test(content)) {
      return 'natural_disaster';
    }
    if (/accident industriel|industrial disaster|chemical leak/.test(content)) {
      return 'industrial_disaster';
    }
    return null;
  }

  private applyEventImpact(
    gameId: string,
    event: GameEvent,
    kind: ImpactKind,
    effect?: StrategicEventEffect,
  ) {
    const location = effect
      ? ({ kind: 'region', role: 'primary', region_id: effect.target_region_id } as const)
      : (event.map_cue.locations.find((candidate) => candidate.role === 'primary') ??
        event.map_cue.locations[0]);
    const resolved = this.resolveLocation(gameId, location);
    if (!resolved?.regionId) {
      throw new AppError(422, 'IMPACT_TARGET_REQUIRED', 'Un impact doit viser une région valide.');
    }
    const intensity =
      effect?.intensity ??
      (event.severity === 'critical' ? 100 : event.severity === 'major' ? 75 : 45);
    if (kind === 'nuclear_strike') {
      if (!effect || effect.kind !== 'nuclear_strike') {
        throw new AppError(
          422,
          'NUCLEAR_EFFECT_REQUIRED',
          'Les effets nucléaires sont incomplets.',
        );
      }
      const primaryLocation = event.map_cue.locations.find(
        (candidate) => candidate.role === 'primary',
      );
      if (
        primaryLocation?.kind === 'region' &&
        primaryLocation.region_id !== effect.target_region_id
      ) {
        throw new AppError(
          422,
          'NUCLEAR_TARGET_MISMATCH',
          'La cible narrative et la cible simulée divergent.',
        );
      }
      if (effect.vector === 'editor' && !effect.editor_override) {
        throw new AppError(
          422,
          'EDITOR_OVERRIDE_REQUIRED',
          'Le vecteur éditeur exige une dérogation explicite.',
        );
      }
      const attacker = effect.source_nation_code;
      const arsenal = attacker
        ? (this.database
            .prepare(
              'SELECT nuclear_stockpile FROM strategic_arsenals WHERE game_id = ? AND nation_code = ?',
            )
            .get(gameId, attacker) as Row | undefined)
        : undefined;
      if (!effect.editor_override && (!arsenal || number(arsenal.nuclear_stockpile) <= 0)) {
        throw new AppError(
          422,
          'NUCLEAR_CAPABILITY_REQUIRED',
          'La nation désignée ne possède aucune arme nucléaire disponible.',
        );
      }
      if (!effect.editor_override && arsenal) {
        this.database
          .prepare(
            `UPDATE strategic_arsenals SET nuclear_stockpile = nuclear_stockpile - 1,
             updated_at = ? WHERE game_id = ? AND nation_code = ?`,
          )
          .run(new Date().toISOString(), gameId, attacker!);
      }
    }
    const timestamp = new Date().toISOString();
    const result = applyRegionalImpact(
      this.listRegions(gameId),
      { kind, intensity, targetRegionId: resolved.regionId },
      timestamp,
    );
    this.writeRegions(
      result.regions.filter((region) => result.affectedRegionIds.includes(region.regionId)),
    );
    const zoneId = randomUUID();
    this.database
      .prepare(
        `INSERT INTO impact_zones (
          id, game_id, source_event_id, kind, label, coords_x, coords_y, radius,
          intensity, radiation, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        zoneId,
        gameId,
        event.id,
        kind,
        event.title,
        resolved.coordinates[0],
        resolved.coordinates[1],
        kind === 'nuclear_strike' ? 54 : 28,
        intensity,
        kind === 'nuclear_strike' ? intensity : 0,
        timestamp,
        timestamp,
      );
    this.reconcileNationPopulation(gameId);
    this.appendTimeline(gameId, event.gameDate, event.turnNumber, {
      kind: 'impact',
      title: kind === 'nuclear_strike' ? 'Conséquences nucléaires confirmées' : 'Dégâts confirmés',
      description: `${Math.round(result.deaths).toLocaleString('fr-FR')} morts, ${Math.round(result.wounded).toLocaleString('fr-FR')} blessés et ${Math.round(result.displaced).toLocaleString('fr-FR')} déplacés.`,
      eventId: event.id,
      entityIds: [zoneId, ...result.affectedRegionIds],
      consequences: {
        deaths: Math.round(result.deaths),
        wounded: Math.round(result.wounded),
        displaced: Math.round(result.displaced),
        uninhabitable: result.regions.some(
          (region) =>
            result.affectedRegionIds.includes(region.regionId) && region.habitability < 20,
        ),
      },
      cue: {
        kind: kind === 'nuclear_strike' ? 'explosion' : 'fallout',
        iconKey: kind,
        locations: [{ kind: 'region', role: 'primary', region_id: resolved.regionId }],
        path: [],
        intensity,
        audioCue: kind === 'nuclear_strike' ? 'nuclear-impact' : 'impact',
      },
    });
  }

  advanceDailySimulation(
    gameId: string,
    previousDate: string,
    newDate: string,
    turnNumber: number,
  ) {
    this.ensureGame(gameId);
    const days = daysBetween(previousDate, newDate);
    if (days <= 0) return;
    this.advanceHistoricalTransitions(gameId, previousDate, newDate, turnNumber);
    const timestamp = new Date().toISOString();
    this.writeRegions(
      this.listRegions(gameId).map((region) => evolveRegionalRecovery(region, days, timestamp)),
    );
    const units = this.listUnits(gameId);
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    for (const order of this.listOrders(gameId).filter(
      (candidate) => candidate.status === 'queued' || candidate.status === 'moving',
    )) {
      const unit = unitById.get(order.unitId);
      if (!unit) continue;
      const totalDays = Math.max(1, daysBetween(order.startDate, order.arrivalDate));
      const elapsedDays = Math.min(totalDays, daysBetween(order.startDate, newDate));
      const progress = elapsedDays / totalDays;
      if (progress < 1) {
        this.database
          .prepare(
            `UPDATE strategic_orders SET status = 'moving', progress = ?, updated_at = ? WHERE id = ?`,
          )
          .run(progress, timestamp, order.id);
        this.appendTimeline(gameId, newDate, turnNumber, {
          kind: 'movement_progress',
          title: `${unit.name} poursuit sa mission`,
          description: `${Math.round(progress * 100)} % du trajet parcouru vers ${order.destinationRegionId}.`,
          eventId: null,
          entityIds: [unit.id, order.id],
          consequences: { progress: Math.round(progress * 100) },
          cue: {
            kind: 'movement',
            iconKey: `unit-${unit.unitType}`,
            locations: [
              { kind: 'unit', role: 'primary', unit_id: unit.id },
              { kind: 'region', role: 'secondary', region_id: order.destinationRegionId },
            ],
            path: this.routeCoordinates(order.route, unit.centroid),
            intensity: 45,
            audioCue:
              unit.domain === 'air' ? 'aircraft' : unit.domain === 'naval' ? 'fleet' : 'march',
          },
        });
        continue;
      }
      const enemy = units.find(
        (candidate) =>
          candidate.regionId === order.destinationRegionId &&
          candidate.nationCode !== unit.nationCode &&
          candidate.strength > 0,
      );
      if (enemy && order.type === 'attack') {
        const region = this.listRegions(gameId).find(
          (candidate) => candidate.regionId === order.destinationRegionId,
        );
        if (region) {
          this.appendTimeline(gameId, newDate, turnNumber, {
            kind: 'interception',
            title: `${unit.name} est interceptée`,
            description: `${enemy.name} bloque la progression dans ${region.regionId}.`,
            eventId: null,
            entityIds: [unit.id, enemy.id, order.id],
            consequences: { interrupted: true },
            cue: {
              kind: 'battle',
              iconKey: 'event-interception',
              locations: [{ kind: 'region', role: 'primary', region_id: region.regionId }],
              path: this.routeCoordinates(order.route, unit.centroid),
              intensity: 70,
              audioCue: 'interception',
            },
          });
          const combat = resolveStrategicCombat(
            unit,
            enemy,
            region,
            `${gameId}:${newDate}:${unit.id}:${enemy.id}`,
          );
          this.database
            .prepare(
              'UPDATE units SET strength = ?, manpower = ?, organization = MAX(0, organization - 12) WHERE id = ?',
            )
            .run(combat.attackerStrength, combat.attackerManpower, unit.id);
          this.database
            .prepare(
              'UPDATE units SET strength = ?, manpower = ?, organization = MAX(0, organization - 15) WHERE id = ?',
            )
            .run(combat.defenderStrength, combat.defenderManpower, enemy.id);
          if (!combat.attackerWon) {
            this.database
              .prepare(
                `UPDATE strategic_orders SET status = 'intercepted', progress = 1, updated_at = ? WHERE id = ?`,
              )
              .run(timestamp, order.id);
          } else {
            this.completeMovement(order, unit, timestamp);
          }
          this.ensureWarAndFront(gameId, unit, enemy, region, newDate, timestamp);
          this.appendTimeline(gameId, newDate, turnNumber, {
            kind: 'battle',
            title: `Bataille de ${region.regionId}`,
            description: `${unit.name} affronte ${enemy.name}. Pertes : ${combat.attackerLoss.toFixed(1)} % / ${combat.defenderLoss.toFixed(1)} %.`,
            eventId: null,
            entityIds: [unit.id, enemy.id, order.id],
            consequences: {
              attackerLoss: combat.attackerLoss,
              defenderLoss: combat.defenderLoss,
              attackerWon: combat.attackerWon,
            },
            cue: {
              kind: 'battle',
              iconKey: 'event-battle',
              locations: [{ kind: 'region', role: 'primary', region_id: region.regionId }],
              path: [],
              intensity: 85,
              audioCue: 'battle',
            },
          });
          continue;
        }
      }
      this.completeMovement(order, unit, timestamp);
      this.appendTimeline(gameId, newDate, turnNumber, {
        kind: 'arrival',
        title: `${unit.name} arrive à destination`,
        description: `${order.originRegionId} → ${order.destinationRegionId}`,
        eventId: null,
        entityIds: [unit.id, order.id],
        consequences: { completed: true },
        cue: {
          kind: 'movement',
          iconKey: `unit-${unit.unitType}`,
          locations: [
            { kind: 'region', role: 'secondary', region_id: order.originRegionId },
            { kind: 'region', role: 'primary', region_id: order.destinationRegionId },
          ],
          path: [],
          intensity: 55,
          audioCue:
            unit.domain === 'air' ? 'aircraft' : unit.domain === 'naval' ? 'fleet' : 'march',
        },
      });
    }
    const regionById = new Map(this.listRegions(gameId).map((region) => [region.regionId, region]));
    for (const unit of this.listUnits(gameId)) {
      const region = regionById.get(unit.regionId);
      if (!region) continue;
      const isolated = region.supply < 25;
      const supplyDelta = isolated ? -Math.min(24, days * 2) : Math.min(12, days);
      const organizationLoss = isolated ? Math.min(30, days * 1.5) : 0;
      this.database
        .prepare(
          `UPDATE units SET
            supply = MIN(100, MAX(0, supply + ?)),
            organization = MAX(0, organization - ?),
            morale = MAX(0, morale - ?)
           WHERE id = ?`,
        )
        .run(supplyDelta, organizationLoss, isolated ? Math.min(15, days) : 0, unit.id);
    }
    this.database
      .prepare(
        `UPDATE fronts SET supply_status = CASE
           WHEN EXISTS (
             SELECT 1 FROM json_each(fronts.region_ids_json) ids
             JOIN region_states rs ON rs.game_id = fronts.game_id AND rs.region_id = ids.value
             WHERE rs.supply < 25
           ) THEN 'cut'
           WHEN EXISTS (
             SELECT 1 FROM json_each(fronts.region_ids_json) ids
             JOIN region_states rs ON rs.game_id = fronts.game_id AND rs.region_id = ids.value
             WHERE rs.supply < 50
           ) THEN 'strained'
           ELSE 'supplied' END,
           updated_at = ?
         WHERE game_id = ?`,
      )
      .run(timestamp, gameId);
    this.refreshContacts(gameId, newDate);
    this.reconcileNationPopulation(gameId);
  }

  private advanceHistoricalTransitions(
    gameId: string,
    previousDate: string,
    newDate: string,
    turnNumber: number,
  ) {
    const game = this.database
      .prepare('SELECT historical_baseline_mode, world_revision FROM games WHERE id = ?')
      .get(gameId) as Row;
    if (text(game.historical_baseline_mode) !== 'historical_v1') return;
    const timestamp = new Date().toISOString();
    const alreadyProcessed = this.database.prepare(
      'SELECT 1 FROM historical_transition_runs WHERE game_id = ? AND transition_id = ?',
    );
    const continuity = this.database.prepare(
      `SELECT continuity_status FROM historical_continuity
       WHERE game_id = ? AND entity_type = ? AND entity_id = ?`,
    );
    const record = this.database.prepare(
      `INSERT INTO historical_transition_runs (
        game_id, transition_id, effective_date, transition_kind, status, reason,
        applied_world_revision, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const transition of this.historical.transitionsBetween(previousDate, newDate, 'fr')) {
      if (alreadyProcessed.get(gameId, transition.id)) continue;
      const entity = transition.entityIds[0]!;
      const separator = entity.indexOf(':');
      const entityType = entity.slice(0, separator);
      const entityId = entity.slice(separator + 1);
      const state = continuity.get(gameId, entityType, entityId) as Row | undefined;
      if (state && text(state.continuity_status) === 'diverged') {
        record.run(
          gameId,
          transition.id,
          transition.effectiveDate,
          transition.kind,
          'skipped_divergence',
          'The affected entity already diverged from its historical state.',
          number(game.world_revision) + 1,
          timestamp,
        );
        continue;
      }
      if (transition.kind === 'office') {
        const holderId = transition.changes.holderId;
        const term = holderId ? this.historical.officeTerm(holderId) : undefined;
        if (!term) continue;
        const officeKey = `${term.nationCode}:${term.role}`;
        const current = this.database
          .prepare('SELECT holder_id FROM game_office_holders WHERE game_id = ? AND office_key = ?')
          .get(gameId, officeKey) as Row | undefined;
        const expected = transition.expectedBefore.holderId;
        if (expected && (!current || text(current.holder_id) !== expected)) {
          record.run(
            gameId,
            transition.id,
            transition.effectiveDate,
            transition.kind,
            'skipped_divergence',
            'The incumbent no longer matches the historical predecessor.',
            number(game.world_revision) + 1,
            timestamp,
          );
          this.database
            .prepare(
              `INSERT INTO historical_continuity (
                game_id, entity_type, entity_id, continuity_status, diverged_at, reason, updated_at
              ) VALUES (?, 'office', ?, 'diverged', ?, ?, ?)
              ON CONFLICT(game_id, entity_type, entity_id) DO UPDATE SET
                continuity_status = 'diverged', diverged_at = excluded.diverged_at,
                reason = excluded.reason, updated_at = excluded.updated_at`,
            )
            .run(gameId, officeKey, transition.effectiveDate, 'Incumbent mismatch', timestamp);
          continue;
        }
        this.database
          .prepare(
            `INSERT INTO game_office_holders (
              game_id, office_key, holder_id, nation_code, role, title_en, title_fr,
              holder_name, term_start, term_end, source, is_primary, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(game_id, office_key) DO UPDATE SET
              holder_id = excluded.holder_id, title_en = excluded.title_en,
              title_fr = excluded.title_fr, holder_name = excluded.holder_name,
              term_start = excluded.term_start, term_end = excluded.term_end,
              source = excluded.source, is_primary = excluded.is_primary,
              updated_at = excluded.updated_at`,
          )
          .run(
            gameId,
            officeKey,
            term.id,
            term.nationCode,
            term.role,
            term.title,
            term.titleFr,
            term.name,
            term.termStart,
            term.termEnd ?? null,
            term.source,
            term.role === 'head_of_state' ? 1 : 0,
            timestamp,
          );
        this.initializeCharacters(gameId);
      } else if (transition.kind === 'territory') {
        const regionId = entityId;
        if ('territorialStatus' in transition.changes) {
          const current = this.database
            .prepare(
              `SELECT territorial_status FROM game_regions
               WHERE game_id = ? AND region_id = ?`,
            )
            .get(gameId, regionId) as Row | undefined;
          if (!current) continue;
          const expectedStatus = transition.expectedBefore.territorialStatus ?? null;
          if (nullableText(current.territorial_status) !== expectedStatus) {
            record.run(
              gameId,
              transition.id,
              transition.effectiveDate,
              transition.kind,
              'skipped_divergence',
              'The territorial status no longer matches its historical predecessor.',
              number(game.world_revision) + 1,
              timestamp,
            );
            continue;
          }
          this.database
            .prepare(
              `UPDATE game_regions SET territorial_status = ?, administering_nation_code = ?,
               claim_nation_codes = ?, updated_at = ?
               WHERE game_id = ? AND region_id = ?`,
            )
            .run(
              transition.changes.territorialStatus ?? null,
              transition.changes.administeringNationCode ?? null,
              transition.changes.claimNationCodes ?? '[]',
              timestamp,
              gameId,
              regionId,
            );
        } else {
          const owner = transition.changes.owner ?? null;
          const current = this.database
            .prepare(
              'SELECT owner_nation_code, controller_nation_code FROM game_regions WHERE game_id = ? AND region_id = ?',
            )
            .get(gameId, regionId) as Row | undefined;
          if (!current) continue;
          const oldOwner = nullableText(current.owner_nation_code);
          const expectedOwner = transition.expectedBefore.owner ?? null;
          if (oldOwner !== expectedOwner) {
            record.run(
              gameId,
              transition.id,
              transition.effectiveDate,
              transition.kind,
              'skipped_divergence',
              'The territorial owner no longer matches the historical predecessor.',
              number(game.world_revision) + 1,
              timestamp,
            );
            this.database
              .prepare(
                `INSERT INTO historical_continuity (
                game_id, entity_type, entity_id, continuity_status, diverged_at, reason, updated_at
              ) VALUES (?, 'region', ?, 'diverged', ?, ?, ?)
              ON CONFLICT(game_id, entity_type, entity_id) DO UPDATE SET
                continuity_status = 'diverged', diverged_at = excluded.diverged_at,
                reason = excluded.reason, updated_at = excluded.updated_at`,
              )
              .run(
                gameId,
                regionId,
                transition.effectiveDate,
                'Territorial owner mismatch',
                timestamp,
              );
            continue;
          }
          this.database
            .prepare(
              `UPDATE game_regions SET owner_nation_code = ?,
              controller_nation_code = CASE WHEN controller_nation_code = ? THEN ? ELSE controller_nation_code END,
              updated_at = ? WHERE game_id = ? AND region_id = ?`,
            )
            .run(owner, oldOwner, owner, timestamp, gameId, regionId);
          this.database
            .prepare(
              'UPDATE region_states SET nation_code = ?, updated_at = ? WHERE game_id = ? AND region_id = ?',
            )
            .run(owner, timestamp, gameId, regionId);
        }
      }
      record.run(
        gameId,
        transition.id,
        transition.effectiveDate,
        transition.kind,
        'applied',
        null,
        number(game.world_revision) + 1,
        timestamp,
      );
      this.appendTimeline(gameId, transition.effectiveDate, turnNumber, {
        kind: transition.kind === 'office' ? 'character' : 'event',
        title: transition.title,
        description: transition.description,
        eventId: null,
        entityIds: transition.entityIds,
        consequences: { historicalTransition: true },
        cue: {
          kind: transition.kind === 'office' ? 'speech' : 'focus',
          iconKey: transition.kind === 'office' ? 'character-leader' : 'event-territory',
          locations: [],
          path: [],
          intensity: 35,
          audioCue: null,
        },
      });
    }
  }

  private completeMovement(order: MovementOrder, unit: StrategicUnit, timestamp: string) {
    const preview = estimateMovementDuration(order.route, this.listRegions(order.gameId), unit);
    const centroid = this.regionCoordinates(order.destinationRegionId, unit.centroid);
    this.database
      .prepare(
        `UPDATE units SET region_id = ?, centroid = ?, mission = 'idle', fuel = MAX(0, fuel - ?),
         supply = MAX(0, supply - ?), organization = MAX(0, organization - 4) WHERE id = ?`,
      )
      .run(
        order.destinationRegionId,
        JSON.stringify(centroid),
        preview.fuelCost,
        preview.supplyRisk === 'high' ? 18 : 7,
        unit.id,
      );
    this.database
      .prepare(
        `UPDATE strategic_orders SET status = 'completed', progress = 1, updated_at = ? WHERE id = ?`,
      )
      .run(timestamp, order.id);
  }

  private regionCoordinates(regionId: string, fallback: [number, number]): [number, number] {
    return (
      this.catalog.cities.find((candidate) => candidate.region_id === regionId)?.coords ?? fallback
    );
  }

  private routeCoordinates(route: string[], fallback: [number, number]) {
    return route.map((regionId, index) =>
      index === 0 ? fallback : this.regionCoordinates(regionId, fallback),
    );
  }

  private ensureWarAndFront(
    gameId: string,
    attacker: StrategicUnit,
    defender: StrategicUnit,
    region: RegionState,
    date: string,
    timestamp: string,
  ) {
    let war = this.listWars(gameId).find(
      (candidate) =>
        candidate.status === 'active' &&
        candidate.attackerNationCodes.includes(attacker.nationCode) &&
        candidate.defenderNationCodes.includes(defender.nationCode),
    );
    if (!war) {
      const id = randomUUID();
      this.database
        .prepare(
          `INSERT INTO wars (
            id, game_id, name, attacker_nations_json, defender_nations_json, status, started_date
          ) VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        )
        .run(
          id,
          gameId,
          `${attacker.nationCode}–${defender.nationCode} War`,
          JSON.stringify([attacker.nationCode]),
          JSON.stringify([defender.nationCode]),
          date,
        );
      war = this.listWars(gameId).find((candidate) => candidate.id === id)!;
    }
    const existing = this.listFronts(gameId).find(
      (front) => front.warId === war!.id && front.regionIds.includes(region.regionId),
    );
    if (!existing) {
      this.database
        .prepare(
          `INSERT INTO fronts (
            id, game_id, war_id, name, region_ids_json, attacker_pressure,
            defender_pressure, supply_status, updated_at
          ) VALUES (?, ?, ?, ?, ?, 50, 50, ?, ?)`,
        )
        .run(
          randomUUID(),
          gameId,
          war.id,
          `Front de ${region.regionId}`,
          JSON.stringify([region.regionId]),
          region.supply < 25 ? 'cut' : region.supply < 50 ? 'strained' : 'supplied',
          timestamp,
        );
    }
  }

  private refreshContacts(gameId: string, observedDate: string) {
    const game = this.database
      .prepare('SELECT player_nation_code FROM games WHERE id = ?')
      .get(gameId) as Row;
    const observer = text(game.player_nation_code);
    const regions = new Map(this.listRegions(gameId).map((region) => [region.regionId, region]));
    const friendlyRegions = new Set(
      this.listUnits(gameId)
        .filter((unit) => unit.nationCode === observer)
        .flatMap((unit) => [unit.regionId, ...(regions.get(unit.regionId)?.neighbors ?? [])]),
    );
    const estimatedRegions = new Set(
      [...friendlyRegions].flatMap((regionId) => regions.get(regionId)?.neighbors ?? []),
    );
    const upsert = this.database.prepare(
      `INSERT INTO intel_contacts (
        id, game_id, observer_nation_code, target_unit_id, intel_level,
        estimated_region_id, estimated_strength, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, observer_nation_code, target_unit_id) DO UPDATE SET
        intel_level = excluded.intel_level,
        estimated_region_id = excluded.estimated_region_id,
        estimated_strength = excluded.estimated_strength,
        observed_at = excluded.observed_at`,
    );
    for (const unit of this.listUnits(gameId).filter(
      (candidate) => candidate.nationCode !== observer,
    )) {
      const level = friendlyRegions.has(unit.regionId)
        ? 'exact'
        : estimatedRegions.has(unit.regionId)
          ? 'estimated'
          : 'unknown';
      const estimatedRegionId =
        level === 'exact'
          ? unit.regionId
          : level === 'estimated'
            ? (regions
                .get(unit.regionId)
                ?.neighbors.find((regionId) => regionId !== unit.regionId) ?? null)
            : null;
      upsert.run(
        randomUUID(),
        gameId,
        observer,
        unit.id,
        level,
        estimatedRegionId,
        level === 'exact'
          ? unit.strength
          : level === 'estimated'
            ? Math.round(unit.strength / 20) * 20
            : null,
        `${observedDate}T12:00:00.000Z`,
      );
    }
  }

  private unitsForObserver(gameId: string, contacts: IntelContact[]): StrategicUnit[] {
    const observerRow = this.database
      .prepare('SELECT player_nation_code FROM games WHERE id = ?')
      .get(gameId) as Row;
    const observer = text(observerRow.player_nation_code);
    const contactByUnit = new Map(contacts.map((contact) => [contact.targetUnitId, contact]));
    const visible: StrategicUnit[] = [];
    for (const unit of this.listUnits(gameId)) {
      if (unit.nationCode === observer) {
        visible.push({ ...unit, intelLevel: 'exact' });
        continue;
      }
      const contact = contactByUnit.get(unit.id);
      if (!contact || contact.level === 'unknown' || !contact.estimatedRegionId) continue;
      if (contact.level === 'exact') {
        visible.push({ ...unit, intelLevel: 'exact' });
        continue;
      }
      const centroid = this.regionCoordinates(contact.estimatedRegionId, unit.centroid);
      visible.push({
        ...unit,
        regionId: contact.estimatedRegionId,
        centroid,
        strength: contact.estimatedStrength ?? Math.round(unit.strength / 20) * 20,
        manpower: 0,
        equipment: 0,
        organization: 0,
        morale: 0,
        fuel: 0,
        supply: 0,
        intelLevel: 'estimated',
      });
    }
    return visible;
  }

  private resolveLocation(
    gameId: string,
    location: GameEvent['map_cue']['locations'][number] | undefined,
  ): { regionId: string | null; coordinates: [number, number] } | null {
    if (!location) return null;
    if (location.kind === 'coordinates')
      return { regionId: null, coordinates: location.coordinates };
    if (location.kind === 'region') {
      const city = this.catalog.cities.find(
        (candidate) => candidate.region_id === location.region_id,
      );
      return { regionId: location.region_id, coordinates: city?.coords ?? [700, 300] };
    }
    if (location.kind === 'feature') {
      const row = this.database
        .prepare(
          'SELECT region_id, coords_x, coords_y FROM map_features WHERE game_id = ? AND id = ?',
        )
        .get(gameId, location.feature_id) as Row | undefined;
      return row
        ? {
            regionId: text(row.region_id),
            coordinates: [number(row.coords_x), number(row.coords_y)],
          }
        : null;
    }
    if (location.kind === 'unit') {
      const unit = this.listUnits(gameId).find((candidate) => candidate.id === location.unit_id);
      return unit ? { regionId: unit.regionId, coordinates: unit.centroid } : null;
    }
    if (location.kind === 'nation') {
      const city = this.catalog.cities.find(
        (candidate) =>
          candidate.nation_code === location.nation_code && candidate.type === 'capital',
      );
      return city ? { regionId: city.region_id, coordinates: city.coords } : null;
    }
    return null;
  }

  private appendTimeline(
    gameId: string,
    gameDate: string,
    turnNumber: number,
    entry: Omit<
      TimelineEntry,
      'id' | 'gameId' | 'gameDate' | 'turnNumber' | 'sequence' | 'createdAt'
    >,
  ) {
    const row = this.database
      .prepare(
        'SELECT COALESCE(MAX(sequence), -1) AS sequence FROM timeline_entries WHERE game_id = ? AND turn_number = ?',
      )
      .get(gameId, turnNumber) as Row;
    const sequence = number(row.sequence) + 1;
    this.database
      .prepare(
        `INSERT INTO timeline_entries (
          id, game_id, game_date, turn_number, sequence, entry_kind, title, description,
          event_id, entity_ids_json, consequences_json, cinematic_cue_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        gameId,
        gameDate,
        turnNumber,
        sequence,
        entry.kind,
        entry.title,
        entry.description,
        entry.eventId,
        JSON.stringify(entry.entityIds),
        JSON.stringify(entry.consequences),
        JSON.stringify(entry.cue),
        new Date().toISOString(),
      );
  }

  private writeRegions(regions: RegionState[]) {
    const update = this.database.prepare(
      `UPDATE region_states SET nation_code = ?, population = ?, displaced_population = ?,
       wounded_population = ?, infrastructure = ?, industrial_capacity = ?, supply = ?,
       health = ?, habitability = ?, contamination = ?, radiation = ?, terrain = ?,
       neighbors_json = ?, updated_at = ? WHERE game_id = ? AND region_id = ?`,
    );
    for (const region of regions) {
      update.run(
        region.nationCode,
        region.population,
        region.displacedPopulation,
        region.woundedPopulation,
        region.infrastructure,
        region.industrialCapacity,
        region.supply,
        region.health,
        region.habitability,
        region.contamination,
        region.radiation,
        region.terrain,
        JSON.stringify(region.neighbors),
        region.updatedAt,
        region.gameId,
        region.regionId,
      );
    }
  }

  private reconcileNationPopulation(gameId: string) {
    this.database
      .prepare(
        `UPDATE nation_states SET population = COALESCE((
          SELECT SUM(region_states.population + region_states.displaced_population)
          FROM region_states
          WHERE region_states.game_id = nation_states.game_id
            AND region_states.nation_code = nation_states.nation_code
        ), population)
        WHERE game_id = ?`,
      )
      .run(gameId);
  }

  private bumpRevision(gameId: string) {
    this.database
      .prepare('UPDATE games SET world_revision = world_revision + 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), gameId);
  }
}
