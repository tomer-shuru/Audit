// DevMode: the rules in config.json (battery grades, Blancco messages, texts, checks, columns…), changed without code.
// The DevMode window is behind a password. Changes are made to a draft first: the window shows what they would change
// in the open project, and they only apply when saved (to the shared rules file, see config-file.js).
import { DEFAULT_CONFIG, CHECKS, CHECK_LEVELS, withDefaults, validateConfig, rulesOf } from '../engine/config.js';
import { buildReport, exportColumns, lockedColumns } from '../engine/report.js';
import { writeFile, readFileText } from './filesave.js';
import { downloadJson, readJsonFile } from './io.js';
import { state } from './state.js';
import { $, esc, toast } from './util.js';
import {
  file, editor, applyConfig, configText, rulesText, isConfigData, fileFailed, loadConfigFile, renderConfigBar, initConfigFile,
} from './config-file.js';

const UNLOCKED = 'auditApp.devUnlocked'; // sessionStorage: unlocked until the tab is closed
const HISTORY_MAX = 20;

const dev = { draft: null, section: 'battery', timer: 0 };
const dirty = () => dev.draft && rulesText(dev.draft) !== rulesText(state.config);
Object.assign(editor, { dirty, reset: () => { if (dev.draft) dev.draft = structuredClone(state.config); } });

async function hashPassword(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('audit-builder:' + pw));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- password ----------
function openLogin() {
  if (sessionStorage.getItem(UNLOCKED) === state.config.passwordHash) { openDev(); return; }
  const d = $('#devLogin');
  $('#devLoginForm').reset();
  $('#devLoginError').textContent = '';
  d.showModal();
  $('#devLoginForm').pw.focus();
}

async function tryLogin(e) {
  e.preventDefault();
  const pw = $('#devLoginForm').pw.value;
  let hash;
  try { hash = await hashPassword(pw); } catch { $('#devLoginError').textContent = 'This browser can\'t check the password. Open the app in Chrome or Edge.'; return; }
  if (hash !== state.config.passwordHash) {
    $('#devLoginError').textContent = 'Wrong password';
    $('#devLoginForm').pw.select();
    return;
  }
  try { sessionStorage.setItem(UNLOCKED, hash); } catch { /* stays locked next time */ }
  $('#devLogin').close();
  openDev();
}

function lock() {
  if (dirty() && !confirm('Lock DevMode? Unsaved rule changes will be lost.')) return;
  try { sessionStorage.removeItem(UNLOCKED); } catch { /* nothing to remove */ }
  dev.draft = null;
  $('#devDialog').close();
  toast('DevMode locked');
}

// ---------- the DevMode window ----------
function openDev() {
  dev.draft = structuredClone(state.config);
  renderDev();
  $('#devDialog').showModal();
  if (file.status === 'ok') loadConfigFile().then(() => { if (!dirty()) { dev.draft = structuredClone(state.config); renderDev(); } });
}

function closeDev() {
  if (dirty() && !confirm('Close DevMode? Your rule changes aren\'t saved and will be lost.')) return;
  dev.draft = null;
  $('#devDialog').close();
}

