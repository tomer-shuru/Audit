// Turns raw inputs (Mac lines, Windows lines, Blancco rows) into per-device records.
// Replaces sheets: MacReports, Output_Mac, WindowsReports, Output_Win, CSV, CPU_Formula, Disk_Pivot.
import {
  str, isBlank, low, eqi, hasText, joinNonEmpty, toNumber, batteryGrade, windowsBatteryPct,
  formatRamMac, formatRamWindows, formatRamBlancco, formatDiskCapacity, diskKind,
  shortCpu, cleanModelName,
} from './rules.js';
import { DEFAULT_CONFIG } from './config.js';

// codes that are only numbers (no prefix) match with or without leading zeros: 7, 07, 007
export const itemKey = code => str(code).trim().toUpperCase().replace(/^0+(?=\d+$)/, '');

const MAC_FIELDS = ['item', 'sn', 'asset', 'type', 'make', 'modelId', 'cpu', 'ram', 'disk', 'batteryHealth',
  'activationLock', 'findMyLock', 'remote', 'batteryStatus', 'diskSn', 'timestamp', 'diagnostics'];
const WIN_FIELDS = ['item', 'sn', 'asset', 'type', 'make', 'model', 'cpu', 'ram', 'disk', 'battery', 'diagnostics'];

function splitLines(text, fields) {
  return str(text).split(/\r?\n/)
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.trim() !== '')
    .map((line, i) => {
      const parts = line.split('*');
      const rec = { line: i + 1, raw: line };
      fields.forEach((f, j) => { rec[f] = (parts[j] ?? '').trim(); });
      return rec;
    });
}
export const parseMacLines = text => splitLines(text, MAC_FIELDS);
export const parseWindowsLines = text => splitLines(text, WIN_FIELDS);

// Mac and Windows report lines pasted together, told apart by their number of fields (17 Mac, 11 Windows).
// Returns the Mac and Windows lines as text, and the lines that are neither: [{ line, fields, text }]
export function sortReportLines(text) {
  const mac = [], windows = [], unknown = [];
  str(text).split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    const fields = line.split('*').length;
    if (fields === MAC_FIELDS.length) mac.push(line);
    else if (fields === WIN_FIELDS.length) windows.push(line);
    else unknown.push({ line: i + 1, fields, text: line.trim() });
  });
  return { mac: mac.join('\n'), windows: windows.join('\n'), unknown };
}

// --- lookups into the Models data ---
// cfg: the DevMode rules (config.json), carried along with the lookups to every record builder
export function makeLookups(models, cfg = DEFAULT_CONFIG) {
  // key (any capitals) -> value of the first row with that key, like MATCH(); returns a lookup function
  const lookup = (list, key, value) => {
    const map = new Map();
    for (const x of list) { const k = low(key(x)); if (!map.has(k)) map.set(k, value(x)); }
    return v => map.get(low(v));
  };
  return {
    model: lookup(models.models, m => m.id, m => m),
    mapType: lookup(models.typeMap, t => t.blanccoType, t => t.type),
    weight: lookup(models.typeWeights, t => t.type, t => t.weight),
    // make name as the report should show it ("Dell Inc." -> "Dell"), or undefined if it isn't in the list
    make: lookup((models.makeMap || []).filter(t => low(t.from)), t => t.from, t => str(t.to).trim()),
    cleanupRules: models.cleanupRules,
    diagCodes: models.diagCodes,
    cfg,
  };
}

// --- Blancco export ---
// Column names are matched by header text, so the export's column order doesn't matter.
// The names are in the config ("Blancco columns" in DevMode); these are the defaults.
export const BLANCCO_COLUMNS = DEFAULT_CONFIG.blanccoColumns;
// Optional columns: no warning when an export doesn't have them
const COMMENTS = ['comment1', 'comment2', 'comment3', 'comment4', 'comment5', 'comment6', 'comment7', 'comment8'];
const OPTIONAL = new Set(['itemAlt', ...COMMENTS]);

// Diagnostics text from a Blancco row: comments 1-6 as typed (like the workbook; the number is in the config),
// automatic messages (config "Blancco messages") from any comment column, each finding listed once.
// A message whose report text is empty is dropped.
export function blanccoComments(r, cfg = DEFAULT_CONFIG) {
  const all = COMMENTS.map(k => r[k]);
  const typed = all.slice(0, cfg.typedCommentColumns);
  const extra = all.slice(cfg.typedCommentColumns);
  const out = [];
  const add = text => { if (text && !out.some(x => x.toLowerCase() === text.toLowerCase())) out.push(text); };
  const message = c => cfg.blanccoMessages.find(m => hasText(c, m.match));
  for (const c of typed) {
    const s = c === 0 ? '' : str(c).trim();
    if (s === '' || s === '0') continue;
    const m = message(s);
    if (m) { add(str(m.text).trim()); continue; }
    // a typed comment may already say it (e.g. "CD C, WiFi defect, DI C") - keep it, but don't repeat later
    for (const part of s.split(',').map(p => p.trim()).filter(Boolean)) add(part);
  }
  for (const c of extra) { const m = message(c); if (m) add(str(m.text).trim()); }
  return out;
}

