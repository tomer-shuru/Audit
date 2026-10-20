// Shared projects: keeping everyone's work in step (the windows to share, open and leave one are in share.js).
// Several people work on one project at the same time (see engine/parts.js). It lives in
// G:\My Drive\Audit Builder\Projects\<End client_Project number>\: everyone's app writes only its own <name>.part.json
// (a moment after each change) and reads the others' every few seconds. state.project is everyone's work together:
// inputs.reports and inputs.blanccoFiles are this person's own (the others' are added in reportProject); manual entries,
// Final Report edits and the Google Sheet rows are everyone's. Project settings are changed by the person who shared it.
import { reportColumns, MANUAL_FIELDS } from '../engine/report.js';
import { SIMS_COLUMNS } from '../engine/sims.js';
import { normalizePart, diffShared, patchShared, recordOps, combineParts, combinedInputs } from '../engine/parts.js';
import { PROJECT_JSON, partFileName, projectDir, readJson, writeJson, readParts } from './sharedfiles.js';
import { state, load, store, history, otherParts, canEditSettings, STORE_PROJECT, STORE_DEVICE, STORE_COLLAB } from './state.js';
import { $, toast, flash, ago, renderSyncState } from './util.js';
import { ICONS } from './icons.js';
import { recompute, render, renderChrome } from './app.js';
import { folder } from './folder.js';
import { collabRootAsk, openPeople } from './share.js';

// how often the others' parts are checked while the app is in view: cheap (a file that hasn't changed isn't read
// again); Google Drive taking a few seconds up to a minute to bring a change is the real wait
export const COLLAB_POLL = 5000;
const SAVE_DELAY = 1500;
export const thisDevice = load(STORE_DEVICE, '') || (() => {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  store(STORE_DEVICE, id);
  return id;
})();

export const sharedView = p => structuredClone({ manual: p.manual, overrides: p.overrides, simsOverrides: p.simsOverrides, sheet: p.inputs.sheet });
export const collabRoot = () => (folder.handle && !folder.pending ? folder.handle : null);
export const collabUnsaved = () => !!state.collab && (state.collab.dirty || state.collab.writing || state.collab.settingsDirty);

// the project the report is built from: this person's inputs plus everyone else's
export function reportProject() {
  if (!state.collab) return state.project;
  const mine = { person: state.collab.me, inputs: state.project.inputs };
  return { ...state.project, inputs: { ...state.project.inputs, ...combinedInputs([mine, ...otherParts()]) } };
}

// state.collab: { dir (the project's folder name), owner, me, mine (this person's part), others ({ file: { part, … } }),
//   base (the shared data as last recorded), stamps, conflicts, settingsText, settingsAt,
//   dirty / settingsDirty (not written yet), writing, reading, error, savedAt, readAt, timer }
export function newCollab(c) {
  return {
    others: {}, base: null, stamps: {}, conflicts: [], settingsText: '', settingsAt: 0,
    dirty: false, settingsDirty: false, writing: false, reading: false, error: '', savedAt: 0, readAt: 0, timer: 0,
    ...c,
  };
}
export function setCollab(c) {
  if (state.collab) clearTimeout(state.collab.timer);
  state.collab = c;
  persistCollab();
}
// kept on this computer too, so a shared project opens again after a restart (and nothing is lost while offline)
function persistCollab() {
  const c = state.collab;
  store(STORE_COLLAB, c && {
    dir: c.dir, owner: c.owner, me: c.me, mine: c.mine, stamps: c.stamps,
    dirty: c.dirty, settingsDirty: c.settingsDirty, settingsAt: c.settingsAt, settingsText: c.settingsText,
  });
}
export function restoreCollab() {
  const s = load(STORE_COLLAB, null);
  if (!s?.dir || !s.mine) return null;
  return newCollab({ ...s, mine: normalizePart(s.mine), stamps: s.stamps || {}, base: sharedView(state.project) });
}

// after every change: what this person changed goes into their part, which is saved a moment later
export function recordMine() {
  const c = state.collab;
  const now = sharedView(state.project);
  const ops = diffShared(c.base, now);
  recordOps(c.mine, ops, c.stamps);
  c.base = now;
  // setting a cell again (having seen the other value) settles a clash
  if (ops.length && c.conflicts.length) c.conflicts = combineParts([c.mine, ...otherParts()]).conflicts;
  const { reports, blanccoFiles, bios } = state.project.inputs;
  const inputsChanged = reports !== c.mine.inputs.reports || JSON.stringify(blanccoFiles) !== JSON.stringify(c.mine.inputs.blanccoFiles)
    || bios?.at !== c.mine.inputs.bios?.at;
  c.mine.inputs = { reports, blanccoFiles: structuredClone(blanccoFiles), bios };
  const settings = JSON.stringify(state.project.settings);
  if (settings !== c.settingsText && canEditSettings()) { c.settingsText = settings; c.settingsAt = Date.now(); c.settingsDirty = true; }
  if (ops.length || inputsChanged) c.dirty = true;
  persistCollab();
  if (c.dirty || c.settingsDirty) {
    clearTimeout(c.timer);
    c.timer = setTimeout(() => saveMine(), SAVE_DELAY);
  }
}

