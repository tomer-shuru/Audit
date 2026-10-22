// Send to Google Sheet (Final Report) and Load from Google Sheet (Data tab), for a project with a Google Sheet link
// (Project setup). They go through the Apps Script set up in DevMode › Google Sheets (google-sheets/AuditBuilderSheets.gs),
// because the app, opened as a file, can't sign in to Google itself. Where the rows go is worked out in engine/gsheet.js.
// Send shows what it would change first, asking about cells that already have something else.
import { sheetLink, planSend, sheetRowsText } from '../engine/gsheet.js';
import { state } from './state.js';
import { $, esc, plural, toast } from './util.js';
import { changed } from './app.js';
import { exportCols, shownRows, isFiltered, mainKind, SHEETS } from './report-view.js';
import { okToExport } from './export.js';

// the project's sheet ({ id, gid }) when it has a link and the script is set up, else null
export const projectSheet = () => (state.config.googleSheets.scriptUrl.trim() ? sheetLink(state.project.settings.sheetUrl) : null);

// a request to the Apps Script; its answer, or an Error with a message for people
async function callScript(action, body = {}) {
  const { scriptUrl, key } = state.config.googleSheets;
  const sheet = sheetLink(state.project.settings.sheetUrl);
  let text;
  try {
    // plain text, so the browser sends it straight away (a JSON content type would need Google to allow it first)
    const res = await fetch(scriptUrl.trim(), { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ key, action, sheetId: sheet.id, gid: sheet.gid, ...body }) });
    text = await res.text();
  } catch (err) {
    throw new Error(`couldn't reach the Google Sheets script (${err.message}). Check the internet connection, and the web app URL in DevMode › Google Sheets.`);
  }
  let answer;
  try { answer = JSON.parse(text); } catch {
    // an error page from Google instead of the script's answer: the script's account can't open the sheet
    throw new Error('Google refused to open this sheet for the script. The Google account that set up the script (DevMode › Google Sheets) needs edit access to it: '
      + 'share the sheet with that account, or set up the script with the account that has the sheet.');
  }
  // changed: the sheet isn't what it was when read, so nothing was written
  if (answer.error) throw Object.assign(new Error(scriptError(answer.error)), { changed: answer.error.startsWith('changed:') });
  return answer;
}

function scriptError(text) {
  if (text.startsWith('not-a-sheet')) {
    return 'the link isn\'t a Google Sheet the script can open. If it is an Excel file (.xlsx) in Drive, open it, choose File › Save as Google Sheets, and use the new sheet\'s link. '
      + 'Otherwise check that the account that set up the script can edit the sheet.';
  }
  if (text.startsWith('changed:')) return text.slice(8).trim();
  return text;
}

// ---------- the sheet, read ahead ----------
// Every request to the script takes a second or two, mostly Google starting it. So the Final Report reads the sheet
// ahead (readAhead), and Send shows what it would change from that copy at once. A copy up to a minute old is safe:
// the script writes nothing if a cell it would write (or an item cell next to it) changed since it was read, and
// Send then reads the sheet again and shows what it has now.
const FRESH = 60000; // a copy older than this isn't used
const ahead = { link: '', at: 0, sheet: null, reading: null };

// reads the sheet (or waits for the read already going on) and keeps the copy
function readSheet() {
  const link = state.project.settings.sheetUrl;
  if (ahead.link !== link) Object.assign(ahead, { link, at: 0, sheet: null, reading: null });
  ahead.reading ??= (async () => {
    try {
      const sheet = await callScript('read');
      if (ahead.link === link) Object.assign(ahead, { sheet, at: Date.now() });
      return sheet;
    } finally {
      if (ahead.link === link) ahead.reading = null;
    }
  })();
  return ahead.reading;
}
const freshCopy = () => (ahead.link === state.project.settings.sheetUrl && Date.now() - ahead.at < FRESH ? ahead.sheet : null);
const forgetCopy = () => { ahead.at = 0; };

