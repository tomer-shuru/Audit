// The shared DevMode rules file (Config/config.json): connecting, loading and creating it, and the bar that says
// how it's doing. The rules file is shared like the Dictionary: everyone's app reads it (and picks up changes when the
// window gets focus again); DevMode (devmode.js) writes it, keeping the last 20 versions inside it.
import { withDefaults, rulesOf } from '../engine/config.js';
import {
  canSaveInPlace, rememberedFile, rememberFile, writeFile, hasPermission, readFileText,
  CONFIG_FILE, chooseConfigFile, chooseNewConfigFile, canUseFolder,
} from './filesave.js';
import { state, store, STORE_CONFIG } from './state.js';
import { $, esc, toast } from './util.js';
import { recompute, render } from './app.js';
import { folder, connectFolder, forgetFolder } from './folder.js';

const SHARED_PATH = 'G:\\My Drive\\Audit Builder\\Config\\config.json';
const FOLDER_PATH = 'G:\\My Drive\\Audit Builder';

// new rules: used from now on, and kept on this computer
export function applyConfig(cfg) {
  state.config = withDefaults(cfg);
  store(STORE_CONFIG, state.config);
  recompute(); render();
}
const connectSharedFolder = () => (canUseFolder ? connectFolder() : toast('This browser can\'t connect a folder. Use Chrome or Edge.', 'bad'));

// the shared rules file. status: off | ok | needs-permission | missing | error | unsupported
export const file = { handle: null, status: canSaveInPlace ? 'off' : 'unsupported', text: '', error: '' };
// the DevMode editor (devmode.js) keeps its draft in step with rules loaded from the file
export const editor = { dirty: () => false, reset: () => {} };

export const configText = c => JSON.stringify(c, null, 1);
// what counts as a change: the rules and the password (not the backups)
export const rulesText = c => JSON.stringify({ ...rulesOf(withDefaults(c)), passwordHash: c.passwordHash });
export const isConfigData = c => c && typeof c === 'object' && !Array.isArray(c) && ['battery', 'checks', 'reportColumns', 'texts'].some(k => k in c);

export function fileFailed(err) {
  file.status = err.name === 'NotFoundError' ? 'missing' : err.name === 'NotAllowedError' ? 'needs-permission' : 'error';
  file.error = err.message;
  renderConfigBar();
}

// reads the shared file; ask=true only when called from a click (may show the browser's permission prompt)
export async function loadConfigFile({ ask = false, announce = false } = {}) {
  if (!file.handle) return;
  try {
    if (!(await hasPermission(file.handle, ask, 'read'))) { file.status = 'needs-permission'; renderConfigBar(); return; }
    const text = await readFileText(file.handle);
    file.status = 'ok';
    if (text !== file.text) {
      const c = JSON.parse(text);
      if (!isConfigData(c)) throw new Error('it isn\'t an Audit Builder rules file');
      file.text = text;
      const cfg = withDefaults(c);
      if (configText(cfg) !== configText(state.config)) {
        const keepDraft = editor.dirty();
        applyConfig(cfg);
        if (!keepDraft) editor.reset();
        if (announce) toast('Loaded the latest shared rules');
      }
    }
    renderConfigBar();
  } catch (err) { fileFailed(err); }
}

async function connectConfigFile() {
  const h = await chooseConfigFile();
  if (!h) return;
  try {
    if (!(await hasPermission(h, true, 'read'))) throw Object.assign(new Error('the browser wasn\'t allowed to use it'), { name: 'NotAllowedError' });
    const text = await readFileText(h);
    const c = JSON.parse(text);
    if (!isConfigData(c)) throw new Error('it isn\'t an Audit Builder rules file');
    Object.assign(file, { handle: h, text, status: 'ok', error: '' });
    await rememberFile(h, CONFIG_FILE);
    applyConfig(withDefaults(c));
    editor.reset();
    renderConfigBar();
    toast(`Connected to the shared rules file ${h.name}`);
  } catch (err) { toast(`Couldn't use ${h.name}: ${err.message}`, 'bad'); }
}

async function createConfigFile() {
  const h = await chooseNewConfigFile();
  if (!h) return;
  const text = configText(state.config);
  try {
    await writeFile(h, text);
    Object.assign(file, { handle: h, text, status: 'ok', error: '' });
    await rememberFile(h, CONFIG_FILE);
    renderConfigBar();
    toast(`Created ${h.name} from the current rules. Coworkers can now connect to it.`);
  } catch (err) { toast(`Couldn't create the file: ${err.message}`, 'bad'); }
}

