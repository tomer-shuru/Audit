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

// sheetText: rows copied from the Google Sheet (same columns as the export, starting at the first item row)
// cols: the export columns that are ticked; rows: the report rows; prefix: the project's item code prefix
// Returns the report rows with the sheet's rows merged in. A sheet row is a row object like the others
// (its cells spread over cols), with _sheet set and itemLookup "sheet:<n>".
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
  const sheetRow = (cells, code, n) => ({
    ...Object.fromEntries(cols.map(([k], j) => [k, cells[j] ?? ''])),
    itemLookup: `sheet:${n}`, _sheet: { code, cells },
  });

  let headerRows = 0;
  const found = [], other = [];
  table.forEach((cells, n) => {
    if (cells.every(v => !v.trim())) return;
    const code = codeOf(cells);
    if (code) found.push(sheetRow(cells, code, n));
    else if (!found.length) headerRows++;   // headers above the first item are left out
    else other.push(sheetRow(cells, '', n)); // rows without a code go last
  });

  const inSheet = new Set(found.map(r => r._sheet.code));
  const skipped = rows.filter(r => inSheet.has(itemKey(r.itemLookup))).map(r => r.itemLookup);
  const key = r => (r._sheet ? r._sheet.code : itemKey(r.itemLookup));
  const merged = [...found, ...rows.filter(r => !inSheet.has(itemKey(r.itemLookup)))]
    .sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));

  const counts = new Map();
  for (const r of found) counts.set(r._sheet.code, (counts.get(r._sheet.code) || 0) + 1);
  const sheetCodes = found.map(r => r._sheet.code).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return {
    rows: [...merged, ...other],
    sheetCodes, skipped,
    duplicates: [...counts].filter(([, n]) => n > 1).map(([c]) => c),
    headerRows, otherRows: other.length,
    lineBreaks: [...found, ...other].some(r => r._sheet.cells.some(v => /[\t\n]/.test(v))),
  };
}
