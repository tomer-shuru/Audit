// Final Report tab: the checks, then the finished report as an editable table (Shuru or SIMS layout), with its
// other sheets (Locked and Faulty; SIMS: HDD). Each column header has a filter like Google Sheets / Excel, and
// columns can be hidden. What is shown is what Copy and Download take (see report-view.js).
import { EDITABLE } from '../engine/report.js';
import { itemKey } from '../engine/sources.js';
import { SIMS_SHARED, simsEditable } from '../engine/sims.js';
import { state, isSims, recordEdit } from './state.js';
import { $, esc, plural, redrawKeepingCaret, flash } from './util.js';
import { ICONS } from './icons.js';
import { grid } from './grid.js';
import { changed, recompute, render, undoEdit, redoEdit } from './app.js';
import { copySheet, downloadReport } from './export.js';
import { openPopover, closePopover } from './popover.js';
import {
  SHEETS, view, sheetKinds, currentSheet, isMain, rowKey, viewColumns, colName, hiddenCols, setHidden,
  rowIssues, shownRows, columnValues, setFilter, clearFilters, isFiltered,
} from './report-view.js';

// check levels, worst first: red = problems, yellow = warnings, blue = SIMS notes, gray = notes
export const LEVEL_WORDS = { error: 'problem', warn: 'warning', sims: 'SIMS note', info: 'note' };
const LEVEL_ICONS = { error: '✖', warn: '!', sims: 'S', info: 'i' };
export const levelCount = (warnings, level) => warnings.filter(w => w.level === level).length;

