import { collectFieldDescriptors, cssEscape, describeElement } from '../src/lib/autofill/descriptor';
import { detectAts } from '../src/lib/autofill/ats';
import { fillFields, markTrustedUserInput, undoFillSession } from '../src/lib/autofill/filler';
import { showDebugModal, showFillPreviewModal, showResultNotice } from '../src/lib/autofill/notification';
import { validateMapping } from '../src/lib/autofill/validator';
import { loadResume } from '../src/lib/storage';
import { sendRuntimeMessage } from '../src/lib/messages';
import type { FillContextResponse, RuntimeMessage } from '../src/lib/messages';
import type { AutofillPreviewItem, FieldDescriptor, FieldMapping, FillSession, LearnedFieldValue } from '../src/lib/types';

let extensionContextInvalidated = false;
let activePreviewSignature: string | undefined;
let lastDebugSignature: string | undefined;
const resolvedPreviewSignatures = new Set<string>();
type DescriptorElement = Parameters<typeof describeElement>[0];

export default defineContentScript({
  // Registered at runtime by the background worker once the user grants the
  // optional host permissions, so the install prompt stays minimal.
  registration: 'runtime',
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',
  main() {
    markTrustedUserInput();
    startLearningFromUserInput();
    const runner = debounce(runAutofill, 600);
    runner();

    const observer = new MutationObserver(() => runner());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    let lastUrl = location.href;
    window.setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        runner();
      }
    }, 800);
  }
});

function startLearningFromUserInput() {
  const timers = new WeakMap<Element, number>();
  const schedule = (event: Event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const target = event.target;
    window.clearTimeout(timers.get(target));
    const delay = event.type === 'input' ? 800 : 0;
    const timer = window.setTimeout(() => {
      timers.delete(target);
      void learnFieldValue(target);
    }, delay);
    timers.set(target, timer);
  };

  document.addEventListener('input', schedule, true);
  document.addEventListener('change', schedule, true);
  document.addEventListener('blur', schedule, true);
}

async function learnFieldValue(target: Element) {
  if (!hasLiveExtensionContext() || !isDescriptorElement(target)) return;
  try {
    const descriptor = describeElement(target, 0, detectAts());
    const observation = observationFromElement(target, descriptor);
    if (!observation) return;
    await sendRuntimeMessage({ type: 'LEARN_FIELD_VALUES', observations: [observation] });
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      extensionContextInvalidated = true;
      return;
    }
    console.warn('Job Autofill learning error', error);
  }
}

function observationFromElement(element: DescriptorElement, descriptor: FieldDescriptor): LearnedFieldValue | undefined {
  const value = valueFromElement(element);
  if (!value) return undefined;
  return {
    descriptor,
    value: value.value,
    valueLabel: value.label,
    pageTitle: document.title,
    domain: location.hostname,
    url: location.href,
    observedAt: new Date().toISOString()
  };
}

function valueFromElement(element: DescriptorElement): { value: string; label?: string } | undefined {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') return undefined;
    if (element.type === 'radio') {
      if (!element.checked) return undefined;
      return { value: element.value, label: findVisibleOptionLabel(element) };
    }
    return element.value.trim() ? { value: element.value.trim() } : undefined;
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.value.trim() ? { value: element.value.trim() } : undefined;
  }
  if (element instanceof HTMLSelectElement) {
    const selected = Array.from(element.selectedOptions)
      .map((option) => ({ value: option.value, label: option.textContent?.trim() }))
      .filter((option) => option.value || option.label);
    if (!selected.length) return undefined;
    return {
      value: selected.map((option) => option.value || option.label).join(', '),
      label: selected.map((option) => option.label || option.value).join(', ')
    };
  }
  if (element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox') {
    const text = element.textContent?.trim();
    return text ? { value: text } : undefined;
  }
  if (element.getAttribute('role') === 'radio') {
    if (element.getAttribute('aria-checked') !== 'true') return undefined;
    const label = findVisibleOptionLabel(element);
    return label ? { value: label, label } : undefined;
  }
  if (element.getAttribute('role') === 'combobox') {
    const value = element.getAttribute('aria-valuetext') || element.textContent?.trim() || element.getAttribute('data-value');
    return value ? { value, label: value } : undefined;
  }
  return undefined;
}

