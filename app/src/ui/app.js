// The core loop: recompute the report from the project, redraw the screen, and what happens after every change
import { buildReport, itemCode, itemName, numberingStart, codeGroup, compareGroups } from '../engine/report.js';
import { itemKey } from '../engine/sources.js';
import { buildSims } from '../engine/sims.js';
import { readSheetRows } from './merge.js';
import { state, store, history, snapshot, clearHistory, isSims, canEditSettings, settingsComplete, STORE_PROJECT, STORE_TAB } from './state.js';
import { $, esc, plural, toast, tableScroll, restoreTableScroll } from './util.js';
import { reportProject, recordMine, conflictWarnings, renderPeopleChip } from './collab.js';
import { scheduleAutosave, renderSaveState } from './project.js';
import { renderData, sheetWarnings } from './data-tab.js';
import { renderManual } from './manual-tab.js';
import { renderReview, LEVEL_WORDS, levelCount } from './review-tab.js';
import { renderBiosTab, biosFile } from './bios-tab.js';
import { renderExport, exportCols } from './export.js';

export function recompute() {
  state.sheet = readSheet();
  const sheet = state.sheet?.records ?? null;
  const project = reportProject();
  state.report = buildReport(project, state.models, state.config, sheet);
  // the SIMS layout is made from the finished report rows; its checks join the report's
  state.sims = isSims() ? buildSims(state.report, project, state.models, state.config, sheet) : null;
  if (state.sims) state.report.warnings.push(...state.sims.warnings);
  if (state.sheet) state.report.warnings.push(...sheetWarnings(state.sheet));
  if (state.collab) state.report.warnings.push(...conflictWarnings());
}

// Rows already in the Google Sheet (Data tab): one more input for the report, the last in line. They are
// read with the columns ticked in the Export window (of the chosen output), the way they get pasted back.
function readSheet() {
  const text = state.project.inputs.sheet;
  if (!text.trim()) return null;
  return readSheetRows({ sheetText: text, cols: exportCols(isSims() ? 'sims' : 'report'), prefix: state.project.settings.prefix, itemPrefix: state.config.texts.itemPrefix });
}

// the rows of the chosen output (Shuru: the Audit Report, SIMS: the SIMS rows)
export const outputRows = () => state.sims?.rows ?? state.report.rows;

// all rows of the chosen output, plus an empty row for every item number from the first item number
// (project setup) up to the highest one that has no data, so the list lines up with the sheet
export const reportRows = () => withEmptyRows(outputRows());

// (each item group on its own: MS, then MS-M, MS-P…)
function withEmptyRows(rows) {
  const settings = state.project.settings;
  const groups = new Map(), rest = []; // group -> Map(number -> rows)
  for (const row of rows) {
    const key = itemKey(row.itemLookup);
    const c = key ? codeGroup(settings, key) : null;
    if (!c) { rest.push(row); continue; }
    if (!groups.has(c.group)) groups.set(c.group, new Map());
    const byNumber = groups.get(c.group);
    if (!byNumber.has(c.n)) byNumber.set(c.n, []);
    byNumber.get(c.n).push(row);
  }
  if (!groups.size) return rows;
  const main = itemKey(settings.prefix), out = [];
  for (const group of [...groups.keys()].sort(compareGroups(settings))) {
    const byNumber = groups.get(group);
    const name = n => itemCode(settings, n, group === main ? undefined : group);
    const numbers = [...byNumber.keys()].sort((a, b) => a - b);
    const { start } = numberingStart(settings, numbers.map(n => itemKey(name(n))), group);
    out.push(...numbers.filter(n => n < start).flatMap(n => byNumber.get(n))); // below the first item number: as they are
    for (let n = start, max = numbers[numbers.length - 1]; n <= max; n++) out.push(...(byNumber.get(n) || [emptyRow(name(n))]));
  }
  return [...out, ...rest];
}

function emptyRow(code) {
  return {
    itemLookup: code, item: itemName(state.project.settings, code, state.config),
    _empty: true, _edited: [], _base: {}, _sources: {},
  };
}

// after every change to the project: save it (shared project: this person's part; otherwise auto-save) and redraw
export function changed({ rerender = true } = {}) {
  state.project.savedToFile = false;
  if (state.collab) recordMine();
  else scheduleAutosave();
  store(STORE_PROJECT, state.project);
  recompute();
  if (rerender) render(); else renderChrome();
}