// Some exports repeat a header ("Comment", "Comment", ...). Number the repeats the way older
// exports did ("Comment", "Comment2", "Comment3", ...) so every column keeps its own data.
export function uniqueHeaders(header) {
  const seen = new Map();
  return header.map(h => {
    const name = str(h).trim();
    const k = name.toLowerCase();
    if (k === '') return name;
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return n === 1 ? name : name + n;
  });
}

// Combines several exports (each an array of arrays with its own header row) into one table.
// Columns are lined up by header name; rows that appear in more than one file are kept once.
export function mergeTables(tables) {
  const valid = tables.filter(t => t && t.length > 0).map(t => [uniqueHeaders(t[0]), ...t.slice(1)]);
  if (valid.length === 0) return [];
  const header = [];
  const pos = new Map();
  for (const t of valid) {
    for (const h of t[0]) {
      const k = str(h).trim().toLowerCase();
      if (k !== '' && !pos.has(k)) { pos.set(k, header.length); header.push(str(h).trim()); }
    }
  }
  const out = [header];
  const seen = new Set();
  for (const t of valid) {
    const map = t[0].map(h => pos.get(str(h).trim().toLowerCase()));
    for (const r of t.slice(1)) {
      if (!r.some(v => !isBlank(v))) continue;
      const row = new Array(header.length).fill('');
      r.forEach((v, j) => { if (map[j] !== undefined) row[map[j]] = v ?? ''; });
      const key = JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key); out.push(row);
    }
  }
  return out;
}

// rows: array of arrays, first row = headers; columns: the config's Blancco column names
export function normalizeBlancco(table, columns = BLANCCO_COLUMNS) {
  if (!table || table.length === 0) return { rows: [], missing: [] };
  const header = uniqueHeaders(table[0]).map(h => h.toLowerCase());
  const idx = {}; const missing = [];
  for (const [key, name] of Object.entries(columns)) {
    idx[key] = header.indexOf(str(name).trim().toLowerCase());
    if (idx[key] < 0 && !OPTIONAL.has(key)) missing.push(name);
  }
  if (idx.itemAlt < 0) idx.itemAlt = header.indexOf(str(columns.itemAlt).replace(/\s+/g, '').toLowerCase());
  // some exports have the item code in Custom 1 instead of Device Identifier
  if (idx.item < 0) {
    const i = missing.indexOf(columns.item);
    if (idx.itemAlt >= 0) missing.splice(i, 1); else missing[i] = `${columns.item} (or ${columns.itemAlt})`;
  }
  const rows = table.slice(1)
    .filter(r => r.some(v => !isBlank(v)))
    .map(r => {
      const o = {};
      for (const k of Object.keys(columns)) o[k] = idx[k] >= 0 ? (r[idx[k]] ?? '') : '';
      o.serial = str(o.serial).trim();
      if (isBlank(o.item)) o.item = o.itemAlt;
      return o;
    });
  return { rows, missing };
}

// does an erasure state contain one of these words (config "Erasure")?
export const erasureHas = (state, words) => words.some(w => hasText(state, w));

// the Blancco result column says "Pass…" / "…Fail" (texts from the config "Erasure")
export const resultPassed = (result, erasure) => low(result).startsWith(low(erasure.passText));
export const resultFailed = (result, erasure) => low(result).includes(low(erasure.failText));

// Disk_Pivot: per serial, count successful / failed erasures -> "Pass", "Pass x2, Fail"
export function erasureSummary(blanccoRows, erasure = DEFAULT_CONFIG.erasure) {
  const counts = new Map();
  for (const r of blanccoRows) {
    if (r.serial === '') continue;
    const k = r.serial.toLowerCase();
    if (!counts.has(k)) counts.set(k, { pass: 0, fail: 0 });
    if (erasureHas(r.erasure, erasure.passWords)) counts.get(k).pass++;
    else if (erasureHas(r.erasure, erasure.failWords)) counts.get(k).fail++;
  }
  const label = (n, word) => (n < 1 ? '' : n === 1 ? word : `${word} x${n}`);
  return serial => {
    const c = counts.get(str(serial).trim().toLowerCase());
    return c ? joinNonEmpty(', ', label(c.pass, erasure.passText), label(c.fail, erasure.failText)) : '';
  };
}

// Mac / Windows reports write "NONE" when the device has no disk; the report shows "-" (config "Texts")
export const formatReportDisk = (disk, noDisk = DEFAULT_CONFIG.texts.noDisk) => (/^none$/i.test(str(disk).trim()) ? noDisk : disk);

