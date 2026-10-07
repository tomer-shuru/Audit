// Merges every source into the final Audit Report and Locked and Faulty lists.
// Replaces sheets: Audit Report, Locked and Faulty, My_Audit (manual entries).
import { str, isBlank, joinNonEmpty, expandDiagCodes, formatDiagnostics, proper } from './rules.js';
import {
  itemKey, makeLookups, mergeTables, parseMacLines, parseWindowsLines, normalizeBlancco, erasureSummary,
  macRecord, windowsRecord, blanccoRecords,
} from './sources.js';

// Columns of the Audit Report sheet, in order
export const REPORT_COLUMNS = [
  ['itemLookup', 'Item Lookup'], ['item', 'ITEM'], ['sn', 'S.N.'], ['asset', 'Asset'], ['type', 'Type'],
  ['make', 'Make'], ['model', 'Model'], ['screen', 'Screen'], ['year', 'Year'], ['cpu', 'CPU'], ['ram', 'RAM'],
  ['disk', 'Disk'], ['diagnostics', 'Diagnostics'], ['blancco', 'Blancco result'],
  ['snDataCarrier', 'S.N. Data carrier'], ['noDataCarrier', 'No. Data carrier'],
  ['destruction', 'Data Destruction Method'], ['comments', 'Comments'], ['powerSupply', 'Power Supply'],
  ['weight', 'Weight'], ['itemStatus', 'Item status'], ['estValue', 'Est. Value'], ['locked', 'Locked or Faulty'],
];

// Columns that can be exported (Item Lookup is only used inside the app)
export const EXPORT_COLUMNS = REPORT_COLUMNS.filter(([k]) => k !== 'itemLookup');

export const LOCKED_COLUMNS = [
  ['sn', 'S.N'], ['type', 'Type'], ['make', 'Make'], ['model', 'Model'], ['issue', 'Issue type'], ['wiped', 'Wiped'],
];

// Fields a person can type for an item (My_Audit columns + the hand-typed Audit Report columns).
// Anything typed here wins over the tools' data.
export const MANUAL_FIELDS = [
  ['sn', 'S.N.'], ['asset', 'Asset Tag'], ['type', 'Type'], ['make', 'Make'], ['model', 'Model'],
  ['screen', 'Screen'], ['year', 'Year'], ['cpu', 'CPU'], ['ram', 'RAM'], ['disk', 'Disk'],
  ['locked', 'Locked or Faulty'], ['diagnostics', 'Diagnostics'], ['blancco', 'Wiping result'],
  ['snDataCarrier', 'S.N. Data carrier'], ['noDataCarrier', 'No. Data carrier'],
  ['destruction', 'Data Destruction Method'], ['comments', 'Comments'], ['powerSupply', 'Power Supply'],
  ['weight', 'Weight'], ['itemStatus', 'Item status'], ['estValue', 'Est. Value'],
];

// Report columns that can be edited in the Review table
export const EDITABLE = new Set(REPORT_COLUMNS.map(([k]) => k).filter(k => k !== 'itemLookup' && k !== 'item'));

export const itemCode =(settings, n) => str(settings.prefix) + String(n).padStart(2, '0');

const first = (...vals) => { for (const v of vals) if (!isBlank(v)) return v; return ''; };

/**
 * project = {
 *   settings: { projectNumber, prefix, endClient },
 *   inputs: { mac: string, windows: string, blanccoFiles: [{ name, table: string[][] (with header row) }] },
 *   manual: { [itemCode]: { field: value } },      // My_Audit-style entries (merged like the workbook)
 *   overrides: { [itemCode]: { field: value } },   // Review-table edits (replace the final value)
 * }
 */
