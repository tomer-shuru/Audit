// Data tab: Blancco exports, the Mac and Windows reports, and the rows already in the Google Sheet
import { itemCode, itemName } from '../engine/report.js';
import { normalizeBlancco, mergeTables, parseMacLines, parseWindowsLines, sortReportLines } from '../engine/sources.js';
import { readTableFiles, parsePastedTable } from './io.js';
import { state, outputOf, OUTPUTS, otherParts } from './state.js';
import { $, esc, plural, toast, dropZone } from './util.js';
import { changed } from './app.js';

// where the rows already in the sheet are copied from, for the outputs other than ours
const SHEET_FROM = { sims: 'the SIMS sheet, columns D (Item No) to T (Blancco Result)', google: 'the ITAD REPORT sheet, from Item to Weight (KG)' };

export function renderData(main) {
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
      same columns as the Final Report shows) and paste them here. They are used like the other inputs, last in line: Blancco, the Mac and Windows reports and manual entries
      win wherever they have a value, and the sheet fills in what they leave empty (green cells on the Final Report). Edits there and manual entries can change them.${SHEET_FROM[outputOf()] ? ` This project's output is ${OUTPUTS[outputOf()]}, so copy them from ${SHEET_FROM[outputOf()]}.` : ''}${state.collab ? ' Shared project: everyone sees the same rows here, and the newest paste counts.' : ''} </p></div>
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
      const { tables, skipped } = await readTableFiles(list);
      const left = skipped.length ? `${skipped.length === 1 ? `${skipped[0]} isn't` : `${skipped.length} files aren't`} a .csv, .xlsx or .zip file, so ${skipped.length === 1 ? 'it was' : 'they were'} skipped` : '';
      if (!tables.length) { toast(left || 'No .csv or .xlsx files found', 'bad'); return; }
      addFiles(tables);
      changed(); toast(`Added ${plural(tables.length, 'file')}${left ? `. ${left}` : ''}`);
    } catch (err) { toast(`Couldn't read the files: ${err.message}`, 'bad'); }
  };
  $('#blanccoFile').onchange = e => { const list = [...e.target.files]; e.target.value = ''; loadFiles(list); };
  dropZone($('#blanccoCard'), loadFiles);

  $('#blanccoPaste').onpaste = e => setTimeout(() => {
    const table = parsePastedTable(e.target.value);
    if (table.length < 2) { toast('That doesn\'t look like a table with a header row', 'bad'); return; }
    const n = files.filter(f => f.name.startsWith('Pasted rows')).length + 1;
    addFiles([{ name: `Pasted rows ${n}`, table }]);
    changed(); toast(`Pasted ${plural(table.length - 1, 'row')}`);
  });
  // removing is instant; the toast offers Undo (puts the files back where they were)
  const remove = list => {
    const before = [...files];
    for (const f of list) files.splice(files.indexOf(f), 1);
    changed();
    toast(list.length === 1 ? `Removed ${list[0].name}` : `Removed ${plural(list.length, 'Blancco file')}`, 'ok', {
      label: 'Undo',
      run: () => { files.splice(0, files.length, ...before, ...files.filter(f => !before.includes(f))); changed(); },
    });
  };
  main.querySelectorAll('[data-rmfile]').forEach(b => b.onclick = () => remove([files[Number(b.dataset.rmfile)]]));
  const clear = $('#blanccoClear');
  if (clear) clear.onclick = () => remove([...files]);

  // typing in the big boxes: the report is rebuilt once the person pauses (without redrawing the box)
  const typedInto = (id, key, statusId, status) => {
    let timer;
    $(id).oninput = e => {
      inp[key] = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => { changed({ rerender: false }); $(statusId).innerHTML = status(); }, 300);
    };
  };
  typedInto('#reportsInput', 'reports', '#reportsStatus', () => reportsStatus(inp.reports));
  typedInto('#sheetInput', 'sheet', '#sheetStatus', sheetStatus);
  const sheetClear = $('#sheetClear');
  if (sheetClear) sheetClear.onclick = () => { inp.sheet = ''; changed(); };
}

// the Mac and Windows report lines in a text, and the lines that are neither
export function parseReports(text) {
  const sorted = sortReportLines(text);
  return { mac: parseMacLines(sorted.mac), win: parseWindowsLines(sorted.windows), unknown: sorted.unknown };
}

// "24 devices (16 Mac, 8 Windows)"; lines that are neither are listed on the Final Report tab
function reportsStatus(text) {
  const { mac, win, unknown } = parseReports(text);
  const n = mac.length + win.length, noCode = [...mac, ...win].filter(x => !x.item).length;
  const parts = [`${plural(n, 'device')}${n ? ` (${mac.length} Mac, ${win.length} Windows)` : ''}`];
  if (noCode) parts.push(`<span class="bad-text">${noCode} without item code</span>`);
  if (unknown.length) parts.push(`<span class="bad-text">${plural(unknown.length, 'line')} not recognised (see Final Report)</span>`);
  return parts.join(' · ');
}

const sheetStatus = () => (state.sheet ? `${plural(state.sheet.codes.length, 'item')} read from the sheet` : 'Nothing pasted');

// checks for the Google Sheet rows pasted on the Data tab (shown on the Final Report tab)
export function sheetWarnings(m) {
  const settings = state.project.settings;
  const list = codes => (codes.length > 12 ? `${codes.slice(0, 12).join(', ')} and ${codes.length - 12} more` : codes.join(', '));
  if (!m.codes.length) {
    return [{ level: 'error', text: `Google Sheet rows (Data tab): no item codes found. Copy them including the ITEM column (codes like ${itemName(settings, itemCode(settings, 1), state.config)}).` }];
  }
  const out = [];
  if (m.duplicates.length) out.push({ level: 'warn', item: m.duplicates[0], text: `Google Sheet rows: ${list(m.duplicates)} more than once. Only the first row of each is used.` });
  if (m.otherRows) out.push({ level: 'warn', text: `Google Sheet rows: ${plural(m.otherRows, 'row')} without an item code left out. Pasting back over the same range will replace ${m.otherRows === 1 ? 'it' : 'them'}.` });
  if (m.headerRows) out.push({ level: 'info', text: `Google Sheet rows: ${plural(m.headerRows, 'row')} above the first item (headers) left out` });
  if (m.lineBreaks) out.push({ level: 'info', text: 'Google Sheet rows: some cells have line breaks; they will be pasted on one line' });
  return out;
}
