import type { AutofillAction, AutofillResult, FieldDescriptor, FieldMapping, FillRecord, FillSession } from '../types';
import type { StoredResume } from '../storage';
import { cssEscape } from './descriptor';
import { validateMapping } from './validator';

type FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;

const EXTENSION_FILLED = 'data-job-app-auto-filled';
const USER_TOUCHED = 'data-job-app-auto-user-touched';

export function markTrustedUserInput() {
  document.addEventListener(
    'input',
    (event) => {
      if (event.isTrusted && event.target instanceof HTMLElement) event.target.setAttribute(USER_TOUCHED, 'true');
    },
    true
  );
  document.addEventListener(
    'change',
    (event) => {
      if (event.isTrusted && event.target instanceof HTMLElement) event.target.setAttribute(USER_TOUCHED, 'true');
    },
    true
  );
}

export async function fillFields(
  descriptors: FieldDescriptor[],
  mappings: FieldMapping[],
  resume?: StoredResume
): Promise<{ result: AutofillResult; session: FillSession }> {
  const records: FillRecord[] = [];
  const reviewItems: string[] = [];
  const actions: AutofillAction[] = [];
  const terminalFieldIds = new Set<string>();
  let filled = 0;
  let failed = 0;
  let skipped = 0;
  const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));

  for (const descriptor of descriptors.filter((field) => field.visible)) {
    actions.push(actionForField('detected', descriptor, `Detected ${descriptor.kind} field`));
  }

  for (const rawMapping of mappings) {
    const descriptor = descriptorById.get(rawMapping.fieldId);
    if (!descriptor) {
      skipped += 1;
      actions.push({
        status: 'skipped',
        fieldId: rawMapping.fieldId,
        source: rawMapping.source,
        confidence: rawMapping.confidence,
        profilePath: rawMapping.profilePath,
        valuePreview: previewValue(rawMapping.value),
        reason: 'Mapping returned for a field that no longer exists on the page',
        timestamp: new Date().toISOString()
      });
      continue;
    }
    const mapping = validateMapping(descriptor, rawMapping);
    if (!mapping) {
      terminalFieldIds.add(descriptor.id);
      actions.push(
        actionForField('unresolved', descriptor, 'Mapping was rejected by local validation', {
          source: rawMapping.source,
          confidence: rawMapping.confidence,
          profilePath: rawMapping.profilePath,
          valuePreview: previewValue(rawMapping.value)
        })
      );
      continue;
    }
    const element = findElement(descriptor);
    if (!element) {
      failed += 1;
      terminalFieldIds.add(descriptor.id);
      const reason = `Could not locate ${descriptor.label || descriptor.questionText || descriptor.id}`;
      reviewItems.push(reason);
      actions.push(
        actionForField('failed', descriptor, reason, {
          source: mapping.source,
          confidence: mapping.confidence,
          profilePath: mapping.profilePath,
          valuePreview: previewValue(mapping.value)
        })
      );
      continue;
    }
    if (!shouldOverwrite(element)) {
      skipped += 1;
      terminalFieldIds.add(descriptor.id);
      actions.push(
        actionForField('skipped', descriptor, 'Preserved existing user-entered or ambiguous value', {
          source: mapping.source,
          confidence: mapping.confidence,
          profilePath: mapping.profilePath,
          valuePreview: previewValue(mapping.value)
        })
      );
      continue;
    }
    try {
      const record = await fillElement(element, descriptor, mapping, resume);
      if (record) {
        records.push(record);
        filled += 1;
        terminalFieldIds.add(descriptor.id);
        actions.push(
          actionForField('filled', descriptor, 'Filled field and dispatched input/change/blur events', {
            source: mapping.source,
            confidence: mapping.confidence,
            profilePath: mapping.profilePath,
            valuePreview: previewValue(mapping.value)
          })
        );
      } else {
        terminalFieldIds.add(descriptor.id);
        actions.push(
          actionForField('unresolved', descriptor, 'Mapped value could not be applied, likely missing required local data such as resume file', {
            source: mapping.source,
            confidence: mapping.confidence,
            profilePath: mapping.profilePath,
            valuePreview: previewValue(mapping.value)
          })
        );
      }
    } catch (error) {
      failed += 1;
      terminalFieldIds.add(descriptor.id);
      const reason = error instanceof Error ? error.message : String(error);
      reviewItems.push(reason);
      actions.push(
        actionForField('failed', descriptor, reason, {
          source: mapping.source,
          confidence: mapping.confidence,
          profilePath: mapping.profilePath,
          valuePreview: previewValue(mapping.value)
        })
      );
    }
  }

  for (const descriptor of descriptors.filter((field) => field.visible)) {
    if (terminalFieldIds.has(descriptor.id)) continue;
    actions.push(actionForField('unresolved', descriptor, 'No safe mapping found from profile, saved answers, resume, cache, or AI'));
  }

  const unresolved = actions.filter((action) => action.status === 'unresolved').length;

  const result: AutofillResult = {
    filled,
    unresolved,
    failed,
    skipped,
    reviewItems: reviewItems.length ? reviewItems : actions.filter((action) => action.status !== 'detected').map(formatActionSummary),
    mappings,
    actions
  };
  return {
    result,
    session: {
      id: crypto.randomUUID(),
      url: location.href,
      domain: location.hostname,
      records,
      createdAt: new Date().toISOString()
    }
  };
}

