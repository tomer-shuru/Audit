import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTsv, readSheetRows } from '../src/ui/merge.js';
import { buildReport } from '../src/engine/report.js';
import { buildSims } from '../src/engine/sims.js';
import models from '../src/data/default-models.json' with { type: 'json' };

const cols = [['item', 'ITEM'], ['sn', 'S.N.'], ['type', 'Type']];

test('Google Sheets copies with quoted cells are read as-is', () => {
  assert.deepEqual(parseTsv('a\t"x\ty"\t"say ""hi"""\r\n"two\nlines"\t\tc\n'), [['a', 'x\ty', 'say "hi"'], ['two\nlines', '', 'c']]);
});

test('sheet rows become records per item code; headers, rows without a code and repeats are counted', () => {
  const sheetText = 'ITEM\tS.N.\tType\nITD-SHR1-BM10\tX\tDesktop\tnote\nsomething else\nITD-SHR1-BM09\tY\t\nITD-SHR1-BM10\tZ\tLaptop\n';
  const m = readSheetRows({ sheetText, cols, prefix: 'bm' });
  assert.deepEqual(m.codes, ['BM09', 'BM10']);
  assert.deepEqual(m.records.BM10, { item: 'ITD-SHR1-BM10', sn: 'X', type: 'Desktop' }); // the first row of a code counts
  assert.deepEqual(m.records.BM09, { item: 'ITD-SHR1-BM09', sn: 'Y', type: '' });
  assert.equal(m.headerRows, 1);
  assert.equal(m.otherRows, 1);
  assert.deepEqual(m.duplicates, ['BM10']);
});

test('the item code is found in another column when ITEM is not exported', () => {
  const m = readSheetRows({ sheetText: 'SN1\tBM05\n', cols: [['sn', 'S.N.'], ['asset', 'Asset']], prefix: 'BM' });
  assert.deepEqual(m.codes, ['BM05']);
  assert.deepEqual(m.records.BM05, { sn: 'SN1', asset: 'BM05' });
});

test('without a prefix, numbers are only taken as item codes from the ITEM column', () => {
  const m = readSheetRows({ sheetText: 'ITD-SHR1-02\tSHEET\n', cols: [['item', 'ITEM'], ['sn', 'S.N.']], prefix: '' });
  assert.deepEqual(m.codes, ['2']);
  assert.deepEqual(readSheetRows({ sheetText: '2020\t7\n', cols: [['sn', 'S.N.'], ['year', 'Year']], prefix: '' }).codes, []);
});

// the sheet is the last input: every other input wins where it has a value, the sheet fills in the rest
const project = (extra = {}) => ({
  settings: { projectNumber: 'SHR1', prefix: 'BM', endClient: 'X' },
  inputs: { reports: '', blanccoFiles: [] }, manual: {}, overrides: {}, simsOverrides: {}, ...extra,
});
const blancco = rows => ({ blanccoFiles: [{ name: 'b.csv', table: [
  ['Device Identifier', 'System serial', 'System manufacturer', 'System model', 'Asset Tag', 'Erasure state', 'System chassis type', 'CPU model', 'Comment'],
  ...rows] }] });

test('Blancco wins over the sheet where it has a value; an empty Blancco value keeps the sheet\'s', () => {
  const sheet = { BM01: { sn: 'SHEET-SN', asset: '4004001', model: 'Sheet model', cpu: 'i5-SHEET', diagnostics: 'Chassis damage B', weight: '1.7', comments: 'from sheet' } };
  const p = project({ inputs: blancco([['BM01', 'CSV-SN', 'Dell Inc.', 'Latitude 5420', '', 'Successful', 'Notebook', '', 'LM C']]) });
  const r = buildReport(p, models, undefined, sheet).rows[0];
  assert.equal(r.sn, 'CSV-SN');          // Blancco has it
  assert.equal(r.model, 'Latitude 5420');
  assert.equal(r.asset, '4004001');      // Blancco's is empty: the sheet's stays
  assert.equal(r.cpu, 'i5-SHEET');
  assert.equal(r.diagnostics, 'Label marks C'); // Blancco has diagnostics, so they win
  assert.equal(r.weight, '1.7');         // the sheet's weight comes before the type's usual weight
  assert.equal(r.comments, 'from sheet');
  assert.deepEqual(r._fromSheet.sort(), ['asset', 'comments', 'cpu', 'weight']);
  assert.ok(r._sources.sheet && r._sources.blancco);
});

test('manual entries and Final Report edits win over the sheet; an item only in the sheet is a normal row', () => {
  const sheet = { BM01: { sn: 'SHEET-SN', type: 'Laptop', diagnostics: 'Outdated' }, BM02: { sn: 'ONLY-SHEET', type: 'Desktop SFF', diagnostics: 'Ok' } };
  const p = project({ manual: { BM01: { sn: 'MANUAL-SN' } }, overrides: { BM02: { diagnostics: 'Dead' } } });
  const [a, b] = buildReport(p, models, undefined, sheet).rows;
  assert.equal(a.sn, 'MANUAL-SN');
  assert.equal(a.diagnostics, 'Outdated');
  assert.equal(a.weight, 2); // no weight anywhere: the type's usual one
  assert.equal(b.itemLookup, 'BM02');
  assert.equal(b.sn, 'ONLY-SHEET');
  assert.equal(b.diagnostics, 'Dead');
  assert.ok(b._edited.includes('diagnostics') && !b._fromSheet.includes('diagnostics'));
  assert.ok(b._fromSheet.includes('sn'));
});

test('SIMS: a SIMS column the app has nothing for comes from the SIMS sheet rows', () => {
  const sheet = { BM01: { item: 'ITD-SHR1-BM01', sn: 'S1', category: 'Notebook', modelLine: 'Apple,Pro A1502,13', purchase: 'i5,8 GB,256 GB SSD', diagnostics: 'Bios Locked', codes: 'LPT151,LPT131', grade: 'B', erased: 'Erased' } };
  const p = project({ manual: { BM01: { type: 'Laptop', make: 'Apple', model: 'Pro A2251' } } });
  const report = buildReport(p, models, undefined, sheet);
  const row = buildSims(report, p, models, undefined, sheet).rows[0];
  assert.equal(row.modelLine, 'Apple,Pro A2251');     // the app has it
  assert.equal(row.purchase, 'i5,8 GB,256 GB SSD');   // the app has no CPU / RAM / disk ("n/a"): the sheet's
  assert.equal(row.codes, 'LPT131,LPT151');           // made from the diagnostics (which came from the sheet)
  assert.equal(row.grade, 'B');
  assert.equal(row.erased, 'Erased');
  assert.ok(row._fromSheet.includes('purchase') && row._fromSheet.includes('diagnostics') && !row._fromSheet.includes('modelLine'));
});

test('extra item groups are read from the sheet too (MS-M05, MSP05 with prefix MS)', () => {
  const m = readSheetRows({ sheetText: 'ITD-SHR1-MS-M05\tA\nITD-SHR1-MSP05\tB\nMS07\tC\n', cols: [['item', 'ITEM'], ['sn', 'S.N.']], prefix: 'MS' });
  assert.deepEqual(m.codes, ['MS-M05', 'MS07', 'MSP05']);
  // in other columns only a whole ITEM value or the plain prefix + number counts (not serials like MSFT123)
  const o = readSheetRows({ sheetText: 'MSFT123\tITD-SHR1-MS-M06\nMSFT124\tMS08\n', cols: [['sn', 'S.N.'], ['asset', 'Asset']], prefix: 'MS' });
  assert.deepEqual(o.codes, ['MS-M06', 'MS08']);
});
