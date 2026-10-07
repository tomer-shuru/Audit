// Audit Builder - browser UI
import { buildReport, REPORT_COLUMNS, LOCKED_COLUMNS, MANUAL_FIELDS, EDITABLE, itemCode } from '../engine/report.js';
import { normalizeBlancco, parseMacLines, parseWindowsLines, itemKey } from '../engine/sources.js';
import defaultModels from '../data/default-models.json';
import {
  readTableFile, parsePastedTable, importWorkbook, downloadXlsx, reportTsv, lockedTsv,
  copyText, downloadJson, readJsonFile,
} from './io.js';

const STORE_PROJECT = 'auditApp.project';
const STORE_MODELS = 'auditApp.models';
const STORE_TAB = 'auditApp.tab';

// ---------- state ----------
const emptyProject = () => ({
  version: 1,
  settings: { projectNumber: '', prefix: '', endClient: '', startNumber: 1 },
  inputs: { mac: '', windows: '', blancco: [], blanccoSource: '' },
  manual: {}, overrides: {},
  savedToFile: true,
});

const load = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const store = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } };

const state = {
  project: Object.assign(emptyProject(), load(STORE_PROJECT, {})),
  models: load(STORE_MODELS, null) || structuredClone(defaultModels),
  tab: load(STORE_TAB, 'data'),
  report: null,
  reviewFilter: '', reviewIssuesOnly: false,
  modelsTab: 'models',
};

const settingsComplete = s => s.projectNumber.trim() && s.prefix.trim() && s.endClient.trim() && Number(s.startNumber) >= 0;

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
function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

function nextFreeCode() {
  const p = state.project.settings;
  const used = new Set([
    ...Object.keys(state.project.manual).map(itemKey),
    ...state.report.rows.map(r => itemKey(r.itemLookup)),
  ]);
  for (let n = Number(p.startNumber || 1); ; n++) {
    const c = itemCode(p, n);
    if (!used.has(itemKey(c))) return c;
  }
}

// ---------- chrome (header + tabs) ----------
function renderChrome() {
  const s = state.project.settings;
  const r = state.report;
  $('#projectChip').innerHTML = settingsComplete(s)
    ? `<b>${esc(s.projectNumber)}</b><span>${esc(s.endClient)}</span><span>${esc(itemCode(s, s.startNumber))}…</span>`
    : '<b>No project set up</b>';
  $('#saveState').textContent = state.project.savedToFile ? '' : 'Unsaved changes';
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
  ({ data: renderData, manual: renderManual, review: renderReview, export: renderExport })[state.tab](main);
}

