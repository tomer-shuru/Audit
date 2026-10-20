// When Audit Builder opens it starts on Project setup (like File › New), not in the last project. The window
// also offers to continue where you left off (the last project, kept as it was until you choose) or to open one.
import { state, emptyProject, settingsComplete } from './state.js';
import { recompute, render, replaceProject } from './app.js';
import { restoreCollab, setCollab, refreshCollab } from './collab.js';
import { reconnectProjectFile, forgetProjectFile, createProjectFile, openProjectList } from './project.js';
import { openSetup } from './setup.js';

export function openStart() {
  const last = { project: state.project, collab: restoreCollab() };
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
        return true;
      },
    },
  });
}
