import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/ui/styles.css';
import { applyProfilePatch, cleanCvWarnings, extractCv, mergeCvProfilePatches, previewProfilePatch } from '../../src/lib/cv';
import { emptyProfile, profileCompleteness, setProfileValue } from '../../src/lib/profile';
import { loadProfile, loadResume, loadSettings, saveProfile, saveResume, saveSettings } from '../../src/lib/storage';
import { defaultSettings } from '../../src/lib/settings';
import type { ExtensionSettings, LanguageEntry, ProfileV1, ResumeMetadata, SkillEntry, SupportedProvider } from '../../src/lib/types';
import { defaultModelForProvider, providerPresets } from '../../src/lib/ai/provider-metadata';
import { sendRuntimeMessage } from '../../src/lib/messages';
import type { ExtractProfileFromCvResponse } from '../../src/lib/messages';
import type { ProfilePatchPreviewItem } from '../../src/lib/cv';

const CUSTOM_MODEL_VALUE = '__custom__';
type ModelOption = { id: string; label?: string };
type LearnedProfileField = {
  path: string;
  label?: string;
  value: unknown;
};
const PROFILE_FORM_PATHS = new Set([
  'identity.firstName',
  'identity.givenName',
  'identity.given_name',
  'identity.lastName',
  'identity.familyName',
  'identity.family_name',
  'identity.fullName',
  'contact.email',
  'contact.phone',
  'address.city',
  'address.region',
  'address.country',
  'address.postalCode',
  'preferences.desiredTitle'
]);

