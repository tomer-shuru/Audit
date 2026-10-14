// Audit Builder - browser UI
import { buildReport, reportColumns, exportColumns, lockedColumns, MANUAL_FIELDS, EDITABLE, itemCode, itemName, numberingChecks, numberingStart, codeNumber } from '../engine/report.js';
import { DEFAULT_CONFIG, withDefaults } from '../engine/config.js';
import { normalizeBlancco, mergeTables, parseMacLines, parseWindowsLines, sortReportLines, itemKey } from '../engine/sources.js';
import defaultModels from '../data/default-models.json';
import {
  readTableFiles, parsePastedTable, importWorkbook, downloadXlsx, toTsv,
  copyText, downloadJson, readJsonFile,
} from './io.js';
import { readSheetRows } from './merge.js';
import { buildSims, hddRows, simsIssues, splitList, normDiag, SIMS_COLUMNS, SIMS_SHARED, HDD_COLUMNS, simsEditable } from '../engine/sims.js';
import { fillSimsTemplate, downloadBytes, SIMS_TEMPLATE } from './simstemplate.js';
import { parseBiosPasswords, matchBiosPasswords } from '../engine/biospw.js';
import qrcode from 'qrcode-generator';
import { initDevMode, STORE_CONFIG, attachConfigFile, reconnectConfigFile, renderConfigBar } from './devmode.js';
import { grid } from './grid.js';
import {
  canSaveInPlace, rememberedFile, rememberFile, chooseSaveFile, chooseOpenFile, writeFile,
  MODELS_FILE, chooseModelsFile, chooseNewModelsFile, hasPermission, readFileText,
  FOLDER, canUseFolder, chooseFolder, folderFile,
} from './filesave.js';
import { emptyPart, normalizePart, diffShared, patchShared, recordOps, combineParts, combinedInputs } from '../engine/parts.js';
import { PROJECT_JSON, partFileName, projectDirName, projectsDir, projectDir, readJson, writeJson, readParts, listSharedProjects, listProjectFiles } from './sharedfiles.js';

const STORE_PROJECT = 'auditApp.project';
const STORE_MODELS = 'auditApp.models';
const STORE_TAB = 'auditApp.tab';

// ---------- state ----------
const emptyProject = () => ({
  version: 2,
  // output: which sheet layout Review and Export use ('shuru' or 'sims')
  settings: { projectNumber: '', prefix: '', endClient: '', startNumber: 1, output: 'shuru' },
  inputs: { reports: '', blanccoFiles: [], sheet: '', bios: null }, // bios: the Microsoft BIOS password file { fileName, text, at }
  manual: {}, overrides: {},
  simsOverrides: {}, // edits of SIMS-only columns, made in the Review table in SIMS layout
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
  // Mac and Windows reports used to be pasted in two boxes; now they share one
  if ('mac' in inp || 'windows' in inp) {
    inp.reports = [inp.reports, inp.mac, inp.windows].map(t => String(t ?? '').trim()).filter(Boolean).join('\n');
    delete inp.mac; delete inp.windows;
  }
  project.settings = Object.assign(emptyProject().settings, p.settings);
  return project;
}

const load = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const store = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } };

const state = {
  project: migrate(load(STORE_PROJECT, {})),
  models: withNewLists(load(STORE_MODELS, null) || structuredClone(defaultModels)),
  config: withDefaults(load(STORE_CONFIG, null) || DEFAULT_CONFIG), // DevMode rules (the shared config.json)
  tab: ['data', 'manual', 'review'].includes(load(STORE_TAB, 'data')) ? load(STORE_TAB, 'data') : 'review',
  report: null,
  reviewFilter: '', reviewIssuesOnly: false,
  hideEmpty: { review: false, export: false }, // "Hide empty rows" on Review / Export (only hides them from view)
  modelsTab: 'models',
  modelsFilter: {}, // Dictionary filters per tab: { q, category, mapped }
  manualSelected: new Set(),
  collab: null, // a shared project (see "shared projects" below); null for a project on this computer only
};

const settingsComplete = s => s.projectNumber.trim() && s.endClient.trim(); // the prefix may be empty (codes that are just numbers)

const isSims = () => state.project.settings.output === 'sims';
const OUTPUTS = { shuru: 'Shuru', sims: 'SIMS' };
// the Output pickers (top bar, Review, Export window) all change the same project setting
function setOutput(value) {
  if (!OUTPUTS[value] || value === (state.project.settings.output || 'shuru')) return;
  if (!canEditSettings()) { renderChrome(); toast(`Only ${state.collab.owner} can change the output of this shared project`, 'bad'); return; }
  state.project.settings.output = value;
  changed();
  toast(`Output: ${OUTPUTS[value]}. Review and Export now use the ${OUTPUTS[value]} layout.`);
}

function recompute() {
  state.sheet = readSheet();
  const sheet = state.sheet?.records ?? null;
  const project = reportProject();
  state.report = buildReport(project, state.models, state.config, sheet);
  // the SIMS layout is made from the finished report rows; its checks join the report's
  state.sims = isSims() ? buildSims(state.report, project, state.models, state.config, sheet) : null;
  if (state.sims) state.report.warnings.push(...state.sims.warnings);
  if (state.sheet) state.report.warnings.push(...sheetWarnings(state.sheet));
  if (state.collab) state.report.warnings.push(...conflictWarnings());
}

// Rows already in the Google Sheet (Data tab): one more input for the report, the last in line. They are
// read with the columns ticked in the Export window (of the chosen output), the way they get pasted back.
function readSheet() {
  const text = state.project.inputs.sheet;
  if (!text.trim()) return null;
  return readSheetRows({ sheetText: text, cols: exportCols(isSims() ? 'sims' : 'report'), prefix: state.project.settings.prefix, itemPrefix: state.config.texts.itemPrefix });
}
// the rows of the chosen output (Shuru: the Audit Report, SIMS: the SIMS rows)
const outputRows = () => state.sims?.rows ?? state.report.rows;
// columns of the Review table: Item Lookup, then the chosen output's columns
const reviewColumns = () => (isSims() ? [['itemLookup', 'Item Lookup'], ...SIMS_COLUMNS.map(([k, l, name]) => [k, name ?? l])] : reportColumns(state.config));
const isEditable = k => (isSims() ? k !== 'itemLookup' && simsEditable(k) : EDITABLE.has(k));

// all rows of the chosen output, plus an empty row for every item number from the first item number
// (project setup) up to the highest one that has no data, so the list lines up with the sheet
const reportRows = () => withEmptyRows(outputRows());

function withEmptyRows(rows) {
  const settings = state.project.settings;
  const byNumber = new Map(), rest = [];
  for (const row of rows) {
    const key = itemKey(row.itemLookup);
    const n = key ? codeNumber(settings, key) : null;
    if (n === null) rest.push(row);
    else { if (!byNumber.has(n)) byNumber.set(n, []); byNumber.get(n).push(row); }
  }
  if (!byNumber.size) return rows;
  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  const { start } = numberingStart(settings, numbers.map(n => itemKey(itemCode(settings, n))));
  const out = numbers.filter(n => n < start).flatMap(n => byNumber.get(n)); // below the first item number: as they are
  for (let n = start, max = numbers[numbers.length - 1]; n <= max; n++) out.push(...(byNumber.get(n) || [emptyRow(n)]));
  return [...out, ...rest];
}

function emptyRow(n) {
  const code = itemCode(state.project.settings, n);
  return {
    itemLookup: code, item: itemName(state.project.settings, code, state.config),
    _empty: true, _edited: [], _base: {}, _sources: {},
  };
}
function changed({ rerender = true } = {}) {
  state.project.savedToFile = false;
  if (state.collab) recordMine();
  store(STORE_PROJECT, state.project);
  recompute();
  if (rerender) render(); else renderChrome();
}

