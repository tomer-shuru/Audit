// Audit Builder - browser UI. This file starts the app; each screen is its own module:
//   state.js     state, localStorage, undo history        app.js       recompute, render, changed()
//   data-tab.js / manual-tab.js / review-tab.js / bios-tab.js   the tabs
//   export.js    Export window                            setup.js     project setup window
//   dictionary.js  Settings › Dictionary                 devmode.js   Settings › DevMode (editor)
//   config-file.js  the shared DevMode rules file (Config/config.json) and its bar
//   folder.js    shared Audit Builder folder + shared Dictionary file
//   project.js   File menu: New, Open, Save, auto-save    share.js / collab.js   shared projects
//   menus.js     menu bar, theme, shortcuts               util.js / icons.js     helpers
import { canSaveInPlace } from './filesave.js';
import { state, settingsComplete } from './state.js';
import { $ } from './util.js';
import { recompute, render, setTab, setOutput, fitTallTable } from './app.js';
import { initMenus, initTheme, initShortcuts } from './menus.js';
import { initBios } from './bios-tab.js';
import { initSetup, openSetup } from './setup.js';
import { initDictionary } from './dictionary.js';
import { initDevMode } from './devmode.js';
import { initFileMenu, reconnectProjectFile } from './project.js';
import { shared, loadSharedModels, reconnectShared } from './folder.js';
import { restoreCollab, refreshCollab, collabUnsaved, COLLAB_POLL } from './collab.js';

function init() {
  state.collab = restoreCollab();
  recompute();
  initTheme();
  initMenus();
  initBios();
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  document.addEventListener('change', e => { if (e.target.matches?.('select[data-output]')) setOutput(e.target.value); });
  initFileMenu();
  initShortcuts();
  reconnectProjectFile();
  initSetup();
  initDictionary();
  $('#exportClose').onclick = () => $('#exportDialog').close();
  initDevMode(); // the rules in the shared config.json, behind a password

  // shared files: reconnect on start, and pick up coworkers' changes when coming back to the app
  reconnectShared();
  if (canSaveInPlace) {
    window.addEventListener('focus', () => {
      if (shared.status === 'ok' && !$('#modelsDialog').open) loadSharedModels({ announce: true });
      refreshCollab();
    });
    // a shared project: read the others' changes every few seconds while the app is in view
    setInterval(() => { if (document.visibilityState === 'visible') refreshCollab(); }, COLLAB_POLL);
  }

  window.addEventListener('resize', fitTallTable);
  document.addEventListener('toggle', e => { if (e.target.closest?.('.warnings')) fitTallTable(); }, true); // Checks opened / closed
  window.addEventListener('beforeunload', e => {
    const unsaved = state.collab ? collabUnsaved() : !state.project.savedToFile;
    if (unsaved && settingsComplete(state.project.settings)) e.preventDefault();
  });

  render();
  if (!settingsComplete(state.project.settings)) openSetup({ force: true });
}

init();
