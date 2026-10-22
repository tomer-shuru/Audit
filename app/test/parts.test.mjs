import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyPart, diffShared, patchShared, recordOps, combineParts, combinedInputs, changeHistory, logInputs, combinedProject } from '../src/engine/parts.js';

const view = (v = {}) => ({ manual: {}, overrides: {}, simsOverrides: {}, sheet: '', ...v });
const clone = v => structuredClone(v);

// one person's app: edits its view, records them in its part, then everyone combines
function person(name) {
  const part = emptyPart(name);
  return {
    part,
    edit(current, next, stamps, now) { recordOps(part, diffShared(current, next), stamps, now); },
  };
}

test('diff and patch: adding, changing, clearing and deleting', () => {
  const a = view({ manual: { GG1: { model: 'X' } }, overrides: { GG2: { sn: 'S1' } } });
  const b = view({ manual: { GG3: {} }, overrides: { GG2: { sn: 'S2', type: 'Laptop' } }, sheet: 'rows' });
  const ops = diffShared(a, b);
  assert.deepEqual(ops, [
    { c: 'manual', code: 'GG1', del: true },
    { c: 'manual', code: 'GG3', add: true },
    { c: 'overrides', code: 'GG2', f: 'sn', v: 'S2' },
    { c: 'overrides', code: 'GG2', f: 'type', v: 'Laptop' },
    { c: 'sheet', v: 'rows' },
  ]);
  assert.deepEqual(patchShared(clone(a), ops), b);
  // clearing the last edit of an item removes the item from the overrides
  assert.deepEqual(patchShared(view({ overrides: { GG2: { sn: 'S1' } } }), [{ c: 'overrides', code: 'GG2', f: 'sn', v: '' }]).overrides, {});
});

test('patch keeps the same objects, and sets the sheet on a project\'s inputs', () => {
  const project = { manual: { GG1: {} }, overrides: {}, simsOverrides: {}, inputs: { sheet: '' } };
  const man = project.manual, rec = project.manual.GG1;
  patchShared(project, [{ c: 'manual', code: 'GG1', f: 'model', v: 'X' }, { c: 'sheet', v: 'pasted' }]);
  assert.equal(project.manual, man);
  assert.equal(project.manual.GG1, rec);
  assert.equal(rec.model, 'X');
  assert.equal(project.inputs.sheet, 'pasted');
});

test('two people working on different items: both changes are kept', () => {
  const tomer = person('Tomer'), dana = person('Dana');
  tomer.edit(view(), view({ manual: { GG1: { model: 'A' } } }), {}, 100);
  dana.edit(view(), view({ manual: { GG2: { model: 'B' } }, overrides: { GG7: { sn: 'X' } } }), {}, 105);
  const { view: v, conflicts } = combineParts([tomer.part, dana.part]);
  assert.deepEqual(v.manual, { GG1: { model: 'A' }, GG2: { model: 'B' } });
  assert.deepEqual(v.overrides, { GG7: { sn: 'X' } });
  assert.deepEqual(conflicts, []);
});

test('three people: the same cell changed without seeing each other is a conflict, the newest wins', () => {
  const a = person('Avi'), b = person('Ben'), c = person('Chen');
  const base = view({ overrides: {} });
  a.edit(base, view({ overrides: { GG5: { model: 'K-1' } } }), {}, 100);
  b.edit(base, view({ overrides: { GG5: { model: 'K-2' } } }), {}, 110);
  c.edit(base, view({ overrides: { GG6: { model: 'Z' } } }), {}, 120);
  const { view: v, conflicts } = combineParts([a.part, b.part, c.part]);
  assert.deepEqual(v.overrides, { GG5: { model: 'K-2' }, GG6: { model: 'Z' } });
  assert.deepEqual(conflicts, [{ c: 'overrides', code: 'GG5', f: 'model', kept: { person: 'Ben', v: 'K-2' }, lost: { person: 'Avi', v: 'K-1' } }]);
});

