import type { AutofillAction, AutofillPreviewItem, AutofillResult } from '../types';

const NOTICE_ID = 'job-app-auto-notice';
const DEBUG_MODAL_ID = 'job-app-auto-debug-modal';
const PREVIEW_MODAL_ID = 'job-app-auto-preview-modal';

export function showFillPreviewModal(items: AutofillPreviewItem[]): Promise<boolean> {
  const existing = document.getElementById(PREVIEW_MODAL_ID);
  existing?.remove();

  const host = document.createElement('div');
  host.id = PREVIEW_MODAL_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(15, 23, 42, .55);
        display: grid;
        place-items: center;
        font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .modal {
        width: min(1120px, calc(100vw - 32px));
        max-height: min(860px, calc(100vh - 32px));
        overflow: hidden;
        border-radius: 16px;
        background: #0f172a;
        color: #e5e7eb;
        box-shadow: 0 24px 80px rgba(0,0,0,.35);
        display: grid;
        grid-template-rows: auto auto 1fr auto;
      }
      .header, .footer {
        padding: 14px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .header { border-bottom: 1px solid #1f2937; }
      .footer { border-top: 1px solid #1f2937; }
      h2 { margin: 0; font-size: 18px; color: white; }
      .subtitle {
        padding: 12px 16px;
        color: #cbd5e1;
        border-bottom: 1px solid #1f2937;
      }
      .body {
        overflow: auto;
        padding: 0 16px 16px;
      }
      .entry {
        border: 1px solid #1f2937;
        background: #111827;
        border-radius: 12px;
        padding: 10px;
        margin-top: 10px;
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) minmax(260px, .8fr);
        gap: 12px;
      }
      .label { color: white; font-weight: 650; overflow-wrap: anywhere; }
      .value {
        color: #dbeafe;
        background: #020617;
        border: 1px solid #1f2937;
        border-radius: 8px;
        padding: 7px 8px;
        overflow-wrap: anywhere;
      }
      .meta {
        color: #9ca3af;
        font-size: 12px;
        margin-top: 4px;
        overflow-wrap: anywhere;
      }
      button {
        border: 0;
        border-radius: 10px;
        padding: 8px 10px;
        cursor: pointer;
        background: #374151;
        color: white;
      }
      button.primary { background: #2563eb; }
      button.danger { background: #7f1d1d; }
      @media (max-width: 620px) {
        .entry { grid-template-columns: 1fr; }
      }
    </style>
    <div class="backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Job Autofill preview">
        <div class="header">
          <h2>Review before filling</h2>
          <button id="closeTop">×</button>
        </div>
        <div class="subtitle">
          Job Autofill found ${items.length} field${items.length === 1 ? '' : 's'} it can fill. Review the values below, then approve to write them into the page.
        </div>
        <div class="body">
          ${items.map(renderPreviewItem).join('')}
        </div>
        <div class="footer">
          <span class="meta">The extension will not click Next, Submit, legal attestations, CAPTCHAs, password, or payment fields.</span>
          <div>
            <button id="cancel" class="danger">Cancel</button>
            <button id="approve" class="primary">Approve and fill</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.documentElement.append(host);

  return new Promise((resolve) => {
    const finish = (approved: boolean) => {
      host.remove();
      resolve(approved);
    };
    shadow.getElementById('closeTop')?.addEventListener('click', () => finish(false));
    shadow.getElementById('cancel')?.addEventListener('click', () => finish(false));
    shadow.getElementById('approve')?.addEventListener('click', () => finish(true));
    shadow.querySelector('.backdrop')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) finish(false);
    });
  });
}

export function showResultNotice(result: AutofillResult, onUndo: () => void, onReview: () => void) {
  const existing = document.getElementById(NOTICE_ID);
  existing?.remove();
  const host = document.createElement('div');
  host.id = NOTICE_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .box {
        position: fixed;
        z-index: 2147483647;
        right: 16px;
        bottom: 16px;
        width: 300px;
        border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0,0,0,.20);
        background: #111827;
        color: white;
        font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 12px;
      }
      .row { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
      .counts { color: #d1d5db; margin-top: 6px; }
      button {
        border: 0;
        border-radius: 8px;
        padding: 6px 8px;
        cursor: pointer;
        background: #374151;
        color: white;
      }
      button.primary { background: #2563eb; }
    </style>
    <div class="box">
      <div class="row">
        <strong>Job Autofill</strong>
        <button id="close">×</button>
      </div>
      <div class="counts">${result.filled} filled · ${result.unresolved} unresolved · ${result.failed} failed</div>
      <div class="row" style="margin-top:10px; justify-content:flex-end">
        <button id="undo">Undo</button>
        <button id="review" class="primary">Review</button>
      </div>
    </div>
  `;
  shadow.getElementById('close')?.addEventListener('click', () => host.remove());
  shadow.getElementById('undo')?.addEventListener('click', onUndo);
  shadow.getElementById('review')?.addEventListener('click', onReview);
  document.documentElement.append(host);
  window.setTimeout(() => host.remove(), 10000);
}

export function showDebugModal(result: AutofillResult) {
  const existing = document.getElementById(DEBUG_MODAL_ID);
  existing?.remove();

  const host = document.createElement('div');
  host.id = DEBUG_MODAL_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  const actions: AutofillAction[] = result.actions.length
    ? result.actions
    : result.reviewItems.map((item) => ({
        status: 'unresolved',
        reason: item,
        timestamp: new Date().toISOString()
      }));

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(15, 23, 42, .55);
        display: grid;
        place-items: center;
        font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .modal {
        width: min(1200px, calc(100vw - 32px));
        max-height: min(880px, calc(100vh - 32px));
        overflow: hidden;
        border-radius: 16px;
        background: #0f172a;
        color: #e5e7eb;
        box-shadow: 0 24px 80px rgba(0,0,0,.35);
        display: grid;
        grid-template-rows: auto auto 1fr auto;
      }
      .header, .footer {
        padding: 14px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .header { border-bottom: 1px solid #1f2937; }
      .footer { border-top: 1px solid #1f2937; }
      h2 { margin: 0; font-size: 18px; color: white; }
      .summary {
        padding: 12px 16px;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        border-bottom: 1px solid #1f2937;
      }
      .pill {
        border-radius: 999px;
        padding: 5px 9px;
        background: #1f2937;
        color: #d1d5db;
      }
      .pill.filled { background: #064e3b; color: #d1fae5; }
      .pill.unresolved { background: #78350f; color: #fde68a; }
      .pill.failed { background: #7f1d1d; color: #fecaca; }
      .body {
        overflow: auto;
        padding: 0 16px 16px;
      }
      .entry {
        display: grid;
        gap: 6px;
        border: 1px solid #1f2937;
        background: #111827;
        border-radius: 12px;
        padding: 10px;
        margin-top: 10px;
      }
      .entryHeader {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }
      .status {
        text-transform: uppercase;
        letter-spacing: .06em;
        font-size: 11px;
        font-weight: 700;
      }
      .status.filled { color: #34d399; }
      .status.unresolved { color: #fbbf24; }
      .status.failed { color: #f87171; }
      .status.skipped { color: #93c5fd; }
      .status.detected { color: #9ca3af; }
      .label { color: white; font-weight: 650; }
      .meta { color: #9ca3af; font-size: 12px; overflow-wrap: anywhere; }
      .reason { color: #d1d5db; }
      button {
        border: 0;
        border-radius: 10px;
        padding: 8px 10px;
        cursor: pointer;
        background: #374151;
        color: white;
      }
      button.primary { background: #2563eb; }
      .empty { color: #9ca3af; padding: 18px 0; }
      code {
        background: #020617;
        border: 1px solid #1f2937;
        border-radius: 6px;
        padding: 1px 4px;
      }
    </style>
    <div class="backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Job Autofill debug console">
        <div class="header">
          <h2>Job Autofill Debug Console</h2>
          <button id="closeTop">×</button>
        </div>
        <div class="summary">
          <span class="pill filled">${result.filled} filled</span>
          <span class="pill unresolved">${result.unresolved} unresolved</span>
          <span class="pill failed">${result.failed} failed</span>
          <span class="pill">${result.skipped} skipped</span>
          <span class="pill">${result.mappings.length} mappings</span>
          <span class="pill">${actions.length} actions</span>
        </div>
        <div class="body">
          ${
            actions.length
              ? actions.map(renderAction).join('')
              : '<div class="empty">No debug actions were recorded.</div>'
          }
        </div>
        <div class="footer">
          <span class="meta">Values are truncated previews. Password, payment, hidden, CAPTCHA, signature, and legal attestation fields are not filled.</span>
          <div>
            <button id="copy">Copy JSON</button>
            <button id="closeBottom" class="primary">Close</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const close = () => host.remove();
  shadow.getElementById('closeTop')?.addEventListener('click', close);
  shadow.getElementById('closeBottom')?.addEventListener('click', close);
  shadow.querySelector('.backdrop')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) close();
  });
  shadow.getElementById('copy')?.addEventListener('click', () => {
    void navigator.clipboard.writeText(JSON.stringify(result, null, 2));
  });
  document.documentElement.append(host);
}

function renderPreviewItem(item: AutofillPreviewItem): string {
  const meta = [
    `kind: ${item.kind}`,
    `source: ${item.source}`,
    `confidence: ${Math.round(item.confidence * 100)}%`,
    item.profilePath ? `profile: ${item.profilePath}` : ''
  ]
    .filter(Boolean)
    .join(' · ');
  return `
    <div class="entry">
      <div>
        <div class="label">${escapeHtml(item.label)}</div>
        <div class="meta">${escapeHtml(meta)}</div>
      </div>
      <div class="value">${escapeHtml(item.valuePreview)}</div>
    </div>
  `;
}

function renderAction(action: AutofillResult['actions'][number]): string {
  const label = action.fieldLabel || action.questionText || action.fieldId || 'Unknown field';
  const meta = [
    action.kind ? `kind: ${action.kind}` : '',
    action.source ? `source: ${action.source}` : '',
    typeof action.confidence === 'number' ? `confidence: ${Math.round(action.confidence * 100)}%` : '',
    action.profilePath ? `profile: ${action.profilePath}` : '',
    action.fieldId ? `id: ${action.fieldId}` : ''
  ]
    .filter(Boolean)
    .join(' · ');
  return `
    <div class="entry">
      <div class="entryHeader">
        <div>
          <div class="status ${escapeHtml(action.status)}">${escapeHtml(action.status)}</div>
          <div class="label">${escapeHtml(label)}</div>
        </div>
        <div class="meta">${escapeHtml(new Date(action.timestamp).toLocaleTimeString())}</div>
      </div>
      <div class="reason">${escapeHtml(action.reason)}</div>
      ${action.valuePreview ? `<div class="meta">value preview: <code>${escapeHtml(action.valuePreview)}</code></div>` : ''}
      ${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ''}
      ${action.questionText && action.questionText !== label ? `<div class="meta">question: ${escapeHtml(action.questionText)}</div>` : ''}
    </div>
  `;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
