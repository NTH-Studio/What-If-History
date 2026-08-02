import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import request from 'supertest';
import { openDatabase } from './db/database.js';
import { createApp } from './app.js';

describe('API v1', () => {
  let context: ReturnType<typeof createApp>;

  beforeEach(() => {
    const database = openDatabase(':memory:');
    context = createApp({ database });
    context.repository.saveLlmSettings({
      provider: 'fake',
      apiUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'secret-test-key',
      model: 'deterministic',
      clearApiKey: false,
    });
  });

  afterEach(() => {
    context.database.close();
  });

  it('simulates and persists the first campaign day during launch', async () => {
    const launched = await request(context.app)
      .post('/api/v1/games/start')
      .set('x-what-if-history-language', 'fr')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);

    expect(launched.body).toMatchObject({
      id: expect.any(String),
      currentDate: '1936-01-02',
      turnNumber: 2,
      game: {
        currentDate: '1936-01-02',
        turnNumber: 2,
        eventCount: 1,
        worldRevision: 1,
      },
      openingTurn: {
        previousDate: '1936-01-01',
        newDate: '1936-01-02',
        turnNumber: 2,
        events: [
          expect.objectContaining({
            gameDate: '1936-01-02',
            title: 'Situation stratégique actualisée',
          }),
        ],
      },
    });
    expect(launched.body.id).toBe(launched.body.game.id);
    expect(context.repository.listEvents(launched.body.game.id)).toContainEqual(
      expect.objectContaining({
        gameDate: '1936-01-02',
        turnNumber: 1,
        title: 'Situation stratégique actualisée',
      }),
    );
    expect(
      context.repository.listLlmCalls({ gameId: launched.body.game.id, limit: 10 }),
    ).toContainEqual(expect.objectContaining({ type: 'turn_generation', status: 'succeeded' }));
  });

  it('does not keep an incomplete campaign when the opening AI simulation fails', async () => {
    context.repository.saveLlmSettings({
      provider: 'openai',
      apiUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'unreachable-test-key',
      model: 'unreachable-opening-turn',
      clearApiKey: false,
    });

    await request(context.app)
      .post('/api/v1/games/start')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(502)
      .expect(({ body }) => expect(body.code).toBe('LLM_UNREACHABLE'));

    await request(context.app)
      .get('/api/v1/games')
      .expect(200)
      .expect(({ body }) => expect(body).toEqual([]));
  });

  it('serves complete estimated profiles for every country without internal catalog fields', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);

    const countries = await request(context.app)
      .get(`/api/v1/games/${created.body.id}/countries`)
      .expect(200);
    expect(countries.body).toHaveLength(78);
    expect(countries.body).toContainEqual(
      expect.objectContaining({
        code: 'FRA',
        name: 'République française',
        capital: 'Paris',
        activeLawCount: 2,
        indicators: expect.objectContaining({
          population: 42_250_000,
          gdp: expect.any(Number),
          gdpPerCapita: 1_800,
          happiness: 64,
        }),
      }),
    );

    const profile = await request(context.app)
      .get(`/api/v1/games/${created.body.id}/countries/FRA`)
      .set('x-what-if-history-language', 'fr')
      .expect(200);
    expect(profile.body).toMatchObject({
      code: 'FRA',
      dataQuality: 'historical',
      baselineDate: '1936-01-01',
    });
    expect(profile.body.laws).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Gouvernement constitutionnel',
          status: 'active',
          source: 'historical',
        }),
      ]),
    );

    const catalog = await request(context.app).get('/api/v1/catalog/nations').expect(200);
    expect(catalog.body).toHaveLength(78);
    expect(catalog.body).toContainEqual(
      expect.objectContaining({ code: 'DNZ', name: 'Ville libre de Dantzig', capital: 'Dantzig' }),
    );
    expect(catalog.text).not.toContain('filePath');
    expect(catalog.text).not.toContain('C:\\\\Users');

    const englishCatalog = await request(context.app)
      .get('/api/v1/catalog/nations')
      .set('x-what-if-history-language', 'en')
      .expect(200);
    expect(englishCatalog.body).toContainEqual(
      expect.objectContaining({
        code: 'DNZ',
        name: 'Free City of Danzig',
        capital: 'Danzig',
      }),
    );

    const frenchCities = await request(context.app).get('/api/v1/map/cities').expect(200);
    expect(frenchCities.body).toContainEqual(
      expect.objectContaining({ id: 'london', name: 'Londres' }),
    );
    expect(frenchCities.body).toContainEqual(
      expect.objectContaining({ id: 'cape_town', name: 'Le Cap' }),
    );

    const englishCities = await request(context.app)
      .get('/api/v1/map/cities')
      .set('x-what-if-history-language', 'en')
      .expect(200);
    expect(englishCities.body).toContainEqual(
      expect.objectContaining({ id: 'london', name: 'London' }),
    );
  });

  it('creates a coherent dated French campaign in 2000', async () => {
    const recentPreview = await request(context.app)
      .get('/api/v1/catalog/historical-world?date=2025-01-01')
      .set('x-what-if-history-language', 'fr')
      .expect(200);
    expect(recentPreview.body).toMatchObject({
      coverageStart: '1870-01-01',
      coverageEnd: '2026-07-31',
    });
    expect(
      recentPreview.body.nations.find((nation: { code: string }) => nation.code === 'FRA'),
    ).toMatchObject({
      officeHolders: [expect.objectContaining({ name: 'Emmanuel Macron', role: 'head_of_state' })],
    });

    const preview = await request(context.app)
      .get('/api/v1/catalog/historical-world?date=2000-01-01')
      .set('x-what-if-history-language', 'fr')
      .expect(200);
    const previewFrance = preview.body.nations.find(
      (nation: { code: string }) => nation.code === 'FRA',
    );
    expect(previewFrance).toMatchObject({
      name: 'République française',
      capital: 'Paris',
      officeHolders: [
        expect.objectContaining({ name: 'Jacques Chirac', role: 'head_of_state' }),
        expect.objectContaining({ name: 'Lionel Jospin', role: 'head_of_government' }),
      ],
    });
    expect(preview.body.nations.some((nation: { code: string }) => nation.code === 'SOV')).toBe(
      false,
    );
    expect(preview.body.nations.some((nation: { code: string }) => nation.code === 'RUS')).toBe(
      true,
    );

    const created = await request(context.app)
      .post('/api/v1/games')
      .set('x-what-if-history-language', 'fr')
      .send({ nationCode: 'FRA', startDate: '2000-01-01' })
      .expect(201);
    expect(created.body.playerNation).toMatchObject({
      code: 'FRA',
      name: 'République française',
      leader_name: 'Jacques Chirac',
    });

    const profile = await request(context.app)
      .get(`/api/v1/games/${created.body.id}/countries/FRA`)
      .set('x-what-if-history-language', 'fr')
      .expect(200);
    expect(profile.body).toMatchObject({
      leaderName: 'Jacques Chirac',
      baselineDate: '2000-01-01',
      dataQuality: 'historical',
      indicators: { population: 60_912_500 },
    });
    expect(profile.body.officeHolders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Jacques Chirac' }),
        expect.objectContaining({ name: 'Lionel Jospin' }),
      ]),
    );

    const regions = await request(context.app)
      .get(`/api/v1/games/${created.body.id}/world/regions`)
      .expect(200);
    expect(regions.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ regionId: 'Moscow', ownerNationCode: 'RUS' }),
        expect.objectContaining({ regionId: 'Kyiv', ownerNationCode: 'UKR' }),
        expect.objectContaining({ regionId: 'Western_Slovakia', ownerNationCode: 'SVK' }),
      ]),
    );

    const strategic = await request(context.app)
      .get(`/api/v1/games/${created.body.id}/strategic-state`)
      .expect(200);
    expect(strategic.body.characters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Jacques Chirac', iconKey: 'leader' }),
        expect.objectContaining({ name: 'Lionel Jospin' }),
      ]),
    );
    expect(
      strategic.body.characters.some((character: { name: string }) =>
        character.name.includes('Albert Lebrun'),
      ),
    ).toBe(false);
    expect(strategic.body.units).toEqual([
      expect.objectContaining({ nationCode: 'FRA', name: 'Brigade interarmes' }),
    ]);

    const arsenalRows = context.database
      .prepare(
        `SELECT nation_code, nuclear_stockpile FROM strategic_arsenals
         WHERE game_id = ? AND nation_code IN ('RUS', 'SOV') ORDER BY nation_code`,
      )
      .all(created.body.id);
    expect(arsenalRows).toEqual([{ nation_code: 'RUS', nuclear_stockpile: 6000 }]);
    const regionalPopulation = context.database
      .prepare(
        `SELECT ROUND(SUM(population)) AS population FROM region_states
         WHERE game_id = ? AND nation_code = 'FRA'`,
      )
      .get(created.body.id) as { population: number };
    expect(regionalPopulation.population).toBe(60_912_500);
  });

  it('rejects a new historical campaign outside the documented coverage', async () => {
    const rejected = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1869-12-31' })
      .expect(422);
    expect(rejected.body).toMatchObject({ code: 'HISTORICAL_DATE_OUT_OF_RANGE' });
  });

  it('persists Gibraltar as a claimed British Overseas Territory in 2020', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '2020-01-01' })
      .expect(201);
    const regions = await request(context.app)
      .get(`/api/v1/games/${created.body.id}/world/regions`)
      .expect(200);

    expect(
      regions.body.find((region: { regionId: string }) => region.regionId === 'Gibraltar'),
    ).toMatchObject({
      ownerNationCode: 'ENG',
      controllerNationCode: 'ENG',
      territorialStatus: 'overseas_territory',
      administeringNationCode: 'ENG',
      claimNationCodes: ['SPR'],
    });
  });

  it('applies the dated Gibraltar status transition without changing sovereignty', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '2002-02-25' })
      .expect(201);

    await request(context.app)
      .post(`/api/v1/games/${created.body.id}/turns`)
      .send({ amount: 1, unit: 'day' })
      .expect(201);

    const regions = await request(context.app)
      .get(`/api/v1/games/${created.body.id}/world/regions`)
      .expect(200);
    expect(
      regions.body.find((region: { regionId: string }) => region.regionId === 'Gibraltar'),
    ).toMatchObject({
      ownerNationCode: 'ENG',
      territorialStatus: 'overseas_territory',
      administeringNationCode: 'ENG',
      claimNationCodes: ['SPR'],
    });
    expect(
      context.database
        .prepare(
          `SELECT status FROM historical_transition_runs
           WHERE game_id = ? AND transition_id = ?`,
        )
        .get(created.body.id, 'territory-status:2002-02-26:Gibraltar:overseas_territory'),
    ).toEqual({ status: 'applied' });
  });

  it('re-seeds historical laws with the campaign date after a restart', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);

    context.database
      .prepare("DELETE FROM country_laws WHERE game_id = ? AND source = 'historical'")
      .run(created.body.id);

    const restarted = createApp({ database: context.database });
    const laws = restarted.repository.listCountryLaws(created.body.id, 'FRA', 'fr');

    expect(laws).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'historical',
          enactedDate: '1936-01-01',
        }),
      ]),
    );
  });

  it('persists enacted and repealed country laws atomically with a turn', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);
    const gameId = created.body.id as string;
    const initialFrenchLaw = context.repository
      .listCountryLaws(gameId, 'FRA', 'fr')
      .find((law) => law.status === 'active')!;
    const states = new Map(
      context.repository.getNationStates(gameId).map((state) => [state.nationCode, state] as const),
    );

    context.repository.commitTurn(
      gameId,
      1,
      '1936-02-01',
      states,
      [],
      [
        {
          operation: 'repeal',
          nation_code: 'FRA',
          law_id: initialFrenchLaw.id,
        },
        {
          operation: 'enact',
          nation_code: 'GER',
          title_fr: 'Programme industriel',
          title_en: 'Industrial program',
          summary_fr: 'L’industrie lourde reçoit de nouveaux moyens.',
          summary_en: 'Heavy industry receives additional resources.',
          category: 'economy',
        },
      ],
    );

    expect(context.repository.listCountryLaws(gameId, 'FRA', 'fr')).toContainEqual(
      expect.objectContaining({
        id: initialFrenchLaw.id,
        status: 'repealed',
        repealedDate: '1936-02-01',
      }),
    );
    expect(context.repository.listCountryLaws(gameId, 'GER', 'en')).toContainEqual(
      expect.objectContaining({
        title: 'Industrial program',
        status: 'active',
        source: 'simulation',
      }),
    );
  });

  it('creates a game and advances an atomic deterministic turn', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);

    expect(created.body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(created.body.nationStates).toHaveLength(78);
    expect(created.body.scenarioMode).toBe('historical');

    await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions`)
      .send({ actionText: 'Reinforce the eastern frontier.', mode: 'planned' })
      .expect(201);

    const turn = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/turns`)
      .send({ amount: 1, unit: 'month' })
      .expect(201);

    expect(turn.body).toMatchObject({
      previousDate: '1936-01-01',
      newDate: '1936-02-01',
      turnNumber: 2,
      processedActions: 1,
    });
    expect(turn.body.events).toHaveLength(1);
    expect(turn.body.events[0]).toMatchObject({
      title: 'Situation stratégique actualisée',
      description: 'La situation diplomatique et économique évolue sans incident majeur.',
      map_cue: {
        camera: 'auto',
        locations: [{ kind: 'nation', role: 'primary', nation_code: 'FRA' }],
      },
    });

    const actions = await request(context.app)
      .get(`/api/v1/games/${created.body.id}/actions`)
      .expect(200);
    expect(actions.body[0].status).toBe('completed');
  });

  it('exposes a persistent strategic world and keeps movement orders idempotent', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);
    const gameId = created.body.id as string;
    const initial = await request(context.app)
      .get(`/api/v1/games/${gameId}/strategic-state`)
      .expect(200);
    const frenchPopulation = initial.body.regions
      .filter((region: { nationCode: string | null }) => region.nationCode === 'FRA')
      .reduce((total: number, region: { population: number }) => total + region.population, 0);
    const nationalPopulation = created.body.nationStates.find(
      (nation: { nationCode: string }) => nation.nationCode === 'FRA',
    ).population;

    expect(frenchPopulation).toBe(nationalPopulation);
    expect(
      initial.body.regions.find(
        (region: { regionId: string }) => region.regionId === 'Ile_de_France',
      ).neighbors,
    ).toEqual(expect.arrayContaining(['Normandy', 'Champagne']));
    expect(initial.body.characters).toContainEqual(
      expect.objectContaining({ nationCode: 'FRA', status: 'active', iconKey: 'leader' }),
    );
    const actualUnits = new Map(
      context.strategic.listUnits(gameId).map((candidate) => [candidate.id, candidate]),
    );
    for (const contact of initial.body.contacts) {
      const actual = actualUnits.get(contact.targetUnitId)!;
      if (contact.level === 'unknown') {
        expect(contact.estimatedRegionId).toBeNull();
        expect(contact.estimatedStrength).toBeNull();
        expect(
          initial.body.units.some((candidate: { id: string }) => candidate.id === actual.id),
        ).toBe(false);
      }
      if (contact.level === 'estimated') {
        expect(contact.estimatedRegionId).not.toBe(actual.regionId);
      }
    }

    const unit = initial.body.units.find(
      (candidate: { nationCode: string; domain: string }) =>
        candidate.nationCode === 'FRA' && candidate.domain === 'land',
    );
    const destination = initial.body.regions.find(
      (region: { regionId: string; nationCode: string | null; terrain: string }) =>
        region.nationCode === 'FRA' &&
        region.regionId !== unit.regionId &&
        region.terrain !== 'ocean',
    );
    context.database
      .prepare('UPDATE region_states SET neighbors_json = ? WHERE game_id = ? AND region_id = ?')
      .run(JSON.stringify([destination.regionId]), gameId, unit.regionId);
    context.database
      .prepare('UPDATE region_states SET neighbors_json = ? WHERE game_id = ? AND region_id = ?')
      .run(JSON.stringify([unit.regionId]), gameId, destination.regionId);
    const orderInput = {
      unitId: unit.id,
      type: 'move',
      destinationRegionId: destination.regionId,
      directive: 'Rejoindre la position et préserver le ravitaillement.',
      idempotencyKey: '00000000-0000-4000-8000-000000000111',
      expectedWorldRevision: initial.body.worldRevision,
    };

    const preview = await request(context.app)
      .post(`/api/v1/games/${gameId}/orders/preview`)
      .send(orderInput)
      .expect(200);
    expect(preview.body).toMatchObject({
      valid: true,
      route: [unit.regionId, destination.regionId],
    });

    const first = await request(context.app)
      .post(`/api/v1/games/${gameId}/orders`)
      .send(orderInput)
      .expect(201);
    const retried = await request(context.app)
      .post(`/api/v1/games/${gameId}/orders`)
      .send(orderInput)
      .expect(201);
    expect(retried.body.id).toBe(first.body.id);
    expect(
      context.database
        .prepare('SELECT COUNT(*) AS count FROM strategic_orders WHERE game_id = ?')
        .get(gameId),
    ).toEqual({ count: 1 });

    await request(context.app)
      .post(`/api/v1/games/${gameId}/turns`)
      .send({ amount: 1, unit: 'year' })
      .expect(201);
    const after = await request(context.app)
      .get(`/api/v1/games/${gameId}/strategic-state`)
      .expect(200);
    expect(after.body.orders[0]).toMatchObject({ status: 'completed', progress: 1 });
    expect(
      after.body.units.find((candidate: { id: string }) => candidate.id === unit.id),
    ).toMatchObject({ regionId: destination.regionId, mission: 'idle' });
    const timeline = await request(context.app).get(`/api/v1/games/${gameId}/timeline`).expect(200);
    expect(timeline.body.map((entry: { kind: string }) => entry.kind)).toEqual(
      expect.arrayContaining(['movement_started', 'arrival']),
    );
  });

  it('keeps durable characters stable across repeated mentions and later updates', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);
    const gameId = created.body.id as string;
    const change = {
      operation: 'create' as const,
      name: 'Jeanne Mercier',
      role: 'Envoyee speciale',
      nation_code: 'FRA',
      loyalty_nation_code: 'FRA',
      region_id: 'Ile_de_France',
    };

    context.strategic.applyCharacterChanges(gameId, [change], '1936-01-02', 2);
    const first = context.strategic
      .listCharacters(gameId)
      .find((character) => character.name === change.name)!;
    context.strategic.applyCharacterChanges(gameId, [change], '1936-01-03', 3);
    context.strategic.applyCharacterChanges(
      gameId,
      [
        {
          operation: 'update',
          character_id: first.id,
          status: 'wounded',
          region_id: 'Normandy',
        },
      ],
      '1936-01-04',
      4,
    );

    const matches = context.strategic
      .listCharacters(gameId)
      .filter((character) => character.name === change.name);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      id: first.id,
      iconKey: 'diplomat',
      status: 'wounded',
      regionId: 'Normandy',
    });
    expect(matches[0]!.history).toHaveLength(3);
  });

  it('applies an exact historical succession once and respects local divergence', async () => {
    const historical = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '2007-05-15' })
      .expect(201);
    const historicalId = historical.body.id as string;

    context.strategic.advanceDailySimulation(historicalId, '2007-05-15', '2007-05-16', 2);
    context.strategic.advanceDailySimulation(historicalId, '2007-05-15', '2007-05-16', 2);

    const appliedOffice = context.database
      .prepare(
        `SELECT holder_id, holder_name FROM game_office_holders
         WHERE game_id = ? AND office_key = 'FRA:head_of_state'`,
      )
      .get(historicalId) as { holder_id: string; holder_name: string };
    expect(appliedOffice).toEqual({
      holder_id: 'fra-hos-sarkozy',
      holder_name: 'Nicolas Sarkozy',
    });
    const appliedRuns = context.database
      .prepare(
        `SELECT status FROM historical_transition_runs
         WHERE game_id = ? AND transition_id = 'office:fra-hos-sarkozy'`,
      )
      .all(historicalId) as Array<{ status: string }>;
    expect(appliedRuns).toEqual([{ status: 'applied' }]);
    expect(
      context.strategic
        .listTimeline(historicalId)
        .filter((entry) => entry.title.includes('Nicolas Sarkozy')),
    ).toHaveLength(1);

    const divergent = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '2007-05-15' })
      .expect(201);
    const divergentId = divergent.body.id as string;
    context.database
      .prepare(
        `UPDATE historical_continuity SET continuity_status = 'diverged',
         diverged_at = '2007-05-15', reason = 'Player removed the president'
         WHERE game_id = ? AND entity_type = 'office' AND entity_id = 'FRA:head_of_state'`,
      )
      .run(divergentId);

    context.strategic.advanceDailySimulation(divergentId, '2007-05-15', '2007-05-16', 2);

    const preservedOffice = context.database
      .prepare(
        `SELECT holder_id FROM game_office_holders
         WHERE game_id = ? AND office_key = 'FRA:head_of_state'`,
      )
      .get(divergentId) as { holder_id: string };
    expect(preservedOffice.holder_id).toBe('fra-hos-chirac');
    const skippedRun = context.database
      .prepare(
        `SELECT status FROM historical_transition_runs
         WHERE game_id = ? AND transition_id = 'office:fra-hos-sarkozy'`,
      )
      .get(divergentId) as { status: string };
    expect(skippedRun.status).toBe('skipped_divergence');

    const reunification = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'GER', startDate: '1990-10-02' })
      .expect(201);
    const reunificationId = reunification.body.id as string;
    context.database
      .prepare(
        `UPDATE game_regions SET owner_nation_code = 'FRA', controller_nation_code = 'FRA'
         WHERE game_id = ? AND region_id = 'Brandenburg'`,
      )
      .run(reunificationId);
    context.database
      .prepare(
        `UPDATE region_states SET nation_code = 'FRA'
         WHERE game_id = ? AND region_id = 'Brandenburg'`,
      )
      .run(reunificationId);
    context.database
      .prepare(
        `UPDATE historical_continuity SET continuity_status = 'diverged',
         diverged_at = '1990-10-02', reason = 'Custom territorial override'
         WHERE game_id = ? AND entity_type = 'region' AND entity_id = 'Brandenburg'`,
      )
      .run(reunificationId);

    context.strategic.advanceDailySimulation(reunificationId, '1990-10-02', '1990-10-03', 2);

    const reunitedRegions = new Map(
      context.strategic
        .listRegions(reunificationId)
        .map((region) => [region.regionId, region.nationCode]),
    );
    expect(reunitedRegions.get('Brandenburg')).toBe('FRA');
    expect(reunitedRegions.get('Mecklenburg')).toBe('GER');
  });

  it('degrades an isolated unit when its regional supply line is cut', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);
    const gameId = created.body.id as string;
    const unit = context.strategic
      .listUnits(gameId)
      .find((candidate) => candidate.nationCode === 'FRA' && candidate.domain === 'land')!;
    context.database
      .prepare('UPDATE region_states SET supply = 0 WHERE game_id = ? AND region_id = ?')
      .run(gameId, unit.regionId);
    const before = context.strategic
      .listUnits(gameId)
      .find((candidate) => candidate.id === unit.id)!;

    context.strategic.advanceDailySimulation(gameId, '1936-01-01', '1936-01-08', 2);

    const after = context.strategic
      .listUnits(gameId)
      .find((candidate) => candidate.id === unit.id)!;
    expect(after.supply).toBeLessThan(before.supply);
    expect(after.organization).toBeLessThan(before.organization);
    expect(after.morale).toBeLessThan(before.morale);
  });

  it('creates a battle instead of a fictitious arrival when an attack is intercepted', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);
    const gameId = created.body.id as string;
    const state = context.strategic.getState(gameId);
    const attacker = context.strategic
      .listUnits(gameId)
      .find((unit) => unit.nationCode === 'FRA' && unit.domain === 'land')!;
    const defender = context.strategic
      .listUnits(gameId)
      .find((unit) => unit.nationCode === 'GER' && unit.domain === 'land')!;
    context.database
      .prepare('UPDATE region_states SET neighbors_json = ? WHERE game_id = ? AND region_id = ?')
      .run(JSON.stringify([defender.regionId]), gameId, attacker.regionId);
    context.database
      .prepare('UPDATE region_states SET neighbors_json = ? WHERE game_id = ? AND region_id = ?')
      .run(JSON.stringify([attacker.regionId]), gameId, defender.regionId);
    context.database
      .prepare('UPDATE units SET strength = 8, manpower = 800, organization = 20 WHERE id = ?')
      .run(attacker.id);
    context.database
      .prepare('UPDATE units SET strength = 100, manpower = 25000, organization = 100 WHERE id = ?')
      .run(defender.id);

    const order = await request(context.app)
      .post(`/api/v1/games/${gameId}/orders`)
      .send({
        unitId: attacker.id,
        type: 'attack',
        destinationRegionId: defender.regionId,
        directive: 'Tester les defenses puis rompre le contact.',
        idempotencyKey: '00000000-0000-4000-8000-000000000333',
        expectedWorldRevision: state.worldRevision,
      })
      .expect(201);

    context.strategic.advanceDailySimulation(gameId, '1936-01-01', '1937-01-01', 2);

    const completed = context.strategic
      .listOrders(gameId)
      .find((candidate) => candidate.id === order.body.id)!;
    const attackerAfter = context.strategic
      .listUnits(gameId)
      .find((candidate) => candidate.id === attacker.id)!;
    const entries = context.strategic
      .listTimeline(gameId)
      .filter((entry) => entry.entityIds.includes(order.body.id));
    expect(completed.status).toBe('intercepted');
    expect(attackerAfter.regionId).toBe(attacker.regionId);
    expect(entries.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['movement_started', 'interception', 'battle']),
    );
    expect(entries.some((entry) => entry.kind === 'arrival')).toBe(false);
  });

  it('applies a structured nuclear strike to regional and national population exactly once', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'USA', startDate: '1964-01-01' })
      .expect(201);
    const gameId = created.body.id as string;
    const before = context.strategic.getState(gameId);
    const target = before.regions
      .filter((region) => region.nationCode === 'ENG')
      .sort((left, right) => right.population - left.population)[0]!;
    const nationalBefore = context.repository
      .getNationStates(gameId)
      .find((nation) => nation.nationCode === 'ENG')!.population;
    const event = {
      id: '00000000-0000-4000-8000-000000000222',
      gameId,
      title: 'Frappe nucléaire sur Londres',
      description: 'Une arme nucléaire explose sur la capitale britannique.',
      event_type: 'military' as const,
      severity: 'critical' as const,
      affected_nations: ['USA', 'ENG'],
      state_changes: {},
      map_cue: {
        camera: 'auto' as const,
        locations: [
          { kind: 'region' as const, role: 'primary' as const, region_id: target.regionId },
        ],
      },
      subtype: 'nuclear_strike',
      icon_key: 'nuclear_strike',
      strategic_effect: {
        kind: 'nuclear_strike' as const,
        intensity: 100,
        target_region_id: target.regionId,
        source_nation_code: 'USA',
        vector: 'ballistic_missile' as const,
        editor_override: false,
      },
      gameDate: '1964-01-02',
      createdAt: '1964-01-02T00:00:00.000Z',
      turnNumber: 2,
    };

    context.database
      .prepare(
        `INSERT INTO events (
          id, game_id, title, description, event_type, severity, affected_nations,
          state_changes, map_cue, subtype, icon_key, strategic_effect,
          game_date, created_at, turn_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        gameId,
        event.title,
        event.description,
        event.event_type,
        event.severity,
        JSON.stringify(event.affected_nations),
        '{}',
        JSON.stringify(event.map_cue),
        event.subtype,
        event.icon_key,
        JSON.stringify(event.strategic_effect),
        event.gameDate,
        event.createdAt,
        event.turnNumber,
      );
    context.strategic.appendEventTimeline(gameId, event);
    const after = context.strategic.getState(gameId);
    const changedTarget = after.regions.find((region) => region.regionId === target.regionId)!;
    const nationalAfter = context.repository
      .getNationStates(gameId)
      .find((nation) => nation.nationCode === 'ENG')!.population;

    expect(changedTarget.population).toBeLessThan(target.population);
    expect(changedTarget.habitability).toBeLessThan(20);
    expect(changedTarget.radiation).toBe(100);
    expect(nationalAfter).toBeLessThan(nationalBefore);
    expect(after.impactZones).toContainEqual(
      expect.objectContaining({ kind: 'nuclear_strike', sourceEventId: event.id, active: true }),
    );
    expect(context.strategic.listTimeline(gameId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: event.id, kind: 'impact' }),
        expect.objectContaining({
          eventId: event.id,
          consequences: expect.objectContaining({ uninhabitable: true }),
        }),
      ]),
    );

    context.strategic.listTimeline(gameId);
    expect(
      context.strategic
        .getState(gameId)
        .regions.find((region) => region.regionId === target.regionId)?.population,
    ).toBe(changedTarget.population);

    const narrativeOnlyEvent = { ...event, strategic_effect: undefined };
    expect(() =>
      context.strategic.appendEventTimeline(gameId, {
        ...narrativeOnlyEvent,
        id: '00000000-0000-4000-8000-000000000223',
      }),
    ).toThrowError(/cible, un vecteur et des effets structurés/);
  });

  it('uses the requested date in a historical campaign context', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '2000-01-01' })
      .expect(201);

    expect(created.body).toMatchObject({
      currentDate: '2000-01-01',
      scenarioMode: 'historical',
    });
    expect(created.body.worldContext).toContain('2000-01-01');
    expect(created.body.worldContext).not.toContain('1936');
  });

  it('queues a planned attempt without calling AI validation', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '2000-01-01' })
      .expect(201);

    const action = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions`)
      .set('x-what-if-history-language', 'fr')
      .send({ actionText: 'FORCE_REJECT_FOR_TEST', mode: 'planned' })
      .expect(201);

    expect(action.body).toMatchObject({
      status: 'pending',
      mode: 'planned',
      effectStatus: 'resolved',
    });
    expect(action.body.aiResponse).toContain('La simulation décidera de sa réussite');
    expect(context.repository.listLlmCalls({ gameId: created.body.id, limit: 10 })).toHaveLength(0);
  });

  it('previews and applies an imposed Paris cession on the next turn only', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);
    const gameId = created.body.id as string;

    const preview = await request(context.app)
      .post(`/api/v1/games/${gameId}/actions/preview`)
      .set('x-what-if-history-language', 'fr')
      .send({ actionText: "donner Paris à l'Allemagne" })
      .expect(200);

    expect(preview.body).toMatchObject({
      effects: [
        {
          kind: 'territory',
          operation: 'cede',
          regionId: 'Ile_de_France',
          nationCode: 'GER',
        },
      ],
      ambiguities: [],
      worldRevision: 0,
    });

    const action = await request(context.app)
      .post(`/api/v1/games/${gameId}/actions`)
      .send({
        actionText: "donner Paris à l'Allemagne",
        mode: 'imposed',
        effects: preview.body.effects,
        previewWorldRevision: preview.body.worldRevision,
      })
      .expect(201);
    expect(action.body.effectStatus).toBe('queued');
    expect(action.body.mode).toBe('imposed');

    const beforeTurn = await request(context.app)
      .get(`/api/v1/games/${gameId}/world/regions`)
      .expect(200);
    expect(
      beforeTurn.body.find((region: { regionId: string }) => region.regionId === 'Ile_de_France'),
    ).toMatchObject({ ownerNationCode: 'FRA', controllerNationCode: 'FRA' });

    const turn = await request(context.app)
      .post(`/api/v1/games/${gameId}/turns`)
      .send({ amount: 1, unit: 'month' })
      .expect(201);

    expect(turn.body.worldRevision).toBe(1);
    expect(turn.body.appliedMutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          turnNumber: 1,
          source: 'player_action',
          sourceActionId: action.body.id,
          mutationType: 'region',
          targetId: 'Ile_de_France',
          worldRevision: 1,
        }),
        expect.objectContaining({
          source: 'player_action',
          mutationType: 'capital',
          targetId: 'FRA',
        }),
      ]),
    );

    const afterTurn = await request(context.app)
      .get(`/api/v1/games/${gameId}/world/regions`)
      .expect(200);
    expect(
      afterTurn.body.find((region: { regionId: string }) => region.regionId === 'Ile_de_France'),
    ).toMatchObject({ ownerNationCode: 'GER', controllerNationCode: 'GER' });

    const france = await request(context.app)
      .get(`/api/v1/games/${gameId}/countries/FRA`)
      .expect(200);
    expect(france.body).toMatchObject({ capital: null, capitalStatus: 'lost' });

    const features = await request(context.app)
      .get(`/api/v1/games/${gameId}/world/features`)
      .expect(200);
    expect(
      features.body.find((feature: { name: string }) => feature.name === 'Paris'),
    ).toMatchObject({ nationCode: 'GER', featureType: 'city', regionId: 'Ile_de_France' });
  });

  it('keeps detected effects of a planned order as non-guaranteed intentions', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);
    const gameId = created.body.id as string;
    const preview = await request(context.app)
      .post(`/api/v1/games/${gameId}/actions/preview`)
      .send({ actionText: "donner Paris à l'Allemagne" })
      .expect(200);
    const action = await request(context.app)
      .post(`/api/v1/games/${gameId}/actions`)
      .send({
        actionText: "donner Paris à l'Allemagne",
        mode: 'planned',
        effects: preview.body.effects,
        previewWorldRevision: preview.body.worldRevision,
      })
      .expect(201);

    expect(action.body).toMatchObject({ mode: 'planned', effectStatus: 'resolved' });
    const turn = await request(context.app)
      .post(`/api/v1/games/${gameId}/turns`)
      .send({ amount: 1, unit: 'month' })
      .expect(201);
    expect(turn.body.appliedMutations).not.toContainEqual(
      expect.objectContaining({ sourceActionId: action.body.id }),
    );
    const regions = await request(context.app)
      .get(`/api/v1/games/${gameId}/world/regions`)
      .expect(200);
    expect(
      regions.body.find((region: { regionId: string }) => region.regionId === 'Ile_de_France'),
    ).toMatchObject({ ownerNationCode: 'FRA', controllerNationCode: 'FRA' });
  });

  it('recognizes England without treating the selected region owner as the recipient', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);

    const preview = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions/preview`)
      .set('x-what-if-history-language', 'fr')
      .send({
        actionText: "donner a l'Angleterre\n\nContexte cartographique : ★ Paris (FRA).",
        context: { regionId: 'Ile_de_France' },
      })
      .expect(200);

    expect(preview.body).toMatchObject({
      effects: [
        {
          kind: 'territory',
          operation: 'cede',
          regionId: 'Ile_de_France',
          nationCode: 'ENG',
        },
      ],
      ambiguities: [],
    });

    const action = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions`)
      .send({
        actionText: preview.body.actionText,
        mode: 'planned',
        effects: preview.body.effects,
        previewWorldRevision: preview.body.worldRevision,
      })
      .expect(201);

    expect(action.body).toMatchObject({
      status: 'pending',
      mode: 'planned',
      effectStatus: 'resolved',
      effects: preview.body.effects,
    });
    expect(
      context.repository
        .listLlmCalls({ gameId: created.body.id, limit: 10 })
        .filter((call) => call.type === 'action_validation'),
    ).toHaveLength(0);
  });

  it('rejects an ambiguous action until its target is clarified', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);

    const action = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions`)
      .send({ actionText: "donner a l'Angleterre", mode: 'planned' })
      .expect(422);

    expect(action.body.code).toBe('ACTION_EFFECT_AMBIGUOUS');
  });

  it('returns the same committed turn for a repeated idempotency key', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);
    const key = '10000000-0000-4000-8000-000000000099';
    const first = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/turns`)
      .set('x-idempotency-key', key)
      .send({ amount: 1, unit: 'month' })
      .expect(201);
    const retry = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/turns`)
      .set('x-idempotency-key', key)
      .send({ amount: 1, unit: 'month' })
      .expect(201);

    expect(retry.body).toEqual(first.body);
    expect(context.repository.getGame(created.body.id)).toMatchObject({
      turnNumber: 2,
      worldRevision: 1,
    });
  });

  it('keeps legal ownership, military control, claims and capital status distinct', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);
    const gameId = created.body.id as string;

    const queue = async (actionText: string) => {
      const preview = await request(context.app)
        .post(`/api/v1/games/${gameId}/actions/preview`)
        .send({ actionText })
        .expect(200);
      expect(preview.body.ambiguities).toEqual([]);
      await request(context.app)
        .post(`/api/v1/games/${gameId}/actions`)
        .send({
          actionText,
          mode: 'imposed',
          effects: preview.body.effects,
          previewWorldRevision: preview.body.worldRevision,
        })
        .expect(201);
      return preview.body.effects;
    };
    const advance = () =>
      request(context.app)
        .post(`/api/v1/games/${gameId}/turns`)
        .send({ amount: 1, unit: 'month' })
        .expect(201);
    const region = async (regionId: string) => {
      const response = await request(context.app)
        .get(`/api/v1/games/${gameId}/world/regions`)
        .expect(200);
      return response.body.find(
        (candidate: { regionId: string }) => candidate.regionId === regionId,
      );
    };

    expect(await queue("occuper Paris avec l'Allemagne")).toEqual([
      expect.objectContaining({
        operation: 'occupy',
        regionId: 'Ile_de_France',
        nationCode: 'GER',
      }),
    ]);
    await advance();
    expect(await region('Ile_de_France')).toMatchObject({
      ownerNationCode: 'FRA',
      controllerNationCode: 'GER',
    });
    expect(
      await request(context.app).get(`/api/v1/games/${gameId}/countries/FRA`).expect(200),
    ).toMatchObject({
      body: expect.objectContaining({ capital: 'Paris', capitalStatus: 'occupied' }),
    });

    await queue('libérer Paris');
    await advance();
    expect(await region('Ile_de_France')).toMatchObject({
      ownerNationCode: 'FRA',
      controllerNationCode: 'FRA',
    });
    expect(
      await request(context.app).get(`/api/v1/games/${gameId}/countries/FRA`).expect(200),
    ).toMatchObject({
      body: expect.objectContaining({ capital: 'Paris', capitalStatus: 'established' }),
    });

    await queue("annexer l'Alsace Lorraine à l'Allemagne");
    await advance();
    expect(await region('Alsace_Lorraine')).toMatchObject({
      ownerNationCode: 'GER',
      controllerNationCode: 'GER',
      claimNationCodes: expect.arrayContaining(['FRA']),
    });

    await queue("revendiquer l'Alsace Lorraine pour l'Allemagne");
    await queue("revendiquer l'Alsace Lorraine pour l'Italie");
    await advance();
    expect(await region('Alsace_Lorraine')).toMatchObject({
      ownerNationCode: 'GER',
      controllerNationCode: 'GER',
      claimNationCodes: expect.arrayContaining(['FRA', 'ITA']),
    });
  });

  it('rejects an action confirmed against a stale world revision', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);
    const gameId = created.body.id as string;
    const preview = await request(context.app)
      .post(`/api/v1/games/${gameId}/actions/preview`)
      .send({ actionText: "donner Paris à l'Allemagne" })
      .expect(200);

    await request(context.app)
      .patch(`/api/v1/games/${gameId}/world/regions/Alsace_Lorraine`)
      .send({ controllerNationCode: 'GER' })
      .expect(200);

    const stale = await request(context.app)
      .post(`/api/v1/games/${gameId}/actions`)
      .send({
        actionText: "donner Paris à l'Allemagne",
        mode: 'imposed',
        effects: preview.body.effects,
        previewWorldRevision: preview.body.worldRevision,
      })
      .expect(409);
    expect(stale.body.code).toBe('WORLD_REVISION_CONFLICT');
  });

  it('restores a pre-v4 snapshot with safe controller, claim and capital defaults', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);
    const gameId = created.body.id as string;
    const snapshot = context.advanced.createSnapshot(gameId, 'Legacy snapshot');
    const row = context.database
      .prepare('SELECT payload FROM game_snapshots WHERE id = ?')
      .get(snapshot.id) as { payload: string };
    const payload = JSON.parse(row.payload) as {
      game: Record<string, unknown>;
      nationStates: Array<Record<string, unknown>>;
      actions: Array<Record<string, unknown>>;
      regions: Array<Record<string, unknown>>;
      mutations: Array<Record<string, unknown>>;
    };
    delete payload.game.world_revision;
    for (const state of payload.nationStates) {
      delete state.capital_feature_id;
      delete state.capital_status;
    }
    for (const action of payload.actions) {
      delete action.effects_json;
      delete action.effect_status;
      delete action.preview_world_revision;
    }
    for (const region of payload.regions) {
      delete region.controller_nation_code;
      delete region.claim_nation_codes;
    }
    for (const mutation of payload.mutations) {
      delete mutation.mutation_source;
      delete mutation.source_action_id;
      delete mutation.source_event_id;
      delete mutation.effect_json;
      delete mutation.world_revision;
    }
    context.database
      .prepare('UPDATE game_snapshots SET payload = ? WHERE id = ?')
      .run(JSON.stringify(payload), snapshot.id);

    await request(context.app)
      .patch(`/api/v1/games/${gameId}/world/regions/Ile_de_France`)
      .send({ ownerNationCode: 'GER', controllerNationCode: 'GER', claimNationCodes: ['FRA'] })
      .expect(200);
    const restored = await request(context.app)
      .post(`/api/v1/games/${gameId}/snapshots/${snapshot.id}/restore`)
      .expect(200);
    expect(restored.body.worldRevision).toBe(2);

    const regions = await request(context.app)
      .get(`/api/v1/games/${gameId}/world/regions`)
      .expect(200);
    expect(
      regions.body.find((region: { regionId: string }) => region.regionId === 'Ile_de_France'),
    ).toMatchObject({
      ownerNationCode: 'FRA',
      controllerNationCode: 'FRA',
      claimNationCodes: [],
    });
    const france = await request(context.app)
      .get(`/api/v1/games/${gameId}/countries/FRA`)
      .expect(200);
    expect(france.body).toMatchObject({ capital: 'Paris', capitalStatus: 'established' });
  });

  it('creates and lists an active custom scenario without calling the LLM', async () => {
    const premise = 'Une épidémie mondiale frappe tous les continents en 1936.';
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({
        nationCode: 'FRA',
        startDate: '1936-01-01',
        name: 'Le monde malade',
        scenario: { mode: 'custom', premise: `  ${premise}  ` },
      })
      .expect(201);

    expect(created.body).toMatchObject({
      name: 'Le monde malade',
      scenarioMode: 'custom',
      worldContext: premise,
      turnNumber: 1,
      eventCount: 0,
    });
    expect(context.repository.listLlmCalls({ limit: 100 })).toHaveLength(0);

    const games = await request(context.app).get('/api/v1/games').expect(200);
    expect(games.body).toContainEqual(
      expect.objectContaining({
        id: created.body.id,
        scenarioMode: 'custom',
      }),
    );
  });

  it('rejects invalid custom scenario premises', async () => {
    for (const premise of ['   ', 'x'.repeat(4_001)]) {
      const response = await request(context.app)
        .post('/api/v1/games')
        .send({
          nationCode: 'FRA',
          startDate: '1936-01-01',
          scenario: { mode: 'custom', premise },
        })
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }

    expect(context.repository.listGames()).toHaveLength(0);
  });

  it('keeps an imposed free-form fact generic, editable and guaranteed for the next turn', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);

    const imposed = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions`)
      .set('x-what-if-history-language', 'fr')
      .send({ actionText: 'Macron meurt étouffé par un os de poulet.', mode: 'imposed' })
      .expect(201);

    expect(imposed.body).toMatchObject({
      actionText: 'Macron meurt étouffé par un os de poulet.',
      actionType: 'general',
      mode: 'imposed',
      status: 'pending',
      effects: [],
      effectStatus: 'queued',
    });
    expect(imposed.body.aiResponse).toContain('Ce fait est garanti au prochain tour');
    const beforeTurn = await request(context.app)
      .get(`/api/v1/games/${created.body.id}/countries/FRA`)
      .expect(200);
    expect(beforeTurn.body.laws).not.toContainEqual(
      expect.objectContaining({ title: 'Macron meurt étouffé par un os de poulet.' }),
    );
    expect(context.repository.listLlmCalls({ limit: 100 })).toHaveLength(0);

    const edited = await request(context.app)
      .patch(`/api/v1/games/${created.body.id}/actions/${imposed.body.id}`)
      .send({
        actionText: 'Macron meurt étouffé par un os de poulet en public.',
        mode: 'imposed',
        effects: [],
        previewWorldRevision: 0,
      })
      .expect(200);
    expect(edited.body).toMatchObject({
      actionText: 'Macron meurt étouffé par un os de poulet en public.',
      mode: 'imposed',
      aiResponse: null,
    });

    const removable = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions`)
      .send({ actionText: 'Déclaration imposée à supprimer.', mode: 'imposed' })
      .expect(201);
    await request(context.app)
      .delete(`/api/v1/games/${created.body.id}/actions/${removable.body.id}`)
      .expect(204);

    await request(context.app)
      .post(`/api/v1/games/${created.body.id}/turns`)
      .send({ amount: 1, unit: 'week' })
      .expect(201);

    const actions = await request(context.app)
      .get(`/api/v1/games/${created.body.id}/actions`)
      .expect(200);
    expect(actions.body).toContainEqual(
      expect.objectContaining({
        id: imposed.body.id,
        mode: 'imposed',
        status: 'completed',
        effectStatus: 'applied',
      }),
    );
    const afterTurn = await request(context.app)
      .get(`/api/v1/games/${created.body.id}/countries/FRA`)
      .expect(200);
    expect(afterTurn.body.laws).not.toContainEqual(
      expect.objectContaining({ title: 'Macron meurt étouffé par un os de poulet en public.' }),
    );
  });

  it('removes the promulgation route and rejects an empty imposed action', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);

    await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions/promulgate-law`)
      .send({ actionText: 'Ancienne promulgation.' })
      .expect(404);
    const response = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions`)
      .send({ actionText: '   ', mode: 'imposed' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('generates English player-facing text when the interface language is English', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);

    const turn = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/turns`)
      .set('x-what-if-history-language', 'en')
      .send({ amount: 1, unit: 'month' })
      .expect(201);

    expect(turn.body.events[0]).toMatchObject({
      title: 'Strategic situation updated',
      description: 'The diplomatic and economic situation evolves without a major incident.',
    });
  });

  it('serves map points with valid coordinates and nation ownership', async () => {
    const response = await request(context.app).get('/api/v1/map/cities').expect(200);
    const nationCodes = new Set(context.catalog.nations.keys());
    const regionIds = new Set(
      (context.catalog.regions as { regions: Array<{ id: string }> }).regions.map(
        (region) => region.id,
      ),
    );

    expect(response.body).toHaveLength(84);
    expect(
      response.body.every(
        (city: { coords: [number, number]; nation_code: string; region_id: string }) =>
          city.coords[0] >= 0 &&
          city.coords[0] <= 1400.16 &&
          city.coords[1] >= 0 &&
          city.coords[1] <= 600 &&
          nationCodes.has(city.nation_code) &&
          regionIds.has(city.region_id),
      ),
    ).toBe(true);
    expect(response.body.find((city: { id: string }) => city.id === 'santiago')).toMatchObject({
      name: 'Santiago',
      nation_code: 'CHL',
      type: 'capital',
      region_id: 'Santiago',
      coords: [422.1, 419.5],
    });
    expect(response.body.find((city: { id: string }) => city.id === 'london')).toMatchObject({
      nation_code: 'ENG',
      region_id: 'Greater_London_Area',
      coords: [694.9, 120.7],
    });
  });

  it('never exposes the stored API key', async () => {
    const response = await request(context.app).get('/api/v1/llm/settings').expect(200);
    expect(response.body).toMatchObject({
      hasApiKey: true,
      structuredOutputMode: 'server_validation',
    });
    expect(JSON.stringify(response.body)).not.toContain('secret-test-key');
    expect(response.body).not.toHaveProperty('apiKey');
  });

  it('rejects the deterministic test provider outside isolated test servers', async () => {
    const guarded = createApp({ database: openDatabase(':memory:'), environment: 'development' });
    try {
      const rejectedSettings = await request(guarded.app)
        .patch('/api/v1/llm/settings')
        .send({
          provider: 'fake',
          apiUrl: 'http://127.0.0.1:9/v1',
          apiKey: '',
          model: 'deterministic-debug',
          clearApiKey: true,
        })
        .expect(409);
      expect(rejectedSettings.body.code).toBe('FAKE_LLM_PROVIDER_DISABLED');
      expect(guarded.repository.getLlmSettingsPrivate().provider).toBe('lm-studio');

      guarded.repository.saveLlmSettings({
        provider: 'fake',
        apiUrl: 'http://127.0.0.1:9/v1',
        apiKey: '',
        model: 'deterministic-debug',
        clearApiKey: true,
      });
      const created = await request(guarded.app)
        .post('/api/v1/games')
        .send({ nationCode: 'FRA', startDate: '1936-01-01' })
        .expect(201);
      const rejectedTurn = await request(guarded.app)
        .post(`/api/v1/games/${created.body.id}/turns`)
        .send({ amount: 1, unit: 'month' })
        .expect(409);
      expect(rejectedTurn.body.code).toBe('FAKE_LLM_PROVIDER_DISABLED');
      expect(guarded.repository.getGame(created.body.id).turnNumber).toBe(1);
      expect(guarded.repository.listEvents(created.body.id)).toHaveLength(0);
    } finally {
      guarded.database.close();
    }
  });

  it('keeps the stored API key when an empty password field is saved', async () => {
    const saved = await request(context.app)
      .patch('/api/v1/llm/settings')
      .send({
        provider: 'ollama',
        apiUrl: 'https://ollama.com/api',
        apiKey: '',
        model: 'glm-5.2:cloud',
        clearApiKey: false,
      })
      .expect(200);
    expect(saved.body.structuredOutputMode).toBe('server_validation');

    expect(context.repository.getLlmSettingsPrivate()).toMatchObject({
      provider: 'ollama',
      apiKey: 'secret-test-key',
    });
  });

  it('tracks every LLM call type globally without exposing request content or client IDs', async () => {
    const clientId = '10000000-0000-4000-8000-000000000001';
    const otherClientId = '20000000-0000-4000-8000-000000000002';
    const secretText = 'NEVER_EXPOSE_THIS_PLAYER_SECRET';
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01', name: 'Activity campaign' })
      .expect(201);

    await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions`)
      .set('x-what-if-history-client-id', clientId)
      .send({ actionText: secretText, mode: 'planned' })
      .expect(201);
    await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions/brainstorm`)
      .set('x-what-if-history-client-id', clientId)
      .expect(200);
    await request(context.app)
      .post(`/api/v1/games/${created.body.id}/advisor`)
      .set('x-what-if-history-client-id', clientId)
      .send({ question: secretText })
      .expect(200);
    const chat = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/chats`)
      .send({ targetNationCode: 'GER' })
      .expect(201);
    await request(context.app)
      .post(`/api/v1/games/${created.body.id}/chats/${chat.body.id}/messages`)
      .set('x-what-if-history-client-id', clientId)
      .send({ messageText: secretText })
      .expect(201);
    await request(context.app)
      .post(`/api/v1/games/${created.body.id}/turns`)
      .set('x-what-if-history-client-id', clientId)
      .send({ amount: 1, unit: 'week' })
      .expect(201);
    await request(context.app)
      .post('/api/v1/llm/settings/test')
      .set('x-what-if-history-client-id', clientId)
      .send({
        provider: 'fake',
        apiUrl: 'http://127.0.0.1:9/v1',
        model: 'deterministic',
        clearApiKey: false,
      })
      .expect(200);

    const activity = await request(context.app)
      .get('/api/v1/llm/activity?limit=100')
      .set('x-what-if-history-client-id', clientId)
      .expect(200);
    expect(new Set(activity.body.map((item: { type: string }) => item.type))).toEqual(
      new Set([
        'action_brainstorm',
        'advisor',
        'diplomacy_reply',
        'turn_generation',
        'connection_test',
      ]),
    );
    expect(activity.body.every((item: { initiatedHere: boolean }) => item.initiatedHere)).toBe(
      true,
    );
    expect(JSON.stringify(activity.body)).not.toContain(secretText);
    expect(JSON.stringify(activity.body)).not.toContain(clientId);
    expect(activity.body[0]).toMatchObject({
      status: 'succeeded',
      phase: 'applying_result',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });

    const viewedElsewhere = await request(context.app)
      .get('/api/v1/llm/activity?limit=100')
      .set('x-what-if-history-client-id', otherClientId)
      .expect(200);
    expect(
      viewedElsewhere.body.every((item: { initiatedHere: boolean }) => !item.initiatedHere),
    ).toBe(true);
    expect(JSON.stringify(context.database.prepare('SELECT * FROM llm_calls').all())).not.toContain(
      secretText,
    );
    const columns = context.database.prepare('PRAGMA table_info(llm_calls)').all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(['prompt', 'response', 'api_key', 'api_url']),
    );
  });

  it('rejects malformed identifiers and impossible dates as Problem Details', async () => {
    const badId = await request(context.app).get('/api/v1/games/../../backend/.env').expect(404);
    expect(badId.text).not.toContain('LLM_API_URL');

    const badDate = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1942-13-01' })
      .expect(400);
    expect(badDate.type).toMatch(/application\/problem\+json/);
    expect(badDate.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown nations without creating partial state', async () => {
    await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'ZZZ', startDate: '1936-01-01' })
      .expect(400);
    expect(context.repository.listGames()).toHaveLength(0);
  });

  it('accepts the application same-origin and rejects an unknown cross-origin client', async () => {
    const sameOrigin = await request(context.app)
      .get('/api/v1/health')
      .set('Host', '127.0.0.1:3000')
      .set('Origin', 'http://127.0.0.1:3000')
      .expect(200);
    expect(sameOrigin.headers['content-security-policy']).not.toContain(
      'upgrade-insecure-requests',
    );
    expect(sameOrigin.headers['permissions-policy']).toBe(
      'camera=(), geolocation=(), microphone=()',
    );

    const rejected = await request(context.app)
      .get('/api/v1/health')
      .set('Host', '127.0.0.1:3000')
      .set('Origin', 'https://attacker.invalid')
      .expect(403);
    expect(rejected.type).toMatch(/application\/problem\+json/);
    expect(rejected.body.code).toBe('ORIGIN_FORBIDDEN');
  });

  it('cascades game deletion through all mutable state', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);
    await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions`)
      .send({ actionText: 'Prepare a reserve force.', mode: 'planned' })
      .expect(201);

    await request(context.app).delete(`/api/v1/games/${created.body.id}`).expect(204);

    for (const table of ['games', 'nation_states', 'units', 'actions', 'events', 'chats']) {
      const row = context.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number;
      };
      expect(Number(row.count)).toBe(0);
    }
  });

  it('runs connection, action and turn routes through the native Ollama Cloud contract', async () => {
    const receivedPaths: string[] = [];
    const receivedAuthorizations: string[] = [];
    const receivedBodies: Array<Record<string, unknown>> = [];
    const provider = createServer((providerRequest, response) => {
      let body = '';
      providerRequest.setEncoding('utf8');
      providerRequest.on('data', (chunk: string) => {
        body += chunk;
      });
      providerRequest.on('end', () => {
        const payload = JSON.parse(body) as {
          options?: { num_predict?: number };
        };
        receivedPaths.push(providerRequest.url ?? '');
        receivedAuthorizations.push(providerRequest.headers.authorization ?? '');
        receivedBodies.push(payload as Record<string, unknown>);

        let content: string;
        switch (payload.options?.num_predict) {
          case 10:
            content = 'OK';
            break;
          case 300:
            content = JSON.stringify({ accepted: true, reason: 'Action accepted.' });
            break;
          case 4_000:
            content = JSON.stringify({
              time_advance_amount: 7,
              events: [
                {
                  title: 'Native Ollama route verified',
                  description: 'The isolated campaign advanced through the Ollama chat API.',
                  event_type: 'military',
                  severity: 'minor',
                  affected_nations: ['FRA'],
                  state_changes: {},
                  map_cue: {
                    locations: [{ role: 'primary', kind: 'nation', nation_code: 'FRA' }],
                    camera: 'nation',
                  },
                },
              ],
              law_changes: [],
              region_changes: [],
              unit_changes: [],
              map_feature_changes: [],
            });
            break;
          default:
            response.statusCode = 500;
            response.end();
            return;
        }

        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            message: { role: 'assistant', content },
            prompt_eval_count: 20,
            eval_count: 10,
            done: true,
          }),
        );
      });
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Mock server did not bind.');
    const apiUrl = `http://127.0.0.1:${address.port}/api`;

    try {
      context.repository.saveLlmSettings({
        provider: 'ollama',
        apiUrl,
        apiKey: 'stored-ollama-key',
        model: 'integration:cloud',
        clearApiKey: false,
      });

      await request(context.app)
        .post('/api/v1/llm/settings/test')
        .send({
          provider: 'ollama',
          apiUrl,
          model: 'integration:cloud',
          clearApiKey: false,
        })
        .expect(200)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            success: true,
            model: 'integration:cloud',
            response: 'OK',
          });
        });

      const created = await request(context.app)
        .post('/api/v1/games')
        .send({ nationCode: 'FRA', startDate: '1936-01-01' })
        .expect(201);

      await request(context.app)
        .post(`/api/v1/games/${created.body.id}/actions`)
        .send({ actionText: 'Reinforce the eastern frontier.', mode: 'planned' })
        .expect(201);

      await request(context.app)
        .post(`/api/v1/games/${created.body.id}/turns`)
        .send({ amount: 1, unit: 'week' })
        .expect(201)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            previousDate: '1936-01-01',
            newDate: '1936-01-08',
            turnNumber: 2,
            processedActions: 1,
          });
          expect(body.events).toContainEqual(
            expect.objectContaining({ title: 'Native Ollama route verified' }),
          );
        });

      expect(receivedPaths).toEqual(['/api/chat', '/api/chat']);
      expect(receivedAuthorizations).toEqual([
        'Bearer stored-ollama-key',
        'Bearer stored-ollama-key',
      ]);
      expect(receivedBodies.every((body) => body.think === false)).toBe(true);
      expect(receivedBodies.every((body) => !Object.hasOwn(body, 'format'))).toBe(true);

      const activity = context.repository
        .listLlmCalls({ gameId: created.body.id, limit: 10 })
        .map((item) => ({ type: item.type, status: item.status, errorCode: item.errorCode }));
      expect(activity).toEqual([{ type: 'turn_generation', status: 'succeeded', errorCode: null }]);
    } finally {
      await new Promise<void>((resolve) => provider.close(() => resolve()));
    }
  });

  it('preserves valid turn fields when Ollama Cloud returns a partial repair', async () => {
    let receivedCalls = 0;
    const receivedSystemPrompts: string[] = [];
    const provider = createServer((providerRequest, response) => {
      let body = '';
      providerRequest.setEncoding('utf8');
      providerRequest.on('data', (chunk: string) => {
        body += chunk;
      });
      providerRequest.on('end', () => {
        const payload = JSON.parse(body) as {
          messages: Array<{ role: string; content: string }>;
        };
        receivedCalls += 1;
        receivedSystemPrompts.push(payload.messages[0]?.content ?? '');

        const content =
          receivedCalls === 1
            ? {
                time_advance_amount: 1,
                events: [
                  {
                    title: 'Réponse initiale conservée',
                    description:
                      'Les champs valides de la première réponse restent présents après réparation.',
                    event_type: 'political',
                    severity: 'minor',
                    affected_nations: ['FRA'],
                    state_changes: {},
                    map_cue: {
                      locations: [{ role: 'primary', kind: 'nation', nation_code: 'FRA' }],
                      camera: 'nation',
                    },
                  },
                ],
                law_changes: [{}],
              }
            : {
                law_changes: [],
                region_changes: [],
                unit_changes: [],
                map_feature_changes: [],
              };

        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            message: { role: 'assistant', content: JSON.stringify(content) },
            prompt_eval_count: 20,
            eval_count: 10,
            done: true,
          }),
        );
      });
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Mock server did not bind.');
    const apiUrl = `http://127.0.0.1:${address.port}/api`;

    try {
      context.repository.saveLlmSettings({
        provider: 'ollama',
        apiUrl,
        apiKey: 'stored-ollama-key',
        model: 'partial-repair:cloud',
        clearApiKey: false,
      });
      const created = await request(context.app)
        .post('/api/v1/games')
        .send({ nationCode: 'FRA', startDate: '2000-01-01' })
        .expect(201);

      await request(context.app)
        .post(`/api/v1/games/${created.body.id}/turns`)
        .send({ amount: 1, unit: 'day' })
        .expect(201)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            previousDate: '2000-01-01',
            newDate: '2000-01-02',
            turnNumber: 2,
          });
          expect(body.events).toContainEqual(
            expect.objectContaining({ title: 'Réponse initiale conservée' }),
          );
        });

      expect(receivedCalls).toBe(2);
      expect(receivedSystemPrompts[1]).toContain('repair an AI simulation response');
    } finally {
      await new Promise<void>((resolve) => provider.close(() => resolve()));
    }
  });

  it('does not mutate a game after a malformed AI response', async () => {
    const receivedSystemPrompts: string[] = [];
    const receivedResponseFormats: unknown[] = [];
    const provider = createServer((providerRequest, response) => {
      let body = '';
      providerRequest.setEncoding('utf8');
      providerRequest.on('data', (chunk: string) => {
        body += chunk;
      });
      providerRequest.on('end', () => {
        const payload = JSON.parse(body) as {
          messages: Array<{ role: string; content: string }>;
          response_format?: unknown;
        };
        receivedSystemPrompts.push(payload.messages[0]?.content ?? '');
        receivedResponseFormats.push(payload.response_format);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }));
      });
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Mock server did not bind.');

    try {
      context.repository.saveLlmSettings({
        provider: 'openai',
        apiUrl: `http://127.0.0.1:${address.port}`,
        apiKey: 'test-only',
        model: 'malformed',
        clearApiKey: false,
      });
      const created = await request(context.app)
        .post('/api/v1/games')
        .send({ nationCode: 'FRA', startDate: '1936-01-01' })
        .expect(201);

      const failed = await request(context.app)
        .post(`/api/v1/games/${created.body.id}/turns`)
        .set('x-what-if-history-language', 'fr')
        .send({ amount: 1, unit: 'month' })
        .expect(502);
      expect(failed.body.code).toBe('INVALID_AI_RESPONSE');
      expect(receivedSystemPrompts).toHaveLength(2);
      expect(receivedSystemPrompts[0]).toContain('Réponds exclusivement en français.');
      expect(receivedSystemPrompts[0]).toContain('titres, descriptions et raisons');
      expect(receivedSystemPrompts[1]).toContain('repair an AI simulation response');
      expect(receivedResponseFormats).toHaveLength(2);
      expect(receivedResponseFormats).toEqual([
        expect.objectContaining({
          type: 'json_schema',
          json_schema: expect.objectContaining({ name: 'generated_turn', strict: true }),
        }),
        expect.objectContaining({
          type: 'json_schema',
          json_schema: expect.objectContaining({ name: 'generated_turn', strict: true }),
        }),
      ]);

      const game = context.repository.getGame(created.body.id);
      expect(game.currentDate).toBe('1936-01-01');
      expect(game.turnNumber).toBe(1);
      expect(context.repository.listEvents(created.body.id)).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => provider.close(() => resolve()));
    }
  });

  it('keeps simultaneous activities distinct and refuses a concurrent turn', async () => {
    let receivedCalls = 0;
    let markReady!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = createServer((providerRequest, response) => {
      let body = '';
      providerRequest.setEncoding('utf8');
      providerRequest.on('data', (chunk: string) => {
        body += chunk;
      });
      providerRequest.on('end', () => {
        receivedCalls += 1;
        if (receivedCalls === 2) markReady();
        void released.then(() => {
          const payload = JSON.parse(body) as {
            messages: Array<{ role: string; content: string }>;
          };
          const user = payload.messages.find((message) => message.role === 'user')?.content ?? '';
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: user.includes('"events"')
                      ? JSON.stringify({ events: [] })
                      : 'A measured strategic option.',
                  },
                },
              ],
            }),
          );
        });
      });
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Mock server did not bind.');

    try {
      context.repository.saveLlmSettings({
        provider: 'openai',
        apiUrl: `http://127.0.0.1:${address.port}`,
        apiKey: 'test-only',
        model: 'controlled-concurrency',
        clearApiKey: false,
      });
      const created = await request(context.app)
        .post('/api/v1/games')
        .send({ nationCode: 'FRA', startDate: '1936-01-01' })
        .expect(201);
      const clientId = '10000000-0000-4000-8000-000000000001';
      const turnRequest = request(context.app)
        .post(`/api/v1/games/${created.body.id}/turns`)
        .set('x-what-if-history-client-id', clientId)
        .send({ amount: 1, unit: 'week' })
        .then((response) => response);
      const brainstormRequest = request(context.app)
        .post(`/api/v1/games/${created.body.id}/actions/brainstorm`)
        .set('x-what-if-history-client-id', clientId)
        .then((response) => response);
      await ready;

      const rejected = await request(context.app)
        .post(`/api/v1/games/${created.body.id}/turns`)
        .set('x-what-if-history-client-id', clientId)
        .send({ amount: 1, unit: 'week' })
        .expect(409);
      expect(rejected.body.code).toBe('TURN_IN_PROGRESS');

      const active = await request(context.app)
        .get(`/api/v1/llm/activity?gameId=${created.body.id}`)
        .set('x-what-if-history-client-id', clientId)
        .expect(200);
      expect(
        active.body.filter((item: { status: string }) => item.status === 'running'),
      ).toHaveLength(2);
      expect(new Set(active.body.map((item: { type: string }) => item.type))).toEqual(
        new Set(['turn_generation', 'action_brainstorm']),
      );

      release();
      expect((await turnRequest).status).toBe(201);
      expect((await brainstormRequest).status).toBe(200);
    } finally {
      release();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
    }
  });

  it('supports the complete advanced solo campaign workflow', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({
        nationCode: 'FRA',
        startDate: '1870-01-01',
        difficulty: 'hard',
        name: 'Advanced campaign',
      })
      .expect(201);
    const gameId = created.body.id as string;
    expect(created.body).toMatchObject({ difficulty: 'hard', currentDate: '1870-01-01' });

    const configured = await request(context.app)
      .patch(`/api/v1/games/${gameId}/config`)
      .send({
        difficulty: 'impossible',
        simulationRules: 'Keep every consequence grounded and proportionate.',
        aiModels: { advisor: 'advisor-specialist' },
      })
      .expect(200);
    expect(configured.body).toMatchObject({
      difficulty: 'impossible',
      aiModels: { advisor: 'advisor-specialist' },
    });

    const action = await request(context.app)
      .post(`/api/v1/games/${gameId}/actions`)
      .send({ actionText: 'Prepare the western defenses.', mode: 'planned' })
      .expect(201);
    const editedAction = await request(context.app)
      .patch(`/api/v1/games/${gameId}/actions/${action.body.id}`)
      .send({ actionText: 'Prepare layered western defenses.' })
      .expect(200);
    expect(editedAction.body.actionText).toContain('layered');
    await request(context.app)
      .post(`/api/v1/games/${gameId}/actions/enhance`)
      .send({ actionText: 'Improve the rail network.' })
      .expect(200);

    await request(context.app)
      .post(`/api/v1/games/${gameId}/advisor`)
      .send({ question: 'What is the primary strategic risk?' })
      .expect(200);
    const advisorHistory = await request(context.app)
      .get(`/api/v1/games/${gameId}/advisor`)
      .expect(200);
    expect(advisorHistory.body.map((message: { role: string }) => message.role)).toEqual([
      'user',
      'advisor',
    ]);

    const chat = await request(context.app)
      .post(`/api/v1/games/${gameId}/chats`)
      .send({ participantNationCodes: ['GER', 'ENG'] })
      .expect(201);
    expect(chat.body.participants).toHaveLength(2);
    const selectedSpeaker = await request(context.app)
      .patch(`/api/v1/games/${gameId}/chats/${chat.body.id}/speaker`)
      .send({ nationCode: 'ENG' })
      .expect(200);
    expect(selectedSpeaker.body.nextSpeakerNationCode).toBe('ENG');

    const snapshot = await request(context.app)
      .post(`/api/v1/games/${gameId}/snapshots`)
      .send({ label: 'Before the crisis' })
      .expect(201);
    expect(snapshot.body.label).toBe('Before the crisis');
    await request(context.app)
      .patch(`/api/v1/games/${gameId}/consolidations/settings`)
      .send({ startRound: 3, chunkSize: 4 })
      .expect(200);

    const regions = await request(context.app)
      .get(`/api/v1/games/${gameId}/world/regions`)
      .expect(200);
    expect(regions.body.length).toBeGreaterThan(100);
    const regionId = regions.body.find(
      (region: { ownerNationCode: string | null }) => region.ownerNationCode === 'FRA',
    ).regionId as string;
    const feature = await request(context.app)
      .post(`/api/v1/games/${gameId}/world/features`)
      .send({
        name: 'Strategic Arsenal',
        featureType: 'custom',
        regionId,
        nationCode: 'FRA',
        coords: [710, 150],
        color: '#f0c56a',
        symbol: '◆',
      })
      .expect(201);
    expect(feature.body).toMatchObject({ coords: [710, 150], symbol: '◆' });

    const nextMajorEvent = await request(context.app)
      .post(`/api/v1/games/${gameId}/turns`)
      .send({ amount: 6, unit: 'month', strategy: 'next_major_event' })
      .expect(201);
    expect(nextMajorEvent.body).toMatchObject({
      previousDate: '1870-01-01',
      newDate: '1870-02-01',
    });
    const restored = await request(context.app)
      .post(`/api/v1/games/${gameId}/snapshots/${snapshot.body.id}/restore`)
      .expect(200);
    expect(restored.body).toMatchObject({
      currentDate: '1870-01-01',
      turnNumber: 1,
      difficulty: 'impossible',
    });
    const restoredFeatures = await request(context.app)
      .get(`/api/v1/games/${gameId}/world/features`)
      .expect(200);
    expect(
      restoredFeatures.body.some(
        (restoredFeature: { name: string }) => restoredFeature.name === 'Strategic Arsenal',
      ),
    ).toBe(false);

    const preset = await request(context.app)
      .post('/api/v1/presets')
      .send({
        title: 'Continental Balance',
        summary: 'A reusable test scenario.',
        category: 'alternate_history',
        tags: ['strategy'],
        startDate: '1870-01-01',
        worldContext: 'Europe is locked in an unstable continental balance.',
        simulationRules: 'Preserve causal continuity.',
        recommendedDifficulty: 'hard',
        playableNationCodes: ['FRA', 'GER'],
        aiModels: { actions: null, advisor: null, diplomacy: null, turns: null },
        prompts: [
          {
            mechanic: 'advisor',
            mode: 'custom',
            template: 'Advise {{PLAYER_NATION}} on {{GAME_DATE}}.',
          },
        ],
        helpers: [{ key: 'GAME_DATE', label: 'Date', source: 'game.date', format: 'text' }],
        initialWorld: {
          regions: [
            {
              regionId: 'Ile_de_France',
              ownerNationCode: 'GER',
              controllerNationCode: 'GER',
              claimNationCodes: ['FRA'],
              regionType: 'land',
            },
          ],
          capitalRegionIds: {},
        },
      })
      .expect(201);
    const published = await request(context.app)
      .post(`/api/v1/presets/${preset.body.id}/publish`)
      .expect(200);
    expect(published.body).toMatchObject({ status: 'published', currentVersion: 1 });
    const duplicated = await request(context.app)
      .post(`/api/v1/presets/${preset.body.id}/duplicate`)
      .expect(201);
    expect(duplicated.body.title).toMatch(/copie|copy/i);
    const launched = await request(context.app)
      .post(`/api/v1/presets/${preset.body.id}/play`)
      .send({ nationCode: 'FRA' })
      .expect(201);
    expect(launched.body).toMatchObject({
      id: expect.any(String),
      presetId: preset.body.id,
      currentDate: '1870-01-02',
      game: {
        presetId: preset.body.id,
        currentDate: '1870-01-02',
        turnNumber: 2,
        eventCount: 1,
        difficulty: 'hard',
      },
      openingTurn: {
        previousDate: '1870-01-01',
        newDate: '1870-01-02',
        events: [expect.objectContaining({ gameDate: '1870-01-02' })],
      },
    });
    expect(launched.body.id).toBe(launched.body.game.id);
    const launchedGameId = launched.body.game.id;
    const launchedRegions = await request(context.app)
      .get(`/api/v1/games/${launchedGameId}/world/regions`)
      .expect(200);
    expect(
      launchedRegions.body.find(
        (region: { regionId: string }) => region.regionId === 'Ile_de_France',
      ),
    ).toMatchObject({
      ownerNationCode: 'GER',
      controllerNationCode: 'GER',
      claimNationCodes: ['FRA'],
    });
    await request(context.app)
      .patch(`/api/v1/games/${launchedGameId}/world/regions/Ile_de_France`)
      .send({ ownerNationCode: 'FRA', controllerNationCode: 'FRA', claimNationCodes: [] })
      .expect(200);
    const unchangedPreset = await request(context.app)
      .get(`/api/v1/presets/${preset.body.id}`)
      .expect(200);
    expect(unchangedPreset.body.initialWorld.regions[0]).toMatchObject({
      regionId: 'Ile_de_France',
      ownerNationCode: 'GER',
      controllerNationCode: 'GER',
      claimNationCodes: ['FRA'],
    });
  });
});
