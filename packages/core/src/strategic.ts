import type {
  ImpactKind,
  RegionState,
  StrategicDomain,
  StrategicUnit,
} from '@what-if-history/contracts';

const clamp = (value: number, minimum = 0, maximum = 100) =>
  Math.max(minimum, Math.min(maximum, value));

export interface PopulationRegionSeed {
  regionId: string;
  nationCode: string | null;
  terrain: RegionState['terrain'];
  neighbors: string[];
  cityWeight: number;
}

export interface NationPopulationSeed {
  nationCode: string;
  population: number;
  industrialCapacity: number;
  health: number;
}

export function distributeRegionalPopulation(
  gameId: string,
  nations: NationPopulationSeed[],
  regions: PopulationRegionSeed[],
  updatedAt: string,
): RegionState[] {
  const nationByCode = new Map(nations.map((nation) => [nation.nationCode, nation]));
  const grouped = new Map<string, PopulationRegionSeed[]>();
  for (const region of regions) {
    if (!region.nationCode || !nationByCode.has(region.nationCode)) continue;
    const list = grouped.get(region.nationCode) ?? [];
    list.push(region);
    grouped.set(region.nationCode, list);
  }
  const populationByRegion = new Map<string, number>();
  for (const [nationCode, siblings] of grouped) {
    const nation = nationByCode.get(nationCode)!;
    const wholePopulation = Math.floor(Math.max(0, nation.population));
    const fractionalPopulation = Math.max(0, nation.population) - wholePopulation;
    const totalWeight = siblings.reduce((total, item) => total + Math.max(1, item.cityWeight), 0);
    const allocations = siblings.map((region) => {
      const exact = (wholePopulation * Math.max(1, region.cityWeight)) / totalWeight;
      return { region, population: Math.floor(exact), fraction: exact - Math.floor(exact) };
    });
    let remainder =
      wholePopulation - allocations.reduce((total, item) => total + item.population, 0);
    allocations.sort(
      (left, right) =>
        right.fraction - left.fraction || left.region.regionId.localeCompare(right.region.regionId),
    );
    for (let index = 0; index < allocations.length && remainder > 0; index += 1, remainder -= 1) {
      allocations[index]!.population += 1;
    }
    if (allocations[0]) allocations[0].population += fractionalPopulation;
    for (const allocation of allocations) {
      populationByRegion.set(allocation.region.regionId, allocation.population);
    }
  }

  return regions.map((region) => {
    const nation = region.nationCode ? nationByCode.get(region.nationCode) : undefined;
    const population = populationByRegion.get(region.regionId) ?? 0;
    const urbanBonus = Math.min(25, Math.max(0, region.cityWeight - 1) * 5);
    return {
      gameId,
      regionId: region.regionId,
      nationCode: region.nationCode,
      population,
      displacedPopulation: 0,
      woundedPopulation: 0,
      infrastructure: clamp(55 + urbanBonus),
      industrialCapacity: clamp((nation?.industrialCapacity ?? 20) + urbanBonus / 2),
      supply: region.terrain === 'ocean' ? 45 : clamp(60 + urbanBonus),
      health: nation?.health ?? 50,
      habitability: region.terrain === 'ocean' ? 0 : 100,
      contamination: 0,
      radiation: 0,
      terrain: region.terrain,
      neighbors: [...new Set(region.neighbors)],
      updatedAt,
    };
  });
}

export interface RegionalImpactInput {
  kind: ImpactKind;
  intensity: number;
  targetRegionId: string;
}

export interface RegionalImpactResult {
  regions: RegionState[];
  deaths: number;
  wounded: number;
  displaced: number;
  affectedRegionIds: string[];
}

const impactFactors: Record<
  ImpactKind,
  {
    fatality: number;
    wounded: number;
    displaced: number;
    infrastructure: number;
    habitability: number;
    contamination: number;
    radiation: number;
  }
