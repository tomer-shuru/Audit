// Saving the project back to the same file (Chrome / Edge File System Access API).
// The chosen file is remembered in IndexedDB so later saves overwrite it without asking.
// Browsers without the API (e.g. Firefox) fall back to downloading a copy.

export const canSaveInPlace = typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'indexedDB' in window;

const DB = 'auditApp', STORE = 'handles';
export const PROJECT_FILE = 'projectFile', MODELS_FILE = 'modelsFile', CONFIG_FILE = 'configFile', FOLDER = 'sharedFolder';

function withStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { open.result.close(); resolve(req?.result); };
      tx.onerror = () => { open.result.close(); reject(tx.error); };
    };
  });
}

// key: PROJECT_FILE (where Save writes), MODELS_FILE (the shared Models list), CONFIG_FILE (the shared DevMode rules)
// or FOLDER (the shared Audit Builder folder holding both)
export async function rememberedFile(key = PROJECT_FILE) {
  if (!canSaveInPlace) return null;
  try { return (await withStore('readonly', s => s.get(key))) || null; } catch { return null; }
}
export async function rememberFile(handle, key = PROJECT_FILE) {
  if (!canSaveInPlace) return;
  try { await withStore('readwrite', s => (handle ? s.put(handle, key) : s.delete(key))); } catch { /* not critical */ }
}

const PROJECT_TYPE = { description: 'Audit project', accept: { 'application/json': ['.json'] } };
const MODELS_TYPE = { description: 'Dictionary', accept: { 'application/json': ['.json'] } };
const CONFIG_TYPE = { description: 'Audit Builder rules', accept: { 'application/json': ['.json'] } };

const cancelled = err => { if (err.name === 'AbortError') return null; throw err; };

// asks where to save; returns null if the person cancels
// startIn: a folder to start in (the shared Projects folder), when there is one
export async function chooseSaveFile(suggestedName, startIn = null) {
  try {
    return await window.showSaveFilePicker({ suggestedName, types: [PROJECT_TYPE], id: 'audit-projects', ...(startIn && { startIn }) });
  } catch (err) { return cancelled(err); }
}

// the shared Dictionary file (models.json): pick an existing one, or choose where to create it
export async function chooseModelsFile() {
  try {
    const [handle] = await window.showOpenFilePicker({ id: 'audit-models', types: [MODELS_TYPE] });
    return handle;
  } catch (err) { return cancelled(err); }
}
export async function chooseNewModelsFile() {
  try {
    return await window.showSaveFilePicker({ suggestedName: 'models.json', types: [MODELS_TYPE], id: 'audit-models' });
  } catch (err) { return cancelled(err); }
}

// the shared rules file (config.json, DevMode): pick an existing one, or choose where to create it
export async function chooseConfigFile() {
  try {
    const [handle] = await window.showOpenFilePicker({ id: 'audit-config', types: [CONFIG_TYPE] });
    return handle;
  } catch (err) { return cancelled(err); }
}
export async function chooseNewConfigFile() {
  try {
    return await window.showSaveFilePicker({ suggestedName: 'config.json', types: [CONFIG_TYPE], id: 'audit-config' });
  } catch (err) { return cancelled(err); }
}

// the shared Audit Builder folder (G:My DriveAudit Builder): connecting it once lets the app find the shared files in it
export const canUseFolder = canSaveInPlace && 'showDirectoryPicker' in window;
export async function chooseFolder() {
  try {
    return await window.showDirectoryPicker({ id: 'audit-folder', mode: 'readwrite' });
  } catch (err) { return cancelled(err); }
}
// a file in a subfolder of the shared folder (e.g. Models / models.json), or null when it isn't there
export async function folderFile(dir, sub, name) {
  try {
    return await (await dir.getDirectoryHandle(sub)).getFileHandle(name);
  } catch (err) {
    if (err.name === 'NotFoundError' || err.name === 'TypeMismatchError') return null;
    throw err;
  }
}

// Is the browser allowed to read and write this file right now? (mode 'read' only asks to read it)
// With ask=true (only from a click) the browser may show its "allow" prompt.
export async function hasPermission(handle, ask = false, mode = 'readwrite') {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return ask ? (await handle.requestPermission(opts)) === 'granted' : false;
}

export async function readFileText(handle) {
  return (await handle.getFile()).text();
}

// asks which file to open; returns { file, handle } or null if cancelled
export async function chooseOpenFile(startIn = null) {
  try {
    const [handle] = await window.showOpenFilePicker({
      id: 'audit-projects', ...(startIn && { startIn }),
      types: [
        PROJECT_TYPE,
        { description: 'Old Audit workbook', accept: { 'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } },
      ],
    });
    return { file: await handle.getFile(), handle };
  } catch (err) { return cancelled(err); }
}

// writes text to the file; the browser may ask once per session for permission to edit it
export async function writeFile(handle, text) {
  if (!(await hasPermission(handle, true))) {
    throw Object.assign(new Error('Permission to edit the file was not given'), { name: 'NotAllowedError' });
  }
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}
