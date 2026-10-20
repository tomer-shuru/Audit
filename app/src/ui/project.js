// The File menu for normal projects: New, Open (the project list), Save / Save as, and auto-save
import { importWorkbook, downloadJson, readJsonFile } from './io.js';
import { canSaveInPlace, rememberedFile, rememberFile, chooseSaveFile, chooseOpenFile, writeFile, hasPermission, canUseFolder } from './filesave.js';
import { projectsDir, listSharedProjects, listProjectFiles } from './sharedfiles.js';
import { state, store, emptyProject, migrate, settingsComplete, STORE_PROJECT } from './state.js';
import { $, esc, toast, ago, renderSyncState } from './util.js';
import { ICONS } from './icons.js';
import { render, renderChrome, replaceProject, setTab } from './app.js';
import { folder, allowFolder, connectFolder } from './folder.js';
import { reportProject, setCollab, saveMine, collabRoot, renderCollabState, clickCollabState } from './collab.js';
import { shareProject, joinShared, leaveCollab, openPeople } from './share.js';
import { openSetup } from './setup.js';

// what goes into a project file: the project without savedToFile (it only matters on this computer)
const fileCopy = ({ savedToFile, ...project }) => project;
// a shared project's Blancco files say who added them; a normal project's don't
export const withoutOwners = p => ({ ...p, inputs: { ...p.inputs, blanccoFiles: p.inputs.blanccoFiles.map(({ by, ...f }) => f) } });

export const forgetProjectFile = () => { state.fileName = ''; rememberFile(null); };

// opening another project: changes to a normal project that aren't saved yet would be lost
export const okToReplace = () => state.collab || state.project.savedToFile || !settingsComplete(state.project.settings)
  || confirm('Open another project? Changes to the open project since you last saved it will be lost.');

// File › New project
function newProject() {
  if (state.collab) {
    if (!confirm('Start a new project? The shared project stays in the shared folder; open it again with File › Open.')) return;
    setCollab(null);
  } else if (!state.project.savedToFile && !confirm('Start a new project? Changes since you last saved the project file will be lost.')) return;
  forgetProjectFile();
  replaceProject(emptyProject());
  setTab('data');
  openSetup({ force: true, onSave: createProjectFile });
}

// a project file (.audit.json) or an old Audit.xlsm / .xlsx workbook; true when it opened
async function openProjectFile(file) {
  try {
    let p;
    if (/\.xls[xm]$/i.test(file.name)) { p = await importWorkbook(file); toast(`Imported ${file.name}`); }
    else { p = await readJsonFile(file); toast(`Opened ${file.name}`); }
    setCollab(null); // opening a project file leaves a shared project (it stays in the shared folder)
    state.manualSelected.clear();
    replaceProject(Object.assign(migrate(p), { savedToFile: true }));
    render();
    if (!settingsComplete(state.project.settings)) openSetup({ force: true });
    else if ($('#setupDialog').open) $('#setupDialog').close();
    return true;
  } catch (err) {
    toast(`Couldn't open ${file.name}: ${err.message}`, 'bad');
    return false;
  }
}

