// Help › What's new and Help › How to use Audit Builder.
// The first time the app opens after an update it shows what changed. It remembers the last update this computer
// has seen, so someone who skipped several releases sees all of them at once (newest first; more than three: the
// older ones folded). Someone who used the app before this window existed sees them all; a new user sees none.
//
// For a release worth telling people about, add an entry at the top with the next id. Don't add lines to an entry
// that was already released: whoever saw it then never sees the new lines.
import guide from '../../docs/How to use Audit Builder.txt';
import { load, store, STORE_PROJECT } from './state.js';
import { $, esc, plural } from './util.js';

export const UPDATES = [
  { id: 9, date: '2026-10-22', items: [
    '<b>Send to Google Sheet</b> opens at once: the Final Report reads the sheet in the background. If someone changed a cell in the sheet since then, nothing is written; the window shows what the sheet has now, to check and send again.',
    'New rows added by Send look like the sheet\'s normal rows (not like its header).',
  ] },
  { id: 8, date: '2026-10-22', items: [
    'New, optional: a <b>Google Sheet link</b> in Project setup. With it, the Final Report has <b>Send to Google Sheet</b>: each row goes to its item\'s row in the sheet, new items are added in order, and cells the sheet already has differently are listed first, to overwrite or skip. Copy all rows works as before.',
    'With the link, the Data tab also has <b>Load from Google Sheet</b>, instead of copying the sheet\'s rows by hand.',
  ] },
  { id: 7, date: '2026-10-22', items: [
    'New: Tools › <b>Find a device</b>. Search every project in the Projects folder by item code (GG07), item number, serial number or asset tag, and open the project right at that device.',
    'New for shared projects: File › <b>Change history</b> (also in the "Shared · people" window). Who changed what and when, with what it was before. Click an item to see it on the Final Report.',
    'Settings › Dictionary › Models now lists the Mac models in the open project that aren’t in the list yet, each with an <b>Add</b> button. Apple models that came only from Blancco also get a gray note on the Final Report.',
  ] },
  { id: 6, date: '2026-10-21', items: [
    'New output: <b>Google</b> (Output picker in the top bar). The Final Report then shows Google’s ITAD REPORT columns, Item to Weight (KG). It is the same data as Shuru, so edits carry over.',
    'The Final Report tab takes the color of the output (Shuru blue-grey, SIMS royal blue, Google green), with a "layout" tag next to its title, so it is clear which one you are copying.',
    'Fixed: models from Blancco now go through the Dictionary’s <b>Model cleanup</b> list too (it only worked for Windows reports), so “HP ZBook Firefly 14 inch G11 Mobile Workstation PC” becomes “ZBook Firefly 14 inch G11”.',
  ] },
  { id: 5, date: '2026-10-21', items: [
    'SIMS projects: <b>Locked and Faulty</b> is now SIMS’s <b>Locked devices request</b> (Lock Type, Client asset tag, Serial No., IMEI No., Model No., Password), with a row per lock of each device that is locked now. Download › Locked devices request fills their workbook, with its Lock Type drop-down.',
    'The Lock Type comes from the Locked or Faulty text (Bios Locked = Bios Password, Find My / Apple ID = Apple Find My, Remote Locked = Apple DEP on a Mac…), set in DevMode › Locked and Faulty.',
  ] },
  { id: 4, date: '2026-10-21', items: [
    '<b>Locked and Faulty fills itself</b>: a diagnostic from any input that says BIOS locked, Remote locked, Remote managed, RM, Apple ID / Find My / iCloud / MDM locked, Dead, MB defect or Bad MB also goes to the Locked or Faulty column and the Locked and Faulty list. Capitals don’t matter; only whole words count (RM, not ARM). Type “-” in the Locked or Faulty cell to take a device off the list.',
    'The words are in Settings › DevMode › <b>Locked and Faulty</b>, where they can be changed and new ones added.',
  ] },
  { id: 3, date: '2026-10-21', items: [
    '<b>Alt+S</b> jumps to the search box of the tab or window in front, so you can start typing.',
    'Fixed: a Mac whose report says "Remote Locked" (not only "Remote Lock") is now marked <b>Remote Locked</b> and listed on Locked and Faulty.',
  ] },
  { id: 2, date: '2026-10-20', items: [
    'Review is now called <b>Final Report</b>, and the Export window is gone. Use the arrow on a column header to filter it (like Google Sheets) or hide the column, then <b>Copy all rows</b> (it says <b>Copy filtered rows</b> when filters are on) or <b>Download</b>. Locked and Faulty is a tab above the table.',
    'The app opens on <b>Project setup</b>: <b>Continue where you left off</b>, <b>Open a project…</b>, or set up a new one. File › New project shows the same window.',
    'New in Tools: <b>Shared Files</b> (files for everyone, kept in the Drive) and <b>PDF merger</b> (merge the wiping reports into one PDF, also from a .zip).',
    'Manual entries: tick one row, then Shift-click another to tick everything in between.',
    'New check: the same serial number (S.N.) on more than one item.',
    'Fixed: RAM from newer Blancco exports showed "16 GB DDR4;Empty slot"; it is now "16 GB DDR4".',
    'If something unexpected goes wrong, a red message says so: click <b>Copy details</b> and send them along.',
    'Shared projects: coworkers\' changes are checked every 5 seconds; a message says what came in ("Dana updated GG04, GG05") and those rows flash. The status at the top says when it last checked.',
  ] },
  { id: 1, date: '2026-10-19', items: [
    'Item groups: with prefix MS, codes like MS-M01 or MSP01 are found by themselves, each numbered from 1.',
    'An item number far above the others (a typo like GG9999) gets a red check instead of thousands of empty rows.',
    'A new project is saved in the Projects folder as soon as it is set up, so it saves itself from the start.',
    'Other files dropped with the Blancco exports (PDFs…) are skipped, and removing a Blancco file can be undone.',
  ] },
];
const STORE_SEEN = 'auditApp.seenUpdate';
const OPEN_AT_ONCE = 3;

