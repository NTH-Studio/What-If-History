import type { DatabaseSync } from 'node:sqlite';

const migrations = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE games (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
        player_nation_code TEXT NOT NULL CHECK(length(player_nation_code) = 3),
        current_date TEXT NOT NULL,
        turn_number INTEGER NOT NULL DEFAULT 1 CHECK(turn_number > 0),
        world_context TEXT NOT NULL,
        simulation_rules TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE nation_states (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        nation_code TEXT NOT NULL CHECK(length(nation_code) = 3),
        stability REAL NOT NULL CHECK(stability BETWEEN 0 AND 100),
        war_support REAL NOT NULL CHECK(war_support BETWEEN 0 AND 100),
        manpower REAL NOT NULL CHECK(manpower >= 0),
        political_power REAL NOT NULL,
        treasury REAL NOT NULL,
        at_war INTEGER NOT NULL CHECK(at_war IN (0, 1)),
        occupied_regions TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (game_id, nation_code)
      ) STRICT;

      CREATE TABLE units (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        unit_type TEXT NOT NULL,
        nation_code TEXT NOT NULL,
        region_id TEXT NOT NULL,
        centroid TEXT NOT NULL,
        strength REAL NOT NULL CHECK(strength BETWEEN 0 AND 100),
        organization REAL NOT NULL CHECK(organization BETWEEN 0 AND 100),
        experience REAL NOT NULL CHECK(experience BETWEEN 0 AND 100),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX units_game_idx ON units(game_id);

      CREATE TABLE actions (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        nation_code TEXT NOT NULL,
        action_text TEXT NOT NULL CHECK(length(action_text) BETWEEN 1 AND 4000),
        action_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'rejected', 'completed')),
        ai_response TEXT,
        turn_number INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX actions_game_idx ON actions(game_id, status);

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        affected_nations TEXT NOT NULL,
        state_changes TEXT NOT NULL,
        game_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        turn_number INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX events_game_idx ON events(game_id, turn_number);

      CREATE TABLE chats (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        target_nation_code TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'closed')),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX chats_game_idx ON chats(game_id);

      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        sender_nation TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        leader_name TEXT NOT NULL,
        message_text TEXT NOT NULL CHECK(length(message_text) BETWEEN 1 AND 4000),
        game_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX chat_messages_chat_idx ON chat_messages(chat_id, created_at);

      CREATE TABLE llm_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        provider TEXT NOT NULL,
        api_url TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL,
        imported_legacy INTEGER NOT NULL DEFAULT 0 CHECK(imported_legacy IN (0, 1)),
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: 'recalibrate_initial_unit_positions',
    sql: `
      UPDATE units
      SET region_id = CASE name
        WHEN '1st Eritrean Division' THEN 'Eritrea'
        WHEN '2nd Eritrean Division' THEN 'Eritrea'
        WHEN 'Imperial Guard Kebur Zabagna' THEN 'Shewa'
        WHEN '1st Panzer Division' THEN 'Brandenburg'
        WHEN '1st Armored Division' THEN 'Ile_de_France'
        WHEN 'Home Fleet' THEN 'Scottish_Highlands'
        ELSE region_id
      END,
      centroid = CASE name
        WHEN '1st Eritrean Division' THEN '[851.3,288.3]'
        WHEN '2nd Eritrean Division' THEN '[858.2,290]'
        WHEN 'Imperial Guard Kebur Zabagna' THEN '[849.5,313.8]'
        WHEN '1st Panzer Division' THEN '[748.4,119.5]'
        WHEN '1st Armored Division' THEN '[706.2,139.2]'
        WHEN 'Home Fleet' THEN '[680.4,84.7]'
        ELSE centroid
      END
      WHERE name IN (
        '1st Eritrean Division',
        '2nd Eritrean Division',
        'Imperial Guard Kebur Zabagna',
        '1st Panzer Division',
        '1st Armored Division',
        'Home Fleet'
      );
    `,
  },
  {
    version: 3,
    name: 'add_llm_activity',
    sql: `
      CREATE TABLE llm_calls (
        id TEXT PRIMARY KEY,
        game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
        game_name TEXT,
        request_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        call_type TEXT NOT NULL CHECK(call_type IN (
          'action_validation',
          'action_brainstorm',
          'advisor',
          'diplomacy_reply',
          'turn_generation',
          'connection_test'
        )),
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        phase TEXT NOT NULL CHECK(phase IN (
          'preparing',
          'waiting_provider',
          'validating_response',
          'applying_result'
        )),
        status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        error_code TEXT
      ) STRICT;
      CREATE INDEX llm_calls_status_started_idx ON llm_calls(status, started_at DESC);
      CREATE INDEX llm_calls_game_started_idx ON llm_calls(game_id, started_at DESC);
    `,
  },
  {
    version: 4,
    name: 'add_game_scenario_mode',
    sql: `
      ALTER TABLE games
      ADD COLUMN scenario_mode TEXT NOT NULL DEFAULT 'historical'
      CHECK(scenario_mode IN ('historical', 'custom'));
    `,
  },
  {
    version: 5,
    name: 'add_country_profiles_and_laws',
    sql: `
      ALTER TABLE nation_states ADD COLUMN population REAL NOT NULL DEFAULT 0;
      ALTER TABLE nation_states ADD COLUMN gdp REAL NOT NULL DEFAULT 0;
      ALTER TABLE nation_states ADD COLUMN happiness REAL NOT NULL DEFAULT 50 CHECK(happiness BETWEEN 0 AND 100);
      ALTER TABLE nation_states ADD COLUMN literacy REAL NOT NULL DEFAULT 50 CHECK(literacy BETWEEN 0 AND 100);
      ALTER TABLE nation_states ADD COLUMN unemployment REAL NOT NULL DEFAULT 15 CHECK(unemployment BETWEEN 0 AND 100);
      ALTER TABLE nation_states ADD COLUMN inflation REAL NOT NULL DEFAULT 2 CHECK(inflation BETWEEN -20 AND 200);
      ALTER TABLE nation_states ADD COLUMN industrial_capacity REAL NOT NULL DEFAULT 50 CHECK(industrial_capacity BETWEEN 0 AND 100);
      ALTER TABLE nation_states ADD COLUMN health REAL NOT NULL DEFAULT 50 CHECK(health BETWEEN 0 AND 100);
      ALTER TABLE nation_states ADD COLUMN food_security REAL NOT NULL DEFAULT 50 CHECK(food_security BETWEEN 0 AND 100);
      ALTER TABLE nation_states ADD COLUMN population_growth_rate REAL NOT NULL DEFAULT 1;
      ALTER TABLE nation_states ADD COLUMN gdp_growth_rate REAL NOT NULL DEFAULT 2;
      ALTER TABLE nation_states ADD COLUMN profile_version INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE country_laws (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        nation_code TEXT NOT NULL CHECK(length(nation_code) = 3),
        title_fr TEXT NOT NULL,
        title_en TEXT NOT NULL,
        summary_fr TEXT NOT NULL,
        summary_en TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN (
          'constitution', 'economy', 'labor', 'security', 'military', 'social', 'trade', 'other'
        )),
        enacted_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'repealed')),
        repealed_date TEXT,
        source TEXT NOT NULL CHECK(source IN ('historical', 'player', 'simulation')),
        source_action_id TEXT REFERENCES actions(id) ON DELETE SET NULL
      ) STRICT;
      CREATE INDEX country_laws_game_nation_status_idx
      ON country_laws(game_id, nation_code, status);
      CREATE UNIQUE INDEX country_laws_source_action_idx
      ON country_laws(source_action_id) WHERE source_action_id IS NOT NULL;
    `,
  },
  {
    version: 6,
    name: 'advanced_solo_campaign_systems',
    sql: `
      CREATE TABLE presets (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
        summary TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL CHECK(category IN (
          'historical', 'alternate_history', 'fantasy', 'science_fiction', 'custom'
        )),
        tags TEXT NOT NULL DEFAULT '[]',
        start_date TEXT NOT NULL,
        world_context TEXT NOT NULL,
        simulation_rules TEXT NOT NULL,
        recommended_difficulty TEXT NOT NULL DEFAULT 'normal' CHECK(recommended_difficulty IN (
          'very_easy', 'easy', 'normal', 'hard', 'impossible'
        )),
        playable_nation_codes TEXT NOT NULL,
        ai_models TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
        current_version INTEGER NOT NULL DEFAULT 0 CHECK(current_version >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE preset_versions (
        id TEXT PRIMARY KEY,
        preset_id TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK(version > 0),
        snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(preset_id, version)
      ) STRICT;

      CREATE TABLE preset_prompts (
        preset_id TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
        mechanic TEXT NOT NULL CHECK(mechanic IN (
          'actions', 'advisor', 'diplomacy', 'turns', 'consolidation'
        )),
        mode TEXT NOT NULL DEFAULT 'default' CHECK(mode IN ('default', 'custom')),
        template TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(preset_id, mechanic)
      ) STRICT;

      CREATE TABLE preset_helpers (
        preset_id TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
        helper_key TEXT NOT NULL,
        label TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN (
          'game.date', 'game.turn', 'game.player', 'game.world', 'game.rules'
        )),
        format TEXT NOT NULL DEFAULT 'text' CHECK(format IN ('text', 'json')),
        PRIMARY KEY(preset_id, helper_key)
      ) STRICT;

      ALTER TABLE games ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'normal'
        CHECK(difficulty IN ('very_easy', 'easy', 'normal', 'hard', 'impossible'));
      ALTER TABLE games ADD COLUMN ai_models TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE games ADD COLUMN preset_id TEXT REFERENCES presets(id) ON DELETE SET NULL;
      ALTER TABLE games ADD COLUMN consolidation_start_round INTEGER NOT NULL DEFAULT 15
        CHECK(consolidation_start_round BETWEEN 2 AND 200);
      ALTER TABLE games ADD COLUMN consolidation_chunk_size INTEGER NOT NULL DEFAULT 5
        CHECK(consolidation_chunk_size BETWEEN 2 AND 50);

      ALTER TABLE chats ADD COLUMN next_speaker_nation_code TEXT;

      CREATE TABLE chat_participants (
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        nation_code TEXT NOT NULL CHECK(length(nation_code) = 3),
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(chat_id, nation_code)
      ) STRICT;
      INSERT INTO chat_participants (chat_id, nation_code, sort_order)
      SELECT id, target_nation_code, 0 FROM chats;

      CREATE TABLE advisor_messages (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'advisor')),
        message_text TEXT NOT NULL CHECK(length(message_text) BETWEEN 1 AND 4000),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX advisor_messages_game_created_idx
      ON advisor_messages(game_id, created_at);

      CREATE TABLE turn_runs (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        turn_number INTEGER NOT NULL,
        strategy TEXT NOT NULL CHECK(strategy IN ('fixed', 'next_major_event')),
        jump_payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('preparing', 'generating', 'applying', 'completed', 'failed')),
        snapshot_id TEXT,
        error_code TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;
      CREATE INDEX turn_runs_game_started_idx ON turn_runs(game_id, started_at DESC);

      CREATE TABLE game_snapshots (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        turn_number INTEGER NOT NULL,
        game_date TEXT NOT NULL,
        label TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX game_snapshots_game_turn_idx
      ON game_snapshots(game_id, turn_number DESC);

      CREATE TABLE consolidations (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        start_turn INTEGER NOT NULL,
        end_turn INTEGER NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'current' CHECK(status IN ('current', 'stale')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(game_id, start_turn, end_turn)
      ) STRICT;
      CREATE INDEX consolidations_game_turn_idx
      ON consolidations(game_id, end_turn DESC);

      CREATE TABLE game_regions (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        region_id TEXT NOT NULL,
        name TEXT NOT NULL,
        owner_nation_code TEXT,
        region_type TEXT NOT NULL DEFAULT 'land' CHECK(region_type IN (
          'land', 'coastal', 'ocean', 'strait'
        )),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(game_id, region_id)
      ) STRICT;
      CREATE INDEX game_regions_owner_idx ON game_regions(game_id, owner_nation_code);

      CREATE TABLE map_features (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        feature_type TEXT NOT NULL CHECK(feature_type IN ('city', 'capital', 'battalion', 'custom')),
        region_id TEXT NOT NULL,
        nation_code TEXT,
        color TEXT NOT NULL,
        symbol TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX map_features_game_region_idx ON map_features(game_id, region_id);

      CREATE TABLE world_mutations (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        turn_number INTEGER NOT NULL,
        mutation_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        before_value TEXT,
        after_value TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX world_mutations_game_turn_idx
      ON world_mutations(game_id, turn_number DESC);

      CREATE TABLE llm_calls_v2 (
        id TEXT PRIMARY KEY,
        game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
        game_name TEXT,
        request_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        call_type TEXT NOT NULL CHECK(call_type IN (
          'action_validation', 'action_brainstorm', 'action_enhance', 'advisor',
          'diplomacy_reply', 'next_speaker', 'consolidation', 'turn_generation',
          'connection_test'
        )),
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        phase TEXT NOT NULL CHECK(phase IN (
          'preparing', 'waiting_provider', 'validating_response', 'applying_result'
        )),
        status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        error_code TEXT
      ) STRICT;
      INSERT INTO llm_calls_v2 SELECT * FROM llm_calls;
      DROP TABLE llm_calls;
      ALTER TABLE llm_calls_v2 RENAME TO llm_calls;
      CREATE INDEX llm_calls_status_started_idx ON llm_calls(status, started_at DESC);
      CREATE INDEX llm_calls_game_started_idx ON llm_calls(game_id, started_at DESC);
    `,
  },
  {
    version: 7,
    name: 'map_feature_coordinates',
    sql: `
      ALTER TABLE map_features ADD COLUMN coords_x REAL NOT NULL DEFAULT 700;
      ALTER TABLE map_features ADD COLUMN coords_y REAL NOT NULL DEFAULT 300;
    `,
  },
  {
    version: 8,
    name: 'event_map_cues',
    sql: `
      ALTER TABLE events
      ADD COLUMN map_cue TEXT NOT NULL DEFAULT '{"locations":[],"camera":"auto"}';
    `,
  },
] as const;

export function runMigrations(database: DatabaseSync, targetVersion = Number.POSITIVE_INFINITY) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const applied = new Set(
    database
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => Number(row.version)),
  );

  for (const migration of migrations) {
    if (migration.version > targetVersion) continue;
    if (applied.has(migration.version)) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