// Save: the first time asks where, after that overwrites the same file. "Save as" always asks.
// folderOnly: only save straight into the Projects folder; without it (not connected, or Cancel) nothing happens
export async function saveProject({ saveAs = false, folderOnly = false } = {}) {
  // a shared project saves itself; Save just does it now, Save as saves everyone's work together as a normal project file
  if (state.collab && !saveAs) { await saveMine({ announce: true }); return; }
  const s = state.project.settings;
  // suggested name for a new file: "End client_Project number.audit.json" (characters Windows doesn't allow become -)
  const base = [s.endClient, s.projectNumber].map(v => String(v ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-')).filter(Boolean).join('_');
  const name = `${base || 'project'}.audit.json`;
  const copy = fileCopy(state.collab ? withoutOwners(reportProject()) : state.project);
  const text = JSON.stringify(copy, null, 1);

  if (state.collab) { // a copy: the shared project stays open
    if (!canSaveInPlace) { downloadJson(copy, name); return; }
    try {
      const handle = await chooseSaveFile(name, await projectsStart());
      if (!handle) return;
      await writeFile(handle, text);
      toast(`Saved a copy of the shared project to ${handle.name}`);
    } catch (err) { toast(`Not saved: ${err.message}`, 'bad'); }
    return;
  }

  if (!canSaveInPlace) {
    downloadJson(copy, name);
  } else {
    let handle = saveAs ? null : await rememberedFile();
    try {
      if (!handle) {
        // a new project goes straight into the Projects folder (when it's connected); Save as always asks
        handle = (!saveAs && await projectFileInFolder(name)) || (folderOnly ? null : await chooseSaveFile(name, await projectsStart()));
        if (!handle) return; // cancelled
      }
      await writeFile(handle, text);
    } catch (err) {
      if (err.name === 'NotAllowedError') { toast('Not saved: the browser wasn\'t allowed to edit the file. Try again, or use Save as.', 'bad'); return; }
      if (err.name === 'NotFoundError') { // file was moved or deleted: ask again
        handle = await chooseSaveFile(name, await projectsStart());
        if (!handle) return;
        await writeFile(handle, text);
      } else { toast(`Not saved: ${err.message}`, 'bad'); return; }
    }
    await rememberFile(handle);
    state.fileName = handle.name;
  }
  clearTimeout(autosave.timer);
  savedNow();
  state.project.savedToFile = true;
  store(STORE_PROJECT, state.project);
  renderChrome();
  toast(canSaveInPlace ? `Saved to ${state.fileName}` : `Downloaded ${name}`);
}

// A new project, just set up: its file goes straight into the Projects folder (when the Audit Builder folder
// is connected), so auto-save keeps it from the start. Otherwise it waits for the first Save.
export function createProjectFile() {
  if (state.collab || state.fileName || !canSaveInPlace || !folder.handle) return;
  saveProject({ folderOnly: true });
}

// ---------- auto-save ----------
// Once a project has a file (saved or opened once), every change is written to it a few seconds later.
// The browser may want a click to allow editing the file again (after a restart): then Save / the status asks once.
const AUTOSAVE_DELAY = 3000;
const autosave = { timer: 0, writing: false, error: '', paused: false, savedAt: 0, changes: 0 };
const autosaves = () => !state.collab && canSaveInPlace && !!state.fileName;
const savedNow = () => Object.assign(autosave, { error: '', paused: false, savedAt: Date.now() });

export function scheduleAutosave() {
  autosave.changes++;
  clearTimeout(autosave.timer);
  if (autosaves()) autosave.timer = setTimeout(autosaveProject, AUTOSAVE_DELAY);
}
async function autosaveProject() {
  clearTimeout(autosave.timer);
  if (!autosaves() || state.project.savedToFile) return;
  if (autosave.writing) { autosave.timer = setTimeout(autosaveProject, 300); return; } // one write at a time
  const handle = await rememberedFile();
  if (!handle) return;
  const project = state.project, changes = autosave.changes;
  autosave.writing = true;
  renderChrome();
  try {
    if (!(await hasPermission(handle))) { autosave.paused = true; return; } // asking needs a click
    await writeFile(handle, JSON.stringify(fileCopy(project), null, 1));
    savedNow();
    if (state.project === project && autosave.changes === changes) { // nothing changed while writing
      project.savedToFile = true;
      store(STORE_PROJECT, project);
    }
  } catch (err) {
    autosave.error = err.name === 'NotFoundError' ? 'the file was moved or deleted' : err.message;
  } finally {
    autosave.writing = false;
    renderChrome();
  }
}

// on start: the project file Save writes to (and a change that wasn't auto-saved yet)
export function reconnectProjectFile() {
  rememberedFile().then(h => { state.fileName = h?.name || ''; renderChrome(); if (!state.project.savedToFile) autosaveProject(); });
}

// the save status at the top
export function renderSaveState(el) {
  if (state.collab) { renderCollabState(el); return; }
  const unsaved = !state.project.savedToFile;
  if (!autosaves()) {
    el.className = 'save-state';
    el.textContent = unsaved ? 'Unsaved changes' : state.fileName ? `Saved · ${state.fileName}` : '';
    el.classList.toggle('dirty', unsaved);
    el.title = state.fileName ? `Save (Ctrl+S) writes to ${state.fileName}` : 'Save (Ctrl+S) will ask where to save the project file';
    return;
  }
  renderSyncState(el,
    autosave.error && unsaved ? ['bad', ICONS.error, 'Not saved', `Couldn't save to ${state.fileName}: ${autosave.error}. Click to save.`]
    : autosave.paused && unsaved ? ['off', ICONS.off, 'Not saved · click to save', `The browser needs a click to allow saving to ${state.fileName} again. After that, changes save by themselves.`]
    : unsaved ? ['busy', ICONS.sync, 'Saving…', `Changes are saved to ${state.fileName} a few seconds after you stop`]
    : ['good', ICONS.done, `Saved · ${state.fileName}`, `All changes are saved to ${state.fileName}${autosave.savedAt ? ` (at ${new Date(autosave.savedAt).toLocaleTimeString()})` : ''}. Changes save by themselves.`]);
}
function clickSaveState() {
  if (state.collab) clickCollabState();
  else if (autosaves() && !state.project.savedToFile) saveProject();
}

// ---------- File › Open… ----------
// The shared projects and the project files in the connected Audit Builder folder (Projects), picked
// in the app. Browse… opens the browser's file picker, for a file somewhere else or an old Audit.xlsm.
export async function openProjectList() {
  if (!canSaveInPlace) { $('#openFile').click(); return; }
  // after a browser restart the folder waits for one OK; this click lets the browser ask
  try { await allowFolder(); } catch { /* not connected: shown below */ }
  const root = collabRoot();
  let sharedList = [], files = [];
  if (root) {
    try { [sharedList, files] = await Promise.all([listSharedProjects(root), listProjectFiles(root)]); }
    catch (err) { toast(`Couldn't read the Projects folder: ${err.message}`, 'bad'); }
  }
  const openNow = !state.collab && state.fileName;
  const openButton = (isOpen, attr) => (isOpen ? '<span class="muted">Open now</span>' : `<button class="btn primary" ${attr}>Open</button>`);
  $('#collabTitle').textContent = 'Open project';
  $('#collabBody').innerHTML = !root ? `
    <div class="shared-box"><span>Connect the Audit Builder folder to pick projects here, or use Browse… to open a file.</span>
      ${canUseFolder ? '<button class="btn small primary" id="openConnect">Connect Audit Builder folder…</button>' : ''}</div>` : `
    <input type="search" id="openSearch" class="open-search" placeholder="Search projects…" aria-label="Search projects">
    <h3>Shared projects <span class="muted">worked on together, saved as you work</span></h3>
    ${sharedList.length ? `<ul class="project-list">${sharedList.map((p, i) => `
      <li><div><b>${esc(p.info.settings?.endClient || p.name)}</b> · ${esc(p.info.settings?.projectNumber || '')}
        <span class="muted">${esc(p.info.settings?.prefix || '')}</span><br>
        <span class="muted">Shared by ${esc(p.info.owner || '?')} · ${esc(p.people.map(x => x.person).join(', ') || 'nobody yet')} · last change ${ago(p.modified)}</span></div>
        ${openButton(state.collab?.dir === p.name, `data-join="${i}"`)}</li>`).join('')}
    </ul>` : '<p class="empty">No shared projects yet. Open a project, then choose File › Share project.</p>'}
    <h3>Project files <span class="muted">one person at a time, saved with Save</span></h3>
    ${files.length ? `<ul class="project-list">${files.map((f, i) => `
      <li><div><b>${esc(f.name.replace(/\.audit\.json$/i, ''))}</b><br><span class="muted">saved ${ago(f.modified)}</span></div>
        ${openButton(openNow === f.name, `data-file="${i}"`)}</li>`).join('')}
    </ul>` : '<p class="empty">No project files in the Projects folder yet. Save a project and it goes there.</p>'}
    <p class="empty" id="openNoMatch" hidden>No project matches the search.</p>`;
  const body = $('#collabBody');
  body.querySelectorAll('[data-join]').forEach(b => b.onclick = () => joinShared(sharedList[+b.dataset.join]));
  body.querySelectorAll('[data-file]').forEach(b => b.onclick = () => openListedFile(files[+b.dataset.file]));
  const connect = $('#openConnect');
  if (connect) connect.onclick = async () => { await connectFolder(); if (collabRoot()) openProjectList(); };
  const search = $('#openSearch');
  if (search) search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const li of body.querySelectorAll('.project-list li')) { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); shown += !li.hidden; }
    $('#openNoMatch').hidden = !q || shown > 0;
  };
  $('#collabActions').innerHTML = '<button class="btn" id="openBrowse" title="Open a project file from somewhere else, or import an old Audit.xlsm">Browse…</button>';
  $('#openBrowse').onclick = browseProject;
  if (!$('#collabDialog').open) $('#collabDialog').showModal();
  search?.focus();
}