// ---------- undo / redo for edits in the Review and Manual entries tables ----------
const history = { undo: [], redo: [] };
const snapshot = () => JSON.stringify({ manual: state.project.manual, overrides: state.project.overrides, simsOverrides: state.project.simsOverrides });
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
  const host = document.querySelector('dialog[open]') || document.body; // a modal window would cover it otherwise
  if (t.parentElement !== host) host.appendChild(t);
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}`;
  t.className = `toast show ${kind}`;
  if (action) t.querySelector('button').onclick = () => { t.className = 'toast'; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, action ? 6000 : 2600);
}

// suggest the code after the highest one used so far (GG01 for an empty project)
function nextFreeNumber() {
  const p = state.project.settings;
  const prefix = itemKey(p.prefix);
  let max = 0;
  for (const code of [...Object.keys(state.project.manual), ...state.report.rows.map(r => r.itemLookup)]) {
    const k = itemKey(code);
    if (k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length))) max = Math.max(max, Number(k.slice(prefix.length)));
  }
  const start = Number(p.startNumber);
  return Math.max(max + 1, Number.isInteger(start) && start >= 0 ? start : 1);
}
const nextFreeCode = () => itemCode(state.project.settings, nextFreeNumber());

// ---------- chrome (header + tabs) ----------
function renderChrome() {
  const s = state.project.settings;
  const r = state.report;
  $('#projectChip').innerHTML = settingsComplete(s)
    ? `<b>${esc(s.projectNumber)}</b><span>${esc(s.endClient)}</span><span>${esc(s.prefix || 'no prefix')}</span>`
    : '<b>No project set up</b>';
  const saved = $('#saveState');
  if (state.collab) renderCollabState(saved);
  else {
    saved.className = 'save-state';
    saved.textContent = !state.project.savedToFile ? 'Unsaved changes' : state.fileName ? `Saved · ${state.fileName}` : '';
    saved.classList.toggle('dirty', !state.project.savedToFile);
    saved.title = state.fileName ? `Save (Ctrl+S) writes to ${state.fileName}` : 'Save (Ctrl+S) will ask where to save the project file';
  }
  renderPeopleChip();
  document.querySelectorAll('select[data-output]').forEach(sel => { sel.value = s.output || 'shuru'; });
  // Review shows how many checks there are: red = problems, yellow = warnings, gray = notes
  const levels = { error: 'problem', warn: 'warning', sims: 'SIMS note', info: 'note' };
  const checks = Object.entries(levels).map(([l, word]) => {
    const n = r.warnings.filter(w => w.level === l).length;
    return n ? `<span class="badge ${l}" title="${plural(n, word)}">${n}</span>` : '';
  }).join('');
  const counts = {
    data: r.counts.mac + r.counts.win + r.counts.blancco + (state.sheet?.codes.length || 0) || '',
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
  const views = { data: renderData, manual: renderManual, review: renderReview };
  keepScroll(main, () => views[state.tab](main));
  fitTallTable();
  // the Export window, when open, is redrawn too (keeping its tables' scroll position)
  if ($('#exportDialog').open) {
    const body = $('#exportBody');
    const before = [...body.querySelectorAll('.table-wrap')].map(w => [w.scrollLeft, w.scrollTop]);
    renderExport(body);
    body.querySelectorAll('.table-wrap').forEach((w, i) => { if (before[i]) [w.scrollLeft, w.scrollTop] = before[i]; });
  }
}

// Export (a window opened from Review): if red problems are still open, ask first
function openExport() {
  const errors = state.report.warnings.filter(w => w.level === 'error').length;
  if (errors && !confirm(`${errors === 1 ? '1 problem is' : `${errors} problems are`} still open on Review. Export anyway?`)) return;
  renderExport($('#exportBody'));
  $('#exportDialog').showModal();
}

// The Review table gets the height that fits the window: below what's above it if that leaves enough room,
// otherwise the height at which its whole card (header, table, scrollbar) fits once scrolled to it.
function fitTallTable() {
  const wrap = $('#main .table-wrap.tall');
  if (!wrap) return;
  const card = wrap.closest('.card');
  const around = card.offsetHeight - wrap.offsetHeight; // the card's header, hint and padding
  const gap = 20;
  let h = window.innerHeight - (card.getBoundingClientRect().top + window.scrollY) - around - gap;
  if (h < window.innerHeight * 0.5) h = window.innerHeight - around - 2 * gap;
  wrap.style.maxHeight = `${Math.max(200, Math.floor(h))}px`;
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
  // in a shared project, what the others added is listed too (they change it on their computer)
  const others = otherParts().filter(p => p.inputs.blanccoFiles.length || p.inputs.reports.trim());
  const othersFiles = others.flatMap(p => p.inputs.blanccoFiles.map(f => ({ ...f, by: p.person })));
  const allFiles = [...files, ...othersFiles];
  const merged = normalizeBlancco(mergeTables(allFiles.map(f => f.table)), state.config.blanccoColumns);
  const serials = new Set(merged.rows.map(r => r.serial).filter(Boolean));

  const fileInfo = f => {
    const n = normalizeBlancco(f.table, state.config.blanccoColumns);
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
    ${allFiles.length ? `
      <ul class="file-list">${allFiles.map((f, i) => { const info = fileInfo(f); return `
        <li><span class="file-name">${esc(f.name)}</span>
          <span class="${info.missing.length ? 'bad-text' : 'muted'}">${info.missing.length ? `missing: ${esc(info.missing.join(', '))}` : plural(info.rows, 'row')}</span>
          ${f.by ? `<span class="by" title="Added by ${esc(f.by)} (only they can remove it)">${esc(f.by)}</span>` : `<button class="icon-btn" data-rmfile="${i}" title="Remove this file">✕</button>`}</li>`; }).join('')}
      </ul>
      <div class="status ${merged.missing.length ? 'bad' : 'good'}">
        ${merged.missing.length ? `Missing columns: ${esc(merged.missing.join(', '))} ·` : '✓'}
        ${plural(allFiles.length, 'file')} · ${plural(merged.rows.length, 'disk row')} · ${plural(serials.size, 'device')}
      </div>` : '<p class="empty drop-hint">Drop Blancco files here</p>'}
    <details>
      <summary>…or paste rows instead (copy the cells including the header row)</summary>
      <textarea id="blanccoPaste" rows="4" placeholder="Paste Blancco rows with the header row"></textarea>
    </details>
  </section>

  <section class="card">
    <div class="card-head"><div><h2>Mac and Windows reports</h2>
      <p class="hint">Paste the report lines from both tools here, in any order: one device per line, fields separated by <code>*</code>.
      Each line is recognised by its number of fields (Mac 17, Windows 11).</p></div></div>
    <textarea id="reportsInput" class="mono" rows="12" spellcheck="false" placeholder="GG23*YT26FYC924*5285978*Laptop*Apple*MacBookPro18,3*…&#10;GG17*4V3SHW3*4004343*Notebook*Dell Inc.*Latitude 5431*…">${esc(inp.reports)}</textarea>
    <div class="status" id="reportsStatus">${reportsStatus(inp.reports)}</div>
    ${others.filter(p => p.inputs.reports.trim()).map(p => `
    <details class="others-input">
      <summary><b>${esc(p.person)}'s reports</b> · ${reportsStatus(p.inputs.reports)} <span class="muted">(only ${esc(p.person)} can change them)</span></summary>
      <textarea class="mono" rows="6" readonly>${esc(p.inputs.reports)}</textarea>
    </details>`).join('')}
  </section>

  <section class="card">
    <div class="card-head">
      <div><h2>Rows already in the Google Sheet <span class="muted">optional</span></h2>
      <p class="hint">If some items are already filled in the project's Google Sheet, copy those rows there (from the first item row down past the last filled one,
      same columns as the export) and paste them here. They are used like the other inputs, last in line: Blancco, the Mac and Windows reports and manual entries
      win wherever they have a value, and the sheet fills in what they leave empty (green cells on Review). Review edits and manual entries can change them.${isSims() ? ' This project\'s output is SIMS, so copy them from the SIMS sheet, columns D (Item No) to T (Blancco Result).' : ''}${state.collab ? ' Shared project: everyone sees the same rows here, and the newest paste counts.' : ''} </p></div>
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

  let reportsTimer;
  $('#reportsInput').oninput = e => {
    inp.reports = e.target.value;
    clearTimeout(reportsTimer);
    reportsTimer = setTimeout(() => { changed({ rerender: false }); $('#reportsStatus').innerHTML = reportsStatus(inp.reports); }, 300);
  };
  let sheetTimer;
  $('#sheetInput').oninput = e => {
    inp.sheet = e.target.value;
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(() => { changed({ rerender: false }); $('#sheetStatus').innerHTML = sheetStatus(); }, 300);
  };
  const sheetClear = $('#sheetClear');
  if (sheetClear) sheetClear.onclick = () => { inp.sheet = ''; changed(); };
}

// "24 devices (16 Mac, 8 Windows)"; lines that are neither are listed on the Review tab
function reportsStatus(text) {
  const sorted = sortReportLines(text);
  const mac = parseMacLines(sorted.mac), win = parseWindowsLines(sorted.windows);
  const n = mac.length + win.length, noCode = [...mac, ...win].filter(x => !x.item).length;
  const parts = [`${plural(n, 'device')}${n ? ` (${mac.length} Mac, ${win.length} Windows)` : ''}`];
  if (noCode) parts.push(`<span class="bad-text">${noCode} without item code</span>`);
  if (sorted.unknown.length) parts.push(`<span class="bad-text">${plural(sorted.unknown.length, 'line')} not recognised (see Review)</span>`);
  return parts.join(' · ');
}

function sheetStatus() {
  const m = state.sheet;
  if (!m) return 'Nothing pasted';
  return `${plural(m.codes.length, 'item')} read from the sheet`;
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
        <span class="range-add" title="Add a manual entry for every item number in the range">
          <span class="muted">or items</span>
          <span class="prefix">${esc(state.project.settings.prefix)}</span><input id="rangeFrom" type="number" min="0" value="${nextFreeNumber()}" aria-label="First item number">
          <span class="muted">to</span>
          <span class="prefix">${esc(state.project.settings.prefix)}</span><input id="rangeTo" type="number" min="0" aria-label="Last item number">
          <button class="btn" id="addRange">Add range</button>
        </span>
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

  // add every item number from .. to (items that already have a manual entry are skipped)
  $('#addRange').onclick = () => {
    const from = Number($('#rangeFrom').value), to = Number($('#rangeTo').value || $('#rangeFrom').value);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) { toast('Enter the first and last item number, e.g. 10 to 20', 'bad'); return; }
    if (to - from >= 500) { toast('That\'s more than 500 items. Add a smaller range.', 'bad'); return; }
    const have = new Set(Object.keys(man).map(itemKey));
    const add = [];
    for (let n = from; n <= to; n++) { const code = itemCode(state.project.settings, n); if (!have.has(itemKey(code))) add.push(code); }
    const skipped = to - from + 1 - add.length;
    if (!add.length) { toast('All of these already have a manual entry', 'bad'); return; }
    recordEdit();
    for (const code of add) man[code] = {};
    changed();
    const first = Object.keys(man).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).indexOf(add[0]);
    grid('manual').select(first, 1, { focus: true });
    toast(`Added ${add.length === 1 ? add[0] : `${plural(add.length, 'item')} (${add[0]}–${add[add.length - 1]})`}${skipped ? `, ${skipped} already there` : ''}`);
  };
  for (const id of ['#rangeFrom', '#rangeTo']) $(id).onkeydown = e => { if (e.key === 'Enter') $('#addRange').click(); };
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
    if (!w.item || w.level === 'info' || w.level === 'sims') continue; // notes don't tint rows
    const cur = issues.get(w.item) || { level: 'warn', texts: [] };
    if (w.level === 'error') cur.level = 'error';
    cur.texts.push(w.text);
    issues.set(w.item, cur);
  }
  const issueItems = new Set(issues.keys());
  const REPORT_COLUMNS = reviewColumns();
  const sims = isSims();
  const q = state.reviewFilter.trim().toLowerCase();
  const allRows = reportRows();
  const rows = allRows.filter(row =>
    !(state.hideEmpty.review && row._empty) &&
    (!state.reviewIssuesOnly || issueItems.has(row.itemLookup) || row.locked || row._empty) &&
    (!q || REPORT_COLUMNS.some(([k]) => String(row[k] ?? '').toLowerCase().includes(q))));
  const levelIcon = { error: '✖', warn: '!', sims: 'S', info: 'i' };
  const levelWord = { error: 'problem', warn: 'warning', sims: 'SIMS note', info: 'note' };

  main.innerHTML = `
  ${r.warnings.length ? `
  <section class="card warnings">
    <details ${r.warnings.some(w => w.level === 'error') ? 'open' : ''}>
      <summary><h2>Checks</h2>
        ${['error', 'warn', 'sims', 'info'].map(l => { const n = r.warnings.filter(w => w.level === l).length; return n ? `<span class="pill ${l}">${n} ${levelWord[l]}${n > 1 ? 's' : ''}</span>` : ''; }).join('')}
      </summary>
      <ul>${r.warnings.map(w => `<li class="${w.level}${w.item ? ' link' : ''}" ${w.item ? `data-goto-item="${esc(w.item)}" title="Show ${esc(w.item)} in the table"` : ''}><span class="lvl">${levelIcon[w.level]}</span>${esc(w.text)}</li>`).join('')}</ul>
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
        <thead><tr>${REPORT_COLUMNS.map(([k, l], j) => `<th class="${j === 0 ? 'sticky ' : ''}s${j}" data-hc="${j}">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((row, i) => `
          <tr data-code="${esc(row.itemLookup)}" class="${row._empty ? 'empty-row issue-warn' : issues.has(row.itemLookup) ? 'issue-' + issues.get(row.itemLookup).level : ''}"${row._empty ? ' title="No data yet for this item"' : ''}>
            ${REPORT_COLUMNS.map(([k], j) => {
              if (!isEditable(k)) return `<th class="${j === 0 ? 'sticky ' : ''}s${j}" data-r="${i}" data-c="${j}" ${j === 0 && issues.has(row.itemLookup) ? `title="${esc(issues.get(row.itemLookup).texts.join('\n'))}"` : ''}>${esc(row[k])}${j === 0 ? sourceBadges(row) : ''}</th>`;
              const edited = row._edited.includes(k), sheet = row._fromSheet?.includes(k);
              return `<td data-r="${i}" data-c="${j}" class="${edited ? 'edited' : sheet ? 'from-sheet' : ''}" ${edited ? `title="Edited. Calculated value: ${esc(row._base[k] || '(empty)')}"` : sheet ? 'title="From the Google Sheet rows (Data tab)"' : ''}>${esc(row[k])}</td>`;
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
    $('#hideEmptyReview').onchange = e => { state.hideEmpty.review = e.target.checked; render(); };
    $('#openExport').onclick = openExport;
  }
  const table = main.querySelector('table.review');
  if (table) grid('review').attach(table, {
    rows: rows.length, cols: REPORT_COLUMNS.length,
    value: (r, c) => rows[r][REPORT_COLUMNS[c][0]] ?? '',
    // in SIMS layout, an item with no data yet only takes the columns that are also in the Shuru layout
    editable: (r, c) => isEditable(REPORT_COLUMNS[c][0]) && !(sims && rows[r]._empty && !SIMS_SHARED.has(REPORT_COLUMNS[c][0])),
    commit: changes => {
      recordEdit();
      const man = state.project.manual;
      for (const { r, c, value } of changes) {
        const row = rows[r], code = row.itemLookup, f = REPORT_COLUMNS[c][0];
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
  main.querySelectorAll('[data-goto-item]').forEach(li => li.onclick = () => {
    let tr = main.querySelector(`tr[data-code="${CSS.escape(li.dataset.gotoItem)}"]`);
    if (!tr && (state.reviewFilter || state.reviewIssuesOnly || state.hideEmpty.review)) {
      state.reviewFilter = ''; state.reviewIssuesOnly = false; state.hideEmpty.review = false; render();
      tr = main.querySelector(`tr[data-code="${CSS.escape(li.dataset.gotoItem)}"]`);
    }
    if (!tr) return;
    tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash');
    const first = tr.querySelector('[data-r]');
    if (first) grid('review').select(+first.dataset.r, 0);
  });
}

function sourceBadges(row) {
  const s = row._sources;
  return `<span class="badges">${s.mac ? '<i title="Mac report">M</i>' : ''}${s.win ? '<i title="Windows report">W</i>' : ''}${s.blancco ? '<i title="Blancco export">B</i>' : ''}${s.manual ? '<i title="Manual entry">H</i>' : ''}${s.sheet ? '<i title="Google Sheet rows (Data tab)">G</i>' : ''}</span>`;
}

// ---------- Export window ----------
// Which columns to export is remembered on this computer; which rows is per session (new items start ticked).
// Columns are [key, header in the sheet, name shown here when the header is empty].
const STORE_EXPORT_COLS = 'auditApp.exportHiddenCols';
const EXPORT_SHEETS = {
  report: { title: 'Audit Report', cols: () => exportColumns(state.config), rows: () => reportRows() },
  sims: { title: 'Item per service project', cols: () => SIMS_COLUMNS, rows: () => reportRows() },
  hdd: { title: 'HDD', cols: () => HDD_COLUMNS, rows: () => hddRows(state.report.rows) },
  locked: { title: 'Locked and Faulty', cols: () => lockedColumns(state.config), rows: () => state.report.lockedFaulty },
};
// the sheets of the chosen output; the first one is the main list (with empty rows and the Google Sheet rows)
const exportKinds = () => (isSims() ? ['sims', 'hdd', 'locked'] : ['report', 'locked']);
const isMainSheet = kind => kind === 'report' || kind === 'sims';
const exportPrefs = { hiddenCols: load(STORE_EXPORT_COLS, { report: [], locked: [] }), excludedRows: {}, anchor: {} };
const rowKey = row => row._key ?? row.itemLookup; // HDD rows: one per serial, so several per item

const exportCols = kind => {
  const hidden = new Set(exportPrefs.hiddenCols[kind] || []);
  return EXPORT_SHEETS[kind].cols().filter(([k]) => !hidden.has(k));
};

function exportSelection(kind) {
  const sheet = EXPORT_SHEETS[kind];
  const hidden = new Set(exportPrefs.hiddenCols[kind] || []);
  const excluded = (exportPrefs.excludedRows[kind] ??= new Set());
  const allRows = sheet.rows();
  return {
    sheet, allRows, cols: exportCols(kind),
    rows: allRows.filter(r => !excluded.has(rowKey(r))),
    hidden, excluded,
  };
}

const EXPORT_HINTS = {
  report: () => `Untick rows or columns you don't want, then copy and paste at the ITEM cell of the first item row in the Google Sheet.${state.sheet ? ' Values from the Google Sheet rows (Data tab) are included, so pasting back keeps them.' : ''} Your column choice is remembered.`,
  sims: () => `Columns D (Item No) to T (Blancco Result) of the SIMS sheet: paste at the Item No cell of the first item row.${state.sheet ? ' Values from the sheet rows (Data tab) are included, so pasting back keeps them.' : ''} Your column choice is remembered.`,
  hdd: () => 'One row per data carrier serial (from S.N. Data carrier). Paste under the headers on the HDD tab.',
  locked: () => 'Devices with a lock or fault. Send this list along with the report.',
};
const EXPORT_EMPTY = {
  hdd: 'No data carrier serials (S.N. Data carrier) in this project, so you don\'t need this sheet.',
  locked: 'No locked or faulty devices in this project, so you don\'t need this sheet.',
};

function renderExport(main) {
  const r = state.report;
  const sims = isSims();

  const section = kind => {
    const { sheet, allRows, cols, rows, hidden, excluded } = exportSelection(kind);
    const isMain = isMainSheet(kind);
    if (!isMain && !allRows.length) {
      return `<section class="card"><div class="card-head"><div><h2>${sheet.title} <span class="muted">0 rows</span></h2>
        <p class="hint">${EXPORT_EMPTY[kind]}</p></div></div></section>`;
    }
    const allRowsOn = allRows.every(x => !excluded.has(rowKey(x)));
    // empty rows can be hidden from view, but are always copied (so the rows line up with the sheet)
    const shown = isMain && state.hideEmpty.export ? allRows.filter(x => !x._empty) : allRows;
    return `
    <section class="card" data-sheet="${kind}">
      <div class="card-head">
        <div><h2>${sheet.title} <span class="muted">${rows.length} of ${plural(allRows.length, 'row')} · ${cols.length} of ${sheet.cols().length} columns</span></h2>
        <p class="hint">${EXPORT_HINTS[kind]()}</p></div>
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
        ${isMain ? `<label class="check" title="Only hides them here. Empty rows are still copied, so the rows line up with the sheet."><input type="checkbox" data-hide-empty ${state.hideEmpty.export ? 'checked' : ''}> Hide empty rows</label>` : ''}
        <span class="hint">Tip: tick one row, then hold Shift and click another to tick or untick everything in between.</span>
      </div>
      <div class="table-wrap export">
        <table class="grid pick">
          <thead><tr>
            <th class="sticky pick-col"><input type="checkbox" data-all-rows ${allRowsOn ? 'checked' : ''} title="Select all rows"></th>
            ${sheet.cols().map(([k, l, name]) => `<th class="${hidden.has(k) ? 'off' : ''}"><label class="col-pick"><input type="checkbox" data-col="${k}" ${hidden.has(k) ? '' : 'checked'}>${esc(name ?? l)}</label></th>`).join('')}
          </tr></thead>
          <tbody>${shown.map(row => {
            const off = excluded.has(rowKey(row));
            return `<tr class="${off ? 'off' : ''}${row._empty ? ' empty-row' : ''}">
              <th class="sticky pick-col"><input type="checkbox" data-row="${esc(rowKey(row))}" ${off ? '' : 'checked'} title="${esc(row.itemLookup)}"></th>
              ${sheet.cols().map(([k]) => `<td class="${hidden.has(k) ? 'off' : row._fromSheet?.includes(k) ? 'from-sheet' : ''}">${esc(row[k])}</td>`).join('')}
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
` : '<p class="empty">No items yet.</p>'}
    </section>`;
  };

  main.innerHTML = `
  ${exportKinds().map(section).join('')}
  <section class="card">
    ${sims ? `
    <div class="card-head">
      <div><h2>SIMS Excel file</h2><p class="hint">Fills the SIMS template with the selected rows and columns: Item per service project, HDD and Diagnostic codes (from the Dictionary).
      Their logos, comments and Summary stay as they are; the Summary counts itself when the file is opened.
      The template is <code>${SIMS_TEMPLATE.folder}\\${SIMS_TEMPLATE.file}</code> in the shared Audit Builder folder; when SIMS sends a new one, replace that file.</p></div>
      <div class="actions"><button class="btn primary" id="dlSims" ${r.rows.length ? '' : 'disabled'}>Download SIMS .xlsx</button>
        <button class="btn ghost" id="dlSimsPick" ${r.rows.length ? '' : 'disabled'} title="Fill a template file you choose instead of the shared one">Other template…</button>
        <button class="btn" id="dlLocked" ${r.lockedFaulty.length ? '' : 'disabled'}>Download Locked and Faulty .xlsx</button></div>
    </div>` : `
    <div class="card-head">
      <div><h2>Excel file</h2><p class="hint">Download the selected rows and columns of both sheets as an .xlsx file.</p></div>
      <div class="actions"><button class="btn" id="dlXlsx" ${r.rows.length ? '' : 'disabled'}>Download .xlsx</button></div>
    </div>`}
  </section>`;

  main.querySelectorAll('[data-sheet]').forEach(card => {
    const kind = card.dataset.sheet;
    const { allRows, excluded } = exportSelection(kind);
    const shown = isMainSheet(kind) && state.hideEmpty.export ? allRows.filter(x => !x._empty) : allRows;
    const saveCols = () => store(STORE_EXPORT_COLS, exportPrefs.hiddenCols);
    const hideEmpty = card.querySelector('[data-hide-empty]');
    if (hideEmpty) hideEmpty.onchange = () => { state.hideEmpty.export = hideEmpty.checked; render(); };

    card.querySelectorAll('[data-col]').forEach(cb => cb.onchange = () => {
      const set = new Set(exportPrefs.hiddenCols[kind] || []);
      if (cb.checked) set.delete(cb.dataset.col); else set.add(cb.dataset.col);
      exportPrefs.hiddenCols[kind] = [...set]; saveCols(); recompute(); render();
    });
    // Shift-click: give every row between the last clicked one and this one the same state
    card.querySelectorAll('[data-row]').forEach(cb => cb.onclick = e => {
      const key = cb.dataset.row, on = cb.checked;
      const anchor = exportPrefs.anchor[kind];
      const a = shown.findIndex(x => rowKey(x) === anchor), b = shown.findIndex(x => rowKey(x) === key);
      const range = e.shiftKey && a >= 0 ? shown.slice(Math.min(a, b), Math.max(a, b) + 1) : [shown[b]];
      for (const x of range) { if (on) excluded.delete(rowKey(x)); else excluded.add(rowKey(x)); }
      exportPrefs.anchor[kind] = key;
      render();
    });
    card.querySelectorAll('[data-rows]').forEach(btn => btn.onclick = () => {
      const op = btn.dataset.rows;
      for (const x of allRows) {
        const k = rowKey(x);
        if (op === 'all') excluded.delete(k);
        else if (op === 'none') excluded.add(k);
        else if (excluded.has(k)) excluded.delete(k); else excluded.add(k);
      }
      render();
    });
    const all = card.querySelector('[data-all-rows]');
    if (all) all.indeterminate = excluded.size > 0 && excluded.size < allRows.length;
    if (all) all.onchange = () => { if (all.checked) excluded.clear(); else allRows.forEach(x => excluded.add(rowKey(x))); render(); };
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

  const settings = state.project.settings;
  if (!sims) {
    $('#dlXlsx').onclick = () => {
      const sheets = exportKinds().map(kind => { const s = exportSelection(kind); return { name: s.sheet.title, cols: s.cols, rows: s.rows }; });
      if (!downloadXlsx(sheets, settings)) toast('Nothing selected to export', 'bad');
    };
    return;
  }
  $('#dlSims').onclick = () => downloadSims();
  $('#dlSimsPick').onclick = () => downloadSims({ pick: true });
  $('#dlLocked').onclick = () => {
    const s = exportSelection('locked');
    if (!downloadXlsx([{ name: s.sheet.title, cols: s.cols, rows: s.rows }], settings, 'Locked and Faulty')) toast('Nothing selected to export', 'bad');
  };
}

// the SIMS template: Templates\SIMS.xlsx in the shared folder, or a file the person picks
async function simsTemplate({ pick = false } = {}) {
  if (!pick && folder.handle) {
    if (folder.pending) await useFolder(folder.handle, true);
    if (folder.handle && !folder.pending) {
      const h = await folderFile(folder.handle, SIMS_TEMPLATE.folder, SIMS_TEMPLATE.file);
      if (h) return new Uint8Array(await (await h.getFile()).arrayBuffer());
      toast(`The shared folder has no ${SIMS_TEMPLATE.folder}\\${SIMS_TEMPLATE.file}. Choose the template file.`, 'bad');
    }
  } else if (!pick) {
    toast(`The shared folder isn't connected, so choose the SIMS template file (${SIMS_TEMPLATE.folder}\\${SIMS_TEMPLATE.file}).`);
  }
  const file = await pickFile('.xlsx');
  return file ? new Uint8Array(await file.arrayBuffer()) : null;
}

function pickFile(accept) {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.onchange = () => resolve(input.files[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function downloadSims({ pick = false } = {}) {
  try {
    const bytes = await simsTemplate({ pick });
    if (!bytes) return;
    const items = exportSelection('sims'), hdd = exportSelection('hdd');
    const value = (k, v) => (k === 'weight' && v !== '' && v != null && !Number.isNaN(Number(v)) ? Number(v) : v ?? '');
    const out = fillSimsTemplate(bytes, {
      items: items.rows.map(row => SIMS_COLUMNS.map(([k]) => (items.hidden.has(k) ? '' : value(k, row[k])))),
      hdd: hdd.rows.map(row => HDD_COLUMNS.map(([k]) => (hdd.hidden.has(k) ? '' : row[k]))),
      codes: state.models.simsCodes.map(c => [c.category, c.code, c.description]),
    });
    downloadBytes(out, `${state.project.settings.projectNumber || 'Audit'} - SIMS.xlsx`);
    toast(`Downloaded the SIMS file: ${plural(items.rows.length, 'item')}, ${plural(hdd.rows.length, 'data carrier')}`);
  } catch (err) { toast(`Couldn't fill the SIMS template: ${err.message}`, 'bad'); }
}

// checks for the Google Sheet rows pasted on the Data tab (shown on the Review tab)
function sheetWarnings(m) {
  const settings = state.project.settings;
  const list = codes => (codes.length > 12 ? `${codes.slice(0, 12).join(', ')} and ${codes.length - 12} more` : codes.join(', '));
  const out = [];
  if (!m.codes.length) {
    out.push({ level: 'error', text: `Google Sheet rows (Data tab): no item codes found. Copy them including the ITEM column (codes like ${itemName(settings, itemCode(settings, 1), state.config)}).` });
    return out;
  }
  if (m.duplicates.length) out.push({ level: 'warn', item: m.duplicates[0], text: `Google Sheet rows: ${list(m.duplicates)} more than once. Only the first row of each is used.` });
  if (m.otherRows) out.push({ level: 'warn', text: `Google Sheet rows: ${plural(m.otherRows, 'row')} without an item code left out. Pasting back over the same range will replace ${m.otherRows === 1 ? 'it' : 'them'}.` });
  if (m.headerRows) out.push({ level: 'info', text: `Google Sheet rows: ${plural(m.headerRows, 'row')} above the first item (headers) left out` });
  if (m.lineBreaks) out.push({ level: 'info', text: 'Google Sheet rows: some cells have line breaks; they will be pasted on one line' });
  return out;
}

// ---------- project setup dialog ----------
function openSetup({ force = false } = {}) {
  const d = $('#setupDialog');
  const s = state.project.settings;
  const f = $('#setupForm');
  f.projectNumber.value = s.projectNumber; f.prefix.value = s.prefix; f.endClient.value = s.endClient; f.startNumber.value = s.startNumber ?? 1;
  // a shared project's settings are changed by the person who shared it
  const locked = !canEditSettings();
  for (const el of f.querySelectorAll('input')) el.disabled = locked;
  f.querySelector('[type=submit]').hidden = locked;
  $('#setupLocked').hidden = !locked;
  $('#setupLocked').textContent = locked ? `This is a shared project: only ${state.collab.owner} can change these.` : '';
  $('#setupCancel').textContent = locked ? 'Close' : 'Cancel';
  $('#setupCancel').hidden = force;
  d.dataset.force = force ? '1' : '';
  updateSetupPreview();
  d.showModal();
  f.projectNumber.focus();
}
function updateSetupPreview() {
  const f = $('#setupForm');
  const s = { projectNumber: f.projectNumber.value.trim(), prefix: f.prefix.value.trim().toUpperCase() };
  const n = Number(f.startNumber.value) || 0;
  $('#setupPreview').textContent = `Items: ${itemCode(s, n)}, ${itemCode(s, n + 1)}… → ${itemName({ projectNumber: s.projectNumber || '…' }, itemCode(s, n), state.config)}`;
}

// ---------- models editor ----------
const MODEL_TABS = {
  models: { label: 'Models', key: 'models', hint: 'Mac model IDs (e.g. MacBookPro18,3) and Windows model names, with the details used in the report.',
    cols: [['id', 'Model ID'], ['name', 'Model name'], ['type', 'Type'], ['year', 'Year'], ['screen', 'Screen'], ['weight', 'Weight']] },
  makeMap: { label: 'Make names', key: 'makeMap', hint: 'Turns the make reported by the tools into the name shown in the report, e.g. "Dell Inc." to "Dell". Not case-sensitive.',
    cols: [['from', 'Reported make'], ['to', 'Report make']], unique: 'from' },
  typeMap: { label: 'Type mapping', key: 'typeMap', hint: 'Turns the chassis type reported by the tools (Blancco / Windows) into the type shown in the report.',
    cols: [['blanccoType', 'Reported type'], ['type', 'Report type']] },
  typeWeights: { label: 'Weights', key: 'typeWeights', hint: 'Weight (kg) written in the report for each device type.',
    cols: [['type', 'Type'], ['weight', 'Weight']] },
  cleanupRules: { label: 'Model cleanup', key: 'cleanupRules', hint: 'Text removed from Windows model names, top to bottom. Put longer phrases above shorter ones (e.g. "Notebook PC" before "PC"). Case-sensitive.',
    cols: [['_', 'Remove this text']] },
  diagCodes: { label: 'Diagnostic codes', key: 'diagCodes', hint: 'Type a code (e.g. LM) in any diagnostics field and the report shows the description instead. Case-sensitive.',
    cols: [['code', 'Code'], ['description', 'Description']], unique: 'code' },
  // used only when a project's output is SIMS
  simsDiag: { label: 'SIMS diagnostics', key: 'simsAliases', custom: nav => renderSimsDiag(nav), count: () => state.models.simsAliases.filter(a => String(a.aliases ?? '').trim()).length,
    hint: 'Our diagnostics, as they come out in the report, next to the SIMS issue they mean. Every device gets the code of its category: Notebook LPT107, PC BSU107 … Capitals, extra spaces and dashes don\'t matter; * stands for any word(s), e.g. Key * defect. A diagnostic on two issues gets both codes (BIOS locked: password protected + no audit). Diagnostics written exactly like a SIMS issue (e.g. Fan defect) work without being listed. Diagnostics with no code go to Item Remark, with the category\'s "see remarks" code.' },
  simsCodes: { label: 'SIMS codes', key: 'simsCodes', hint: 'The SIMS diagnostic codes per category (from their template). A code ends in the issue number, which means the same in every category (LPT107 and BSU107 are both keyboard defect). Also written to the Diagnostic codes tab of the SIMS file.',
    cols: [['category', 'Category'], ['code', 'Code'], ['description', 'Description']], unique: 'code', filters: { category: 'category' }, noMove: true },
  simsCategories: { label: 'SIMS categories', key: 'simsCategories', hint: 'Turns our device type into the SIMS Category column. "Codes from" is the category in SIMS codes whose codes the device gets, when it isn\'t the same (Switch uses Network Switch codes, loose disks use Data Carrier codes). Not case-sensitive.',
    cols: [['type', 'Our type'], ['category', 'SIMS category'], ['codes', 'Codes from']], unique: 'type', uniqueText: 'Each type can only be used once.', banner: () => simsCategoriesBanner() },
};

// SIMS categories: rows whose codes aren't in the SIMS codes list, and our types (from Weights) with no SIMS category
function simsCategoriesBanner() {
  const m = state.models, norm = v => String(v ?? '').trim().toLowerCase();
  const codeCats = new Set(m.simsCodes.map(c => norm(c.category)));
  const bad = m.simsCategories.filter(c => norm(c.category) && !codeCats.has(norm(c.codes || c.category))).map(c => c.codes || c.category);
  const types = new Set(m.simsCategories.map(c => norm(c.type)));
  const missing = m.typeWeights.map(t => String(t.type ?? '').trim()).filter(t => t && !types.has(norm(t)) && !codeCats.has(norm(t)));
  return `${bad.length ? `<div class="banner bad">Not a category in SIMS codes: <b>${esc([...new Set(bad)].join(', '))}</b>. Those devices get no codes.</div>` : ''}
    ${missing.length ? `<div class="banner bad">Types in Weights with no SIMS category: <b>${esc(missing.join(', '))}</b>.</div>` : ''}`;
}

// ---------- shared Dictionary file (models.json) ----------
// One models.json in the shared Drive folder. Everyone connects to it once; the app loads it on start
// (and when the window gets focus again) and writes every Dictionary edit back to it.
// status: off | ok | needs-permission | missing | error | unsupported
const shared = { handle: null, status: canSaveInPlace ? 'off' : 'unsupported', text: '', error: '' };

const isModelsData = m => m && ['models', 'typeMap', 'typeWeights', 'cleanupRules', 'diagCodes'].every(k => Array.isArray(m[k]));
// lists added in later versions: a Dictionary saved before them gets the built-in ones
function withNewLists(m) {
  const missing = m ? ['makeMap', 'simsCodes', 'simsAliases', 'simsIgnore', 'simsCategories'].filter(k => !Array.isArray(m[k])) : [];
  return missing.length ? { ...m, ...Object.fromEntries(missing.map(k => [k, structuredClone(defaultModels[k])])) } : m;
}
const modelsText = m => JSON.stringify(m, null, 1);

function applyModels(m) {
  m = withNewLists(m);
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
      const m = withNewLists(JSON.parse(text));
      if (!isModelsData(m)) throw new Error('it isn\'t a Dictionary file');
      shared.text = text;
      if (modelsText(m) !== modelsText(state.models)) {
        applyModels(m);
        if (announce) toast('Loaded the latest shared Dictionary');
      }
    }
    renderShared();
  } catch (err) { sharedFailed(err); }
}

// called after every edit in the Dictionary window
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
      toast('A coworker changed the shared Dictionary just now. Their version is loaded; please redo your last change.', 'bad');
      return;
    }
    await writeFile(shared.handle, text);
    shared.text = text;
  } catch (err) {
    sharedFailed(err);
    toast(`Not saved to the shared Dictionary file: ${err.message}`, 'bad');
  }
}

async function connectSharedModels() {
  const h = await chooseModelsFile();
  if (!h) return;
  try {
    if (!(await hasPermission(h, true))) throw Object.assign(new Error('the browser wasn\'t allowed to use it'), { name: 'NotAllowedError' });
    const text = await readFileText(h);
    const m = JSON.parse(text);
    if (!isModelsData(m)) throw new Error('it isn\'t a Dictionary file');
    Object.assign(shared, { handle: h, text, status: 'ok', error: '' });
    await rememberFile(h, MODELS_FILE);
    applyModels(m);
    renderShared();
    toast(`Connected to the shared Dictionary file ${h.name}`);
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
  if (!confirm('Stop using the shared Dictionary file on this computer? Your current list stays, but changes will only be saved here.')) return;
  Object.assign(shared, { handle: null, text: '', status: 'off', error: '' });
  rememberFile(null, MODELS_FILE);
  forgetFolder(); // or it would connect again on the next start
  renderShared();
}

// ---------- the shared Audit Builder folder ----------
// G:\My Drive\Audit Builder holds both shared files: Models\models.json (Dictionary) and Config\config.json (DevMode rules).
// Browsers only let a page use files the person picked, so the folder is picked once; after that the app finds
// both files in it by itself and reconnects to them every time it opens. After a browser restart the browser
// may want one OK for the folder (one click for both files, none with "Allow on every visit").
const folder = { handle: null, pending: false }; // pending: remembered, but waiting for the browser's OK

// uses the folder: ask=true only from a click (may show the browser's prompt). Returns which files it found, or null.
async function useFolder(dir, ask) {
  const opts = { mode: 'readwrite' };
  let ok = (await dir.queryPermission(opts)) === 'granted';
  if (!ok && ask) ok = (await dir.requestPermission(opts)) === 'granted';
  folder.handle = dir;
  folder.pending = !ok;
  if (!ok) { renderShared(); renderConfigBar(); return null; }
  const models = await folderFile(dir, 'Models', 'models.json');
  const config = await folderFile(dir, 'Config', 'config.json');
  if (models) {
    Object.assign(shared, { handle: models, text: '', status: 'ok', error: '' });
    await rememberFile(models, MODELS_FILE);
    await loadSharedModels({ announce: ask });
  }
  if (config) await attachConfigFile(config, { announce: ask });
  renderShared(); renderConfigBar();
  if (state.collab) collabConnected(); // a shared project that was waiting for the folder
  return { models: !!models, config: !!config };
}

async function connectFolder() {
  const dir = await chooseFolder();
  if (!dir) return;
  try {
    const found = await useFolder(dir, true);
    if (!found) { toast('The browser wasn\'t allowed to use the folder', 'bad'); return; }
    if (!found.models && !found.config) {
      forgetFolder(); renderShared(); renderConfigBar();
      toast(`${dir.name} has no Models\\models.json or Config\\config.json. Choose G:\\My Drive\\Audit Builder.`, 'bad');
      return;
    }
    await rememberFile(dir, FOLDER);
    toast(`Connected to ${dir.name}: shared ${[found.models && 'Dictionary', found.config && 'rules'].filter(Boolean).join(' and ')} loaded`);
  } catch (err) { toast(`Couldn't use the folder: ${err.message}`, 'bad'); }
}

function forgetFolder() {
  Object.assign(folder, { handle: null, pending: false });
  rememberFile(null, FOLDER);
}

// the status box in the Dictionary window and the bar under the tabs
function renderShared() {
  const name = esc(shared.handle?.name || 'models.json');
  const box = $('#sharedModels');
  const msg = {
    unsupported: '<span class="muted">This browser can\'t use a shared Dictionary file, so changes are only saved on this computer. Use Chrome or Edge to share them.</span>',
    off: `<span><b>Not shared:</b> changes are only saved on this computer.</span>
      <span class="actions">${canUseFolder ? '<button class="btn small primary" data-shared="folder">Connect Audit Builder folder…</button>' : ''}<button class="btn small" data-shared="connect">Connect shared file…</button><button class="btn small ghost" data-shared="create">Create shared file…</button></span>
      <span class="hint">Connect the folder <code>G:\\My Drive\\Audit Builder</code> and the app finds the shared Dictionary (and rules) in it by itself.
      The shared file is <code>G:\\My Drive\\Audit Builder\\Models\\models.json</code>. If it doesn't exist yet, create it there.</span>`,
    ok: `<span class="good-text"><b>✓ Shared:</b> using ${name}. Changes are saved to it for everyone.</span>
      <span class="actions"><button class="btn small ghost" data-shared="disconnect">Disconnect</button></span>`,
    'needs-permission': `<span class="warn-text"><b>${name}</b> needs your OK before the app can use it.</span>
      <span class="actions"><button class="btn small primary" data-shared="allow">Load shared Dictionary</button><button class="btn small ghost" data-shared="disconnect">Disconnect</button></span>`,
    missing: `<span class="bad-text">Can't find ${name}. It may have been moved or deleted.</span>
      <span class="actions"><button class="btn small" data-shared="connect">Connect again…</button><button class="btn small ghost" data-shared="disconnect">Disconnect</button></span>`,
    error: `<span class="bad-text">Problem with ${name}: ${esc(shared.error)}</span>
      <span class="actions"><button class="btn small" data-shared="allow">Try again</button><button class="btn small" data-shared="connect">Connect again…</button></span>`,
  }[shared.status];
  if (box) box.innerHTML = msg;

  const bar = $('#sharedBar');
  const showBar = folder.pending || ['needs-permission', 'missing', 'error'].includes(shared.status);
  bar.hidden = !showBar;
  if (folder.pending) {
    // one OK for the whole shared folder loads the Dictionary and the rules
    bar.innerHTML = '<span>The shared Dictionary and rules need your OK to load.</span><button class="btn small primary" data-shared="folderAllow">Load shared files</button>';
  } else if (showBar) {
    bar.innerHTML = shared.status === 'needs-permission'
      ? `<span>The shared Dictionary (${name}) needs your OK to load.</span><button class="btn small primary" data-shared="allow">Load shared Dictionary</button>`
      : `<span>The shared Dictionary (${name}) can't be loaded right now, so this computer's copy is used.</span><button class="btn small" data-shared="open">Open Dictionary</button>`;
  }
  document.querySelectorAll('[data-shared]').forEach(b => b.onclick = () => ({
    connect: connectSharedModels, create: createSharedModels, disconnect: disconnectSharedModels,
    allow: () => loadSharedModels({ ask: true, announce: true }),
    open: () => $('#btnModels').click(),
    folder: connectFolder,
    folderAllow: () => useFolder(folder.handle, true).catch(err => toast(`Couldn't use the folder: ${err.message}`, 'bad')),
  })[b.dataset.shared]());
}

function renderModels() {
  const t = MODEL_TABS[state.modelsTab];
  const nav = `<nav class="subtabs">${Object.entries(MODEL_TABS).map(([id, x]) => `${id === 'simsDiag' ? '<span class="subtab-sep">SIMS output:</span>' : ''}<button data-mt="${id}" class="${id === state.modelsTab ? 'active' : ''}">${x.label} <span class="muted">${x.count ? x.count() : state.models[x.key].length}</span></button>`).join('')}</nav>
    <p class="hint">${esc(t.hint)}</p>`;
  if (t.custom) t.custom(nav); else renderModelList(t, nav);
  document.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { state.modelsTab = b.dataset.mt; renderModels(); });
}

// filters above the big lists (SIMS codes): text search and a category
const modelsFilter = id => (state.modelsFilter[id] ??= { q: '', category: '', mapped: false });
function filterBar(id, { categories, mapped, shown, total }) {
  const f = modelsFilter(id);
  return `<div class="pick-bar filter-bar">
    <input type="search" id="modelsSearch" placeholder="Search…" value="${esc(f.q)}">
    ${categories ? `<select id="modelsCategory"><option value="">All categories</option>${categories.map(c => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
    ${mapped ? `<label class="check"><input type="checkbox" id="modelsMapped" ${f.mapped ? 'checked' : ''}> ${esc(mapped)}</label>` : ''}
    <span class="muted">${shown === total ? plural(total, 'row') : `${shown} of ${plural(total, 'row')} shown`}</span>
  </div>`;
}
function attachFilterBar(id) {
  const f = modelsFilter(id);
  let timer;
  const search = $('#modelsSearch');
  if (search) search.oninput = e => {
    f.q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => { const pos = e.target.selectionStart; renderModels(); const s = $('#modelsSearch'); s.focus(); s.setSelectionRange(pos, pos); }, 150);
  };
  const cat = $('#modelsCategory');
  if (cat) cat.onchange = e => { f.category = e.target.value; renderModels(); };
  const mapped = $('#modelsMapped');
  if (mapped) mapped.onchange = e => { f.mapped = e.target.checked; renderModels(); };
}

function renderModelList(t, nav) {
  const list = state.models[t.key];
  const val = (item, k) => (k === '_' ? item : item[k]);
  // tabs with a unique column (diagnostic codes): find values used more than once
  const keyOf = item => String(val(item, t.unique) ?? '').trim().toLowerCase();
  const counts = new Map();
  if (t.unique) for (const item of list) { const k = keyOf(item); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
  const isDup = item => t.unique && (counts.get(keyOf(item)) || 0) > 1;
  const dups = [...new Set(list.filter(isDup).map(item => String(val(item, t.unique)).trim()))];

  // filtered tabs show only the matching rows (each keeps its place in the list, data-i)
  const f = t.filters ? modelsFilter(state.modelsTab) : null;
  const q = f?.q.trim().toLowerCase() || '';
  const rows = list.map((item, i) => [item, i]).filter(([item]) => !f
    || ((!f.category || String(item[t.filters.category] ?? '').trim() === f.category)
    && (!q || t.cols.some(([k]) => String(val(item, k) ?? '').toLowerCase().includes(q)))));
  const filtering = f && (q || f.category);
  const categories = t.filters?.category ? [...new Set(list.map(x => String(x[t.filters.category] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)) : null;

  $('#modelsBody').innerHTML = `${nav}
    ${t.banner ? t.banner() : ''}
    ${dups.length ? `<div class="banner bad">Used more than once: <b>${esc(dups.join(', '))}</b>. Only the first one counts. Remove or rename the extra rows (highlighted).</div>` : ''}
    ${f ? filterBar(state.modelsTab, { categories, shown: rows.length, total: list.length }) : ''}
    <div class="table-wrap tall"><table class="grid">
      <thead><tr><th>#</th>${t.cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map(([item, i]) => `<tr data-i="${i}" class="${isDup(item) ? 'issue-error' : ''}"><th>${i + 1}</th>${t.cols.map(([k]) => `<td contenteditable="plaintext-only" data-k="${k}">${esc(val(item, k))}</td>`).join('')}
        <td class="row-tools">${t.noMove || filtering ? '' : `<button class="icon-btn" data-up="${i}" title="Move up">↑</button>`}<button class="icon-btn" data-rm="${i}" title="Remove">✕</button></td></tr>`).join('')}
      </tbody></table></div>
    <button class="btn" id="modelsAdd">Add row</button>`;

  if (f) attachFilterBar(state.modelsTab);
  const save = () => { saveModels(); };
  document.querySelectorAll('#modelsBody td[data-k]').forEach(td => {
    td.onblur = () => {
      const i = Number(td.parentElement.dataset.i), k = td.dataset.k, v = td.textContent.trim();
      if (k === t.unique && v !== '') {
        const other = list.findIndex((item, j) => j !== i && keyOf(item) === v.toLowerCase());
        if (other >= 0) {
          // not allowed: put the old value back and point at the existing row
          td.textContent = val(list[i], k) ?? '';
          toast(`${val(list[other], k)} already exists (row ${other + 1}). ${t.uniqueText || 'Each code can only be used once.'}`, 'bad');
          const tr = document.querySelector(`#modelsBody tr[data-i="${other}"]`);
          tr?.scrollIntoView({ block: 'nearest' });
          tr?.classList.remove('flash'); void tr?.offsetWidth; tr?.classList.add('flash');
          return;
        }
      }
      const num = /^(year|screen|weight)$/.test(k) && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
      const before = val(list[i], k);
      if (before === num || (before ?? '') === v) return;
      if (k === '_') list[i] = v; else list[i][k] = num;
      save();
      if ((k === t.unique && before !== v) || t.banner) renderModels(); // refresh duplicate highlighting / warnings
    };
    td.onkeydown = gridKeys;
  });
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { list.splice(Number(b.dataset.rm), 1); save(); renderModels(); });
  document.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.up); if (i < 1) return;
    [list[i - 1], list[i]] = [list[i], list[i - 1]]; save(); renderModels();
  });
  $('#modelsAdd').onclick = () => {
    const row = t.key === 'cleanupRules' ? '' : Object.fromEntries(t.cols.map(([k]) => [k, '']));
    // a new SIMS code starts in the category being looked at
    if (f) { if (f.category) row[t.filters.category] = f.category; f.q = ''; }
    list.push(row);
    save(); renderModels();
    const cells = document.querySelectorAll('#modelsBody tbody tr:last-child td[data-k]');
    const cell = [...cells].find(c => !c.textContent) || cells[0];
    cell?.scrollIntoView({ block: 'nearest' }); cell?.focus();
  };
}

