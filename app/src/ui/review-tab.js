// Review tab: the checks, and the finished report as an editable table (Shuru or SIMS layout)
import { reportColumns, EDITABLE } from '../engine/report.js';
import { itemKey } from '../engine/sources.js';
import { SIMS_COLUMNS, SIMS_SHARED, simsEditable } from '../engine/sims.js';
import { state, isSims, recordEdit } from './state.js';
import { $, esc, plural, redrawKeepingCaret, flash } from './util.js';
import { grid } from './grid.js';
import { changed, render, reportRows, undoEdit, redoEdit } from './app.js';
import { openExport } from './export.js';

// check levels, worst first: red = problems, yellow = warnings, blue = SIMS notes, gray = notes
export const LEVEL_WORDS = { error: 'problem', warn: 'warning', sims: 'SIMS note', info: 'note' };
const LEVEL_ICONS = { error: '✖', warn: '!', sims: 'S', info: 'i' };
export const levelCount = (warnings, level) => warnings.filter(w => w.level === level).length;

// columns of the Review table: Item Lookup, then the chosen output's columns
const reviewColumns = () => (isSims() ? [['itemLookup', 'Item Lookup'], ...SIMS_COLUMNS.map(([k, l, name]) => [k, name ?? l])] : reportColumns(state.config));
const isEditable = k => (isSims() ? k !== 'itemLookup' && simsEditable(k) : EDITABLE.has(k));

