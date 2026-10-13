// Rules that can be changed in DevMode without changing the code. They are saved in the shared config.json
// (next to the Dictionary) so everyone's report is built the same way.
// The defaults below give exactly the report the app made before these rules were adjustable.

// Columns of the Audit Report (after "Item Lookup", which is only used inside the app), in order
const REPORT = [
  ['item', 'ITEM'], ['sn', 'S.N.'], ['asset', 'Asset'], ['type', 'Type'],
  ['make', 'Make'], ['model', 'Model'], ['screen', 'Screen'], ['year', 'Year'], ['cpu', 'CPU'], ['ram', 'RAM'],
  ['disk', 'Disk'], ['diagnostics', 'Diagnostics'], ['blancco', 'Blancco result'],
  ['snDataCarrier', 'S.N. Data carrier'], ['noDataCarrier', 'No. Data carrier'],
  ['destruction', 'Data Destruction Method'], ['comments', 'Comments'], ['powerSupply', 'Power Supply'],
  ['weight', 'Weight'], ['itemStatus', 'Item status'], ['estValue', 'Est. Value'], ['locked', 'Locked or Faulty'],
];
const LOCKED = [['sn', 'S.N'], ['type', 'Type'], ['make', 'Make'], ['model', 'Model'], ['issue', 'Issue type'], ['wiped', 'Wiped']];

// Every check the Review tab can show, with what it means (shown in DevMode)
export const CHECKS = {
  reportLineUnknown: 'A report line is neither a Mac nor a Windows line',
  blanccoMissingColumns: 'The Blancco export is missing columns',
  noItemCode: 'A device has no item code',
  duplicateItem: 'The same item code appears twice in one source',
  outsideNumbering: "An item code doesn't follow the project's numbering",
  numberingStart: "The items start far from the project's first item number",
  belowStart: 'An item is below the first item number',
  numberingGaps: 'Item numbers with no data yet',
  unknownMacModel: "A Mac model isn't in the Dictionary",
  cpuNotShortened: "A Blancco CPU name couldn't be shortened",
  erasureFailed: 'An erasure failed',
  noErasureMac: 'No Blancco erasure for a Mac (or a device from Blancco only)',
  noErasureWindows: 'No Blancco erasure for a Windows report device',
  diagnosticsEmpty: 'Diagnostics is empty',
  duplicateAsset: 'The same asset tag is on more than one device',
  simsNoCode: 'SIMS output: a diagnostic has no SIMS code (it goes to Item Remark)',
  simsNoCategory: 'SIMS output: a device type has no SIMS category or codes',
};
export const CHECK_LEVELS = ['error', 'warn', 'info', 'off'];