// SIMS diagnostics: one row per SIMS issue (from the SIMS codes), with our diagnostics that mean it.
// The first row lists diagnostics that are left out of the SIMS output altogether (e.g. Ok).
function renderSimsDiag(nav) {
  const m = state.models;
  const issues = simsIssues(m);
  const known = new Set(issues.map(i => i.no));
  const aliasOf = new Map(m.simsAliases.map(a => [String(a.no).trim(), String(a.aliases ?? '')]));
  // our diagnostics on an issue number the SIMS codes don't have (any more)
  const orphans = [...aliasOf].filter(([no, a]) => !known.has(no) && a.trim()).map(([no, aliases]) => ({ no, description: '(not in SIMS codes)', categories: [], aliases, orphan: true }));
  const all = [
    { no: '', description: 'Leave out: no code and nothing in Item Remark', categories: [], aliases: m.simsIgnore.join(', '), ignore: true },
    ...issues.map(i => ({ ...i, aliases: aliasOf.get(i.no) || '' })), ...orphans,
  ];
  const f = modelsFilter('simsDiag');
  const q = f.q.trim().toLowerCase();
  const rows = all.filter(r => r.ignore || ((!f.mapped || r.aliases.trim()) && (!q || [r.no, r.description, r.aliases].some(v => v.toLowerCase().includes(q)))));
  // a diagnostic that is left out but also written on an issue
  const ignored = new Set(m.simsIgnore.flatMap(splitList).map(normDiag));
  const clash = [...new Set(m.simsAliases.flatMap(a => splitList(a.aliases)).filter(d => ignored.has(normDiag(d))))];
  const mappedCount = issues.filter(i => (aliasOf.get(i.no) || '').trim()).length;

  $('#modelsBody').innerHTML = `${nav}
    ${clash.length ? `<div class="banner bad">Written under "Leave out" and on an issue as well: <b>${esc(clash.join(', '))}</b>. "Leave out" wins; remove one of them.</div>` : ''}
    ${orphans.length ? `<div class="banner bad">Our diagnostics on issue numbers that aren't in SIMS codes: <b>${esc(orphans.map(o => o.no).join(', '))}</b>. They give no code; move them to an issue that exists.</div>` : ''}
    ${filterBar('simsDiag', { mapped: 'Only issues with our diagnostics', shown: rows.length - 1, total: all.length - 1 })}
    <div class="table-wrap tall"><table class="grid sims-diag">
      <thead><tr><th>No.</th><th>SIMS issue</th><th>Our diagnostics <span class="muted">(separate with commas)</span></th><th>Categories</th></tr></thead>
      <tbody>${rows.map(r => `<tr data-no="${esc(r.no)}" class="${r.ignore ? 'ignore-row' : r.orphan ? 'issue-error' : ''}">
        <th>${r.ignore ? '—' : esc(r.no)}</th><td class="${r.ignore ? '' : 'muted-cell'}">${esc(r.description)}</td>
        <td contenteditable="plaintext-only" data-aliases>${esc(r.aliases)}</td>
        <td class="muted-cell" title="${esc(r.categories.join(', '))}">${r.ignore ? '' : r.categories.length === 1 ? esc(r.categories[0]) : r.categories.length ? `${r.categories.length} categories` : ''}</td></tr>`).join('')}
      </tbody></table></div>
    <p class="hint">${plural(mappedCount, 'issue')} with our diagnostics. To add a new SIMS code or category, use the SIMS codes tab.</p>`;

  attachFilterBar('simsDiag');
  document.querySelectorAll('#modelsBody td[data-aliases]').forEach(td => {
    td.onblur = () => {
      const no = td.parentElement.dataset.no, list = splitList(td.textContent);
      if (no === '') {
        if (list.join(', ') === m.simsIgnore.join(', ')) return;
        m.simsIgnore = list;
      } else {
        const text = list.join(', ');
        const i = m.simsAliases.findIndex(a => String(a.no).trim() === no);
        if ((i >= 0 ? String(m.simsAliases[i].aliases ?? '') : '') === text) return;
        if (i >= 0 && text) m.simsAliases[i].aliases = text;
        else if (i >= 0) m.simsAliases.splice(i, 1);
        else if (text) m.simsAliases.push({ no, aliases: text });
      }
      td.textContent = list.join(', ');
      saveModels();
      renderModels();
    };
    td.onkeydown = gridKeys;
  });
}

// ---------- menu bar (File, Settings, Tools) ----------
// Click a menu to open it; while one is open, moving over another opens that one (like Windows).
// Esc or a click elsewhere closes it; arrow keys move through the items.
function initMenus() {
  const menus = [...document.querySelectorAll('#menubar .menu')];
  let open = null;
  const show = m => {
    for (const x of menus) {
      x.classList.toggle('open', x === m);
      x.querySelector('.menu-btn').setAttribute('aria-expanded', String(x === m));
    }
    open = m;
  };
  for (const m of menus) {
    const btn = m.querySelector('.menu-btn');
    btn.onclick = () => show(open === m ? null : m);
    btn.onmouseenter = () => { if (open && open !== m) show(m); };
    // an item's own click handler runs, then the menu closes
    m.querySelector('.menu-list').addEventListener('click', e => { if (e.target.closest('button')) show(null); });
    m.addEventListener('keydown', e => {
      const items = [...m.querySelectorAll('.menu-list button:not([hidden])')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); if (open !== m) show(m); items[(i + 1) % items.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (open !== m) show(m); items[(i - 1 + items.length) % items.length]?.focus(); }
      else if (e.key === 'Escape' && open) { show(null); btn.focus(); }
    });
  }
  document.addEventListener('mousedown', e => { if (open && !e.target.closest('#menubar .menu')) show(null); });
}

// ---------- Tools › Microsoft BIOS passwords ----------
// The loaded file is kept in the project (inputs.bios), so it's saved in the project file. In a shared project
// the newest file anyone loaded is used.
const bios = { selected: '', q: '', projectOnly: false, cache: null };

// { fileName, parsed } of the project's password file, or null
function biosFile() {
  const f = reportProject().inputs.bios;
  if (!f?.text) return null;
  if (bios.cache?.text !== f.text) bios.cache = { text: f.text, parsed: parseBiosPasswords(f.text) };
  return { fileName: f.fileName, parsed: bios.cache.parsed };
}

function biosMatch() {
  const settings = state.project.settings;
  const rows = outputRows();
  const order = r => { const k = itemKey(r.itemLookup); return k ? codeNumber(settings, k) : null; };
  return matchBiosPasswords(biosFile().parsed, rows, order);
}
// the list as a sheet: one column per password (most devices have one or two)
function biosSheet(rows) {
  const n = Math.max(1, ...rows.map(r => r.passwords.length));
  const cols = [['item', 'Item'], ['sn', 'S.N.'], ['asset', 'Asset tag'], ['device', 'Device'],
    ...Array.from({ length: n }, (_, i) => [`pw${i}`, n === 1 ? 'Password' : `Password ${i + 1}`])];
  return { cols, rows: rows.map(r => ({ ...r, ...Object.fromEntries(r.passwords.map((p, i) => [`pw${i}`, p])) })) };
}
function biosShown(m) {
  const q = bios.q.trim().toLowerCase();
  return m.rows.filter(r => (!bios.projectOnly || r.inProject)
    && (!q || [r.item, r.asset, r.sn, r.device, ...r.passwords].some(v => String(v).toLowerCase().includes(q))));
}

// a QR code of the text, black on white so scanners read it in dark mode too
function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

function renderBios() {
  const body = $('#biosBody');
  const file = biosFile();
  $('#biosCopy').disabled = $('#biosXlsx').disabled = !file;
  if (!file) {
    body.innerHTML = `<div class="dropzone bios-drop" id="biosDrop"><p><b>Drop the password file here</b>, or click "Load password file…".</p>
      <p class="hint">The BulkBiosPasswordDetails….txt file from Microsoft: one line per password, "AssetNo;Password".</p></div>`;
    attachBiosDrop($('#biosDrop'));
    return;
  }
  const m = biosMatch();
  const rows = biosShown(m);
  if (!rows.some(r => r.key === bios.selected)) bios.selected = rows[0]?.key ?? '';
  const sel = m.rows.find(r => r.key === bios.selected);
  const { cols } = biosSheet(m.rows);
  const p = file.parsed;
  const lockedList = m.lockedWithout.map(r => `${r.itemLookup}${r.asset ? ` (asset ${r.asset})` : ' (no asset tag)'}`);

  body.innerHTML = `
    <div class="bios-summary dropzone" id="biosDrop">
      <b>${esc(file.fileName)}</b>: ${plural(p.count, 'password')} for ${plural(p.assets.length, 'asset tag')}; <b>${m.matched}</b> of them are items in this project.
      ${p.skipped ? `<span class="muted">${plural(p.skipped, 'line')} that weren't "asset;password" were skipped.</span>` : ''}
      <span class="muted">Saved with the project. Drop another file here to replace it.</span>
      <button class="btn small ghost" id="biosRemove" title="Take the passwords out of this project">Remove</button>
    </div>
    ${lockedList.length ? `<div class="banner warn">BIOS locked in this project, but not in the file: <b>${esc(lockedList.join(', '))}</b></div>` : ''}
    <div class="bios-layout">
      <section class="card bios-list">
        <div class="pick-bar">
          <input type="search" id="biosSearch" placeholder="Search item, asset tag, S.N.…" value="${esc(bios.q)}">
          <label class="check"><input type="checkbox" id="biosProjectOnly" ${bios.projectOnly ? 'checked' : ''}> Only devices in this project</label>
          <span class="muted">${rows.length === m.rows.length ? plural(rows.length, 'device') : `${rows.length} of ${plural(m.rows.length, 'device')}`}</span>
          <span class="hint">Click a device or use the arrow keys.</span>
        </div>
        <div class="table-wrap"><table class="grid bios-table" tabindex="0">
          <thead><tr>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r => `<tr data-key="${r.key}" class="${r.key === bios.selected ? 'selected' : ''}${r.inProject ? '' : ' not-in-project'}" ${r.inProject ? '' : 'title="This asset tag isn\'t on any item in this project"'}>
            <th>${esc(r.item || '—')}</th><td>${esc(r.sn)}</td><td>${esc(r.asset)}</td><td>${esc(r.device)}</td>
            ${cols.slice(4).map((c, i) => `<td class="mono">${esc(r.passwords[i] ?? '')}</td>`).join('')}</tr>`).join('')}
          </tbody></table></div>
      </section>
      <aside class="card bios-qr">${sel ? `
        <h2>${esc(sel.item || 'Not in this project')}</h2>
        <p class="hint">Asset tag <b>${esc(sel.asset)}</b>${sel.sn ? ` · S.N. ${esc(sel.sn)}` : ''}${sel.device ? ` · ${esc(sel.device)}` : ''}</p>
        ${sel.passwords.map((pw, i) => `
          <figure class="qr-box">
            ${sel.passwords.length > 1 ? `<div class="muted">Password ${i + 1} of ${sel.passwords.length}</div>` : ''}
            <div class="qr" title="QR code of the password">${qrSvg(pw)}</div>
            <figcaption><code>${esc(pw)}</code><button class="btn small" data-copy-pw="${i}">Copy</button></figcaption>
          </figure>`).join('')}` : '<p class="empty">Select a device.</p>'}
      </aside>
    </div>`;

  attachBiosDrop($('#biosDrop'));
  $('#biosRemove').onclick = () => {
    if (!confirm('Remove the BIOS passwords from this project?' + (state.collab ? '\n\nThey are removed for everyone in the shared project.' : ''))) return;
    setBiosFile(null);
    toast('BIOS passwords removed from the project');
  };
  // redrawing keeps the list where it was scrolled; only the arrow keys scroll it (just enough to show the row)
  const select = (key, byKey = false) => {
    const wrap = () => $('#biosBody .bios-list .table-wrap');
    const top = wrap().scrollTop, left = wrap().scrollLeft;
    bios.selected = key;
    renderBios();
    Object.assign(wrap(), { scrollTop: top, scrollLeft: left });
    const t = $('#biosBody .bios-table');
    t.focus({ preventScroll: true });
    // scroll just enough to show the row below the header, which stays at the top of the list
    const row = byKey && t.querySelector('tr.selected');
    if (row) {
      const w = wrap(), wr = w.getBoundingClientRect(), rr = row.getBoundingClientRect();
      const top = wr.top + w.clientTop + t.tHead.offsetHeight, bottom = wr.top + w.clientTop + w.clientHeight;
      if (rr.top < top) w.scrollTop -= top - rr.top;
      else if (rr.bottom > bottom) w.scrollTop += rr.bottom - bottom;
    }
  };
  body.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => select(tr.dataset.key));
  body.querySelector('.bios-table').onkeydown = e => {
    const i = rows.findIndex(r => r.key === bios.selected);
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    if (rows[next]) select(rows[next].key, true);
  };
  const search = $('#biosSearch');
  search.oninput = e => { bios.q = e.target.value; const pos = e.target.selectionStart; renderBios(); const s = $('#biosSearch'); s.focus(); s.setSelectionRange(pos, pos); };
  // Enter in the search box goes to the list, so the arrow keys work straight away
  search.onkeydown = e => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); $('#biosBody .bios-table').focus(); } };
  $('#biosProjectOnly').onchange = e => { bios.projectOnly = e.target.checked; renderBios(); };
  body.querySelectorAll('[data-copy-pw]').forEach(b => b.onclick = async () => {
    const ok = await copyText(sel.passwords[Number(b.dataset.copyPw)]);
    toast(ok ? 'Password copied' : 'Copy failed. Try again.', ok ? 'ok' : 'bad');
  });
}

function attachBiosDrop(zone) {
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('dragging'); };
  zone.ondragleave = () => zone.classList.remove('dragging');
  zone.ondrop = e => { e.preventDefault(); zone.classList.remove('dragging'); if (e.dataTransfer.files[0]) loadBiosFile(e.dataTransfer.files[0]); };
}

async function loadBiosFile(file) {
  const text = await file.text();
  const parsed = parseBiosPasswords(text);
  if (!parsed.assets.length) { toast(`${file.name} has no "asset;password" lines`, 'bad'); return; }
  Object.assign(bios, { selected: '', q: '' });
  setBiosFile({ fileName: file.name, text });
  const m = biosMatch();
  toast(`Loaded ${plural(parsed.count, 'password')} for ${plural(parsed.assets.length, 'asset tag')}; ${m.matched} found in this project`);
}

// a removed file is kept as { at } (no text), so in a shared project the removal is newer than the file it removes
function setBiosFile(f) {
  state.project.inputs.bios = { ...f, at: Math.max(Date.now(), (reportProject().inputs.bios?.at || 0) + 1) };
  changed();
  if ($('#biosDialog').open) renderBios();
}

function initBios() {
  $('#btnBios').onclick = () => { renderBios(); $('#biosDialog').showModal(); };
  $('#biosClose').onclick = () => $('#biosDialog').close();
  $('#biosLoad').onclick = () => $('#biosFile').click();
  $('#biosFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadBiosFile(f); };
  $('#biosCopy').onclick = async () => {
    const { cols, rows } = biosSheet(biosShown(biosMatch()));
    const ok = await copyText(toTsv(cols, rows, true));
    toast(ok ? `Copied ${plural(rows.length, 'device')}. Paste it into a sheet.` : 'Copy failed. Try again.', ok ? 'ok' : 'bad');
  };
  $('#biosXlsx').onclick = () => {
    const { cols, rows } = biosSheet(biosShown(biosMatch()));
    if (!downloadXlsx([{ name: 'BIOS passwords', cols, rows }], state.project.settings, 'BIOS passwords')) toast('Nothing to download', 'bad');
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
    setCollab(null); // opening a project file leaves a shared project (it stays in the shared folder)
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
  // a shared project saves itself; Save just does it now, Save as saves everyone's work together as a normal project file
  if (state.collab && !saveAs) { await saveMine({ announce: true }); return; }
  const s = state.project.settings;
  // suggested name for a new file: "End client_Project number.audit.json" (characters Windows doesn't allow become -)
  const base = [s.endClient, s.projectNumber].map(v => String(v ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-')).filter(Boolean).join('_');
  const name = `${base || 'project'}.audit.json`;
  const copy = { ...reportProject() }; delete copy.savedToFile;
  if (state.collab) copy.inputs = { ...copy.inputs, blanccoFiles: copy.inputs.blanccoFiles.map(({ by, ...f }) => f) };
  const text = JSON.stringify(copy, null, 1);

  if (state.collab) { // a copy: the shared project stays open
    if (!canSaveInPlace) { downloadJson(copy, name); return; }
    try {
      const handle = await chooseSaveFile(name, await projectsStart());
      if (!handle) return;
      await writeFile(handle, text);
      toast(`Saved a copy of the shared project to ${handle.name}`);
    } catch (err) { toast(`Not saved: ${err.message}`, 'bad'); }
    return;
  }

  if (!canSaveInPlace) {
    downloadJson(copy, name);
  } else {
    let handle = saveAs ? null : await rememberedFile();
    try {
      if (!handle) {
        // a new project goes straight into the Projects folder (when it's connected); Save as always asks
        handle = (!saveAs && await projectFileInFolder(name)) || await chooseSaveFile(name, await projectsStart());
        if (!handle) return; // cancelled
      }
      await writeFile(handle, text);
    } catch (err) {
      if (err.name === 'NotAllowedError') { toast('Not saved: the browser wasn\'t allowed to edit the file. Try again, or use Save as.', 'bad'); return; }
      if (err.name === 'NotFoundError') { // file was moved or deleted: ask again
        handle = await chooseSaveFile(name, await projectsStart());
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

// Browse… in the Open window: the browser's file picker (starting in the Projects folder)
async function browseProject() {
  let picked;
  try { picked = await chooseOpenFile(await projectsStart()); } catch (err) { toast(`Couldn't open: ${err.message}`, 'bad'); return; }
  if (!picked || !okToReplace()) return;
  const isProjectFile = !/\.xls[xm]$/i.test(picked.file.name);
  if (await openProjectFile(picked.file)) {
    $('#collabDialog').close();
    // saving an opened project writes back to it; an imported workbook is saved as a new file
    await rememberFile(isProjectFile ? picked.handle : null);
    state.fileName = isProjectFile ? picked.handle.name : '';
    renderChrome();
  }
}

