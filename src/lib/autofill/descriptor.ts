import type { FieldDescriptor, FieldKind, FieldOption } from '../types';
import { detectLanguage, normalizeText } from './language';
import { detectAts } from './ats';

type FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;

const inputKindByType: Record<string, FieldKind> = {
  text: 'text',
  search: 'text',
  email: 'email',
  tel: 'tel',
  url: 'url',
  date: 'date',
  month: 'date',
  number: 'number',
  file: 'file',
  password: 'password',
  hidden: 'hidden',
  checkbox: 'checkbox',
  radio: 'radio'
};

export function collectFieldDescriptors(root: ParentNode = document): FieldDescriptor[] {
  const ats = detectAts();
  const elements = collectFillableElements(root);
  return elements.map((element, index) => describeElement(element, index, ats)).filter((field) => field.visible || field.kind === 'hidden');
}

export function collectFillableElements(root: ParentNode = document): FillableElement[] {
  const seen = new Set<Element>();
  const result: FillableElement[] = [];
  const visit = (node: ParentNode) => {
    const candidates = node.querySelectorAll(
      [
        'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"])',
        'textarea',
        'select',
        '[contenteditable="true"]',
        '[role="textbox"]',
        '[role="combobox"]',
        '[role="radio"]',
        '[role="checkbox"]'
      ].join(',')
    );
    candidates.forEach((candidate) => {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        result.push(candidate as FillableElement);
      }
      const shadowRoot = (candidate as HTMLElement).shadowRoot;
      if (shadowRoot) visit(shadowRoot);
    });
    node.querySelectorAll('*').forEach((element) => {
      const shadowRoot = (element as HTMLElement).shadowRoot;
      if (shadowRoot) visit(shadowRoot);
    });
  };
  visit(root);
  return result;
}

export function describeElement(element: FillableElement, index: number, ats?: string): FieldDescriptor {
  const html = element as HTMLElement;
  const input = element instanceof HTMLInputElement ? element : undefined;
  const select = element instanceof HTMLSelectElement ? element : undefined;
  const textarea = element instanceof HTMLTextAreaElement ? element : undefined;
  const tagName = element.tagName.toLowerCase();
  const inputType = input?.type?.toLowerCase();
  const kind = inferKind(element);
  const label = findLabel(element);
  const ariaLabel = html.getAttribute('aria-label') ?? undefined;
  const placeholder = input?.placeholder || textarea?.placeholder || html.getAttribute('data-placeholder') || undefined;
  const nearbyText = findNearbyText(element);
  const questionText = normalizeText([label, ariaLabel, placeholder, nearbyText, input?.name, input?.id].filter(Boolean).join(' '));
  const rect = html.getBoundingClientRect();
  return {
    id: stableFieldId(element, index),
    kind,
    tagName,
    inputType,
    name: input?.name || select?.name || textarea?.name || html.getAttribute('name') || undefined,
    idAttribute: html.id || undefined,
    autocomplete: input?.autocomplete || textarea?.autocomplete || undefined,
    label,
    ariaLabel,
    placeholder,
    nearbyText,
    questionText,
    options: collectOptions(element),
    required: Boolean(input?.required || select?.required || textarea?.required || html.getAttribute('aria-required') === 'true'),
    visible: rect.width > 0 && rect.height > 0 && getComputedStyle(html).visibility !== 'hidden' && getComputedStyle(html).display !== 'none',
    disabled: Boolean(input?.disabled || select?.disabled || textarea?.disabled || html.getAttribute('aria-disabled') === 'true'),
    readonly: Boolean(input?.readOnly || textarea?.readOnly || html.getAttribute('aria-readonly') === 'true'),
    ats,
    path: cssPath(element),
    language: detectLanguage(questionText)
  };
}

