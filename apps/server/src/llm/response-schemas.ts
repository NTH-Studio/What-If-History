const nationCode = { type: 'string' } as const;
const unitType = {
  type: 'string',
  enum: ['infantry', 'armor', 'naval', 'air', 'artillery'],
} as const;

const location = {
  oneOf: [
    {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['primary', 'secondary'] },
        label: { type: 'string' },
        kind: { const: 'region' },
        region_id: { type: 'string' },
      },
      required: ['role', 'kind', 'region_id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['primary', 'secondary'] },
        label: { type: 'string' },
        kind: { const: 'feature' },
        feature_id: { type: 'string' },
      },
      required: ['role', 'kind', 'feature_id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['primary', 'secondary'] },
        label: { type: 'string' },
        kind: { const: 'unit' },
        unit_id: { type: 'string' },
      },
      required: ['role', 'kind', 'unit_id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['primary', 'secondary'] },
        label: { type: 'string' },
        kind: { const: 'nation' },
        nation_code: nationCode,
      },
      required: ['role', 'kind', 'nation_code'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['primary', 'secondary'] },
        label: { type: 'string' },
        kind: { const: 'coordinates' },
        coordinates: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      },
      required: ['role', 'kind', 'coordinates'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['primary', 'secondary'] },
        label: { type: 'string' },
        kind: { const: 'global' },
      },
      required: ['role', 'kind'],
      additionalProperties: false,
    },
  ],
} as const;

const unitChange = {
  oneOf: [
    {
      type: 'object',
      properties: {
        operation: { const: 'create' },
        name: { type: 'string' },
        unit_type: unitType,
        nation_code: nationCode,
        region_id: { type: 'string' },
        strength: { type: 'number' },
        organization: { type: 'number' },
      },
      required: ['operation', 'name', 'unit_type', 'nation_code', 'region_id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        operation: { const: 'move' },
        unit_id: { type: 'string' },
        region_id: { type: 'string' },
      },
      required: ['operation', 'unit_id', 'region_id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        operation: { const: 'update' },
        unit_id: { type: 'string' },
        strength: { type: 'number' },
        organization: { type: 'number' },
        experience: { type: 'number' },
      },
      required: ['operation', 'unit_id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        operation: { const: 'delete' },
        unit_id: { type: 'string' },
      },
      required: ['operation', 'unit_id'],
      additionalProperties: false,
    },
  ],
} as const;

const featureChange = {
  oneOf: [
    {
      type: 'object',
      properties: {
        operation: { const: 'create' },
        name: { type: 'string' },
        feature_type: {
          type: 'string',
          enum: ['city', 'capital', 'battalion', 'custom'],
        },
        region_id: { type: 'string' },
        nation_code: nationCode,
        color: { type: 'string' },
        symbol: { type: 'string' },
      },
      required: ['operation', 'name', 'feature_type', 'region_id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        operation: { const: 'update' },
        feature_id: { type: 'string' },
        name: { type: 'string' },
        region_id: { type: 'string' },
        nation_code: nationCode,
        color: { type: 'string' },
        symbol: { type: 'string' },
      },
      required: ['operation', 'feature_id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        operation: { const: 'delete' },
        feature_id: { type: 'string' },
      },
      required: ['operation', 'feature_id'],
      additionalProperties: false,
    },
  ],
} as const;

const lawChange = {
  oneOf: [
    {
      type: 'object',
      properties: {
        operation: { const: 'enact' },
        nation_code: nationCode,
        title_fr: { type: 'string' },
        title_en: { type: 'string' },
        summary_fr: { type: 'string' },
        summary_en: { type: 'string' },
        category: {
          type: 'string',
          enum: [
            'constitution',
            'economy',
            'labor',
            'security',
            'military',
            'social',
            'trade',
            'other',
          ],
        },
      },
      required: [
        'operation',
        'nation_code',
        'title_fr',
        'title_en',
        'summary_fr',
        'summary_en',
        'category',
      ],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        operation: { const: 'repeal' },
        nation_code: nationCode,
        law_id: { type: 'string' },
      },
      required: ['operation', 'nation_code', 'law_id'],
      additionalProperties: false,
    },
  ],
} as const;

const strategicEffect = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'nuclear_strike' },
        intensity: { type: 'number', minimum: 1, maximum: 100 },
        target_region_id: { type: 'string' },
        source_nation_code: nationCode,
        vector: {
          type: 'string',
          enum: ['bomber', 'ballistic_missile', 'submarine_missile', 'editor'],
        },
        editor_override: { type: 'boolean' },
      },
      required: [
        'kind',
        'intensity',
        'target_region_id',
        'source_nation_code',
        'vector',
        'editor_override',
      ],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'conventional_strike',
            'fire',
            'epidemic',
            'famine',
            'natural_disaster',
            'industrial_disaster',
          ],
        },
        intensity: { type: 'number', minimum: 1, maximum: 100 },
        target_region_id: { type: 'string' },
      },
      required: ['kind', 'intensity', 'target_region_id'],
      additionalProperties: false,
    },
  ],
} as const;

