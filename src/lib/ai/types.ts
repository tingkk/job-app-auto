import type { FieldDescriptor, FieldMapping, ProfileV1, ProviderConfig } from '../types';

export interface AiProfileExtraction {
  profilePatch: Partial<ProfileV1>;
  confidence: number;
  warnings: string[];
}

export interface AiMapFieldsInput {
  profile: ProfileV1;
  fields: FieldDescriptor[];
  pageTitle: string;
  jobDescription?: string;
  domain: string;
  ats?: string;
  language: string;
}

export interface AIProvider {
  id: string;
  label: string;
  defaultBaseUrl?: string;
  validateConfiguration(config: ProviderConfig): Promise<void>;
  listModels?(config: ProviderConfig): Promise<Array<{ id: string; label?: string }>>;
  extractProfile(config: ProviderConfig, cvText: string): Promise<AiProfileExtraction>;
  mapFields(config: ProviderConfig, input: AiMapFieldsInput): Promise<FieldMapping[]>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly code: 'missing-key' | 'missing-model' | 'network' | 'invalid-response' | 'unsupported'
  ) {
    super(message);
  }
}
