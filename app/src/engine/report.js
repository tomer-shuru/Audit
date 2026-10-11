// Merges every source into the final Audit Report and Locked and Faulty lists.
// Replaces sheets: Audit Report, Locked and Faulty, My_Audit (manual entries).
import { str, isBlank, joinNonEmpty, expandDiagCodes, formatDiagnostics, proper } from './rules.js';
import {
  itemKey, makeLookups, mergeTables, parseMacLines, parseWindowsLines, sortReportLines, normalizeBlancco, erasureSummary,
  macRecord, windowsRecord, blanccoRecords,
} from './sources.js';
import { DEFAULT_CONFIG, withDefaults } from './config.js';

// Columns of the Audit Report sheet, in order (the order and headers are in the config: "Report columns" in DevMode)
export const reportColumns = (cfg = DEFAULT_CONFIG) => [['itemLookup', 'Item Lookup'], ...cfg.reportColumns.map(c => [c.key, c.label])];
// Columns that can be exported (Item Lookup is only used inside the app)
export const exportColumns = (cfg = DEFAULT_CONFIG) => reportColumns(cfg).filter(([k]) => k !== 'itemLookup');
export const lockedColumns = (cfg = DEFAULT_CONFIG) => cfg.lockedColumns.map(c => [c.key, c.label]);

// the default columns (as the workbook had them)
export const REPORT_COLUMNS = reportColumns();
export const EXPORT_COLUMNS = exportColumns();
export const LOCKED_COLUMNS = lockedColumns();

// asset tag values that mean "no tag" (config): compared without dots, slashes, spaces or capitals; "-" covers "--" etc.
export function isNoAssetTag(value, words = DEFAULT_CONFIG.noAssetTag) {
  const a = str(value).trim();
  if (a === '') return true;
  const norm = s => str(s).toLowerCase().replace(/[.\/\s]/g, '');
  return words.some(w => (/^-+$/.test(str(w).trim()) ? /^-+$/.test(a) : norm(w) !== '' && norm(w) === norm(a)));
}

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
// the ITEM column: "ITD-SHR11734-GG01" ("ITD" is in the config: Texts)
export const itemName = (settings, code, cfg = DEFAULT_CONFIG) => joinNonEmpty('-', cfg.texts.itemPrefix, settings.projectNumber, code);

const first = (...vals) => { for (const v of vals) if (!isBlank(v)) return v; return ''; };

/**
 * project = {
 *   settings: { projectNumber, prefix, endClient },
 *   inputs: { reports: string, blanccoFiles: [{ name, table: string[][] (with header row) }] },
 *     (reports: Mac and Windows report lines together; older projects have them apart in mac / windows)
 *   manual: { [itemCode]: { field: value } },      // My_Audit-style entries (merged like the workbook)
 *   overrides: { [itemCode]: { field: value } },   // Review-table edits (replace the final value)
 * }
 */
