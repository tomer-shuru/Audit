// Audit Builder - browser UI
import { buildReport, REPORT_COLUMNS, EXPORT_COLUMNS, LOCKED_COLUMNS, MANUAL_FIELDS, EDITABLE, itemCode, missingItemsNote } from '../engine/report.js';
import { normalizeBlancco, mergeTables, parseMacLines, parseWindowsLines, itemKey } from '../engine/sources.js';
import defaultModels from '../data/default-models.json';
import {
  readTableFiles, parsePastedTable, importWorkbook, downloadXlsx, toTsv,
  copyText, downloadJson, readJsonFile,
} from './io.js';
import { mergeWithSheet } from './merge.js';
import { grid } from './grid.js';
import {
  canSaveInPlace, rememberedFile, rememberFile, chooseSaveFile, chooseOpenFile, writeFile,
  MODELS_FILE, chooseModelsFile, chooseNewModelsFile, hasPermission, readFileText,
} from './filesave.js';

const STORE_PROJECT = 'auditApp.project';
const STORE_MODELS = 'auditApp.models';
const STORE_TAB = 'auditApp.tab';

// ---------- state ----------
const emptyProject = () => ({
  version: 2,
  settings: { projectNumber: '', prefix: '', endClient: '' },
  inputs: { mac: '', windows: '', blanccoFiles: [], sheet: '' },
  manual: {}, overrides: {},
  savedToFile: true,
});

// bring projects saved by older versions up to date
function migrate(p) {
  const project = Object.assign(emptyProject(), p);
  project.inputs = Object.assign(emptyProject().inputs, p.inputs);
  const inp = project.inputs;
  if (Array.isArray(inp.blancco)) {
    if (!inp.blanccoFiles.length && inp.blancco.length > 1) inp.blanccoFiles = [{ name: inp.blanccoSource || 'Blancco export', table: inp.blancco }];
    delete inp.blancco; delete inp.blanccoSource;
  }
  delete project.settings.startNumber;
  return project;
}

const load = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const store = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } };

const state = {
  project: migrate(load(STORE_PROJECT, {})),
  models: load(STORE_MODELS, null) || structuredClone(defaultModels),
  tab: load(STORE_TAB, 'data'),
  report: null,
  reviewFilter: '', reviewIssuesOnly: false,
  modelsTab: 'models',
  manualSelected: new Set(),
};

const settingsComplete = s => s.projectNumber.trim() && s.endClient.trim(); // the prefix may be empty (codes that are just numbers)

function recompute() {
  state.report = buildReport(state.project, state.models);
  mergeSheetRows();
}

// Rows already in the Google Sheet (Data tab) take the place of the report rows for the same items.
// They are lined up with the Audit Report columns ticked on the Export tab, the way they get pasted back.
// state.merge.rows is then the full list shown on Review and Export; its checks join the report's warnings.
function mergeSheetRows() {
  state.merge = null;
  const r = state.report;
  if (!state.project.inputs.sheet.trim()) return;
  const cols = exportCols('report');
  const m = mergeWithSheet({ sheetText: state.project.inputs.sheet, cols, rows: r.rows, prefix: state.project.settings.prefix });
  state.merge = m;
  // the app's rows for items the sheet already has aren't used, so neither are their checks
  const skipped = new Set(m.skipped);
  const keys = m.rows.map(x => (x._sheet ? x._sheet.code : itemKey(x.itemLookup))).filter(Boolean);
  r.warnings = r.warnings.filter(w => !skipped.has(w.item) && w.kind !== 'gaps');
  const gaps = missingItemsNote(state.project.settings, keys);
  if (gaps) r.warnings.push(gaps);
  r.warnings.push(...sheetWarnings(m));
}
const reportRows = () => state.merge?.rows ?? state.report.rows;
function changed({ rerender = true } = {}) {
  state.project.savedToFile = false;
  store(STORE_PROJECT, state.project);
  recompute();
  if (rerender) render(); else renderChrome();
}

// ---------- undo / redo for edits in the Review and Manual entries tables ----------
const history = { undo: [], redo: [] };
const snapshot = () => JSON.stringify({ manual: state.project.manual, overrides: state.project.overrides });
function recordEdit() {
  history.undo.push(snapshot());
  if (history.undo.length > 200) history.undo.shift();
  history.redo = [];
}
function restoreEdit(from, to, what) {
  if (!from.length) { toast(`Nothing to ${what}`); return; }
  to.push(snapshot());
  Object.assign(state.project, JSON.parse(from.pop()));
  changed();
}
const undoEdit = () => restoreEdit(history.undo, history.redo, 'undo');
const redoEdit = () => restoreEdit(history.redo, history.undo, 'redo');
const clearHistory = () => { history.undo = []; history.redo = []; };

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