function inferKind(element: FillableElement): FieldKind {
  if (element instanceof HTMLTextAreaElement) return 'textarea';
  if (element instanceof HTMLSelectElement) return 'select';
  if (element instanceof HTMLInputElement) return inputKindByType[element.type.toLowerCase()] ?? 'text';
  const role = element.getAttribute('role');
  if (role === 'combobox') return 'select';
  if (role === 'checkbox') return 'checkbox';
  if (role === 'radio') return 'radio';
  if (role === 'textbox' || element.getAttribute('contenteditable') === 'true') return 'text';
  return 'unknown';
}

function collectOptions(element: FillableElement): FieldOption[] {
  if (element instanceof HTMLSelectElement) {
    return Array.from(element.options).map((option) => ({
      label: option.textContent?.trim() || option.value,
      value: option.value,
      selected: option.selected
    }));
  }
  if (element instanceof HTMLInputElement && ['radio', 'checkbox'].includes(element.type)) {
    const group = element.name
      ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="${element.type}"][name="${cssEscape(element.name)}"]`))
      : [element];
    return group.map((input) => ({
      label: findLabel(input) ?? input.value,
      value: input.value,
      selected: input.checked
    }));
  }
  const owned = element.getAttribute('aria-controls');
  const listbox = owned ? document.getElementById(owned) : undefined;
  const options = listbox?.querySelectorAll('[role="option"]') ?? element.querySelectorAll?.('[role="option"]');
  return Array.from(options ?? []).map((option) => ({
    label: option.textContent?.trim() || option.getAttribute('data-value') || '',
    value: option.getAttribute('data-value') || option.getAttribute('aria-label') || option.textContent?.trim() || '',
    selected: option.getAttribute('aria-selected') === 'true'
  }));
}

function findLabel(element: Element): string | undefined {
  const id = (element as HTMLElement).id;
  if (id) {
    const label = document.querySelector(`label[for="${cssEscape(id)}"]`)?.textContent?.trim();
    if (label) return label;
  }
  const wrappingLabel = element.closest('label')?.textContent?.trim();
  if (wrappingLabel) return wrappingLabel;
  const ariaLabelledBy = element.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const label = ariaLabelledBy
      .split(/\s+/)
      .map((part) => document.getElementById(part)?.textContent?.trim())
      .filter(Boolean)
      .join(' ');
    if (label) return label;
  }
  return undefined;
}

function findNearbyText(element: Element): string | undefined {
  const containers = [
    element.closest('label'),
    element.closest('tr'),
    element.closest('li'),
    element.closest('[role="group"]'),
    element.closest('[role="radiogroup"]'),
    element.parentElement,
    element.closest('div,fieldset,section')
  ].filter((container): container is Element => Boolean(container));

  for (const container of containers) {
    if (!isSafeNearbyContainer(container)) continue;
    const text = elementText(container);
    if (text) return text.slice(0, 240);
  }
  return undefined;
}

function isSafeNearbyContainer(container: Element): boolean {
  if (['FORM', 'BODY', 'HTML'].includes(container.tagName)) return false;
  const text = elementText(container);
  if (!text || text.length > 240) return false;
  return countFillableDescendants(container) <= 3;
}

function countFillableDescendants(container: Element): number {
  return container.querySelectorAll(
    [
      'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"])',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="radio"]',
      '[role="checkbox"]'
    ].join(',')
  ).length;
}

function elementText(element: Element): string | undefined {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,noscript,template')) return NodeFilter.FILTER_REJECT;
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const parts: string[] = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim() || undefined;
}

function stableFieldId(element: Element, index: number): string {
  const html = element as HTMLElement;
  return [html.id, element.getAttribute('name'), element.getAttribute('autocomplete'), cssPath(element), index]
    .filter(Boolean)
    .join('|');
}

export function cssPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
    const id = (current as HTMLElement).id;
    if (id) {
      parts.unshift(`#${cssEscape(id)}`);
      break;
    }
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    const siblings: Element[] = parent
      ? Array.from(parent.children).filter((child): child is Element => child instanceof Element && child.tagName === current?.tagName)
      : [];
    const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
    parts.unshift(`${tag}${nth}`);
    current = parent;
  }
  return parts.join(' > ');
}

export function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