// config: the DevMode rules (config.json); left out = the built-in defaults
export function buildReport(project, models, config) {
  const cfg = withDefaults(config);
  const lk = makeLookups(models, cfg);
  const { settings, inputs = {}, manual = {}, overrides = {} } = project;
  const warnings = [];
  // a check's level (red / yellow / gray, or off) comes from the config
  const add = (check, w) => { const level = cfg.checks[check]; if (level && level !== 'off') warnings.push({ ...w, level }); };

  const reports = sortReportLines(inputs.reports);
  for (const u of reports.unknown) {
    add('reportLineUnknown', { text: `Device reports, line ${u.line}: has ${u.fields} fields, but a Mac report line has 17 and a Windows one 11, so it was skipped (${u.text.length > 50 ? u.text.slice(0, 50) + '…' : u.text})` });
  }
  const macLines = parseMacLines(joinNonEmpty('\n', inputs.mac, reports.mac));
  const winLines = parseWindowsLines(joinNonEmpty('\n', inputs.windows, reports.windows));
  const blanccoInput = inputs.blanccoFiles ? mergeTables(inputs.blanccoFiles.map(f => f.table)) : (inputs.blancco || []);
  const blanccoTable = normalizeBlancco(blanccoInput, cfg.blanccoColumns);
  if (blanccoTable.missing.length && blanccoInput.length > 1) {
    add('blanccoMissingColumns', { text: `Blancco export is missing columns: ${blanccoTable.missing.join(', ')}` });
  }
  // the Blancco result column says "Pass…" / "…Fail" (texts from the config)
  const passed = v => str(v).trim().toLowerCase().startsWith(str(cfg.erasure.passText).trim().toLowerCase());
  const failed = v => str(v).toLowerCase().includes(str(cfg.erasure.failText).trim().toLowerCase());
  const blanccoResult = erasureSummary(blanccoTable.rows, cfg.erasure);

  const mac = macLines.map(m => macRecord(m, lk, blanccoResult));
  const win = winLines.map(w => windowsRecord(w, lk, blanccoResult));
  const csv = blanccoRecords(blanccoTable.rows, macLines.map(m => m.sn), lk, blanccoResult);

  // first record per item code wins, like MATCH() in the workbook
  const index = (records, label) => {
    const map = new Map();
    for (const r of records) {
      const k = itemKey(r.item);
      if (k === '') { add('noItemCode', { text: `${label}: device ${r.sn || '(no serial)'} has no item code and was skipped` }); continue; }
      if (map.has(k)) add('duplicateItem', { text: `${label}: item ${r.item} appears more than once; only the first is used` });
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
  const numOf = k => codeNumber(settings, k);
  const sorted = [...keys].sort((a, b) => {
    const na = numOf(a), nb = numOf(b);
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return a.localeCompare(b);
  });

  const outside = sorted.filter(k => numOf(k) === null);
  const firstNumber = numberingStart(settings, sorted).start;
  for (const k of outside) add('outsideNumbering', { item: k, text: `${k}: item code doesn't follow this project's numbering (${itemCode(settings, firstNumber)}, ${itemCode(settings, firstNumber + 1)}…)` });
  warnings.push(...numberingChecks(settings, sorted, cfg));

  const rows = sorted.map(k => {
    const man = manBy.get(k) || {};
    const m = macBy.get(k), w = winBy.get(k), c = csvBy.get(k);
    const code = man.item ?? m?.item ?? w?.item ?? c?.item ?? k;
    const pick = f => first(man[f], m?.[f], w?.[f], c?.[f]);

    const row = {
      itemLookup: code,
      item: itemName(settings, code, cfg),
      sn: pick('sn'), asset: pick('asset'), type: pick('type'),
      // make names from the Dictionary's Make names list; Blancco's otherwise in PROPER case
      make: first(...[man.make, m?.make, w?.make].map(v => lk.make(v) ?? v), c ? lk.make(c.make) ?? proper(c.make) : ''),
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
    row.destruction = first(man.destruction, passed(row.blancco) ? cfg.erasure.destruction : '');
    row.weight = first(man.weight, lk.weight(row.type) ?? '');
    row._sources = { manual: manBy.has(k), mac: !!m, win: !!w, blancco: !!c };
    row._manual = Object.keys(man).filter(f => f !== 'item' && !isBlank(man[f]));
    // edits made in the Review table replace the final value; diagnostic codes work there too
    const edits = overrides[code] || overrides[k] || {};
    const reviewValue = (f, v) => (f === 'diagnostics' ? formatDiagnostics(expandDiagCodes(v, lk.diagCodes))
      : f === 'locked' ? expandDiagCodes(v, lk.diagCodes) : v);
    row._edited = []; row._base = {};
    for (const [f, v] of Object.entries(edits)) {
      if (EDITABLE.has(f) && !isBlank(v)) { row._base[f] = row[f]; row[f] = reviewValue(f, v); row._edited.push(f); }
    }

    if (m?.unknownModel) add('unknownMacModel', { item: code, text: `${code}: Mac model "${m.unknownModel}" isn't in the Models list` });
    if (c && isBlank(row.cpu) && !isBlank(c.rawCpu)) add('cpuNotShortened', { item: code, text: `${code}: couldn't shorten CPU "${c.rawCpu}"` });
    if (failed(row.blancco)) add('erasureFailed', { item: code, text: `${code}: erasure failed (${row.blancco})` });
    if ((m || w) && isBlank(row.blancco)) {
      // Windows reports are used for devices without a disk (no erasure possible), so that's only a note
      if (w && !m) add('noErasureWindows', { item: code, text: `${code}: no Blancco erasure (Windows report, S.N. ${row.sn})` });
      else add('noErasureMac', { item: code, text: `${code}: no Blancco erasure found for S.N. ${row.sn}` });
    }
    if (isBlank(row.diagnostics)) add('diagnosticsEmpty', { item: code, text: `${code}: Diagnostics is empty` });
    return row;
  });

  // Asset tags are unique per device: flag any tag used by more than one item
  // (dashes, N/A, none… mean the device has no tag: config "Asset tags")
  const byAsset = new Map();
  for (const r of rows) {
    const a = str(r.asset).trim();
    if (isNoAssetTag(a, cfg.noAssetTag)) continue;
    const k = a.toLowerCase();
    if (!byAsset.has(k)) byAsset.set(k, []);
    byAsset.get(k).push(r);
  }
  for (const group of byAsset.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      const others = group.filter(x => x !== r).map(x => x.itemLookup).join(', ');
      add('duplicateAsset', { item: r.itemLookup, text: `${r.itemLookup}: Asset ${r.asset} is also used by ${others}` });
    }
  }

  const lockedFaulty = rows.filter(r => !isBlank(r.locked)).map(r => ({
    itemLookup: r.itemLookup, sn: r.sn, type: r.type, make: r.make, model: r.model, issue: r.locked,
    wiped: passed(r.blancco) ? 'Yes' : 'No',
  }));

  return { rows, lockedFaulty, warnings, counts: { mac: mac.length, win: win.length, blancco: csv.length, blanccoRows: blanccoTable.rows.length, manual: manBy.size } };
}

// the number in an item code of this project's numbering (GG07 -> 7), or null
export function codeNumber(settings, key) {
  const prefix = itemKey(settings.prefix);
  return key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length)) ? Number(key.slice(prefix.length)) : null;
}