function OptionsApp() {
  const [profile, setProfile] = useState<ProfileV1>(emptyProfile());
  const [settings, setSettings] = useState<ExtensionSettings>(defaultSettings);
  const [status, setStatus] = useState('Loading…');
  const [cvError, setCvError] = useState<string | undefined>();
  const [cvAiResult, setCvAiResult] = useState<{ confidence: number; warnings: string[] } | undefined>();
  const [diffs, setDiffs] = useState<ProfilePatchPreviewItem[]>([]);
  const [pendingCvPatch, setPendingCvPatch] = useState<Partial<ProfileV1> | undefined>();
  const [resumeInfo, setResumeInfo] = useState<ResumeMetadata>({});
  const [fetchedModels, setFetchedModels] = useState<Partial<Record<SupportedProvider, ModelOption[]>>>({});

  useEffect(() => {
    Promise.all([loadProfile(), loadSettings(), loadResume().catch(() => undefined)]).then(([loadedProfile, loadedSettings, resume]) => {
      setProfile(loadedProfile);
      setSettings(loadedSettings);
      setResumeInfo({
        ...loadedProfile.resume,
        ...(resume
          ? {
              fileName: resume.fileName,
              mimeType: resume.mimeType,
              size: resume.size,
              importedAt: resume.importedAt
            }
          : {})
      });
      setStatus('Ready');
    });
  }, []);

  const providerOptions = useMemo(() => Object.values(providerPresets), []);
  const selectedProvider = providerPresets[settings.provider.provider];
  const learnedAnswers = useMemo(
    () =>
      profile.reusableAnswers
        .filter((answer) => answer.source === 'learned' || answer.tags?.includes('learned'))
        .filter((answer) => !duplicatesBasicProfileField(answer.question, answer.answer, profile)),
    [profile]
  );
  const learnedProfileFields = useMemo(() => collectLearnedProfileFields(profile), [profile]);
  const currentModels = useMemo(() => {
    const merged = new Map<string, ModelOption>();
    for (const model of selectedProvider.models) merged.set(model.id, model);
    for (const model of fetchedModels[settings.provider.provider] ?? []) merged.set(model.id, model);
    return Array.from(merged.values());
  }, [fetchedModels, selectedProvider.models, settings.provider.provider]);
  const modelSelectValue = currentModels.some((model) => model.id === settings.provider.model)
    ? settings.provider.model
    : CUSTOM_MODEL_VALUE;

  async function persist(nextProfile = profile, nextSettings = settings) {
    await Promise.all([saveProfile(nextProfile), saveSettings(nextSettings)]);
    setStatus('Saved');
    window.setTimeout(() => setStatus('Ready'), 1200);
  }

  function updateProfile(path: string, value: string | boolean) {
    const next = setProfileValue(profile, path, value);
    setProfile(next);
  }

  async function saveProfileState(next: ProfileV1, message: string) {
    setProfile(next);
    await saveProfile(next);
    setStatus(message);
  }

  async function requestSiteAccess() {
    const granted = await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
    const next = { ...settings, onboarded: granted };
    setSettings(next);
    await saveSettings(next);
    setStatus(granted ? 'Site access granted' : 'Site access not granted');
  }

  async function handleCv(file: File) {
    setCvError(undefined);
    setCvAiResult(undefined);
    setDiffs([]);
    setPendingCvPatch(undefined);
    setStatus('Parsing CV locally…');
    try {
      const extracted = await extractCv(file, { onProgress: setStatus });
      setStatus('Saving CV locally…');
      const buffer = await file.arrayBuffer();
      const importedAt = new Date().toISOString();
      const resumeMetadata: ResumeMetadata = {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        importedAt,
        textHash: String(extracted.text.length)
      };
      await saveResume({
        fileName: file.name,
        mimeType: resumeMetadata.mimeType ?? 'application/octet-stream',
        size: file.size,
        importedAt,
        text: extracted.text,
        buffer
      });
      const nextProfile = {
        ...profile,
        resume: resumeMetadata
      };
      setProfile(nextProfile);
      setResumeInfo(resumeMetadata);
      await saveProfile(nextProfile);
      setStatus('Parsing CV content with AI…');

      const response = await sendRuntimeMessage<ExtractProfileFromCvResponse>({
        type: 'EXTRACT_PROFILE_FROM_CV',
        cvText: extracted.text
      });
      if (response.error || !response.extraction) {
        const message = response.error ?? 'AI provider returned no CV extraction result.';
        const localDiffs = previewProfilePatch(nextProfile, extracted.suggestedProfile);
        if (localDiffs.length) {
          setPendingCvPatch(extracted.suggestedProfile);
          setDiffs(localDiffs);
          setCvAiResult({
            confidence: 0,
            warnings: [`AI parsing failed: ${message}`, 'Using local CV extraction instead.']
          });
          setStatus('CV saved. AI parsing failed; using local extracted profile fields for review.');
        } else {
          setCvError(message);
          setStatus(`CV saved. AI parsing failed: ${message}`);
        }
        return;
      }

      const aiProfilePatch = response.extraction.profilePatch as Partial<ProfileV1>;
      const mergedProfilePatch = mergeCvProfilePatches(extracted.suggestedProfile, aiProfilePatch);
      const mergedDiffs = previewProfilePatch(nextProfile, mergedProfilePatch);
      const aiDiffs = previewProfilePatch(nextProfile, aiProfilePatch);
      const localFallbackUsed = !aiDiffs.length && mergedDiffs.length > 0;
      if (!mergedDiffs.length) {
        setPendingCvPatch(undefined);
        setDiffs([]);
        setCvAiResult({
          confidence: response.extraction.confidence,
          warnings: cleanCvWarnings(response.extraction.warnings)
        });
        setCvError('CV saved, but neither AI nor local parsing found editable profile fields. The CV may be image-only or text extraction may have failed.');
        setStatus('CV saved. No editable profile fields were extracted.');
        return;
      }
      setPendingCvPatch(mergedProfilePatch);
      setDiffs(mergedDiffs);
      setCvAiResult({
        confidence: localFallbackUsed ? 0 : response.extraction.confidence,
        warnings: cleanCvWarnings([
          ...response.extraction.warnings,
          ...(localFallbackUsed ? ['AI parsing returned no editable profile fields. Using local CV extraction instead.'] : [])
        ])
      });
      setStatus(localFallbackUsed ? 'CV parsed locally. AI returned no editable profile fields.' : 'CV parsed with AI. Review suggested profile changes below.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('CV import failed', error);
      setCvError(message);
      setStatus(`CV import failed: ${message}`);
    }
  }

  async function mergeCvPatch() {
    if (!pendingCvPatch) return;
    const next = applyProfilePatch(profile, pendingCvPatch);
    setProfile(next);
    setDiffs([]);
    setPendingCvPatch(undefined);
    await saveProfile(next);
    setStatus('CV profile content approved and saved');
  }

  function updateLearnedAnswer(id: string, updates: { question?: string; answer?: string }) {
    setProfile({
      ...profile,
      reusableAnswers: profile.reusableAnswers.map((answer) =>
        answer.id === id ? { ...answer, ...updates, source: answer.source ?? 'learned' } : answer
      ),
      updatedAt: new Date().toISOString()
    });
  }

  function updateCvPatchValue(path: string, value: unknown) {
    if (!pendingCvPatch) return;
    const nextPatch = setPatchValue(pendingCvPatch, path, value);
    setPendingCvPatch(nextPatch);
    setDiffs(previewProfilePatch(profile, nextPatch));
  }

  function updateLearnedProfileField(path: string, value: unknown) {
    if (path === 'skills' && typeof value === 'string') {
      setProfile({ ...profile, skills: parseSkillLines(value, profile.skills), updatedAt: new Date().toISOString() });
      return;
    }
    if (path === 'languages' && typeof value === 'string') {
      setProfile({ ...profile, languages: parseLanguageLines(value, profile.languages), updatedAt: new Date().toISOString() });
      return;
    }
    setProfile({
      ...(setPatchValue(profile, path, value) as ProfileV1),
      updatedAt: new Date().toISOString()
    });
  }

  function updateProvider(provider: SupportedProvider) {
    const preset = providerPresets[provider];
    setSettings({
      ...settings,
      provider: {
        ...settings.provider,
        provider,
        baseUrl: preset.defaultBaseUrl,
        model: defaultModelForProvider(provider)
      }
    });
  }

  function updateModelFromSelect(value: string) {
    if (value === CUSTOM_MODEL_VALUE) {
      setSettings({
        ...settings,
        provider: { ...settings.provider, model: '' }
      });
      return;
    }
    setSettings({
      ...settings,
      provider: { ...settings.provider, model: value }
    });
  }

  async function refreshProviderModels() {
    setStatus(`Fetching ${selectedProvider.label} models…`);
    try {
      const response = await sendRuntimeMessage<{ models: ModelOption[] }>({
        type: 'FETCH_PROVIDER_MODELS',
        provider: settings.provider
      });
      const models = response.models ?? [];
      if (!models.length) {
        setStatus('No models returned. Check API key/base URL or use a custom model ID.');
        return;
      }
      setFetchedModels({ ...fetchedModels, [settings.provider.provider]: models });
      const currentModelAvailable = models.some((model) => model.id === settings.provider.model);
      if (!currentModelAvailable) {
        setSettings({
          ...settings,
          provider: { ...settings.provider, model: models[0]?.id ?? settings.provider.model }
        });
      }
      setStatus(`Fetched ${models.length} models from ${selectedProvider.label}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not fetch models');
    }
  }

  return (
    <main className="page">
      <h1>Job Application Autofill</h1>
      <p className="muted">
        Local-first Chrome extension. It fills forms from your saved profile and CV. It does not click Next, submit, sign,
        solve CAPTCHA, or generate unsaved free-text answers.
      </p>
      <div className="row">
        <span className="status">{status}</span>
        <span className="muted">Profile completeness: {profileCompleteness(profile)}%</span>
      </div>

      <section className="card">
        <h2>Onboarding and site access</h2>
        <p className="muted">
          Always-autofill requires access to HTTP/HTTPS application pages. The extension only sends sanitized form metadata
          to an AI provider when you enable one below.
        </p>
        <div className="row">
          <button onClick={requestSiteAccess}>{settings.onboarded ? 'Re-check site access' : 'Grant site access'}</button>
          <button
            className="secondary"
            onClick={() => {
              const next = { ...settings, globalPaused: !settings.globalPaused };
              setSettings(next);
              void saveSettings(next);
            }}
          >
            {settings.globalPaused ? 'Resume globally' : 'Pause globally'}
          </button>
        </div>
        <label className="row" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={settings.learnFromUserInput}
            onChange={(event) => {
              const next = { ...settings, learnFromUserInput: event.target.checked };
              setSettings(next);
              void saveSettings(next);
            }}
          />
          Learn answers from fields I type into
        </label>
        <label className="row" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={settings.debugMode}
            onChange={(event) => {
              const next = { ...settings, debugMode: event.target.checked };
              setSettings(next);
              void saveSettings(next);
            }}
          />
          Debug mode: print detected fields to the page console
        </label>
      </section>

      <section className="card">
        <h2>Profile</h2>
        <div className="grid">
          <TextField label="First name" value={profile.identity.firstName} onChange={(v) => updateProfile('identity.firstName', v)} />
          <TextField label="Last name" value={profile.identity.lastName} onChange={(v) => updateProfile('identity.lastName', v)} />
          <TextField label="Full name" value={profile.identity.fullName ?? ''} onChange={(v) => updateProfile('identity.fullName', v)} />
          <TextField label="Email" value={profile.contact.email} onChange={(v) => updateProfile('contact.email', v)} />
          <TextField label="Phone" value={profile.contact.phone ?? ''} onChange={(v) => updateProfile('contact.phone', v)} />
          <TextField label="City" value={profile.address.city ?? ''} onChange={(v) => updateProfile('address.city', v)} />
          <TextField label="Region/state" value={profile.address.region ?? ''} onChange={(v) => updateProfile('address.region', v)} />
          <TextField label="Country" value={profile.address.country ?? ''} onChange={(v) => updateProfile('address.country', v)} />
          <TextField label="Postal code" value={profile.address.postalCode ?? ''} onChange={(v) => updateProfile('address.postalCode', v)} />
          <TextField
            label="Desired role"
            value={profile.preferences.desiredTitle ?? ''}
            onChange={(v) => updateProfile('preferences.desiredTitle', v)}
          />
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={() => void persist()}>Save profile</button>
        </div>
      </section>

      <section className="card">
        <h2>Learned answers</h2>
        <p className="muted">
          Answers learned from job forms stay on this device and are reused for matching questions across job application domains.
        </p>
        {learnedAnswers.length ? (
          <>
            <h3>Form answers</h3>
            <div className="learnedList">
              {learnedAnswers.map((answer) => (
                <div className="learnedItem" key={answer.id}>
                  <div>
                    <label className="field">
                      <span>Question</span>
                      <input value={answer.question} onChange={(event) => updateLearnedAnswer(answer.id, { question: event.target.value })} />
                    </label>
                    <label className="field" style={{ marginTop: 10 }}>
                      <span>Answer</span>
                      <textarea value={answer.answer} onChange={(event) => updateLearnedAnswer(answer.id, { answer: event.target.value })} />
                    </label>
                    <span className="muted">
                      {answer.learnedFrom?.domain ?? 'unknown domain'}
                      {answer.learnedFrom?.lastSeenAt ? ` · ${new Date(answer.learnedFrom.lastSeenAt).toLocaleString()}` : ''}
                    </span>
                  </div>
                  <button
                    className="secondary"
                    onClick={() =>
                      void saveProfileState(
                        { ...profile, reusableAnswers: profile.reusableAnswers.filter((item) => item.id !== answer.id) },
                        'Learned answer removed'
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
            <button onClick={() => void saveProfileState(profile, 'Learned answers saved')}>Save learned answers</button>
            <button
              className="danger"
              style={{ marginLeft: 10 }}
              onClick={() =>
                void saveProfileState(
                  {
                    ...profile,
                    reusableAnswers: profile.reusableAnswers.filter(
                      (answer) => answer.source !== 'learned' && !answer.tags?.includes('learned')
                    )
                  },
                  'All learned answers removed'
                )
              }
            >
              Clear learned answers
            </button>
          </>
        ) : (
          <p className="muted">No learned form answers yet.</p>
        )}
        <h3>Profile fields</h3>
        {learnedProfileFields.length ? (
          <>
            <div className="learnedFieldsList">
              {learnedProfileFields.map((field) => (
                <div className="learnedFieldRow" key={field.path}>
                  <strong>{field.label ?? field.path}</strong>
                  <EditableExtractedValue
                    path={field.path}
                    value={field.value}
                    onCommit={(value) => updateLearnedProfileField(field.path, value)}
                    onError={(message) => setStatus(`Learned field edit failed: ${message}`)}
                    onClearError={() => setCvError(undefined)}
                  />
                </div>
              ))}
            </div>
            <button onClick={() => void saveProfileState(profile, 'Learned profile fields saved')}>Save learned fields</button>
          </>
        ) : (
          <p className="muted">No saved profile fields yet.</p>
        )}
      </section>

      <section className="card">
        <h2>CV import</h2>
        <p className="muted">PDF and DOCX are parsed locally. Suggested profile changes are shown before merge.</p>
        <div className="fileField">
          <div>
            <span className="label">Saved CV</span>
            <strong>{resumeInfo.fileName ?? 'No CV saved'}</strong>
            {resumeInfo.fileName ? (
              <p className="muted">
                {formatFileSize(resumeInfo.size)}
                {resumeInfo.importedAt ? ` · Imported ${new Date(resumeInfo.importedAt).toLocaleString()}` : ''}
              </p>
            ) : null}
          </div>
          <label className="buttonLike">
            {resumeInfo.fileName ? 'Replace CV' : 'Upload CV'}
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleCv(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>
        {cvError ? <p className="errorText">{cvError}</p> : null}
        {cvAiResult ? (
          <div className="helpBox">
            <strong>AI CV parsing</strong>
            <p>Confidence: {Math.round(cvAiResult.confidence * 100)}%</p>
            {cvAiResult.warnings.length ? <p>Warnings: {cvAiResult.warnings.join(' ')}</p> : null}
          </div>
        ) : null}
        {pendingCvPatch ? (
          <div>
            <h3>Extracted profile content</h3>
            {diffs.length ? (
              <div className="diffList">
                {diffs.map((diff) => (
                  <div className="diff editableDiff" key={diff.path}>
                    <strong>
                      {labelForPatchAction(diff.action)} {diff.path}
                    </strong>
                    <span>{formatPreviewValue(diff.current)}</span>
                    <EditableExtractedValue
                      path={diff.path}
                      value={diff.suggested}
                      onCommit={(value) => updateCvPatchValue(diff.path, value)}
                      onError={(message) => {
                        setCvError(message);
                        setStatus(`CV extracted content edit failed: ${message}`);
                      }}
                      onClearError={() => setCvError(undefined)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">AI parsing did not return editable profile fields.</p>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button disabled={!diffs.length || Boolean(cvError)} onClick={() => void mergeCvPatch()}>
                Approve and save to profile
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setPendingCvPatch(undefined);
                  setDiffs([]);
                  setStatus('CV extracted content discarded');
                }}
              >
                Discard extracted content
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>AI provider</h2>
        <p className="muted">
          Optional. Calls are made directly from the extension background service worker using your key. Keys are not exposed
          to content scripts.
        </p>
        <div className="grid">
          <label className="field">
            <span>Provider</span>
            <select
              value={settings.provider.provider}
              onChange={(event) => updateProvider(event.target.value as SupportedProvider)}
            >
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Model ID</span>
            <select value={modelSelectValue} onChange={(event) => updateModelFromSelect(event.target.value)}>
              {currentModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label ? `${model.label} (${model.id})` : model.id}
                </option>
              ))}
              <option value={CUSTOM_MODEL_VALUE}>Custom model ID…</option>
            </select>
          </label>
          {modelSelectValue === CUSTOM_MODEL_VALUE ? (
            <TextField
              label="Custom model ID"
              value={settings.provider.model ?? ''}
              placeholder="Paste exact provider model ID"
              onChange={(v) => setSettings({ ...settings, provider: { ...settings.provider, model: v } })}
            />
          ) : null}
          <TextField
            label="API key"
            type="password"
            placeholder="Paste API key"
            value={settings.provider.apiKey ?? ''}
            onChange={(v) => setSettings({ ...settings, provider: { ...settings.provider, apiKey: v } })}
          />
          <TextField
            label="Base URL"
            value={settings.provider.baseUrl ?? ''}
            placeholder={selectedProvider.defaultBaseUrl || 'https://your-provider.example.com/v1'}
            onChange={(v) => setSettings({ ...settings, provider: { ...settings.provider, baseUrl: v } })}
          />
        </div>
        <div className="helpBox">
          <strong>How to configure {selectedProvider.label}</strong>
          <p>{selectedProvider.apiKeyHint}</p>
          <p>{selectedProvider.modelHint}</p>
          <div className="row">
            {selectedProvider.apiKeyUrl ? (
              <a href={selectedProvider.apiKeyUrl} target="_blank" rel="noreferrer">
                Open API key page
              </a>
            ) : null}
            {selectedProvider.docsUrl ? (
              <a href={selectedProvider.docsUrl} target="_blank" rel="noreferrer">
                Open model docs
              </a>
            ) : null}
            <button type="button" className="secondary" onClick={() => void refreshProviderModels()}>
              Refresh models
            </button>
            {selectedProvider.defaultBaseUrl ? (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setSettings({
                    ...settings,
                    provider: { ...settings.provider, baseUrl: selectedProvider.defaultBaseUrl }
                  })
                }
              >
                Reset base URL
              </button>
            ) : null}
          </div>
        </div>
        <label className="row" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={settings.provider.enabled}
            onChange={(event) => setSettings({ ...settings, provider: { ...settings.provider, enabled: event.target.checked } })}
          />
          Enable automatic AI analysis
        </label>
        <button onClick={() => void persist(profile, settings)}>Save settings</button>
      </section>

      <footer className="row muted" style={{ marginTop: 18, justifyContent: 'space-between' }}>
        <span>
          Enjoying the extension?{' '}
          <a href="https://buymeacoffee.com/tingkk" target="_blank" rel="noreferrer">
            ☕ Buy me a coffee
          </a>
        </span>
        <a href="https://tinglogy.me/job-app-auto/privacy/" target="_blank" rel="noreferrer">
          Privacy policy
        </a>
      </footer>
    </main>
  );
}

function formatFileSize(size: number | undefined): string {
  if (!size) return 'Size unknown';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatPreviewValue(value: unknown): string {
  if (value == null || value === '') return 'Empty';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return JSON.stringify(value, null, 2);
}

function collectLearnedProfileFields(profile: ProfileV1): LearnedProfileField[] {
  const fields: LearnedProfileField[] = [];
  const seen = new Set<string>();
  for (const section of ['identity', 'contact', 'address', 'workAuthorization', 'preferences', 'demographics'] as const) {
    collectObjectFields(profile[section], section, fields, seen);
  }
  if (profile.skills.some((skill) => hasDisplayValue(skill.name))) {
    fields.push({ path: 'skills', label: 'skills', value: formatSkillLines(profile.skills) });
  }
  if (profile.languages.some((language) => hasDisplayValue(language.name))) {
    fields.push({ path: 'languages', label: 'Language', value: formatLanguageLines(profile.languages) });
  }
  for (const section of ['links', 'education', 'employment'] as const) {
    profile[section].forEach((value, index) => {
      collectArrayItemFields(value, `${section}[${index}]`, fields, seen);
    });
  }
  return fields;
}

function collectArrayItemFields(value: unknown, prefix: string, fields: LearnedProfileField[], seen: Set<string>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const displayObject = objectWithoutInternalFields(value);
  const displayEntries = Object.values(displayObject).filter(hasDisplayValue);
  if (displayEntries.length > 2) {
    if (!seen.has(prefix)) {
      seen.add(prefix);
      fields.push({ path: prefix, value: displayObject });
    }
    return;
  }
  collectObjectFields(displayObject, prefix, fields, seen);
}

function collectObjectFields(value: unknown, prefix: string, fields: LearnedProfileField[], seen: Set<string>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    const path = `${prefix}.${key}`;
    if (key === 'id') continue;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      collectObjectFields(nested, path, fields, seen);
    } else if (hasDisplayValue(nested) && !PROFILE_FORM_PATHS.has(path) && !seen.has(path)) {
      seen.add(path);
      fields.push({ path, value: nested });
    }
  }
}

function hasDisplayValue(value: unknown): boolean {
  if (typeof value === 'string') return Boolean(value.trim());
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.values(value).some(hasDisplayValue);
  return value != null;
}

function objectWithoutInternalFields(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key, nested]) => key !== 'id' && hasDisplayValue(nested)));
}

function formatSkillLines(skills: ProfileV1['skills']): string {
  return skills
    .map((skill, index) => {
      const level = skill.level ? `: ${skill.level}` : '';
      return `[${index + 1}] ${skill.name}${level}`;
    })
    .join('\n');
}

function formatLanguageLines(languages: ProfileV1['languages']): string {
  return languages
    .map((language, index) => {
      const proficiency = language.proficiency ? `: ${language.proficiency}` : '';
      return `[${index + 1}] ${language.name}${proficiency}`;
    })
    .join('\n');
}

function parseSkillLines(value: string, existing: ProfileV1['skills']): ProfileV1['skills'] {
  return value
    .split('\n')
    .map((line, index): SkillEntry | undefined => {
      const text = line.replace(/^\s*\[\d+\]\s*/, '').trim();
      if (!text) return undefined;
      const [name, ...levelParts] = text.split(':');
      const skillName = name?.trim();
      if (!skillName) return undefined;
      return {
        id: existing[index]?.id ?? `skill_${index + 1}`,
        name: skillName,
        level: levelParts.join(':').trim() || undefined
      };
    })
    .filter((skill): skill is SkillEntry => Boolean(skill));
}

function parseLanguageLines(value: string, existing: ProfileV1['languages']): ProfileV1['languages'] {
  return value
    .split('\n')
    .map((line, index): LanguageEntry | undefined => {
      const text = line.replace(/^\s*\[\d+\]\s*/, '').trim();
      if (!text) return undefined;
      const [name, ...proficiencyParts] = text.split(':');
      const languageName = name?.trim();
      if (!languageName) return undefined;
      return {
        id: existing[index]?.id ?? `language_${index + 1}`,
        name: languageName,
        proficiency: proficiencyParts.join(':').trim() || undefined
      };
    })
    .filter((language): language is LanguageEntry => Boolean(language));
}

function duplicatesBasicProfileField(question: string, answer: string, profile: ProfileV1): boolean {
  const normalizedQuestion = question.toLowerCase();
  const normalizedAnswer = answer.trim().toLowerCase();
  if (!normalizedAnswer) return false;
  const candidates: Array<[RegExp, unknown]> = [
    [/first\s*name|given\s*name/i, profile.identity.firstName],
    [/last\s*name|family\s*name|surname/i, profile.identity.lastName],
    [/full\s*name|legal\s*name|^name$/i, profile.identity.fullName],
    [/e-?mail/i, profile.contact.email],
    [/phone|mobile|cell/i, profile.contact.phone],
    [/city/i, profile.address.city],
    [/state|province|region/i, profile.address.region],
    [/country/i, profile.address.country],
    [/zip|postal/i, profile.address.postalCode],
    [/desired.*role|desired.*title|job.*title/i, profile.preferences.desiredTitle]
  ];
  return candidates.some(([pattern, value]) => {
    return pattern.test(normalizedQuestion) && typeof value === 'string' && value.trim().toLowerCase() === normalizedAnswer;
  });
}

function labelForPatchAction(action: ProfilePatchPreviewItem['action']): string {
  if (action === 'add') return 'Add';
  if (action === 'update') return 'Update';
  return 'Keep';
}

function setPatchValue<T extends object>(patch: T, path: string, value: unknown): T {
  const clone = structuredClone(patch) as Record<string, unknown>;
  const parts = path.split('.');
  let cursor = clone;
  for (const [index, part] of parts.entries()) {
    const isLast = index === parts.length - 1;
    const arrayPart = part.match(/^([a-zA-Z0-9_]+)\[(\d+)\]$/);
    if (arrayPart) {
      const key = arrayPart[1] ?? '';
      const itemIndex = Number(arrayPart[2] ?? '0');
      const items = Array.isArray(cursor[key]) ? [...cursor[key]] : [];
      if (isLast) {
        const currentItem = items[itemIndex];
        items[itemIndex] =
          currentItem && typeof currentItem === 'object' && !Array.isArray(currentItem) && value && typeof value === 'object' && !Array.isArray(value)
            ? { ...currentItem, ...value }
            : value;
      } else {
        const currentItem = items[itemIndex];
        items[itemIndex] = currentItem && typeof currentItem === 'object' && !Array.isArray(currentItem) ? { ...currentItem } : {};
      }
      cursor[key] = items;
      cursor = items[itemIndex] as Record<string, unknown>;
      continue;
    }
    if (isLast) {
      cursor[part] = value;
      continue;
    }
    const next = cursor[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  return clone as T;
}

function EditableExtractedValue({
  path,
  value,
  onCommit,
  onError,
  onClearError
}: {
  path: string;
  value: unknown;
  onCommit: (value: unknown) => void;
  onError: (message: string) => void;
  onClearError: () => void;
}) {
  const [draft, setDraft] = useState(formatEditableValue(value));

  useEffect(() => {
    setDraft(formatEditableValue(value));
  }, [value]);

  if (typeof value === 'boolean') {
    return (
      <label className="row">
        <input
          type="checkbox"
          checked={value}
          onChange={(event) => {
            onClearError();
            onCommit(event.target.checked);
          }}
        />
        <span>{value ? 'Yes' : 'No'}</span>
      </label>
    );
  }

  const isStructured = value != null && typeof value === 'object';
  return (
    <textarea
      className="inlineEditor"
      value={draft}
      rows={isStructured ? 7 : 2}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (!isStructured) {
          onClearError();
          onCommit(draft);
          return;
        }
        try {
          onClearError();
          onCommit(JSON.parse(draft));
        } catch {
          onError(`Invalid JSON for ${path}. Fix the extracted value before approving.`);
        }
      }}
    />
  );
}

function formatEditableValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function TextField({
  label,
  value,
  type = 'text',
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  type?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

createRoot(document.getElementById('root')!).render(<OptionsApp />);