> = {
  conventional_strike: {
    fatality: 0.08,
    wounded: 0.16,
    displaced: 0.22,
    infrastructure: 0.55,
    habitability: 0.18,
    contamination: 0.04,
    radiation: 0,
  },
  nuclear_strike: {
    fatality: 0.52,
    wounded: 0.28,
    displaced: 0.7,
    infrastructure: 0.95,
    habitability: 0.95,
    contamination: 0.92,
    radiation: 1,
  },
  fire: {
    fatality: 0.03,
    wounded: 0.1,
    displaced: 0.3,
    infrastructure: 0.4,
    habitability: 0.25,
    contamination: 0.08,
    radiation: 0,
  },
  epidemic: {
    fatality: 0.12,
    wounded: 0.35,
    displaced: 0.04,
    infrastructure: 0.03,
    habitability: 0.1,
    contamination: 0.45,
    radiation: 0,
  },
  famine: {
    fatality: 0.1,
    wounded: 0.22,
    displaced: 0.3,
    infrastructure: 0.12,
    habitability: 0.18,
    contamination: 0.08,
    radiation: 0,
  },
  natural_disaster: {
    fatality: 0.1,
    wounded: 0.18,
    displaced: 0.42,
    infrastructure: 0.7,
    habitability: 0.45,
    contamination: 0.15,
    radiation: 0,
  },
  industrial_disaster: {
    fatality: 0.06,
    wounded: 0.2,
    displaced: 0.2,
    infrastructure: 0.55,
    habitability: 0.35,
    contamination: 0.7,
    radiation: 0.08,
  },
};

export function applyRegionalImpact(
  originalRegions: RegionState[],
  input: RegionalImpactInput,
  updatedAt: string,
): RegionalImpactResult {
  const intensity = clamp(input.intensity) / 100;
  const factors = impactFactors[input.kind];
  let deaths = 0;
  let wounded = 0;
  let displaced = 0;
  const affectedRegionIds: string[] = [];
  const targetRegion = originalRegions.find((region) => region.regionId === input.targetRegionId);
  const regions = originalRegions.map((original) => {
    const primary = original.regionId === input.targetRegionId;
    const falloutNeighbor =
      input.kind === 'nuclear_strike' &&
      (original.neighbors.includes(input.targetRegionId) ||
        (targetRegion?.neighbors.includes(original.regionId) ?? false));
    if (!primary && !falloutNeighbor) return structuredClone(original);
    const exposure = primary ? intensity : intensity * 0.22;
    if (exposure <= 0) return structuredClone(original);
    affectedRegionIds.push(original.regionId);
    const region = structuredClone(original);
    const regionalDeaths = Math.min(
      region.population,
      region.population * factors.fatality * exposure,
    );
    const survivors = Math.max(0, region.population - regionalDeaths);
    const regionalWounded = Math.min(survivors, survivors * factors.wounded * exposure);
    const regionalDisplaced = Math.min(
      Math.max(0, survivors - regionalWounded),
      survivors * factors.displaced * exposure,
    );
    region.population = Math.max(0, survivors - regionalDisplaced);
    region.woundedPopulation += regionalWounded;
    region.displacedPopulation += regionalDisplaced;
    region.infrastructure = clamp(region.infrastructure - factors.infrastructure * exposure * 100);
    region.industrialCapacity = clamp(
      region.industrialCapacity - factors.infrastructure * exposure * 80,
    );
    region.supply = clamp(region.supply - factors.infrastructure * exposure * 90);
    region.health = clamp(region.health - factors.wounded * exposure * 80);
    region.habitability = clamp(region.habitability - factors.habitability * exposure * 100);
    region.contamination = clamp(region.contamination + factors.contamination * exposure * 100);
    region.radiation = clamp(region.radiation + factors.radiation * exposure * 100);
    region.updatedAt = updatedAt;
    deaths += regionalDeaths;
    wounded += regionalWounded;
    displaced += regionalDisplaced;
    return region;
  });
  return { regions, deaths, wounded, displaced, affectedRegionIds };
}

export function evolveRegionalRecovery(
  original: RegionState,
  days: number,
  updatedAt: string,
): RegionState {
  const region = structuredClone(original);
  if (days <= 0) return region;
  region.radiation = clamp(region.radiation * Math.exp(-days / 730));
  region.contamination = clamp(region.contamination - days * 0.025);
  const safeEnough = region.radiation < 20 && region.contamination < 30;
  if (safeEnough) {
    region.habitability = clamp(region.habitability + days * 0.018);
    region.infrastructure = clamp(region.infrastructure + days * 0.012);
    region.supply = clamp(region.supply + days * 0.016);
    region.health = clamp(region.health + days * 0.01);
    const returnees = Math.min(
      region.displacedPopulation,
      region.displacedPopulation * days * 0.0008,
    );
    region.displacedPopulation -= returnees;
    region.population += returnees;
  }
  region.woundedPopulation = Math.max(0, region.woundedPopulation * Math.exp(-days / 180));
  region.updatedAt = updatedAt;
  return region;
}

const terrainCost: Record<RegionState['terrain'], number> = {
  plains: 1,
  forest: 1.35,
  mountain: 1.8,
  desert: 1.5,
  urban: 1.2,
  coastal: 1.15,
  ocean: 1,
};