function actionForField(
  status: AutofillAction['status'],
  descriptor: FieldDescriptor,
  reason: string,
  extra: Partial<AutofillAction> = {}
): AutofillAction {
  return {
    status,
    fieldId: descriptor.id,
    fieldLabel: descriptor.label || descriptor.ariaLabel || descriptor.placeholder || descriptor.name || descriptor.idAttribute,
    questionText: descriptor.questionText,
    kind: descriptor.kind,
    reason,
    timestamp: new Date().toISOString(),
    ...extra
  };
}

function previewValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ').slice(0, 160);
  if (typeof value === 'boolean') return String(value);
  return String(value ?? '').slice(0, 160);
}

function formatActionSummary(action: AutofillAction): string {
  const label = action.fieldLabel || action.questionText || action.fieldId || 'unknown field';
  const source = action.source ? ` via ${action.source}` : '';
  return `${action.status}: ${label}${source} — ${action.reason}`;
}

export async function undoFillSession(session: FillSession): Promise<number> {
  let undone = 0;
  for (const record of session.records.toReversed()) {
    const element = document.querySelector(`[${EXTENSION_FILLED}="${cssEscape(record.fieldId)}"]`) as FillableElement | null;
    if (!element) continue;
    restoreElement(element, record);
    undone += 1;
  }
  return undone;
}

async function fillElement(
  element: FillableElement,
  descriptor: FieldDescriptor,
  mapping: FieldMapping,
  resume?: StoredResume
): Promise<FillRecord | undefined> {
  const previousValue = getElementValue(element);
  const previousChecked = element instanceof HTMLInputElement ? element.checked : undefined;
  if (descriptor.kind === 'file') {
    if (!resume) return undefined;
    await attachResume(element, resume);
  } else if (descriptor.kind === 'checkbox') {
    setChecked(element, Boolean(mapping.value));
  } else if (descriptor.kind === 'radio') {
    selectRadio(element, String(mapping.value));
  } else if (descriptor.kind === 'select') {
    setNativeValue(element, String(mapping.value));
  } else {
    setNativeValue(element, String(mapping.value));
  }
  element.setAttribute(EXTENSION_FILLED, descriptor.id);
  dispatchFrameworkEvents(element);
  return {
    fieldId: descriptor.id,
    previousValue,
    previousChecked,
    newValue: mapping.value,
    timestamp: new Date().toISOString()
  };
}

function restoreElement(element: FillableElement, record: FillRecord) {
  if (element instanceof HTMLInputElement && typeof record.previousChecked === 'boolean') element.checked = record.previousChecked;
  setNativeValue(element, String(record.previousValue ?? ''));
  element.removeAttribute(EXTENSION_FILLED);
  dispatchFrameworkEvents(element);
}

function findElement(descriptor: FieldDescriptor): FillableElement | null {
  if (descriptor.idAttribute) {
    const byId = document.getElementById(descriptor.idAttribute);
    if (byId) return byId as FillableElement;
  }
  if (descriptor.name) {
    const byName = document.querySelector(`[name="${cssEscape(descriptor.name)}"]`);
    if (byName) return byName as FillableElement;
  }
  if (descriptor.path) return document.querySelector(descriptor.path) as FillableElement | null;
  return null;
}

function shouldOverwrite(element: Element): boolean {
  if (element.getAttribute(USER_TOUCHED) === 'true') return false;
  if (element.hasAttribute(EXTENSION_FILLED)) return true;
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

function getElementValue(element: FillableElement): unknown {
  if (element instanceof HTMLInputElement) return element.type === 'checkbox' || element.type === 'radio' ? element.checked : element.value;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  return element.textContent;
}

function setNativeValue(element: FillableElement, value: string) {
  if (element instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, value);
  } else if (element instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(element, value);
  } else if (element instanceof HTMLSelectElement) {
    element.value = value;
  } else if (element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox') {
    element.textContent = value;
  }
}

function setChecked(element: FillableElement, checked: boolean) {
  if (element instanceof HTMLInputElement) {
    element.checked = checked;
  } else {
    element.setAttribute('aria-checked', String(checked));
  }
}

function selectRadio(element: FillableElement, value: string) {
  if (!(element instanceof HTMLInputElement) || element.type !== 'radio') {
    setChecked(element, true);
    return;
  }
  const group = element.name
    ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${cssEscape(element.name)}"]`))
    : [element];
  const target = group.find((input) => input.value === value);
  if (target) target.checked = true;
}

async function attachResume(element: FillableElement, resume: StoredResume) {
  if (!(element instanceof HTMLInputElement) || element.type !== 'file') {
    throw new Error('Resume upload field is not a native file input.');
  }
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(new File([resume.buffer], resume.fileName, { type: resume.mimeType }));
  element.files = dataTransfer.files;
}

function dispatchFrameworkEvents(element: Element) {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
}
