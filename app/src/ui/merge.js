// Merge the Audit Report with rows that are already in the project's Google Sheet.
// Rows the sheet already has are kept exactly as they are; the app's rows fill in around them,
// everything sorted by item code, so the result can be pasted back over the same range in one go.
import { itemKey } from '../engine/sources.js';

// Tab-separated text as Google Sheets / Excel copy it (cells with tabs, line breaks or quotes come in "quotes")
export function parseTsv(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (s[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byCode = (a, b) => a.code.localeCompare(b.code, undefined, { numeric: true });

// sheetText: rows copied from the Google Sheet (same columns as the copy from the app)
// cols / rows: the export selection; prefix: the project's item code prefix
export function mergeWithSheet({ sheetText, cols, rows, prefix }) {
  const table = parseTsv(sheetText);
  const itemCol = cols.findIndex(([k]) => k === 'item');
  // "ITD-SHR11734-BM20" or just "BM20". Without a prefix a bare number is only taken from the ITEM column,
  // so serials, years and weights in other columns aren't mistaken for item codes.
  const code = `(${escRe(String(prefix ?? '').trim().toUpperCase())}\\d+)$`;
  const loose = new RegExp(`(?:^|-)${code}`), strict = prefix ? loose : new RegExp(`^ITD-.+-${code}`);
  const codeOf = cells => {
    const order = itemCol >= 0 && itemCol < cells.length ? [itemCol, ...cells.keys()] : [...cells.keys()];
    for (const j of order) {
      const m = String(cells[j] ?? '').trim().toUpperCase().match(j === itemCol ? loose : strict);
      if (m) return itemKey(m[1]);
    }
    return null;
  };

  const top = [], sheetRows = [], other = [];
  for (const cells of table) {
    if (cells.every(v => !v.trim())) continue;
    const code = codeOf(cells);
    if (code) sheetRows.push({ code, cells, from: 'sheet' });
    else (sheetRows.length ? other : top).push(cells); // header rows stay on top, anything else goes last
  }

  const inSheet = new Set(sheetRows.map(r => r.code));
  const kept = [], added = [];
  for (const r of rows) {
    const code = itemKey(r.itemLookup);
    if (inSheet.has(code)) kept.push(code);
    else added.push({ code, cells: cols.map(([k]) => String(r[k] ?? '')), from: 'app' });
  }
  const merged = [...sheetRows, ...added].sort(byCode);

  const counts = new Map();
  for (const r of sheetRows) counts.set(r.code, (counts.get(r.code) || 0) + 1);
  const sheetWidth = Math.max(0, ...sheetRows.map(r => r.cells.length));
  const width = Math.max(cols.length, sheetWidth, ...top.map(c => c.length), ...other.map(c => c.length));
  const pad = cells => [...cells, ...Array(width - cells.length).fill('')];

  return {
    table: [...top, ...merged.map(r => r.cells), ...other].map(pad),
    order: runs(merged),
    sheetCodes: sheetRows.map(r => r.code).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    kept, added: added.map(r => r.code),
    duplicates: [...counts].filter(([, n]) => n > 1).map(([c]) => c),
    topRows: top.length, otherRows: other.length,
    sheetWidth, appWidth: cols.length,
    lineBreaks: sheetRows.some(r => r.cells.some(v => /[\t\n]/.test(v))),
  };
}

// consecutive rows from the same place: [{ from: 'sheet' | 'app', first, last, count }]
function runs(merged) {
  const out = [];
  for (const r of merged) {
    const last = out[out.length - 1];
    if (last && last.from === r.from) { last.last = r.code; last.count++; } else out.push({ from: r.from, first: r.code, last: r.code, count: 1 });
  }
  return out;
}
