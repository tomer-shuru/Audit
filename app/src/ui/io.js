// File and clipboard input/output for the browser app.
import * as XLSX from 'xlsx';

const trimTable = rows => {
  const out = rows.map(r => r.map(v => (v == null ? '' : v)));
  while (out.length && out[out.length - 1].every(v => v === '')) out.pop();
  return out;
};

const TABLE_EXT = /\.(csv|txt|xlsx|xls)$/i;

function tableFromBytes(bytes, name) {
  const wb = XLSX.read(bytes, { type: 'array', raw: /\.(csv|txt)$/i.test(name), cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return trimTable(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }));
}

// Blancco exports from files (.csv / .xlsx / .xls, or .zip files containing them).
// Returns [{ name, table }] where table is an array of arrays incl. the header row.
export async function readTableFiles(files) {
  const out = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name)) {
      const zip = XLSX.CFB.read(bytes, { type: 'array' });
      zip.FileIndex.forEach((entry, i) => {
        const inner = zip.FullPaths[i].replace(/^Root Entry\//, '').replace(/\\/g, '/');
        const base = inner.split('/').pop();
        if (entry.type !== 2 || !entry.size || !TABLE_EXT.test(base) || base.startsWith('.') || inner.startsWith('__MACOSX/')) return;
        out.push({ name: `${file.name} › ${inner}`, table: tableFromBytes(new Uint8Array(entry.content), base) });
      });
    } else if (TABLE_EXT.test(file.name)) {
      out.push({ name: file.name, table: tableFromBytes(bytes, file.name) });
    } else {
      throw new Error(`${file.name} isn't a .csv, .xlsx or .zip file`);
    }
  }
  return out;
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
  const blancco = trimTable(input.map(r => r.slice(3, 33).map(v => (v == null ? '' : String(v)))));
  return {
    settings: { projectNumber: String(input[1]?.[0] ?? ''), prefix: String(input[3]?.[0] ?? ''), endClient: String(input[5]?.[0] ?? '') },
    inputs: { mac: col(1), windows: col(2), blanccoFiles: blancco.length > 1 ? [{ name: `${file.name} (Input sheet)`, table: blancco }] : [] },
    manual, overrides: {},
  };
}

// --- output ---
// cols: [[key, label]], rows: report row objects -> array of arrays with a header row
export const toTable = (cols, rows) => [cols.map(c => c[1]), ...rows.map(r => cols.map(([k]) => r[k] ?? ''))];

// sheets: [{ name, cols, rows }]; sheets without rows or columns are left out
export function downloadXlsx(sheets, settings) {
  const wb = XLSX.utils.book_new();
  for (const { name, cols, rows } of sheets) {
    if (!rows.length || !cols.length) continue;
    const aoa = toTable(cols, rows);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = aoa[0].map((h, j) => ({ wch: Math.min(60, Math.max(8, ...aoa.map(r => String(r[j] ?? '').length))) }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  if (!wb.SheetNames.length) return false;
  XLSX.writeFile(wb, `${settings.projectNumber || 'Audit'} - Audit Report.xlsx`);
  return true;
}

// tab-separated text that pastes into Google Sheets / Excel as cells
export const toTsv = (cols, rows, withHeader) => {
  const aoa = toTable(cols, rows);
  return tableToTsv(withHeader ? aoa : aoa.slice(1));
};
export const tableToTsv = aoa => aoa.map(r => r.map(v => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');

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