export function buildReport(project, models) {
  const lk = makeLookups(models);
  const { settings, inputs = {}, manual = {}, overrides = {} } = project;
  const warnings = [];

  const macLines = parseMacLines(inputs.mac);
  const winLines = parseWindowsLines(inputs.windows);
  const blanccoInput = inputs.blanccoFiles ? mergeTables(inputs.blanccoFiles.map(f => f.table)) : (inputs.blancco || []);
  const blanccoTable = normalizeBlancco(blanccoInput);
  if (blanccoTable.missing.length && blanccoInput.length > 1) {
    warnings.push({ level: 'error', text: `Blancco export is missing columns: ${blanccoTable.missing.join(', ')}` });
  }
  const blanccoResult = erasureSummary(blanccoTable.rows);

  const mac = macLines.map(m => macRecord(m, lk, blanccoResult));
  const win = winLines.map(w => windowsRecord(w, lk, blanccoResult));
  const csv = blanccoRecords(blanccoTable.rows, macLines.map(m => m.sn), lk, blanccoResult);

  // first record per item code wins, like MATCH() in the workbook
  const index = (records, label) => {
    const map = new Map();
    for (const r of records) {
      const k = itemKey(r.item);
      if (k === '') { warnings.push({ level: 'warn', text: `${label}: device ${r.sn || '(no serial)'} has no item code and was skipped` }); continue; }
      if (map.has(k)) warnings.push({ level: 'warn', text: `${label}: item ${r.item} appears more than once; only the first is used` });
      else map.set(k, r);
    }
    return map;
  };
  const macBy = index(mac, 'Mac reports');
  const winBy = index(win, 'Windows reports');
  const csvBy = index(csv, 'Blancco');
  const manBy = new Map();
  for (const [code, rec] of Object.entries(manual)) {
    if (rec && Object.values(rec).some(v => !isBlank(v))) manBy.set(itemKey(code), { ...rec, item: code });
  }

  // order: codes in the project's numbering first, then anything else
  const keys = new Set([...manBy.keys(), ...macBy.keys(), ...winBy.keys(), ...csvBy.keys()]);
  const prefix = itemKey(settings.prefix);
  const numOf = k => (prefix && k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length)) ? Number(k.slice(prefix.length)) : null);
  const sorted = [...keys].sort((a, b) => {
    const na = numOf(a), nb = numOf(b);
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return a.localeCompare(b);
  });

  const outside = sorted.filter(k => numOf(k) === null);
  for (const k of outside) warnings.push({ level: 'warn', item: k, text: `${k}: item code doesn't follow this project's numbering (${settings.prefix}01, ${settings.prefix}02…)` });

  const nums = sorted.map(numOf).filter(n => n !== null);
  if (nums.length) {
    const have = new Set(nums); const gaps = [];
    for (let n = Math.min(...nums); n <= Math.max(...nums); n++) if (!have.has(n)) gaps.push(n);
    if (gaps.length) warnings.push({ level: 'info', text: `No data yet for: ${compressRanges(gaps).map(([a, b]) => a === b ? itemCode(settings, a) : `${itemCode(settings, a)}–${itemCode(settings, b)}`).join(', ')}` });
  }

  const rows = sorted.map(k => {
    const man = manBy.get(k) || {};
    const m = macBy.get(k), w = winBy.get(k), c = csvBy.get(k);
    const code = man.item ?? m?.item ?? w?.item ?? c?.item ?? k;
    const pick = f => first(man[f], m?.[f], w?.[f], c?.[f]);

    const row = {
      itemLookup: code,
      item: joinNonEmpty('-', 'ITD', settings.projectNumber, code),
      sn: pick('sn'), asset: pick('asset'), type: pick('type'),
      make: first(man.make, m?.make, w?.make, c ? proper(c.make) : ''),
      model: pick('model'),
      // Screen: Mac, then Windows, then typed (blank Blancco screens are never used)
      screen: first(man.screen, m ? m.screen : (w ? w.screen : '')),
      year: pick('year'), cpu: pick('cpu'), ram: pick('ram'), disk: pick('disk'),
      diagnostics: formatDiagnostics(expandDiagCodes(joinNonEmpty(', ', man.locked, man.diagnostics, m?.diagnostics, w?.diagnostics, c?.diagnostics), lk.diagCodes)),
      blancco: pick('blancco'),
      snDataCarrier: str(man.snDataCarrier), noDataCarrier: str(man.noDataCarrier),
      comments: str(man.comments), powerSupply: str(man.powerSupply),
      itemStatus: str(man.itemStatus), estValue: str(man.estValue),
      locked: expandDiagCodes(joinNonEmpty(', ', man.locked, m?.locked, w?.locked), lk.diagCodes),
    };
    row.destruction = first(man.destruction, str(row.blancco).toLowerCase().startsWith('pass') ? 'Nist SP 800-88' : '');
    row.weight = first(man.weight, lk.weight(row.type) ?? '');
    row._sources = { manual: manBy.has(k), mac: !!m, win: !!w, blancco: !!c };
    row._manual = Object.keys(man).filter(f => f !== 'item' && !isBlank(man[f]));
    // edits made in the Review table replace the final value
    const edits = overrides[code] || overrides[k] || {};
    row._edited = []; row._base = {};
    for (const [f, v] of Object.entries(edits)) {
      if (EDITABLE.has(f) && !isBlank(v)) { row._base[f] = row[f]; row[f] = v; row._edited.push(f); }
    }

    if (m?.unknownModel) warnings.push({ level: 'warn', item: code, text: `${code}: Mac model "${m.unknownModel}" isn't in the Models list` });
    if (c && isBlank(row.cpu) && !isBlank(c.rawCpu)) warnings.push({ level: 'warn', item: code, text: `${code}: couldn't shorten CPU "${c.rawCpu}"` });
    if (/fail/i.test(row.blancco)) warnings.push({ level: 'error', item: code, text: `${code}: erasure failed (${row.blancco})` });
    if ((m || w) && isBlank(row.blancco)) warnings.push({ level: 'warn', item: code, text: `${code}: no Blancco erasure found for S.N. ${row.sn}` });
    if (isBlank(row.diagnostics)) warnings.push({ level: 'warn', item: code, text: `${code}: Diagnostics is empty` });
    return row;
  });

  const lockedFaulty = rows.filter(r => !isBlank(r.locked)).map(r => ({
    itemLookup: r.itemLookup, sn: r.sn, type: r.type, make: r.make, model: r.model, issue: r.locked,
    wiped: str(r.blancco).toLowerCase().startsWith('pass') ? 'Yes' : 'No',
  }));

  return { rows, lockedFaulty, warnings, counts: { mac: mac.length, win: win.length, blancco: csv.length, blanccoRows: blanccoTable.rows.length, manual: manBy.size } };
}

function compressRanges(nums) {
  const out = [];
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && last[1] === n - 1) last[1] = n; else out.push([n, n]);
  }
  return out;
}