// ---------- shared projects ----------
// Several people work on one project at the same time (see engine/parts.js). It lives in
// G:\My Drive\Audit Builder\Projects\<End client_Project number>\: everyone's app writes only its own <name>.part.json
// (a moment after each change) and reads the others' every few seconds. state.project is everyone's work together:
// inputs.reports and inputs.blanccoFiles are this person's own (the others' are added in reportProject); manual entries,
// Review edits and the Google Sheet rows are everyone's. Project settings are changed by the person who shared it.
const STORE_PERSON = 'auditApp.person', STORE_DEVICE = 'auditApp.device', STORE_COLLAB = 'auditApp.collab';
const COLLAB_POLL = 15000, SAVE_DELAY = 1500;
const thisDevice = load(STORE_DEVICE, '') || (() => {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  store(STORE_DEVICE, id);
  return id;
})();

const sharedView = p => structuredClone({ manual: p.manual, overrides: p.overrides, simsOverrides: p.simsOverrides, sheet: p.inputs.sheet });
const otherParts = () => (state.collab ? Object.values(state.collab.others).map(o => o.part) : []);
const canEditSettings = () => !state.collab || state.collab.owner === state.collab.me;
const collabRoot = () => (folder.handle && !folder.pending ? folder.handle : null);
const collabUnsaved = () => !!state.collab && (state.collab.dirty || state.collab.writing || state.collab.settingsDirty);
const people = n => (n === 1 ? '1 person' : `${n} people`);

