// DevMode rules (config.json): the defaults change nothing, and each changed rule shows up in the report
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildReport, exportColumns, lockedColumns, isNoAssetTag } from '../src/engine/report.js';
import { DEFAULT_CONFIG, withDefaults, validateConfig, rulesOf } from '../src/engine/config.js';
import models from '../src/data/default-models.json' with { type: 'json' };

const project = (extra = {}) => ({
  settings: { projectNumber: 'SHR1', prefix: 'GG', endClient: 'X' },
  inputs: { reports: '', blanccoFiles: [] }, manual: {}, overrides: {}, ...extra,
});
const header = ['Business name', 'System manufacturer', 'System chassis type', 'Device Identifier', 'Asset Tag', 'Erasure state', 'System serial',
  'System version', 'System model', 'Capacity', 'Comment', 'Comment', 'Comment', 'Comment', 'Comment', 'Comment', 'Comment', 'Comment',
  'CPU model', 'Total memory', 'Memory type', 'Disk capacity', 'Disk interface type', 'Disk serial'];
const blanccoRow = (item, serial, extra = {}) => {
  const r = Object.fromEntries(header.map(h => [h, '']));
  Object.assign(r, { 'System manufacturer': 'Dell Inc.', 'System chassis type': 'Notebook', 'Device Identifier': item, 'Erasure state': 'Successful',
    'System serial': serial, 'System model': 'Latitude 5421', Capacity: '60', 'CPU model': 'Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz',
    'Total memory': '16 GiB', 'Memory type': 'DDR4', 'Disk capacity': '512.1 GB', 'Disk interface type': 'NVMe' }, extra);
  return header.map(h => r[h]);
};
const withBlancco = (rows, extra = {}) => project({ inputs: { reports: '', blanccoFiles: [{ name: 'b.csv', table: [header, ...rows] }] }, ...extra });
const cfg = change => { const c = withDefaults(structuredClone(DEFAULT_CONFIG)); change(c); return c; };

test('the built-in rules give the same report as no rules at all', () => {
  const p = withBlancco([blanccoRow('GG01', 'S1', { Comment: 'CD B', 'Asset Tag': '4001' }), blanccoRow('GG02', 'S2', { 'Asset Tag': '4001' })]);
  assert.deepEqual(buildReport(p, models, DEFAULT_CONFIG), buildReport(p, models));
  assert.deepEqual(buildReport(p, models, {}), buildReport(p, models));
});

test('withDefaults fills in a partial or broken config file', () => {
  const c = withDefaults({ battery: 'nonsense', texts: { noDisk: 'none' }, checks: { diagnosticsEmpty: 'off', erasureFailed: 'bogus' },
    reportColumns: [{ key: 'sn', label: 'Serial' }, { key: 'nope', label: 'x' }, { key: 'sn', label: 'again' }] });
  assert.deepEqual(c.battery, DEFAULT_CONFIG.battery);
  assert.equal(c.texts.noDisk, 'none');
  assert.equal(c.texts.itemPrefix, 'ITD');
  assert.equal(c.checks.diagnosticsEmpty, 'off');
  assert.equal(c.checks.erasureFailed, 'error');
  assert.deepEqual(c.reportColumns[0], { key: 'sn', label: 'Serial' });
  assert.equal(c.reportColumns.length, DEFAULT_CONFIG.reportColumns.length); // unknown dropped, missing added at the end
  assert.ok(!('history' in rulesOf(c)) && !('passwordHash' in rulesOf(c)));
});

test('battery grades, Blancco messages and typed comment columns', () => {
  const p = withBlancco([blanccoRow('GG01', 'S1', { Capacity: '72' }), blanccoRow('GG02', 'S2', { Comment: 'DI B' })]);
  p.inputs.blanccoFiles[0].table[2][17] = 'Camera: Component is missing or not detected.'; // 8th comment column
  const base = buildReport(p, models).rows;
  assert.equal(base[0].diagnostics, 'Battery C');
  assert.equal(base[1].diagnostics, 'Battery D, Display B');
  const changed = buildReport(p, models, cfg(c => {
    c.battery = [{ op: '<', value: 75, label: 'Battery weak' }];
    c.blanccoMessages.push({ match: 'component is missing', text: 'Webcam defect' });
  })).rows;
  assert.equal(changed[0].diagnostics, 'Battery weak');
  assert.equal(changed[1].diagnostics, 'Battery weak, Display B, Webcam defect');
  // an empty report text drops the message, even when it's in a typed comment column
  const p2 = withBlancco([blanccoRow('GG01', 'S1', { Capacity: '90', Comment: 'Could not connect to the configured network.' })]);
  assert.equal(buildReport(p2, models).rows[0].diagnostics, 'WiFi defect');
  assert.equal(buildReport(p2, models, cfg(c => { c.blanccoMessages[0].text = ''; })).rows[0].diagnostics, '');
  // with 0 typed columns, comments are only searched for messages
  assert.equal(buildReport(withBlancco([blanccoRow('GG01', 'S1', { Capacity: '90', Comment: 'DI B' })]), models, cfg(c => { c.typedCommentColumns = 0; })).rows[0].diagnostics, '');
});

