// Shared projects: File › Share project, opening (joining) one, who works on it, and leaving it.
// Keeping them in step while they're open is in collab.js.
import { emptyPart, normalizePart, combineParts } from '../engine/parts.js';
import { PROJECT_JSON, partFileName, projectDirName, projectDir, readJson, readParts } from './sharedfiles.js';
import { canUseFolder } from './filesave.js';
import { state, load, store, emptyProject, migrate, settingsComplete, otherParts, clearHistory, STORE_PERSON } from './state.js';
import { $, esc, plural, toast, ago } from './util.js';
import { recompute, render, replaceProject } from './app.js';
import { folder, allowFolder, connectFolder } from './folder.js';
import { thisDevice, sharedView, collabRoot, collabUnsaved, reportProject, newCollab, setCollab, recordMine, saveMine, refreshCollab } from './collab.js';
import { okToReplace, forgetProjectFile, withoutOwners } from './project.js';
import { openSetup } from './setup.js';
import { parseReports } from './data-tab.js';
import { openHistory } from './history.js';

// connects the shared folder if needed (only from a click: the browser may ask); the folder, or null
export async function collabRootAsk() {
  if (!canUseFolder) { toast('Shared projects need Chrome or Edge', 'bad'); return null; }
  try { await allowFolder(); } catch { /* asked below */ }
  if (!folder.handle) await connectFolder();
  return collabRoot();
}

// asks this person's name once (it names their file in every shared project, and shows who added a shared file)
export function askName({ again = false } = {}) {
  const known = load(STORE_PERSON, '');
  if (known && !again) return Promise.resolve(known);
  return new Promise(resolve => {
    const d = $('#nameDialog'), f = $('#nameForm');
    f.person.value = again ? '' : known;
    $('#nameAgain').hidden = !again;
    f.onsubmit = e => {
      e.preventDefault();
      const name = f.person.value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/[. ]+$/, '');
      if (!name) return;
      store(STORE_PERSON, name);
      resolve(name);
      d.close();
    };
    $('#nameCancel').onclick = () => d.close();
    d.onclose = () => resolve(null);
    d.showModal();
    f.person.focus();
  });
}

// File › Share project: the open project becomes a shared one, with this person as its owner
export async function shareProject() {
  if (state.collab) { openPeople(); return; }
  if (!settingsComplete(state.project.settings)) { openSetup(); toast('Set up the project first', 'bad'); return; }
  const root = await collabRootAsk();
  if (!root) return;
  const me = await askName();
  if (!me) return;
  const name = projectDirName(state.project.settings);
  try {
    const existing = await projectDir(root, name);
    if (existing && await readJson(existing, PROJECT_JSON).catch(() => true)) {
      toast(`${name} is already a shared project. Open it with File › Open.`, 'bad');
      return;
    }
    const dir = await projectDir(root, name, true);
    if (!dir) throw new Error('couldn\'t make the project folder');
    const c = newCollab({ dir: name, owner: me, me, mine: emptyPart(me, thisDevice), base: sharedView(emptyProject()) });
    setCollab(c);
    recordMine({ log: false }); // everything in the project so far is this person's (not a change to list in the history)
    c.dirty = true; // their file is written even while the project is still empty
    clearHistory();
    forgetProjectFile();
    await saveMine();
    recompute(); render();
    if (c.error) toast(`Shared, but not saved yet: ${c.error}`, 'bad');
    else toast('Project shared. Coworkers open it with File › Open.');
  } catch (err) { toast(`Couldn't share the project: ${err.message}`, 'bad'); }
}