// --- Output_Mac ---
export function macRecord(m, lk, blanccoResult) {
  const { texts, battery, erasure } = lk.cfg;
  const model = lk.model(m.modelId);
  const pct = isBlank(m.batteryStatus) ? NaN : toNumber(m.batteryStatus);
  const grade = batteryGrade(pct, battery);
  const service = eqi(m.batteryHealth, 'Service') ? texts.batteryService : '';
  const appleId = eqi(m.activationLock, 'Enabled') ? texts.appleIdLock : '';
  // "Remote Lock", "Remote Locked", ... (the Mac tool and hand edits don't always use the same word)
  const remote = /^\s*remote\s*lock/i.test(str(m.remote)) ? texts.remoteLocked : '';
  const blancco = blanccoResult(m.sn);
  return {
    source: 'mac', item: m.item, sn: m.sn, asset: m.asset, type: m.type, make: m.make,
    model: model ? str(model.name) : m.modelId,
    screen: model ? model.screen : '', year: model ? model.year : '',
    cpu: m.cpu, ram: formatRamMac(m.ram), disk: formatReportDisk(m.disk, texts.noDisk),
    diagnostics: joinNonEmpty(', ', appleId, remote, grade, service, m.diagnostics),
    blancco, locked: joinNonEmpty(', ', appleId, remote),
    diskSnIfFailed: blancco === erasure.failText ? m.diskSn : '',
    unknownModel: !model && !isBlank(m.modelId) ? m.modelId : '',
  };
}

// --- Output_Win ---
export function windowsRecord(w, lk, blanccoResult) {
  const model = lk.model(w.model);
  const pct = windowsBatteryPct(w.battery);
  const grade = isBlank(w.battery) ? '' : batteryGrade(pct, lk.cfg.battery);
  return {
    source: 'win', item: w.item, sn: w.sn, asset: w.asset,
    type: lk.mapType(w.type) ?? w.type, make: w.make,
    model: model ? str(model.name) : cleanModelName(w.model, lk.cleanupRules),
    screen: model ? model.screen : '', year: model ? model.year : '',
    cpu: shortCpu(w.cpu) || (w.cpu === '0' ? '' : w.cpu),
    ram: formatRamWindows(w.ram), disk: formatReportDisk(w.disk, lk.cfg.texts.noDisk),
    diagnostics: joinNonEmpty(', ', grade, w.diagnostics),
    blancco: blanccoResult(w.sn), locked: '',
  };
}

// --- CSV sheet: one record per Blancco serial that isn't a Mac ---
export function blanccoRecords(blanccoRows, macSerials, lk, blanccoResult) {
  const { cfg } = lk;
  const fromVersion = new Set(cfg.modelFromVersion.map(low).filter(Boolean));
  const macSet = new Set(macSerials.map(low));
  const grade = v => (isBlank(v) ? '' : batteryGrade(toNumber(v), cfg.battery));
  const seen = new Set(); const out = [];
  for (const r of blanccoRows) {
    const k = r.serial.toLowerCase();
    if (r.serial === '' || seen.has(k) || macSet.has(k)) continue;
    seen.add(k);
    const all = blanccoRows.filter(x => x.serial.toLowerCase() === k);
    const type = lk.mapType(r.chassis) ?? str(r.chassis);
    // a disk counts as wiped if any attempt succeeded ("Successful", or "Successful / Failed" after a retry)
    const disks = all.filter(x => erasureHas(x.erasure, cfg.erasure.passWords))
      .map(x => formatDiskCapacity(x.diskCapacity) + ' ' + diskKind(x.diskInterface, cfg.diskKinds));
    const batteryRaw = str(r.battery);
    const [b1 = '', b2 = ''] = batteryRaw === '' ? [] : batteryRaw.split(' / ');
    const comments = blanccoComments(r, cfg);
    // a model in the Dictionary's Models list (e.g. a Mac's MacBookPro15,1) gets its name, screen and year, like the reports;
    // any other is cleaned with the Model cleanup list like a Windows report's ("HP … Mobile Workstation PC")
    const rawModel = str(fromVersion.has(low(r.make)) ? r.version : r.model);
    const known = lk.model(rawModel);
    out.push({
      source: 'blancco', item: str(r.item), sn: r.serial, asset: str(r.asset), type, rawType: str(r.chassis),
      make: str(r.make),
      model: known ? str(known.name) : cleanModelName(rawModel, lk.cleanupRules),
      screen: known ? known.screen : '', year: known ? known.year : '',
      cpu: shortCpu(r.cpu), rawCpu: str(r.cpu),
      ram: formatRamBlancco(r.memory, r.memoryType),
      disk: disks.join(', '),
      diagnostics: eqi(type, 'Laptop') ? joinNonEmpty(', ', grade(b1), grade(b2), comments) : joinNonEmpty(', ', comments),
      blancco: blanccoResult(r.serial), locked: '',
      // the Models list is for Macs: an Apple model that isn't in it is listed in the Dictionary to be added
      unknownModel: !known && /apple/i.test(str(r.make)) && !isBlank(rawModel) ? rawModel : '',
    });
  }
  return out;
}