// a project opened from a file the person picked: Save writes back to it (handle: null for an imported workbook)
async function openedFile(file, handle) {
  if (!(await openProjectFile(file))) return;
  $('#collabDialog').close();
  await rememberFile(handle);
  state.fileName = handle?.name || '';
  renderChrome();
}

async function openListedFile(entry) {
  if (!okToReplace()) return;
  try { await openedFile(await entry.handle.getFile(), entry.handle); } catch (err) { toast(`Couldn't open ${entry.name}: ${err.message}`, 'bad'); }
}

// Browse… in the Open window: the browser's file picker (starting in the Projects folder)
async function browseProject() {
  let picked;
  try { picked = await chooseOpenFile(await projectsStart()); } catch (err) { toast(`Couldn't open: ${err.message}`, 'bad'); return; }
  if (!picked || !okToReplace()) return;
  // saving an opened project writes back to it; an imported workbook is saved as a new file
  const isProjectFile = !/\.xls[xm]$/i.test(picked.file.name);
  await openedFile(picked.file, isProjectFile ? picked.handle : null);
}

// the Projects folder, for the file pickers to start in (null when the Audit Builder folder isn't connected)
async function projectsStart() {
  const root = collabRoot();
  try { return root ? await projectsDir(root, true) : null; } catch { return null; }
}

// a new project's first Save: straight into the Projects folder, without the file picker (null = ask with the picker)
async function projectFileInFolder(name) {
  try { await allowFolder(); } catch { return null; }
  const dir = await projectsStart();
  if (!dir) return null;
  try {
    const existing = await dir.getFileHandle(name);
    return confirm(`There is already a project file ${name} in the Projects folder. Replace it with this project?\n\nCancel to choose another name.`) ? existing : null;
  } catch (err) {
    if (err.name !== 'NotFoundError') return null;
  }
  return dir.getFileHandle(name, { create: true });
}

export function initFileMenu() {
  $('#btnNew').onclick = newProject;
  $('#btnOpen').onclick = openProjectList;
  $('#btnSave').onclick = () => saveProject();
  $('#btnSaveAs').hidden = !canSaveInPlace;
  $('#btnSaveAs').onclick = () => saveProject({ saveAs: true });
  $('#btnShare').hidden = !canUseFolder;
  $('#btnShare').onclick = shareProject;
  $('#btnLeaveShared').onclick = leaveCollab;
  $('#saveState').onclick = clickSaveState;
  $('#peopleChip').onclick = openPeople;
  $('#collabClose').onclick = () => $('#collabDialog').close();
  $('#openFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); };
}