let toastTimer;
function toast(msg, kind = 'ok', action = null) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}`;
  t.className = `toast show ${kind}`;
  if (action) t.querySelector('button').onclick = () => { t.className = 'toast'; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, action ? 6000 : 2600);
}

// suggest the code after the highest one used so far (GG01 for an empty project)
function nextFreeCode() {
  const p = state.project.settings;
  const prefix = itemKey(p.prefix);
  let max = 0;
  for (const code of [...Object.keys(state.project.manual), ...state.report.rows.map(r => r.itemLookup)]) {
    const k = itemKey(code);
    if (k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length))) max = Math.max(max, Number(k.slice(prefix.length)));
  }
  return itemCode(p, max + 1);
}

// ---------- chrome (header + tabs) ----------
function renderChrome() {
  const s = state.project.settings;
  const r = state.report;
  $('#projectChip').innerHTML = settingsComplete(s)
    ? `<b>${esc(s.projectNumber)}</b><span>${esc(s.endClient)}</span><span>${esc(s.prefix || 'no prefix')}</span>`
    : '<b>No project set up</b>';
  const saved = $('#saveState');
  saved.textContent = !state.project.savedToFile ? 'Unsaved changes' : state.fileName ? `Saved · ${state.fileName}` : '';
  saved.classList.toggle('dirty', !state.project.savedToFile);
  saved.title = state.fileName ? `Save (Ctrl+S) writes to ${state.fileName}` : 'Save (Ctrl+S) will ask where to save the project file';
  // Review shows how many checks there are: red = problems, yellow = warnings, gray = notes
  const levels = { error: 'problem', warn: 'warning', info: 'note' };
  const checks = Object.entries(levels).map(([l, word]) => {
    const n = r.warnings.filter(w => w.level === l).length;
    return n ? `<span class="badge ${l}" title="${plural(n, word)}">${n}</span>` : '';
  }).join('');
  const counts = {
    data: r.counts.mac + r.counts.win + r.counts.blancco + (state.merge?.sheetCodes.length || 0) || '',
    manual: r.counts.manual || '',
    review: checks,
    export: '',
  };
  document.querySelectorAll('#tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === state.tab);
    b.querySelector('.count').innerHTML = counts[b.dataset.tab] ?? '';
  });
}

function render() {
  renderChrome();
  const main = $('#main');
  const views = { data: renderData, manual: renderManual, review: renderReview, export: renderExport };
  keepScroll(main, () => views[state.tab](main));
}

// re-render without making tables jump back to the top-left
function keepScroll(main, draw) {
  const before = [...main.querySelectorAll('.table-wrap')].map(w => [w.scrollLeft, w.scrollTop]);
  const tab = main.dataset.tab;
  draw();
  main.dataset.tab = state.tab;
  if (tab !== state.tab) return;
  main.querySelectorAll('.table-wrap').forEach((w, i) => { if (before[i]) [w.scrollLeft, w.scrollTop] = before[i]; });
}

// ---------- Data tab ----------
function renderData(main) {
  const inp = state.project.inputs;
  const files = inp.blanccoFiles;
  const merged = normalizeBlancco(mergeTables(files.map(f => f.table)));
  const serials = new Set(merged.rows.map(r => r.serial).filter(Boolean));
  const mac = parseMacLines(inp.mac), win = parseWindowsLines(inp.windows);
  const noCode = list => list.filter(x => !x.item).length;
  const fileInfo = f => {
    const n = normalizeBlancco(f.table);
    return { rows: n.rows.length, missing: n.missing };
  };

  main.innerHTML = `
  <section class="card dropzone" id="blanccoCard">
    <div class="card-head">
      <div><h2>Blancco exports</h2><p class="hint">Erasure reports exported from Blancco: .csv, .xlsx, or .zip files containing them. Choose several at once or drop them here.</p></div>
      <div class="actions">
        <label class="btn primary">Add files…<input type="file" id="blanccoFile" accept=".csv,.xlsx,.xls,.txt,.zip" multiple hidden></label>
        ${files.length ? '<button class="btn ghost" id="blanccoClear">Remove all</button>' : ''}
      </div>
    </div>
    ${files.length ? `
      <ul class="file-list">${files.map((f, i) => { const info = fileInfo(f); return `
        <li><span class="file-name">${esc(f.name)}</span>
          <span class="${info.missing.length ? 'bad-text' : 'muted'}">${info.missing.length ? `missing: ${esc(info.missing.join(', '))}` : plural(info.rows, 'row')}</span>
          <button class="icon-btn" data-rmfile="${i}" title="Remove this file">✕</button></li>`; }).join('')}
      </ul>
      <div class="status ${merged.missing.length ? 'bad' : 'good'}">
        ${merged.missing.length ? `Missing columns: ${esc(merged.missing.join(', '))} ·` : '✓'}
        ${plural(files.length, 'file')} · ${plural(merged.rows.length, 'disk row')} · ${plural(serials.size, 'device')}
      </div>` : '<p class="empty drop-hint">Drop Blancco files here</p>'}
    <details>
      <summary>…or paste rows instead (copy the cells including the header row)</summary>
      <textarea id="blanccoPaste" rows="4" placeholder="Paste Blancco rows with the header row"></textarea>
    </details>
  </section>

  <div class="grid2">
    <section class="card">
      <div class="card-head"><div><h2>Mac reports</h2><p class="hint">One device per line, fields separated by <code>*</code>.</p></div></div>
      <textarea id="macInput" class="mono" rows="10" spellcheck="false" placeholder="GG23*YT26FYC924*5285978*Laptop*Apple*MacBookPro18,3*…">${esc(inp.mac)}</textarea>
      <div class="status" id="macStatus">${plural(mac.length, 'device')}${noCode(mac) ? ` · <span class="bad-text">${noCode(mac)} without item code</span>` : ''}</div>
    </section>
    <section class="card">
      <div class="card-head"><div><h2>Windows reports</h2><p class="hint">One device per line, fields separated by <code>*</code>.</p></div></div>
      <textarea id="winInput" class="mono" rows="10" spellcheck="false" placeholder="GG17*4V3SHW3*4004343*Notebook*Dell Inc.*Latitude 5431*…">${esc(inp.windows)}</textarea>
      <div class="status" id="winStatus">${plural(win.length, 'device')}${noCode(win) ? ` · <span class="bad-text">${noCode(win)} without item code</span>` : ''}</div>
    </section>
  </div>

  <section class="card">
    <div class="card-head">
      <div><h2>Rows already in the Google Sheet <span class="muted">optional</span></h2>
      <p class="hint">If some items are already filled in the project's Google Sheet, copy those rows there (from the first item row down past the last filled one,
      same columns as the export) and paste them here. On the Export tab they show up in their place and are copied back as they are,
      instead of Audit Builder's rows for the same items.</p></div>
      ${inp.sheet.trim() ? '<div class="actions"><button class="btn ghost" id="sheetClear">Clear</button></div>' : ''}
    </div>
    <textarea id="sheetInput" class="mono" rows="4" spellcheck="false" placeholder="Paste the Google Sheet rows here">${esc(inp.sheet)}</textarea>
    <div class="status" id="sheetStatus">${sheetStatus()}</div>
  </section>`;

  // adding a file with the same name replaces the earlier copy
  const addFiles = list => {
    for (const f of list) {
      const i = files.findIndex(x => x.name === f.name);
      if (i >= 0) files[i] = f; else files.push(f);
    }
  };
  const loadFiles = async list => {
    if (!list.length) return;
    try {
      const loaded = await readTableFiles(list);
      if (!loaded.length) { toast('No .csv or .xlsx files found', 'bad'); return; }
      addFiles(loaded);
      changed(); toast(`Added ${plural(loaded.length, 'file')}`);
    } catch (err) { toast(`Couldn't read the files: ${err.message}`, 'bad'); }
  };
  $('#blanccoFile').onchange = e => { const list = [...e.target.files]; e.target.value = ''; loadFiles(list); };
  const card = $('#blanccoCard');
  card.ondragover = e => { e.preventDefault(); card.classList.add('dragging'); };
  card.ondragleave = e => { if (!card.contains(e.relatedTarget)) card.classList.remove('dragging'); };
  card.ondrop = e => { e.preventDefault(); card.classList.remove('dragging'); loadFiles([...e.dataTransfer.files]); };

  $('#blanccoPaste').onpaste = e => setTimeout(() => {
    const table = parsePastedTable(e.target.value);
    if (table.length < 2) { toast('That doesn\'t look like a table with a header row', 'bad'); return; }
    const n = files.filter(f => f.name.startsWith('Pasted rows')).length + 1;
    addFiles([{ name: `Pasted rows ${n}`, table }]);
    changed(); toast(`Pasted ${plural(table.length - 1, 'row')}`);
  });
  main.querySelectorAll('[data-rmfile]').forEach(b => b.onclick = () => { files.splice(Number(b.dataset.rmfile), 1); changed(); });
  const clear = $('#blanccoClear');
  if (clear) clear.onclick = () => { if (confirm('Remove all Blancco files from this project?')) { files.length = 0; changed(); } };

  const bindLines = (id, key, statusId, parse) => {
    let t;
    $(id).oninput = e => {
      inp[key] = e.target.value;
      clearTimeout(t);
      t = setTimeout(() => {
        changed({ rerender: false });
        const list = parse(inp[key]);
        $(statusId).innerHTML = plural(list.length, 'device') + (noCode(list) ? ` · <span class="bad-text">${noCode(list)} without item code</span>` : '');
      }, 300);
    };
  };
  bindLines('#macInput', 'mac', '#macStatus', parseMacLines);
  let sheetTimer;
  $('#sheetInput').oninput = e => {
    inp.sheet = e.target.value;
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(() => { changed({ rerender: false }); $('#sheetStatus').innerHTML = sheetStatus(); }, 300);
  };
  const sheetClear = $('#sheetClear');
  if (sheetClear) sheetClear.onclick = () => { inp.sheet = ''; changed(); };
  bindLines('#winInput', 'windows', '#winStatus', parseWindowsLines);
}