// ---------- Data tab ----------
function renderData(main) {
  const inp = state.project.inputs;
  const bl = normalizeBlancco(inp.blancco);
  const serials = new Set(bl.rows.map(r => r.serial).filter(Boolean));
  const mac = parseMacLines(inp.mac), win = parseWindowsLines(inp.windows);
  const noCode = list => list.filter(x => !x.item).length;

  main.innerHTML = `
  <section class="card">
    <div class="card-head">
      <div><h2>Blancco export</h2><p class="hint">The erasure report exported from Blancco (.csv or .xlsx). Columns are found by their header names.</p></div>
      <div class="actions">
        <label class="btn primary">Choose file…<input type="file" id="blanccoFile" accept=".csv,.xlsx,.xls,.txt" hidden></label>
        ${inp.blancco.length ? '<button class="btn ghost" id="blanccoClear">Clear</button>' : ''}
      </div>
    </div>
    ${inp.blancco.length > 1 ? `
      <div class="status ${bl.missing.length ? 'bad' : 'good'}">
        ${bl.missing.length ? `Missing columns: ${esc(bl.missing.join(', '))}` : '✓'}
        ${plural(bl.rows.length, 'disk row')} · ${plural(serials.size, 'device')}
        ${inp.blanccoSource ? `· from <b>${esc(inp.blanccoSource)}</b>` : ''}
      </div>` : ''}
    <details ${inp.blancco.length ? '' : 'open'}>
      <summary>…or paste it here (copy the cells including the header row)</summary>
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

  $('#blanccoFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      inp.blancco = await readTableFile(f); inp.blanccoSource = f.name;
      changed(); toast(`Loaded ${f.name}`);
    } catch (err) { toast(`Couldn't read ${f.name}: ${err.message}`, 'bad'); }
  };
  $('#blanccoPaste').onpaste = e => setTimeout(() => {
    const table = parsePastedTable(e.target.value);
    if (table.length < 2) { toast('That doesn\'t look like a table with a header row', 'bad'); return; }
    inp.blancco = table; inp.blanccoSource = 'pasted';
    changed(); toast(`Pasted ${table.length - 1} rows`);
  });
  const clear = $('#blanccoClear');
  if (clear) clear.onclick = () => { inp.blancco = []; inp.blanccoSource = ''; changed(); };

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
  main.innerHTML = `
  <section class="card">
    <div class="card-head">
      <div><h2>Manual entries</h2>
      <p class="hint">For devices the tools can't read (dead, locked, no report). Anything typed here takes priority over the tools' data;
      Diagnostics and Locked/Faulty are added to what the tools found.</p></div>
      <div class="actions">
        <input id="newCode" class="code-input" value="${esc(nextFreeCode())}" aria-label="Item code">
        <button class="btn primary" id="addManual">Add item</button>
      </div>
    </div>
    ${codes.length ? `
    <div class="table-wrap">
      <table class="grid manual">
        <thead><tr><th class="sticky">Item</th>${MANUAL_FIELDS.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${codes.map(code => `
          <tr data-code="${esc(code)}">
            <th class="sticky">${esc(code)}</th>
            ${MANUAL_FIELDS.map(([f]) => `<td contenteditable="plaintext-only" data-field="${f}">${esc(man[code][f] ?? '')}</td>`).join('')}
            <td><button class="icon-btn" data-del="${esc(code)}" title="Remove ${esc(code)}">✕</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<p class="empty">No manual entries yet. Add an item for every device you have to fill in by hand.</p>'}
  </section>`;

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
  main.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const code = b.dataset.del;
    const filled = Object.values(man[code]).filter(v => String(v).trim()).length;
    if (filled && !confirm(`Remove the manual entry for ${code}?`)) return;
    delete man[code]; changed();
  });
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
  const issueItems = new Set(r.warnings.filter(w => w.item).map(w => w.item));
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
      <ul>${r.warnings.map(w => `<li class="${w.level}"><span class="lvl">${levelIcon[w.level]}</span>${esc(w.text)}</li>`).join('')}</ul>
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
          <tr data-code="${esc(row.itemLookup)}" class="${issueItems.has(row.itemLookup) ? 'has-issue' : ''}">
            ${REPORT_COLUMNS.map(([k], j) => {
              if (!EDITABLE.has(k)) return `<th class="sticky s${j}">${esc(row[k])}${j === 0 ? sourceBadges(row) : ''}</th>`;
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
    search.oninput = e => { state.reviewFilter = e.target.value; const pos = e.target.selectionStart; renderReview(main); const s = $('#reviewSearch'); s.focus(); s.setSelectionRange(pos, pos); };
    $('#issuesOnly').onchange = e => { state.reviewIssuesOnly = e.target.checked; renderReview(main); };
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
      refreshReviewRow(td.parentElement);
    };
    td.onkeydown = gridKeys;
  });
}

// update one row in place so scroll position and focus are kept
function refreshReviewRow(tr) {
  const row = state.report.rows.find(x => x.itemLookup === tr.dataset.code);
  if (!row) return;
  tr.querySelectorAll('td[data-field]').forEach(td => {
    const k = td.dataset.field, edited = row._edited.includes(k);
    if (document.activeElement !== td) td.textContent = row[k] ?? '';
    td.classList.toggle('edited', edited);
    if (edited) td.title = `Edited. Calculated value: ${row._base[k] || '(empty)'}`; else td.removeAttribute('title');
  });
}

function sourceBadges(row) {
  const s = row._sources;
  return `<span class="badges">${s.mac ? '<i title="Mac report">M</i>' : ''}${s.win ? '<i title="Windows report">W</i>' : ''}${s.blancco ? '<i title="Blancco export">B</i>' : ''}${s.manual ? '<i title="Manual entry">H</i>' : ''}</span>`;
}