// the project the report is built from: this person's inputs plus everyone else's
function reportProject() {
  if (!state.collab) return state.project;
  const mine = { person: state.collab.me, inputs: state.project.inputs };
  return { ...state.project, inputs: { ...state.project.inputs, ...combinedInputs([mine, ...otherParts()]) } };
}

// state.collab: { dir (the project's folder name), owner, me, mine (this person's part), others ({ file: { part, … } }),
//   base (the shared data as last recorded), stamps, conflicts, settingsText, settingsAt,
//   dirty / settingsDirty (not written yet), writing, reading, error, savedAt, readAt, timer }
function newCollab(c) {
  return {
    others: {}, base: null, stamps: {}, conflicts: [], settingsText: '', settingsAt: 0,
    dirty: false, settingsDirty: false, writing: false, reading: false, error: '', savedAt: 0, readAt: 0, timer: 0,
    ...c,
  };
}
function setCollab(c) {
  if (state.collab) clearTimeout(state.collab.timer);
  state.collab = c;
  persistCollab();
}
// kept on this computer too, so a shared project opens again after a restart (and nothing is lost while offline)
function persistCollab() {
  const c = state.collab;
  store(STORE_COLLAB, c && {
    dir: c.dir, owner: c.owner, me: c.me, mine: c.mine, stamps: c.stamps,
    dirty: c.dirty, settingsDirty: c.settingsDirty, settingsAt: c.settingsAt, settingsText: c.settingsText,
  });
}
function restoreCollab() {
  const s = load(STORE_COLLAB, null);
  if (!s?.dir || !s.mine) return null;
  return newCollab({ ...s, mine: normalizePart(s.mine), stamps: s.stamps || {}, base: sharedView(state.project) });
}