async function collabDir(root) {
  const dir = await projectDir(root, state.collab.dir);
  if (!dir) throw Object.assign(new Error(`the folder Projects\\${state.collab.dir} isn't in the shared folder any more`), { name: 'NotFoundError' });
  return dir;
}

// writes this person's part (and the settings, for the person who shared the project)
export async function saveMine({ announce = false } = {}) {
  const c = state.collab;
  if (!c) return;
  clearTimeout(c.timer);
  const root = collabRoot();
  if (!root) {
    renderChrome();
    if (announce) toast('Not saved yet: the Audit Builder folder isn\'t connected. Click the status at the top to connect it.', 'bad');
    return;
  }
  if (c.writing) { c.timer = setTimeout(() => saveMine({ announce }), 300); return; } // one write at a time
  const part = c.dirty, settings = c.settingsDirty;
  c.writing = true; c.dirty = false; c.settingsDirty = false;
  renderChrome();
  try {
    const dir = await collabDir(root);
    if (part) { c.mine.updatedAt = Date.now(); await writeJson(dir, partFileName(c.me), c.mine); }
    if (settings) await writeJson(dir, PROJECT_JSON, { version: 1, owner: c.owner, settings: state.project.settings, settingsAt: c.settingsAt });
    c.error = ''; c.savedAt = Date.now();
    if (announce) toast('Saved to the shared project');
  } catch (err) {
    if (part) c.dirty = true;
    if (settings) c.settingsDirty = true;
    c.error = err.message;
    if (announce) toast(`Not saved: ${err.message}`, 'bad');
  } finally {
    c.writing = false;
    if (state.collab === c) { persistCollab(); renderChrome(); }
  }
}

// typing in a box: the page isn't redrawn under the person's hands (it waits until they pause)
let lastTyped = 0;
document.addEventListener('input', () => { lastTyped = Date.now(); }, true);
function isEditing() {
  const a = document.activeElement;
  if (!a || a === document.body) return false;
  if (a.isContentEditable) return true; // a table cell being typed in
  return a.matches('textarea, input') && !a.matches('.grid-sink, [type=checkbox], [type=file], [readonly]') && Date.now() - lastTyped < 4000;
}

// reads the others' parts (and the settings) and brings their changes in
export async function refreshCollab() {
  const c = state.collab;
  const root = collabRoot();
  if (!c || !root || c.reading) return;
  c.reading = true;
  try {
    const dir = await collabDir(root);
    let info = null;
    try { info = (await readJson(dir, PROJECT_JSON))?.data; } catch { /* still syncing: next time */ }
    const others = await readParts(dir, c.others, partFileName(c.me));
    const first = !c.readAt; // the first read after the app opened: everything is "new", so nothing is announced
    c.readAt = Date.now();
    if (c.error.includes('Projects\\')) c.error = '';
    const changed = Object.entries(others).filter(([k, o]) => c.others[k] !== o).map(([k]) => k);
    const partsChanged = changed.length || Object.keys(others).length !== Object.keys(c.others).length;
    const settingsChanged = !!info && !canEditSettings() && (info.settingsAt || 0) !== c.settingsAt;
    if (!partsChanged && !settingsChanged) return;
    if (isEditing()) { setTimeout(() => refreshCollab(), 2500); return; } // read again once they pause
    const joined = changed.filter(k => !c.others[k]).map(k => others[k].part.person);
    const by = changed.filter(k => c.others[k]).map(k => others[k].part.person);
    c.others = others;
    if (settingsChanged) {
      Object.assign(state.project.settings, info.settings);
      c.owner = info.owner || c.owner;
      c.settingsAt = info.settingsAt || 0;
      c.settingsText = JSON.stringify(state.project.settings);
    }
    const before = rowSignatures();
    applyCombined();
    if (!first) tellWhatArrived({ by, joined, settingsBy: settingsChanged ? c.owner : '', rows: changedRows(before, rowSignatures()) });
  } catch (err) {
    c.error = err.message;
  } finally {
    c.reading = false;
    if (state.collab === c) renderChrome();
  }
  if (c.dirty && !c.writing && state.collab === c) saveMine(); // changes made while it couldn't save
}

// everyone's parts together → state.project, keeping the objects the open tables use
function applyCombined() {
  const c = state.collab;
  const { view, stamps, conflicts } = combineParts([c.mine, ...otherParts()]);
  const ops = diffShared(c.base, view);
  patchShared(state.project, ops);
  // undo / redo keep working: the others' changes go into the remembered steps too, so undo only undoes your own
  const rebase = list => list.map(s => JSON.stringify(patchShared(JSON.parse(s), ops)));
  history.undo = rebase(history.undo); history.redo = rebase(history.redo);
  c.base = sharedView(state.project); c.stamps = stamps; c.conflicts = conflicts;
  persistCollab();
  store(STORE_PROJECT, state.project);
  recompute();
  // redraw, keeping the cursor in the box the person was in
  const active = document.activeElement, id = active?.id;
  const sel = id && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  render();
  const again = id && document.getElementById(id);
  if (again && again !== active) { again.focus(); if (sel) try { again.setSelectionRange(...sel); } catch { /* not a text box */ } }
}

