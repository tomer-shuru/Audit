// Tools › Shared Files: files shared with everyone through the Audit Builder folder (G:\My Drive\Audit Builder\Shared Files).
// Listed in the app like File › Open, newest first; files can be added (button or drop), downloaded and deleted.
// Who added a file is kept in one small file per person (.audit-builder\<name>.json, written only by that
// person, so two people adding at once never overwrite each other); a file changed outside the app shows no name.
import { canUseFolder } from './filesave.js';
import { safeName } from './sharedfiles.js';
import { load, STORE_PERSON } from './state.js';
import { $, esc, toast, ago, choose, dropZone } from './util.js';
import { collabRootAsk, askName } from './share.js';

const FILES_DIR = 'Shared Files', INFO_DIR = '.audit-builder';
const view = { q: '', dir: null };

const notFound = err => err.name === 'NotFoundError' || err.name === 'TypeMismatchError';
const size = n => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

// who added each file: { [file name]: { person, at, size } }, the newest record per file
async function readInfo(dir) {
  const out = {};
  let info;
  try { info = await dir.getDirectoryHandle(INFO_DIR); } catch (err) { if (notFound(err)) return out; throw err; }
  for await (const [name, h] of info.entries()) {
    if (h.kind !== 'file' || !/\.json$/i.test(name)) continue;
    let files;
    try { files = JSON.parse(await (await h.getFile()).text()).files || {}; } catch { continue; } // still syncing
    const person = name.replace(/\.json$/i, '');
    for (const [file, rec] of Object.entries(files)) if (!out[file] || out[file].at < rec.at) out[file] = { person, ...rec };
  }
  return out;
}

// this person's record: the files they added (or removed: rec = null)
async function writeMyInfo(dir, person, changes) {
  const info = await dir.getDirectoryHandle(INFO_DIR, { create: true });
  const h = await info.getFileHandle(`${safeName(person)}.json`, { create: true });
  let data = { files: {} };
  try { data = JSON.parse(await (await h.getFile()).text()) || data; data.files ||= {}; } catch { /* new or unreadable: start over */ }
  for (const [file, rec] of Object.entries(changes)) { if (rec) data.files[file] = rec; else delete data.files[file]; }
  const w = await h.createWritable(); await w.write(JSON.stringify(data)); await w.close();
}

// the files, newest first: { name, handle, modified, size, by }
async function listFiles(dir) {
  const info = await readInfo(dir);
  const list = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'file' || name === 'desktop.ini') continue;
    const f = await h.getFile();
    const rec = info[name];
    list.push({ name, handle: h, modified: f.lastModified, size: f.size, by: rec && rec.size === f.size ? rec.person : '' });
  }
  return list.sort((a, b) => b.modified - a.modified);
}

// "report (2).pdf": a name not used yet in the folder
async function freeName(dir, name) {
  const dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const next = `${base} (${i})${ext}`;
    try { await dir.getFileHandle(next); } catch (err) { if (notFound(err)) return next; throw err; }
  }
}

async function filesDir() {
  const root = await collabRootAsk();
  return root ? root.getDirectoryHandle(FILES_DIR, { create: true }) : null;
}

export async function openSharedFiles() {
  if (!canUseFolder) { toast('Shared Files needs Chrome or Edge', 'bad'); return; }
  let dir;
  try { dir = await filesDir(); } catch (err) { toast(`Couldn't open Shared Files: ${err.message}`, 'bad'); return; }
  if (!dir) return; // the folder isn't connected (the connect window said why)
  $('#collabTitle').textContent = 'Shared Files';
  $('#collabActions').innerHTML = '<label class="btn primary">Add files…<input type="file" id="sharedFilesAdd" multiple hidden></label>';
  $('#sharedFilesAdd').onchange = e => { const list = [...e.target.files]; e.target.value = ''; addFiles(dir, list); };
  view.q = ''; view.dir = dir;
  await renderFiles(dir);
  if (!$('#collabDialog').open) $('#collabDialog').showModal();
  $('#filesSearch')?.focus();
}