function findVisibleOptionLabel(element: Element): string | undefined {
  return (
    element.getAttribute('aria-label') ||
    document.querySelector(`label[for="${cssEscape((element as HTMLElement).id)}"]`)?.textContent?.trim() ||
    element.closest('label')?.textContent?.trim() ||
    element.textContent?.trim() ||
    undefined
  );
}

function isDescriptorElement(element: Element): element is DescriptorElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLElement
  );
}

async function runAutofill() {
  if (!hasLiveExtensionContext()) return;
  try {
    const descriptors = collectFieldDescriptors().filter((descriptor) => descriptor.visible);
    const ats = detectAts();
    const response = await sendRuntimeMessage<FillContextResponse>({
      type: 'GET_FILL_CONTEXT',
      descriptors,
      pageTitle: document.title,
      domain: location.hostname,
      ats
    });
    if (response.debugMode) logDebugFields(descriptors, response, ats);
    if (response.paused || !response.mappings.length) return;
    const previewItems = buildPreviewItems(descriptors, response.mappings);
    if (!previewItems.length) return;
    const previewSignature = signatureForPreview(previewItems);
    if (activePreviewSignature || resolvedPreviewSignatures.has(previewSignature)) return;
    activePreviewSignature = previewSignature;
    const approved = await showFillPreviewModal(previewItems);
    activePreviewSignature = undefined;
    resolvedPreviewSignatures.add(previewSignature);
    while (resolvedPreviewSignatures.size > 200) {
      const oldest = resolvedPreviewSignatures.values().next().value;
      if (oldest === undefined) break;
      resolvedPreviewSignatures.delete(oldest);
    }
    if (!approved) return;
    const resume = await loadResume().catch((error) => {
      if (isExtensionContextInvalidatedError(error)) throw error;
      return undefined;
    });
    const { result, session } = await fillFields(descriptors, response.mappings, resume);
    await sendRuntimeMessage({ type: 'SAVE_FILL_SESSION', session });
    if (result.filled || result.failed || result.unresolved) {
      showResultNotice(
        result,
        () => void undoFillSession(session),
        () => showDebugModal(result)
      );
    }
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      extensionContextInvalidated = true;
      return;
    }
    console.warn('Job Autofill content script error', error);
  }
}

function debounce<T extends (...args: never[]) => void>(fn: T, delayMs: number): T {
  let timer: number | undefined;
  return ((...args: never[]) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delayMs);
  }) as T;
}

function logDebugFields(descriptors: FieldDescriptor[], response: FillContextResponse, ats?: string) {
  const fields = descriptors.map((descriptor, index) => ({
    index: index + 1,
    fieldId: descriptor.id,
    kind: descriptor.kind,
    name: descriptor.name ?? '',
    id: descriptor.idAttribute ?? '',
    label: descriptor.label ?? '',
    ariaLabel: descriptor.ariaLabel ?? '',
    placeholder: descriptor.placeholder ?? '',
    question: descriptor.questionText,
    required: descriptor.required,
    options: descriptor.options.map((option) => option.label || option.value).join(' | '),
    path: descriptor.path
  }));
  const mappings = response.mappings.map((mapping) => ({
    fieldId: mapping.fieldId,
    value: debugValue(mapping.value),
    source: mapping.source,
    confidence: mapping.confidence ?? '',
    profilePath: mapping.profilePath ?? ''
  }));
  const profileFields =
    response.debugData?.profileFields.map((field) => ({
      path: field.path,
      value: debugUnknownValue(field.value),
      empty: field.empty
    })) ?? [];
  const learnedFields =
    response.debugData?.learnedFields.map((field) => ({
      question: field.question,
      answer: field.answer,
      domain: field.domain ?? '',
      observationCount: field.observationCount ?? '',
      lastSeenAt: field.lastSeenAt ?? '',
      tags: field.tags?.join(', ') ?? '',
      id: field.id
    })) ?? [];
  const payload = {
    generatedAt: new Date().toISOString(),
    url: location.href,
    title: document.title,
    domain: location.hostname,
    ats,
    paused: response.paused,
    fieldCount: descriptors.length,
    mappingCount: response.mappings.length,
    fields: descriptors,
    mappings: response.mappings,
    profileFields: response.debugData?.profileFields ?? [],
    learnedFields: response.debugData?.learnedFields ?? []
  };
  const signature = JSON.stringify({
    url: payload.url,
    paused: payload.paused,
    fields,
    mappings,
    profileFields,
    learnedFields
  });
  if (signature === lastDebugSignature) return;
  lastDebugSignature = signature;

  console.info(
    `[Job Autofill Debug] Debug mode active: ${descriptors.length} visible fields, ${response.mappings.length} mappings, ${learnedFields.length} learned fields, ${profileFields.length} profile fields`
  );
  console.groupCollapsed(`[Job Autofill Debug] ${descriptors.length} fields, ${response.mappings.length} mappings on ${location.hostname}`);
  console.log('Detected page fields');
  console.table(fields);
  console.log('Mappings');
  if (mappings.length) console.table(mappings);
  else console.log('No mappings returned');
  console.log('Learned fields');
  if (learnedFields.length) console.table(learnedFields);
  else console.log('No learned fields saved');
  console.log('Profile fields');
  if (profileFields.length) console.table(profileFields);
  else console.log('No profile fields found');
  console.log('Copy/paste this JSON into Codex:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('Raw debug payload:', payload);
  console.groupEnd();
}

function debugValue(value: FieldMapping['value']): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value;
}

function debugUnknownValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => debugUnknownValue(item)).join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === 'UNDO_LAST_FILL') {
    sendRuntimeMessage<{ session?: FillSession }>({ type: 'UNDO_LAST_FILL' })
      .then(({ session }) => (session ? undoFillSession(session) : 0))
      .then((undone) => sendResponse({ undone }))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  return false;
});

function hasLiveExtensionContext(): boolean {
  return !extensionContextInvalidated && Boolean(chrome.runtime?.id);
}

function isExtensionContextInvalidatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /extension context invalidated|context invalidated|extension.*invalidated/i.test(message);
}

function buildPreviewItems(descriptors: FieldDescriptor[], mappings: FieldMapping[]): AutofillPreviewItem[] {
  const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  const items: AutofillPreviewItem[] = [];
  for (const rawMapping of mappings) {
    const descriptor = descriptorById.get(rawMapping.fieldId);
    if (!descriptor) continue;
    const mapping = validateMapping(descriptor, rawMapping);
    if (!mapping) continue;
    const element = findElementForPreview(descriptor);
    if (!element || !shouldPreviewOverwrite(element)) continue;
    items.push({
      ...maybeProfilePath(mapping.profilePath),
      fieldId: descriptor.id,
      label: descriptor.label || descriptor.ariaLabel || descriptor.placeholder || descriptor.name || descriptor.idAttribute || descriptor.questionText || descriptor.id,
      valuePreview: previewValue(mapping.value),
      kind: descriptor.kind,
      source: mapping.source,
      confidence: mapping.confidence
    });
  }
  return items;
}

function previewValue(value: unknown): string {
  if (value === '__RESUME_FILE__') return 'Resume file';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ').slice(0, 160);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value ?? '').slice(0, 160);
}

function signatureForPreview(items: AutofillPreviewItem[]): string {
  return [
    location.href,
    ...items.map((item) => [item.fieldId, item.valuePreview, item.source, item.profilePath].filter(Boolean).join(':'))
  ].join('|');
}

function findElementForPreview(descriptor: FieldDescriptor): Element | null {
  if (descriptor.idAttribute) {
    const byId = document.getElementById(descriptor.idAttribute);
    if (byId) return byId;
  }
  if (descriptor.name) {
    const byName = document.querySelector(`[name="${cssEscape(descriptor.name)}"]`);
    if (byName) return byName;
  }
  if (descriptor.path) return document.querySelector(descriptor.path);
  return null;
}

function shouldPreviewOverwrite(element: Element): boolean {
  if (element.getAttribute('data-job-app-auto-user-touched') === 'true') return false;
  if (element.hasAttribute('data-job-app-auto-filled')) return true;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return !element.value || isBrowserAutofilled(element);
  }
  return !element.textContent?.trim();
}

function isBrowserAutofilled(element: Element): boolean {
  try {
    return element.matches(':-webkit-autofill');
  } catch {
    return false;
  }
}

function maybeProfilePath(profilePath: string | undefined): Pick<AutofillPreviewItem, 'profilePath'> | Record<string, never> {
  return profilePath ? { profilePath } : {};
}