// opens a shared project from the Open window (entry: from listSharedProjects); true when it opened
export async function joinShared(entry, { again = false } = {}) {
  if (!okToReplace()) return false;
  const me = await askName({ again });
  if (!me) return false;
  try {
    const dir = entry.dir, mineFile = partFileName(me);
    const own = await readJson(dir, mineFile);
    if (own?.data.device && own.data.device !== thisDevice && !confirm(`There is already a "${me}" in this project, saved from another computer.\n\n`
      + 'OK: that\'s me on another computer. My work from there continues here (don\'t keep the project open on both).\n'
      + 'Cancel: that\'s someone else. I\'ll choose a different name.')) {
      return joinShared(entry, { again: true });
    }
    const mine = own ? normalizePart(own.data) : emptyPart(me, thisDevice);
    mine.person = me; mine.device = thisDevice;
    const others = await readParts(dir, {}, mineFile);
    const { view, stamps, conflicts } = combineParts([mine, ...Object.values(others).map(o => o.part)]);
    const info = (await readJson(dir, PROJECT_JSON))?.data || entry.info;
    setCollab(null);
    state.project = Object.assign(migrate({
      settings: info.settings || {},
      inputs: { reports: mine.inputs.reports, blanccoFiles: mine.inputs.blanccoFiles, sheet: view.sheet, bios: mine.inputs.bios },
      manual: view.manual, overrides: view.overrides, simsOverrides: view.simsOverrides,
    }), { savedToFile: true });
    setCollab(newCollab({
      dir: entry.name, owner: info.owner, me, mine, others, stamps, conflicts,
      base: sharedView(state.project), settingsAt: info.settingsAt || 0, settingsText: JSON.stringify(state.project.settings),
      dirty: !own, // someone new: their (empty) file is written straight away, so the others see them
    }));
    state.manualSelected.clear();
    forgetProjectFile();
    $('#collabDialog').close();
    replaceProject(state.project); render();
    if (state.collab.dirty) saveMine();
    const names = Object.values(others).map(o => o.part.person);
    toast(`Opened ${entry.name}${names.length ? `, shared with ${names.join(', ')}` : ''}`);
    return true;
  } catch (err) { toast(`Couldn't open the shared project: ${err.message}`, 'bad'); return false; }
}

// what one person has added to the shared project
function contribution(p) {
  const { mac, win } = parseReports(p.inputs.reports || '');
  const devices = mac.length + win.length;
  const manual = Object.values(p.items || {}).filter(x => !x.deleted).length;
  const edits = ['overrides', 'simsOverrides'].reduce((n, k) => n + Object.values(p.cells[k] || {}).reduce((m, r) => m + Object.keys(r).length, 0), 0);
  return [devices && plural(devices, 'device') + ' in reports', p.inputs.blanccoFiles.length && plural(p.inputs.blanccoFiles.length, 'Blancco file'),
    manual && plural(manual, 'manual entry').replace('entrys', 'entries'), edits && plural(edits, 'Final Report edit')].filter(Boolean).join(' · ') || 'nothing yet';
}

// who works on the shared project, and what each has added
export function openPeople() {
  const c = state.collab;
  if (!c) return;
  const rows = [[c.mine, true], ...otherParts().map(p => [p, false])];
  $('#collabTitle').textContent = 'Shared project';
  $('#collabBody').innerHTML = `
    <p class="hint">Saved in <code>G:\\My Drive\\Audit Builder\\Projects\\${esc(c.dir)}</code>. Everyone's changes come in every few seconds
      (once Google Drive has synced them). Only ${esc(c.owner)} can change the project settings.</p>
    <ul class="project-list">${rows.map(([p, you]) => `
      <li><div><b>${esc(p.person)}</b>${you ? ' <span class="muted">(you)</span>' : ''}${p.person === c.owner ? ' <span class="pill info">shared it</span>' : ''}<br>
        <span class="muted">${contribution(p)}</span></div>
        <span class="muted">${you ? (collabUnsaved() ? 'saving…' : `saved ${ago(c.savedAt || p.updatedAt)}`) : `saved ${ago(p.updatedAt)}`}</span></li>`).join('')}
    </ul>
    <p class="hint">${c.readAt ? `Checked for changes ${ago(c.readAt)}.` : ''}</p>`;
  $('#collabActions').innerHTML = '<button class="btn" id="collabHistory">Change history</button><button class="btn" id="collabRefresh">Refresh now</button><button class="btn ghost" id="collabLeave">Leave shared project…</button>';
  $('#collabHistory').onclick = openHistory;
  $('#collabRefresh').onclick = async () => { await refreshCollab(); openPeople(); toast('Up to date'); };
  $('#collabLeave').onclick = () => { $('#collabDialog').close(); leaveCollab(); };
  if (!$('#collabDialog').open) $('#collabDialog').showModal();
}

// File › Leave shared project: this computer goes back to a normal project (a copy of everyone's work together)
export async function leaveCollab() {
  if (!state.collab) return;
  if (!confirm('Leave the shared project on this computer?\n\nYour work stays in the shared project for the others, and you can open it again with File › Open. '
    + 'This computer keeps a copy of everyone\'s work together as a normal project (Save to keep it as a file).')) return;
  if (collabUnsaved()) await saveMine();
  const copy = withoutOwners(reportProject());
  setCollab(null);
  replaceProject({ ...copy, savedToFile: false }); render();
  toast('Left the shared project. This is now a normal project on this computer.');
}
