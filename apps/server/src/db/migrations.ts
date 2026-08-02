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
  {
    version: 9,
    name: 'v4_structured_world_effects',
    sql: `
      ALTER TABLE games
      ADD COLUMN world_revision INTEGER NOT NULL DEFAULT 0 CHECK(world_revision >= 0);

      ALTER TABLE nation_states ADD COLUMN capital_feature_id TEXT;
      ALTER TABLE nation_states
      ADD COLUMN capital_status TEXT NOT NULL DEFAULT 'established'
      CHECK(capital_status IN ('established', 'occupied', 'lost'));

      ALTER TABLE actions ADD COLUMN effects_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE actions
      ADD COLUMN effect_status TEXT NOT NULL DEFAULT 'queued'
      CHECK(effect_status IN ('draft', 'resolved', 'queued', 'applied', 'failed'));
      ALTER TABLE actions ADD COLUMN preview_world_revision INTEGER;

      ALTER TABLE game_regions ADD COLUMN controller_nation_code TEXT;
      ALTER TABLE game_regions ADD COLUMN claim_nation_codes TEXT NOT NULL DEFAULT '[]';
      UPDATE game_regions
      SET controller_nation_code = owner_nation_code
      WHERE controller_nation_code IS NULL;
      CREATE INDEX game_regions_controller_idx
      ON game_regions(game_id, controller_nation_code);

      ALTER TABLE world_mutations
      ADD COLUMN mutation_source TEXT NOT NULL DEFAULT 'simulation'
      CHECK(mutation_source IN ('player_action', 'simulation', 'manual'));
      ALTER TABLE world_mutations ADD COLUMN source_action_id TEXT;
      ALTER TABLE world_mutations ADD COLUMN source_event_id TEXT;
      ALTER TABLE world_mutations ADD COLUMN effect_json TEXT;
      ALTER TABLE world_mutations
      ADD COLUMN world_revision INTEGER NOT NULL DEFAULT 0 CHECK(world_revision >= 0);

      ALTER TABLE turn_runs ADD COLUMN generated_payload TEXT;
      ALTER TABLE turn_runs ADD COLUMN schema_mode TEXT;
      ALTER TABLE turn_runs ADD COLUMN repair_attempts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE turn_runs ADD COLUMN mutation_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE turn_runs ADD COLUMN idempotency_key TEXT;
      ALTER TABLE turn_runs ADD COLUMN result_json TEXT;
      CREATE UNIQUE INDEX turn_runs_game_idempotency_idx
      ON turn_runs(game_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

      ALTER TABLE presets
      ADD COLUMN initial_world_json TEXT NOT NULL
      DEFAULT '{"regions":[],"capitalRegionIds":{}}';
    `,
  },
  {
    version: 10,
    name: 'repair_legacy_historical_campaign_dates',
    sql: `
      UPDATE games
      SET world_context =
        'Historical campaign beginning on ' || games.current_date ||
        '. The campaign date and persisted world state are authoritative; ' ||
        'do not assume a different historical year.'
      WHERE scenario_mode = 'historical'
        AND world_context =
          'Historical 1936 start. Europe is on the brink of tension as ideologies clash.';
    `,
  },
  {
    version: 11,
    name: 'grand_strategy_world',
    sql: `
      ALTER TABLE units ADD COLUMN domain TEXT NOT NULL DEFAULT 'land'
        CHECK(domain IN ('land', 'naval', 'air'));
      ALTER TABLE units ADD COLUMN manpower REAL NOT NULL DEFAULT 10000 CHECK(manpower >= 0);
      ALTER TABLE units ADD COLUMN equipment REAL NOT NULL DEFAULT 100 CHECK(equipment BETWEEN 0 AND 100);
      ALTER TABLE units ADD COLUMN morale REAL NOT NULL DEFAULT 100 CHECK(morale BETWEEN 0 AND 100);
      ALTER TABLE units ADD COLUMN fuel REAL NOT NULL DEFAULT 100 CHECK(fuel BETWEEN 0 AND 100);
      ALTER TABLE units ADD COLUMN supply REAL NOT NULL DEFAULT 100 CHECK(supply BETWEEN 0 AND 100);
      ALTER TABLE units ADD COLUMN operational_range REAL NOT NULL DEFAULT 800 CHECK(operational_range >= 0);
      ALTER TABLE units ADD COLUMN doctrine TEXT NOT NULL DEFAULT 'standard';
      ALTER TABLE units ADD COLUMN mission TEXT NOT NULL DEFAULT 'idle'
        CHECK(mission IN (
          'idle', 'move', 'attack', 'defend', 'retreat', 'patrol', 'intercept',
          'bombard', 'escort', 'landing', 'transport'
        ));
      ALTER TABLE units ADD COLUMN intel_level TEXT NOT NULL DEFAULT 'exact'
        CHECK(intel_level IN ('unknown', 'estimated', 'exact'));

      ALTER TABLE events ADD COLUMN subtype TEXT NOT NULL DEFAULT 'general';
      ALTER TABLE events ADD COLUMN icon_key TEXT NOT NULL DEFAULT 'event-general';
      ALTER TABLE events ADD COLUMN cinematic_cue TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE events ADD COLUMN strategic_effect TEXT;

      CREATE TABLE region_states (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        region_id TEXT NOT NULL,
        nation_code TEXT,
        population REAL NOT NULL DEFAULT 0 CHECK(population >= 0),
        displaced_population REAL NOT NULL DEFAULT 0 CHECK(displaced_population >= 0),
        wounded_population REAL NOT NULL DEFAULT 0 CHECK(wounded_population >= 0),
        infrastructure REAL NOT NULL DEFAULT 70 CHECK(infrastructure BETWEEN 0 AND 100),
        industrial_capacity REAL NOT NULL DEFAULT 50 CHECK(industrial_capacity BETWEEN 0 AND 100),
        supply REAL NOT NULL DEFAULT 70 CHECK(supply BETWEEN 0 AND 100),
        health REAL NOT NULL DEFAULT 70 CHECK(health BETWEEN 0 AND 100),
        habitability REAL NOT NULL DEFAULT 100 CHECK(habitability BETWEEN 0 AND 100),
        contamination REAL NOT NULL DEFAULT 0 CHECK(contamination BETWEEN 0 AND 100),
        radiation REAL NOT NULL DEFAULT 0 CHECK(radiation BETWEEN 0 AND 100),
        terrain TEXT NOT NULL DEFAULT 'plains' CHECK(terrain IN (
          'plains', 'forest', 'mountain', 'desert', 'urban', 'coastal', 'ocean'
        )),
        neighbors_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(game_id, region_id)
      ) STRICT;
      CREATE INDEX region_states_nation_idx ON region_states(game_id, nation_code);

      CREATE TABLE impact_zones (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        source_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK(kind IN (
          'conventional_strike', 'nuclear_strike', 'fire', 'epidemic', 'famine',
          'natural_disaster', 'industrial_disaster'
        )),
        label TEXT NOT NULL,
        coords_x REAL NOT NULL,
        coords_y REAL NOT NULL,
        radius REAL NOT NULL CHECK(radius > 0),
        intensity REAL NOT NULL CHECK(intensity BETWEEN 0 AND 100),
        radiation REAL NOT NULL DEFAULT 0 CHECK(radiation BETWEEN 0 AND 100),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX impact_zones_game_active_idx ON impact_zones(game_id, active);

      CREATE TABLE characters (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        nation_code TEXT,
        loyalty_nation_code TEXT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK(status IN ('active', 'wounded', 'captured', 'missing', 'dead')),
        region_id TEXT,
        destination_region_id TEXT,
        coords_x REAL,
        coords_y REAL,
        portrait_url TEXT,
        portrait_status TEXT NOT NULL DEFAULT 'fallback'
          CHECK(portrait_status IN ('historical', 'generated', 'fallback', 'pending')),
        history_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(game_id, name, nation_code)
      ) STRICT;
      CREATE INDEX characters_game_region_idx ON characters(game_id, region_id);

      CREATE TABLE strategic_orders (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        order_type TEXT NOT NULL CHECK(order_type IN (
          'move', 'attack', 'defend', 'retreat', 'patrol', 'intercept', 'bombard',
          'escort', 'landing', 'transport'
        )),
        origin_region_id TEXT NOT NULL,
        destination_region_id TEXT NOT NULL,
        target_unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
        directive TEXT NOT NULL DEFAULT '',
        route_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK(status IN ('queued', 'moving', 'intercepted', 'completed', 'cancelled')),
        progress REAL NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 1),
        start_date TEXT NOT NULL,
        arrival_date TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        expected_world_revision INTEGER NOT NULL CHECK(expected_world_revision >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(game_id, idempotency_key)
      ) STRICT;
      CREATE INDEX strategic_orders_game_status_idx ON strategic_orders(game_id, status);

      CREATE TABLE wars (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        attacker_nations_json TEXT NOT NULL,
        defender_nations_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'armistice', 'ended')),
        started_date TEXT NOT NULL,
        ended_date TEXT
      ) STRICT;
      CREATE INDEX wars_game_status_idx ON wars(game_id, status);

      CREATE TABLE fronts (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        war_id TEXT NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        region_ids_json TEXT NOT NULL,
        attacker_pressure REAL NOT NULL DEFAULT 50 CHECK(attacker_pressure BETWEEN 0 AND 100),
        defender_pressure REAL NOT NULL DEFAULT 50 CHECK(defender_pressure BETWEEN 0 AND 100),
        supply_status TEXT NOT NULL DEFAULT 'supplied'
          CHECK(supply_status IN ('supplied', 'strained', 'cut')),
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX fronts_game_war_idx ON fronts(game_id, war_id);

      CREATE TABLE intel_contacts (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        observer_nation_code TEXT NOT NULL,
        target_unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        intel_level TEXT NOT NULL CHECK(intel_level IN ('unknown', 'estimated', 'exact')),
        estimated_region_id TEXT,
        estimated_strength REAL CHECK(estimated_strength BETWEEN 0 AND 100),
        observed_at TEXT NOT NULL,
        UNIQUE(game_id, observer_nation_code, target_unit_id)
      ) STRICT;

      CREATE TABLE strategic_arsenals (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        nation_code TEXT NOT NULL,
        nuclear_stockpile INTEGER NOT NULL DEFAULT 0 CHECK(nuclear_stockpile >= 0),
        delivery_range REAL NOT NULL DEFAULT 0 CHECK(delivery_range >= 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(game_id, nation_code)
      ) STRICT;

      CREATE TABLE timeline_entries (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        game_date TEXT NOT NULL,
        turn_number INTEGER NOT NULL CHECK(turn_number > 0),
        sequence INTEGER NOT NULL CHECK(sequence >= 0),
        entry_kind TEXT NOT NULL CHECK(entry_kind IN (
          'event', 'movement_started', 'movement_progress', 'interception', 'battle',
          'arrival', 'impact', 'recovery', 'character'
        )),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
        entity_ids_json TEXT NOT NULL DEFAULT '[]',
        consequences_json TEXT NOT NULL DEFAULT '{}',
        cinematic_cue_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(game_id, turn_number, sequence)
      ) STRICT;
      CREATE INDEX timeline_entries_game_date_idx
      ON timeline_entries(game_id, game_date DESC, sequence ASC);
    `,
  },
  {
    version: 12,
    name: 'dated_historical_world',
    sql: `
      ALTER TABLE games ADD COLUMN historical_baseline_mode TEXT NOT NULL DEFAULT 'legacy_static'
        CHECK(historical_baseline_mode IN ('legacy_static', 'historical_v1'));
      ALTER TABLE games ADD COLUMN historical_catalog_version INTEGER;

      CREATE TABLE game_polities (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        nation_code TEXT NOT NULL,
        name_en TEXT NOT NULL,
        name_fr TEXT NOT NULL,
        capital_en TEXT,
        capital_fr TEXT,
        capital_region_id TEXT,
        ideology TEXT NOT NULL,
        government_type TEXT NOT NULL,
        is_major_power INTEGER NOT NULL CHECK(is_major_power IN (0, 1)),
        color TEXT NOT NULL,
        active_from TEXT NOT NULL,
        active_to TEXT,
        data_quality TEXT NOT NULL CHECK(data_quality IN ('historical', 'estimated')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(game_id, nation_code)
      ) STRICT;
      CREATE INDEX game_polities_game_name_idx ON game_polities(game_id, name_en);

      CREATE TABLE game_office_holders (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        office_key TEXT NOT NULL,
        holder_id TEXT NOT NULL,
        nation_code TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('head_of_state', 'head_of_government')),
        title_en TEXT NOT NULL,
        title_fr TEXT NOT NULL,
        holder_name TEXT NOT NULL,
        term_start TEXT NOT NULL,
        term_end TEXT,
        source TEXT NOT NULL CHECK(source IN ('wikidata', 'curated', 'simulation')),
        is_primary INTEGER NOT NULL CHECK(is_primary IN (0, 1)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(game_id, office_key)
      ) STRICT;
      CREATE INDEX game_office_holders_nation_idx ON game_office_holders(game_id, nation_code);

      CREATE TABLE historical_continuity (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL CHECK(entity_type IN ('polity', 'office', 'capital', 'region')),
        entity_id TEXT NOT NULL,
        continuity_status TEXT NOT NULL DEFAULT 'historical'
          CHECK(continuity_status IN ('historical', 'diverged')),
        diverged_at TEXT,
        reason TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(game_id, entity_type, entity_id)
      ) STRICT;

      CREATE TABLE historical_transition_runs (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        transition_id TEXT NOT NULL,
        effective_date TEXT NOT NULL,
        transition_kind TEXT NOT NULL CHECK(transition_kind IN ('office', 'territory', 'polity', 'capital')),
        status TEXT NOT NULL CHECK(status IN ('applied', 'skipped_divergence')),
        reason TEXT,
        applied_world_revision INTEGER NOT NULL CHECK(applied_world_revision >= 0),
        processed_at TEXT NOT NULL,
        PRIMARY KEY(game_id, transition_id)
      ) STRICT;

      ALTER TABLE characters ADD COLUMN office_holder_id TEXT;
      CREATE UNIQUE INDEX characters_game_office_holder_idx
        ON characters(game_id, office_holder_id) WHERE office_holder_id IS NOT NULL;
    `,
  },
  {
    version: 13,
    name: 'dated_territorial_statuses',
    sql: `
      ALTER TABLE game_regions ADD COLUMN territorial_status TEXT
        CHECK(territorial_status IN ('dependent_territory', 'overseas_territory'));
      ALTER TABLE game_regions ADD COLUMN administering_nation_code TEXT;

      UPDATE game_regions
      SET territorial_status = CASE
            WHEN (SELECT current_date FROM games WHERE games.id = game_regions.game_id)
                 >= '2002-02-26'
              THEN 'overseas_territory'
            ELSE 'dependent_territory'
          END,
          administering_nation_code = 'ENG',
          claim_nation_codes = CASE
            WHEN EXISTS (
              SELECT 1 FROM json_each(game_regions.claim_nation_codes)
              WHERE value = 'SPR'
            ) THEN claim_nation_codes
            ELSE json_insert(claim_nation_codes, '$[#]', 'SPR')
          END,
          updated_at = datetime('now')
      WHERE region_id = 'Gibraltar';
    `,
  },
  {
    version: 14,
    name: 'planned_and_imposed_actions',
    sql: `
      ALTER TABLE actions ADD COLUMN action_mode TEXT NOT NULL DEFAULT 'planned'
        CHECK(action_mode IN ('planned', 'imposed'));
      UPDATE actions SET action_mode = 'imposed' WHERE action_type = 'law';
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