const TEXTS = {
  itemPrefix: ['Start of the ITEM column', 'ITEM = this, the project number and the item code, e.g. ITD-SHR11734-GG01'],
  noDisk: ['Disk, when a Mac or Windows report says NONE', ''],
  appleIdLock: ['Mac with Activation Lock on', 'Written in Diagnostics and Locked or Faulty'],
  remoteLocked: ['Mac with a remote management lock', 'Written in Diagnostics and Locked or Faulty'],
  batteryService: ['Mac whose battery health says Service', 'Written in Diagnostics'],
  simsErased: ['SIMS output: Blancco Result for a passed erasure', 'Written once per erased disk, e.g. "Erased Erased"'],
  simsNotErased: ['SIMS output: Blancco Result for a failed erasure', ''],
  simsNoSpecs: ['SIMS output: Purchase Description with no CPU, RAM or disk', ''],
};
const ERASURE = {
  passText: ['Blancco result for a passed erasure', 'A result starting with this gets the Data Destruction Method, and "Yes" under Wiped on Locked and Faulty'],
  failText: ['Blancco result for a failed erasure', 'A result containing this shows the "erasure failed" check'],
  destruction: ['Data Destruction Method for a passed erasure', ''],
};
const BLANCCO = {
  make: 'Make', chassis: 'Chassis type', item: 'Item code', itemAlt: 'Item code, when the one above is empty', asset: 'Asset tag',
  erasure: 'Erasure state', serial: 'Serial number', model: 'Model', version: 'Version (the model for the makes listed under Texts)',
  battery: 'Battery capacity %', cpu: 'CPU', memory: 'Memory size', memoryType: 'Memory type', diskCapacity: 'Disk capacity',
  diskInterface: 'Disk interface', diskSerial: 'Disk serial',
  comment1: 'Comment 1', comment2: 'Comment 2', comment3: 'Comment 3', comment4: 'Comment 4', comment5: 'Comment 5', comment6: 'Comment 6',
  comment7: 'Comment 7', comment8: 'Comment 8',
};
const LEVELS = { error: 'Problem (red)', warn: 'Warning (yellow)', info: 'Note (gray)', sims: 'SIMS (blue)', off: 'Off' };
const defaultLabel = (k, key) => DEFAULT_CONFIG[k].find(x => x.key === key)?.label ?? key;

