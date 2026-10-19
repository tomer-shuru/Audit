// The shared Audit Builder folder and the shared Dictionary file in it.
// G:\My Drive\Audit Builder holds Models\models.json (Dictionary), Config\config.json (DevMode rules), Templates\SIMS.xlsx
// and Projects\. Browsers only let a page use files the person picked, so the folder is picked once; after that the app
// finds the files in it by itself and reconnects to them every time it opens. After a browser restart the browser
// may want one OK for the folder (one click for all files, none with "Allow on every visit").
import {
  canSaveInPlace, rememberedFile, rememberFile, writeFile, MODELS_FILE, chooseModelsFile, chooseNewModelsFile,
  hasPermission, readFileText, FOLDER, canUseFolder, chooseFolder, folderFile,
} from './filesave.js';
import { state, store, withNewLists, STORE_MODELS } from './state.js';
import { $, esc, toast } from './util.js';
import { recompute, render, renderChrome } from './app.js';
import { attachConfigFile, reconnectConfigFile, renderConfigBar } from './config-file.js';
import { refreshCollab } from './collab.js';
import { renderModels } from './dictionary.js';

export const folder = { handle: null, pending: false }; // pending: remembered, but waiting for the browser's OK

// ---------- shared Dictionary file (models.json) ----------
// Everyone connects to it once; the app loads it on start (and when the window gets focus again)
// and writes every Dictionary edit back to it.
// status: off | ok | needs-permission | missing | error | unsupported
export const shared = { handle: null, status: canSaveInPlace ? 'off' : 'unsupported', text: '', error: '' };

export const isModelsData = m => m && ['models', 'typeMap', 'typeWeights', 'cleanupRules', 'diagCodes'].every(k => Array.isArray(m[k]));
const modelsText = m => JSON.stringify(m, null, 1);
const useSharedFile = (handle, text) => Object.assign(shared, { handle, text, status: 'ok', error: '' });

function applyModels(m) {
  m = withNewLists(m);
  state.models = m;
  store(STORE_MODELS, m);
  recompute();
  if ($('#modelsDialog').open) renderModels(); else render();
}

function sharedFailed(err) {
  shared.status = err.name === 'NotFoundError' ? 'missing' : err.name === 'NotAllowedError' ? 'needs-permission' : 'error';
  shared.error = err.message;
  renderShared();
}

// reads the shared file; ask=true only when called from a click (may show the browser's permission prompt)
export async function loadSharedModels({ ask = false, announce = false } = {}) {
  if (!shared.handle) return;
  try {
    if (!(await hasPermission(shared.handle, ask))) { shared.status = 'needs-permission'; renderShared(); return; }
    const text = await readFileText(shared.handle);
    shared.status = 'ok';
    if (text !== shared.text) {
      const m = withNewLists(JSON.parse(text));
      if (!isModelsData(m)) throw new Error('it isn\'t a Dictionary file');
      shared.text = text;
      if (modelsText(m) !== modelsText(state.models)) {
        applyModels(m);
        if (announce) toast('Loaded the latest shared Dictionary');
      }
    }
    renderShared();
  } catch (err) { sharedFailed(err); }
}

// called after every edit in the Dictionary window
export async function saveModels() {
  store(STORE_MODELS, state.models);
  recompute(); renderChrome();
  if (!shared.handle || shared.status !== 'ok') return;
  const text = modelsText(state.models);
  if (text === shared.text) return;
  try {
    // someone else saved since we last read it: take their version instead of overwriting it
    const current = await readFileText(shared.handle);
    if (current !== shared.text) {
      shared.text = '';
      await loadSharedModels();
      toast('A coworker changed the shared Dictionary just now. Their version is loaded; please redo your last change.', 'bad');
      return;
    }
    await writeFile(shared.handle, text);
    shared.text = text;
  } catch (err) {
    sharedFailed(err);
    toast(`Not saved to the shared Dictionary file: ${err.message}`, 'bad');
  }
}

async function connectSharedModels() {
  const h = await chooseModelsFile();
  if (!h) return;
  try {
    if (!(await hasPermission(h, true))) throw Object.assign(new Error('the browser wasn\'t allowed to use it'), { name: 'NotAllowedError' });
    const text = await readFileText(h);
    const m = JSON.parse(text);
    if (!isModelsData(m)) throw new Error('it isn\'t a Dictionary file');
    useSharedFile(h, text);
    await rememberFile(h, MODELS_FILE);
    applyModels(m);
    renderShared();
    toast(`Connected to the shared Dictionary file ${h.name}`);
  } catch (err) { toast(`Couldn't use ${h.name}: ${err.message}`, 'bad'); }
}

async function createSharedModels() {
  const h = await chooseNewModelsFile();
  if (!h) return;
  const text = modelsText(state.models);
  try {
    await writeFile(h, text);
    useSharedFile(h, text);
    await rememberFile(h, MODELS_FILE);
    renderShared();
    toast(`Created ${h.name} from your current list. Coworkers can now connect to it.`);
  } catch (err) { toast(`Couldn't create the file: ${err.message}`, 'bad'); }
}

function disconnectSharedModels() {
  if (!confirm('Stop using the shared Dictionary file on this computer? Your current list stays, but changes will only be saved here.')) return;
  Object.assign(shared, { handle: null, text: '', status: 'off', error: '' });
  rememberFile(null, MODELS_FILE);
  forgetFolder(); // or it would connect again on the next start
  renderShared();
}

