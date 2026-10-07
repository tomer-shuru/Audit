// Audit Builder - browser UI
import { buildReport, REPORT_COLUMNS, EXPORT_COLUMNS, LOCKED_COLUMNS, MANUAL_FIELDS, EDITABLE, itemCode } from '../engine/report.js';
import { normalizeBlancco, mergeTables, parseMacLines, parseWindowsLines, itemKey } from '../engine/sources.js';
import defaultModels from '../data/default-models.json';
import {
  readTableFiles, parsePastedTable, importWorkbook, downloadXlsx, toTsv,
  copyText, downloadJson, readJsonFile,
} from './io.js';
import { canSaveInPlace, rememberedFile, rememberFile, chooseSaveFile, chooseOpenFile, writeFile } from './filesave.js';

const STORE_PROJECT = 'auditApp.project';
const STORE_MODELS = 'auditApp.models';
const STORE_TAB = 'auditApp.tab';

// ---------- state ----------
const emptyProject = () => ({
  version: 2,
  settings: { projectNumber: '', prefix: '', endClient: '' },
  inputs: { mac: '', windows: '', blanccoFiles: [] },
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

const settingsComplete = s => s.projectNumber.trim() && s.prefix.trim() && s.endClient.trim();

function recompute() {
  state.report = buildReport(state.project, state.models);
}
function changed({ rerender = true } = {}) {
  state.project.savedToFile = false;
  store(STORE_PROJECT, state.project);
  recompute();
  if (rerender) render(); else renderChrome();
}

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
    ? `<b>${esc(s.projectNumber)}</b><span>${esc(s.endClient)}</span><span>${esc(s.prefix)}</span>`
    : '<b>No project set up</b>';
  const saved = $('#saveState');
  saved.textContent = !state.project.savedToFile ? 'Unsaved changes' : state.fileName ? `Saved · ${state.fileName}` : '';
  saved.classList.toggle('dirty', !state.project.savedToFile);
  saved.title = state.fileName ? `Save (Ctrl+S) writes to ${state.fileName}` : 'Save (Ctrl+S) will ask where to save the project file';
  const errors = r.warnings.filter(w => w.level === 'error').length;
  const counts = {
    data: r.counts.mac + r.counts.win + r.counts.blancco || '',
    manual: r.counts.manual || '',
    review: r.rows.length || '',
    export: errors ? `${errors} !` : '',
  };
  document.querySelectorAll('#tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === state.tab);
    b.querySelector('.count').textContent = counts[b.dataset.tab] ?? '';
    b.querySelector('.count').classList.toggle('bad', b.dataset.tab === 'export' && errors > 0);
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
  </div>`;

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
  bindLines('#winInput', 'windows', '#winStatus', parseWindowsLines);
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
        <thead><tr><th class="sticky item-col"><label class="row-pick"><input type="checkbox" id="selAll" ${allSelected ? 'checked' : ''} title="Select all"></label>Item</th>${MANUAL_FIELDS.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${codes.map(code => `
          <tr data-code="${esc(code)}" class="${sel.has(code) ? 'selected' : ''}">
            <th class="sticky item-col">
              <label class="row-pick"><input type="checkbox" data-sel="${esc(code)}" ${sel.has(code) ? 'checked' : ''} title="Select ${esc(code)}"></label>
              <button class="icon-btn" data-del="${esc(code)}" title="Delete ${esc(code)}">✕</button>
              ${esc(code)}
            </th>
            ${MANUAL_FIELDS.map(([f]) => `<td contenteditable="plaintext-only" data-field="${f}">${esc(man[code][f] ?? '')}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<p class="empty">No manual entries yet. Add an item for every device you have to fill in by hand.</p>'}
  </section>`;

  // deleting is instant; the toast offers Undo
  const remove = list => {
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
    man[code] = {};
    changed();
    const cell = document.querySelector(`tr[data-code="${CSS.escape(code)}"] td[data-field="sn"]`);
    cell?.scrollIntoView({ block: 'nearest' }); cell?.focus();
  };
  $('#newCode').onkeydown = e => { if (e.key === 'Enter') $('#addManual').click(); };
  main.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove([b.dataset.del]));
  main.querySelectorAll('td[data-field]').forEach(td => {
    td.onblur = () => {
      const code = td.parentElement.dataset.code, f = td.dataset.field;
      const v = td.textContent.trim();
      if ((man[code][f] ?? '') === v) return;
      if (v) man[code][f] = v; else delete man[code][f];
      changed({ rerender: false });
    };
    td.onkeydown = gridKeys;
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
  const rows = r.rows.filter(row =>
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
      <div><h2>Audit Report</h2><p class="hint">Click a cell to change it. Edited cells are highlighted; clear a cell to go back to the calculated value.</p></div>
      <div class="actions">
        <input type="search" id="reviewSearch" placeholder="Search…" value="${esc(state.reviewFilter)}">
        <label class="check"><input type="checkbox" id="issuesOnly" ${state.reviewIssuesOnly ? 'checked' : ''}> Only items with issues</label>
      </div>
    </div>
    ${r.rows.length ? `
    <div class="table-wrap tall">
      <table class="grid review">
        <thead><tr>${REPORT_COLUMNS.map(([k, l], j) => `<th class="${j < 2 ? 'sticky s' + j : ''}">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `
          <tr data-code="${esc(row.itemLookup)}" class="${issues.has(row.itemLookup) ? 'issue-' + issues.get(row.itemLookup).level : ''}">
            ${REPORT_COLUMNS.map(([k], j) => {
              if (!EDITABLE.has(k)) return `<th class="sticky s${j}" ${j === 0 && issues.has(row.itemLookup) ? `title="${esc(issues.get(row.itemLookup).texts.join('\n'))}"` : ''}>${esc(row[k])}${j === 0 ? sourceBadges(row) : ''}</th>`;
              const edited = row._edited.includes(k);
              return `<td contenteditable="plaintext-only" data-field="${k}" class="${edited ? 'edited' : ''}" ${edited ? `title="Edited. Calculated value: ${esc(row._base[k] || '(empty)')}"` : ''}>${esc(row[k])}</td>`;
            }).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="hint">${rows.length} of ${plural(r.rows.length, 'item')} shown</p>` : '<p class="empty">Nothing to show yet. Add data on the Data tab or a manual entry.</p>'}
  </section>`;

  const search = $('#reviewSearch');
  if (search) {
    search.oninput = e => { state.reviewFilter = e.target.value; const pos = e.target.selectionStart; render(); const s = $('#reviewSearch'); s.focus(); s.setSelectionRange(pos, pos); };
    $('#issuesOnly').onchange = e => { state.reviewIssuesOnly = e.target.checked; render(); };
  }
  main.querySelectorAll('td[data-field]').forEach(td => {
    td.onblur = () => {
      const code = td.parentElement.dataset.code, f = td.dataset.field;
      const row = state.report.rows.find(x => x.itemLookup === code);
      const base = String(row._edited.includes(f) ? row._base[f] ?? '' : row[f] ?? '');
      const v = td.textContent.trim();
      const ov = state.project.overrides;
      const current = ov[code]?.[f] ?? '';
      const next = v === base ? '' : v;   // typing the calculated value back removes the edit
      if (next === current) { if (!v) td.textContent = base; return; }
      ov[code] = ov[code] || {};
      if (next) ov[code][f] = next; else delete ov[code][f];
      if (!Object.keys(ov[code]).length) delete ov[code];
      changed({ rerender: false });
      // redraw after focus has moved on (Enter / Tab / click), then put focus back on that cell
      setTimeout(() => {
        const a = document.activeElement;
        const target = a?.dataset?.field ? [a.parentElement.dataset.code, a.dataset.field] : null;
        render();
        if (target) main.querySelector(`tr[data-code="${CSS.escape(target[0])}"] td[data-field="${target[1]}"]`)?.focus();
      });
    };
    td.onkeydown = gridKeys;
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
  });
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

function exportSelection(kind) {
  const sheet = EXPORT_SHEETS[kind];
  const hidden = new Set(exportPrefs.hiddenCols[kind] || []);
  const excluded = exportPrefs.excludedRows[kind];
  const allRows = sheet.rows(state.report);
  return {
    sheet, allRows,
    cols: sheet.cols.filter(([k]) => !hidden.has(k)),
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
        <p class="hint">${kind === 'report' ? 'Untick rows or columns you don\'t want, then copy and paste into the Google Sheet. Your column choice is remembered.' : 'Devices with a lock or fault. Send this list along with the report.'}</p></div>
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
            return `<tr class="${off ? 'off' : ''}">
              <th class="sticky pick-col"><input type="checkbox" data-row="${esc(row.itemLookup)}" ${off ? '' : 'checked'} title="${esc(row.itemLookup)}"></th>
              ${sheet.cols.map(([k]) => `<td class="${hidden.has(k) ? 'off' : ''}">${esc(row[k])}</td>`).join('')}
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>` : '<p class="empty">No items yet.</p>'}
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
      exportPrefs.hiddenCols[kind] = [...set]; saveCols(); render();
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
    if (allCols) allCols.onclick = () => { exportPrefs.hiddenCols[kind] = []; saveCols(); render(); };

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
  $('#setupPreview').textContent = s.prefix ? `Items: ${itemCode(s, 1)}, ${itemCode(s, 2)}… → ITD-${s.projectNumber || '…'}-${itemCode(s, 1)}` : '';
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
    cols: [['code', 'Code'], ['description', 'Description']] },
};

function renderModels() {
  const t = MODEL_TABS[state.modelsTab];
  const list = state.models[t.key];
  const val = (item, k) => (k === '_' ? item : item[k]);
  $('#modelsBody').innerHTML = `
    <nav class="subtabs">${Object.entries(MODEL_TABS).map(([id, x]) => `<button data-mt="${id}" class="${id === state.modelsTab ? 'active' : ''}">${x.label} <span class="muted">${state.models[x.key].length}</span></button>`).join('')}</nav>
    <p class="hint">${esc(t.hint)}</p>
    <div class="table-wrap tall"><table class="grid">
      <thead><tr><th>#</th>${t.cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th></th></tr></thead>
      <tbody>${list.map((item, i) => `<tr data-i="${i}"><th>${i + 1}</th>${t.cols.map(([k]) => `<td contenteditable="plaintext-only" data-k="${k}">${esc(val(item, k))}</td>`).join('')}
        <td class="row-tools"><button class="icon-btn" data-up="${i}" title="Move up">↑</button><button class="icon-btn" data-rm="${i}" title="Remove">✕</button></td></tr>`).join('')}
      </tbody></table></div>
    <button class="btn" id="modelsAdd">Add row</button>`;

  document.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { state.modelsTab = b.dataset.mt; renderModels(); });
  const save = () => { store(STORE_MODELS, state.models); recompute(); renderChrome(); };
  document.querySelectorAll('#modelsBody td[data-k]').forEach(td => {
    td.onblur = () => {
      const i = Number(td.parentElement.dataset.i), k = td.dataset.k, v = td.textContent.trim();
      const num = /^(year|screen|weight)$/.test(k) && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
      if (k === '_') list[i] = v; else list[i][k] = num;
      save();
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
  $('#btnModels').onclick = () => { renderModels(); $('#modelsDialog').showModal(); };
  $('#modelsClose').onclick = () => { $('#modelsDialog').close(); render(); };
  $('#modelsExport').onclick = () => downloadJson(state.models, 'models.json');
  $('#modelsImport').onclick = () => $('#modelsFile').click();
  $('#modelsFile').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const m = await readJsonFile(file);
      if (!Array.isArray(m.models) || !Array.isArray(m.diagCodes)) throw new Error('not a models file');
      state.models = m; store(STORE_MODELS, m); recompute(); renderModels(); toast('Models imported');
    } catch (err) { toast(`Couldn't import: ${err.message}`, 'bad'); }
  };
  $('#modelsReset').onclick = () => {
    if (!confirm('Replace your Models data with the built-in defaults?')) return;
    state.models = structuredClone(defaultModels); store(STORE_MODELS, state.models); recompute(); renderModels();
  };

  window.addEventListener('beforeunload', e => { if (!state.project.savedToFile && settingsComplete(state.project.settings)) e.preventDefault(); });

  render();
  if (!settingsComplete(state.project.settings)) openSetup({ force: true });
}

init();
