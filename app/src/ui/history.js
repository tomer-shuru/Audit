// File › Change history (shared projects): who changed what and when, newest first, grouped by day.
// Built from everyone's part files (engine/parts.js changeHistory); a search box narrows it to an item or a person,
// and clicking an item shows its row on the Final Report.
import { changeHistory } from '../engine/parts.js';
import { state, otherParts } from './state.js';
import { $, esc, plural } from './util.js';
import { fieldLabel } from './collab.js';
import { showItem } from './report-tab.js';

const SHOWN_MAX = 500; // more than this: search to narrow it down
const COLLECTION_WORDS = { manual: 'Manual entry', overrides: 'Final Report', simsOverrides: 'Final Report (SIMS)' };

const quote = v => `“${esc(v)}”`;
const names = list => list.map(quote).join(', ');

// one change in words (HTML)
function describe(e) {
  switch (e.c) {
    case 'sheet': return e.cleared ? 'cleared the Google Sheet rows' : 'pasted the Google Sheet rows';
    case 'reports': return `changed their Mac / Windows report lines (now ${plural(e.lines, 'line')})`;
    case 'bios': return e.file ? `loaded the BIOS password file ${quote(e.file)}` : 'removed the BIOS password file';
    case 'blancco': return [e.added.length && `added Blancco ${e.added.length === 1 ? 'file' : 'files'} ${names(e.added)}`,
      e.removed.length && `removed Blancco ${e.removed.length === 1 ? 'file' : 'files'} ${names(e.removed)}`].filter(Boolean).join(', ');
  }
  if (e.add) return 'added the manual entry';
  if (e.del) return 'deleted the manual entry';
  const where = `${COLLECTION_WORDS[e.c]} · <b>${esc(fieldLabel(e.c, e.f))}</b>`;
  // a Final Report edit that is cleared goes back to the value the report works out
  const cleared = e.c === 'manual' ? 'cleared' : 'edit removed (back to the report\'s own value)';
  const was = e.was ? ` <span class="muted">(was ${quote(e.was)})</span>` : '';
  return e.v === '' ? `${where}: ${cleared}${was}` : `${where} → ${quote(e.v)}${was}`;
}

const day = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const time = t => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export function openHistory() {
  if (!state.collab) return;
  const all = changeHistory([state.collab.mine, ...otherParts()]);
  $('#collabTitle').textContent = 'Change history';
  $('#collabActions').innerHTML = '';
  $('#collabBody').innerHTML = `
    <p class="hint">Everyone's changes to this shared project, newest first. Click an item to see it on the Final Report.</p>
    <input type="search" id="historySearch" class="open-search" placeholder="Search an item, a person or a value…" aria-label="Search the history">
    <div id="historyList"></div>`;
  const list = $('#historyList'), search = $('#historySearch');
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const found = q ? all.filter(e => [e.code, e.person, e.f && fieldLabel(e.c, e.f), e.v, e.was, ...(e.added || []), ...(e.removed || []), e.file]
      .some(v => String(v ?? '').toLowerCase().includes(q))) : all;
    const shown = found.slice(0, SHOWN_MAX);
    let lastDay = '';
    list.innerHTML = !found.length ? `<p class="empty">${all.length ? 'No change matches the search.' : 'No changes yet.'}</p>`
      : `<ul class="history-list">${shown.map(e => {
        const d = day(e.at), head = d !== lastDay ? `<li class="history-day">${esc(d)}</li>` : '';
        lastDay = d;
        return `${head}<li><span class="muted">${time(e.at)}</span> <b>${esc(e.person)}</b>
          ${e.code ? `<button class="link" data-item="${esc(e.code)}">${esc(e.code)}</button>` : ''} ${describe(e)}</li>`;
      }).join('')}</ul>
      ${found.length > SHOWN_MAX ? `<p class="hint">The newest ${SHOWN_MAX} of ${found.length} changes are shown. Search to find older ones.</p>` : ''}`;
    list.querySelectorAll('[data-item]').forEach(b => b.onclick = () => { $('#collabDialog').close(); showItem(b.dataset.item); });
  };
  search.oninput = draw;
  draw();
  if (!$('#collabDialog').open) $('#collabDialog').showModal();
  search.focus();
}
