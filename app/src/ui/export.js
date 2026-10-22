// Getting the Final Report out: copy the shown rows and columns of a sheet for the Google Sheet, or download
// the Excel file / the filled SIMS template (every sheet of the chosen output, each as it is shown).
import { SIMS_COLUMNS, HDD_COLUMNS, LOCK_REQUEST_COLUMNS } from '../engine/sims.js';
import { downloadXlsx, toTsv } from './io.js';
import { fillSimsTemplate, fillLockTemplate, downloadBytes, SIMS_TEMPLATE, LOCK_TEMPLATE } from './simstemplate.js';
import { folderFile } from './filesave.js';
import { state, outputOf, OUTPUTS } from './state.js';
import { plural, toast, copyAndTell, pickFile } from './util.js';
import { folder, allowFolder } from './folder.js';
import { SHEETS, sheetKinds, exportCols, hiddenCols, shownRows, isFiltered } from './report-view.js';

// if red problems are still open on the Final Report, ask first
export const okToExport = () => {
  const errors = state.report.warnings.filter(w => w.level === 'error').length;
  return !errors || confirm(`${errors === 1 ? '1 problem is' : `${errors} problems are`} still open on the Final Report. Export anyway?`);
};

export function copySheet(kind, { withHeader = false } = {}) {
  if (!okToExport()) return;
  const cols = exportCols(kind), rows = shownRows(kind), all = SHEETS[kind].rows().length;
  if (!rows.length || !cols.length) { toast(rows.length ? 'All columns are hidden. Show some to copy them.' : 'No rows to copy. Clear the filters to see them.', 'bad'); return; }
  const which = rows.length < all ? `${rows.length} of ${plural(all, 'row')} (filtered)` : plural(rows.length, 'row');
  copyAndTell(toTsv(cols, rows, withHeader), `Copied ${which} × ${plural(cols.length, 'column')}. Paste ${withHeader ? 'it into the sheet' : 'at the first item row of the sheet'}.`);
}

// Shuru / Google: one Excel file with the main sheet and Locked and Faulty; SIMS: the SIMS template, or their
// Locked devices request workbook (lockRequest)
export async function downloadReport({ sims = false, pick = false, lockRequest = false } = {}) {
  if (!okToExport()) return;
  const settings = state.project.settings;
  const sheet = kind => ({ name: SHEETS[kind].title, cols: exportCols(kind), rows: shownRows(kind) });
  if (!sims) {
    const kinds = sheetKinds();
    if (!downloadXlsx(kinds.map(sheet), settings, outputOf() === 'shuru' ? undefined : `Audit Report (${OUTPUTS[outputOf()]})`)) toast('Nothing to download: no rows or columns shown', 'bad');
    else if (kinds.some(isFiltered)) toast('Downloaded the rows shown (filters are on)');
    return;
  }
  if (lockRequest) {
    try {
      const bytes = await loadTemplate({ pick, template: LOCK_TEMPLATE });
      if (!bytes) return;
      const rows = shownRows('lockRequest'), hide = hiddenCols('lockRequest');
      // asset tags that are plain numbers are written as numbers, like in their file
      const value = (k, v) => (k === 'asset' && /^[1-9]\d{0,14}$/.test(String(v ?? '').trim()) ? Number(v) : v ?? '');
      const out = fillLockTemplate(bytes, rows.map(row => LOCK_REQUEST_COLUMNS.map(([k]) => (hide.has(k) ? '' : value(k, row[k])))));
      downloadBytes(out, `${settings.projectNumber || 'Audit'} - Locked devices request.xlsx`);
      toast(`Downloaded the Locked devices request: ${plural(rows.length, 'row')}`);
    } catch (err) { toast(`Couldn't fill the Locked devices request: ${err.message}`, 'bad'); }
    return;
  }
  try {
    const bytes = await loadTemplate({ pick });
    if (!bytes) return;
    const items = shownRows('sims'), hdd = shownRows('hdd'), hideItems = hiddenCols('sims'), hideHdd = hiddenCols('hdd');
    const value = (k, v) => (k === 'weight' && v !== '' && v != null && !Number.isNaN(Number(v)) ? Number(v) : v ?? '');
    const out = fillSimsTemplate(bytes, {
      items: items.map(row => SIMS_COLUMNS.map(([k]) => (hideItems.has(k) ? '' : value(k, row[k])))),
      hdd: hdd.map(row => HDD_COLUMNS.map(([k]) => (hideHdd.has(k) ? '' : row[k]))),
      codes: state.models.simsCodes.map(c => [c.category, c.code, c.description]),
    });
    downloadBytes(out, `${settings.projectNumber || 'Audit'} - SIMS.xlsx`);
    toast(`Downloaded the SIMS file: ${plural(items.length, 'item')}, ${plural(hdd.length, 'data carrier')}`);
  } catch (err) { toast(`Couldn't fill the SIMS template: ${err.message}`, 'bad'); }
}

// a template (SIMS.xlsx or Locked devices request.xlsx) from Templates in the shared folder, or a file the person picks
async function loadTemplate({ pick = false, template = SIMS_TEMPLATE } = {}) {
  if (!pick && folder.handle) {
    await allowFolder();
    if (folder.handle && !folder.pending) {
      const h = await folderFile(folder.handle, template.folder, template.file);
      if (h) return new Uint8Array(await (await h.getFile()).arrayBuffer());
      toast(`The shared folder has no ${template.folder}\\${template.file}. Choose the template file.`, 'bad');
    }
  } else if (!pick) {
    toast(`The shared folder isn't connected, so choose the template file (${template.folder}\\${template.file}).`);
  }
  const file = await pickFile('.xlsx');
  return file ? new Uint8Array(await file.arrayBuffer()) : null;
}