// the Final Report is open: read the sheet in the background, unless a fairly new copy is there or a read is going on
export function readAhead() {
  if (!projectSheet() || (ahead.reading && ahead.link === state.project.settings.sheetUrl)) return;
  if (freshCopy() && Date.now() - ahead.at < FRESH / 2) return;
  readSheet().catch(() => { /* said when Send is clicked */ });
}

// ---------- Send to Google Sheet ----------
// note: said above the check (after the sheet changed while the window was open)
export async function sendToSheet({ note = '' } = {}) {
  if (!projectSheet() || (!note && !okToExport())) return;
  const kind = mainKind();
  const cols = exportCols(kind), rows = shownRows(kind).filter(r => !r._empty);
  if (!rows.length) { toast('No rows to send. Clear the filters to see them.', 'bad'); return; }
  let sheet = freshCopy();
  if (!sheet) {
    openSendWindow('<p class="empty">Reading the Google Sheet…</p>', '', 'Cancel');
    try { sheet = await readSheet(); } catch (err) { closeSendWindow(); toast(`Couldn't read the Google Sheet: ${err.message}`, 'bad'); return; }
    if (!$('#collabDialog').open) return; // cancelled while reading
  }
  const plan = planSend({ values: sheet.values, cols, rows, settings: state.project.settings, itemPrefix: state.config.texts.itemPrefix });
  if (plan.error) { closeSendWindow(); toast(`Can't send: ${plan.error}`, 'bad'); return; }
  showPlan({ plan, sheet, kind, filtered: isFiltered(kind), count: rows.length, note });
}

// the Send window with this body and these buttons; its own button (closing it, sending nothing) says close.
// The other windows sharing it expect Done: closing it by that button or from here puts Done back (and the close
// event for Esc, which the browser sends a moment later)
function openSendWindow(body, actions, close) {
  $('#collabTitle').textContent = 'Send to Google Sheet';
  $('#collabBody').innerHTML = body;
  $('#collabActions').innerHTML = actions;
  $('#collabClose').textContent = close;
  $('#collabDialog').addEventListener('close', () => { $('#collabClose').textContent = 'Done'; }, { once: true });
  if (!$('#collabDialog').open) $('#collabDialog').showModal();
}
function closeSendWindow() {
  $('#collabDialog').close();
  $('#collabClose').textContent = 'Done';
}

const list = (codes, max = 12) => esc(codes.length > max ? `${codes.slice(0, max).join(', ')} and ${codes.length - max} more` : codes.join(', '));