test('correcting someone else\'s value after seeing it is not a conflict', () => {
  const a = person('Avi'), b = person('Ben');
  a.edit(view(), view({ overrides: { GG5: { model: 'K-1' } } }), {}, 100);
  const seen = combineParts([a.part, b.part]);
  b.edit(seen.view, view({ overrides: { GG5: { model: 'K-100' } } }), seen.stamps, 200);
  const { view: v, conflicts } = combineParts([a.part, b.part]);
  assert.equal(v.overrides.GG5.model, 'K-100');
  assert.deepEqual(conflicts, []);
});

test('a change beats the value it replaces even when the other computer\'s clock is ahead', () => {
  const a = person('Avi'), b = person('Ben');
  a.edit(view(), view({ overrides: { GG5: { model: 'Ahead' } } }), {}, 5000);
  const seen = combineParts([a.part, b.part]);
  b.edit(seen.view, view({ overrides: { GG5: { model: 'Fixed' } } }), seen.stamps, 1000);
  assert.equal(combineParts([a.part, b.part]).view.overrides.GG5.model, 'Fixed');
});

test('deleting someone else\'s manual entry keeps it deleted; adding it again starts it empty', () => {
  const a = person('Avi'), b = person('Ben');
  a.edit(view(), view({ manual: { GG9: { model: 'M', sn: '1' } } }), {}, 100);
  let seen = combineParts([a.part, b.part]);
  assert.deepEqual(seen.view.manual, { GG9: { model: 'M', sn: '1' } });
  b.edit(seen.view, view({ manual: {} }), seen.stamps, 200);
  seen = combineParts([a.part, b.part]);
  assert.deepEqual(seen.view.manual, {});
  a.edit(seen.view, view({ manual: { GG9: {} } }), seen.stamps, 300);
  assert.deepEqual(combineParts([a.part, b.part]).view.manual, { GG9: {} });
});

test('typing in an entry someone deleted at the same time brings it back with only the new value', () => {
  const a = person('Avi'), b = person('Ben');
  a.edit(view(), view({ manual: { GG9: { model: 'M', sn: '1' } } }), {}, 100);
  const seen = combineParts([a.part, b.part]);
  b.edit(seen.view, view({ manual: {} }), seen.stamps, 200);            // Ben deletes
  a.edit(seen.view, view({ manual: { GG9: { model: 'M', sn: '2' } } }), seen.stamps, 250); // Avi hadn't seen it yet
  assert.deepEqual(combineParts([a.part, b.part]).view.manual, { GG9: { sn: '2' } });
});

test('the newest Google Sheet paste counts; inputs are added together', () => {
  const a = person('Avi'), b = person('Ben');
  a.edit(view(), view({ sheet: 'old rows' }), {}, 100);
  b.edit(view(), view({ sheet: 'new rows' }), {}, 200);
  assert.equal(combineParts([a.part, b.part]).view.sheet, 'new rows');
  a.part.inputs = { reports: 'GG1*mac line\n', blanccoFiles: [{ name: 'a.csv', table: [['h']] }] };
  b.part.inputs = { reports: '', blanccoFiles: [{ name: 'b.csv', table: [['h']] }] };
  assert.deepEqual(combinedInputs([a.part, b.part]), {
    bios: null,
    reports: 'GG1*mac line',
    blanccoFiles: [{ name: 'a.csv', table: [['h']], by: 'Avi' }, { name: 'b.csv', table: [['h']], by: 'Ben' }],
  });
});

test('the newest BIOS password file anyone loaded counts, and removing it is a change too', () => {
  const a = emptyPart('Avi'), b = emptyPart('Ben');
  a.inputs.bios = { fileName: 'old.txt', text: '1;x', at: 100 };
  b.inputs.bios = { fileName: 'new.txt', text: '1;y', at: 200 };
  assert.equal(combinedInputs([a, b]).bios.fileName, 'new.txt');
  a.inputs.bios = { at: 300 }; // Avi removed it
  assert.equal(combinedInputs([b, a]).bios.text, undefined);
});

