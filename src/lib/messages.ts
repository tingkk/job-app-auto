import type { AutofillResult, FieldDescriptor, FieldMapping, FillSession, LearnedFieldValue, ProviderConfig } from './types';
import type { AiProfileExtraction } from './ai/types';

export type RuntimeMessage =
  | { type: 'GET_FILL_CONTEXT'; descriptors: FieldDescriptor[]; pageTitle: string; domain: string; ats?: string }
  | { type: 'SAVE_FILL_SESSION'; session: FillSession }
  | { type: 'LEARN_FIELD_VALUES'; observations: LearnedFieldValue[] }
  | { type: 'EXTRACT_PROFILE_FROM_CV'; cvText: string }
  | { type: 'UNDO_LAST_FILL' }
  | { type: 'FETCH_PROVIDER_MODELS'; provider: ProviderConfig }
  | { type: 'GET_STATUS'; domain?: string }
  | { type: 'SET_GLOBAL_PAUSED'; paused: boolean }
  | { type: 'SET_SITE_PAUSED'; domain: string; paused: boolean };

export interface FillContextResponse {
  paused: boolean;
  mappings: FieldMapping[];
  debugMode?: boolean;
  debugData?: FillContextDebugData;
  result?: AutofillResult;
}

export interface FillContextDebugData {
  profileFields: Array<{
    path: string;
    value: unknown;
    empty: boolean;
  }>;
  learnedFields: Array<{
    id: string;
    question: string;
    answer: string;
    source?: string;
    tags?: string[];
    domain?: string;
    observationCount?: number;
    lastSeenAt?: string;
  }>;
}

export interface ExtractProfileFromCvResponse {
  extraction?: AiProfileExtraction;
  error?: string;
}

export function sendRuntimeMessage<T>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}
