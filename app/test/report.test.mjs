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

test('warns when the same asset tag is on more than one device', () => {
  const r = buildReport(project({
    manual: {
      GG01: { asset: '4004012', diagnostics: 'ok' }, GG02: { asset: '4004012 ', diagnostics: 'ok' },
      GG03: { asset: '4004099', diagnostics: 'ok' }, GG04: { asset: '-', diagnostics: 'ok' }, GG05: { asset: '-', diagnostics: 'ok' },
    },
    overrides: { GG03: { asset: '4004012' } },
  }), models);
  const dup = r.warnings.filter(w => /Asset/.test(w.text));
  assert.deepEqual(dup.map(w => w.item), ['GG01', 'GG02', 'GG03']);
  assert.equal(dup[0].text, 'GG01: Asset 4004012 is also used by GG02, GG03');
});

test('missing Blancco erasure: only a note for Windows reports, a warning for Macs', () => {
  const r = buildReport(project({ inputs: { mac: 'GG02*MACSN*1*Laptop*Apple*MacBookPro18,3*M1*16 GB LPDDR5*500 GB SSD*Normal*Disabled***83*x*t*ok', windows: 'GG01*WINSN*2*Notebook*Dell Inc.*Latitude 5421*cpu*8 GB DDR4*NONE*90%*ok', blanccoFiles: [] } }), models);
  const erasure = r.warnings.filter(w => /Blancco erasure/.test(w.text)).map(w => [w.item, w.level]);
  assert.deepEqual(erasure, [['GG01', 'info'], ['GG02', 'warn']]);
});

test('item numbering: gaps and codes that do not fit', () => {
  const r = buildReport(project({ manual: { GG03: { diagnostics: 'ok' }, GG06: { diagnostics: 'ok' }, X9: { diagnostics: 'ok' } } }), models);
  assert.deepEqual(r.rows.map(x => x.itemLookup), ['GG03', 'GG06', 'X9']);
  assert.ok(texts(r).includes('No data yet for: GG04–GG05'));
  assert.ok(r.warnings.some(w => w.item === 'X9' && /doesn't follow/.test(w.text)));
});

test('a disk that succeeded on a retry ("Successful / Failed") is listed', () => {
  const head = ['Device Identifier', 'System serial', 'Erasure state', 'System chassis type', 'Disk capacity', 'Disk interface type', 'Comment'];
  const r = buildReport(project({ inputs: { mac: '', windows: '', blanccoFiles: [
    { name: 'a.csv', table: [head, ['BM41', 'DJSR593', 'Successful / Failed', 'Desktop', '512.1 GB', 'NVMe', 'ok'], ['BM42', 'X2', 'Failed', 'Desktop', '256 GB', 'SATA', 'ok']] },
  ] } }), models);
  assert.deepEqual(r.rows.map(x => [x.itemLookup, x.disk, x.blancco]), [['BM41', '512 GB NVMe', 'Pass'], ['BM42', '', 'Fail']]);
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
