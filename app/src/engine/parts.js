// Shared projects: several people work on one project at the same time. Each person's app writes only its own
// part file (Projects\<project>\<name>.part.json in the shared Drive folder) and reads everyone else's, so no file
// is ever written by two people and Drive never has to choose between two versions.
//
// A part holds:
//   inputs: { reports, blanccoFiles, bios }   what this person pasted / added (everyone's are added together;
//                                       bios, the BIOS password file { fileName, text, at }: the newest one counts)
//   sheet: { v, at, prev }              the Google Sheet rows: one shared box, the newest paste counts
//   items: { [code]: { at, deleted } }  manual entries this person added or deleted
//   cells: { manual | overrides | simsOverrides: { [code]: { [field]: { v, at, prev } } } }
//          every cell this person changed; v '' = cleared. at = when, prev = the time of the value it replaced
//          (so two people changing one cell without seeing each other's change can be told apart from a correction)
// Combining the parts takes the newest change of every cell.

export const COLLECTIONS = ['manual', 'overrides', 'simsOverrides'];

export const emptyPart = (person, device = '') => ({
  version: 1, person, device, updatedAt: 0,
  inputs: { reports: '', blanccoFiles: [], bios: null },
  sheet: null, items: {},
  cells: { manual: {}, overrides: {}, simsOverrides: {} },
});

// fills in what an older or damaged part file leaves out
export function normalizePart(p) {
  const blank = emptyPart('');
  const part = { ...blank, ...p, inputs: { ...blank.inputs, ...p?.inputs }, cells: { ...blank.cells, ...p?.cells } };
  part.items = part.items || {};
  return part;
}

const cellKey = (c, code, f) => `${c}|${code}|${f}`;
const itemStamp = code => `item|${code}`;
// newest first; on the same moment the person's name decides, so every computer picks the same winner
const newer = (a, b) => a.at > b.at || (a.at === b.at && a.person > b.person);

// What changed between two views of the shared data, as a list of operations:
//   { c: 'manual', code, add: true } / { c: 'manual', code, del: true }   a manual entry added or deleted
//   { c, code, f, v }                                                     a cell set (v '' = cleared)
//   { c: 'sheet', v }                                                     the Google Sheet rows
// A view: { manual, overrides, simsOverrides, sheet }
export function diffShared(a, b) {
  const ops = [];
  for (const c of COLLECTIONS) {
    const A = a[c] || {}, B = b[c] || {};
    for (const code of new Set([...Object.keys(A), ...Object.keys(B)])) {
      if (c === 'manual') {
        if (code in A && !(code in B)) { ops.push({ c, code, del: true }); continue; }
        if (!(code in A)) ops.push({ c, code, add: true });
      }
      const ra = A[code] || {}, rb = B[code] || {};
      for (const f of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
        const va = String(ra[f] ?? ''), vb = String(rb[f] ?? '');
        if (va !== vb) ops.push({ c, code, f, v: vb });
      }
    }
  }
  if ('sheet' in a && 'sheet' in b && (a.sheet ?? '') !== (b.sheet ?? '')) ops.push({ c: 'sheet', v: b.sheet ?? '' });
  return ops;
}

// Applies operations to a view in place (objects stay the same, so code holding them keeps working).
// The sheet is set on view.inputs.sheet when the view has inputs (a project), else on view.sheet if it has one.
export function patchShared(view, ops) {
  for (const op of ops) {
    if (op.c === 'sheet') {
      if (view.inputs) view.inputs.sheet = op.v;
      else if ('sheet' in view) view.sheet = op.v;
      continue;
    }
    const coll = view[op.c];
    if (!coll) continue;
    if (op.del) { delete coll[op.code]; continue; }
    if (op.add) { coll[op.code] ??= {}; continue; }
    if (op.v === '') {
      if (!coll[op.code]) continue;
      delete coll[op.code][op.f];
      if (op.c !== 'manual' && !Object.keys(coll[op.code]).length) delete coll[op.code];
    } else (coll[op.code] ??= {})[op.f] = op.v;
  }
  return view;
}

