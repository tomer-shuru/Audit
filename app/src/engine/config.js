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

// Every check the Review tab can show: [key, default level, what it means (shown in DevMode)]
const CHECK_LIST = [
  ['reportLineUnknown', 'error', 'A report line is neither a Mac nor a Windows line'],
  ['blanccoMissingColumns', 'error', 'The Blancco export is missing columns'],
  ['noItemCode', 'warn', 'A device has no item code'],
  ['duplicateItem', 'warn', 'The same item code appears twice in one source'],
  ['outsideNumbering', 'warn', "An item code doesn't follow the project's numbering"],
  ['numberingStart', 'warn', "The items start far from the project's first item number"],
  ['belowStart', 'warn', 'An item is below the first item number'],
  ['numberingGaps', 'warn', 'Item numbers with no data yet'],
  ['farNumber', 'error', 'An item number is far above the others (more than 200), probably a typo'],
  ['itemGroups', 'info', 'Extra item groups were found (codes that start with the prefix and more letters, e.g. MS-M01)'],
  ['unknownMacModel', 'warn', "A Mac model isn't in the Dictionary"],
  ['cpuNotShortened', 'warn', "A Blancco CPU name couldn't be shortened"],
  ['erasureFailed', 'error', 'An erasure failed'],
  ['noErasureMac', 'warn', 'No Blancco erasure for a Mac (or a device from Blancco only)'],
  ['noErasureWindows', 'info', 'No Blancco erasure for a Windows report device'],
  ['diagnosticsEmpty', 'warn', 'Diagnostics is empty'],
  ['duplicateAsset', 'warn', 'The same asset tag is on more than one device'],
  ['simsNoCode', 'sims', 'SIMS output: a diagnostic has no SIMS code (it goes to Item Remark)'],
  ['simsNoCategory', 'sims', 'SIMS output: a device type has no SIMS category or codes'],
];
export const CHECKS = Object.fromEntries(CHECK_LIST.map(([key, , meaning]) => [key, meaning]));
// sims (blue): SIMS output notes, kept apart from the warnings
export const CHECK_LEVELS = ['error', 'warn', 'info', 'sims', 'off'];

// A function that adds a warning for a check to list, at the check's level in the config (nothing when it is off).
// extra: fields added to every warning.
export const warnAdder = (cfg, list, extra = {}) => (check, w) => {
  const level = cfg.checks[check];
  if (level && level !== 'off') list.push({ ...w, level, ...extra });
};

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
  checks: Object.fromEntries(CHECK_LIST.map(([key, level]) => [key, level])),
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
  const empty = v => !String(v ?? '').trim();
  cfg.battery.forEach((b, i) => {
    if (b.value === '' || !Number.isFinite(Number(b.value))) out.push(`Battery row ${i + 1}: the % must be a number`);
  });
  cfg.blanccoMessages.forEach((m, i) => { if (empty(m.match)) out.push(`Blancco messages row ${i + 1}: the text to look for is empty`); });
  for (const [k, v] of Object.entries(cfg.blanccoColumns)) if (empty(v)) out.push(`Blancco columns: the name for "${k}" is empty`);
  if (!cfg.erasure.passWords.some(w => !empty(w))) out.push('Erasure: at least one word for a passed erasure is needed');
  if (empty(cfg.erasure.passText)) out.push('Erasure: the text for a passed erasure is empty');
  if (empty(cfg.erasure.failText)) out.push('Erasure: the text for a failed erasure is empty');
  cfg.diskKinds.forEach((x, i) => { if (empty(x.match)) out.push(`Disk types row ${i + 1}: the text to look for is empty`); });
  for (const k of ['reportColumns', 'lockedColumns']) {
    cfg[k].forEach(x => { if (empty(x.label)) out.push(`${k === 'reportColumns' ? 'Report' : 'Locked and Faulty'} columns: the header for "${x.key}" is empty`); });
  }
  return out;
}