// another project is now the open one (opened, new, joined, left): fresh undo history, kept on this computer
export function replaceProject(project) {
  state.project = project;
  clearHistory();
  store(STORE_PROJECT, state.project);
  recompute();
}

function restoreEdit(from, to, what) {
  if (!from.length) { toast(`Nothing to ${what}`); return; }
  to.push(snapshot());
  Object.assign(state.project, JSON.parse(from.pop()));
  changed();
}
export const undoEdit = () => restoreEdit(history.undo, history.redo, 'undo');
export const redoEdit = () => restoreEdit(history.redo, history.undo, 'redo');

// the Output pickers (top bar, Review, Export window) all change the same project setting
const OUTPUTS = { shuru: 'Shuru', sims: 'SIMS' };
export function setOutput(value) {
  if (!OUTPUTS[value] || value === (state.project.settings.output || 'shuru')) return;
  if (!canEditSettings()) { renderChrome(); toast(`Only ${state.collab.owner} can change the output of this shared project`, 'bad'); return; }
  state.project.settings.output = value;
  changed();
  toast(`Output: ${OUTPUTS[value]}. Review and Export now use the ${OUTPUTS[value]} layout.`);
}

export function setTab(tab) {
  state.tab = tab; store(STORE_TAB, tab);
  render();
}

// ---------- chrome (header + tabs) ----------
export function renderChrome() {
  const s = state.project.settings;
  const r = state.report;
  $('#projectChip').innerHTML = settingsComplete(s)
    ? `<b>${esc(s.projectNumber)}</b><span>${esc(s.endClient)}</span><span>${esc(s.prefix || 'no prefix')}</span>`
    : '<b>No project set up</b>';
  renderSaveState($('#saveState'));
  renderPeopleChip();
  document.querySelectorAll('select[data-output]').forEach(sel => { sel.value = s.output || 'shuru'; });
  // Review shows how many checks there are: red = problems, yellow = warnings, gray = notes
  const checks = Object.entries(LEVEL_WORDS).map(([l, word]) => {
    const n = levelCount(r.warnings, l);
    return n ? `<span class="badge ${l}" title="${plural(n, word)}">${n}</span>` : '';
  }).join('');
  const counts = {
    data: r.counts.mac + r.counts.win + r.counts.blancco + (state.sheet?.codes.length || 0) || '',
    manual: r.counts.manual || '',
    review: checks,
  };
  // the BIOS passwords tab is there once a password file is loaded (or while it's open, to load one)
  $('#tabs [data-tab="bios"]').hidden = !biosFile() && state.tab !== 'bios';
  document.querySelectorAll('#tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === state.tab);
    b.querySelector('.count').innerHTML = counts[b.dataset.tab] ?? '';
  });
}

const VIEWS = { data: renderData, manual: renderManual, review: renderReview, bios: renderBiosTab };

export function render() {
  renderChrome();
  const main = $('#main');
  keepScroll(main, () => VIEWS[state.tab](main));
  fitTallTable();
  // the Export window, when open, is redrawn too (keeping its tables' scroll position)
  if ($('#exportDialog').open) {
    const body = $('#exportBody');
    const before = tableScroll(body);
    renderExport(body);
    restoreTableScroll(body, before);
  }
}

// re-render without making tables jump back to the top-left (unless it's another tab)
function keepScroll(main, draw) {
  const before = tableScroll(main);
  const tab = main.dataset.tab;
  draw();
  main.dataset.tab = state.tab;
  if (tab === state.tab) restoreTableScroll(main, before);
}

// The Review table gets the height that fits the window: below what's above it if that leaves enough room,
// otherwise the height at which its whole card (header, table, scrollbar) fits once scrolled to it.
export function fitTallTable() {
  const wrap = $('#main .table-wrap.tall');
  if (!wrap) return;
  const card = wrap.closest('.card');
  const around = card.offsetHeight - wrap.offsetHeight; // the card's header, hint and padding
  const gap = 20;
  let h = window.innerHeight - (card.getBoundingClientRect().top + window.scrollY) - around - gap;
  if (h < window.innerHeight * 0.5) h = window.innerHeight - around - 2 * gap;
  wrap.style.maxHeight = `${Math.max(200, Math.floor(h))}px`;
}
