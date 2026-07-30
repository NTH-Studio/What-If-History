import { describe, expect, it } from 'vitest';
import {
  createActionInputSchema,
  createGameInputSchema,
  eventMapCueSchema,
  promulgateLawInputSchema,
} from './index.js';

describe('createGameInputSchema scenarios', () => {
  const base = { nationCode: 'FRA', startDate: '1936-01-01' };

  it('keeps historical API clients backwards compatible', () => {
    expect(createGameInputSchema.parse(base)).toEqual(base);
    expect(
      createGameInputSchema.parse({ ...base, scenario: { mode: 'historical' } }).scenario,
    ).toEqual({ mode: 'historical' });
  });

  it('trims and accepts a custom scenario premise', () => {
    expect(
      createGameInputSchema.parse({
        ...base,
        scenario: { mode: 'custom', premise: '  Une épidémie mondiale éclate.  ' },
      }).scenario,
    ).toEqual({ mode: 'custom', premise: 'Une épidémie mondiale éclate.' });
  });

  it('rejects empty and oversized custom scenario premises', () => {
    expect(
      createGameInputSchema.safeParse({
        ...base,
        scenario: { mode: 'custom', premise: '   ' },
      }).success,
    ).toBe(false);
    expect(
      createGameInputSchema.safeParse({
        ...base,
        scenario: { mode: 'custom', premise: 'x'.repeat(4_001) },
      }).success,
    ).toBe(false);
  });
});

describe('event map cues', () => {
  it('accepts a precise primary region and bounded secondary coordinates', () => {
    expect(
      eventMapCueSchema.parse({
        locations: [
          { kind: 'region', role: 'primary', region_id: 'Ile_de_France' },
          { kind: 'coordinates', role: 'secondary', coordinates: [706.2, 139.2] },
        ],
      }),
    ).toEqual({
      camera: 'auto',
      locations: [
        { kind: 'region', role: 'primary', region_id: 'Ile_de_France' },
        { kind: 'coordinates', role: 'secondary', coordinates: [706.2, 139.2] },
      ],
    });
  });

  it('rejects coordinates outside the campaign map', () => {
    expect(
      eventMapCueSchema.safeParse({
        locations: [{ kind: 'coordinates', coordinates: [1500, 700] }],
      }).success,
    ).toBe(false);
  });
});

describe('law action schemas', () => {
  it('accepts laws while keeping direct promulgation text bounded', () => {
    expect(
      createActionInputSchema.parse({
        actionText: 'Créer un service de santé.',
        actionType: 'law',
      }),
    ).toMatchObject({ actionType: 'law' });
    expect(promulgateLawInputSchema.parse({ actionText: '  Fermer les frontières.  ' })).toEqual({
      actionText: 'Fermer les frontières.',
    });
    expect(promulgateLawInputSchema.safeParse({ actionText: '   ' }).success).toBe(false);
  });
});
