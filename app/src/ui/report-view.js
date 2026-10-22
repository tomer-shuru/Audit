// What the Final Report tab shows: its sheets (the main list of the chosen output: Shuru, SIMS or Google; Locked and Faulty, and for
// SIMS the HDD list), each with its columns, the rows that pass the filters, and the columns hidden from view.
// What is shown is also what Copy and Download take ("what you see is what you copy").
// Hidden columns are remembered on this computer (they are also how the Google Sheet rows on the Data tab are read);
// filters last while the app is open.
import { exportColumns, lockedColumns, GOOGLE_COLUMNS } from '../engine/report.js';
import { isLockedOrFaulty } from '../engine/rules.js';
import { SIMS_COLUMNS, HDD_COLUMNS, LOCK_REQUEST_COLUMNS, hddRows } from '../engine/sims.js';
import { state, outputOf, load, store, STORE_EXPORT_COLS } from './state.js';
import { reportRows } from './app.js';

// [key, header in the sheet, name shown when the header is empty]
const LOOKUP = ['itemLookup', 'Item Lookup']; // first column of every sheet here; only used inside the app (never copied)
export const SHEETS = {
  report: { title: 'Audit Report', cols: () => exportColumns(state.config), rows: () => reportRows() },
  sims: { title: 'Item per service project', cols: () => SIMS_COLUMNS, rows: () => reportRows() },
  google: { title: 'ITAD Report', cols: () => GOOGLE_COLUMNS, rows: () => reportRows() },
  hdd: { title: 'HDD', cols: () => HDD_COLUMNS, rows: () => hddRows(state.report.rows) },
  lockRequest: { title: 'Locked devices request', cols: () => LOCK_REQUEST_COLUMNS, rows: () => state.sims?.lockRequest ?? [] },
  locked: { title: 'Locked and Faulty', cols: () => lockedColumns(state.config), rows: () => state.report.lockedFaulty },
};
const MAIN = { shuru: 'report', sims: 'sims', google: 'google' };
// the main sheet of the chosen output (or of another project's output)
export const mainKind = (output = outputOf()) => MAIN[output] ?? 'report';
export const sheetKinds = () => (mainKind() === 'sims' ? ['sims', 'hdd', 'lockRequest'] : [mainKind(), 'locked']);
export const isMain = kind => Object.values(MAIN).includes(kind);
export const rowKey = row => row._key ?? row.itemLookup; // HDD rows: one per serial, so several per item

// search: one text over all columns; issuesOnly: main sheet only; filters: { [kind]: { [column]: Set of values left out } };
// keep: rows edited while filtered stay in view until the filters change (like Excel)
export const view = { sheet: 'report', search: '', issuesOnly: false, filters: {}, keep: new Set(), hidden: load(STORE_EXPORT_COLS, {}) };
export const currentSheet = () => (sheetKinds().includes(view.sheet) ? view.sheet : sheetKinds()[0]);

// ---------- columns ----------
export const hiddenCols = kind => new Set(view.hidden[kind] || []);
export function setHidden(kind, list) {
  view.hidden[kind] = list;
  store(STORE_EXPORT_COLS, view.hidden);
}
// the sheet's columns that are shown: what is copied (Item Lookup is never copied)
export const exportCols = kind => { const h = hiddenCols(kind); return SHEETS[kind].cols().filter(([k]) => !h.has(k)); };
// the table's columns: Item Lookup, then the shown ones
export const viewColumns = kind => [LOOKUP, ...exportCols(kind)];
export const colName = ([, label, name]) => name ?? label;

// ---------- rows ----------
// items with a red or yellow check: { [item]: { level, texts } } (notes don't count).
// A check about several items (items: Diagnostics is empty) counts for each of them.
export function rowIssues() {
  const issues = new Map();
  for (const w of state.report.warnings) {
    if (!w.item || w.level === 'info' || w.level === 'sims') continue;
    for (const item of w.items ?? [w.item]) {
      const cur = issues.get(item) || { level: 'warn', texts: [] };
      if (w.level === 'error') cur.level = 'error';
      cur.texts.push(w.text);
      issues.set(item, cur);
    }
  }
  return issues;
}

export const NO_DATA = '(No data yet)';
// the value a column filter sees: item numbers with no data yet are one value in the Item Lookup column
export const filterValue = (row, k) => (row._empty && k === 'itemLookup' ? NO_DATA : String(row[k] ?? '').trim());

export const isFiltered = kind => !!view.search.trim() || (isMain(kind) && view.issuesOnly) || Object.values(view.filters[kind] || {}).some(s => s.size);

// the rows that pass the search and filters; except: a column whose own filter is left out (for its value list)
export function shownRows(kind, { except = null } = {}) {
  const cols = viewColumns(kind);
  const filters = Object.entries(view.filters[kind] || {}).filter(([k, out]) => k !== except && out.size);
  const q = view.search.trim().toLowerCase();
  const issues = isMain(kind) && view.issuesOnly ? rowIssues() : null;
  return SHEETS[kind].rows().filter(row => (isMain(kind) && !except && view.keep.has(row.itemLookup)) || (
    (!issues || issues.has(row.itemLookup) || isLockedOrFaulty(row.locked) || row._empty)
    && (!q || cols.some(([k]) => String(row[k] ?? '').toLowerCase().includes(q)))
    && filters.every(([k, out]) => !out.has(filterValue(row, k)))));
}

// a column's values for its filter list, with how many rows have each: [[value, count]], blanks last
export function columnValues(kind, k) {
  const counts = new Map();
  for (const row of shownRows(kind, { except: k })) { const v = filterValue(row, k); counts.set(v, (counts.get(v) || 0) + 1); }
  for (const v of view.filters[kind]?.[k] || []) if (!counts.has(v)) counts.set(v, 0); // left out: still listed, to tick again
  const last = v => v === '' || v === NO_DATA;
  return [...counts].sort(([a], [b]) => (last(a) - last(b)) || a.localeCompare(b, undefined, { numeric: true }));
}

// a filter or search changed: rows kept after an edit follow the filters again
export function setFilter(kind, k, out) {
  (view.filters[kind] ||= {})[k] = out;
  view.keep.clear();
}
export function clearFilters() {
  view.filters = {}; view.search = ''; view.issuesOnly = false; view.keep.clear();
}
