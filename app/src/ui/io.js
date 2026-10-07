// File and clipboard input/output for the browser app.
import * as XLSX from 'xlsx';
import { REPORT_COLUMNS, LOCKED_COLUMNS } from '../engine/report.js';

const trimTable = rows => {
  const out = rows.map(r => r.map(v => (v == null ? '' : v)));
  while (out.length && out[out.length - 1].every(v => v === '')) out.pop();
  return out;
};

// Blancco export from a file (.csv / .xlsx / .xls); returns array of arrays incl. header row
export async function readTableFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { raw: /\.csv$|\.txt$/i.test(file.name), cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return trimTable(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }));
}

// Blancco data pasted from Excel / a CSV file (tab- or comma-separated, header row first)
export function parsePastedTable(text) {
  if (!text || !text.trim()) return [];
  const wb = XLSX.read(text, { type: 'string', raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return trimTable(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }));
}

// Import a project from an existing Audit.xlsm (Input + My_Audit sheets)
const MY_AUDIT_FIELDS = [null, 'sn', 'asset', 'type', 'make', 'model', 'screen', 'year', 'cpu', 'ram', 'disk',
  'locked', 'diagnostics', 'blancco', 'snDataCarrier', 'noDataCarrier', 'destruction', 'comments', 'itemStatus', 'estValue'];

export async function importWorkbook(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { cellFormula: false });
  const sheet = name => {
    const ws = wb.Sheets[name];
    if (!ws) throw new Error(`This workbook has no "${name}" sheet`);
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  };
  const input = sheet('Input');
  const col = j => input.slice(1).map(r => r[j] ?? '').join('\n');
  const manual = {};
  for (const r of sheet('My_Audit').slice(1)) {
    const rec = {};
    MY_AUDIT_FIELDS.forEach((f, j) => { if (f && r[j] !== '' && r[j] != null) rec[f] = String(r[j]); });
    if (Object.keys(rec).length && r[0]) manual[String(r[0])] = rec;
  }
  return {
    settings: {
      projectNumber: String(input[1]?.[0] ?? ''), prefix: String(input[3]?.[0] ?? ''),
      endClient: String(input[5]?.[0] ?? ''), startNumber: Number(input[7]?.[0] || 1),
    },
    inputs: { mac: col(1), windows: col(2), blancco: trimTable(input.map(r => r.slice(3, 33).map(v => (v == null ? '' : String(v))))) },
    manual, overrides: {},
  };
}

// --- output ---
const reportTable = rows => [REPORT_COLUMNS.map(c => c[1]), ...rows.map(r => REPORT_COLUMNS.map(([k]) => r[k] ?? ''))];
const lockedTable = rows => [LOCKED_COLUMNS.map(c => c[1]), ...rows.map(r => LOCKED_COLUMNS.map(([k]) => r[k] ?? ''))];

export function downloadXlsx(report, settings) {
  const wb = XLSX.utils.book_new();
  const add = (name, aoa) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = aoa[0].map((h, j) => ({ wch: Math.min(60, Math.max(8, ...aoa.map(r => String(r[j] ?? '').length))) }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add('Audit Report', reportTable(report.rows));
  if (report.lockedFaulty.length) add('Locked and Faulty', lockedTable(report.lockedFaulty));
  XLSX.writeFile(wb, `${settings.projectNumber || 'Audit'} - Audit Report.xlsx`);
}

const toTsv = (aoa, withHeader) => (withHeader ? aoa : aoa.slice(1))
  .map(r => r.map(v => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');

export const reportTsv = (report, withHeader) => toTsv(reportTable(report.rows), withHeader);
export const lockedTsv = (report, withHeader) => toTsv(lockedTable(report.lockedFaulty), withHeader);

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const readJsonFile = async file => JSON.parse(await file.text());
