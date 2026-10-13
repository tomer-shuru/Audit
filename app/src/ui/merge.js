// Rows that are already in the project's Google Sheet, pasted on the Data tab.
// They are one more input for the report, the last in line: every other input (Mac / Windows reports,
// Blancco, manual entries) wins where it has a value, and the sheet fills in the rest.
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
// cols: the export columns that are ticked; prefix: the project's item code prefix;
// itemPrefix: the start of the ITEM column ("ITD", from the config)
// Returns records: { [item code]: { column key: value } } (the first row of a code counts), codes (sorted),
// and what was left out: duplicates, headerRows (above the first item), otherRows (no item code), lineBreaks.
export function readSheetRows({ sheetText, cols, prefix, itemPrefix = 'ITD' }) {
  const table = parseTsv(sheetText);
  const itemCol = cols.findIndex(([k]) => k === 'item');
  // "ITD-SHR11734-BM20" or just "BM20". Without a prefix a bare number is only taken from the ITEM column,
  // so serials, years and weights in other columns aren't mistaken for item codes.
  const code = `(${escRe(String(prefix ?? '').trim().toUpperCase())}\\d+)$`;
  const loose = new RegExp(`(?:^|-)${code}`), strict = prefix ? loose : new RegExp(`^${escRe(String(itemPrefix).trim().toUpperCase())}-.+-${code}`);
  const codeOf = cells => {
    const order = itemCol >= 0 && itemCol < cells.length ? [itemCol, ...cells.keys()] : [...cells.keys()];
    for (const j of order) {
      const m = String(cells[j] ?? '').trim().toUpperCase().match(j === itemCol ? loose : strict);
      if (m) return itemKey(m[1]);
    }
    return null;
  };

  const records = {}, duplicates = new Set();
  let headerRows = 0, otherRows = 0, lineBreaks = false, found = 0;
  for (const cells of table) {
    if (cells.every(v => !v.trim())) continue;
    const c = codeOf(cells);
    if (!c) { if (found) otherRows++; else headerRows++; continue; } // headers above the first item, then rows without a code
    found++;
    if (cells.some(v => /[\t\n]/.test(v))) lineBreaks = true;
    if (records[c]) { duplicates.add(c); continue; }
    records[c] = Object.fromEntries(cols.map(([k], j) => [k, String(cells[j] ?? '').trim()]));
  }
  const codes = Object.keys(records).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { records, codes, duplicates: [...duplicates], headerRows, otherRows, lineBreaks };
}
