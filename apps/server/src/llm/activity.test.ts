import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Catalog } from '../catalog.js';
import { projectRoot } from '../config.js';
import { openDatabase } from '../db/database.js';
import { Repository } from '../db/repository.js';
import { LlmActivityHub, LlmActivityTracker } from './activity.js';

describe('persisted LLM activity', () => {
  let repository: Repository;
  let tracker: LlmActivityTracker;
  let database: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    database = openDatabase(':memory:');
    repository = new Repository(database, new Catalog(path.join(projectRoot, 'data')));
    repository.saveLlmSettings({
      provider: 'fake',
      apiUrl: 'http://127.0.0.1:9/v1',
      model: 'deterministic',
      clearApiKey: false,
    });
    tracker = new LlmActivityTracker(repository, new LlmActivityHub(), pino({ level: 'silent' }));
  });

  afterEach(() => database.close());

  it('persists phases, duration, usage and campaign metadata', () => {
    const game = repository.createGame({
      nationCode: 'FRA',
      startDate: '1936-01-01',
      name: 'Tracked campaign',
    });
    const handle = tracker.start({
      gameId: game.id,
      gameName: game.name,
      requestId: 'request-safe',
      clientId: '10000000-0000-4000-8000-000000000001',
      type: 'advisor',
    });
    handle.phase('waiting_provider');
    handle.phase('validating_response');
    handle.phase('applying_result');
    handle.succeed({ inputTokens: 14, outputTokens: 6, totalTokens: 20 });

    const [activity] = tracker.list('10000000-0000-4000-8000-000000000001', {
      gameId: game.id,
      limit: 100,
    });
    expect(activity).toMatchObject({
      gameId: game.id,
      gameName: 'Tracked campaign',
      type: 'advisor',
      phase: 'applying_result',
      status: 'succeeded',
      initiatedHere: true,
      usage: { inputTokens: 14, outputTokens: 6, totalTokens: 20 },
    });
    expect(activity?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('marks interrupted calls as failed after a server restart', () => {
    tracker.start({
      requestId: 'before-restart',
      clientId: '10000000-0000-4000-8000-000000000001',
      type: 'connection_test',
    });

    expect(tracker.recoverInterruptedCalls()).toBe(1);
    expect(tracker.list('different-client', { limit: 100 })[0]).toMatchObject({
      status: 'failed',
      errorCode: 'SERVER_RESTARTED',
      initiatedHere: false,
    });
  });

  it('keeps active calls and only the 100 newest completed calls', () => {
    repository.createLlmCall({
      id: randomUUID(),
      gameId: null,
      gameName: null,
      requestId: 'still-running',
      clientId: 'client',
      type: 'advisor',
      provider: 'fake',
      model: 'deterministic',
    });
    for (let index = 0; index < 105; index += 1) {
      const record = repository.createLlmCall({
        id: randomUUID(),
        gameId: null,
        gameName: null,
        requestId: `completed-${index}`,
        clientId: 'client',
        type: 'advisor',
        provider: 'fake',
        model: 'deterministic',
      });
      repository.completeLlmCall(record.id, null);
    }

    const records = repository.listLlmCalls({ limit: 100 });
    expect(records).toHaveLength(101);
    expect(records[0]?.status).toBe('running');
    expect(records.filter((record) => record.status !== 'running')).toHaveLength(100);
  });
});
