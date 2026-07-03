import type { LanguageCode } from '../types';

export function detectLanguage(text: string): LanguageCode {
  if (/[\u4e00-\u9fff]/.test(text)) {
    if (/[後國學歷聯繫電話郵件應徵]/.test(text)) return 'zh-Hant';
    return 'zh-Hans';
  }
  if (/[a-z]/i.test(text)) return 'en';
  return 'unknown';
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[＊*]/g, '')
    .replace(/[：:]/g, ' ')
    .replace(/[^\p{L}\p{N}\s@.+#/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
