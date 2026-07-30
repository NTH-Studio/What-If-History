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
});