// The project's first item number (project setup, 1 if not set). If the items in use start far above it
// (e.g. a project numbered from 4000 whose setup still says 1), they start at the lowest one in use instead,
// so there aren't thousands of empty items. keys: item keys in use.
export function numberingStart(settings, keys) {
  const set = String(settings.startNumber ?? '').trim();
  const start = set !== '' && Number.isInteger(Number(set)) && Number(set) >= 0 ? Number(set) : 1;
  const nums = keys.map(k => codeNumber(settings, k)).filter(n => n !== null && n >= start);
  const low = nums.length ? Math.min(...nums) : start;
  return { start: low - start > 100 ? low : start, set: start };
}

// checks on the item numbering: items with no data from the first item number up to the highest one,
// items below the first item number, and a first item number that doesn't fit the items at all
export function numberingChecks(settings, keys, config) {
  const cfg = withDefaults(config);
  const out = [];
  const push = (check, w) => { const level = cfg.checks[check]; if (level && level !== 'off') out.push({ ...w, level, kind: 'numbering' }); };
  const nums = keys.map(k => codeNumber(settings, k)).filter(n => n !== null);
  if (!nums.length) return out;
  const { start, set } = numberingStart(settings, keys);
  const name = n => itemCode(settings, n);
  if (start !== set) push('numberingStart', { text: `The items start at ${name(start)} but the first item number in project setup is ${set}. Click the project name at the top to change it.` });
  for (const k of keys) {
    const n = codeNumber(settings, k);
    if (n !== null && n < start) push('belowStart', { item: k, text: `${k}: below the first item number (${name(start)})` });
  }
  const have = new Set(nums); const gaps = [];
  for (let n = start; n <= Math.max(...nums); n++) if (!have.has(n)) gaps.push(n);
  if (gaps.length) push('numberingGaps', { item: name(gaps[0]), text: `No data yet for: ${compressRanges(gaps).map(([a, b]) => a === b ? name(a) : `${name(a)}–${name(b)}`).join(', ')}` });
  return out;
}

function compressRanges(nums) {
  const out = [];
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && last[1] === n - 1) last[1] = n; else out.push([n, n]);
  }
  return out;
}
