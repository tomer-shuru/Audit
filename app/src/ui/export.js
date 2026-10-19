// Export window (opened from Review): tick rows and columns, copy them for the Google Sheet, or download Excel / the SIMS file.
// Which columns to export is remembered on this computer; which rows is per session (new items start ticked).
// Columns are [key, header in the sheet, name shown here when the header is empty].
import { exportColumns, lockedColumns } from '../engine/report.js';
import { hddRows, SIMS_COLUMNS, HDD_COLUMNS } from '../engine/sims.js';
import { downloadXlsx, toTsv } from './io.js';
import { fillSimsTemplate, downloadBytes, SIMS_TEMPLATE } from './simstemplate.js';
import { folderFile } from './filesave.js';
import { state, isSims, load, store, STORE_EXPORT_COLS } from './state.js';
import { $, esc, plural, toast, copyAndTell, pickFile } from './util.js';
import { recompute, render, reportRows } from './app.js';
import { folder, allowFolder } from './folder.js';

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

// the ticked columns of a sheet (also how the Google Sheet rows on the Data tab are read)
export const exportCols = kind => {
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
    // empty rows can be hidden from view, but are always copied (so the rows line up with the sheet)
    shown: isMainSheet(kind) && state.hideEmpty.export ? allRows.filter(x => !x._empty) : allRows,
  };
}
// the ticked rows and columns of a sheet, for downloadXlsx
const xlsxSheet = kind => { const s = exportSelection(kind); return { name: s.sheet.title, cols: s.cols, rows: s.rows }; };

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

// if red problems are still open on Review, ask first
const okToExport = () => {
  const errors = state.report.warnings.filter(w => w.level === 'error').length;
  return !errors || confirm(`${errors === 1 ? '1 problem is' : `${errors} problems are`} still open on Review. Export anyway?`);
};
export function openExport() {
  if (!okToExport()) return;
  renderExport($('#exportBody'));
  $('#exportDialog').showModal();
}

// "Copy for Google Sheet" on Review: the main sheet's rows, the same as Copy rows in the Export window
// (with the rows and columns ticked there)
export function copyMainSheet() {
  if (!okToExport()) return;
  const kind = exportKinds()[0];
  const { cols, rows } = exportSelection(kind);
  if (!rows.length || !cols.length) { toast('Nothing selected to copy. Choose rows and columns in Export…', 'bad'); return; }
  const locked = state.report.lockedFaulty.length ? ` There ${state.report.lockedFaulty.length === 1 ? 'is 1 locked or faulty device' : `are ${state.report.lockedFaulty.length} locked or faulty devices`}: copy that list from Export….` : '';
  copyAndTell(toTsv(cols, rows, false), `Copied ${plural(rows.length, 'row')} × ${plural(cols.length, 'column')}. Paste at the first item row of the sheet.${locked}`);
}