// ---------- the folder ----------
// uses the folder: ask=true only from a click (may show the browser's prompt). Returns which files it found, or null.
async function useFolder(dir, ask) {
  const opts = { mode: 'readwrite' };
  let ok = (await dir.queryPermission(opts)) === 'granted';
  if (!ok && ask) ok = (await dir.requestPermission(opts)) === 'granted';
  folder.handle = dir;
  folder.pending = !ok;
  if (!ok) { renderShared(); renderConfigBar(); return null; }
  const models = await folderFile(dir, 'Models', 'models.json');
  const config = await folderFile(dir, 'Config', 'config.json');
  if (models) {
    useSharedFile(models, '');
    await rememberFile(models, MODELS_FILE);
    await loadSharedModels({ announce: ask });
  }
  if (config) await attachConfigFile(config, { announce: ask });
  renderShared(); renderConfigBar();
  if (state.collab) refreshCollab(); // a shared project that was waiting for the folder
  return { models: !!models, config: !!config };
}

// a remembered folder waiting for the browser's OK: ask for it (only from a click). May throw.
export async function allowFolder() {
  if (folder.handle && folder.pending) await useFolder(folder.handle, true);
}

export async function connectFolder() {
  const dir = await chooseFolder();
  if (!dir) return;
  try {
    const found = await useFolder(dir, true);
    if (!found) { toast('The browser wasn\'t allowed to use the folder', 'bad'); return; }
    if (!found.models && !found.config) {
      forgetFolder(); renderShared(); renderConfigBar();
      toast(`${dir.name} has no Models\\models.json or Config\\config.json. Choose G:\\My Drive\\Audit Builder.`, 'bad');
      return;
    }
    await rememberFile(dir, FOLDER);
    toast(`Connected to ${dir.name}: shared ${[found.models && 'Dictionary', found.config && 'rules'].filter(Boolean).join(' and ')} loaded`);
  } catch (err) { toast(`Couldn't use the folder: ${err.message}`, 'bad'); }
}

export function forgetFolder() {
  Object.assign(folder, { handle: null, pending: false });
  rememberFile(null, FOLDER);
}

// on start: reconnect through the shared folder, or to the files connected one by one before
export async function reconnectShared() {
  if (!canSaveInPlace) { renderShared(); reconnectConfigFile(); return; }
  const dir = canUseFolder ? await rememberedFile(FOLDER) : null;
  if (dir) {
    try { await useFolder(dir, false); return; } catch { forgetFolder(); }
  }
  const h = await rememberedFile(MODELS_FILE);
  if (h) { shared.handle = h; loadSharedModels(); } else renderShared();
  reconnectConfigFile();
}

// the status box in the Dictionary window and the bar under the tabs
export function renderShared() {
  const name = esc(shared.handle?.name || 'models.json');
  const box = $('#sharedModels');
  const msg = {
    unsupported: '<span class="muted">This browser can\'t use a shared Dictionary file, so changes are only saved on this computer. Use Chrome or Edge to share them.</span>',
    off: `<span><b>Not shared:</b> changes are only saved on this computer.</span>
      <span class="actions">${canUseFolder ? '<button class="btn small primary" data-shared="folder">Connect Audit Builder folder…</button>' : ''}<button class="btn small" data-shared="connect">Connect shared file…</button><button class="btn small ghost" data-shared="create">Create shared file…</button></span>
      <span class="hint">Connect the folder <code>G:\\My Drive\\Audit Builder</code> and the app finds the shared Dictionary (and rules) in it by itself.
      The shared file is <code>G:\\My Drive\\Audit Builder\\Models\\models.json</code>. If it doesn't exist yet, create it there.</span>`,
    ok: `<span class="good-text"><b>✓ Shared:</b> using ${name}. Changes are saved to it for everyone.</span>
      <span class="actions"><button class="btn small ghost" data-shared="disconnect">Disconnect</button></span>`,
    'needs-permission': `<span class="warn-text"><b>${name}</b> needs your OK before the app can use it.</span>
      <span class="actions"><button class="btn small primary" data-shared="allow">Load shared Dictionary</button><button class="btn small ghost" data-shared="disconnect">Disconnect</button></span>`,
    missing: `<span class="bad-text">Can't find ${name}. It may have been moved or deleted.</span>
      <span class="actions"><button class="btn small" data-shared="connect">Connect again…</button><button class="btn small ghost" data-shared="disconnect">Disconnect</button></span>`,
    error: `<span class="bad-text">Problem with ${name}: ${esc(shared.error)}</span>
      <span class="actions"><button class="btn small" data-shared="allow">Try again</button><button class="btn small" data-shared="connect">Connect again…</button></span>`,
  }[shared.status];
  if (box) box.innerHTML = msg;

  const bar = $('#sharedBar');
  const showBar = folder.pending || ['needs-permission', 'missing', 'error'].includes(shared.status);
  bar.hidden = !showBar;
  if (folder.pending) {
    // one OK for the whole shared folder loads the Dictionary and the rules
    bar.innerHTML = '<span>The shared Dictionary and rules need your OK to load.</span><button class="btn small primary" data-shared="folderAllow">Load shared files</button>';
  } else if (showBar) {
    bar.innerHTML = shared.status === 'needs-permission'
      ? `<span>The shared Dictionary (${name}) needs your OK to load.</span><button class="btn small primary" data-shared="allow">Load shared Dictionary</button>`
      : `<span>The shared Dictionary (${name}) can't be loaded right now, so this computer's copy is used.</span><button class="btn small" data-shared="open">Open Dictionary</button>`;
  }
  document.querySelectorAll('[data-shared]').forEach(b => b.onclick = () => ({
    connect: connectSharedModels, create: createSharedModels, disconnect: disconnectSharedModels,
    allow: () => loadSharedModels({ ask: true, announce: true }),
    open: () => $('#btnModels').click(),
    folder: connectFolder,
    folderAllow: () => useFolder(folder.handle, true).catch(err => toast(`Couldn't use the folder: ${err.message}`, 'bad')),
  })[b.dataset.shared]());
}