// Writes this person's changes into their part. stamps (from combineParts) say when each cell last changed;
// they are updated here, so quick changes in a row follow each other even before the next combine.
// A change always gets a later time than the value it replaces, even if another computer's clock is ahead.
export function recordOps(part, ops, stamps, now = Date.now()) {
  const person = part.person;
  for (const op of ops) {
    if (op.c === 'sheet') {
      const prev = stamps.sheet?.at ?? 0;
      const at = Math.max(now, prev + 1);
      part.sheet = { v: op.v, at, prev };
      stamps.sheet = { at, person };
      continue;
    }
    const itemAt = stamps[itemStamp(op.code)]?.at ?? 0;
    if (op.del || op.add) {
      const at = Math.max(now, itemAt + 1);
      part.items[op.code] = op.del ? { at, deleted: true } : { at };
      if (op.del) delete part.cells.manual[op.code]; // older than the delete: not needed any more
      stamps[itemStamp(op.code)] = { at, person };
      continue;
    }
    const k = cellKey(op.c, op.code, op.f);
    const prev = stamps[k]?.at ?? 0;
    const at = Math.max(now, prev + 1, op.c === 'manual' ? itemAt + 1 : 0);
    ((part.cells[op.c] ??= {})[op.code] ??= {})[op.f] = { v: op.v, at, prev };
    stamps[k] = { at, person };
    if (op.c === 'manual') stamps[itemStamp(op.code)] = { at, person };
  }
  part.updatedAt = Math.max(part.updatedAt || 0, now);
  return part;
}

// Everyone's parts → the shared view { manual, overrides, simsOverrides, sheet }, plus
// stamps (when each cell last changed, for recordOps) and conflicts: cells two people changed
// at about the same time without seeing each other's change ({ c, code, f, kept, lost }).
export function combineParts(parts) {
  const view = { manual: {}, overrides: {}, simsOverrides: {}, sheet: '' };
  const stamps = {}, conflicts = [];

  // the Google Sheet rows: the newest paste
  let sheet = null;
  for (const p of parts) if (p.sheet && (!sheet || newer({ ...p.sheet, person: p.person }, sheet))) sheet = { ...p.sheet, person: p.person };
  if (sheet) { view.sheet = sheet.v; stamps.sheet = { at: sheet.at, person: sheet.person }; }

  // manual entries: when each was last deleted, and when it last got something (added or a cell typed)
  const deletedAt = {}, liveAt = {};
  const keepNewest = (map, code, at, person) => { if (!map[code] || newer({ at, person }, map[code])) map[code] = { at, person }; };
  for (const p of parts) {
    for (const [code, it] of Object.entries(p.items || {})) keepNewest(it.deleted ? deletedAt : liveAt, code, it.at, p.person);
    for (const [code, rec] of Object.entries(p.cells?.manual || {})) {
      for (const cell of Object.values(rec)) keepNewest(liveAt, code, cell.at, p.person);
    }
  }
  for (const code of new Set([...Object.keys(deletedAt), ...Object.keys(liveAt)])) {
    const d = deletedAt[code], l = liveAt[code];
    const live = l && (!d || newer(l, d));
    stamps[itemStamp(code)] = live ? l : d;
    if (live) view.manual[code] = {};
  }

  for (const c of COLLECTIONS) {
    // every record of every cell
    const records = new Map();
    for (const p of parts) {
      for (const [code, rec] of Object.entries(p.cells?.[c] || {})) {
        for (const [f, cell] of Object.entries(rec)) {
          if (c === 'manual' && deletedAt[code] && cell.at <= deletedAt[code].at) continue; // from before the entry was deleted
          const k = cellKey(c, code, f);
          if (!records.has(k)) records.set(k, { code, f, list: [] });
          records.get(k).list.push({ ...cell, v: String(cell.v ?? ''), person: p.person });
        }
      }
    }
    for (const [k, { code, f, list }] of records) {
      const win = list.reduce((a, b) => (newer(b, a) ? b : a));
      stamps[k] = { at: win.at, person: win.person };
      if (win.v !== '' && (c !== 'manual' || view.manual[code])) (view[c][code] ??= {})[f] = win.v;
      for (const r of list) {
        if (r !== win && r.person !== win.person && r.v !== win.v && r.at > (win.prev ?? 0)) {
          conflicts.push({ c, code, f, kept: { person: win.person, v: win.v }, lost: { person: r.person, v: r.v } });
        }
      }
    }
  }
  return { view, stamps, conflicts };
}

// the inputs everyone added, together: reports one after the other, Blancco files in one list (each knows whose it is),
// the newest BIOS password file (or its removal)
export function combinedInputs(parts) {
  const bios = parts.map(p => p.inputs?.bios).filter(b => b?.at).reduce((a, b) => (!a || b.at > a.at ? b : a), null);
  return {
    bios,
    reports: parts.map(p => String(p.inputs?.reports ?? '').trim()).filter(Boolean).join('\n'),
    blanccoFiles: parts.flatMap(p => (p.inputs?.blanccoFiles || []).map(f => ({ ...f, by: p.person }))),
  };
}
