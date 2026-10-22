// The app's state, what is kept in localStorage, and undo / redo.
// Imports no other UI module, so it is ready before any of them runs (they all read it at load or later).
import { DEFAULT_CONFIG, withDefaults } from '../engine/config.js';
import defaultModels from '../data/default-models.json';

// localStorage keys
export const STORE_PROJECT = 'auditApp.project';
export const STORE_MODELS = 'auditApp.models';
export const STORE_TAB = 'auditApp.tab';
export const STORE_CONFIG = 'auditApp.config'; // DevMode rules
export const STORE_THEME = 'auditApp.theme';
export const STORE_EXPORT_COLS = 'auditApp.exportHiddenCols';
export const STORE_PERSON = 'auditApp.person', STORE_DEVICE = 'auditApp.device', STORE_COLLAB = 'auditApp.collab';

export const TABS = ['data', 'manual', 'report', 'bios']; // Alt+1 … Alt+4

export const load = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
// false when the browser couldn't keep it (storage full or unavailable)
export const store = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; } };

export const emptyProject = () => ({
  version: 2,
  // output: which sheet layout the Final Report uses ('shuru', 'sims' or 'google')
  // sheetUrl: the project's Google Sheet (optional; Send to / Load from Google Sheet)
  settings: { projectNumber: '', prefix: '', endClient: '', startNumber: 1, output: 'shuru', sheetUrl: '' },
  inputs: { reports: '', blanccoFiles: [], sheet: '', bios: null }, // bios: the Microsoft BIOS password file { fileName, text, at }
  manual: {}, overrides: {},
  simsOverrides: {}, // edits of SIMS-only columns, made in the Final Report table in SIMS layout
  savedToFile: true,
});

// bring projects saved by older versions up to date
export function migrate(p) {
  const project = Object.assign(emptyProject(), p);
  project.inputs = Object.assign(emptyProject().inputs, p.inputs);
  const inp = project.inputs;
  if (Array.isArray(inp.blancco)) {
    if (!inp.blanccoFiles.length && inp.blancco.length > 1) inp.blanccoFiles = [{ name: inp.blanccoSource || 'Blancco export', table: inp.blancco }];
    delete inp.blancco; delete inp.blanccoSource;
  }
  // Mac and Windows reports used to be pasted in two boxes; now they share one
  if ('mac' in inp || 'windows' in inp) {
    inp.reports = [inp.reports, inp.mac, inp.windows].map(t => String(t ?? '').trim()).filter(Boolean).join('\n');
    delete inp.mac; delete inp.windows;
  }
  project.settings = Object.assign(emptyProject().settings, p.settings);
  return project;
}

// Dictionary lists added in later versions: a Dictionary saved before them gets the built-in ones
export function withNewLists(m) {
  const missing = m ? ['makeMap', 'simsCodes', 'simsAliases', 'simsIgnore', 'simsCategories'].filter(k => !Array.isArray(m[k])) : [];
  return missing.length ? { ...m, ...Object.fromEntries(missing.map(k => [k, structuredClone(defaultModels[k])])) } : m;
}
export const builtInModels = () => structuredClone(defaultModels);

export const state = {
  project: migrate(load(STORE_PROJECT, {})),
  models: withNewLists(load(STORE_MODELS, null) || builtInModels()),
  config: withDefaults(load(STORE_CONFIG, null) || DEFAULT_CONFIG), // DevMode rules (the shared config.json)
  tab: (t => (t === 'review' ? 'report' : TABS.includes(t) ? t : 'report'))(load(STORE_TAB, 'data')), // (the Final Report tab was called review)
  report: null, // set by recompute(), with sims (SIMS layout) and sheet (Google Sheet rows)
  fileName: '', // the project file Save writes to
  modelsTab: 'models',
  modelsFilter: {}, // Dictionary filters per tab: { q, category, mapped }
  manualSelected: new Set(),
  collab: null, // a shared project (see collab.js); null for a project on this computer only
};

export const settingsComplete = s => s.projectNumber.trim() && s.endClient.trim(); // the prefix may be empty (codes that are just numbers)
export const isSims = () => state.project.settings.output === 'sims';
// the outputs (sheet layouts) a project can have, by settings.output; each has its own color in styles.css
export const OUTPUTS = { shuru: 'Shuru', sims: 'SIMS', google: 'Google' };
export const outputOf = () => state.project.settings.output || 'shuru';
// a shared project's settings are changed by the person who shared it
export const canEditSettings = () => !state.collab || state.collab.owner === state.collab.me;
// in a shared project: the others' parts
export const otherParts = () => (state.collab ? Object.values(state.collab.others).map(o => o.part) : []);

// ---------- undo / redo for edits in the Final Report and Manual entries tables ----------
export const history = { undo: [], redo: [] };
export const snapshot = () => JSON.stringify({ manual: state.project.manual, overrides: state.project.overrides, simsOverrides: state.project.simsOverrides });
export function recordEdit() {
  history.undo.push(snapshot());
  if (history.undo.length > 200) history.undo.shift();
  history.redo = [];
}
export const clearHistory = () => { history.undo = []; history.redo = []; };
