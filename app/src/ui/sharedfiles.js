// Shared projects on disk: G:\My Drive\Audit Builder\Projects\<End client_Project number>\
//   project.json          the project settings, written only by the person who shared the project
//   <name>.part.json      one file per person, written only by that person (see engine/parts.js)
import { writeFile } from './filesave.js';
import { normalizePart } from '../engine/parts.js';

const PROJECTS = 'Projects';
export const PROJECT_JSON = 'project.json';
const PART = /\.part\.json$/i;

// characters Windows doesn't allow in file names become -
export const safeName = s => String(s ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/[. ]+$/, '');
export const partFileName = person => `${safeName(person)}.part.json`;
export const projectDirName = s => [s.endClient, s.projectNumber].map(safeName).filter(Boolean).join('_') || 'project';

const notFound = err => err.name === 'NotFoundError' || err.name === 'TypeMismatchError';

export async function projectsDir(root, create = false) {
  try { return await root.getDirectoryHandle(PROJECTS, { create }); } catch (err) { if (notFound(err)) return null; throw err; }
}

export async function projectDir(root, name, create = false) {
  const projects = await projectsDir(root, create);
  if (!projects) return null;
  try { return await projects.getDirectoryHandle(name, { create }); } catch (err) { if (notFound(err)) return null; throw err; }
}

// { data, modified, size } or null when the file isn't there. A file Drive is still syncing may be half written:
// that throws (bad JSON), and the caller keeps what it read before.
export async function readJson(dir, name) {
  let file;
  try { file = await (await dir.getFileHandle(name)).getFile(); } catch (err) { if (notFound(err)) return null; throw err; }
  return { data: JSON.parse(await file.text()), modified: file.lastModified, size: file.size };
}

export async function writeJson(dir, name, data) {
  await writeFile(await dir.getFileHandle(name, { create: true }), JSON.stringify(data));
}

// everyone's part files except one's own: { [file name]: { part, modified, size } }.
// Files that haven't changed since the last read (cache) aren't read again; a file that can't be read
// right now keeps its last good copy.
export async function readParts(dir, cache = {}, skip = '') {
  const out = {};
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'file' || !PART.test(name) || name.toLowerCase() === skip.toLowerCase()) continue;
    const file = await h.getFile();
    const old = cache[name];
    if (old && old.modified === file.lastModified && old.size === file.size) { out[name] = old; continue; }
    try {
      out[name] = { part: normalizePart(JSON.parse(await file.text())), modified: file.lastModified, size: file.size };
    } catch { if (old) out[name] = old; }
  }
  return out;
}

// the project files (.audit.json) in the Projects folder, newest first: { name, handle, modified }
export async function listProjectFiles(root) {
  const projects = await projectsDir(root);
  if (!projects) return [];
  const list = [];
  for await (const [name, h] of projects.entries()) {
    if (h.kind !== 'file' || !/\.audit\.json$/i.test(name)) continue;
    list.push({ name, handle: h, modified: (await h.getFile()).lastModified });
  }
  return list.sort((a, b) => b.modified - a.modified);
}

// the shared projects in the folder, newest first: { name, dir, info (project.json), people: [{ person, modified }] }
export async function listSharedProjects(root) {
  const projects = await projectsDir(root);
  if (!projects) return [];
  const list = [];
  for await (const [name, dir] of projects.entries()) {
    if (dir.kind !== 'directory') continue;
    let info = null;
    try { info = (await readJson(dir, PROJECT_JSON))?.data; } catch { /* still syncing */ }
    if (!info) continue;
    const people = [];
    for await (const [file, h] of dir.entries()) {
      if (h.kind !== 'file' || !PART.test(file)) continue;
      people.push({ person: file.replace(PART, ''), modified: (await h.getFile()).lastModified });
    }
    list.push({ name, dir, info, people, modified: Math.max(0, ...people.map(p => p.modified)) });
  }
  return list.sort((a, b) => b.modified - a.modified);
}