// the config.json found in the shared Audit Builder folder (connected from folder.js)
export async function attachConfigFile(h, { announce = false } = {}) {
  Object.assign(file, { handle: h, text: '', status: 'ok', error: '' });
  await rememberFile(h, CONFIG_FILE);
  await loadConfigFile({ announce });
}

// without a shared folder: the config.json connected on its own earlier, if any
export async function reconnectConfigFile() {
  if (!canSaveInPlace) { renderConfigBar(); return; }
  const h = await rememberedFile(CONFIG_FILE);
  if (h) { file.handle = h; await loadConfigFile(); } else renderConfigBar();
}

function disconnectConfigFile() {
  if (!confirm('Stop using the shared rules file on this computer? The current rules stay, but DevMode changes will only be saved here.')) return;
  Object.assign(file, { handle: null, text: '', status: 'off', error: '' });
  rememberFile(null, CONFIG_FILE);
  forgetFolder(); // or it would connect again on the next start
  renderConfigBar();
}

// the bar under the tabs (everyone) and the box at the top of the DevMode window
export function renderConfigBar() {
  const name = esc(file.handle?.name || 'config.json');
  const bar = $('#configBar');
  // while the shared folder waits for the browser's OK, its own bar (folder.js) covers the rules too
  const msg = folder.pending ? '' : {
    // the shared folder holds the Dictionary and the rules: connecting it once is enough
    off: folder.handle && !folder.pending
      ? '<span>There\'s no Config\\config.json in the shared folder yet, so the built-in rules are used.</span>'
      : `<span>Connect the shared Audit Builder folder once, so the app loads the shared Dictionary and rules by itself.</span>
      <button class="btn small primary" data-cfg="folder">Connect folder…</button>
      <span class="hint">Choose <code>${esc(FOLDER_PATH)}</code></span>`,
    'needs-permission': `<span>The shared rules (${name}) need your OK to load.</span><button class="btn small primary" data-cfg="allow">Load shared rules</button>`,
    missing: `<span>Can't find the shared rules file (${name}), so this computer's last copy of the rules is used.</span><button class="btn small" data-cfg="connect">Connect again…</button>`,
    error: `<span>Problem with the shared rules file (${name}): ${esc(file.error)}. This computer's last copy of the rules is used.</span>
      <button class="btn small" data-cfg="allow">Try again</button><button class="btn small" data-cfg="connect">Connect again…</button>`,
  }[file.status];
  bar.hidden = !msg;
  if (msg) bar.innerHTML = msg;

  const box = $('#devFile');
  if (box) {
    box.innerHTML = {
      unsupported: '<span class="muted">This browser can\'t use a shared rules file, so changes are only saved on this computer. Use Chrome or Edge.</span>',
      off: `<span><b>Not shared:</b> the rules are only saved on this computer.</span>
        <span class="actions"><button class="btn small primary" data-cfg="folder">Connect Audit Builder folder…</button><button class="btn small" data-cfg="connect">Connect shared file…</button><button class="btn small ghost" data-cfg="create">Create shared file…</button></span>
        <span class="hint">The shared file is <code>${esc(SHARED_PATH)}</code>. If it doesn't exist yet, create it there (make the Config folder first).</span>`,
      ok: `<span class="good-text"><b>✓ Shared:</b> using ${name}. Saved changes apply to everyone.</span>
        <span class="actions"><button class="btn small ghost" data-cfg="disconnect">Disconnect</button></span>`,
      'needs-permission': `<span class="warn-text"><b>${name}</b> needs your OK before the app can use it.</span>
        <span class="actions"><button class="btn small primary" data-cfg="allow">Load shared rules</button></span>`,
      missing: `<span class="bad-text">Can't find ${name}. It may have been moved or deleted.</span>
        <span class="actions"><button class="btn small" data-cfg="connect">Connect again…</button><button class="btn small ghost" data-cfg="disconnect">Disconnect</button></span>`,
      error: `<span class="bad-text">Problem with ${name}: ${esc(file.error)}</span>
        <span class="actions"><button class="btn small" data-cfg="allow">Try again</button><button class="btn small" data-cfg="connect">Connect again…</button></span>`,
    }[file.status];
  }
  document.querySelectorAll('[data-cfg]').forEach(b => b.onclick = () => ({
    connect: connectConfigFile, create: createConfigFile, disconnect: disconnectConfigFile, folder: connectSharedFolder,
    allow: () => loadConfigFile({ ask: true, announce: true }),
  })[b.dataset.cfg]());
}

// picks up rule changes made on another computer when the window gets focus again
export function initConfigFile() {
  if (!canSaveInPlace) return;
  window.addEventListener('focus', () => {
    if (file.status === 'ok' && !$('#devDialog').open) loadConfigFile({ announce: true });
  });
}
