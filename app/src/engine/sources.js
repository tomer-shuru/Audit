// Turns raw inputs (Mac lines, Windows lines, Blancco rows) into per-device records.
// Replaces sheets: MacReports, Output_Mac, WindowsReports, Output_Win, CSV, CPU_Formula, Disk_Pivot.
import {
  str, isBlank, eqi, joinNonEmpty, toNumber, batteryGrade, windowsBatteryPct,
  formatRamMac, formatRamWindows, formatRamBlancco, formatDiskCapacity, diskKind,
  shortCpu, cleanModelName,
} from './rules.js';

export const itemKey = code => str(code).trim().toUpperCase();

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

// --- lookups into the Models data ---
export function makeLookups(models) {
  const byId = new Map();
  for (const m of models.models) { const k = str(m.id).trim().toLowerCase(); if (!byId.has(k)) byId.set(k, m); }
  const typeMap = new Map();
  for (const t of models.typeMap) { const k = str(t.blanccoType).trim().toLowerCase(); if (!typeMap.has(k)) typeMap.set(k, t.type); }
  const weights = new Map();
  for (const t of models.typeWeights) { const k = str(t.type).trim().toLowerCase(); if (!weights.has(k)) weights.set(k, t.weight); }
  return {
    model: id => byId.get(str(id).trim().toLowerCase()),
    mapType: raw => typeMap.get(str(raw).trim().toLowerCase()),
    weight: type => weights.get(str(type).trim().toLowerCase()),
    cleanupRules: models.cleanupRules,
    diagCodes: models.diagCodes,
  };
}

// --- Blancco export ---
// Column names are matched by header text, so the export's column order doesn't matter.
export const BLANCCO_COLUMNS = {
  make: 'System manufacturer', chassis: 'System chassis type', item: 'Device Identifier', asset: 'Asset Tag',
  erasure: 'Erasure state', serial: 'System serial', version: 'System version', model: 'System model',
  battery: 'Capacity', cpu: 'CPU model', memory: 'Total Memory', memoryType: 'Memory type',
  diskCapacity: 'Disk capacity', diskInterface: 'Disk interface type', diskSerial: 'Disk serial',
  comment1: 'Comment', comment2: 'Comment2', comment3: 'Comment3', comment4: 'Comment4', comment5: 'Comment5', comment6: 'Comment6',
};

// rows: array of arrays, first row = headers
export function normalizeBlancco(table) {
  if (!table || table.length === 0) return { rows: [], missing: [] };
  const header = table[0].map(h => str(h).trim().toLowerCase());
  const idx = {}; const missing = [];
  for (const [key, name] of Object.entries(BLANCCO_COLUMNS)) {
    idx[key] = header.indexOf(name.toLowerCase());
    if (idx[key] < 0 && !key.startsWith('comment')) missing.push(name);
  }
  const rows = table.slice(1)
    .filter(r => r.some(v => !isBlank(v)))
    .map(r => {
      const o = {};
      for (const k of Object.keys(BLANCCO_COLUMNS)) o[k] = idx[k] >= 0 ? (r[idx[k]] ?? '') : '';
      o.serial = str(o.serial).trim();
      return o;
    });
  return { rows, missing };
}

// Disk_Pivot: per serial, count successful / failed erasures -> "Pass", "Pass x2, Fail"
export function erasureSummary(blanccoRows) {
  const counts = new Map();
  for (const r of blanccoRows) {
    if (r.serial === '') continue;
    const k = r.serial.toLowerCase();
    if (!counts.has(k)) counts.set(k, { pass: 0, fail: 0 });
    const state = str(r.erasure).toLowerCase();
    if (state.includes('successful')) counts.get(k).pass++;
    else if (state.includes('failed')) counts.get(k).fail++;
  }
  const label = (n, word) => (n < 1 ? '' : n === 1 ? word : `${word} x${n}`);
  return serial => {
    const c = counts.get(str(serial).trim().toLowerCase());
    return c ? joinNonEmpty(', ', label(c.pass, 'Pass'), label(c.fail, 'Fail')) : '';
  };
}