const SECTIONS = {
  battery: { label: 'Battery', keys: ['battery'], html: () => `
    <p class="hint">The battery % from the Mac, Windows and Blancco reports gets the first grade whose limit it falls under, top to bottom.
    Above every limit there's no grade. "Below 55" doesn't include 55; "up to 69" does.</p>
    ${table('battery', [{ k: 'op', label: 'Rule', type: 'select', options: [['<', 'below'], ['<=', 'up to']] }, { k: 'value', label: 'Battery %', type: 'number' }, { k: 'label', label: 'Grade written in Diagnostics' }],
      { add: { op: '<=', value: '', label: '' } })}` },
  blancco: { label: 'Blancco comments', keys: ['blanccoMessages', 'typedCommentColumns'], html: d => `
    <h3>Automatic messages</h3>
    <p class="hint">Messages Blancco writes in its comment columns. A comment containing the text on the left (capitals don't matter, part of the message is enough)
    is written in Diagnostics as the text on the right. Leave the right side empty to leave the message out.</p>
    ${table('blanccoMessages', [{ k: 'match', label: 'Blancco writes' }, { k: 'text', label: 'Report says (empty = left out)' }], { add: { match: '', text: '' } })}
    <h3>Typed comments</h3>
    ${field('', 'typedCommentColumns', 'Comment columns typed by the technicians', 'Comments 1 to this number go into Diagnostics as typed. The rest (up to 8) are only searched for the messages above.', 'number', d.typedCommentColumns, { min: 0, max: 8 })}` },
  erasure: { label: 'Erasure', keys: ['erasure'], html: d => `
    <div class="dev-cols">
      <div><h3>Passed erasure</h3><p class="hint">An erasure state containing one of these words counts as passed (capitals don't matter).</p>
        ${table('erasure.passWords', [{ k: '_', label: 'Word' }], { add: '' })}</div>
      <div><h3>Failed erasure</h3><p class="hint">…or as failed.</p>
        ${table('erasure.failWords', [{ k: '_', label: 'Word' }], { add: '' })}</div>
    </div>
    <h3>Texts</h3>
    ${Object.entries(ERASURE).map(([k, [l, h]]) => field('erasure', k, l, h, 'text', d.erasure[k])).join('')}` },
  disks: { label: 'Disk types', keys: ['diskKinds'], html: () => `
    <p class="hint">Blancco's disk interface type becomes the disk name in the Disk column (e.g. "512 GB NVMe"): the first row whose text it contains, top to bottom.
    If none matches, the interface is written as Blancco has it.</p>
    ${table('diskKinds', [{ k: 'match', label: 'Interface contains' }, { k: 'name', label: 'Written as' }], { add: { match: '', name: '' } })}` },
  texts: { label: 'Texts', keys: ['texts', 'noAssetTag', 'modelFromVersion'], html: d => `
    ${Object.entries(TEXTS).map(([k, [l, h]]) => field('texts', k, l, h, 'text', d.texts[k])).join('')}
    <div class="dev-cols">
      <div><h3>"No asset tag" values</h3><p class="hint">Asset tags that mean the device has none, so they're never flagged as duplicates.
        Dots, slashes, spaces and capitals don't matter (N/A also covers NA, n/a, N.A.); "-" covers any number of dashes.</p>
        ${table('noAssetTag', [{ k: '_', label: 'Value' }], { add: '' })}</div>
      <div><h3>Model from "System version"</h3><p class="hint">Makes whose model name Blancco puts in System version instead of System model (capitals don't matter).</p>
        ${table('modelFromVersion', [{ k: '_', label: 'Make' }], { add: '' })}</div>
    </div>` },
  checks: { label: 'Checks', keys: ['checks'], html: d => `
    <p class="hint">How each check shows on the Final Report tab. Problems (red) also ask for confirmation before copying or downloading the report. "Off" hides the check.</p>
    <table class="grid dev-table"><thead><tr><th>Check</th><th>Shows as</th></tr></thead><tbody>
      ${Object.entries(CHECKS).map(([k, label]) => `<tr><td>${esc(label)}</td><td>
        <select data-o="checks" data-k="${k}">${CHECK_LEVELS.map(l => `<option value="${l}" ${d.checks[k] === l ? 'selected' : ''}>${LEVELS[l]}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table>` },
  columns: { label: 'Columns', keys: ['reportColumns', 'lockedColumns'], html: () => `
    <p class="hint">The columns of the Audit Report and Locked and Faulty lists: their order (↑ ↓) and headers. They're shown, copied and downloaded this way,
    so keep them matching the Google Sheet. Columns can't be removed here; untick them in Export instead.</p>
    <div class="dev-cols">
      <div><h3>Audit Report</h3>${table('reportColumns', [{ k: 'key', label: 'Column', type: 'fixed', show: v => defaultLabel('reportColumns', v) }, { k: 'label', label: 'Header' }], { move: true })}</div>
      <div><h3>Locked and Faulty</h3>${table('lockedColumns', [{ k: 'key', label: 'Column', type: 'fixed', show: v => defaultLabel('lockedColumns', v) }, { k: 'label', label: 'Header' }], { move: true })}</div>
    </div>` },
  blanccoColumns: { label: 'Blancco columns', keys: ['blanccoColumns'], html: d => `
    <p class="hint">The column names the app looks for in Blancco exports (capitals don't matter). Change one only if Blancco renames a column.
    When an export repeats a name (Comment, Comment, …) the repeats are read as Comment2, Comment3, …</p>
    <table class="grid dev-table"><thead><tr><th>Used for</th><th>Column name in the export</th></tr></thead><tbody>
      ${Object.keys(DEFAULT_CONFIG.blanccoColumns).map(k => `<tr><td>${esc(BLANCCO[k] || k)}</td><td><input data-o="blanccoColumns" data-k="${k}" value="${esc(d.blanccoColumns[k])}"></td></tr>`).join('')}
    </tbody></table>` },
  more: { label: 'Password & backups', keys: [], html: d => `
    <h3>DevMode password</h3>
    <form class="dev-password" id="devPassword">
      <label>New password<input name="pw1" type="password" autocomplete="new-password" required></label>
      <label>Repeat it<input name="pw2" type="password" autocomplete="new-password" required></label>
      <button class="btn" type="submit">Change password</button>
    </form>
    <p class="hint">The new password is saved with your other changes (Save for everyone). Only a scrambled form of it is stored.</p>
    <h3>Earlier versions</h3>
    <p class="hint">Every save keeps the version before it (the last ${HISTORY_MAX}). Loading one puts it in the editor; Save to use it again.</p>
    ${d.history.length ? `<table class="grid dev-table"><thead><tr><th>Replaced on</th><th></th></tr></thead><tbody>
      ${d.history.map((h, i) => `<tr><td>${esc(new Date(h.savedAt).toLocaleString())}</td><td><button class="btn small" data-act="restore" data-i="${i}">Load into the editor</button></td></tr>`).join('')}
    </tbody></table>` : '<p class="empty">No earlier versions yet.</p>'}
    <h3>Rules file</h3>
    <div class="actions">
      <button class="btn" data-act="export">Download a copy</button>
      <button class="btn" data-act="import">Load from a file…</button>
      <button class="btn" data-act="resetAll">Load the built-in rules</button>
      <input type="file" id="devImportFile" accept=".json" hidden>
    </div>
    <p class="hint">"Load from a file" and "Load the built-in rules" only fill the editor. Nothing changes until you save.</p>` },
};

// an editable table for a list in the draft (path like "battery" or "erasure.passWords"); k '_' = the list item itself
function table(path, cols, { add, move = !!add } = {}) {
  const list = get(path);
  const cell = (item, c, i) => {
    const v = c.k === '_' ? item : item[c.k];
    const at = `data-t="${path}" data-i="${i}" data-k="${c.k}"`;
    if (c.type === 'fixed') return `<td class="muted">${esc(c.show ? c.show(v) : v)}</td>`;
    if (c.type === 'select') return `<td><select ${at}>${c.options.map(([o, l]) => `<option value="${esc(o)}" ${String(v) === o ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>`;
    return `<td><input ${at} ${c.type === 'number' ? 'type="number" step="any"' : ''} value="${esc(v)}"></td>`;
  };
  return `<table class="grid dev-table"><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}<th></th></tr></thead><tbody>
    ${list.map((item, i) => `<tr>${cols.map(c => cell(item, c, i)).join('')}<td class="row-tools">
      ${move ? `<button class="icon-btn" data-act="up" data-t="${path}" data-i="${i}" title="Move up">↑</button><button class="icon-btn" data-act="down" data-t="${path}" data-i="${i}" title="Move down">↓</button>` : ''}
      ${add !== undefined ? `<button class="icon-btn" data-act="rm" data-t="${path}" data-i="${i}" title="Remove">✕</button>` : ''}</td></tr>`).join('')}
    </tbody></table>
    ${add !== undefined ? `<button class="btn small" data-act="add" data-t="${path}" data-new='${esc(JSON.stringify(add))}'>Add row</button>` : ''}`;
}

// one labelled input for a value in the draft (obj '' = the top level)
function field(obj, k, label, hint, type, value, { min, max } = {}) {
  return `<label class="dev-field"><span>${esc(label)}${hint ? `<small class="hint">${esc(hint)}</small>` : ''}</span>
    <input data-o="${obj}" data-k="${k}" ${type === 'number' ? `type="number" step="1" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''}` : ''} value="${esc(value)}"></label>`;
}

const get = path => path.split('.').reduce((o, k) => o[k], dev.draft);

function renderDev() {
  const d = dev.draft;
  const s = SECTIONS[dev.section];
  const body = $('#devBody');
  const scroll = body.scrollTop;
  body.innerHTML = `
    <nav class="subtabs">${Object.entries(SECTIONS).map(([id, x]) => `<button data-sec="${id}" class="${id === dev.section ? 'active' : ''}">${esc(x.label)}${changedSection(id) ? ' •' : ''}</button>`).join('')}</nav>
    <section class="dev-section">
      ${s.html(d)}
      ${s.keys.length ? `<p><button class="btn small ghost" data-act="resetSection">Use the built-in ${esc(s.label.toLowerCase())} rules</button></p>` : ''}
    </section>`;
  body.scrollTop = scroll;
  renderConfigBar();
  renderFooter();
  wireDev();
}

const changedSection = id => SECTIONS[id].keys.some(k => JSON.stringify(dev.draft[k]) !== JSON.stringify(state.config[k]));

function wireDev() {
  const body = $('#devBody');
  body.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { dev.section = b.dataset.sec; renderDev(); });
  const onEdit = e => {
    const el = e.target;
    if (!el.matches('input[data-k], select[data-k]')) return;
    const v = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    if (el.dataset.t) {
      const list = get(el.dataset.t), i = Number(el.dataset.i);
      if (el.dataset.k === '_') list[i] = v; else list[i][el.dataset.k] = v;
    } else {
      const obj = el.dataset.o ? get(el.dataset.o) : dev.draft;
      obj[el.dataset.k] = v;
    }
    // the section tab's "changed" dot and the footer follow along without redrawing the inputs
    body.querySelectorAll('[data-sec]').forEach(b => { b.textContent = SECTIONS[b.dataset.sec].label + (changedSection(b.dataset.sec) ? ' •' : ''); });
    clearTimeout(dev.timer);
    dev.timer = setTimeout(renderFooter, 250);
  };
  body.oninput = onEdit;
  body.onchange = onEdit;
  body.querySelectorAll('[data-act]').forEach(b => b.onclick = e => { e.preventDefault(); act(b); });
  const pw = $('#devPassword');
  if (pw) pw.onsubmit = async e => {
    e.preventDefault();
    if (pw.pw1.value !== pw.pw2.value) { toast('The two passwords are different', 'bad'); return; }
    dev.draft.passwordHash = await hashPassword(pw.pw1.value);
    pw.reset();
    renderFooter();
    toast('New password set. Save for everyone to keep it.');
  };
  const imp = $('#devImportFile');
  if (imp) imp.onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const c = await readJsonFile(f);
      if (!isConfigData(c)) throw new Error('not an Audit Builder rules file');
      fillDraft(c);
      toast(`Loaded ${f.name} into the editor. Save to use it.`);
    } catch (err) { toast(`Couldn't load it: ${err.message}`, 'bad'); }
  };
}

// put other rules in the editor, keeping the current password and backups
function fillDraft(rules) {
  dev.draft = withDefaults({ ...rulesOf(withDefaults(rules)), passwordHash: dev.draft.passwordHash, history: dev.draft.history });
  renderDev();
}

function act(b) {
  const a = b.dataset.act, i = Number(b.dataset.i);
  const list = b.dataset.t ? get(b.dataset.t) : null;
  if (a === 'add') { list.push(JSON.parse(b.dataset.new)); renderDev(); $('#devBody').querySelectorAll(`[data-t="${b.dataset.t}"][data-i="${list.length - 1}"]`)[0]?.focus(); return; }
  if (a === 'rm') { list.splice(i, 1); renderDev(); return; }
  if (a === 'up' || a === 'down') {
    const j = a === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]]; renderDev(); return;
  }
  if (a === 'resetSection') { for (const k of SECTIONS[dev.section].keys) dev.draft[k] = structuredClone(DEFAULT_CONFIG[k]); renderDev(); return; }
  if (a === 'resetAll') { fillDraft(DEFAULT_CONFIG); toast('The built-in rules are in the editor. Save to use them.'); return; }
  if (a === 'restore') { fillDraft(dev.draft.history[i].config); toast('That version is in the editor. Save to use it again.'); return; }
  if (a === 'export') { downloadJson(state.config, 'config.json'); return; }
  if (a === 'import') { $('#devImportFile').click(); return; }
  if (a === 'discard') { dev.draft = structuredClone(state.config); renderDev(); return; }
  if (a === 'save') save();
}