function sheetStatus() {
  const m = state.merge;
  if (!m) return 'Nothing pasted';
  return `${plural(m.sheetCodes.length, 'row')} with an item code`;
}

// ---------- Manual entries tab ----------
function renderManual(main) {
  const man = state.project.manual;
  const codes = Object.keys(man).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const sel = state.manualSelected;
  for (const c of [...sel]) if (!(c in man)) sel.delete(c);
  const allSelected = codes.length > 0 && codes.every(c => sel.has(c));

  main.innerHTML = `
  <section class="card">
    <div class="card-head">
      <div><h2>Manual entries</h2>
      <p class="hint">For devices the tools can't read (dead, locked, no report). Anything typed here takes priority over the tools' data;
      Diagnostics and Locked/Faulty are added to what the tools found.</p></div>
      <div class="actions">
        ${sel.size ? `<button class="btn danger" id="delSelected">Delete ${plural(sel.size, 'selected item')}</button>` : ''}
        <input id="newCode" class="code-input" value="${esc(nextFreeCode())}" aria-label="Item code">
        <button class="btn primary" id="addManual">Add item</button>
      </div>
    </div>
    ${codes.length ? `
    <div class="table-wrap">
      <table class="grid manual">
        <thead><tr><th class="sticky item-col" data-hc="0"><label class="row-pick"><input type="checkbox" id="selAll" ${allSelected ? 'checked' : ''} title="Select all"></label>Item</th>${MANUAL_FIELDS.map(([, l], j) => `<th data-hc="${j + 1}">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${codes.map((code, i) => `
          <tr data-code="${esc(code)}" class="${sel.has(code) ? 'selected' : ''}">
            <th class="sticky item-col" data-r="${i}" data-c="0">
              <label class="row-pick"><input type="checkbox" data-sel="${esc(code)}" ${sel.has(code) ? 'checked' : ''} title="Select ${esc(code)}"></label>
              <button class="icon-btn" data-del="${esc(code)}" title="Delete ${esc(code)}">✕</button>
              ${esc(code)}
            </th>
            ${MANUAL_FIELDS.map(([f], j) => `<td data-r="${i}" data-c="${j + 1}">${esc(man[code][f] ?? '')}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<p class="empty">No manual entries yet. Add an item for every device you have to fill in by hand.</p>'}
  </section>`;

  // deleting is instant; the toast offers Undo
  const remove = list => {
    recordEdit();
    const removed = list.map(c => [c, man[c]]);
    for (const c of list) { delete man[c]; sel.delete(c); }
    changed();
    toast(list.length === 1 ? `Deleted ${list[0]}` : `Deleted ${plural(list.length, 'item')}`, 'ok', {
      label: 'Undo',
      run: () => { for (const [c, rec] of removed) man[c] = rec; changed(); },
    });
  };
  const delSel = $('#delSelected');
  if (delSel) delSel.onclick = () => remove(codes.filter(c => sel.has(c)));
  const selAll = $('#selAll');
  if (selAll) selAll.onchange = e => { if (e.target.checked) codes.forEach(c => sel.add(c)); else sel.clear(); render(); };
  main.querySelectorAll('[data-sel]').forEach(cb => cb.onchange = e => {
    const c = cb.dataset.sel;
    if (e.target.checked) sel.add(c); else sel.delete(c);
    render();
  });

  $('#addManual').onclick = () => {
    const code = $('#newCode').value.trim();
    if (!code) return;
    if (Object.keys(man).some(c => itemKey(c) === itemKey(code))) { toast(`${code} already has a manual entry`, 'bad'); return; }
    recordEdit();
    man[code] = {};
    changed();
    // select the new item's first cell, ready to type
    const row = Object.keys(man).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).indexOf(code);
    grid('manual').select(row, 1, { focus: true });
  };
  $('#newCode').onkeydown = e => { if (e.key === 'Enter') $('#addManual').click(); };
  main.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove([b.dataset.del]));

  const table = main.querySelector('table.manual');
  if (table) grid('manual').attach(table, {
    rows: codes.length, cols: MANUAL_FIELDS.length + 1,
    value: (r, c) => (c === 0 ? codes[r] : man[codes[r]][MANUAL_FIELDS[c - 1][0]] ?? ''),
    editable: (r, c) => c > 0,
    commit: changes => {
      recordEdit();
      for (const { r, c, value } of changes) {
        const rec = man[codes[r]], f = MANUAL_FIELDS[c - 1][0];
        if (value) rec[f] = value; else delete rec[f];
      }
      changed();
    },
    undo: undoEdit, redo: redoEdit,
  });
}

// Enter moves down, Tab moves right (default), Esc cancels
function gridKeys(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const td = e.target, tr = td.parentElement;
    const next = tr.nextElementSibling?.children[td.cellIndex];
    td.blur();
    if (next?.isContentEditable) next.focus();
  }
}

// ---------- Review tab ----------
function renderReview(main) {
  const r = state.report;
  // worst warning level per item, used to tint the row (notes don't tint)
  const issues = new Map();
  for (const w of r.warnings) {
    if (!w.item || w.level === 'info') continue;
    const cur = issues.get(w.item) || { level: 'warn', texts: [] };
    if (w.level === 'error') cur.level = 'error';
    cur.texts.push(w.text);
    issues.set(w.item, cur);
  }
  const issueItems = new Set(issues.keys());
  const q = state.reviewFilter.trim().toLowerCase();
  const allRows = reportRows();
  const rows = allRows.filter(row =>
    (!state.reviewIssuesOnly || issueItems.has(row.itemLookup) || row.locked) &&
    (!q || REPORT_COLUMNS.some(([k]) => String(row[k] ?? '').toLowerCase().includes(q))));
  const levelIcon = { error: '✖', warn: '!', info: 'i' };

  main.innerHTML = `
  ${r.warnings.length ? `
  <section class="card warnings">
    <details ${r.warnings.some(w => w.level === 'error') ? 'open' : ''}>
      <summary><h2>Checks</h2>
        ${['error', 'warn', 'info'].map(l => { const n = r.warnings.filter(w => w.level === l).length; return n ? `<span class="pill ${l}">${n} ${l === 'error' ? 'problem' + (n > 1 ? 's' : '') : l === 'warn' ? 'warning' + (n > 1 ? 's' : '') : 'note' + (n > 1 ? 's' : '')}</span>` : ''; }).join('')}
      </summary>
      <ul>${r.warnings.map(w => `<li class="${w.level}${w.item ? ' link' : ''}" ${w.item ? `data-goto-item="${esc(w.item)}" title="Show ${esc(w.item)} in the table"` : ''}><span class="lvl">${levelIcon[w.level]}</span>${esc(w.text)}</li>`).join('')}</ul>
    </details>
  </section>` : ''}
  <section class="card">
    <div class="card-head">
      <div><h2>Audit Report</h2><p class="hint">Works like a spreadsheet: arrow keys, Shift to select, type or double-click to change a cell, Ctrl+C / Ctrl+V, Ctrl+Z to undo.
      Edited cells are highlighted; clear a cell (Delete) to go back to the calculated value.
      ${state.merge ? 'Green rows are already in the Google Sheet (pasted on the Data tab) and stay as they are.' : ''}</p></div>
      <div class="actions">
        <input type="search" id="reviewSearch" placeholder="Search…" value="${esc(state.reviewFilter)}">
        <label class="check"><input type="checkbox" id="issuesOnly" ${state.reviewIssuesOnly ? 'checked' : ''}> Only items with issues</label>
      </div>
    </div>
    ${allRows.length ? `
    <div class="table-wrap tall">
      <table class="grid review">
        <thead><tr>${REPORT_COLUMNS.map(([k, l], j) => `<th class="${j === 0 ? 'sticky ' : ''}s${j}" data-hc="${j}">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((row, i) => row._sheet ? sheetReviewRow(row, i, issues) : `
          <tr data-code="${esc(row.itemLookup)}" class="${issues.has(row.itemLookup) ? 'issue-' + issues.get(row.itemLookup).level : ''}">
            ${REPORT_COLUMNS.map(([k], j) => {
              if (!EDITABLE.has(k)) return `<th class="${j === 0 ? 'sticky ' : ''}s${j}" data-r="${i}" data-c="${j}" ${j === 0 && issues.has(row.itemLookup) ? `title="${esc(issues.get(row.itemLookup).texts.join('\n'))}"` : ''}>${esc(row[k])}${j === 0 ? sourceBadges(row) : ''}</th>`;
              const edited = row._edited.includes(k);
              return `<td data-r="${i}" data-c="${j}" class="${edited ? 'edited' : ''}" ${edited ? `title="Edited. Calculated value: ${esc(row._base[k] || '(empty)')}"` : ''}>${esc(row[k])}</td>`;
            }).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="hint">${rows.length} of ${plural(allRows.length, 'item')} shown</p>` : '<p class="empty">Nothing to show yet. Add data on the Data tab or a manual entry.</p>'}
  </section>`;

  const search = $('#reviewSearch');
  if (search) {
    search.oninput = e => { state.reviewFilter = e.target.value; const pos = e.target.selectionStart; render(); const s = $('#reviewSearch'); s.focus(); s.setSelectionRange(pos, pos); };
    $('#issuesOnly').onchange = e => { state.reviewIssuesOnly = e.target.checked; render(); };
  }
  const table = main.querySelector('table.review');
  if (table) grid('review').attach(table, {
    rows: rows.length, cols: REPORT_COLUMNS.length,
    value: (r, c) => (c === 0 && rows[r]._sheet ? rows[r]._sheet.code : rows[r][REPORT_COLUMNS[c][0]] ?? ''),
    editable: (r, c) => !rows[r]._sheet && EDITABLE.has(REPORT_COLUMNS[c][0]),
    commit: changes => {
      recordEdit();
      const ov = state.project.overrides;
      for (const { r, c, value } of changes) {
        const row = rows[r], code = row.itemLookup, f = REPORT_COLUMNS[c][0];
        const base = String(row._edited.includes(f) ? row._base[f] ?? '' : row[f] ?? '');
        const next = value === base ? '' : value; // the calculated value (or an empty cell) removes the edit
        ov[code] = ov[code] || {};
        if (next) ov[code][f] = next; else delete ov[code][f];
        if (!Object.keys(ov[code]).length) delete ov[code];
      }
      changed();
    },
    undo: undoEdit, redo: redoEdit,
  });
  main.querySelectorAll('[data-goto-item]').forEach(li => li.onclick = () => {
    let tr = main.querySelector(`tr[data-code="${CSS.escape(li.dataset.gotoItem)}"]`);
    if (!tr && (state.reviewFilter || state.reviewIssuesOnly)) {
      state.reviewFilter = ''; state.reviewIssuesOnly = false; render();
      tr = main.querySelector(`tr[data-code="${CSS.escape(li.dataset.gotoItem)}"]`);
    }
    if (!tr) return;
    tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash');
    const first = tr.querySelector('[data-r]');
    if (first) grid('review').select(+first.dataset.r, 0);
  });
}

// a row that is already in the Google Sheet: shown as it is, not editable here
function sheetReviewRow(row, i, issues) {
  const issue = issues.get(row.itemLookup);
  return `
    <tr data-code="${esc(row.itemLookup)}" class="from-sheet ${issue ? 'issue-' + issue.level : ''}" title="Already in the Google Sheet. Change it on the Data tab.">
      ${REPORT_COLUMNS.map(([k], j) => {
        const at = `data-r="${i}" data-c="${j}"`;
        if (j === 0) return `<th class="sticky s0" ${at}>${esc(row._sheet.code || '—')}<span class="badges"><i title="Google Sheet">G</i></span></th>`;
        if (j === 1) return `<th class="s1" ${at}>${esc(row[k])}</th>`;
        return `<td ${at}>${esc(row[k])}</td>`;
      }).join('')}
    </tr>`;
}

function sourceBadges(row) {
  const s = row._sources;
  return `<span class="badges">${s.mac ? '<i title="Mac report">M</i>' : ''}${s.win ? '<i title="Windows report">W</i>' : ''}${s.blancco ? '<i title="Blancco export">B</i>' : ''}${s.manual ? '<i title="Manual entry">H</i>' : ''}</span>`;
}

// ---------- Export tab ----------
// Which columns to export is remembered on this computer; which rows is per session (new items start ticked).
const STORE_EXPORT_COLS = 'auditApp.exportHiddenCols';
const EXPORT_SHEETS = {
  report: { title: 'Audit Report', cols: EXPORT_COLUMNS, rows: r => r.rows },
  locked: { title: 'Locked and Faulty', cols: LOCKED_COLUMNS, rows: r => r.lockedFaulty },
};
const exportPrefs = { hiddenCols: load(STORE_EXPORT_COLS, { report: [], locked: [] }), excludedRows: { report: new Set(), locked: new Set() }, anchor: {} };

const exportCols = kind => {
  const hidden = new Set(exportPrefs.hiddenCols[kind] || []);
  return EXPORT_SHEETS[kind].cols.filter(([k]) => !hidden.has(k));
};

function exportSelection(kind) {
  const sheet = EXPORT_SHEETS[kind];
  const hidden = new Set(exportPrefs.hiddenCols[kind] || []);
  const excluded = exportPrefs.excludedRows[kind];
  const allRows = kind === 'report' ? reportRows() : sheet.rows(state.report);
  return {
    sheet, allRows, cols: exportCols(kind),
    rows: allRows.filter(r => !excluded.has(r.itemLookup)),
    hidden, excluded,
  };
}

function renderExport(main) {
  const r = state.report;
  const errors = r.warnings.filter(w => w.level === 'error');

  const section = kind => {
    const { sheet, allRows, cols, rows, hidden, excluded } = exportSelection(kind);
    if (kind === 'locked' && !allRows.length) {
      return `<section class="card"><div class="card-head"><div><h2>${sheet.title} <span class="muted">0 items</span></h2>
        <p class="hint">No locked or faulty devices in this project, so you don't need this sheet.</p></div></div></section>`;
    }
    const allRowsOn = allRows.every(x => !excluded.has(x.itemLookup));
    return `
    <section class="card" data-sheet="${kind}">
      <div class="card-head">
        <div><h2>${sheet.title} <span class="muted">${rows.length} of ${plural(allRows.length, 'row')} · ${cols.length} of ${sheet.cols.length} columns</span></h2>
        <p class="hint">${kind === 'report' && state.merge ? 'Green rows are already in the Google Sheet and are copied back as they are. Paste at the ITEM cell of the first item row in the Google Sheet.' : kind === 'report' ? 'Untick rows or columns you don\'t want, then copy and paste into the Google Sheet. Your column choice is remembered.' : 'Devices with a lock or fault. Send this list along with the report.'}</p></div>
        <div class="actions">
          <button class="btn primary" data-copy ${rows.length && cols.length ? '' : 'disabled'}>Copy rows</button>
          <button class="btn" data-copy-h ${rows.length && cols.length ? '' : 'disabled'}>Copy with headers</button>
        </div>
      </div>
      ${allRows.length ? `
      <div class="pick-bar">
        <span class="muted">Rows:</span>
        <button class="btn small" data-rows="all">All</button>
        <button class="btn small" data-rows="none">None</button>
        <button class="btn small" data-rows="invert">Invert</button>
        ${hidden.size ? '<button class="btn small" data-all-cols>Show all columns</button>' : ''}
        <span class="hint">Tip: tick one row, then hold Shift and click another to tick or untick everything in between.</span>
      </div>
      <div class="table-wrap export">
        <table class="grid pick">
          <thead><tr>
            <th class="sticky pick-col"><input type="checkbox" data-all-rows ${allRowsOn ? 'checked' : ''} title="Select all rows"></th>
            ${sheet.cols.map(([k, l]) => `<th class="${hidden.has(k) ? 'off' : ''}"><label class="col-pick"><input type="checkbox" data-col="${k}" ${hidden.has(k) ? '' : 'checked'}>${esc(l)}</label></th>`).join('')}
          </tr></thead>
          <tbody>${allRows.map(row => {
            const off = excluded.has(row.itemLookup);
            return `<tr class="${off ? 'off' : ''}${row._sheet ? ' from-sheet' : ''}">
              <th class="sticky pick-col"><input type="checkbox" data-row="${esc(row.itemLookup)}" ${off ? '' : 'checked'} title="${esc(row._sheet ? 'Already in the Google Sheet' : row.itemLookup)}"></th>
              ${sheet.cols.map(([k]) => `<td class="${hidden.has(k) ? 'off' : ''}">${esc(row[k])}</td>`).join('')}
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
` : '<p class="empty">No items yet.</p>'}
    </section>`;
  };

  main.innerHTML = `
  ${errors.length ? `<div class="banner bad">${plural(errors.length, 'problem')} still open: ${errors.map(e => esc(e.text)).join('; ')}. <a href="#" data-goto="review">Review</a></div>` : ''}
  ${section('report')}
  ${section('locked')}
  <section class="card">
    <div class="card-head">
      <div><h2>Excel file</h2><p class="hint">Download the selected rows and columns of both sheets as an .xlsx file.</p></div>
      <div class="actions"><button class="btn" id="dlXlsx" ${r.rows.length ? '' : 'disabled'}>Download .xlsx</button></div>
    </div>
  </section>`;

  main.querySelectorAll('[data-sheet]').forEach(card => {
    const kind = card.dataset.sheet;
    const { allRows, excluded } = exportSelection(kind);
    const saveCols = () => store(STORE_EXPORT_COLS, exportPrefs.hiddenCols);

    card.querySelectorAll('[data-col]').forEach(cb => cb.onchange = () => {
      const set = new Set(exportPrefs.hiddenCols[kind] || []);
      if (cb.checked) set.delete(cb.dataset.col); else set.add(cb.dataset.col);
      exportPrefs.hiddenCols[kind] = [...set]; saveCols(); recompute(); render();
    });
    // Shift-click: give every row between the last clicked one and this one the same state
    card.querySelectorAll('[data-row]').forEach(cb => cb.onclick = e => {
      const code = cb.dataset.row, on = cb.checked;
      const anchor = exportPrefs.anchor[kind];
      const a = allRows.findIndex(x => x.itemLookup === anchor), b = allRows.findIndex(x => x.itemLookup === code);
      const range = e.shiftKey && a >= 0 ? allRows.slice(Math.min(a, b), Math.max(a, b) + 1) : [allRows[b]];
      for (const x of range) { if (on) excluded.delete(x.itemLookup); else excluded.add(x.itemLookup); }
      exportPrefs.anchor[kind] = code;
      render();
    });
    card.querySelectorAll('[data-rows]').forEach(btn => btn.onclick = () => {
      const op = btn.dataset.rows;
      for (const x of allRows) {
        const k = x.itemLookup;
        if (op === 'all') excluded.delete(k);
        else if (op === 'none') excluded.add(k);
        else if (excluded.has(k)) excluded.delete(k); else excluded.add(k);
      }
      render();
    });
    const all = card.querySelector('[data-all-rows]');
    if (all) all.indeterminate = excluded.size > 0 && excluded.size < allRows.length;
    if (all) all.onchange = () => { if (all.checked) excluded.clear(); else allRows.forEach(x => excluded.add(x.itemLookup)); render(); };
    const allCols = card.querySelector('[data-all-cols]');
    if (allCols) allCols.onclick = () => { exportPrefs.hiddenCols[kind] = []; saveCols(); recompute(); render(); };

    const copy = async withHeader => {
      const { cols, rows } = exportSelection(kind);
      const ok = await copyText(toTsv(cols, rows, withHeader));
      toast(ok ? `Copied ${plural(rows.length, 'row')} × ${plural(cols.length, 'column')}. Paste it into the sheet.` : 'Copy failed. Try again.', ok ? 'ok' : 'bad');
    };
    card.querySelector('[data-copy]').onclick = () => copy(false);
    card.querySelector('[data-copy-h]').onclick = () => copy(true);
  });

  $('#dlXlsx').onclick = () => {
    const sheets = Object.keys(EXPORT_SHEETS).map(kind => { const s = exportSelection(kind); return { name: s.sheet.title, cols: s.cols, rows: s.rows }; });
    if (!downloadXlsx(sheets, state.project.settings)) toast('Nothing selected to export', 'bad');
  };
  main.querySelectorAll('[data-goto]').forEach(a => a.onclick = e => { e.preventDefault(); setTab(a.dataset.goto); });
}

// checks for the Google Sheet rows pasted on the Data tab (shown on the Review tab)
function sheetWarnings(m) {
  const settings = state.project.settings;
  const list = codes => (codes.length > 12 ? `${codes.slice(0, 12).join(', ')} and ${codes.length - 12} more` : codes.join(', '));
  const out = [];
  if (!m.sheetCodes.length) {
    out.push({ level: 'error', text: `Google Sheet rows (Data tab): no item codes found. Copy them including the ITEM column (codes like ITD-${settings.projectNumber}-${itemCode(settings, 1)}).` });
    return out;
  }
  const sheetRow = code => m.rows.find(x => x._sheet?.code === itemKey(code))?.itemLookup;
  for (const code of m.skipped) out.push({ level: 'info', item: sheetRow(code), text: `${code}: already in the Google Sheet, so the sheet's row is used` });
  if (m.duplicates.length) out.push({ level: 'warn', text: `Google Sheet rows: ${list(m.duplicates)} more than once. Every copy is kept.` });
  if (m.otherRows) out.push({ level: 'warn', text: `Google Sheet rows: ${plural(m.otherRows, 'row')} without an item code moved to the bottom` });
  if (m.headerRows) out.push({ level: 'info', text: `Google Sheet rows: ${plural(m.headerRows, 'row')} above the first item (headers) left out` });
  if (m.lineBreaks) out.push({ level: 'info', text: 'Google Sheet rows: some cells have line breaks; they will be pasted on one line' });
  return out;
}

// ---------- project setup dialog ----------
function openSetup({ force = false } = {}) {
  const d = $('#setupDialog');
  const s = state.project.settings;
  const f = $('#setupForm');
  f.projectNumber.value = s.projectNumber; f.prefix.value = s.prefix; f.endClient.value = s.endClient;
  $('#setupCancel').hidden = force;
  d.dataset.force = force ? '1' : '';
  updateSetupPreview();
  d.showModal();
  f.projectNumber.focus();
}
function updateSetupPreview() {
  const f = $('#setupForm');
  const s = { projectNumber: f.projectNumber.value.trim(), prefix: f.prefix.value.trim().toUpperCase() };
  $('#setupPreview').textContent = `Items: ${itemCode(s, 1)}, ${itemCode(s, 2)}… → ITD-${s.projectNumber || '…'}-${itemCode(s, 1)}`;
}

// ---------- models editor ----------
const MODEL_TABS = {
  models: { label: 'Models', key: 'models', hint: 'Mac model IDs (e.g. MacBookPro18,3) and Windows model names, with the details used in the report.',
    cols: [['id', 'Model ID'], ['name', 'Model name'], ['type', 'Type'], ['year', 'Year'], ['screen', 'Screen'], ['weight', 'Weight']] },
  typeMap: { label: 'Type mapping', key: 'typeMap', hint: 'Turns the chassis type reported by the tools (Blancco / Windows) into the type shown in the report.',
    cols: [['blanccoType', 'Reported type'], ['type', 'Report type']] },
  typeWeights: { label: 'Weights', key: 'typeWeights', hint: 'Weight (kg) written in the report for each device type.',
    cols: [['type', 'Type'], ['weight', 'Weight']] },
  cleanupRules: { label: 'Model cleanup', key: 'cleanupRules', hint: 'Text removed from Windows model names, top to bottom. Put longer phrases above shorter ones (e.g. "Notebook PC" before "PC"). Case-sensitive.',
    cols: [['_', 'Remove this text']] },
  diagCodes: { label: 'Diagnostic codes', key: 'diagCodes', hint: 'Type a code (e.g. LM) in any diagnostics field and the report shows the description instead. Case-sensitive.',
    cols: [['code', 'Code'], ['description', 'Description']], unique: 'code' },
};

// ---------- shared Models file ----------
// One models.json in the shared Drive folder. Everyone connects to it once; the app loads it on start
// (and when the window gets focus again) and writes every Models edit back to it.
// status: off | ok | needs-permission | missing | error | unsupported
const shared = { handle: null, status: canSaveInPlace ? 'off' : 'unsupported', text: '', error: '' };

const isModelsData = m => m && ['models', 'typeMap', 'typeWeights', 'cleanupRules', 'diagCodes'].every(k => Array.isArray(m[k]));
const modelsText = m => JSON.stringify(m, null, 1);

function applyModels(m) {
  state.models = m;
  store(STORE_MODELS, m);
  recompute();
  if ($('#modelsDialog').open) renderModels(); else render();
}

function sharedFailed(err) {
  shared.status = err.name === 'NotFoundError' ? 'missing' : err.name === 'NotAllowedError' ? 'needs-permission' : 'error';
  shared.error = err.message;
  renderShared();
}

// reads the shared file; ask=true only when called from a click (may show the browser's permission prompt)
async function loadSharedModels({ ask = false, announce = false } = {}) {
  if (!shared.handle) return;
  try {
    if (!(await hasPermission(shared.handle, ask))) { shared.status = 'needs-permission'; renderShared(); return; }
    const text = await readFileText(shared.handle);
    shared.status = 'ok';
    if (text !== shared.text) {
      const m = JSON.parse(text);
      if (!isModelsData(m)) throw new Error('it isn\'t a Models file');
      shared.text = text;
      if (modelsText(m) !== modelsText(state.models)) {
        applyModels(m);
        if (announce) toast('Loaded the latest shared Models list');
      }
    }
    renderShared();
  } catch (err) { sharedFailed(err); }
}

// called after every edit in the Models window
async function saveModels() {
  store(STORE_MODELS, state.models);
  recompute(); renderChrome();
  if (!shared.handle || shared.status !== 'ok') return;
  const text = modelsText(state.models);
  if (text === shared.text) return;
  try {
    // someone else saved since we last read it: take their version instead of overwriting it
    const current = await readFileText(shared.handle);
    if (current !== shared.text) {
      shared.text = '';
      await loadSharedModels();
      toast('A coworker changed the shared Models list just now. Their version is loaded; please redo your last change.', 'bad');
      return;
    }
    await writeFile(shared.handle, text);
    shared.text = text;
  } catch (err) {
    sharedFailed(err);
    toast(`Not saved to the shared Models file: ${err.message}`, 'bad');
  }
}

async function connectSharedModels() {
  const h = await chooseModelsFile();
  if (!h) return;
  try {
    if (!(await hasPermission(h, true))) throw Object.assign(new Error('the browser wasn\'t allowed to use it'), { name: 'NotAllowedError' });
    const text = await readFileText(h);
    const m = JSON.parse(text);
    if (!isModelsData(m)) throw new Error('it isn\'t a Models file');
    Object.assign(shared, { handle: h, text, status: 'ok', error: '' });
    await rememberFile(h, MODELS_FILE);
    applyModels(m);
    renderShared();
    toast(`Connected to the shared Models file ${h.name}`);
  } catch (err) { toast(`Couldn't use ${h.name}: ${err.message}`, 'bad'); }
}

async function createSharedModels() {
  const h = await chooseNewModelsFile();
  if (!h) return;
  const text = modelsText(state.models);
  try {
    await writeFile(h, text);
    Object.assign(shared, { handle: h, text, status: 'ok', error: '' });
    await rememberFile(h, MODELS_FILE);
    renderShared();
    toast(`Created ${h.name} from your current list. Coworkers can now connect to it.`);
  } catch (err) { toast(`Couldn't create the file: ${err.message}`, 'bad'); }
}

function disconnectSharedModels() {
  if (!confirm('Stop using the shared Models file on this computer? Your current list stays, but changes will only be saved here.')) return;
  Object.assign(shared, { handle: null, text: '', status: 'off', error: '' });
  rememberFile(null, MODELS_FILE);
  renderShared();
}

// the status box in the Models window and the bar under the tabs
function renderShared() {
  const name = esc(shared.handle?.name || 'models.json');
  const box = $('#sharedModels');
  const msg = {
    unsupported: '<span class="muted">This browser can\'t use a shared Models file, so changes are only saved on this computer. Use Chrome or Edge to share them.</span>',
    off: `<span><b>Not shared:</b> changes are only saved on this computer.</span>
      <span class="actions"><button class="btn small" data-shared="connect">Connect shared file…</button><button class="btn small ghost" data-shared="create">Create shared file…</button></span>
      <span class="hint">The shared file is <code>G:\\My Drive\\Audit Builder\\Models\\models.json</code>. If it doesn't exist yet, create it there.</span>`,
    ok: `<span class="good-text"><b>✓ Shared:</b> using ${name}. Changes are saved to it for everyone.</span>
      <span class="actions"><button class="btn small ghost" data-shared="disconnect">Disconnect</button></span>`,
    'needs-permission': `<span class="warn-text"><b>${name}</b> needs your OK before the app can use it.</span>
      <span class="actions"><button class="btn small primary" data-shared="allow">Load shared Models</button><button class="btn small ghost" data-shared="disconnect">Disconnect</button></span>`,
    missing: `<span class="bad-text">Can't find ${name}. It may have been moved or deleted.</span>
      <span class="actions"><button class="btn small" data-shared="connect">Connect again…</button><button class="btn small ghost" data-shared="disconnect">Disconnect</button></span>`,
    error: `<span class="bad-text">Problem with ${name}: ${esc(shared.error)}</span>
      <span class="actions"><button class="btn small" data-shared="allow">Try again</button><button class="btn small" data-shared="connect">Connect again…</button></span>`,
  }[shared.status];
  if (box) box.innerHTML = msg;

  const bar = $('#sharedBar');
  const showBar = ['needs-permission', 'missing', 'error'].includes(shared.status);
  bar.hidden = !showBar;
  if (showBar) {
    bar.innerHTML = shared.status === 'needs-permission'
      ? `<span>The shared Models list (${name}) needs your OK to load.</span><button class="btn small primary" data-shared="allow">Load shared Models</button>`
      : `<span>The shared Models list (${name}) can't be loaded right now, so this computer's copy is used.</span><button class="btn small" data-shared="open">Open Models</button>`;
  }
  document.querySelectorAll('[data-shared]').forEach(b => b.onclick = () => ({
    connect: connectSharedModels, create: createSharedModels, disconnect: disconnectSharedModels,
    allow: () => loadSharedModels({ ask: true, announce: true }),
    open: () => $('#btnModels').click(),
  })[b.dataset.shared]());
}

function renderModels() {
  const t = MODEL_TABS[state.modelsTab];
  const list = state.models[t.key];
  const val = (item, k) => (k === '_' ? item : item[k]);
  // tabs with a unique column (diagnostic codes): find values used more than once
  const keyOf = item => String(val(item, t.unique) ?? '').trim().toLowerCase();
  const counts = new Map();
  if (t.unique) for (const item of list) { const k = keyOf(item); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
  const isDup = item => t.unique && (counts.get(keyOf(item)) || 0) > 1;
  const dups = [...new Set(list.filter(isDup).map(item => String(val(item, t.unique)).trim()))];

  $('#modelsBody').innerHTML = `
    <nav class="subtabs">${Object.entries(MODEL_TABS).map(([id, x]) => `<button data-mt="${id}" class="${id === state.modelsTab ? 'active' : ''}">${x.label} <span class="muted">${state.models[x.key].length}</span></button>`).join('')}</nav>
    <p class="hint">${esc(t.hint)}</p>
    ${dups.length ? `<div class="banner bad">Used more than once: <b>${esc(dups.join(', '))}</b>. Only the first one counts. Remove or rename the extra rows (highlighted).</div>` : ''}
    <div class="table-wrap tall"><table class="grid">
      <thead><tr><th>#</th>${t.cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th></th></tr></thead>
      <tbody>${list.map((item, i) => `<tr data-i="${i}" class="${isDup(item) ? 'issue-error' : ''}"><th>${i + 1}</th>${t.cols.map(([k]) => `<td contenteditable="plaintext-only" data-k="${k}">${esc(val(item, k))}</td>`).join('')}
        <td class="row-tools"><button class="icon-btn" data-up="${i}" title="Move up">↑</button><button class="icon-btn" data-rm="${i}" title="Remove">✕</button></td></tr>`).join('')}
      </tbody></table></div>
    <button class="btn" id="modelsAdd">Add row</button>`;

  document.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { state.modelsTab = b.dataset.mt; renderModels(); });
  const save = () => { saveModels(); };
  document.querySelectorAll('#modelsBody td[data-k]').forEach(td => {
    td.onblur = () => {
      const i = Number(td.parentElement.dataset.i), k = td.dataset.k, v = td.textContent.trim();
      if (k === t.unique && v !== '') {
        const other = list.findIndex((item, j) => j !== i && keyOf(item) === v.toLowerCase());
        if (other >= 0) {
          // not allowed: put the old value back and point at the existing row
          td.textContent = val(list[i], k) ?? '';
          toast(`${val(list[other], k)} already exists (row ${other + 1}). Each code can only be used once.`, 'bad');
          const tr = document.querySelector(`#modelsBody tr[data-i="${other}"]`);
          tr?.scrollIntoView({ block: 'nearest' });
          tr?.classList.remove('flash'); void tr?.offsetWidth; tr?.classList.add('flash');
          return;
        }
      }
      const num = /^(year|screen|weight)$/.test(k) && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
      const before = val(list[i], k);
      if (k === '_') list[i] = v; else list[i][k] = num;
      save();
      if (k === t.unique && before !== v) renderModels(); // refresh duplicate highlighting
    };
    td.onkeydown = gridKeys;
  });
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { list.splice(Number(b.dataset.rm), 1); save(); renderModels(); });
  document.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.up); if (i < 1) return;
    [list[i - 1], list[i]] = [list[i], list[i - 1]]; save(); renderModels();
  });
  $('#modelsAdd').onclick = () => {
    list.push(t.key === 'cleanupRules' ? '' : Object.fromEntries(t.cols.map(([k]) => [k, ''])));
    save(); renderModels();
    const cells = document.querySelectorAll('#modelsBody tbody tr:last-child td[data-k]');
    cells[0]?.scrollIntoView({ block: 'nearest' }); cells[0]?.focus();
  };
}

// ---------- tabs & top-level actions ----------
function setTab(tab) {
  state.tab = tab; store(STORE_TAB, tab);
  render();
}

async function openProjectFile(file) {
  try {
    let p;
    if (/\.xls[xm]$/i.test(file.name)) { p = await importWorkbook(file); toast(`Imported ${file.name}`); }
    else { p = await readJsonFile(file); toast(`Opened ${file.name}`); }
    state.project = Object.assign(migrate(p), { savedToFile: true });
    state.manualSelected.clear();
    clearHistory();
    store(STORE_PROJECT, state.project);
    recompute(); render();
    if (!settingsComplete(state.project.settings)) openSetup({ force: true });
    else if ($('#setupDialog').open) $('#setupDialog').close();
    return true;
  } catch (err) {
    toast(`Couldn't open ${file.name}: ${err.message}`, 'bad');
    return false;
  }
}

// Save: the first time asks where, after that overwrites the same file. "Save as" always asks.
async function saveProject({ saveAs = false } = {}) {
  const s = state.project.settings;
  const name = `${s.projectNumber || 'project'}.audit.json`;
  const copy = { ...state.project }; delete copy.savedToFile;
  const text = JSON.stringify(copy, null, 1);

  if (!canSaveInPlace) {
    downloadJson(copy, name);
  } else {
    let handle = saveAs ? null : await rememberedFile();
    try {
      if (!handle) {
        handle = await chooseSaveFile(name);
        if (!handle) return; // cancelled
      }
      await writeFile(handle, text);
    } catch (err) {
      if (err.name === 'NotAllowedError') { toast('Not saved: the browser wasn\'t allowed to edit the file. Try again, or use Save as.', 'bad'); return; }
      if (err.name === 'NotFoundError') { // file was moved or deleted: ask again
        handle = await chooseSaveFile(name);
        if (!handle) return;
        await writeFile(handle, text);
      } else { toast(`Not saved: ${err.message}`, 'bad'); return; }
    }
    await rememberFile(handle);
    state.fileName = handle.name;
  }
  state.project.savedToFile = true;
  store(STORE_PROJECT, state.project);
  renderChrome();
  toast(canSaveInPlace ? `Saved to ${state.fileName}` : `Downloaded ${name}`);
}

async function openProject() {
  if (!canSaveInPlace) { $('#openFile').click(); return; }
  let picked;
  try { picked = await chooseOpenFile(); } catch (err) { toast(`Couldn't open: ${err.message}`, 'bad'); return; }
  if (!picked) return;
  const isProjectFile = !/\.xls[xm]$/i.test(picked.file.name);
  if (await openProjectFile(picked.file)) {
    // saving an opened project writes back to it; an imported workbook is saved as a new file
    await rememberFile(isProjectFile ? picked.handle : null);
    state.fileName = isProjectFile ? picked.handle.name : '';
    renderChrome();
  }
}

// ---------- light / dark mode ----------
const STORE_THEME = 'auditApp.theme';
const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches;
function applyTheme(theme) {
  const t = theme || (systemDark() ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  const b = $('#btnTheme');
  const sun = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const moon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  b.innerHTML = t === 'dark' ? sun : moon;
  b.title = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

function init() {
  recompute();
  applyTheme(load(STORE_THEME, null));
  $('#btnTheme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    store(STORE_THEME, next); applyTheme(next);
  };

  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('#projectChip').onclick = () => openSetup();
  $('#btnSave').onclick = () => saveProject();
  $('#btnSaveAs').hidden = !canSaveInPlace;
  $('#btnSaveAs').onclick = () => saveProject({ saveAs: true });
  $('#btnOpen').onclick = openProject;
  $('#openFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); };
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); document.activeElement?.blur?.(); saveProject({ saveAs: e.shiftKey }); }
  });
  rememberedFile().then(h => { state.fileName = h?.name || ''; renderChrome(); });
  $('#btnNew').onclick = () => {
    if (!state.project.savedToFile && !confirm('Start a new project? Changes since you last saved the project file will be lost.')) return;
    state.project = emptyProject();
    clearHistory();
    state.fileName = ''; rememberFile(null);
    store(STORE_PROJECT, state.project);
    recompute(); setTab('data');
    openSetup({ force: true });
  };

  // setup dialog
  const f = $('#setupForm');
  f.oninput = updateSetupPreview;
  f.onsubmit = e => {
    e.preventDefault();
    const s = state.project.settings;
    s.projectNumber = f.projectNumber.value.trim();
    s.prefix = f.prefix.value.trim().toUpperCase();
    s.endClient = f.endClient.value.trim();
    $('#setupDialog').close();
    changed();
  };
  $('#setupCancel').onclick = () => $('#setupDialog').close();
  $('#setupDialog').oncancel = e => { if ($('#setupDialog').dataset.force) e.preventDefault(); };

  // models dialog
  $('#btnModels').onclick = async () => {
    renderModels(); renderShared(); $('#modelsDialog').showModal();
    if (shared.status === 'ok') await loadSharedModels(); // pick up coworkers' latest changes first
  };
  $('#modelsClose').onclick = () => { $('#modelsDialog').close(); render(); };
  $('#modelsExport').onclick = () => downloadJson(state.models, 'models.json');
  $('#modelsImport').onclick = () => $('#modelsFile').click();
  const sharedNote = () => (shared.status === 'ok' ? ' This also changes the shared list for everyone.' : '');
  $('#modelsFile').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const m = await readJsonFile(file);
      if (!isModelsData(m)) throw new Error('not a models file');
      if (!confirm(`Replace the Models list with ${file.name}?${sharedNote()}`)) return;
      state.models = m; renderModels(); await saveModels(); toast('Models imported');
    } catch (err) { toast(`Couldn't import: ${err.message}`, 'bad'); }
  };
  $('#modelsReset').onclick = async () => {
    if (!confirm(`Replace the Models list with the built-in defaults?${sharedNote()}`)) return;
    state.models = structuredClone(defaultModels); renderModels(); await saveModels();
  };

  // shared Models file: reconnect on start, and pick up coworkers' changes when coming back to the app
  if (canSaveInPlace) {
    rememberedFile(MODELS_FILE).then(h => {
      if (h) { shared.handle = h; loadSharedModels(); } else renderShared();
    });
    window.addEventListener('focus', () => {
      if (shared.status === 'ok' && !$('#modelsDialog').open) loadSharedModels({ announce: true });
    });
  } else renderShared();

  window.addEventListener('beforeunload', e => { if (!state.project.savedToFile && settingsComplete(state.project.settings)) e.preventDefault(); });

  render();
  if (!settingsComplete(state.project.settings)) openSetup({ force: true });
}

init();
