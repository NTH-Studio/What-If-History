import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from './migrations.js';

describe('map position migrations', () => {
  let database: DatabaseSync | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  it('recalibrates units stored by the initial schema', () => {
    database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES (1, 'initial_schema', '2026-01-01T00:00:00.000Z');

      CREATE TABLE units (
        name TEXT NOT NULL,
        region_id TEXT NOT NULL,
        centroid TEXT NOT NULL
      ) STRICT;
      INSERT INTO units VALUES
        ('1st Armored Division', 'Paris', '[660,150]'),
        ('Home Fleet', 'Scapa Flow', '[620,80]');

      CREATE TABLE games (
        id TEXT PRIMARY KEY
      ) STRICT;
      CREATE TABLE nation_states (
        game_id TEXT NOT NULL,
        nation_code TEXT NOT NULL
      ) STRICT;
    `);

    runMigrations(database, 2);

    expect(
      database.prepare('SELECT name, region_id, centroid FROM units ORDER BY name').all(),
    ).toEqual([
      {
        name: '1st Armored Division',
        region_id: 'Ile_de_France',
        centroid: '[706.2,139.2]',
      },
      {
        name: 'Home Fleet',
        region_id: 'Scottish_Highlands',
        centroid: '[680.4,84.7]',
      },
    ]);
  });

  it('marks existing games as historical when scenario support is added', () => {
    database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES
        (1, 'initial_schema', '2026-01-01T00:00:00.000Z'),
        (2, 'recalibrate_initial_unit_positions', '2026-01-01T00:00:00.000Z'),
        (3, 'add_llm_activity', '2026-01-01T00:00:00.000Z');

      CREATE TABLE games (
        id TEXT PRIMARY KEY,
        world_context TEXT NOT NULL
      ) STRICT;
      INSERT INTO games VALUES ('legacy-game', 'Historical context');
      CREATE TABLE nation_states (
        game_id TEXT NOT NULL,
        nation_code TEXT NOT NULL
      ) STRICT;
    `);

    runMigrations(database, 4);

    expect(
      database.prepare('SELECT scenario_mode FROM games WHERE id = ?').get('legacy-game'),
    ).toEqual({ scenario_mode: 'historical' });
  });

  it('adds a backwards-compatible map cue to existing events', () => {
    database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES
        (1, 'initial_schema', '2026-01-01T00:00:00.000Z'),
        (2, 'recalibrate_initial_unit_positions', '2026-01-01T00:00:00.000Z'),
        (3, 'add_llm_activity', '2026-01-01T00:00:00.000Z'),
        (4, 'add_game_scenario_mode', '2026-01-01T00:00:00.000Z'),
        (5, 'add_country_profiles_and_laws', '2026-01-01T00:00:00.000Z'),
        (6, 'advanced_solo_campaign_systems', '2026-01-01T00:00:00.000Z'),
        (7, 'map_feature_coordinates', '2026-01-01T00:00:00.000Z');

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL
      ) STRICT;
      INSERT INTO events VALUES ('legacy-event', 'Legacy event');
    `);

    runMigrations(database, 8);

    expect(database.prepare('SELECT map_cue FROM events WHERE id = ?').get('legacy-event')).toEqual(
      {
        map_cue: '{"locations":[],"camera":"auto"}',
      },
    );
  });

  it('upgrades a populated v3-compatible world additively to v4 defaults', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(database, 8);
    const timestamp = '2026-01-01T00:00:00.000Z';
    database
      .prepare(
        `INSERT INTO games (
          id, name, player_nation_code, current_date, turn_number, world_context,
          simulation_rules, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-game',
        'Legacy',
        'FRA',
        '1936-01-01',
        1,
        'Historical context',
        'Rules',
        timestamp,
        timestamp,
      );
    database
      .prepare(
        `INSERT INTO nation_states (
          game_id, nation_code, stability, war_support, manpower, political_power,
          treasury, at_war, occupied_regions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('legacy-game', 'FRA', 50, 50, 100, 50, 100, 0, '[]');
    database
      .prepare(
        `INSERT INTO actions (
          id, game_id, nation_code, action_text, action_type, status, ai_response,
          turn_number, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-action',
        'legacy-game',
        'FRA',
        'Legacy order',
        'general',
        'pending',
        null,
        1,
        timestamp,
      );
    database
      .prepare(
        `INSERT INTO game_regions (
          game_id, region_id, name, owner_nation_code, region_type, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('legacy-game', 'Ile_de_France', 'Île-de-France', 'FRA', 'land', timestamp);
    database
      .prepare(
        `INSERT INTO presets (
          id, title, category, start_date, world_context, simulation_rules,
          playable_nation_codes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-preset',
        'Legacy preset',
        'historical',
        '1936-01-01',
        'World',
        'Rules',
        '["FRA"]',
        timestamp,
        timestamp,
      );

    runMigrations(database, 9);

    expect(database.prepare('SELECT world_revision FROM games').get()).toEqual({
      world_revision: 0,
    });
    expect(
      database
        .prepare(
          `SELECT controller_nation_code, claim_nation_codes
           FROM game_regions WHERE region_id = 'Ile_de_France'`,
        )
        .get(),
    ).toEqual({ controller_nation_code: 'FRA', claim_nation_codes: '[]' });
    expect(
      database
        .prepare(
          `SELECT effects_json, effect_status, preview_world_revision
           FROM actions WHERE id = 'legacy-action'`,
        )
        .get(),
    ).toEqual({ effects_json: '[]', effect_status: 'queued', preview_world_revision: null });
    expect(
      database.prepare(`SELECT capital_status FROM nation_states WHERE nation_code = 'FRA'`).get(),
    ).toEqual({ capital_status: 'established' });
    expect(database.prepare(`SELECT initial_world_json FROM presets`).get()).toEqual({
      initial_world_json: '{"regions":[],"capitalRegionIds":{}}',
    });
  });

  it('repairs the legacy 1936 context using each historical campaign date', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(database, 9);
    const timestamp = '2026-01-01T00:00:00.000Z';
    const legacyContext =
      'Historical 1936 start. Europe is on the brink of tension as ideologies clash.';
    const insert = database.prepare(
      `INSERT INTO games (
        id, name, player_nation_code, current_date, turn_number, world_context,
        simulation_rules, scenario_mode, created_at, updated_at
      ) VALUES (?, ?, 'FRA', '2000-01-01', 1, ?, 'Rules', ?, ?, ?)`,
    );
    insert.run('historical-game', 'Historical', legacyContext, 'historical', timestamp, timestamp);
    insert.run('custom-game', 'Custom', legacyContext, 'custom', timestamp, timestamp);

    runMigrations(database, 10);

    expect(
      database.prepare('SELECT world_context FROM games WHERE id = ?').get('historical-game'),
    ).toEqual({
      world_context:
        'Historical campaign beginning on 2000-01-01. The campaign date and persisted world ' +
        'state are authoritative; do not assume a different historical year.',
    });
    expect(
      database.prepare('SELECT world_context FROM games WHERE id = ?').get('custom-game'),
    ).toEqual({ world_context: legacyContext });
  });

  it('adds grand-strategy storage without changing an existing campaign', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(database, 10);
    const timestamp = '2026-01-01T00:00:00.000Z';
    database
      .prepare(
        `INSERT INTO games (
          id, name, player_nation_code, current_date, turn_number, world_context,
          simulation_rules, scenario_mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-strategy-game',
        'Legacy strategy',
        'FRA',
        '1942-06-12',
        17,
        'Persistent alternate history',
        'Rules',
        'historical',
        timestamp,
        timestamp,
      );
    database
      .prepare(
        `INSERT INTO nation_states (
          game_id, nation_code, stability, war_support, manpower, political_power,
          treasury, at_war, occupied_regions, population
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('legacy-strategy-game', 'FRA', 42, 63, 900_000, 87, 730, 1, '["Alsace"]', 39_123_456);
    database
      .prepare(
        `INSERT INTO game_regions (
          game_id, region_id, name, owner_nation_code, region_type, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('legacy-strategy-game', 'Ile_de_France', 'Île-de-France', 'FRA', 'land', timestamp);

    runMigrations(database, 11);

    expect(
      database
        .prepare('SELECT games.current_date, turn_number FROM games WHERE id = ?')
        .get('legacy-strategy-game'),
    ).toEqual({ current_date: '1942-06-12', turn_number: 17 });
    expect(
      database
        .prepare('SELECT population, occupied_regions FROM nation_states WHERE game_id = ?')
        .get('legacy-strategy-game'),
    ).toEqual({ population: 39_123_456, occupied_regions: '["Alsace"]' });
    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name IN (
             'region_states', 'characters', 'strategic_orders', 'wars', 'fronts',
             'intel_contacts', 'timeline_entries'
           ) ORDER BY name`,
        )
        .all(),
    ).toHaveLength(7);
  });

  it('marks pre-existing campaigns as legacy without fabricating dated history', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(database, 11);
    const timestamp = '2026-01-01T00:00:00.000Z';
    database
      .prepare(
        `INSERT INTO games (
          id, name, player_nation_code, current_date, turn_number, world_context,
          simulation_rules, scenario_mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-dated-game',
        'Legacy dated game',
        'FRA',
        '2000-01-01',
        9,
        'Existing world',
        'Existing rules',
        'historical',
        timestamp,
        timestamp,
      );

    runMigrations(database, 12);

    expect(
      database
        .prepare(
          `SELECT games.current_date, turn_number, historical_baseline_mode,
                  historical_catalog_version
           FROM games WHERE id = ?`,
        )
        .get('legacy-dated-game'),
    ).toEqual({
      current_date: '2000-01-01',
      turn_number: 9,
      historical_baseline_mode: 'legacy_static',
      historical_catalog_version: null,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM game_polities').get()).toEqual({
      count: 0,
    });
  });

  it('adds Gibraltar territorial metadata without changing its strategic owner', () => {
    database = new DatabaseSync(':memory:');
    runMigrations(database, 12);
    const timestamp = '2026-01-01T00:00:00.000Z';
    database
      .prepare(
        `INSERT INTO games (
          id, name, player_nation_code, current_date, world_context, simulation_rules,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'gibraltar-2020',
        'Gibraltar 2020',
        'FRA',
        '2020-01-01',
        'Historical world',
        'Rules',
        timestamp,
        timestamp,
      );
    database
      .prepare(
        `INSERT INTO game_regions (
          game_id, region_id, name, owner_nation_code, controller_nation_code,
          claim_nation_codes, region_type, updated_at
        ) VALUES (?, 'Gibraltar', 'Gibraltar', 'ENG', 'ENG', '[]', 'land', ?)`,
      )
      .run('gibraltar-2020', timestamp);

    runMigrations(database, 13);

    expect(
      database
        .prepare(
          `SELECT owner_nation_code, controller_nation_code, territorial_status,
                  administering_nation_code, claim_nation_codes
           FROM game_regions WHERE game_id = 'gibraltar-2020'`,
        )
        .get(),
    ).toEqual({
      owner_nation_code: 'ENG',
      controller_nation_code: 'ENG',
      territorial_status: 'overseas_territory',
      administering_nation_code: 'ENG',
      claim_nation_codes: '["SPR"]',
    });
  });
});