async function renderFiles(dir) {
  let files;
  try { files = await listFiles(dir); } catch (err) { toast(`Couldn't read Shared Files: ${err.message}`, 'bad'); files = []; }
  const body = $('#collabBody');
  body.innerHTML = `
    <div class="dropzone files-drop" id="filesDrop">
      <p class="hint">Files everyone can get, in <code>Audit Builder\\${FILES_DIR}</code> on the Drive. Click Add files… or drop files here.</p>
      ${files.length ? `
      <input type="search" id="filesSearch" class="open-search" placeholder="Search files…" aria-label="Search files" value="${esc(view.q)}">
      <ul class="project-list">${files.map((f, i) => `
        <li><div><b>${esc(f.name)}</b><br>
          <span class="muted">${f.by ? `added by ${esc(f.by)} · ` : ''}${size(f.size)} · changed ${ago(f.modified)}</span></div>
          <span class="actions"><button class="btn" data-get="${i}">Download</button>
          <button class="icon-btn" data-del="${i}" title="Delete ${esc(f.name)}">✕</button></span></li>`).join('')}
      </ul>
      <p class="empty" id="filesNoMatch" hidden>No file matches the search.</p>` : '<p class="empty drop-hint">No shared files yet. Add some, or drop them here.</p>'}
    </div>`;
  dropZone($('#filesDrop'), list => addFiles(dir, list));
  body.querySelectorAll('[data-get]').forEach(b => b.onclick = () => download(files[+b.dataset.get]));
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove(dir, files[+b.dataset.del]));
  const search = $('#filesSearch');
  if (search) {
    const filter = () => {
      view.q = search.value;
      const q = view.q.trim().toLowerCase();
      let shown = 0;
      for (const li of body.querySelectorAll('.project-list li')) { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); shown += !li.hidden; }
      $('#filesNoMatch').hidden = !q || shown > 0;
    };
    search.oninput = filter;
    filter();
  }
}

// the browser saves it like any download (usually to Downloads)
async function download(entry) {
  try {
    const file = await entry.handle.getFile();
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: entry.name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (err) { toast(`Couldn't download ${entry.name}: ${err.message}`, 'bad'); }
}

async function addFiles(dir, list) {
  if (!list.length) return;
  const person = await askName(); // shown as "added by"; cancelled: added without a name
  const added = [], mine = {};
  try {
    for (const file of list) {
      let name = file.name;
      let exists = true;
      try { await dir.getFileHandle(name); } catch (err) { if (notFound(err)) exists = false; else throw err; }
      if (exists) {
        const pick = await choose(`${name} is already there`, 'Replace the file in Shared Files with this one, or keep both (the new one gets a number added to its name)?',
          [['replace', 'Replace'], ['both', 'Keep both', 'primary']]);
        if (!pick) continue;
        if (pick === 'both') name = await freeName(dir, name);
      }
      const h = await dir.getFileHandle(name, { create: true });
      const w = await h.createWritable(); await w.write(file); await w.close();
      added.push(name);
      mine[name] = { at: Date.now(), size: file.size };
    }
    if (person && added.length) await writeMyInfo(dir, person, mine);
  } catch (err) { toast(`Couldn't add the files: ${err.message}`, 'bad'); }
  if (added.length) toast(added.length === 1 ? `Added ${added[0]}` : `Added ${added.length} files`);
  await renderFiles(dir);
}

async function remove(dir, entry) {
  if (!confirm(`Delete ${entry.name} from Shared Files for everyone?\n\nGoogle Drive keeps it in its Trash for 30 days.`)) return;
  try {
    await dir.removeEntry(entry.name);
    toast(`Deleted ${entry.name}`);
    const person = load(STORE_PERSON, '');
    if (person && entry.by === person) await writeMyInfo(dir, person, { [entry.name]: null });
  } catch (err) { toast(`Couldn't delete ${entry.name}: ${err.message}`, 'bad'); }
  await renderFiles(dir);
}

export function initSharedFiles() {
  $('#btnSharedFiles').onclick = openSharedFiles;
  // coming back to the app: what the others added meanwhile
  window.addEventListener('focus', () => { if (view.dir && $('#collabDialog').open && $('#collabTitle').textContent === 'Shared Files') renderFiles(view.dir); });
}