// what the draft would change in the open project
function preview() {
  const { project, models, config } = state;
  const draft = withDefaults(dev.draft);
  const a = buildReport(project, models, config), b = buildReport(project, models, draft);
  const cols = exportColumns(draft);
  const after = new Map(b.rows.map(r => [r.itemLookup, r]));
  const cells = [];
  for (const ra of a.rows) {
    const rb = after.get(ra.itemLookup);
    if (!rb) continue;
    for (const [k, label] of cols) if (String(ra[k] ?? '') !== String(rb[k] ?? '')) cells.push({ item: ra.itemLookup, label, from: ra[k], to: rb[k] });
  }
  const count = ws => Object.fromEntries(['error', 'warn', 'info', 'sims'].map(l => [l, ws.filter(w => w.level === l).length]));
  return {
    cells, checks: [count(a.warnings), count(b.warnings)],
    columns: JSON.stringify(exportColumns(config)) !== JSON.stringify(cols) || JSON.stringify(lockedColumns(config)) !== JSON.stringify(lockedColumns(draft)),
    password: dev.draft.passwordHash !== config.passwordHash,
  };
}

function renderFooter() {
  const foot = $('#devFooter');
  if (!dev.draft) return;
  const problems = validateConfig(withDefaults(dev.draft));
  if (!dirty()) {
    foot.innerHTML = '<span class="muted">No unsaved changes.</span>';
    return;
  }
  const p = preview();
  const words = { error: 'problems', warn: 'warnings', info: 'notes', sims: 'SIMS notes' };
  const checkText = ['error', 'warn', 'info', 'sims'].filter(l => p.checks[0][l] !== p.checks[1][l]).map(l => `${words[l]} ${p.checks[0][l]} → ${p.checks[1][l]}`).join(', ');
  const shown = p.cells.slice(0, 200);
  foot.innerHTML = `
    ${problems.length ? `<div class="banner bad">Fix these before saving:<ul>${problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <details class="dev-preview" ${p.cells.length ? '' : 'open'}>
      <summary><b>Unsaved changes.</b> In the open project: ${p.cells.length ? `${p.cells.length} cell${p.cells.length === 1 ? '' : 's'} would change` : 'no cells change'}${checkText ? `; checks: ${esc(checkText)}` : ''}${p.columns ? '; columns change' : ''}${p.password ? '; new password' : ''}.</summary>
      ${p.cells.length ? `<div class="table-wrap"><table class="grid dev-table"><thead><tr><th>Item</th><th>Column</th><th>Now</th><th>After saving</th></tr></thead><tbody>
        ${shown.map(c => `<tr><th>${esc(c.item)}</th><td>${esc(c.label)}</td><td>${esc(c.from)}</td><td class="changed">${esc(c.to)}</td></tr>`).join('')}
      </tbody></table></div>${p.cells.length > shown.length ? `<p class="hint">…and ${p.cells.length - shown.length} more.</p>` : ''}` : ''}
    </details>
    <div class="actions">
      <button class="btn ghost" data-act="discard">Discard changes</button>
      <button class="btn primary" data-act="save" ${problems.length ? 'disabled' : ''}>${file.status === 'ok' ? 'Save for everyone' : 'Save'}</button>
    </div>`;
  foot.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b));
}

async function save() {
  const prev = state.config;
  const draft = withDefaults(dev.draft);
  if (validateConfig(draft).length) return;
  const next = { ...draft, history: [{ savedAt: new Date().toISOString(), config: rulesOf(prev) }, ...prev.history].slice(0, HISTORY_MAX) };
  if (file.handle && file.status === 'ok') {
    try {
      // changed somewhere else since it was loaded: take that version instead of overwriting it
      const current = await readFileText(file.handle);
      if (current !== file.text) {
        file.text = '';
        await loadConfigFile();
        dev.draft = structuredClone(state.config);
        renderDev();
        toast('The shared rules file was changed somewhere else just now. That version is loaded; please make your changes again.', 'bad');
        return;
      }
      const text = configText(next);
      await writeFile(file.handle, text);
      file.text = text;
    } catch (err) { fileFailed(err); toast(`Not saved: ${err.message}`, 'bad'); return; }
    toast('Saved. Coworkers get the new rules next time their app loads them.');
  } else {
    if (!confirm('The shared rules file isn\'t connected, so these rules will only be saved on this computer. Save anyway?')) return;
    toast('Saved on this computer only');
  }
  applyConfig(next);
  if (next.passwordHash !== prev.passwordHash) try { sessionStorage.setItem(UNLOCKED, next.passwordHash); } catch { /* fine */ }
  dev.draft = structuredClone(next);
  renderDev();
}

// ---------- start ----------
export function initDevMode() {
  $('#btnDev').onclick = openLogin;
  $('#devLoginForm').onsubmit = tryLogin;
  $('#devLoginCancel').onclick = () => $('#devLogin').close();
  $('#devClose').onclick = closeDev;
  $('#devLock').onclick = lock;
  $('#devDialog').oncancel = e => { e.preventDefault(); closeDev(); }; // Esc
  // connecting on start is done by folder.js (through the shared folder, or reconnectConfigFile)
  initConfigFile();
}