// ---------- what the others' changes did ----------
// every report row as text, to see which rows an update changed (whatever it was: a cell, a manual entry,
// their report lines or Blancco files)
const rowSignatures = () => new Map(state.report.rows.map(r => [r.itemLookup, JSON.stringify(r, (k, v) => (k.startsWith('_') ? undefined : v))]));
const changedRows = (a, b) => [...b].filter(([code, sig]) => a.get(code) !== sig).map(([code]) => code)
  .concat([...a.keys()].filter(code => !b.has(code))); // and rows that are gone

// says what arrived ("Dana updated GG04, GG05") and flashes those rows in the open table
function tellWhatArrived({ by, joined, settingsBy, rows }) {
  const names = list => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]);
  const items = rows.length > 6 ? `${rows.slice(0, 5).join(', ')} and ${rows.length - 5} more` : rows.join(', ');
  const said = [];
  if (settingsBy) said.push(`${settingsBy} changed the project setup`);
  else if (rows.length) said.push(`${names(by.length ? by : joined) || 'Someone'} updated ${items}`);
  if (joined.length) said.push(`${names(joined)} joined the shared project`);
  if (!said.length) return;
  toast(said.join('. '));
  if (settingsBy) return; // every row may have changed: nothing to point at
  const shown = new Set(rows);
  for (const tr of document.querySelectorAll('#main tr[data-code]')) if (shown.has(tr.dataset.code)) flash(tr);
}

// cells two people changed at the same moment: a note on the Final Report (the newest value is used)
export function conflictWarnings() {
  const label = (c, f) => {
    const cols = c === 'manual' ? MANUAL_FIELDS : c === 'simsOverrides' ? SIMS_COLUMNS : reportColumns(state.config);
    const col = cols.find(([k]) => k === f);
    return col ? col[2] ?? col[1] : f;
  };
  return state.collab.conflicts.map(x => ({
    level: 'info', item: x.code,
    text: `${x.code} ${label(x.c, x.f)}: ${x.kept.person} and ${x.lost.person} changed it at the same time. ${x.kept.person}'s "${x.kept.v || '(empty)'}" is used (the newest); ${x.lost.person} had "${x.lost.v || '(empty)'}".`,
  }));
}

// "3 s ago": the status is redrawn after every check, so seconds are worth showing
const since = t => { const s = Math.round((Date.now() - t) / 1000); return s < 5 ? 'just now' : s < 60 ? `${s} s ago` : ago(t); };

// the save status at the top, like Google Sheets: Saving… / Saved · checked 3 s ago / Not saved / Not connected.
// Hovering says when the others' changes were last checked and when each of them last changed something.
export function renderCollabState(el) {
  const c = state.collab;
  const others = Object.values(c.others).map(o => o.part).filter(p => p.updatedAt).sort((a, b) => b.updatedAt - a.updatedAt);
  const sync = [
    c.readAt ? `Checked for the others' changes ${since(c.readAt)} (every few seconds while the app is in view).` : 'Checking for the others\' changes…',
    ...others.map(p => `${p.person}'s last change: ${since(p.updatedAt)}.`),
    'Google Drive can take up to a minute to bring a change from another computer.',
  ].join('\n');
  renderSyncState(el,
    !collabRoot() ? ['off', ICONS.off, collabUnsaved() ? 'Not connected · changes kept here' : 'Not connected',
      'The Audit Builder folder isn\'t connected, so changes can\'t be shared. Click to connect it.']
    : c.error ? ['bad', ICONS.error, 'Not saved', `Couldn't save to the shared project: ${c.error}. Click to try again.`]
    : collabUnsaved() ? ['busy', ICONS.sync, 'Saving…', `Saving your changes to the shared project\n${sync}`]
    : ['good', ICONS.done, c.readAt ? `Saved · checked ${since(c.readAt)}` : 'Saved to Drive',
      `All your changes are saved in the shared project${c.savedAt ? ` (at ${new Date(c.savedAt).toLocaleTimeString()})` : ''}.\n${sync}`]);
}
export function renderPeopleChip() {
  const b = $('#peopleChip');
  b.hidden = !state.collab;
  $('#btnLeaveShared').hidden = !state.collab;
  if (!state.collab) return;
  const n = 1 + Object.keys(state.collab.others).length;
  b.innerHTML = `${ICONS.people}<span>Shared · ${n === 1 ? '1 person' : `${n} people`}</span>`;
  b.title = `Shared project (Projects\\${state.collab.dir}). Click to see who is working on it.`;
}
// clicking the save status of a shared project: connect, try again, or see who works on it
export function clickCollabState() {
  if (!collabRoot()) { collabRootAsk(); return; }
  if (state.collab.error) { saveMine({ announce: true }); refreshCollab(); return; }
  openPeople();
}
