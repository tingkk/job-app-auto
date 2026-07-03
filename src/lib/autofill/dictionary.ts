export interface DictionaryRule {
  path: string;
  confidence: number;
  patterns: RegExp[];
}

export const dictionaryRules: DictionaryRule[] = [
  { path: 'identity.firstName', confidence: 0.95, patterns: [/first\s*name/i, /given\s*name/i, /名(?!字)/, /名字/] },
  { path: 'identity.lastName', confidence: 0.95, patterns: [/last\s*name/i, /family\s*name/i, /surname/i, /姓/] },
  { path: 'identity.fullName', confidence: 0.92, patterns: [/full\s*name/i, /legal\s*name/i, /^name$/i, /姓名|名字/] },
  { path: 'identity.preferredName', confidence: 0.86, patterns: [/preferred\s*name/i, /昵称|暱稱/] },
  { path: 'contact.email', confidence: 0.98, patterns: [/e-?mail/i, /邮箱|郵箱|电子邮件|電子郵件/] },
  { path: 'contact.phone', confidence: 0.95, patterns: [/phone|mobile|cell/i, /电话|電話|手机|手機/] },
  { path: 'address.line1', confidence: 0.88, patterns: [/address\s*(line)?\s*1/i, /street\s*address/i, /地址/] },
  { path: 'address.line2', confidence: 0.83, patterns: [/address\s*(line)?\s*2/i, /apt|suite|unit/i] },
  { path: 'address.city', confidence: 0.9, patterns: [/city/i, /城市|市$/] },
  { path: 'address.region', confidence: 0.9, patterns: [/state|province|region/i, /省|州|地区|地區/] },
  { path: 'address.postalCode', confidence: 0.9, patterns: [/zip|postal/i, /邮编|郵編|邮政编码|郵政編碼/] },
  { path: 'address.country', confidence: 0.9, patterns: [/country/i, /国家|國家/] },
  { path: 'links.linkedin', confidence: 0.94, patterns: [/linkedin/i, /领英|領英/] },
  { path: 'links.github', confidence: 0.9, patterns: [/github/i] },
  { path: 'links.portfolio', confidence: 0.86, patterns: [/portfolio|personal\s*site|website/i, /作品集|个人网站|個人網站/] },
  { path: 'workAuthorization.legallyAuthorized', confidence: 0.88, patterns: [/authorized.*work|right.*work/i, /合法.*工作|工作.*授权|工作.*授權/] },
  { path: 'workAuthorization.requireSponsorship', confidence: 0.9, patterns: [/sponsor|sponsorship|visa.*support/i, /签证.*赞助|簽證.*贊助|工作签证|工作簽證/] },
  { path: 'preferences.desiredLocation', confidence: 0.75, patterns: [/desired.*location|preferred.*location/i, /期望.*地点|期望.*地點/] },
  {
    path: 'preferences.salaryExpectation',
    confidence: 0.82,
    patterns: [
      /expected.*(salary|compensation|pay)|desired.*(salary|compensation|pay)|salary.*expectation|compensation.*expectation/i,
      /期望.*(薪|薪资|薪資|薪金)|預期.*(薪|薪資|薪金)/
    ]
  },
  { path: 'preferences.noticePeriod', confidence: 0.75, patterns: [/notice\s*period|available\s*start|start\s*date/i, /到岗|到職|入职|入職/] },
  { path: 'resume.file', confidence: 0.96, patterns: [/resume|cv|curriculum/i, /简历|簡歷|履历|履歷/] },
  { path: 'demographics.gender', confidence: 0.82, patterns: [/gender/i, /性别|性別/] },
  { path: 'demographics.ethnicity', confidence: 0.78, patterns: [/ethnicity|race/i, /种族|種族|族裔/] },
  { path: 'demographics.veteranStatus', confidence: 0.78, patterns: [/veteran/i, /退伍|军人|軍人/] },
  { path: 'demographics.disabilityStatus', confidence: 0.78, patterns: [/disability/i, /残疾|殘疾|障碍|障礙/] }
];

export const autocompleteMap: Record<string, string> = {
  'given-name': 'identity.firstName',
  'additional-name': 'identity.middleName',
  'family-name': 'identity.lastName',
  name: 'identity.fullName',
  email: 'contact.email',
  tel: 'contact.phone',
  'tel-country-code': 'contact.countryCode',
  'address-line1': 'address.line1',
  'address-line2': 'address.line2',
  'address-level2': 'address.city',
  'address-level1': 'address.region',
  'postal-code': 'address.postalCode',
  country: 'address.country',
  url: 'links.portfolio'
};