test('a Blancco model in the Models list gets its name, screen and year; others stay as Blancco has them', () => {
  const rows = buildReport(withBlancco([
    blanccoRow('GG01', 'S1', { 'System manufacturer': 'Apple Inc.', 'System model': 'macbookpro16,4' }),
    blanccoRow('GG02', 'S2', { 'System model': 'Latitude 5420' }),
  ]), models).rows;
  assert.deepEqual(rows.map(r => [r.model, r.screen, r.year]), [['Pro A2141', 16, 2019], ['Latitude 5420', '', '']]);
});

test('erasure words and texts, destruction method, disk types, model from System version', () => {
  const p = withBlancco([blanccoRow('GG01', 'S1', { 'Erasure state': 'Completed', 'System manufacturer': 'HP', 'System version': 'EliteBook X' })]);
  assert.equal(buildReport(p, models).rows[0].blancco, '');
  const r = buildReport(p, models, cfg(c => {
    c.erasure.passWords = ['completed']; c.erasure.passText = 'Wiped'; c.erasure.destruction = 'NIST 800-88 Purge';
    c.diskKinds = [{ match: 'nvme', name: 'M.2 SSD' }];
    c.modelFromVersion = ['hp'];
  })).rows[0];
  assert.deepEqual([r.blancco, r.destruction, r.disk, r.model], ['Wiped', 'NIST 800-88 Purge', '512 GB M.2 SSD', 'EliteBook X']);
});

test('texts: item prefix, no-disk text and Mac lock texts', () => {
  const mac = 'GG02*MACSN*1*Laptop*Apple*MacBookPro18,3*M1*16 GB LPDDR5*NONE*Normal*Enabled***90*x*t*ok';
  const p = project({ inputs: { reports: mac, blanccoFiles: [] } });
  const r = buildReport(p, models, cfg(c => { c.texts.itemPrefix = 'AUD'; c.texts.noDisk = 'No disk'; c.texts.appleIdLock = 'iCloud lock'; }));
  assert.deepEqual([r.rows[0].item, r.rows[0].disk, r.rows[0].locked], ['AUD-SHR1-GG02', 'No disk', 'iCloud lock']);
  assert.equal(r.lockedFaulty[0].issue, 'iCloud lock');
});

test('Mac remote lock: "Remote Lock", "Remote Locked" and any case count', () => {
  const locked = v => buildReport(project({ inputs: { reports: `GG01*MACSN**Laptop*Apple*MacBookPro18,2*M1 Max*32 GB LPDDR5*1 TB SSD*Normal***${v}*90*x*t*ok`, blanccoFiles: [] } }), models).rows[0].locked;
  for (const v of ['Remote Lock', 'Remote Locked', 'remote locked', ' REMOTE LOCK ']) assert.equal(locked(v), 'Remote Locked', v);
  for (const v of ['', 'None', 'Not locked']) assert.equal(locked(v), '', v);
});

test('checks can change level or be turned off', () => {
  const p = project({ manual: { GG01: { sn: 'A' }, GG03: { sn: 'B', diagnostics: 'ok' } } });
  const levels = r => r.warnings.map(w => [w.text.replace(/:.*/, ''), w.level]);
  assert.deepEqual(levels(buildReport(p, models)), [['No data yet for', 'warn'], ['GG01', 'warn']]);
  const r = buildReport(p, models, cfg(c => { c.checks.diagnosticsEmpty = 'error'; c.checks.numberingGaps = 'off'; }));
  assert.deepEqual(levels(r), [['GG01', 'error']]);
});

test('asset tags meaning "no tag"', () => {
  for (const v of ['', '-', '---', 'N/A', 'n/a', 'NA', 'na', 'N.A.', 'none', ' None ']) assert.ok(isNoAssetTag(v), v);
  for (const v of ['4004012', 'NAS1', 'n/a2', 'x']) assert.ok(!isNoAssetTag(v), v);
  assert.ok(isNoAssetTag('missing', ['missing']));
  assert.ok(!isNoAssetTag('-', ['N/A']));
});

test('report and Locked and Faulty columns: order and headers', () => {
  const c = cfg(x => { x.reportColumns.reverse(); x.reportColumns[0].label = 'Problem'; x.lockedColumns[0].label = 'Serial'; });
  const cols = exportColumns(c);
  assert.deepEqual(cols[0], ['locked', 'Problem']);
  assert.deepEqual(cols.at(-1), ['item', 'ITEM']);
  assert.deepEqual(lockedColumns(c)[0], ['sn', 'Serial']);
});

test('validation finds rules that would not work', () => {
  assert.deepEqual(validateConfig(withDefaults(DEFAULT_CONFIG)), []);
  const bad = cfg(c => { c.battery[0].value = 'abc'; c.erasure.passText = ' '; c.blanccoColumns.serial = ''; c.reportColumns[2].label = ''; });
  assert.equal(validateConfig(bad).length, 4);
  // a missing value counts as empty, the same for every field
  const missing = { ...withDefaults(DEFAULT_CONFIG) };
  missing.erasure = { ...missing.erasure, passText: null, failText: undefined, passWords: [null] };
  assert.equal(validateConfig(missing).length, 3);
});

test('a built-in DevMode password is set (only its hash is in the code)', () => {
  assert.match(DEFAULT_CONFIG.passwordHash, /^[0-9a-f]{64}$/);
  assert.notEqual(DEFAULT_CONFIG.passwordHash, createHash('sha256').update('audit-builder:').digest('hex'));
});