function domainCanEnter(domain: StrategicDomain, terrain: RegionState['terrain']) {
  if (domain === 'air') return true;
  if (domain === 'naval') return terrain === 'ocean' || terrain === 'coastal';
  return terrain !== 'ocean';
}

export function findStrategicRoute(
  regions: RegionState[],
  originRegionId: string,
  destinationRegionId: string,
  domain: StrategicDomain,
): string[] | null {
  if (originRegionId === destinationRegionId) return [originRegionId];
  const byId = new Map(regions.map((region) => [region.regionId, region]));
  const origin = byId.get(originRegionId);
  const destination = byId.get(destinationRegionId);
  if (!origin || !destination || !domainCanEnter(domain, destination.terrain)) return null;
  if (domain === 'air') return [originRegionId, destinationRegionId];
  const queue = [originRegionId];
  const previous = new Map<string, string | null>([[originRegionId, null]]);
  while (queue.length) {
    const currentId = queue.shift()!;
    const current = byId.get(currentId);
    if (!current) continue;
    const candidates = [...current.neighbors].sort(
      (left, right) =>
        terrainCost[byId.get(left)?.terrain ?? 'mountain'] -
        terrainCost[byId.get(right)?.terrain ?? 'mountain'],
    );
    for (const neighborId of candidates) {
      const neighbor = byId.get(neighborId);
      if (!neighbor || previous.has(neighborId) || !domainCanEnter(domain, neighbor.terrain))
        continue;
      previous.set(neighborId, currentId);
      if (neighborId === destinationRegionId) {
        const route = [neighborId];
        let cursor: string | null = currentId;
        while (cursor) {
          route.unshift(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return route;
      }
      queue.push(neighborId);
    }
  }
  return null;
}

export function estimateMovementDuration(
  route: string[],
  regions: RegionState[],
  unit: StrategicUnit,
): { durationDays: number; fuelCost: number; supplyRisk: 'low' | 'moderate' | 'high' | 'blocked' } {
  const byId = new Map(regions.map((region) => [region.regionId, region]));
  const distanceCost = route
    .slice(1)
    .reduce((total, id) => total + terrainCost[byId.get(id)?.terrain ?? 'plains'], 0);
  const speed =
    unit.domain === 'air'
      ? 4
      : unit.domain === 'naval'
        ? 1.6
        : unit.unitType === 'armor'
          ? 1.35
          : 1;
  const durationDays = Math.max(1, Math.ceil((distanceCost * 3) / speed));
  const fuelCost = clamp(
    distanceCost * (unit.domain === 'air' ? 7 : unit.unitType === 'armor' ? 5 : 2),
    0,
    100,
  );
  const minimumSupply = Math.min(...route.map((id) => byId.get(id)?.supply ?? 0));
  const supplyRisk =
    minimumSupply <= 0
      ? 'blocked'
      : minimumSupply < 25
        ? 'high'
        : minimumSupply < 50
          ? 'moderate'
          : 'low';
  return { durationDays, fuelCost, supplyRisk };
}

const seededFraction = (seed: string) => {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

export function resolveStrategicCombat(
  attacker: StrategicUnit,
  defender: StrategicUnit,
  region: RegionState,
  seed: string,
) {
  const attackPower =
    attacker.strength *
    (attacker.organization / 100) *
    (attacker.morale / 100) *
    (attacker.supply / 100) *
    (0.9 + seededFraction(`${seed}:a`) * 0.2);
  const terrainDefense =
    region.terrain === 'mountain' ? 1.35 : region.terrain === 'urban' ? 1.25 : 1;
  const defensePower =
    defender.strength *
    (defender.organization / 100) *
    (defender.morale / 100) *
    (defender.supply / 100) *
    terrainDefense *
    (0.9 + seededFraction(`${seed}:d`) * 0.2);
  const total = Math.max(1, attackPower + defensePower);
  const attackerLoss = clamp((defensePower / total) * 22, 2, 35);
  const defenderLoss = clamp((attackPower / total) * 25, 2, 40);
  return {
    attackerStrength: clamp(attacker.strength - attackerLoss),
    defenderStrength: clamp(defender.strength - defenderLoss),
    attackerManpower: Math.max(0, attacker.manpower * (1 - attackerLoss / 120)),
    defenderManpower: Math.max(0, defender.manpower * (1 - defenderLoss / 110)),
    attackerWon: attackPower > defensePower * 1.08,
    attackerLoss,
    defenderLoss,
  };
}
