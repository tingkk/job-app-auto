export type AtsKind = 'workday' | 'greenhouse' | 'lever' | 'smartrecruiters' | 'ashby' | 'icims' | 'taleo';

const ATS_PATTERNS: Array<[AtsKind, RegExp]> = [
  ['workday', /myworkdayjobs|workdayjobs|wd\d+\.myworkdayjobs/i],
  ['greenhouse', /greenhouse\.io|boards\.greenhouse/i],
  ['lever', /lever\.co|jobs\.lever/i],
  ['smartrecruiters', /smartrecruiters\.com/i],
  ['ashby', /ashbyhq\.com|jobs\.ashbyhq/i],
  ['icims', /icims\.com/i],
  ['taleo', /taleo\.net/i]
];

export function detectAts(url = location.href, documentText = document.title): AtsKind | undefined {
  const haystack = `${url}\n${documentText}`;
  return ATS_PATTERNS.find(([, pattern]) => pattern.test(haystack))?.[0];
}

export function atsProfileHints(ats: AtsKind | undefined, text: string): string[] {
  if (!ats) return [];
  const normalized = text.toLowerCase();
  if (ats === 'greenhouse' && normalized.includes('resume')) return ['resume.file'];
  if (ats === 'lever' && normalized.includes('linkedin')) return ['links.linkedin'];
  if (ats === 'workday' && normalized.includes('source')) return [];
  return [];
}
