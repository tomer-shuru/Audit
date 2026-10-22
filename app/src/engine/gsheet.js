// The project's Google Sheet, read and written through the Apps Script (google-sheets/AuditBuilderSheets.gs):
// where the items are in it, what Send to Google Sheet would change, and the rows for Load from Google Sheet.
// The sheet comes in as all its cells as shown (values[row][col], counted from 0).
//
// Our columns go into the sheet the way a paste at the first item row puts them: the columns shown on the
// Final Report, side by side, starting at the sheet's item column. Each row goes to the sheet row with the same
// item code, so it doesn't matter which items the sheet or the project have or miss.
import { str, isBlank } from './rules.js';
import { itemKey } from './sources.js';
import { compareCodes } from './report.js';

// the sheet and the tab of a Google Sheets link (…/spreadsheets/d/<id>/edit#gid=<tab>), or null if it isn't one
export function sheetLink(url) {
  const id = str(url).match(/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})/)?.[1];
  if (!id) return null;
  return { id, gid: str(url).match(/[#&?]gid=(\d+)/)?.[1] ?? '' };
}

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The item code in a cell: "ITD-SHR11734-BM20" or just "BM20" (extra item groups too: MS-M20, MSM20 with prefix MS).
// Without a prefix a bare number only counts in the item column (inItemCol), so serials, years and weights in
// other columns aren't taken for item codes. Returns a function (cell text, inItemCol) -> item key or null.
export function itemCodeReader(prefix, itemPrefix = 'ITD') {
  const p = escRe(str(prefix).trim().toUpperCase());
  const any = p ? `${p}[A-Z-]*\\d+` : '\\d+';
  const item = new RegExp(`(?:^|-)(${any})$`);
  const whole = new RegExp(`^${escRe(str(itemPrefix).trim().toUpperCase())}-.+-(${any})$`);
  const plain = p && new RegExp(`(?:^|-)(${p}\\d+)$`);
  return (cell, inItemCol) => {
    const v = str(cell).trim().toUpperCase();
    const m = inItemCol ? v.match(item) : v.match(whole) || (plain && v.match(plain));
    return m ? itemKey(m[1]) : null;
  };
}

// GG07 and GG7 are the same item
export const sameItem = key => key.replace(/\d+$/, n => n.replace(/^0+(?=\d)/, ''));
const norm = v => str(v).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

// Where the items are: { itemCol, headerRow, items: Map(item -> row), duplicates: [item] } (rows and columns from 0),
// or null if the sheet has neither item codes nor a header like ours (itemLabel: our item column's header).
// The item column is the one with the most item codes; a sheet with no items yet is found by its header.
export function findItems(values, { prefix, itemPrefix, itemLabel }) {
  const read = itemCodeReader(prefix, itemPrefix);
  // without a prefix, only the whole ITEM ("ITD-SHR1-07") shows a column is the item column
  const counts = [];
  values.forEach(row => row.forEach((v, c) => { if (prefix ? read(v, true) : read(v, false)) counts[c] = (counts[c] || 0) + 1; }));
  let itemCol = counts.reduce((best, n, c) => (n > (counts[best] || 0) ? c : best), -1);
  let headerRow = -1;
  if (itemCol < 0) {
    const label = norm(itemLabel);
    for (let r = 0; r < values.length && itemCol < 0; r++) {
      const c = values[r].findIndex(v => label && norm(v) === label);
      if (c >= 0) { itemCol = c; headerRow = r; }
    }
    if (itemCol < 0) return null;
  }
  const items = new Map(), duplicates = new Set();
  values.forEach((row, r) => {
    const key = r > headerRow ? read(row[itemCol], true) : null;
    if (!key) return;
    const k = sameItem(key);
    if (items.has(k)) duplicates.add(key); else items.set(k, r);
  });
  // the header: the last row above the first item with something in the item column
  if (headerRow < 0 && items.size) {
    const first = Math.min(...items.values());
    for (let r = first - 1; r >= 0 && headerRow < 0; r--) if (!isBlank(values[r][itemCol])) headerRow = r;
  }
  return { itemCol, headerRow, items, duplicates: [...duplicates] };
}

// a value of ours and the sheet's are the same: the same text, or the same number (1.6 and 1.60)
function same(ours, theirs) {
  if (ours === theirs) return true;
  const a = Number(ours), b = Number(theirs.replace(/,/g, ''));
  return ours !== '' && theirs !== '' && Number.isFinite(a) && Number.isFinite(b) && a === b;
}

/**
 * What Send to Google Sheet would do.
 * values: the sheet's cells; cols: our columns shown ([key, header, name?]); rows: our rows (report rows; empty ones are left out)
 * settings: the project's (prefix, for the order of new rows); itemPrefix: config texts.itemPrefix
 * Returns { error } or {
 *   fills:      cells of items in the sheet that are empty there and have a value here ({ item, row, c, value }),
 *   collisions: cells with a different value in the sheet ({ item, col, label, theirs, ours, row, c }),
 *   same:       how many cells already match,
 *   newItems:   items not in the sheet, each { item, row (inserted next to), where, values },
 *   headers:    our headers that don't match the sheet's ({ label, theirs }),
 *   duplicates, itemCol, firstCol, headerRow,
 *   request(overwrite): the write request for the Apps Script (expect, updates, inserts, formatFrom: the row new rows
 *               look like, 0 = none), rows and columns from 1
 * }
 * Empty cells of ours never change the sheet; neither do cells outside our columns.
 */
export function planSend({ values, cols, rows, settings, itemPrefix }) {
  const ourItem = cols.findIndex(([k]) => k === 'item');
  if (ourItem < 0) return { error: 'The item column is hidden on the Final Report. Show it to send.' };
  const found = findItems(values, { prefix: settings.prefix, itemPrefix, itemLabel: cols[ourItem][1] });
  if (!found) return { error: 'Couldn\'t find the items in the sheet: no item codes and no item column header like ours. Paste the first row by hand once, then Send works.' };
  const { itemCol, headerRow, items, duplicates } = found;
  const firstCol = itemCol - ourItem; // where our first column goes
  if (firstCol < 0) return { error: `The sheet's item column has fewer columns before it than the Final Report shows (${ourItem}). Hide the columns before the item column, or check the sheet.` };

  const cell = (r, c) => str(values[r]?.[c]).trim();
  const label = ([, header, name]) => name ?? header;
  const headers = headerRow < 0 ? [] : cols.map((col, j) => ({ label: label(col), header: col[1], theirs: cell(headerRow, firstCol + j) }))
    .filter(h => h.header && h.theirs && norm(h.header) !== norm(h.theirs)).map(({ label: l, theirs }) => ({ label: l, theirs }));

  const fills = [], collisions = [], newItems = [];
  let sameCount = 0;
  const ours = rows.filter(row => !row._empty && itemKey(row.itemLookup));
  for (const row of ours) {
    const vals = cols.map(([k]) => str(row[k]).trim());
    const r = items.get(sameItem(itemKey(row.itemLookup)));
    if (r === undefined) { newItems.push({ item: row.itemLookup, key: itemKey(row.itemLookup), values: vals }); continue; }
    vals.forEach((v, j) => {
      if (v === '') return;
      const c = firstCol + j, theirs = cell(r, c);
      if (same(v, theirs)) sameCount++;
      else if (theirs === '') fills.push({ item: row.itemLookup, row: r, c, value: v });
      else collisions.push({ item: row.itemLookup, label: label(cols[j]), theirs, ours: v, row: r, c, value: v });
    });
  }

  // new items go in item order: after the sheet's item just before them, or above its first item;
  // a sheet with no items yet gets them under the header
  const order = compareCodes(settings);
  const inSheet = [...items].map(([key, r]) => ({ key, r }));
  for (const n of newItems) {
    const before = inSheet.filter(x => order(x.key, n.key) < 0);
    if (before.length) Object.assign(n, { row: Math.max(...before.map(x => x.r)), where: 'after' });
    else if (inSheet.length) Object.assign(n, { row: Math.min(...inSheet.map(x => x.r)), where: 'before' });
    else Object.assign(n, { row: headerRow, where: 'after' });
  }
  newItems.sort((a, b) => order(a.key, b.key));

  const request = overwrite => {
    const cells = [...fills, ...(overwrite ? collisions : [])];
    // one update per run of cells side by side in a row
    const updates = [];
    const byRow = new Map();
    for (const x of cells) {
      if (!byRow.has(x.row)) byRow.set(x.row, []);
      byRow.get(x.row).push(x);
    }
    for (const [r, list] of byRow) {
      list.sort((a, b) => a.c - b.c);
      for (const x of list) {
        const last = updates[updates.length - 1];
        if (last && last.row === r + 1 && last.col + last.values.length === x.c + 1) last.values.push(x.value);
        else updates.push({ row: r + 1, col: x.c + 1, values: [x.value] });
      }
    }
    const inserts = [];
    for (const n of newItems) {
      const at = inserts.find(i => i.row === n.row + 1 && i.where === n.where);
      if (at) at.rows.push(n.values);
      else inserts.push({ row: n.row + 1, where: n.where, col: firstCol + 1, rows: [n.values] });
    }
    // Every cell written, and the item cell of every row written to or next to, must still be what was read,
    // so a sheet read a while ago (read ahead, see ui/gsheet.js) never overwrites something typed since
    const was = (r, c) => ({ row: r + 1, col: c + 1, value: str(values[r]?.[c]) });
    const touched = new Set([...cells.map(x => x.row), ...newItems.map(n => n.row)]);
    const expect = [...[...touched].map(r => was(r, itemCol)), ...cells.map(x => was(x.row, x.c))];
    return { expect, updates, inserts, formatFrom: formatRow(values, headerRow, items) + 1 };
  };

  return { fills, collisions, same: sameCount, newItems, headers, duplicates, itemCol, firstCol, headerRow, request };
}

// The row new rows take their look from (colors, font, height, drop-downs): the sheet's first item, else its first
// filled row under the header (rows of other item codes count too), else none (-1: plain new rows).
// Without it Google would copy the row next to them, which is the header when they go right under it.
function formatRow(values, headerRow, items) {
  if (items.size) return Math.min(...items.values());
  for (let r = headerRow + 1; r < values.length; r++) if (values[r].some(v => !isBlank(v))) return r;
  return -1;
}

// Load from Google Sheet: the sheet's item rows as tab-separated text, in our columns (as if they had been copied
// from the sheet and pasted on the Data tab), or { error }
export function sheetRowsText({ values, cols, settings, itemPrefix }) {
  const ourItem = cols.findIndex(([k]) => k === 'item');
  if (ourItem < 0) return { error: 'The item column is hidden on the Final Report. Show it to load the sheet.' };
  const found = findItems(values, { prefix: settings.prefix, itemPrefix, itemLabel: cols[ourItem][1] });
  if (!found?.items.size) return { error: 'No items found in the sheet.' };
  const firstCol = found.itemCol - ourItem;
  if (firstCol < 0) return { error: 'The sheet\'s columns don\'t line up with the Final Report\'s.' };
  const rows = [...found.items.values()].sort((a, b) => a - b)
    .map(r => cols.map((_, j) => str(values[r][firstCol + j]).replace(/[\t\r\n]+/g, ' ')).join('\t'));
  return { text: rows.join('\n'), count: rows.length };
}