export function renderReview(main) {
  const r = state.report;
  // worst warning level per item, used to tint the row
  const issues = new Map();
  for (const w of r.warnings) {
    if (!w.item || w.level === 'info' || w.level === 'sims') continue; // notes don't tint rows
    const cur = issues.get(w.item) || { level: 'warn', texts: [] };
    if (w.level === 'error') cur.level = 'error';
    cur.texts.push(w.text);
    issues.set(w.item, cur);
  }
  const cols = reviewColumns();
  const sims = isSims();
  const q = state.reviewFilter.trim().toLowerCase();
  const allRows = reportRows();
  const rows = allRows.filter(row =>
    !(state.hideEmpty.review && row._empty) &&
    (!state.reviewIssuesOnly || issues.has(row.itemLookup) || row.locked || row._empty) &&
    (!q || cols.some(([k]) => String(row[k] ?? '').toLowerCase().includes(q))));

  const rowClass = row => (row._empty ? 'empty-row issue-warn' : issues.has(row.itemLookup) ? `issue-${issues.get(row.itemLookup).level}` : '');
  const cell = (row, i, k, j) => {
    const sticky = j === 0 ? 'sticky ' : '';
    if (!isEditable(k)) return `<th class="${sticky}s${j}" data-r="${i}" data-c="${j}" ${j === 0 && issues.has(row.itemLookup) ? `title="${esc(issues.get(row.itemLookup).texts.join('\n'))}"` : ''}>${esc(row[k])}${j === 0 ? sourceBadges(row) : ''}</th>`;
    const edited = row._edited.includes(k), sheet = row._fromSheet?.includes(k);
    return `<td data-r="${i}" data-c="${j}" class="${edited ? 'edited' : sheet ? 'from-sheet' : ''}" ${edited ? `title="Edited. Calculated value: ${esc(row._base[k] || '(empty)')}"` : sheet ? 'title="From the Google Sheet rows (Data tab)"' : ''}>${esc(row[k])}</td>`;
  };

  main.innerHTML = `
  ${r.warnings.length ? `
  <section class="card warnings">
    <details ${r.warnings.some(w => w.level === 'error') ? 'open' : ''}>
      <summary><h2>Checks</h2>
        ${Object.entries(LEVEL_WORDS).map(([l, word]) => { const n = levelCount(r.warnings, l); return n ? `<span class="pill ${l}">${plural(n, word)}</span>` : ''; }).join('')}
      </summary>
      <ul>${r.warnings.map(w => `<li class="${w.level}${w.item ? ' link' : ''}" ${w.item ? `data-goto-item="${esc(w.item)}" title="Show ${esc(w.item)} in the table"` : ''}><span class="lvl">${LEVEL_ICONS[w.level]}</span>${esc(w.text)}</li>`).join('')}</ul>
    </details>
  </section>` : ''}
  <section class="card">
    <div class="card-head">
      <div><h2>${sims ? 'SIMS report' : 'Audit Report'}</h2><p class="hint">Works like a spreadsheet: arrow keys, Shift to select, type or double-click to change a cell, Ctrl+C / Ctrl+V, Ctrl+Z to undo.
      Edited cells are highlighted; clear a cell (Delete) to go back to the calculated value.
      ${sims ? 'SIMS layout: columns D (Item No) to T (Blancco Result) of the SIMS sheet. Serial No, asset tag, Diagnostics and weight are the same as in the Shuru layout; changing another column only changes the SIMS output. Codes come from Dictionary › SIMS diagnostics.' : ''}
      ${state.sheet ? 'Green cells come from the Google Sheet rows on the Data tab (the other inputs had nothing there).' : ''}
      Empty yellow rows are item numbers with no data yet; typing in one adds a manual entry.</p></div>
      <div class="actions">
        <label class="output-pick" title="Which sheet layout Review and Export use: ours (Shuru) or a contractor's (SIMS). Saved with the project; the data stays the same.">Output
          <select data-output><option value="shuru" ${sims ? '' : 'selected'}>Shuru</option><option value="sims" ${sims ? 'selected' : ''}>SIMS</option></select></label>
        <input type="search" id="reviewSearch" placeholder="Search…" value="${esc(state.reviewFilter)}">
        <label class="check"><input type="checkbox" id="issuesOnly" ${state.reviewIssuesOnly ? 'checked' : ''}> Only items with issues</label>
        <label class="check"><input type="checkbox" id="hideEmptyReview" ${state.hideEmpty.review ? 'checked' : ''}> Hide empty rows</label>
        <button class="btn primary" id="openExport" ${allRows.length ? '' : 'disabled'} title="Copy the report for the Google Sheet, or download it as Excel">Export…</button>
      </div>
    </div>
    ${allRows.length ? `
    <div class="table-wrap tall">
      <table class="grid review">
        <thead><tr>${cols.map(([, l], j) => `<th class="${j === 0 ? 'sticky ' : ''}s${j}" data-hc="${j}">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((row, i) => `
          <tr data-code="${esc(row.itemLookup)}" class="${rowClass(row)}"${row._empty ? ' title="No data yet for this item"' : ''}>
            ${cols.map(([k], j) => cell(row, i, k, j)).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="hint">${rows.length} of ${plural(allRows.length, 'item')} shown</p>` : '<p class="empty">Nothing to show yet. Add data on the Data tab or a manual entry.</p>'}
  </section>`;

  $('#reviewSearch').oninput = e => { state.reviewFilter = e.target.value; redrawKeepingCaret(e.target, render); };
  $('#issuesOnly').onchange = e => { state.reviewIssuesOnly = e.target.checked; render(); };
  $('#hideEmptyReview').onchange = e => { state.hideEmpty.review = e.target.checked; render(); };
  $('#openExport').onclick = openExport;

  const table = main.querySelector('table.review');
  if (table) grid('review').attach(table, {
    rows: rows.length, cols: cols.length,
    value: (r, c) => rows[r][cols[c][0]] ?? '',
    // in SIMS layout, an item with no data yet only takes the columns that are also in the Shuru layout
    editable: (r, c) => isEditable(cols[c][0]) && !(sims && rows[r]._empty && !SIMS_SHARED.has(cols[c][0])),
    commit: changes => {
      recordEdit();
      const man = state.project.manual;
      for (const { r, c, value } of changes) {
        const row = rows[r], code = row.itemLookup, f = cols[c][0];
        if (row._empty) { // an item with no data yet: what's typed becomes its manual entry
          if (!value) continue;
          const key = Object.keys(man).find(k => itemKey(k) === itemKey(code)) ?? code;
          man[key] = { ...man[key], [f]: value };
          continue;
        }
        const base = String(row._edited.includes(f) ? row._base[f] ?? '' : row[f] ?? '');
        const next = value === base ? '' : value; // the calculated value (or an empty cell) removes the edit
        // SIMS-only columns are kept apart, so they don't change the Shuru layout
        const ov = sims && !SIMS_SHARED.has(f) ? state.project.simsOverrides : state.project.overrides;
        ov[code] = ov[code] || {};
        if (next) ov[code][f] = next; else delete ov[code][f];
        if (!Object.keys(ov[code]).length) delete ov[code];
      }
      changed();
    },
    undo: undoEdit, redo: redoEdit,
  });

  // a check about an item: show that item's row (clearing the filters if they hide it)
  const rowOf = code => main.querySelector(`tr[data-code="${CSS.escape(code)}"]`);
  main.querySelectorAll('[data-goto-item]').forEach(li => li.onclick = () => {
    let tr = rowOf(li.dataset.gotoItem);
    if (!tr && (state.reviewFilter || state.reviewIssuesOnly || state.hideEmpty.review)) {
      state.reviewFilter = ''; state.reviewIssuesOnly = false; state.hideEmpty.review = false; render();
      tr = rowOf(li.dataset.gotoItem);
    }
    if (!tr) return;
    tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flash(tr);
    const first = tr.querySelector('[data-r]');
    if (first) grid('review').select(+first.dataset.r, 0);
  });
}

const SOURCES = [['mac', 'Mac report', 'M'], ['win', 'Windows report', 'W'], ['blancco', 'Blancco export', 'B'], ['manual', 'Manual entry', 'H'], ['sheet', 'Google Sheet rows (Data tab)', 'G']];
const sourceBadges = row => `<span class="badges">${SOURCES.map(([k, title, letter]) => (row._sources[k] ? `<i title="${title}">${letter}</i>` : '')).join('')}</span>`;
