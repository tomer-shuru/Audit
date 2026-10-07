import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/engine/report.js';
import models from '../src/data/default-models.json' with { type: 'json' };

const project = (extra = {}) => ({
  settings: { projectNumber: 'SHR1', prefix: 'GG', endClient: 'X' },
  inputs: { mac: '', windows: '', blanccoFiles: [] },
  manual: {}, overrides: {}, ...extra,
});
const texts = r => r.warnings.map(w => w.text);

test('warns when Diagnostics is empty, until it is filled in', () => {
  const r1 = buildReport(project({ manual: { GG01: { sn: 'A1' } } }), models);
  assert.ok(texts(r1).includes('GG01: Diagnostics is empty'));
  const r2 = buildReport(project({ manual: { GG01: { sn: 'A1' } }, overrides: { GG01: { diagnostics: 'ok' } } }), models);
  assert.ok(!texts(r2).some(t => t.includes('Diagnostics is empty')));
});

test('item numbering: gaps and codes that do not fit', () => {
  const r = buildReport(project({ manual: { GG03: { diagnostics: 'ok' }, GG06: { diagnostics: 'ok' }, X9: { diagnostics: 'ok' } } }), models);
  assert.deepEqual(r.rows.map(x => x.itemLookup), ['GG03', 'GG06', 'X9']);
  assert.ok(texts(r).includes('No data yet for: GG04–GG05'));
  assert.ok(r.warnings.some(w => w.item === 'X9' && /doesn't follow/.test(w.text)));
});

test('several Blancco files are combined', () => {
  const head = ['Device Identifier', 'System serial', 'Erasure state', 'System chassis type', 'Comment'];
  const r = buildReport(project({ inputs: { mac: '', windows: '', blanccoFiles: [
    { name: 'a.csv', table: [head, ['GG01', 'S1', 'Successful', 'Desktop', 'ok']] },
    { name: 'b.csv', table: [head, ['GG01', 'S1', 'Successful', 'Desktop', 'ok'], ['GG02', 'S2', 'Failed', 'Desktop', 'cd b']] },
  ] } }), models);
  assert.deepEqual(r.rows.map(x => [x.itemLookup, x.blancco, x.diagnostics]), [['GG01', 'Pass', 'Ok'], ['GG02', 'Fail', 'Cd B']]);
  assert.ok(r.warnings.some(w => w.level === 'error' && w.item === 'GG02'));
});
