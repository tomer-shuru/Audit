// Saving the project back to the same file (Chrome / Edge File System Access API).
// The chosen file is remembered in IndexedDB so later saves overwrite it without asking.
// Browsers without the API (e.g. Firefox) fall back to downloading a copy.

export const canSaveInPlace = typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'indexedDB' in window;

const DB = 'auditApp', STORE = 'handles', KEY = 'projectFile';

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

export async function rememberedFile() {
  if (!canSaveInPlace) return null;
  try { return (await withStore('readonly', s => s.get(KEY))) || null; } catch { return null; }
}
export async function rememberFile(handle) {
  if (!canSaveInPlace) return;
  try { await withStore('readwrite', s => (handle ? s.put(handle, KEY) : s.delete(KEY))); } catch { /* not critical */ }
}

const PROJECT_TYPE = { description: 'Audit project', accept: { 'application/json': ['.json'] } };

// asks where to save; returns null if the person cancels
export async function chooseSaveFile(suggestedName) {
  try {
    return await window.showSaveFilePicker({ suggestedName, types: [PROJECT_TYPE], id: 'audit-projects' });
  } catch (err) {
    if (err.name === 'AbortError') return null;
    throw err;
  }
}

// asks which file to open; returns { file, handle } or null if cancelled
export async function chooseOpenFile() {
  try {
    const [handle] = await window.showOpenFilePicker({
      id: 'audit-projects',
      types: [
        PROJECT_TYPE,
        { description: 'Old Audit workbook', accept: { 'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } },
      ],
    });
    return { file: await handle.getFile(), handle };
  } catch (err) {
    if (err.name === 'AbortError') return null;
    throw err;
  }
}

// writes text to the file; the browser may ask once per session for permission to edit it
export async function writeFile(handle, text) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) !== 'granted' && (await handle.requestPermission(opts)) !== 'granted') {
    throw Object.assign(new Error('Permission to edit the file was not given'), { name: 'NotAllowedError' });
  }
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}
