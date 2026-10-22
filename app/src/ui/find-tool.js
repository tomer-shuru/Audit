// Tools › Find a device: searches every project in the Projects folder (project files and shared projects) for an
// item code or number, a serial number (S.N.) or an asset tag, and opens the project at that item.
// Each project's report is built once and kept until its files change; the open project uses its live report.
import { deviceMatch, MIN_PART } from '../engine/lookup.js';
import { combinedProject } from '../engine/parts.js';
import { listProjectFiles, listSharedProjects, readParts } from './sharedfiles.js';
import { state, migrate } from './state.js';
import { $, esc, plural, toast } from './util.js';
import { reportRowsOf } from './app.js';
import { collabRootAsk, joinShared } from './share.js';
import { openListedFile } from './project.js';
import { showItem } from './report-tab.js';

const SHOWN_MAX = 200;
const FIELDS = [['itemLookup', 'Item'], ['sn', 'S.N.'], ['asset', 'Asset'], ['type', 'Type'], ['make', 'Make'], ['model', 'Model']];
// what is kept of a report row: the columns shown, and the ITEM column (searched too)
const keep = row => ({ item: row.item ?? '', ...Object.fromEntries(FIELDS.map(([k]) => [k, row[k] ?? ''])) });

// reports already built: { [key]: { stamp, title, rows } } (stamp: when its files last changed)
const built = new Map();
// what the window is showing: the projects found ({ key, title, rows, isOpen(), open() }) and the search
const find = { projects: [], loading: false, q: '' };

const titleOf = (settings, fallback) => [settings?.endClient, settings?.projectNumber].filter(Boolean).join(' · ') || fallback;

// a project's name and report rows, built again only when its files changed
async function readReport({ key, stamp, read, fileName }) {
  const old = built.get(key);
  if (old?.stamp === stamp) return old;
  const project = migrate(await read());
  const report = { stamp, title: titleOf(project.settings, fileName), rows: reportRowsOf(project).map(keep) };
  built.set(key, report);
  return report;
}

// every project in the Projects folder; progress(done, total) after each one
async function readProjects(root, progress) {
  const [shared, files] = await Promise.all([listSharedProjects(root), listProjectFiles(root)]);
  const all = [
    ...shared.map(entry => ({
      key: `shared:${entry.name}`, fileName: entry.name, shared: true,
      stamp: `${entry.modified}|${entry.info.settingsAt}`,
      read: async () => combinedProject(entry.info.settings || {}, Object.values(await readParts(entry.dir)).map(o => o.part)),
      isOpen: () => state.collab?.dir === entry.name,
      open: () => joinShared(entry),
    })),
    ...files.map(entry => ({
      key: `file:${entry.name}`, fileName: entry.name.replace(/\.audit\.json$/i, ''), stamp: String(entry.modified),
      read: async () => JSON.parse(await (await entry.handle.getFile()).text()),
      isOpen: () => !state.collab && state.fileName === entry.name,
      open: () => openListedFile(entry),
    })),
  ];
  const out = [];
  let failed = 0;
  for (const [i, p] of all.entries()) {
    try {
      // the open project: its report as it is now, unsaved changes included
      const { title, rows } = p.isOpen()
        ? { title: titleOf(state.project.settings, p.fileName), rows: state.report.rows.map(keep) }
        : await readReport(p);
      out.push({ ...p, title, rows });
    } catch { failed++; } // still syncing or damaged: left out this time
    progress(i + 1, all.length);
    await new Promise(r => setTimeout(r)); // let the window show the progress
  }
  return { projects: out, failed };
}

export async function openFindDevice() {
  const root = await collabRootAsk();
  if (!root) return;
  $('#collabTitle').textContent = 'Find a device';
  $('#collabActions').innerHTML = '';
  $('#collabBody').innerHTML = `
    <p class="hint">Searches every project in the Projects folder. Type an item code (GG07), an item number (7), or part of a serial number or asset tag.</p>
    <input type="search" id="findSearch" class="open-search" placeholder="Item, serial number or asset tag…" aria-label="Find a device" value="${esc(find.q)}">
    <p class="hint" id="findStatus"></p>
    <div id="findResults"></div>`;
  const search = $('#findSearch');
  let timer;
  search.oninput = () => { find.q = search.value; clearTimeout(timer); timer = setTimeout(drawResults, 150); };
  if (!$('#collabDialog').open) $('#collabDialog').showModal();
  search.focus(); search.select();

  find.loading = true;
  const status = $('#findStatus');
  try {
    const { projects, failed } = await readProjects(root, (done, total) => { status.textContent = `Reading the projects… ${done} of ${total}`; });
    find.projects = projects;
    status.textContent = `${plural(projects.length, 'project')} searched${failed ? ` (${plural(failed, 'project')} couldn't be read right now)` : ''}.`;
  } catch (err) {
    status.textContent = '';
    toast(`Couldn't read the Projects folder: ${err.message}`, 'bad');
  }
  find.loading = false;
  if ($('#findResults')) drawResults();
}

function drawResults() {
  const box = $('#findResults');
  if (!box) return;
  const q = find.q.trim();
  if (!q) { box.innerHTML = ''; return; }
  const hits = [];
  for (const project of find.projects) {
    for (const row of project.rows) {
      const field = deviceMatch(row, q);
      if (field) hits.push({ project, row, field });
    }
  }
  const tooShort = !/^\d+$/.test(q) && q.replace(/[\s-]/g, '').length < MIN_PART;
  const shown = hits.slice(0, SHOWN_MAX);
  box.innerHTML = !hits.length ? `<p class="empty">${find.loading ? 'Still reading the projects…' : tooShort ? `Type at least ${MIN_PART} characters of a serial number or asset tag.` : 'No device found.'}</p>` : `
    <div class="table-wrap find-results"><table class="grid">
      <thead><tr><th>Project</th>${FIELDS.map(([, label]) => `<th>${label}</th>`).join('')}<th></th></tr></thead>
      <tbody>${shown.map((h, i) => `<tr>
        <td>${esc(h.project.title)}${h.project.shared ? ' <span class="muted">(shared)</span>' : ''}</td>
        ${FIELDS.map(([k]) => `<td class="${h.field === k || (h.field === 'item' && k === 'itemLookup') ? 'find-hit' : ''}">${esc(h.row[k])}</td>`).join('')}
        <td>${h.project.isOpen() ? `<button class="btn small" data-hit="${i}">Show</button>` : `<button class="btn small primary" data-hit="${i}">Open</button>`}</td></tr>`).join('')}
      </tbody></table></div>
    <p class="hint">${hits.length > SHOWN_MAX ? `The first ${SHOWN_MAX} of ${hits.length} devices found are shown.` : plural(hits.length, 'device') + ' found.'}</p>`;
  box.querySelectorAll('[data-hit]').forEach(b => b.onclick = () => openAt(shown[+b.dataset.hit]));
}

// opens the device's project (unless it is the open one) and shows the device on the Final Report
async function openAt({ project, row }) {
  if (!project.isOpen() && !(await project.open())) return;
  $('#collabDialog').close();
  if (!showItem(row.itemLookup)) toast(`${row.itemLookup} isn't in the report any more`, 'bad');
}

export function initFindDevice() {
  $('#btnFind').onclick = openFindDevice;
}