// ---------- Export tab ----------
function renderExport(main) {
  const r = state.report;
  const errors = r.warnings.filter(w => w.level === 'error');
  const preview = (cols, rows) => `
    <div class="table-wrap short"><table class="grid">
      <thead><tr>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, 8).map(row => `<tr>${cols.map(([k]) => `<td>${esc(row[k])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>${rows.length > 8 ? `<p class="hint">…and ${rows.length - 8} more</p>` : ''}`;

  main.innerHTML = `
  ${errors.length ? `<div class="banner bad">${plural(errors.length, 'problem')} still open: ${errors.map(e => esc(e.text)).join('; ')}. <a href="#" data-goto="review">Review</a></div>` : ''}
  <section class="card">
    <div class="card-head">
      <div><h2>Audit Report <span class="muted">${plural(r.rows.length, 'item')}</span></h2>
      <p class="hint">Copy and paste straight into the Google Sheet. The columns are in the same order as the old Audit Report sheet.</p></div>
      <div class="actions">
        <button class="btn primary" data-copy="report">Copy rows</button>
        <button class="btn" data-copy="reportH">Copy with headers</button>
      </div>
    </div>
    ${r.rows.length ? preview(REPORT_COLUMNS, r.rows) : '<p class="empty">No items yet.</p>'}
  </section>
  <section class="card">
    <div class="card-head">
      <div><h2>Locked and Faulty <span class="muted">${plural(r.lockedFaulty.length, 'item')}</span></h2>
      <p class="hint">${r.lockedFaulty.length ? 'Devices with a lock or fault. Send this list along with the report.' : 'No locked or faulty devices in this project, so you don\'t need this sheet.'}</p></div>
      ${r.lockedFaulty.length ? `<div class="actions">
        <button class="btn primary" data-copy="locked">Copy rows</button>
        <button class="btn" data-copy="lockedH">Copy with headers</button>
      </div>` : ''}
    </div>
    ${r.lockedFaulty.length ? preview(LOCKED_COLUMNS, r.lockedFaulty) : ''}
  </section>
  <section class="card">
    <div class="card-head">
      <div><h2>Excel file</h2><p class="hint">Download both sheets as an .xlsx file to keep with the project.</p></div>
      <div class="actions"><button class="btn" id="dlXlsx" ${r.rows.length ? '' : 'disabled'}>Download .xlsx</button></div>
    </div>
  </section>`;

  main.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    const kind = b.dataset.copy;
    const text = kind.startsWith('report') ? reportTsv(r, kind.endsWith('H')) : lockedTsv(r, kind.endsWith('H'));
    const n = kind.startsWith('report') ? r.rows.length : r.lockedFaulty.length;
    toast(await copyText(text) ? `Copied ${plural(n, 'row')}. Paste it into the sheet.` : 'Copy failed. Try again.', 'ok');
  });
  $('#dlXlsx').onclick = () => downloadXlsx(r, state.project.settings);
  main.querySelectorAll('[data-goto]').forEach(a => a.onclick = e => { e.preventDefault(); setTab(a.dataset.goto); });
}

// ---------- project setup dialog ----------
function openSetup({ force = false } = {}) {
  const d = $('#setupDialog');
  const s = state.project.settings;
  const f = $('#setupForm');
  f.projectNumber.value = s.projectNumber; f.prefix.value = s.prefix; f.endClient.value = s.endClient; f.startNumber.value = s.startNumber ?? 1;
  $('#setupCancel').hidden = force;
  d.dataset.force = force ? '1' : '';
  updateSetupPreview();
  d.showModal();
  f.projectNumber.focus();
}
function updateSetupPreview() {
  const f = $('#setupForm');
  const s = { projectNumber: f.projectNumber.value.trim(), prefix: f.prefix.value.trim().toUpperCase(), startNumber: Number(f.startNumber.value || 1) };
  $('#setupPreview').textContent = s.prefix ? `First item: ${itemCode(s, s.startNumber)} → ITD-${s.projectNumber || '…'}-${itemCode(s, s.startNumber)}` : '';
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
    state.project = Object.assign(emptyProject(), p, { savedToFile: true });
    store(STORE_PROJECT, state.project);
    recompute(); render();
    if (!settingsComplete(state.project.settings)) openSetup({ force: true });
    else if ($('#setupDialog').open) $('#setupDialog').close();
  } catch (err) {
    toast(`Couldn't open ${file.name}: ${err.message}`, 'bad');
  }
}

function saveProject() {
  const s = state.project.settings;
  const copy = { ...state.project }; delete copy.savedToFile;
  downloadJson(copy, `${s.projectNumber || 'project'}.audit.json`);
  state.project.savedToFile = true;
  store(STORE_PROJECT, state.project);
  renderChrome();
}

function init() {
  recompute();

  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('#projectChip').onclick = () => openSetup();
  $('#btnSave').onclick = saveProject;
  $('#btnOpen').onclick = () => $('#openFile').click();
  $('#openFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); };
  $('#btnNew').onclick = () => {
    if (!state.project.savedToFile && !confirm('Start a new project? Changes since you last saved the project file will be lost.')) return;
    state.project = emptyProject();
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
    s.startNumber = Number(f.startNumber.value || 1);
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
