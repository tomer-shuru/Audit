// Getting the Final Report out: copy the shown rows and columns of a sheet for the Google Sheet, or download
// the Excel file / the filled SIMS template (every sheet of the chosen output, each as it is shown).
import { SIMS_COLUMNS, HDD_COLUMNS } from '../engine/sims.js';
import { downloadXlsx, toTsv } from './io.js';
import { fillSimsTemplate, downloadBytes, SIMS_TEMPLATE } from './simstemplate.js';
import { folderFile } from './filesave.js';
import { state, outputOf } from './state.js';
import { plural, toast, copyAndTell, pickFile } from './util.js';
import { folder, allowFolder } from './folder.js';
import { SHEETS, sheetKinds, exportCols, hiddenCols, shownRows, isFiltered } from './report-view.js';

// if red problems are still open on the Final Report, ask first
const okToExport = () => {
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

// Shuru / Google: one Excel file with the main sheet and Locked and Faulty; SIMS: the template (or only Locked and Faulty)
export async function downloadReport({ sims = false, pick = false, lockedOnly = false } = {}) {
  if (!okToExport()) return;
  const settings = state.project.settings;
  const sheet = kind => ({ name: SHEETS[kind].title, cols: exportCols(kind), rows: shownRows(kind) });
  if (!sims || lockedOnly) {
    const kinds = lockedOnly ? ['locked'] : sheetKinds();
    if (!downloadXlsx(kinds.map(sheet), settings, lockedOnly ? 'Locked and Faulty' : outputOf() === 'google' ? 'Audit Report (Google)' : undefined)) toast('Nothing to download: no rows or columns shown', 'bad');
    else if (kinds.some(isFiltered)) toast('Downloaded the rows shown (filters are on)');
    return;
  }
  try {
    const bytes = await simsTemplate({ pick });
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