// --- Output_Mac ---
export function macRecord(m, lk, blanccoResult) {
  const model = lk.model(m.modelId);
  const pct = isBlank(m.batteryStatus) ? NaN : toNumber(m.batteryStatus);
  const grade = batteryGrade(pct);
  const service = eqi(m.batteryHealth, 'Service') ? 'Battery Service' : '';
  const appleId = eqi(m.activationLock, 'Enabled') ? 'Apple ID Lock' : '';
  const remote = eqi(m.remote, 'Remote Lock') ? 'Remote Locked' : '';
  const blancco = blanccoResult(m.sn);
  return {
    source: 'mac', item: m.item, sn: m.sn, asset: m.asset, type: m.type, make: m.make,
    model: model ? str(model.name) : m.modelId,
    screen: model ? model.screen : '', year: model ? model.year : '',
    cpu: m.cpu, ram: formatRamMac(m.ram), disk: m.disk,
    diagnostics: joinNonEmpty(', ', appleId, remote, grade, service, m.diagnostics),
    blancco, locked: joinNonEmpty(', ', appleId, remote),
    diskSnIfFailed: blancco === 'Fail' ? m.diskSn : '',
    unknownModel: !model && !isBlank(m.modelId) ? m.modelId : '',
  };
}

// --- Output_Win ---
export function windowsRecord(w, lk, blanccoResult) {
  const model = lk.model(w.model);
  const pct = windowsBatteryPct(w.battery);
  const grade = isBlank(w.battery) ? '' : batteryGrade(pct);
  return {
    source: 'win', item: w.item, sn: w.sn, asset: w.asset,
    type: lk.mapType(w.type) ?? w.type, make: w.make,
    model: model ? str(model.name) : cleanModelName(w.model, lk.cleanupRules),
    screen: model ? model.screen : '', year: model ? model.year : '',
    cpu: shortCpu(w.cpu) || (w.cpu === '0' ? '' : w.cpu),
    ram: formatRamWindows(w.ram), disk: w.disk,
    diagnostics: joinNonEmpty(', ', grade, w.diagnostics),
    blancco: blanccoResult(w.sn), locked: '',
  };
}

// --- CSV sheet: one record per Blancco serial that isn't a Mac ---
export function blanccoRecords(blanccoRows, macSerials, lk, blanccoResult) {
  const macSet = new Set(macSerials.map(s => str(s).trim().toLowerCase()));
  const seen = new Set(); const out = [];
  for (const r of blanccoRows) {
    const k = r.serial.toLowerCase();
    if (r.serial === '' || seen.has(k) || macSet.has(k)) continue;
    seen.add(k);
    const all = blanccoRows.filter(x => x.serial.toLowerCase() === k);
    const type = lk.mapType(r.chassis) ?? str(r.chassis);
    const disks = all.filter(x => eqi(x.erasure, 'Successful'))
      .map(x => formatDiskCapacity(x.diskCapacity) + ' ' + diskKind(x.diskInterface));
    const batteryRaw = str(r.battery);
    const [b1 = '', b2 = ''] = batteryRaw === '' ? [] : batteryRaw.split(' / ');
    const grade = v => (isBlank(v) ? '' : batteryGrade(toNumber(v)));
    const comments = [r.comment1, r.comment2, r.comment3, r.comment4, r.comment5, r.comment6]
      .map(c => (c === 0 || str(c) === '0' ? '' : str(c)));
    out.push({
      source: 'blancco', item: str(r.item), sn: r.serial, asset: str(r.asset), type, rawType: str(r.chassis),
      make: str(r.make),
      model: str(eqi(r.make, 'LENOVO') ? r.version : r.model),
      screen: '', year: '',
      cpu: shortCpu(r.cpu), rawCpu: str(r.cpu),
      ram: formatRamBlancco(r.memory, r.memoryType),
      disk: disks.join(', '),
      diagnostics: eqi(type, 'Laptop') ? joinNonEmpty(', ', grade(b1), grade(b2), comments) : joinNonEmpty(', ', comments),
      blancco: blanccoResult(r.serial), locked: '',
    });
  }
  return out;
}
