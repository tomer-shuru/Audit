// Help › What's new and Help › How to use Audit Builder.
// The first time the app opens after an update it shows what changed. It remembers the last update this computer
// has seen, so someone who skipped several releases sees all of them at once (newest first; more than three: the
// older ones folded). Someone who used the app before this window existed sees them all; a new user sees none.
//
// For a release worth telling people about, add an entry at the top with the next id.
import guide from '../../docs/How to use Audit Builder.txt';
import { load, store, STORE_PROJECT } from './state.js';
import { $, esc, plural } from './util.js';

export const UPDATES = [
  { id: 2, date: '2026-10-20', items: [
    'Review is now called <b>Final Report</b>, and the Export window is gone. Use the arrow on a column header to filter it (like Google Sheets) or hide the column, then <b>Copy all rows</b> (it says <b>Copy filtered rows</b> when filters are on) or <b>Download</b>. Locked and Faulty is a tab above the table.',
    'The app opens on <b>Project setup</b>: <b>Continue where you left off</b>, <b>Open a project…</b>, or set up a new one. File › New project shows the same window.',
    'New in Tools: <b>Shared Files</b> (files for everyone, kept in the Drive) and <b>PDF merger</b> (merge the wiping reports into one PDF, also from a .zip).',
    'Manual entries: tick one row, then Shift-click another to tick everything in between.',
    'New check: the same serial number (S.N.) on more than one item.',
    'If something unexpected goes wrong, a red message says so: click <b>Copy details</b> and send them along.',
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
