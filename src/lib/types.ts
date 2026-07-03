export type UUID = string;

export type LanguageCode = 'en' | 'zh-Hans' | 'zh-Hant' | 'unknown';

export interface IdentityProfile {
  firstName: string;
  middleName?: string;
  lastName: string;
  fullName?: string;
  preferredName?: string;
  headline?: string;
}

export interface ContactProfile {
  email: string;
  phone?: string;
  countryCode?: string;
}

export interface AddressProfile {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface LinkProfile {
  id: UUID;
  label: string;
  url: string;
  kind?: 'linkedin' | 'github' | 'portfolio' | 'website' | 'other';
}

export interface EducationEntry {
  id: UUID;
  school: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
  gpa?: string;
}

export interface EmploymentEntry {
  id: UUID;
  company: string;
  title: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
  description?: string;
}

export interface SkillEntry {
  id: UUID;
  name: string;
  level?: string;
}

export interface LanguageEntry {
  id: UUID;
  name: string;
  proficiency?: string;
}

export interface WorkAuthorizationProfile {
  legallyAuthorized?: boolean;
  requireSponsorship?: boolean;
  citizenship?: string;
  visaStatus?: string;
}

export interface PreferencesProfile {
  desiredTitle?: string;
  desiredLocation?: string;
  remotePreference?: 'remote' | 'hybrid' | 'onsite' | 'flexible';
  salaryExpectation?: string;
  noticePeriod?: string;
}

export interface DemographicsProfile {
  gender?: string;
  ethnicity?: string;
  veteranStatus?: string;
  disabilityStatus?: string;
}

export interface ReusableAnswer {
  id: UUID;
  question: string;
  answer: string;
  language?: LanguageCode;
  tags?: string[];
  source?: 'manual' | 'learned';
  learnedFrom?: {
    domain: string;
    pageTitle?: string;
    fieldId?: string;
    firstSeenAt: string;
    lastSeenAt: string;
    observationCount: number;
  };
}

export interface ResumeMetadata {
  fileName?: string;
  mimeType?: string;
  size?: number;
  importedAt?: string;
  textHash?: string;
}

export interface ProfileV1 {
  schemaVersion: 1;
  identity: IdentityProfile;
  contact: ContactProfile;
  address: AddressProfile;
  links: LinkProfile[];
  workAuthorization: WorkAuthorizationProfile;
  preferences: PreferencesProfile;
  education: EducationEntry[];
  employment: EmploymentEntry[];
  skills: SkillEntry[];
  languages: LanguageEntry[];
  demographics: DemographicsProfile;
  reusableAnswers: ReusableAnswer[];
  resume: ResumeMetadata;
  updatedAt: string;
}

export type Profile = ProfileV1;

export type SupportedProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'moonshot'
  | 'zhipu'
  | 'deepseek'
  | 'openrouter'
  | 'openai-compatible';

export interface ProviderConfig {
  provider: SupportedProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  enabled: boolean;
}

export interface ExtensionSettings {
  onboarded: boolean;
  globalPaused: boolean;
  pausedSites: Record<string, boolean>;
  autoAiAnalysis: boolean;
  learnFromUserInput: boolean;
  debugMode: boolean;
  languageScope: LanguageCode[];
  provider: ProviderConfig;
}

export type FieldKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'file'
  | 'number'
  | 'password'
  | 'payment'
  | 'hidden'
  | 'unknown';

export interface FieldOption {
  label: string;
  value: string;
  selected?: boolean;
}

export interface FieldDescriptor {
  id: string;
  kind: FieldKind;
  tagName: string;
  inputType?: string;
  name?: string;
  idAttribute?: string;
  autocomplete?: string;
  label?: string;
  ariaLabel?: string;
  placeholder?: string;
  nearbyText?: string;
  questionText: string;
  options: FieldOption[];
  required: boolean;
  visible: boolean;
  disabled: boolean;
  readonly: boolean;
  ats?: string;
  path: string;
  language: LanguageCode;
}

export interface FieldMapping {
  fieldId: string;
  value: string | boolean | string[];
  source:
    | 'ats'
    | 'autocomplete'
    | 'dictionary'
    | 'ai-cache'
    | 'ai-live'
    | 'reusable-answer'
    | 'resume-file';
  confidence: number;
  profilePath?: string;
  explanation?: string;
}

export interface AutofillPreviewItem {
  fieldId: string;
  label: string;
  valuePreview: string;
  kind: FieldKind;
  source: FieldMapping['source'];
  confidence: number;
  profilePath?: string;
}

export interface AutofillResult {
  filled: number;
  unresolved: number;
  failed: number;
  skipped: number;
  reviewItems: string[];
  mappings: FieldMapping[];
  actions: AutofillAction[];
}

export type AutofillActionStatus = 'detected' | 'filled' | 'unresolved' | 'skipped' | 'failed';

export interface AutofillAction {
  status: AutofillActionStatus;
  fieldId?: string;
  fieldLabel?: string;
  questionText?: string;
  kind?: FieldKind;
  source?: FieldMapping['source'];
  confidence?: number;
  profilePath?: string;
  valuePreview?: string;
  reason: string;
  timestamp: string;
}

export interface FillRecord {
  fieldId: string;
  previousValue: unknown;
  previousChecked?: boolean;
  newValue: unknown;
  timestamp: string;
}

export interface FillSession {
  id: string;
  url: string;
  domain: string;
  records: FillRecord[];
  createdAt: string;
}

export interface LearnedFieldValue {
  descriptor: FieldDescriptor;
  value: string;
  valueLabel?: string;
  pageTitle: string;
  domain: string;
  url: string;
  observedAt: string;
}
