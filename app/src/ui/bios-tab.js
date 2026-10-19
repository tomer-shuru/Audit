// Tools › Microsoft BIOS passwords (the BIOS passwords tab): the password file matched to the items, with QR codes.
// The loaded file is kept in the project (inputs.bios), so it's saved in the project file. In a shared project
// the newest file anyone loaded is used.
import qrcode from 'qrcode-generator';
import { codeNumber } from '../engine/report.js';
import { itemKey } from '../engine/sources.js';
import { parseBiosPasswords, matchBiosPasswords } from '../engine/biospw.js';
import { downloadXlsx, toTsv } from './io.js';
import { state } from './state.js';
import { $, esc, plural, toast, copyAndTell, redrawKeepingCaret, dropZone } from './util.js';
import { changed, outputRows, fitTallTable, setTab } from './app.js';
import { reportProject } from './collab.js';

const bios = { selected: '', q: '', projectOnly: false, cache: null };

// { fileName, parsed } of the project's password file, or null
export function biosFile() {
  const f = reportProject().inputs.bios;
  if (!f?.text) return null;
  if (bios.cache?.text !== f.text) bios.cache = { text: f.text, parsed: parseBiosPasswords(f.text) };
  return { fileName: f.fileName, parsed: bios.cache.parsed };
}

function biosMatch() {
  const settings = state.project.settings;
  const order = r => { const k = itemKey(r.itemLookup); return k ? codeNumber(settings, k) : null; };
  return matchBiosPasswords(biosFile().parsed, outputRows(), order);
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
const shownSheet = () => biosSheet(biosShown(biosMatch()));

// a QR code of the text, black on white so scanners read it in dark mode too
function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

// the BIOS passwords tab: the buttons on top, the list and QR code below (renderBios redraws only those)
export function renderBiosTab(main) {
  main.innerHTML = `
  <section class="card">
    <div class="card-head">
      <div><h2>Microsoft BIOS passwords</h2>
      <p class="hint">Load the BulkBiosPasswordDetails .txt file from Microsoft. Each asset tag is matched to its item; select a device to get a QR code of its password.
      The file is saved with the project, so you only load it once.</p></div>
      <div class="actions">
        <button class="btn" id="biosLoad">Load password file…</button>
        <button class="btn" id="biosCopy" title="Copy the list to paste into a sheet">Copy with headers</button>
        <button class="btn" id="biosXlsx">Download .xlsx</button>
      </div>
    </div>
  </section>
  <div id="biosBody"></div>`;
  $('#biosLoad').onclick = () => $('#biosFile').click();
  $('#biosCopy').onclick = () => {
    const { cols, rows } = shownSheet();
    copyAndTell(toTsv(cols, rows, true), `Copied ${plural(rows.length, 'device')}. Paste it into a sheet.`);
  };
  $('#biosXlsx').onclick = () => {
    const { cols, rows } = shownSheet();
    if (!downloadXlsx([{ name: 'BIOS passwords', cols, rows }], state.project.settings, 'BIOS passwords')) toast('Nothing to download', 'bad');
  };
  renderBios();
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
        <div class="table-wrap tall"><table class="grid bios-table" tabindex="0">
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
  const KEYS = { ArrowDown: i => i + 1, ArrowUp: i => i - 1, Home: () => 0, End: () => rows.length - 1 };
  body.querySelector('.bios-table').onkeydown = e => {
    if (!KEYS[e.key]) return;
    e.preventDefault();
    const next = rows[KEYS[e.key](rows.findIndex(r => r.key === bios.selected))];
    if (next) select(next.key, true);
  };
  const search = $('#biosSearch');
  search.oninput = e => { bios.q = e.target.value; redrawKeepingCaret(e.target, renderBios); };
  // Enter in the search box goes to the list, so the arrow keys work straight away
  search.onkeydown = e => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); $('#biosBody .bios-table').focus(); } };
  $('#biosProjectOnly').onchange = e => { bios.projectOnly = e.target.checked; renderBios(); };
  body.querySelectorAll('[data-copy-pw]').forEach(b => b.onclick = () => copyAndTell(sel.passwords[Number(b.dataset.copyPw)], 'Password copied'));
  fitTallTable();
}

const attachBiosDrop = zone => dropZone(zone, ([f]) => { if (f) loadBiosFile(f); });

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
}

export function initBios() {
  $('#btnBios').onclick = () => setTab('bios');
  $('#biosFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadBiosFile(f); };
}