// what Send would do, with the buttons to do it
function showPlan({ plan, sheet, kind, filtered, count, note }) {
  const { fills, collisions, newItems, headers, duplicates } = plan;
  const filledItems = [...new Set(fills.map(f => f.item))];
  const nothing = !fills.length && !collisions.length && !newItems.length;
  openSendWindow(`
    ${note ? `<div class="banner warn">${esc(note)}</div>` : ''}
    <p class="hint">${esc(sheet.title)} › <b>${esc(sheet.tab)}</b>: ${SHEETS[kind].title}, ${filtered ? `only the ${plural(count, 'row')} the filters show` : plural(count, 'row')}.
      Each row goes to the sheet row with the same item; cells empty here don't change the sheet, and columns after ours (prices…) aren't touched.</p>
    ${headers.length ? `<div class="banner warn">The sheet's headers don't match these columns: ${headers.map(h => `${esc(h.label)} goes under <b>${esc(h.theirs)}</b>`).join(', ')}.
      Check the columns shown on the Final Report (hide the ones the sheet doesn't have) before sending.</div>` : ''}
    ${duplicates.length ? `<div class="banner warn">In the sheet more than once: ${list(duplicates)}. Only the first row of each is filled.</div>` : ''}
    <ul class="send-plan">
      ${fills.length ? `<li><b>${plural(fills.length, 'empty cell')}</b> filled in ${plural(filledItems.length, 'item')}: ${list(filledItems)}</li>` : ''}
      ${newItems.length ? `<li><b>${plural(newItems.length, 'new row')}</b>, each in item order: ${list(newItems.map(n => n.item))}</li>` : ''}
      ${plan.same ? `<li class="muted">${plural(plan.same, 'cell')} already the same</li>` : ''}
      ${nothing ? '<li>Nothing to send: the sheet already has everything shown here.</li>' : ''}
    </ul>
    ${collisions.length ? `<h3>${plural(collisions.length, 'cell')} already ${collisions.length === 1 ? 'has' : 'have'} something else in the sheet</h3>
    <div class="table-wrap send-collisions"><table class="grid">
      <thead><tr><th>Item</th><th>Column</th><th>In the sheet</th><th>Here</th></tr></thead>
      <tbody>${collisions.map(x => `<tr><td>${esc(x.item)}</td><td>${esc(x.label)}</td><td>${esc(x.theirs)}</td><td><b>${esc(x.ours)}</b></td></tr>`).join('')}</tbody>
    </table></div>` : ''}`,
  nothing ? '' : collisions.length
    ? '<button class="btn" id="sendSkip">Skip them and send</button><button class="btn primary" id="sendOverwrite">Overwrite them and send</button>'
    : '<button class="btn primary" id="sendGo">Send</button>',
  nothing ? 'Done' : 'Cancel');
  const go = overwrite => () => writePlan(plan, overwrite);
  $('#sendGo')?.addEventListener('click', go(false));
  $('#sendSkip')?.addEventListener('click', go(false));
  $('#sendOverwrite')?.addEventListener('click', go(true));
}

async function writePlan(plan, overwrite) {
  const buttons = $('#collabActions').querySelectorAll('button');
  buttons.forEach(b => { b.disabled = true; });
  toast('Sending to the Google Sheet…');
  try {
    await callScript('write', plan.request(overwrite));
  } catch (err) {
    if (err.changed) { // someone changed the sheet since it was read: read it again and show what it has now
      forgetCopy();
      sendToSheet({ note: 'Nothing was sent: the sheet changed since it was read. This is what it has now. Check it and send again.' });
      return;
    }
    toast(`Not sent: ${err.message}`, 'bad');
    buttons.forEach(b => { b.disabled = false; });
    return;
  }
  forgetCopy();
  readAhead(); // a copy with these changes, for the next Send
  closeSendWindow();
  const said = [plan.fills.length && `${plural(plan.fills.length, 'cell')} filled`,
    plan.collisions.length && (overwrite ? `${plural(plan.collisions.length, 'cell')} overwritten` : `${plural(plan.collisions.length, 'different cell')} skipped`),
    plan.newItems.length && plural(plan.newItems.length, 'new row')].filter(Boolean);
  toast(`Sent to the Google Sheet: ${said.join(', ')}`);
}

// ---------- Load from Google Sheet ----------
// the sheet's item rows go into "Rows already in the Google Sheet" on the Data tab, as if copied and pasted there
export async function loadFromSheet() {
  if (!projectSheet()) return;
  if (state.project.inputs.sheet.trim() && !confirm('Replace the rows in "Rows already in the Google Sheet" with the ones in the sheet now?')) return;
  toast('Reading the Google Sheet…');
  let sheet;
  try { sheet = await readSheet(); } catch (err) { toast(`Couldn't read the Google Sheet: ${err.message}`, 'bad'); return; }
  const got = sheetRowsText({ values: sheet.values, cols: exportCols(mainKind()), settings: state.project.settings, itemPrefix: state.config.texts.itemPrefix });
  if (got.error) { toast(`Couldn't load the sheet: ${got.error}`, 'bad'); return; }
  state.project.inputs.sheet = got.text;
  changed();
  toast(`Loaded ${plural(got.count, 'item row')} from ${sheet.title} › ${sheet.tab}`);
}