function showUpdates(list, title) {
  const entry = u => `<section class="update"><h3>${new Date(u.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</h3>
    <ul>${u.items.map(t => `<li>${t}</li>`).join('')}</ul></section>`;
  const older = list.slice(OPEN_AT_ONCE);
  $('#helpTitle').textContent = title;
  $('#helpBody').innerHTML = `<div class="updates">${list.slice(0, OPEN_AT_ONCE).map(entry).join('')}
    ${older.length ? `<details><summary>${plural(older.length, 'earlier update')}</summary>${older.map(entry).join('')}</details>` : ''}
    <p class="hint">Everything is explained in Help › How to use Audit Builder.</p></div>`;
  $('#helpDialog').showModal();
}

// on start: the updates this computer hasn't seen yet (all of them, when it skipped some)
export function showNewUpdates() {
  const latest = UPDATES[0].id;
  const seen = load(STORE_SEEN, null);
  const usedBefore = seen !== null || localStorage.getItem(STORE_PROJECT) !== null;
  store(STORE_SEEN, latest);
  const missed = usedBefore ? UPDATES.filter(u => u.id > (seen ?? 0)) : [];
  if (missed.length) showUpdates(missed, missed.length > 1 ? `What's new: ${plural(missed.length, 'update')} since you last opened Audit Builder` : 'What\'s new');
}

export function initHelp() {
  $('#btnWhatsNew').onclick = () => showUpdates(UPDATES, 'What\'s new');
  $('#btnGuide').onclick = () => {
    $('#helpTitle').textContent = 'How to use Audit Builder';
    $('#helpBody').innerHTML = `<p class="hint">Ctrl+F finds a word. The same text is in "How to use Audit Builder.txt" next to the app.</p><pre class="guide">${esc(guide)}</pre>`;
    $('#helpDialog').showModal();
    $('#helpBody').scrollTop = 0;
  };
  $('#helpClose').onclick = () => $('#helpDialog').close();
}
