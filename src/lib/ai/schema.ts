import { z } from 'zod';

export const fieldMappingSchema = z.object({
  fieldId: z.string(),
  value: z.union([z.string(), z.boolean(), z.array(z.string())]),
  source: z.enum(['ai-live', 'ai-cache']).catch('ai-live'),
  confidence: z.number().min(0).max(1),
  profilePath: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  explanation: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined)
});

export const fieldMappingsSchema = z.object({
  mappings: z.array(fieldMappingSchema)
});

export const profileExtractionSchema = z.object({
  profilePatch: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string())
}).strict();

export const profileExtractionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    profilePatch: {
      type: 'object',
      description:
        'Partial ProfileV1 object. Include only fields explicitly supported by the CV text. Prefer identity, contact, address, links, education, employment, skills, languages, workAuthorization, preferences, and demographics.'
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    warnings: { type: 'array', items: { type: 'string' } }
  },
  required: ['profilePatch', 'confidence', 'warnings']
};

export const fieldMappingsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fieldId: { type: 'string' },
          value: {
            anyOf: [
              { type: 'string' },
              { type: 'boolean' },
              { type: 'array', items: { type: 'string' } }
            ]
          },
          source: { type: 'string', enum: ['ai-live', 'ai-cache'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          profilePath: { type: ['string', 'null'] },
          explanation: { type: ['string', 'null'] }
        },
        required: ['fieldId', 'value', 'source', 'confidence', 'profilePath', 'explanation']
      }
    }
  },
  required: ['mappings']
};