// after every change: what this person changed goes into their part, which is saved a moment later
function recordMine() {
  const c = state.collab;
  const now = sharedView(state.project);
  const ops = diffShared(c.base, now);
  recordOps(c.mine, ops, c.stamps);
  c.base = now;
  // setting a cell again (having seen the other value) settles a clash
  if (ops.length && c.conflicts.length) c.conflicts = combineParts([c.mine, ...otherParts()]).conflicts;
  const inputs = { reports: state.project.inputs.reports, blanccoFiles: state.project.inputs.blanccoFiles, bios: state.project.inputs.bios };
  const inputsChanged = inputs.reports !== c.mine.inputs.reports || JSON.stringify(inputs.blanccoFiles) !== JSON.stringify(c.mine.inputs.blanccoFiles)
    || inputs.bios?.at !== c.mine.inputs.bios?.at;
  c.mine.inputs = { reports: inputs.reports, blanccoFiles: structuredClone(inputs.blanccoFiles), bios: inputs.bios };
  const settings = JSON.stringify(state.project.settings);
  if (settings !== c.settingsText && canEditSettings()) { c.settingsText = settings; c.settingsAt = Date.now(); c.settingsDirty = true; }
  if (ops.length || inputsChanged) c.dirty = true;
  persistCollab();
  if (c.dirty || c.settingsDirty) {
    clearTimeout(c.timer);
    c.timer = setTimeout(() => saveMine(), SAVE_DELAY);
  }
}