export const DEFAULT_CONFIG = {
  version: 1,
  // battery % -> grade, checked top to bottom; op '<' = below, '<=' = up to and including
  battery: [
    { op: '<', value: 55, label: 'Battery Defect' },
    { op: '<=', value: 69, label: 'Battery D' },
    { op: '<=', value: 80, label: 'Battery C' },
  ],
  // automatic messages Blancco writes in its comment columns: text containing `match` (any capitals) becomes `text`;
  // an empty `text` drops the message
  blanccoMessages: [{ match: 'Could not connect to the configured network', text: 'WiFi defect' }],
  // comment columns 1..N are typed comments; the ones after are only searched for the messages above
  typedCommentColumns: 6,
  // Blancco export column names (matched by header, any capitals)
  blanccoColumns: {
    make: 'System manufacturer', chassis: 'System chassis type', item: 'Device Identifier', asset: 'Asset Tag',
    erasure: 'Erasure state', serial: 'System serial', version: 'System version', model: 'System model',
    battery: 'Capacity', cpu: 'CPU model', memory: 'Total Memory', memoryType: 'Memory type',
    diskCapacity: 'Disk capacity', diskInterface: 'Disk interface type', diskSerial: 'Disk serial',
    comment1: 'Comment', comment2: 'Comment2', comment3: 'Comment3', comment4: 'Comment4', comment5: 'Comment5', comment6: 'Comment6',
    comment7: 'Comment7', comment8: 'Comment8',
    itemAlt: 'Custom 1',
  },
  erasure: {
    passWords: ['successful'], failWords: ['failed'], // an erasure state containing one of these words
    passText: 'Pass', failText: 'Fail',               // what the Blancco result column says
    destruction: 'Nist SP 800-88',                     // Data Destruction Method for a passed erasure
  },
  // disk interface containing `match` -> name in the Disk column, checked top to bottom
  diskKinds: [{ match: 'nvme', name: 'NVMe' }, { match: 'ssd', name: 'SSD' }, { match: 'sata', name: 'HDD' }],
  texts: {
    itemPrefix: 'ITD',              // ITEM = <this>-<project number>-<item code>
    noDisk: '-',                    // Disk when the Mac / Windows report says NONE
    appleIdLock: 'Apple ID Lock', remoteLocked: 'Remote Locked', batteryService: 'Battery Service',
    simsErased: 'Erased', simsNotErased: 'Not Erased', // SIMS Blancco Result for a passed / failed erasure
    simsNoSpecs: 'n/a',             // SIMS Purchase Description when there is no CPU, RAM or disk
  },
  // asset tag values meaning "no tag" (dots, slashes, spaces and capitals don't matter; "-" covers any number of dashes)
  noAssetTag: ['-', 'N/A', 'none'],
  // makes whose model comes from Blancco's "System version" instead of "System model"
  modelFromVersion: ['LENOVO'],
  checks: {
    reportLineUnknown: 'error', blanccoMissingColumns: 'error', noItemCode: 'warn', duplicateItem: 'warn',
    outsideNumbering: 'warn', numberingStart: 'warn', belowStart: 'warn', numberingGaps: 'warn',
    unknownMacModel: 'warn', cpuNotShortened: 'warn', erasureFailed: 'error', noErasureMac: 'warn',
    noErasureWindows: 'info', diagnosticsEmpty: 'warn', duplicateAsset: 'warn',
    simsNoCode: 'warn', simsNoCategory: 'warn',
  },
  reportColumns: REPORT.map(([key, label]) => ({ key, label })),
  lockedColumns: LOCKED.map(([key, label]) => ({ key, label })),
  // DevMode password (SHA-256 of "audit-builder:" + password)
  passwordHash: '0ed7d1c271a4aef860f91b3251e4f72ba14f4050f265dd0c33ba5f991caf9f38',
  // earlier versions of this file, newest first: [{ savedAt, config }]
  history: [],
};

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// Fills in anything a config file doesn't have (older file, or a rule added later) from the defaults
export function withDefaults(cfg) {
  const d = DEFAULT_CONFIG;
  const c = isObj(cfg) ? cfg : {};
  const list = (k, ok) => (Array.isArray(c[k]) && c[k].every(ok) ? c[k] : structuredClone(d[k]));
  const obj = k => ({ ...d[k], ...(isObj(c[k]) ? c[k] : {}) });
  // columns: keep the file's order and names, drop unknown ones, add new ones at the end
  const columns = k => {
    const known = new Map(d[k].map(x => [x.key, x]));
    const seen = new Set();
    const out = (Array.isArray(c[k]) ? c[k] : []).filter(x => isObj(x) && known.has(x.key) && !seen.has(x.key) && seen.add(x.key))
      .map(x => ({ key: x.key, label: String(x.label ?? known.get(x.key).label) }));
    return [...out, ...d[k].filter(x => !seen.has(x.key)).map(x => ({ ...x }))];
  };
  const checks = obj('checks');
  for (const k of Object.keys(checks)) if (!CHECK_LEVELS.includes(checks[k])) checks[k] = d.checks[k];
  const n = Number(c.typedCommentColumns);
  return {
    version: 1,
    battery: list('battery', x => isObj(x) && ['<', '<='].includes(x.op) && Number.isFinite(Number(x.value))),
    blanccoMessages: list('blanccoMessages', isObj),
    typedCommentColumns: Number.isInteger(n) && n >= 0 && n <= 8 ? n : d.typedCommentColumns,
    blanccoColumns: obj('blanccoColumns'),
    erasure: obj('erasure'),
    diskKinds: list('diskKinds', isObj),
    texts: obj('texts'),
    noAssetTag: list('noAssetTag', x => typeof x === 'string'),
    modelFromVersion: list('modelFromVersion', x => typeof x === 'string'),
    checks,
    reportColumns: columns('reportColumns'),
    lockedColumns: columns('lockedColumns'),
    passwordHash: typeof c.passwordHash === 'string' && c.passwordHash ? c.passwordHash : d.passwordHash,
    history: Array.isArray(c.history) ? c.history : [],
  };
}

// The config's rules without the password and history: what decides how the report comes out
export const rulesOf = cfg => { const { passwordHash, history, ...rules } = cfg; return rules; };

// Problems that would make the rules not work; DevMode won't save while there are any
export function validateConfig(cfg) {
  const out = [];
  cfg.battery.forEach((b, i) => {
    if (b.value === '' || !Number.isFinite(Number(b.value))) out.push(`Battery row ${i + 1}: the % must be a number`);
  });
  cfg.blanccoMessages.forEach((m, i) => { if (!String(m.match ?? '').trim()) out.push(`Blancco messages row ${i + 1}: the text to look for is empty`); });
  for (const [k, v] of Object.entries(cfg.blanccoColumns)) if (!String(v ?? '').trim()) out.push(`Blancco columns: the name for "${k}" is empty`);
  if (!cfg.erasure.passWords.some(w => String(w).trim())) out.push('Erasure: at least one word for a passed erasure is needed');
  if (!String(cfg.erasure.passText).trim()) out.push('Erasure: the text for a passed erasure is empty');
  if (!String(cfg.erasure.failText).trim()) out.push('Erasure: the text for a failed erasure is empty');
  cfg.diskKinds.forEach((x, i) => { if (!String(x.match ?? '').trim()) out.push(`Disk types row ${i + 1}: the text to look for is empty`); });
  for (const k of ['reportColumns', 'lockedColumns']) {
    cfg[k].forEach(x => { if (!String(x.label).trim()) out.push(`${k === 'reportColumns' ? 'Report' : 'Locked and Faulty'} columns: the header for "${x.key}" is empty`); });
  }
  return out;
}
