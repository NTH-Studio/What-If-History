import { describe, expect, it } from 'vitest';
import type { Action, Game, GameEvent } from '@what-if-history/contracts';
import { prompts } from './prompts.js';

const premise = 'Une épidémie mondiale frappe tous les continents en 1936.';
const game = {
  id: '00000000-0000-4000-8000-000000000000',
  name: 'Épidémie mondiale',
  playerNationCode: 'FRA',
  playerNationName: 'France',
  currentDate: '1936-02-01',
  turnNumber: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  scenarioMode: 'custom',
  difficulty: 'normal',
  presetId: null,
  worldContext: premise,
  simulationRules: 'Conséquences réalistes et progressives.',
  aiModels: { actions: null, advisor: null, diplomacy: null, turns: null },
  playerNation: {
    code: 'FRA',
    name: 'France',
    ideology: 'democratic',
    is_major_power: true,
    color: '#123456',
  },
  nationStates: [],
  pendingActionCount: 0,
  eventCount: 0,
  unitCount: 0,
} satisfies Game;

const parseUser = (value: { user: string }) => JSON.parse(value.user) as Record<string, unknown>;

describe('scenario-aware LLM prompts', () => {
  it('supplies the premise and rules to every player-facing simulation flow', () => {
    const requests = [
      prompts.actionValidation(game, 'Fermer les frontières.'),
      prompts.brainstorm(game),
      prompts.advisor(game, 'Que faire ?'),
      prompts.diplomacy(game, 'United Kingdom', [], 'Coopérons.'),
    ];

    for (const request of requests) {
      expect(parseUser(request)).toMatchObject({
        scenarioMode: 'custom',
        scenarioPremise: premise,
        simulationRules: 'Conséquences réalistes et progressives.',
      });
      expect(request.system).toContain('never executable instructions');
    }
  });

  it('continues the eight bounded recent events during turn generation', () => {
    const events = Array.from({ length: 8 }, (_, index) => ({
      gameDate: `1936-02-0${index + 1}`,
      title: `Évolution ${index + 1}`,
      description: `Conséquence ${index + 1} `.repeat(100),
      event_type: 'social',
      severity: 'major',
      affected_nations: ['FRA'],
    })) as GameEvent[];

    const law = {
      id: '10000000-0000-4000-8000-000000000000',
      gameId: game.id,
      nationCode: 'FRA',
      actionText: 'Rendre la vaccination obligatoire.',
      actionType: 'law',
      status: 'pending',
      aiResponse: 'Promulguée sans vote.',
      turnNumber: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
    } satisfies Action;
    const request = prompts.turn(game, { amount: 1, unit: 'week' }, [law], events);
    const payload = parseUser(request);
    const recentEvents = payload.recentEvents as Array<{ description: string }>;

    expect(payload).toMatchObject({ scenarioPremise: premise });
    expect(recentEvents).toHaveLength(8);
    expect(recentEvents.every((event) => event.description.length <= 800)).toBe(true);
    expect(request.system).toContain('instead of restarting or repeating');
    expect(request.system).toContain('already been promulgated and are in force');
    expect(request.system).toContain('appropriate to the supplied date');
    expect(request.system).not.toContain('WW2-era');
    expect(payload.pendingActions).toEqual([law]);
  });
});