async function collabDir(root) {
  const dir = await projectDir(root, state.collab.dir);
  if (!dir) throw Object.assign(new Error(`the folder Projects\\${state.collab.dir} isn't in the shared folder any more`), { name: 'NotFoundError' });
  return dir;
}

// writes this person's part (and the settings, for the person who shared the project)
async function saveMine({ announce = false } = {}) {
  const c = state.collab;
  if (!c) return;
  clearTimeout(c.timer);
  const root = collabRoot();
  if (!root) {
    renderChrome();
    if (announce) toast('Not saved yet: the Audit Builder folder isn\'t connected. Click the status at the top to connect it.', 'bad');
    return;
  }
  if (c.writing) { c.timer = setTimeout(() => saveMine({ announce }), 300); return; } // one write at a time
  const part = c.dirty, settings = c.settingsDirty;
  c.writing = true; c.dirty = false; c.settingsDirty = false;
  renderChrome();
  try {
    const dir = await collabDir(root);
    if (part) { c.mine.updatedAt = Date.now(); await writeJson(dir, partFileName(c.me), c.mine); }
    if (settings) await writeJson(dir, PROJECT_JSON, { version: 1, owner: c.owner, settings: state.project.settings, settingsAt: c.settingsAt });
    c.error = ''; c.savedAt = Date.now();
    if (announce) toast('Saved to the shared project');
  } catch (err) {
    if (part) c.dirty = true;
    if (settings) c.settingsDirty = true;
    c.error = err.message;
    if (announce) toast(`Not saved: ${err.message}`, 'bad');
  } finally {
    c.writing = false;
    if (state.collab === c) { persistCollab(); renderChrome(); }
  }
}

// typing in a box: the page isn't redrawn under the person's hands (it waits until they pause)
let lastTyped = 0;
document.addEventListener('input', () => { lastTyped = Date.now(); }, true);
function isEditing() {
  const a = document.activeElement;
  if (!a || a === document.body) return false;
  if (a.isContentEditable) return true; // a table cell being typed in
  return a.matches('textarea, input') && !a.matches('.grid-sink, [type=checkbox], [type=file], [readonly]') && Date.now() - lastTyped < 4000;
}

// reads the others' parts (and the settings) and brings their changes in
async function refreshCollab() {
  const c = state.collab;
  const root = collabRoot();
  if (!c || !root || c.reading) return;
  c.reading = true;
  try {
    const dir = await collabDir(root);
    let info = null;
    try { info = (await readJson(dir, PROJECT_JSON))?.data; } catch { /* still syncing: next time */ }
    const others = await readParts(dir, c.others, partFileName(c.me));
    c.readAt = Date.now();
    if (c.error.includes('Projects\\')) c.error = '';
    const partsChanged = Object.keys(others).length !== Object.keys(c.others).length || Object.entries(others).some(([k, o]) => c.others[k] !== o);
    const settingsChanged = !!info && !canEditSettings() && (info.settingsAt || 0) !== c.settingsAt;
    if (!partsChanged && !settingsChanged) return;
    if (isEditing()) { setTimeout(() => refreshCollab(), 2500); return; } // read again once they pause
    c.others = others;
    if (settingsChanged) {
      Object.assign(state.project.settings, info.settings);
      c.owner = info.owner || c.owner;
      c.settingsAt = info.settingsAt || 0;
      c.settingsText = JSON.stringify(state.project.settings);
    }
    applyCombined();
  } catch (err) {
    c.error = err.message;
  } finally {
    c.reading = false;
    if (state.collab === c) renderChrome();
  }
  if (c.dirty && !c.writing && state.collab === c) saveMine(); // changes made while it couldn't save
}
const collabConnected = () => refreshCollab();

// everyone's parts together → state.project, keeping the objects the open tables use
function applyCombined() {
  const c = state.collab;
  const { view, stamps, conflicts } = combineParts([c.mine, ...otherParts()]);
  const ops = diffShared(c.base, view);
  patchShared(state.project, ops);
  // undo / redo keep working: the others' changes go into the remembered steps too, so undo only undoes your own
  const rebase = list => list.map(s => JSON.stringify(patchShared(JSON.parse(s), ops)));
  history.undo = rebase(history.undo); history.redo = rebase(history.redo);
  c.base = sharedView(state.project); c.stamps = stamps; c.conflicts = conflicts;
  persistCollab();
  store(STORE_PROJECT, state.project);
  recompute();
  // redraw, keeping the cursor in the box the person was in
  const active = document.activeElement, id = active?.id;
  const sel = id && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  render();
  const again = id && document.getElementById(id);
  if (again && again !== active) { again.focus(); if (sel) try { again.setSelectionRange(...sel); } catch { /* not a text box */ } }
}

// cells two people changed at the same moment: a note on Review (the newest value is used)
function conflictWarnings() {
  const label = (c, f) => {
    const cols = c === 'manual' ? MANUAL_FIELDS : c === 'simsOverrides' ? SIMS_COLUMNS : reportColumns(state.config);
    const col = cols.find(([k]) => k === f);
    return col ? col[2] ?? col[1] : f;
  };
  return state.collab.conflicts.map(x => ({
    level: 'info', item: x.code,
    text: `${x.code} ${label(x.c, x.f)}: ${x.kept.person} and ${x.lost.person} changed it at the same time. ${x.kept.person}'s "${x.kept.v || '(empty)'}" is used (the newest); ${x.lost.person} had "${x.lost.v || '(empty)'}".`,
  }));
}

// the save status at the top, like Google Sheets: Saving… / Saved to Drive / Not saved / Not connected
const SYNC_ICONS = {
  sync: '<svg class="spin" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
  done: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10.5a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 7 18z"/><path d="M9.5 13.5l2 2 3.5-3.5"/></svg>',
  error: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10.5a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 7 18z"/><path d="M12 10v3M12 15.5v.01"/></svg>',
  off: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18h10.5a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 7 18z"/><path d="M4 4l16 16"/></svg>',
  people: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/></svg>',
};
function renderCollabState(el) {
  const c = state.collab;
  const [kind, icon, text, title] =
    !collabRoot() ? ['off', SYNC_ICONS.off, collabUnsaved() ? 'Not connected · changes kept here' : 'Not connected',
      'The Audit Builder folder isn\'t connected, so changes can\'t be shared. Click to connect it.']
    : c.error ? ['bad', SYNC_ICONS.error, 'Not saved', `Couldn't save to the shared project: ${c.error}. Click to try again.`]
    : collabUnsaved() ? ['busy', SYNC_ICONS.sync, 'Saving…', 'Saving your changes to the shared project']
    : ['good', SYNC_ICONS.done, 'Saved to Drive', `All your changes are saved in the shared project${c.savedAt ? ` (at ${new Date(c.savedAt).toLocaleTimeString()})` : ''}. Google Drive sends them on to the others.`];
  el.className = `save-state sync ${kind}`;
  el.innerHTML = `${icon}<span>${text}</span>`;
  el.title = title;
}
function renderPeopleChip() {
  const b = $('#peopleChip');
  b.hidden = !state.collab;
  $('#btnLeaveShared').hidden = !state.collab;
  if (!state.collab) return;
  b.innerHTML = `${SYNC_ICONS.people}<span>Shared · ${people(1 + Object.keys(state.collab.others).length)}</span>`;
  b.title = `Shared project (Projects\\${state.collab.dir}). Click to see who is working on it.`;
}
function clickSaveState() {
  if (!state.collab) return;
  if (!collabRoot()) { collabRootAsk(); return; }
  if (state.collab.error) { saveMine({ announce: true }); refreshCollab(); return; }
  openPeople();
}

const ago = t => {
  if (!t) return 'not yet';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

// connects the shared folder if needed (only from a click: the browser may ask); the folder, or null
async function collabRootAsk() {
  if (!canUseFolder) { toast('Shared projects need Chrome or Edge', 'bad'); return null; }
  if (folder.handle && folder.pending) { try { await useFolder(folder.handle, true); } catch { /* asked below */ } }
  if (!folder.handle) await connectFolder();
  if (!collabRoot()) return null;
  return collabRoot();
}

// asks this person's name once (it names their file in every shared project)
function askName({ again = false } = {}) {
  const known = load(STORE_PERSON, '');
  if (known && !again) return Promise.resolve(known);
  return new Promise(resolve => {
    const d = $('#nameDialog'), f = $('#nameForm');
    f.person.value = again ? '' : known;
    $('#nameAgain').hidden = !again;
    f.onsubmit = e => {
      e.preventDefault();
      const name = f.person.value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/[. ]+$/, '');
      if (!name) return;
      store(STORE_PERSON, name);
      resolve(name);
      d.close();
    };
    $('#nameCancel').onclick = () => d.close();
    d.onclose = () => resolve(null);
    d.showModal();
    f.person.focus();
  });
}

// File › Share project: the open project becomes a shared one, with this person as its owner
async function shareProject() {
  if (state.collab) { openPeople(); return; }
  if (!settingsComplete(state.project.settings)) { openSetup(); toast('Set up the project first', 'bad'); return; }
  const root = await collabRootAsk();
  if (!root) return;
  const me = await askName();
  if (!me) return;
  const name = projectDirName(state.project.settings);
  try {
    const existing = await projectDir(root, name);
    if (existing && await readJson(existing, PROJECT_JSON).catch(() => true)) {
      toast(`${name} is already a shared project. Open it with File › Open.`, 'bad');
      return;
    }
    const dir = await projectDir(root, name, true);
    if (!dir) throw new Error('couldn\'t make the project folder');
    const c = newCollab({ dir: name, owner: me, me, mine: emptyPart(me, thisDevice), base: sharedView(emptyProject()) });
    setCollab(c);
    recordMine(); // everything in the project so far is this person's
    c.dirty = true; // their file is written even while the project is still empty
    clearHistory();
    state.fileName = ''; rememberFile(null);
    await saveMine();
    recompute(); render();
    if (c.error) toast(`Shared, but not saved yet: ${c.error}`, 'bad');
    else toast('Project shared. Coworkers open it with File › Open.');
  } catch (err) { toast(`Couldn't share the project: ${err.message}`, 'bad'); }
}