const characterChange = {
  oneOf: [
    {
      type: 'object',
      properties: {
        operation: { const: 'create' },
        name: { type: 'string' },
        role: { type: 'string' },
        nation_code: { oneOf: [nationCode, { type: 'null' }] },
        loyalty_nation_code: { oneOf: [nationCode, { type: 'null' }] },
        region_id: { type: 'string' },
      },
      required: ['operation', 'name', 'role', 'nation_code', 'region_id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        operation: { const: 'update' },
        character_id: { type: 'string' },
        role: { type: 'string' },
        status: {
          type: 'string',
          enum: ['active', 'wounded', 'captured', 'missing', 'dead'],
        },
        region_id: { type: 'string' },
        destination_region_id: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['operation', 'character_id'],
      additionalProperties: false,
    },
  ],
} as const;

export const actionValidationResponseSchema = {
  type: 'object',
  properties: {
    accepted: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['accepted', 'reason'],
  additionalProperties: false,
} as const;

export const generatedTurnResponseSchema = {
  type: 'object',
  properties: {
    time_advance_amount: { type: 'integer' },
    events: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          event_type: {
            type: 'string',
            enum: ['military', 'political', 'economic', 'diplomatic', 'social'],
          },
          severity: {
            type: 'string',
            enum: ['minor', 'moderate', 'major', 'critical'],
          },
          affected_nations: { type: 'array', items: nationCode },
          state_changes: { type: 'object' },
          subtype: { type: 'string' },
          icon_key: { type: 'string' },
          strategic_effect: strategicEffect,
          map_cue: {
            type: 'object',
            properties: {
              locations: { type: 'array', items: location },
              camera: {
                type: 'string',
                enum: ['auto', 'point', 'bounds', 'nation', 'world'],
              },
            },
            required: ['locations', 'camera'],
            additionalProperties: false,
          },
        },
        required: [
          'title',
          'description',
          'event_type',
          'severity',
          'affected_nations',
          'state_changes',
          'map_cue',
        ],
        additionalProperties: false,
      },
    },
    law_changes: { type: 'array', items: lawChange },
    region_changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          region_id: { type: 'string' },
          owner_nation_code: nationCode,
          controller_nation_code: nationCode,
          claim_nation_codes: { type: 'array', items: nationCode },
          region_type: {
            type: 'string',
            enum: ['land', 'coastal', 'ocean', 'strait'],
          },
        },
        required: ['region_id'],
        additionalProperties: false,
      },
    },
    unit_changes: { type: 'array', items: unitChange },
    map_feature_changes: { type: 'array', items: featureChange },
    character_changes: { type: 'array', items: characterChange },
  },
  required: [
    'events',
    'law_changes',
    'region_changes',
    'unit_changes',
    'map_feature_changes',
    'character_changes',
  ],
  additionalProperties: false,
} as const;

export interface GeneratedTurnResponseIdentifiers {
  nationCodes: string[];
  regionIds: string[];
  unitIds: string[];
  characterIds: string[];
  featureIds: string[];
  lawIds: string[];
}

type SchemaRecord = Record<string, unknown>;

function record(value: unknown): SchemaRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid generated-turn response schema node.');
  }
  return value as SchemaRecord;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid generated-turn response schema array.');
  }
  return value;
}

function property(schema: SchemaRecord, name: string) {
  return record(record(schema.properties)[name]);
}

function setEnum(schema: SchemaRecord, values: string[]) {
  schema.type = 'string';
  schema.enum = [...new Set(values)];
}

function branch(schema: SchemaRecord, discriminator: string, value: string) {
  return array(schema.oneOf)
    .map(record)
    .find((candidate) => property(candidate, discriminator).const === value);
}

function removeBranch(schema: SchemaRecord, discriminator: string, value: string) {
  schema.oneOf = array(schema.oneOf)
    .map(record)
    .filter((candidate) => property(candidate, discriminator).const !== value);
}

function constrainBranchIdentifier(
  schema: SchemaRecord,
  discriminator: string,
  operation: string,
  identifier: string,
  values: string[],
) {
  if (values.length === 0) {
    removeBranch(schema, discriminator, operation);
    return;
  }
  const selected = branch(schema, discriminator, operation);
  if (!selected) throw new Error(`Missing ${operation} response-schema branch.`);
  setEnum(property(selected, identifier), values);
}