test('every computer combines the parts the same way, whatever order it reads them in', () => {
  const a = person('Avi'), b = person('Ben');
  a.edit(view(), view({ overrides: { GG1: { model: 'A' } } }), {}, 100);
  b.edit(view(), view({ overrides: { GG1: { model: 'B' } } }), {}, 100); // the very same moment
  assert.deepEqual(combineParts([a.part, b.part]).view, combineParts([b.part, a.part]).view);
});

test('change history: each change with who, when and what it was', () => {
  const dana = emptyPart('Dana'), tomer = emptyPart('Tomer');
  const stamps = {};
  const v1 = view({ manual: { GG1: {} } });
  recordOps(dana, diffShared(view(), v1), stamps, 100, view());
  const v2 = view({ manual: { GG1: { model: 'X' } } });
  recordOps(dana, diffShared(v1, v2), stamps, 200, v1);
  const v3 = view({ manual: { GG1: { model: 'Y' } }, overrides: { GG1: { sn: 'S1' } } });
  recordOps(tomer, diffShared(v2, v3), stamps, 300, v2);
  const h = changeHistory([dana, tomer]);
  assert.deepEqual(h.map(e => [e.person, e.c, e.code, e.f, e.v, e.was, e.add]), [
    ['Tomer', 'overrides', 'GG1', 'sn', 'S1', '', undefined],
    ['Tomer', 'manual', 'GG1', 'model', 'Y', 'X', undefined],
    ['Dana', 'manual', 'GG1', 'model', 'X', '', undefined],
    ['Dana', 'manual', 'GG1', undefined, undefined, undefined, true],
  ]);
});

test('change history: parts without a log give each cell\'s latest value; recording without "before" logs nothing', () => {
  const old = emptyPart('Dana');
  recordOps(old, [{ c: 'overrides', code: 'GG2', f: 'type', v: 'Laptop' }], {}, 50);
  assert.equal(old.log.length, 0);
  assert.deepEqual(changeHistory([old]).map(e => [e.code, e.f, e.v, e.was]), [['GG2', 'type', 'Laptop', undefined]]);
});

test('change history: inputs (reports, Blancco files, BIOS file) and the sheet', () => {
  const p = emptyPart('Dana');
  logInputs(p, { reports: '', blanccoFiles: [{ name: 'a.csv' }] }, { reports: 'l1\nl2\n', blanccoFiles: [{ name: 'b.csv' }], bios: { at: 5, fileName: 'pw.txt' } }, 10);
  recordOps(p, [{ c: 'sheet', v: 'rows' }], {}, 20, view());
  assert.deepEqual(changeHistory([p]).map(({ person, ...e }) => e), [
    { at: 20, c: 'sheet', cleared: false },
    { at: 10, c: 'bios', file: 'pw.txt' },
    { at: 10, c: 'blancco', added: ['b.csv'], removed: ['a.csv'] },
    { at: 10, c: 'reports', lines: 2 },
  ]);
});

test('a project of everyone\'s work together', () => {
  const a = emptyPart('A'), b = emptyPart('B');
  a.inputs.reports = 'line A'; b.inputs.blanccoFiles = [{ name: 'x.csv', table: [] }];
  recordOps(b, [{ c: 'manual', code: 'GG1', add: true }, { c: 'manual', code: 'GG1', f: 'sn', v: 'S' }], {}, 10);
  const p = combinedProject({ prefix: 'GG' }, [a, b]);
  assert.equal(p.inputs.reports, 'line A');
  assert.equal(p.inputs.blanccoFiles[0].by, 'B');
  assert.deepEqual(p.manual, { GG1: { sn: 'S' } });
});
