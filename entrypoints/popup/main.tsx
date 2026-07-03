import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/ui/styles.css';
import type { ExtensionSettings } from '../../src/lib/types';
import { defaultSettings } from '../../src/lib/settings';
import { loadProfile, loadSettings, saveSettings } from '../../src/lib/storage';
import { profileCompleteness } from '../../src/lib/profile';
import { buildProfileDebugData } from '../../src/lib/debug';

const ALL_SITES = ['http://*/*', 'https://*/*'];

function PopupApp() {
  const [settings, setSettings] = useState<ExtensionSettings>(defaultSettings);
  const [domain, setDomain] = useState('');
  const [completeness, setCompleteness] = useState(0);
  const [learnedCount, setLearnedCount] = useState(0);
  const [siteAccess, setSiteAccess] = useState(true);
  const [status, setStatus] = useState('Loading…');

  useEffect(() => {
    Promise.all([loadSettings(), loadProfile(), currentTabDomain(), chrome.permissions.contains({ origins: ALL_SITES })]).then(
      ([loadedSettings, profile, currentDomain, hasSiteAccess]) => {
        setSettings(loadedSettings);
        setCompleteness(profileCompleteness(profile));
        setLearnedCount(profile.reusableAnswers.filter((answer) => answer.source === 'learned' || answer.tags?.includes('learned')).length);
        setDomain(currentDomain);
        setSiteAccess(hasSiteAccess);
        setStatus('Ready');
      }
    );
  }, []);

  async function grantSiteAccess() {
    const granted = await chrome.permissions.request({ origins: ALL_SITES });
    setSiteAccess(granted);
    if (granted) {
      const next = { ...settings, onboarded: true };
      setSettings(next);
      await saveSettings(next);
      setStatus('Site access granted — open a job page to autofill');
    } else {
      setStatus('Site access not granted');
    }
  }

  const sitePaused = domain ? Boolean(settings.pausedSites[domain]) : false;

  async function persist(next: ExtensionSettings) {
    setSettings(next);
    await saveSettings(next);
    setStatus('Saved');
  }

  async function dumpDebugToActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) {
      setStatus('Open an HTTP/HTTPS job page first');
      return;
    }
    try {
      const profile = await loadProfile();
      const debugData = buildProfileDebugData(profile);
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [debugData],
        func: (data) => {
          const selectors = [
            'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"])',
            'textarea',
            'select',
            '[contenteditable="true"]',
            '[role="textbox"]',
            '[role="combobox"]',
            '[role="radio"]',
            '[role="checkbox"]'
          ].join(',');
          const fields = Array.from(document.querySelectorAll(selectors)).map((element, index) => {
            const html = element as HTMLElement;
            const input = element instanceof HTMLInputElement ? element : undefined;
            const textarea = element instanceof HTMLTextAreaElement ? element : undefined;
            const select = element instanceof HTMLSelectElement ? element : undefined;
            const rect = html.getBoundingClientRect();
            const label =
              (html.id ? document.querySelector(`label[for="${CSS.escape(html.id)}"]`)?.textContent?.trim() : '') ||
              element.closest('label')?.textContent?.trim() ||
              html.getAttribute('aria-label') ||
              '';
            return {
              index: index + 1,
              tag: html.tagName.toLowerCase(),
              type: input?.type || html.getAttribute('role') || '',
              name: input?.name || select?.name || textarea?.name || html.getAttribute('name') || '',
              id: html.id || '',
              label,
              placeholder: input?.placeholder || textarea?.placeholder || html.getAttribute('data-placeholder') || '',
              value: input?.type === 'password' ? '[password omitted]' : input?.value || textarea?.value || select?.value || html.textContent?.trim() || '',
              required: Boolean(input?.required || textarea?.required || select?.required || html.getAttribute('aria-required') === 'true'),
              visible: rect.width > 0 && rect.height > 0 && getComputedStyle(html).visibility !== 'hidden' && getComputedStyle(html).display !== 'none'
            };
          });
          const profileFields = data.profileFields.map((field) => ({
            path: field.path,
            value: Array.isArray(field.value) ? field.value.join(', ') : String(field.value ?? ''),
            empty: field.empty
          }));
          const learnedFields = data.learnedFields.map((field) => ({
            question: field.question,
            answer: field.answer,
            domain: field.domain ?? '',
            observationCount: field.observationCount ?? '',
            lastSeenAt: field.lastSeenAt ?? ''
          }));
          const payload = {
            generatedAt: new Date().toISOString(),
            source: 'popup-forced-debug-dump',
            url: location.href,
            title: document.title,
            fieldCount: fields.length,
            profileFieldCount: profileFields.length,
            learnedFieldCount: learnedFields.length,
            fields,
            profileFields: data.profileFields,
            learnedFields: data.learnedFields
          };
          console.warn(
            `[Job Autofill Debug] Forced dump: ${fields.length} page fields, ${learnedFields.length} learned fields, ${profileFields.length} profile fields`
          );
          console.log('Page fields');
          if (fields.length) console.table(fields);
          else console.log('No page fields found by forced dump');
          console.log('Learned fields');
          if (learnedFields.length) console.table(learnedFields);
          else console.log('No learned fields saved');
          console.log('Profile fields');
          if (profileFields.length) console.table(profileFields);
          else console.log('No profile fields found');
          console.log('Copy/paste this JSON into Codex:');
          console.log(JSON.stringify(payload, null, 2));
          return { fieldCount: fields.length };
        }
      });
      const fieldCount = results[0]?.result?.fieldCount ?? 0;
      setStatus(`Debug dumped to page console (${fieldCount} fields)`);
    } catch (error) {
      setStatus(`Debug dump failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <main className="popup">
      <h2>Job Autofill</h2>
      <p className="muted">Profile completeness: {completeness}%</p>
      <p className="muted">Learned answers: {learnedCount}</p>
      <p className="muted">{domain || 'No HTTP/HTTPS tab detected'}</p>
      {!siteAccess ? (
        <div className="helpBox">
          <p>Autofill is off until you allow access to job application pages.</p>
          <button onClick={() => void grantSiteAccess()}>Grant site access</button>
        </div>
      ) : null}
      <div className="row">
        <button
          className={settings.globalPaused ? undefined : 'secondary'}
          onClick={() => void persist({ ...settings, globalPaused: !settings.globalPaused })}
        >
          {settings.globalPaused ? 'Resume global' : 'Pause global'}
        </button>
        <button
          className={sitePaused ? undefined : 'secondary'}
          disabled={!domain}
          onClick={() =>
            void persist({
              ...settings,
              pausedSites: { ...settings.pausedSites, [domain]: !sitePaused }
            })
          }
        >
          {sitePaused ? 'Resume site' : 'Pause site'}
        </button>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className={settings.learnFromUserInput ? 'secondary' : undefined}
          onClick={() => void persist({ ...settings, learnFromUserInput: !settings.learnFromUserInput })}
        >
          {settings.learnFromUserInput ? 'Pause learning' : 'Resume learning'}
        </button>
        <button
          className={settings.debugMode ? undefined : 'secondary'}
          onClick={() => void persist({ ...settings, debugMode: !settings.debugMode })}
        >
          {settings.debugMode ? 'Debug on' : 'Debug off'}
        </button>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => chrome.runtime.openOptionsPage()}>Options</button>
        <button className="secondary" disabled={!domain} onClick={() => void dumpDebugToActiveTab()}>
          Dump debug
        </button>
        <button
          className="secondary"
          onClick={async () => {
            try {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (!tab?.id) return;
              const response = await chrome.tabs.sendMessage(tab.id, { type: 'UNDO_LAST_FILL' });
              setStatus(typeof response?.undone === 'number' ? `Undid ${response.undone} field(s)` : 'Nothing to undo');
            } catch {
              setStatus('No autofill to undo on this page');
            }
          }}
        >
          Undo last
        </button>
      </div>
      <p className="muted">{status}</p>
      <p className="muted">
        <a href="https://buymeacoffee.com/tingkk" target="_blank" rel="noreferrer">
          ☕ Support
        </a>
        {' · '}
        <a href="https://tinglogy.me/job-app-auto/privacy/" target="_blank" rel="noreferrer">
          Privacy
        </a>
      </p>
    </main>
  );
}

async function currentTabDomain(): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return '';
  try {
    const url = new URL(tab.url);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname : '';
  } catch {
    return '';
  }
}

createRoot(document.getElementById('root')!).render(<PopupApp />);