export function generatedTurnResponseSchemaFor(identifiers: GeneratedTurnResponseIdentifiers) {
  const schema = record(structuredClone(generatedTurnResponseSchema));
  const rootProperties = record(schema.properties);
  const event = record(record(rootProperties.events).items);
  const eventProperties = record(event.properties);
  setEnum(record(record(eventProperties.affected_nations).items), identifiers.nationCodes);
  const effect = record(eventProperties.strategic_effect);
  const nuclearEffect = branch(effect, 'kind', 'nuclear_strike');
  if (nuclearEffect) {
    setEnum(property(nuclearEffect, 'target_region_id'), identifiers.regionIds);
    setEnum(property(nuclearEffect, 'source_nation_code'), identifiers.nationCodes);
  }
  const disasterEffect = array(effect.oneOf)
    .map(record)
    .find((candidate) => {
      const kind = property(candidate, 'kind');
      return Array.isArray(kind.enum);
    });
  if (disasterEffect) setEnum(property(disasterEffect, 'target_region_id'), identifiers.regionIds);

  const locations = record(property(property(event, 'map_cue'), 'locations').items);
  constrainBranchIdentifier(locations, 'kind', 'region', 'region_id', identifiers.regionIds);
  constrainBranchIdentifier(locations, 'kind', 'feature', 'feature_id', identifiers.featureIds);
  constrainBranchIdentifier(locations, 'kind', 'unit', 'unit_id', identifiers.unitIds);
  constrainBranchIdentifier(locations, 'kind', 'nation', 'nation_code', identifiers.nationCodes);

  const laws = record(record(rootProperties.law_changes).items);
  const enactLaw = branch(laws, 'operation', 'enact');
  if (enactLaw) setEnum(property(enactLaw, 'nation_code'), identifiers.nationCodes);
  const repealLaw = branch(laws, 'operation', 'repeal');
  if (repealLaw) setEnum(property(repealLaw, 'nation_code'), identifiers.nationCodes);
  constrainBranchIdentifier(laws, 'operation', 'repeal', 'law_id', identifiers.lawIds);

  const regions = record(record(rootProperties.region_changes).items);
  setEnum(property(regions, 'region_id'), identifiers.regionIds);
  setEnum(property(regions, 'owner_nation_code'), identifiers.nationCodes);
  setEnum(property(regions, 'controller_nation_code'), identifiers.nationCodes);
  setEnum(record(property(regions, 'claim_nation_codes').items), identifiers.nationCodes);

  const units = record(record(rootProperties.unit_changes).items);
  const createUnit = branch(units, 'operation', 'create');
  if (createUnit) {
    setEnum(property(createUnit, 'nation_code'), identifiers.nationCodes);
    setEnum(property(createUnit, 'region_id'), identifiers.regionIds);
  }
  constrainBranchIdentifier(units, 'operation', 'move', 'unit_id', identifiers.unitIds);
  const moveUnit = branch(units, 'operation', 'move');
  if (moveUnit) setEnum(property(moveUnit, 'region_id'), identifiers.regionIds);
  constrainBranchIdentifier(units, 'operation', 'update', 'unit_id', identifiers.unitIds);
  constrainBranchIdentifier(units, 'operation', 'delete', 'unit_id', identifiers.unitIds);

  const features = record(record(rootProperties.map_feature_changes).items);
  const createFeature = branch(features, 'operation', 'create');
  if (createFeature) {
    setEnum(property(createFeature, 'region_id'), identifiers.regionIds);
    setEnum(property(createFeature, 'nation_code'), identifiers.nationCodes);
  }
  constrainBranchIdentifier(features, 'operation', 'update', 'feature_id', identifiers.featureIds);
  const updateFeature = branch(features, 'operation', 'update');
  if (updateFeature) {
    setEnum(property(updateFeature, 'region_id'), identifiers.regionIds);
    setEnum(property(updateFeature, 'nation_code'), identifiers.nationCodes);
  }
  constrainBranchIdentifier(features, 'operation', 'delete', 'feature_id', identifiers.featureIds);

  const characters = record(record(rootProperties.character_changes).items);
  const createCharacter = branch(characters, 'operation', 'create');
  if (createCharacter) {
    setEnum(property(createCharacter, 'region_id'), identifiers.regionIds);
  }
  constrainBranchIdentifier(
    characters,
    'operation',
    'update',
    'character_id',
    identifiers.characterIds,
  );
  const updateCharacter = branch(characters, 'operation', 'update');
  if (updateCharacter) setEnum(property(updateCharacter, 'region_id'), identifiers.regionIds);

  return schema;
}