function sheetSection(kind) {
  const { sheet, allRows, cols, rows, hidden, excluded, shown } = exportSelection(kind);
  const isMain = isMainSheet(kind);
  if (!isMain && !allRows.length) {
    return `<section class="card"><div class="card-head"><div><h2>${sheet.title} <span class="muted">0 rows</span></h2>
      <p class="hint">${EXPORT_EMPTY[kind]}</p></div></div></section>`;
  }
  const allRowsOn = allRows.every(x => !excluded.has(rowKey(x)));
  const canCopy = rows.length && cols.length ? '' : 'disabled';
  return `
  <section class="card" data-sheet="${kind}">
    <div class="card-head">
      <div><h2>${sheet.title} <span class="muted">${rows.length} of ${plural(allRows.length, 'row')} · ${cols.length} of ${sheet.cols().length} columns</span></h2>
      <p class="hint">${EXPORT_HINTS[kind]()}</p></div>
      <div class="actions">
        <button class="btn primary" data-copy ${canCopy}>Copy rows</button>
        <button class="btn" data-copy-h ${canCopy}>Copy with headers</button>
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
}

function fileSection() {
  const r = state.report;
  if (!isSims()) return `
    <div class="card-head">
      <div><h2>Excel file</h2><p class="hint">Download the selected rows and columns of both sheets as an .xlsx file.</p></div>
      <div class="actions"><button class="btn" id="dlXlsx" ${r.rows.length ? '' : 'disabled'}>Download .xlsx</button></div>
    </div>`;
  return `
    <div class="card-head">
      <div><h2>SIMS Excel file</h2><p class="hint">Fills the SIMS template with the selected rows and columns: Item per service project, HDD and Diagnostic codes (from the Dictionary).
      Their logos, comments and Summary stay as they are; the Summary counts itself when the file is opened.
      The template is <code>${SIMS_TEMPLATE.folder}\\${SIMS_TEMPLATE.file}</code> in the shared Audit Builder folder; when SIMS sends a new one, replace that file.</p></div>
      <div class="actions"><button class="btn primary" id="dlSims" ${r.rows.length ? '' : 'disabled'}>Download SIMS .xlsx</button>
        <button class="btn ghost" id="dlSimsPick" ${r.rows.length ? '' : 'disabled'} title="Fill a template file you choose instead of the shared one">Other template…</button>
        <button class="btn" id="dlLocked" ${r.lockedFaulty.length ? '' : 'disabled'}>Download Locked and Faulty .xlsx</button></div>
    </div>`;
}

export function renderExport(main) {
  main.innerHTML = `
  ${exportKinds().map(sheetSection).join('')}
  <section class="card">
    ${fileSection()}
  </section>`;

  main.querySelectorAll('[data-sheet]').forEach(card => attachSheet(card, card.dataset.sheet));

  const settings = state.project.settings;
  if (!isSims()) {
    $('#dlXlsx').onclick = () => { if (!downloadXlsx(exportKinds().map(xlsxSheet), settings)) toast('Nothing selected to export', 'bad'); };
    return;
  }
  $('#dlSims').onclick = () => downloadSims();
  $('#dlSimsPick').onclick = () => downloadSims({ pick: true });
  $('#dlLocked').onclick = () => { if (!downloadXlsx([xlsxSheet('locked')], settings, 'Locked and Faulty')) toast('Nothing selected to export', 'bad'); };
}

function attachSheet(card, kind) {
  const { allRows, excluded, shown } = exportSelection(kind);
  const setHiddenCols = list => { exportPrefs.hiddenCols[kind] = list; store(STORE_EXPORT_COLS, exportPrefs.hiddenCols); recompute(); render(); };
  const toggle = (key, on) => { if (on) excluded.delete(key); else excluded.add(key); };
  const hideEmpty = card.querySelector('[data-hide-empty]');
  if (hideEmpty) hideEmpty.onchange = () => { state.hideEmpty.export = hideEmpty.checked; render(); };

  card.querySelectorAll('[data-col]').forEach(cb => cb.onchange = () => {
    const set = new Set(exportPrefs.hiddenCols[kind] || []);
    if (cb.checked) set.delete(cb.dataset.col); else set.add(cb.dataset.col);
    setHiddenCols([...set]);
  });
  // Shift-click: give every row between the last clicked one and this one the same state
  card.querySelectorAll('[data-row]').forEach(cb => cb.onclick = e => {
    const key = cb.dataset.row;
    const a = shown.findIndex(x => rowKey(x) === exportPrefs.anchor[kind]), b = shown.findIndex(x => rowKey(x) === key);
    const range = e.shiftKey && a >= 0 ? shown.slice(Math.min(a, b), Math.max(a, b) + 1) : [shown[b]];
    for (const x of range) toggle(rowKey(x), cb.checked);
    exportPrefs.anchor[kind] = key;
    render();
  });
  card.querySelectorAll('[data-rows]').forEach(btn => btn.onclick = () => {
    const op = btn.dataset.rows;
    for (const x of allRows) toggle(rowKey(x), op === 'all' || (op === 'invert' && excluded.has(rowKey(x))));
    render();
  });
  const all = card.querySelector('[data-all-rows]');
  if (all) {
    all.indeterminate = excluded.size > 0 && excluded.size < allRows.length;
    all.onchange = () => { if (all.checked) excluded.clear(); else allRows.forEach(x => excluded.add(rowKey(x))); render(); };
  }
  const allCols = card.querySelector('[data-all-cols]');
  if (allCols) allCols.onclick = () => setHiddenCols([]);

  const copy = withHeader => {
    const { cols, rows } = exportSelection(kind);
    copyAndTell(toTsv(cols, rows, withHeader), `Copied ${plural(rows.length, 'row')} × ${plural(cols.length, 'column')}. Paste it into the sheet.`);
  };
  card.querySelector('[data-copy]').onclick = () => copy(false);
  card.querySelector('[data-copy-h]').onclick = () => copy(true);
}

// the SIMS template: Templates\SIMS.xlsx in the shared folder, or a file the person picks
async function simsTemplate({ pick = false } = {}) {
  if (!pick && folder.handle) {
    await allowFolder();
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
