// The start window: Project setup for a new project, plus "Continue where you left off" (the last project, kept as
// it was until you choose) and "Open a project…". Shown when Audit Builder opens, and by File › New project.
import { state, emptyProject, settingsComplete } from './state.js';
import { recompute, render, replaceProject, setTab } from './app.js';
import { restoreCollab, setCollab, refreshCollab, saveMine } from './collab.js';
import { reconnectProjectFile, forgetProjectFile, createProjectFile, openProjectList } from './project.js';
import { openSetup } from './setup.js';

// fromMenu: File › New project, so the last project is the one open now (when the app opens, the one kept in the browser)
export async function openStart({ fromMenu = false } = {}) {
  // a shared project's changes not written yet go to the Drive first (a new project would leave it)
  if (fromMenu && (state.collab?.dirty || state.collab?.settingsDirty)) await saveMine();
  if (fromMenu && state.collab) clearTimeout(state.collab.timer);
  const last = { project: state.project, collab: fromMenu ? state.collab : restoreCollab() };
  state.project = emptyProject(); // shown behind the window until a choice is made; nothing is stored yet
  state.collab = null;
  recompute();
  render();

  const s = last.project.settings;
  const has = settingsComplete(s);
  const name = [s.endClient, s.projectNumber].filter(Boolean).join(' · ');
  // a normal project with changes not saved to its file yet: they'd be lost by starting or opening another one
  const unsaved = has && !last.collab && !last.project.savedToFile;
  const okToLeave = () => !unsaved || confirm(`${name} has changes that aren't saved to its file yet. They will be lost. Continue?`);

  openSetup({
    force: true,
    onSave: createProjectFile,
    start: {
      last: has ? name : '',
      note: last.collab ? 'shared project' : unsaved ? 'changes not saved to its file yet' : '',
      onContinue: () => {
        state.collab = last.collab;
        if (last.collab) setCollab(last.collab);
        replaceProject(last.project);
        render();
        reconnectProjectFile(); // and saves a change that wasn't auto-saved yet
        if (state.collab) refreshCollab();
      },
      onOpen: () => { if (okToLeave()) openProjectList(); },
      // a new project: the last one's shared project and file are left (they stay where they are)
      okToStartNew: () => {
        if (!okToLeave()) return false;
        setCollab(null);
        forgetProjectFile();
        setTab('data'); // a new project starts with its inputs
        return true;
      },
    },
  });
}
