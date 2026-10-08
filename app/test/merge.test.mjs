import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTsv, mergeWithSheet } from '../src/ui/merge.js';

const cols = [['item', 'ITEM'], ['sn', 'S.N.'], ['type', 'Type']];
const row = (n, sn) => ({ itemLookup: `BM${String(n).padStart(2, '0')}`, item: `ITD-SHR1-BM${String(n).padStart(2, '0')}`, sn, type: 'Laptop' });
const items = m => m.rows.map(r => [r.item, r.sn, r._sheet ? 'sheet' : 'app']);

test('Google Sheets copies with quoted cells are read as-is', () => {
  assert.deepEqual(parseTsv('a\t"x\ty"\t"say ""hi"""\r\n"two\nlines"\t\tc\n'), [['a', 'x\ty', 'say "hi"'], ['two\nlines', '', 'c']]);
});

test('rows already in the sheet take the place of the app rows for the same item', () => {
  const m = mergeWithSheet({ sheetText: 'ITD-SHR1-BM02\tSHEET-SN\tDesktop\n\n', cols, rows: [row(1, 'A'), row(2, 'B'), row(3, 'C')], prefix: 'BM' });
  assert.deepEqual(items(m), [['ITD-SHR1-BM01', 'A', 'app'], ['ITD-SHR1-BM02', 'SHEET-SN', 'sheet'], ['ITD-SHR1-BM03', 'C', 'app']]);
  assert.equal(m.rows[1].type, 'Desktop');
  assert.deepEqual(m.skipped, ['BM02']);
  assert.deepEqual(m.sheetCodes, ['BM02']);
});

test('headers are left out, rows without a code go last, sort is numeric', () => {
  const sheetText = 'ITEM\tS.N.\tType\nITD-SHR1-BM10\tX\tDesktop\tnote\nsomething else\nITD-SHR1-BM09\tY\t';
  const m = mergeWithSheet({ sheetText, cols, rows: [row(1, 'A'), row(11, 'K')], prefix: 'bm' });
  assert.deepEqual(m.rows.map(r => r.item), ['ITD-SHR1-BM01', 'ITD-SHR1-BM09', 'ITD-SHR1-BM10', 'ITD-SHR1-BM11', 'something else']);
  assert.equal(m.headerRows, 1);
  assert.equal(m.otherRows, 1);
  assert.equal(new Set(m.rows.map(r => r.itemLookup)).size, 5); // every row can be ticked on its own
});

test('the item code is found in another column when ITEM is not exported', () => {
  const m = mergeWithSheet({ sheetText: 'SN1\tBM05\n', cols: [['sn', 'S.N.'], ['asset', 'Asset']], rows: [{ itemLookup: 'BM05', sn: 'Z' }], prefix: 'BM' });
  assert.deepEqual(m.sheetCodes, ['BM05']);
  assert.deepEqual(m.rows.map(r => [r.sn, r.asset]), [['SN1', 'BM05']]);
});

test('without a prefix, numbers are only taken as item codes from the ITEM column', () => {
  const rows = [{ itemLookup: '01', item: 'ITD-SHR1-01', sn: 'A' }, { itemLookup: '2', item: 'ITD-SHR1-2', sn: 'B' }];
  const m = mergeWithSheet({ sheetText: 'ITD-SHR1-02\tSHEET\n', cols: [['item', 'ITEM'], ['sn', 'S.N.']], rows, prefix: '' });
  assert.deepEqual(m.rows.map(r => [r.item, r.sn]), [['ITD-SHR1-01', 'A'], ['ITD-SHR1-02', 'SHEET']]);
  assert.deepEqual(m.skipped, ['2']);
  const noItemCol = mergeWithSheet({ sheetText: '2020\t7\n', cols: [['sn', 'S.N.'], ['year', 'Year']], rows: [], prefix: '' });
  assert.deepEqual(noItemCol.sheetCodes, []);
});
