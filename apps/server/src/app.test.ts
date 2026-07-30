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
      dataQuality: 'estimated',
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
      .send({ actionText: 'Reinforce the eastern frontier.', actionType: 'military' })
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

  it('promulgates a law without AI validation or a vote and simulates it next turn', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);

    const law = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions/promulgate-law`)
      .set('x-what-if-history-language', 'fr')
      .send({ actionText: 'Rendre la vaccination obligatoire.' })
      .expect(201);

    expect(law.body).toMatchObject({
      actionText: 'Rendre la vaccination obligatoire.',
      actionType: 'law',
      status: 'pending',
      aiResponse:
        'Promulguée sans vote. La loi est déjà en vigueur ; ses conséquences seront simulées au prochain tour.',
    });
    expect(context.repository.listLlmCalls({ limit: 100 })).toHaveLength(0);

    await request(context.app)
      .delete(`/api/v1/games/${created.body.id}/actions/${law.body.id}`)
      .expect(404);

    await request(context.app)
      .post(`/api/v1/games/${created.body.id}/turns`)
      .send({ amount: 1, unit: 'week' })
      .expect(201);

    const actions = await request(context.app)
      .get(`/api/v1/games/${created.body.id}/actions`)
      .expect(200);
    expect(actions.body).toContainEqual(
      expect.objectContaining({ id: law.body.id, actionType: 'law', status: 'completed' }),
    );
  });

  it('rejects an empty law promulgation', async () => {
    const created = await request(context.app)
      .post('/api/v1/games')
      .send({ nationCode: 'FRA', startDate: '1936-01-01' })
      .expect(201);

    const response = await request(context.app)
      .post(`/api/v1/games/${created.body.id}/actions/promulgate-law`)
      .send({ actionText: '   ' })
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
    expect(response.body).toMatchObject({ hasApiKey: true });
    expect(JSON.stringify(response.body)).not.toContain('secret-test-key');
    expect(response.body).not.toHaveProperty('apiKey');
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
      .send({ actionText: secretText, actionType: 'military' })
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
        'action_validation',
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
      .send({ actionText: 'Prepare a reserve force.', actionType: 'military' })
      .expect(201);

    await request(context.app).delete(`/api/v1/games/${created.body.id}`).expect(204);

    for (const table of ['games', 'nation_states', 'units', 'actions', 'events', 'chats']) {
      const row = context.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number;
      };
      expect(Number(row.count)).toBe(0);
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
      expect(receivedResponseFormats).toEqual([{ type: 'json_object' }, { type: 'json_object' }]);

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
      .send({ actionText: 'Prepare the western defenses.', actionType: 'military' })
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
      presetId: preset.body.id,
      currentDate: '1870-01-01',
      difficulty: 'hard',
    });
  });
});