export function renderReport(main) {
  const r = state.report;
  const kind = currentSheet(), mainSheet = isMain(kind), sims = isSims();
  const isEditable = k => mainSheet && (sims ? k !== 'itemLookup' && simsEditable(k) : EDITABLE.has(k));
  const issues = rowIssues();
  const cols = viewColumns(kind);
  const allRows = SHEETS[kind].rows();
  const rows = shownRows(kind);
  const filters = Object.entries(view.filters[kind] || {}).filter(([, out]) => out.size).map(([k]) => k);
  const hidden = hiddenCols(kind);
  const filtered = isFiltered(kind); // Copy then says "filtered" and takes another color
  const count = k => SHEETS[k].rows().filter(x => !x._empty).length;

  const rowClass = row => (row._empty ? 'empty-row issue-warn' : mainSheet && issues.has(row.itemLookup) ? `issue-${issues.get(row.itemLookup).level}` : '');
  const cell = (row, i, k, j) => {
    const sticky = j === 0 ? 'sticky ' : '';
    if (!isEditable(k)) return `<th class="${sticky}s${j}" data-r="${i}" data-c="${j}" ${j === 0 && mainSheet && issues.has(row.itemLookup) ? `title="${esc(issues.get(row.itemLookup).texts.join('\n'))}"` : ''}>${esc(row[k])}${j === 0 && mainSheet ? sourceBadges(row) : ''}</th>`;
    const edited = row._edited.includes(k), sheet = row._fromSheet?.includes(k);
    return `<td data-r="${i}" data-c="${j}" class="${edited ? 'edited' : sheet ? 'from-sheet' : ''}" ${edited ? `title="Edited. Calculated value: ${esc(row._base[k] || '(empty)')}"` : sheet ? 'title="From the Google Sheet rows (Data tab)"' : ''}>${esc(row[k])}</td>`;
  };
  const head = (c, j) => {
    const [k] = c, on = filters.includes(k);
    return `<th class="${j === 0 ? 'sticky ' : ''}s${j}" data-hc="${j}"><span class="hl">${esc(colName(c))}</span><button class="hf${on ? ' on' : ''}" data-filter="${esc(k)}" data-popover="f:${kind}:${esc(k)}" title="${on ? 'Filtered. Click to change' : 'Filter'}${k === 'itemLookup' ? '' : ' or hide'} this column">${on ? ICONS.filter : ICONS.menu}</button></th>`;
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
      <div><h2>Final Report</h2><p class="hint">Works like a spreadsheet: arrow keys, Shift to select, type or double-click to change a cell, Ctrl+C / Ctrl+V, Ctrl+Z to undo.
      Edited cells are highlighted; clear a cell (Delete) to go back to the calculated value.
      ${sims ? 'SIMS layout: columns D (Item No) to T (Blancco Result) of the SIMS sheet. Serial No, asset tag, Diagnostics and weight are the same as in the Shuru layout; changing another column only changes the SIMS output. Codes come from Dictionary › SIMS diagnostics.' : ''}
      ${state.sheet ? 'Green cells come from the Google Sheet rows on the Data tab (the other inputs had nothing there).' : ''}
      Empty yellow rows are item numbers with no data yet; typing in one adds a manual entry.
      The arrow on a column header filters or hides it. <b>Copy and Download take what is shown.</b></p></div>
    </div>
    <div class="sheet-tabs" role="tablist">${sheetKinds().map(k => `<button role="tab" class="${k === kind ? 'active' : ''}" data-sheet="${k}">${SHEETS[k].title} <span class="count">${count(k)}</span></button>`).join('')}</div>
    <div class="report-bar">
      <input type="search" id="reportSearch" placeholder="Search…" value="${esc(view.search)}">
      ${mainSheet ? `<label class="check"><input type="checkbox" id="issuesOnly" ${view.issuesOnly ? 'checked' : ''}> Only items with issues</label>` : ''}
      ${filters.length ? `<span class="chip">Filtered: ${filters.map(k => esc(colName(cols.find(c => c[0] === k) || [k, k]))).join(', ')}</span>` : ''}
      ${isFiltered(kind) ? '<button class="btn small ghost" id="clearFilters">Clear filters</button>' : ''}
      ${hidden.size ? `<button class="btn small ghost" id="showCols" title="${esc([...hidden].join(', '))}">${plural(hidden.size, 'hidden column')} · Show all</button>` : ''}
      <span class="spacer"></span>
      <span class="split${filtered ? ' filtered' : ''}"><button class="btn primary" id="copyRows" ${rows.length ? '' : 'disabled'} title="Copy the ${filtered ? `${plural(rows.length, 'row')} the filters show` : 'rows'} and the columns shown, to paste into the Google Sheet">${filtered ? 'Copy filtered rows' : 'Copy all rows'}</button><button class="btn primary" id="copyMenu" data-popover="copy" ${rows.length ? '' : 'disabled'} title="More ways to copy">${ICONS.menu}</button></span>
      ${sims ? `<button class="btn" id="dlMenu" data-popover="download" ${r.rows.length ? '' : 'disabled'}>Download ${ICONS.menu}</button>`
        : `<button class="btn" id="dlReport" ${r.rows.length ? '' : 'disabled'} title="An Excel file with the Audit Report and Locked and Faulty, as shown">Download Excel</button>`}
    </div>
    ${allRows.length ? `
    <div class="table-wrap tall">
      <table class="grid report">
        <thead><tr>${cols.map(head).join('')}</tr></thead>
        <tbody>${rows.map((row, i) => `
          <tr data-code="${esc(rowKey(row))}" class="${rowClass(row)}"${row._empty ? ' title="No data yet for this item"' : ''}>
            ${cols.map(([k], j) => cell(row, i, k, j)).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="hint">${rows.length} of ${plural(allRows.length, 'row')} shown${rows.length < allRows.length ? ' (filtered)' : ''}</p>`
    : `<p class="empty">${mainSheet ? 'Nothing to show yet. Add data on the Data tab or a manual entry.' : kind === 'locked' ? 'No locked or faulty devices in this project.' : 'No data carrier serials (S.N. Data carrier) in this project.'}</p>`}
  </section>`;

  main.querySelectorAll('[data-sheet]').forEach(b => b.onclick = () => { view.sheet = b.dataset.sheet; closePopover(); render(); });
  $('#reportSearch').oninput = e => { view.search = e.target.value; view.keep.clear(); redrawKeepingCaret(e.target, render); };
  const issuesOnly = $('#issuesOnly');
  if (issuesOnly) issuesOnly.onchange = e => { view.issuesOnly = e.target.checked; view.keep.clear(); render(); };
  const clear = $('#clearFilters');
  if (clear) clear.onclick = () => { clearFilters(); render(); };
  const showCols = $('#showCols');
  if (showCols) showCols.onclick = () => { setHidden(kind, []); recompute(); render(); };
  main.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => openFilterMenu(b, kind, b.dataset.filter, cols));
  $('#copyRows').onclick = () => copySheet(kind);
  $('#copyMenu').onclick = e => menu(e.currentTarget, 'copy', [['Copy with headers', () => copySheet(kind, { withHeader: true })]]);
  if (sims) {
    $('#dlMenu').onclick = e => menu(e.currentTarget, 'download', [
      ['SIMS file (fills the SIMS template)', () => downloadReport({ sims: true })],
      ['SIMS file from another template…', () => downloadReport({ sims: true, pick: true })],
      ['Locked and Faulty (.xlsx)', () => downloadReport({ sims: true, lockedOnly: true })],
    ]);
  } else $('#dlReport').onclick = () => downloadReport();

  const table = main.querySelector('table.report');
  if (table) grid('report').attach(table, {
    rows: rows.length, cols: cols.length,
    value: (r, c) => rows[r][cols[c][0]] ?? '',
    // in SIMS layout, an item with no data yet only takes the columns that are also in the Shuru layout
    editable: (r, c) => isEditable(cols[c][0]) && !(sims && rows[r]._empty && !SIMS_SHARED.has(cols[c][0])),
    commit: changes => {
      recordEdit();
      const man = state.project.manual;
      for (const { r, c, value } of changes) {
        const row = rows[r], code = row.itemLookup, f = cols[c][0];
        view.keep.add(code); // stays in view even if it no longer matches the filters
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
    let tr = isMain(currentSheet()) && rowOf(li.dataset.gotoItem);
    if (!tr) {
      clearFilters(); view.sheet = sheetKinds()[0]; render();
      tr = rowOf(li.dataset.gotoItem);
    }
    if (!tr) return;
    tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    flash(tr);
    const first = tr.querySelector('[data-r]');
    if (first) grid('report').select(+first.dataset.r, 0);
  });
}

// a small menu of actions under a button: items [[label, run]]
function menu(btn, key, items) {
  openPopover(btn, items.map(([label], i) => `<button class="pv-action" data-i="${i}">${esc(label)}</button>`).join(''), el => {
    el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { closePopover(); items[+b.dataset.i][1](); });
  }, { className: 'action-menu', key });
}

// the filter of a column, like Google Sheets / Excel: tick the values to show (applies at once), or hide the column
function openFilterMenu(btn, kind, k, cols) {
  const values = columnValues(kind, k);
  const out = view.filters[kind]?.[k] || new Set();
  const label = colName(cols.find(c => c[0] === k));
  const shownValue = v => (v === '' ? '(Blanks)' : esc(v));
  openPopover(btn, `
    <div class="pv-head">${esc(label)}</div>
    <input type="search" class="pv-search" placeholder="Search values…" aria-label="Search values">
    <label class="pv-item pv-all"><input type="checkbox" data-all> <span>Select all</span></label>
    <div class="pv-list">${values.map(([v, n], i) => `
      <label class="pv-item"><input type="checkbox" data-v="${i}" ${out.has(v) ? '' : 'checked'}><span>${shownValue(v)}</span><span class="muted">${n}</span></label>`).join('')}
    </div>
    <div class="pv-actions">
      <button class="btn small" data-clear ${out.size ? '' : 'disabled'}>Clear filter</button>
      ${k === 'itemLookup' ? '' : '<button class="btn small ghost" data-hide title="Hidden columns are not shown, copied or downloaded">Hide column</button>'}
    </div>`, el => {
    const boxes = [...el.querySelectorAll('[data-v]')];
    const all = el.querySelector('[data-all]'), clearBtn = el.querySelector('[data-clear]');
    const listed = () => boxes.filter(b => !b.closest('label').hidden);
    const syncAll = () => {
      const vis = listed();
      all.checked = vis.length > 0 && vis.every(b => b.checked);
      all.indeterminate = !all.checked && vis.some(b => b.checked);
      clearBtn.disabled = boxes.every(b => b.checked);
    };
    const apply = () => { setFilter(kind, k, new Set(boxes.filter(b => !b.checked).map(b => values[+b.dataset.v][0]))); syncAll(); render(); };
    boxes.forEach(b => b.onchange = apply);
    all.onchange = () => { listed().forEach(b => { b.checked = all.checked; }); apply(); };
    el.querySelector('.pv-search').oninput = e => {
      const q = e.target.value.trim().toLowerCase();
      boxes.forEach(b => { const l = b.closest('label'); l.hidden = !!q && !l.textContent.toLowerCase().includes(q); });
      syncAll();
    };
    clearBtn.onclick = () => { setFilter(kind, k, new Set()); closePopover(); render(); };
    const hide = el.querySelector('[data-hide]');
    if (hide) hide.onclick = () => { setFilter(kind, k, new Set()); setHidden(kind, [...hiddenCols(kind), k]); closePopover(); recompute(); render(); };
    syncAll();
    el.querySelector('.pv-search').focus();
  }, { className: 'filter-menu', key: `f:${kind}:${k}` });
}

const SOURCES = [['mac', 'Mac report', 'M'], ['win', 'Windows report', 'W'], ['blancco', 'Blancco export', 'B'], ['manual', 'Manual entry', 'H'], ['sheet', 'Google Sheet rows (Data tab)', 'G']];
const sourceBadges = row => `<span class="badges">${SOURCES.map(([k, title, letter]) => (row._sources[k] ? `<i title="${title}">${letter}</i>` : '')).join('')}</span>`;
