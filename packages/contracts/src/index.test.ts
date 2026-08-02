import { describe, expect, it } from 'vitest';
import { createActionInputSchema, worldEffectSchema } from './index.js';

const id = '10000000-0000-4000-8000-000000000001';

describe('WorldEffect contract', () => {
  it('defaults new actions to planned and accepts the explicit imposed mode', () => {
    expect(createActionInputSchema.parse({ actionText: 'Préparer une réserve.' })).toMatchObject({
      mode: 'planned',
    });
    expect(
      createActionInputSchema.parse({
        actionText: 'Le chef du gouvernement démissionne.',
        mode: 'imposed',
      }),
    ).toMatchObject({ mode: 'imposed' });
  });

  it.each([
    { kind: 'territory', operation: 'cede', regionId: 'Ile_de_France', nationCode: 'GER' },
    { kind: 'territory', operation: 'annex', regionId: 'Alsace', nationCode: 'GER' },
    { kind: 'territory', operation: 'occupy', regionId: 'Alsace', nationCode: 'GER' },
    { kind: 'territory', operation: 'liberate', regionId: 'Alsace', nationCode: 'FRA' },
    { kind: 'territory', operation: 'add_claim', regionId: 'Alsace', nationCode: 'GER' },
    { kind: 'territory', operation: 'remove_claim', regionId: 'Alsace', nationCode: 'GER' },
    {
      kind: 'unit',
      operation: 'create',
      name: '1re division',
      unitType: 'infantry',
      nationCode: 'FRA',
      regionId: 'Ile_de_France',
    },
    { kind: 'unit', operation: 'move', unitId: id, regionId: 'Alsace' },
    { kind: 'unit', operation: 'update', unitId: id, strength: 70 },
    { kind: 'unit', operation: 'delete', unitId: id },
    {
      kind: 'feature',
      operation: 'create',
      name: 'Fort',
      featureType: 'custom',
      regionId: 'Alsace',
      nationCode: 'FRA',
    },
    { kind: 'feature', operation: 'update', featureId: id, nationCode: 'GER' },
    { kind: 'feature', operation: 'delete', featureId: id },
    {
      kind: 'law',
      operation: 'enact',
      nationCode: 'FRA',
      title: 'Mobilisation',
      summary: '',
      category: 'military',
    },
    { kind: 'law', operation: 'repeal', nationCode: 'FRA', lawId: id },
    { kind: 'capital', operation: 'set', nationCode: 'FRA', featureId: id },
    {
      kind: 'nation',
      operation: 'adjust',
      nationCode: 'FRA',
      changes: { stability: -5, atWar: true, allies: ['GBR'] },
    },
  ])('accepts $kind/$operation', (effect) => {
    expect(worldEffectSchema.safeParse(effect).success).toBe(true);
  });

  it('rejects malformed identifiers and oversized effect queues', () => {
    expect(
      worldEffectSchema.safeParse({
        kind: 'unit',
        operation: 'move',
        unitId: 'not-a-uuid',
        regionId: '',
      }).success,
    ).toBe(false);

    expect(
      createActionInputSchema.safeParse({
        actionText: 'Ordre massif',
        mode: 'planned',
        effects: Array.from({ length: 101 }, () => ({
          kind: 'territory',
          operation: 'add_claim',
          regionId: 'Alsace',
          nationCode: 'GER',
        })),
        previewWorldRevision: 0,
      }).success,
    ).toBe(false);
  });
});
