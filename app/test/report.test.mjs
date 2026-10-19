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
      GG06: { asset: 'N/A', diagnostics: 'ok' }, GG07: { asset: 'n/a', diagnostics: 'ok' },
      GG08: { asset: 'NA', diagnostics: 'ok' }, GG09: { asset: 'na', diagnostics: 'ok' }, GG10: { asset: '--', diagnostics: 'ok' },
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
  const gaps = r.warnings.find(w => w.text.startsWith('No data yet'));
  assert.deepEqual([gaps.level, gaps.text], ['warn', 'No data yet for: GG01–GG02, GG04–GG05']); // counted from 01
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

test('item codes that are just numbers (empty prefix), with or without leading zeros', () => {
  const p = project({
    settings: { projectNumber: 'SHR1', prefix: '', endClient: 'X' },
    inputs: { mac: '', windows: '7*SER7*-*Notebook*Dell Inc.*Latitude 5431', blanccoFiles: [] },
    manual: { '07': { diagnostics: 'ok' }, 10: { sn: 'B', diagnostics: 'ok' }, 2: { sn: 'A', diagnostics: 'ok' } },
  });
  const r = buildReport(p, models);
  assert.deepEqual(r.rows.map(x => x.item), ['ITD-SHR1-2', 'ITD-SHR1-07', 'ITD-SHR1-10']);
  assert.equal(r.rows[1].sn, 'SER7');   // manual 07 and Windows 7 are the same item
  assert.ok(!texts(r).some(t => t.includes("doesn't follow")));
  assert.ok(texts(r).includes('No data yet for: 01, 03–06, 08–09'));
});

test('diagnostic codes typed in the Review table are expanded too', () => {
  const r = buildReport(project({ manual: { GG01: { sn: 'A1' } }, overrides: { GG01: { diagnostics: 'CD B, LM b, kb sticky', locked: 'AID' } } }), models);
  assert.equal(r.rows[0].diagnostics, 'Chassis damage B, Label marks B, Kb sticky');
  assert.equal(r.rows[0].locked, 'Apple ID');
  assert.deepEqual(r.rows[0]._edited.sort(), ['diagnostics', 'locked']);
});

test('make names from the Make names list', () => {
  const blancco = [['System manufacturer', 'System serial', 'Device Identifier'], ['DELL INC.', 'S1', 'GG01'], ['LENOVO', 'S2', 'GG02']];
  const r = buildReport(project({
    inputs: { mac: '', windows: 'GG03*W3*-*Notebook*dell inc.*Latitude 5431', blanccoFiles: [{ name: 'b', table: blancco }] },
    manual: { GG04: { make: 'Dell Inc.' } },
  }), models);
  assert.deepEqual(r.rows.map(x => x.make), ['Dell', 'Lenovo', 'Dell', 'Dell']);
  assert.equal(buildReport(project({ manual: { GG01: { make: 'Dell Inc.' } } }), { ...models, makeMap: [] }).rows[0].make, 'Dell Inc.');
});

test('Mac and Windows report lines pasted together are told apart by their fields', () => {
  const mac = 'GG01*C02X*-*Laptop*Apple*MacBookPro18,3*M1 Pro*16 GB*512 GB*Normal*Disabled*Disabled*No*90*D1*2026*ok';
  const win = 'GG02*W2*-*Notebook*Dell Inc.*Latitude 5431*i5*16*256*80*ok';
  const r = buildReport(project({ inputs: { reports: `${mac}\n\n${win}\nGG03*broken*line`, blanccoFiles: [] } }), models);
  assert.deepEqual(r.rows.map(x => [x.itemLookup, x._sources.mac, x._sources.win]), [['GG01', true, false], ['GG02', false, true]]);
  assert.deepEqual(r.counts.mac + r.counts.win, 2);
  const bad = r.warnings.filter(w => w.text.startsWith('Device reports'));
  assert.equal(bad.length, 1);
  assert.match(bad[0].text, /line 4: has 3 fields/);
  assert.equal(bad[0].level, 'error');
});

test('first item number from project setup, and a safety net when it is far below the items', () => {
  const with4000 = buildReport(project({ settings: { projectNumber: 'SHR1', prefix: 'GG', endClient: 'X', startNumber: 4000 }, manual: { GG4001: { diagnostics: 'ok' }, GG4003: { diagnostics: 'ok' }, GG12: { diagnostics: 'ok' } } }), models);
  assert.ok(texts(with4000).includes('No data yet for: GG4000, GG4002'));
  assert.ok(texts(with4000).includes('GG12: below the first item number (GG4000)'));
  const forgotten = buildReport(project({ manual: { GG4000: { diagnostics: 'ok' }, GG4002: { diagnostics: 'ok' } } }), models);
  assert.ok(texts(forgotten).includes('No data yet for: GG4001'));
  assert.ok(texts(forgotten).some(t => t.startsWith('The items start at GG4000 but the first item number in project setup is 1')));
});

test('extra item groups: codes that start with the prefix and more letters, each numbered from 1', () => {
  const r = buildReport(project({
    settings: { projectNumber: 'SHR1', prefix: 'MS', endClient: 'X', startNumber: 4000 },
    manual: Object.fromEntries(['MS4001', 'MS-M01', 'MS-M03', 'MSP02', 'MS4000', 'XX01'].map(c => [c, { diagnostics: 'ok' }])),
  }), models);
  assert.deepEqual(r.rows.map(x => x.itemLookup), ['MS4000', 'MS4001', 'MS-M01', 'MS-M03', 'MSP02', 'XX01']);
  assert.equal(r.rows[2].item, 'ITD-SHR1-MS-M01');
  const t = texts(r);
  assert.ok(t.includes('Item groups: MS (2), MS-M (2), MSP (1)'));
  assert.equal(r.warnings.find(w => w.text.startsWith('Item groups')).level, 'info');
  assert.ok(t.includes('No data yet for: MS-M02'));
  assert.ok(t.includes('No data yet for: MSP01'));
  assert.ok(t.some(x => x.startsWith("XX01: item code doesn't follow")));
  assert.ok(!t.some(x => x.includes('MS-M01: ') || x.includes('below the first')));
  // one group only: no note
  assert.ok(!texts(buildReport(project({ manual: { GG01: { diagnostics: 'ok' } } }), models)).some(x => x.startsWith('Item groups')));
});

test('an item number far above the others (a typo?) is flagged and gets no empty rows up to it', () => {
  const r = buildReport(project({ manual: Object.fromEntries(['GG01', 'GG03', 'GG9999', 'GG150'].map(c => [c, { diagnostics: 'ok' }])) }), models);
  const t = texts(r);
  assert.ok(t.includes('GG9999: far above the other items (the last one before it is GG150). Is the item number a typo?'));
  assert.equal(r.warnings.find(w => w.text.startsWith('GG9999')).level, 'error');
  assert.ok(t.includes('No data yet for: GG02, GG04–GG149'));
  // a gap of up to 200 is still filled
  assert.ok(!texts(buildReport(project({ manual: { GG01: { diagnostics: 'ok' }, GG201: { diagnostics: 'ok' } } }), models)).some(x => x.includes('far above')));
});