// File › Open…: the shared projects and the project files in the connected Audit Builder folder (Projects), picked
// in the app. Browse… opens the browser's file picker, for a file somewhere else or an old Audit.xlsm.
async function openProjectList() {
  if (!canSaveInPlace) { $('#openFile').click(); return; }
  // after a browser restart the folder waits for one OK; this click lets the browser ask
  if (folder.handle && folder.pending) { try { await useFolder(folder.handle, true); } catch { /* not connected: shown below */ } }
  const root = collabRoot();
  let sharedList = [], files = [];
  if (root) {
    try { [sharedList, files] = await Promise.all([listSharedProjects(root), listProjectFiles(root)]); }
    catch (err) { toast(`Couldn't read the Projects folder: ${err.message}`, 'bad'); }
  }
  const openNow = !state.collab && state.fileName;
  $('#collabTitle').textContent = 'Open project';
  $('#collabBody').innerHTML = !root ? `
    <div class="shared-box"><span>Connect the Audit Builder folder to pick projects here, or use Browse… to open a file.</span>
      ${canUseFolder ? '<button class="btn small primary" id="openConnect">Connect Audit Builder folder…</button>' : ''}</div>` : `
    <input type="search" id="openSearch" class="open-search" placeholder="Search projects…" aria-label="Search projects">
    <h3>Shared projects <span class="muted">worked on together, saved as you work</span></h3>
    ${sharedList.length ? `<ul class="project-list">${sharedList.map((p, i) => `
      <li><div><b>${esc(p.info.settings?.endClient || p.name)}</b> · ${esc(p.info.settings?.projectNumber || '')}
        <span class="muted">${esc(p.info.settings?.prefix || '')}</span><br>
        <span class="muted">Shared by ${esc(p.info.owner || '?')} · ${esc(p.people.map(x => x.person).join(', ') || 'nobody yet')} · last change ${ago(p.modified)}</span></div>
        ${state.collab?.dir === p.name ? '<span class="muted">Open now</span>' : `<button class="btn primary" data-join="${i}">Open</button>`}</li>`).join('')}
    </ul>` : '<p class="empty">No shared projects yet. Open a project, then choose File › Share project.</p>'}
    <h3>Project files <span class="muted">one person at a time, saved with Save</span></h3>
    ${files.length ? `<ul class="project-list">${files.map((f, i) => `
      <li><div><b>${esc(f.name.replace(/\.audit\.json$/i, ''))}</b><br><span class="muted">saved ${ago(f.modified)}</span></div>
        ${openNow === f.name ? '<span class="muted">Open now</span>' : `<button class="btn primary" data-file="${i}">Open</button>`}</li>`).join('')}
    </ul>` : '<p class="empty">No project files in the Projects folder yet. Save a project and it goes there.</p>'}
    <p class="empty" id="openNoMatch" hidden>No project matches the search.</p>`;
  const body = $('#collabBody');
  body.querySelectorAll('[data-join]').forEach(b => b.onclick = () => joinShared(sharedList[+b.dataset.join]));
  body.querySelectorAll('[data-file]').forEach(b => b.onclick = () => openListedFile(files[+b.dataset.file]));
  const connect = $('#openConnect');
  if (connect) connect.onclick = async () => { await connectFolder(); if (collabRoot()) openProjectList(); };
  const search = $('#openSearch');
  if (search) search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const li of body.querySelectorAll('.project-list li')) { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); shown += !li.hidden; }
    $('#openNoMatch').hidden = !q || shown > 0;
  };
  $('#collabActions').innerHTML = '<button class="btn" id="openBrowse" title="Open a project file from somewhere else, or import an old Audit.xlsm">Browse…</button>';
  $('#openBrowse').onclick = browseProject;
  if (!$('#collabDialog').open) $('#collabDialog').showModal();
  search?.focus();
}

// opening another project: changes to a normal project that aren't saved yet would be lost
const okToReplace = () => state.collab || state.project.savedToFile || !settingsComplete(state.project.settings)
  || confirm('Open another project? Changes to the open project since you last saved it will be lost.');

async function openListedFile(entry) {
  if (!okToReplace()) return;
  try {
    if (await openProjectFile(await entry.handle.getFile())) {
      await rememberFile(entry.handle); // Save writes back to it
      state.fileName = entry.name;
      $('#collabDialog').close();
      renderChrome();
    }
  } catch (err) { toast(`Couldn't open ${entry.name}: ${err.message}`, 'bad'); }
}

// the Projects folder, for the file pickers to start in (null when the Audit Builder folder isn't connected)
async function projectsStart() {
  const root = collabRoot();
  try { return root ? await projectsDir(root, true) : null; } catch { return null; }
}

// a new project's first Save: straight into the Projects folder, without the file picker (null = ask with the picker)
async function projectFileInFolder(name) {
  if (folder.handle && folder.pending) { try { await useFolder(folder.handle, true); } catch { return null; } }
  const dir = await projectsStart();
  if (!dir) return null;
  try {
    const existing = await dir.getFileHandle(name);
    return confirm(`There is already a project file ${name} in the Projects folder. Replace it with this project?\n\nCancel to choose another name.`) ? existing : null;
  } catch (err) {
    if (err.name !== 'NotFoundError') return null;
  }
  return dir.getFileHandle(name, { create: true });
}

async function joinShared(entry, { again = false } = {}) {
  if (!okToReplace()) return;
  const me = await askName({ again });
  if (!me) return;
  try {
    const dir = entry.dir, mineFile = partFileName(me);
    const own = await readJson(dir, mineFile);
    if (own?.data.device && own.data.device !== thisDevice && !confirm(`There is already a "${me}" in this project, saved from another computer.\n\n`
      + 'OK: that\'s me on another computer. My work from there continues here (don\'t keep the project open on both).\n'
      + 'Cancel: that\'s someone else. I\'ll choose a different name.')) {
      return joinShared(entry, { again: true });
    }
    const mine = own ? normalizePart(own.data) : emptyPart(me, thisDevice);
    mine.person = me; mine.device = thisDevice;
    const others = await readParts(dir, {}, mineFile);
    const { view, stamps, conflicts } = combineParts([mine, ...Object.values(others).map(o => o.part)]);
    const info = (await readJson(dir, PROJECT_JSON))?.data || entry.info;
    setCollab(null);
    state.project = Object.assign(migrate({
      settings: info.settings || {},
      inputs: { reports: mine.inputs.reports, blanccoFiles: mine.inputs.blanccoFiles, sheet: view.sheet, bios: mine.inputs.bios },
      manual: view.manual, overrides: view.overrides, simsOverrides: view.simsOverrides,
    }), { savedToFile: true });
    setCollab(newCollab({
      dir: entry.name, owner: info.owner, me, mine, others, stamps, conflicts,
      base: sharedView(state.project), settingsAt: info.settingsAt || 0, settingsText: JSON.stringify(state.project.settings),
      dirty: !own, // someone new: their (empty) file is written straight away, so the others see them
    }));
    state.manualSelected.clear();
    clearHistory();
    state.fileName = ''; rememberFile(null);
    store(STORE_PROJECT, state.project);
    $('#collabDialog').close();
    recompute(); render();
    if (state.collab.dirty) saveMine();
    const names = Object.values(others).map(o => o.part.person);
    toast(`Opened ${entry.name}${names.length ? `, shared with ${names.join(', ')}` : ''}`);
  } catch (err) { toast(`Couldn't open the shared project: ${err.message}`, 'bad'); }
}

// who works on the shared project, and what each has added
function openPeople() {
  const c = state.collab;
  if (!c) return;
  const count = p => {
    const sorted = sortReportLines(p.inputs.reports || '');
    const devices = parseMacLines(sorted.mac).length + parseWindowsLines(sorted.windows).length;
    const manual = Object.values(p.items || {}).filter(x => !x.deleted).length;
    const edits = ['overrides', 'simsOverrides'].reduce((n, k) => n + Object.values(p.cells[k] || {}).reduce((m, r) => m + Object.keys(r).length, 0), 0);
    return [devices && plural(devices, 'device') + ' in reports', p.inputs.blanccoFiles.length && plural(p.inputs.blanccoFiles.length, 'Blancco file'),
      manual && plural(manual, 'manual entry').replace('entrys', 'entries'), edits && plural(edits, 'Review edit')].filter(Boolean).join(' · ') || 'nothing yet';
  };
  const rows = [[c.mine, true], ...otherParts().map(p => [p, false])];
  $('#collabTitle').textContent = 'Shared project';
  $('#collabBody').innerHTML = `
    <p class="hint">Saved in <code>G:\\My Drive\\Audit Builder\\Projects\\${esc(c.dir)}</code>. Everyone's changes come in every few seconds
      (once Google Drive has synced them). Only ${esc(c.owner)} can change the project settings.</p>
    <ul class="project-list">${rows.map(([p, you]) => `
      <li><div><b>${esc(p.person)}</b>${you ? ' <span class="muted">(you)</span>' : ''}${p.person === c.owner ? ' <span class="pill info">shared it</span>' : ''}<br>
        <span class="muted">${count(p)}</span></div>
        <span class="muted">${you ? (collabUnsaved() ? 'saving…' : `saved ${ago(c.savedAt || p.updatedAt)}`) : `saved ${ago(p.updatedAt)}`}</span></li>`).join('')}
    </ul>
    <p class="hint">${c.readAt ? `Checked for changes ${ago(c.readAt)}.` : ''}</p>`;
  $('#collabActions').innerHTML = '<button class="btn" id="collabRefresh">Refresh now</button><button class="btn ghost" id="collabLeave">Leave shared project…</button>';
  $('#collabRefresh').onclick = async () => { await refreshCollab(); openPeople(); toast('Up to date'); };
  $('#collabLeave').onclick = () => { $('#collabDialog').close(); leaveCollab(); };
  if (!$('#collabDialog').open) $('#collabDialog').showModal();
}

// File › Leave shared project: this computer goes back to a normal project (a copy of everyone's work together)
async function leaveCollab() {
  const c = state.collab;
  if (!c) return;
  if (!confirm('Leave the shared project on this computer?\n\nYour work stays in the shared project for the others, and you can open it again with File › Open. '
    + 'This computer keeps a copy of everyone\'s work together as a normal project (Save to keep it as a file).')) return;
  if (collabUnsaved()) await saveMine();
  const copy = reportProject();
  copy.inputs = { ...copy.inputs, blanccoFiles: copy.inputs.blanccoFiles.map(({ by, ...f }) => f) };
  setCollab(null);
  state.project = { ...copy, savedToFile: false };
  clearHistory();
  store(STORE_PROJECT, state.project);
  recompute(); render();
  toast('Left the shared project. This is now a normal project on this computer.');
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
  state.collab = restoreCollab();
  recompute();
  applyTheme(load(STORE_THEME, null));
  $('#btnTheme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    store(STORE_THEME, next); applyTheme(next);
  };

  initMenus();
  initBios();
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('#projectChip').onclick = () => openSetup();
  document.addEventListener('change', e => { if (e.target.matches?.('select[data-output]')) setOutput(e.target.value); });
  $('#btnSave').onclick = () => saveProject();
  $('#btnSaveAs').hidden = !canSaveInPlace;
  $('#btnSaveAs').onclick = () => saveProject({ saveAs: true });
  $('#btnOpen').onclick = openProjectList;
  $('#btnShare').onclick = shareProject;
  $('#btnLeaveShared').onclick = leaveCollab;
  $('#btnLeaveShared').hidden = !state.collab;
  $('#btnShare').hidden = !canUseFolder;
  $('#saveState').onclick = clickSaveState;
  $('#peopleChip').onclick = openPeople;
  $('#collabClose').onclick = () => $('#collabDialog').close();
  $('#openFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); };
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); document.activeElement?.blur?.(); saveProject({ saveAs: e.shiftKey }); }
  });
  rememberedFile().then(h => { state.fileName = h?.name || ''; renderChrome(); });
  $('#btnNew').onclick = () => {
    if (state.collab) {
      if (!confirm('Start a new project? The shared project stays in the shared folder; open it again with File › Open.')) return;
      setCollab(null);
    } else if (!state.project.savedToFile && !confirm('Start a new project? Changes since you last saved the project file will be lost.')) return;
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
    s.startNumber = Number(f.startNumber.value) || 0;
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
  $('#exportClose').onclick = () => $('#exportDialog').close();
  $('#modelsExport').onclick = () => downloadJson(state.models, 'models.json');
  $('#modelsImport').onclick = () => $('#modelsFile').click();
  const sharedNote = () => (shared.status === 'ok' ? ' This also changes the shared list for everyone.' : '');
  $('#modelsFile').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const m = await readJsonFile(file);
      if (!isModelsData(m)) throw new Error('not a Dictionary file');
      if (!confirm(`Replace the Dictionary with ${file.name}?${sharedNote()}`)) return;
      state.models = withNewLists(m); renderModels(); await saveModels(); toast('Dictionary imported');
    } catch (err) { toast(`Couldn't import: ${err.message}`, 'bad'); }
  };
  $('#modelsReset').onclick = async () => {
    if (!confirm(`Replace the Dictionary with the built-in defaults?${sharedNote()}`)) return;
    state.models = structuredClone(defaultModels); renderModels(); await saveModels();
  };

  // DevMode: the rules in the shared config.json, behind a password
  initDevMode({
    state, toast, esc, downloadJson, readJsonFile,
    applyConfig: cfg => { state.config = withDefaults(cfg); store(STORE_CONFIG, state.config); recompute(); render(); },
    folder: () => ({ connected: !!folder.handle && !folder.pending, pending: folder.pending }),
    connectFolder: () => (canUseFolder ? connectFolder() : toast('This browser can\'t connect a folder. Use Chrome or Edge.', 'bad')),
    forgetFolder,
  });

  // shared files: reconnect on start (through the shared folder, or the files connected one by one before),
  // and pick up coworkers' changes when coming back to the app
  if (canSaveInPlace) {
    (async () => {
      const dir = canUseFolder ? await rememberedFile(FOLDER) : null;
      if (dir) {
        try { await useFolder(dir, false); return; } catch { forgetFolder(); }
      }
      const h = await rememberedFile(MODELS_FILE);
      if (h) { shared.handle = h; loadSharedModels(); } else renderShared();
      reconnectConfigFile();
    })();
    window.addEventListener('focus', () => {
      if (shared.status === 'ok' && !$('#modelsDialog').open) loadSharedModels({ announce: true });
      refreshCollab();
    });
    // a shared project: read the others' changes every few seconds while the app is in view
    setInterval(() => { if (document.visibilityState === 'visible') refreshCollab(); }, COLLAB_POLL);
  } else { renderShared(); reconnectConfigFile(); }

  window.addEventListener('resize', fitTallTable);
  document.addEventListener('toggle', e => { if (e.target.closest?.('.warnings')) fitTallTable(); }, true); // Checks opened / closed
  window.addEventListener('beforeunload', e => {
    const unsaved = state.collab ? collabUnsaved() : !state.project.savedToFile;
    if (unsaved && settingsComplete(state.project.settings)) e.preventDefault();
  });

  render();
  if (!settingsComplete(state.project.settings)) openSetup({ force: true });
}

init();
