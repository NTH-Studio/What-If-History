import { describe, expect, it } from 'vitest';
import { generatedTurnResponseSchemaFor } from './response-schemas.js';

describe('generated turn response schema', () => {
  it('constrains mutable identifiers to values present in the compact campaign context', () => {
    const schema = generatedTurnResponseSchemaFor({
      nationCodes: ['FRA', 'GER'],
      regionIds: ['Ile_de_France', 'Brandenburg'],
      unitIds: ['00000000-0000-4000-8000-000000000001'],
      characterIds: ['00000000-0000-4000-8000-000000000004'],
      featureIds: ['00000000-0000-4000-8000-000000000002'],
      lawIds: ['00000000-0000-4000-8000-000000000003'],
    });

    expect(schema).toMatchObject({
      properties: {
        events: {
          items: {
            properties: {
              affected_nations: {
                items: { enum: ['FRA', 'GER'] },
              },
            },
          },
        },
        region_changes: {
          items: {
            properties: {
              region_id: { enum: ['Ile_de_France', 'Brandenburg'] },
              owner_nation_code: { enum: ['FRA', 'GER'] },
            },
          },
        },
        unit_changes: {
          items: {
            oneOf: expect.arrayContaining([
              expect.objectContaining({
                properties: expect.objectContaining({
                  operation: { const: 'move' },
                  unit_id: expect.objectContaining({
                    enum: ['00000000-0000-4000-8000-000000000001'],
                  }),
                  region_id: expect.objectContaining({
                    enum: ['Ile_de_France', 'Brandenburg'],
                  }),
                }),
              }),
            ]),
          },
        },
      },
    });
    const serialized = JSON.stringify(schema);
    expect(serialized).toContain('"strategic_effect"');
    expect(serialized).toContain(
      '"target_region_id":{"type":"string","enum":["Ile_de_France","Brandenburg"]}',
    );
    expect(serialized).toContain(
      '"character_id":{"type":"string","enum":["00000000-0000-4000-8000-000000000004"]}',
    );
  });

  it('removes mutation branches that cannot reference an existing object', () => {
    const schema = generatedTurnResponseSchemaFor({
      nationCodes: ['FRA'],
      regionIds: ['Ile_de_France'],
      unitIds: [],
      characterIds: [],
      featureIds: [],
      lawIds: [],
    });
    const serialized = JSON.stringify(schema);

    expect(serialized).not.toContain('"const":"move"');
    expect(serialized).not.toContain('"const":"update"');
    expect(serialized).not.toContain('"const":"delete"');
    expect(serialized).not.toContain('"const":"repeal"');
  });
});
