import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTsv, mergeWithSheet } from '../src/ui/merge.js';

const cols = [['item', 'ITEM'], ['sn', 'S.N.'], ['type', 'Type']];
const row = (n, sn) => ({ itemLookup: `BM${String(n).padStart(2, '0')}`, item: `ITD-SHR1-BM${String(n).padStart(2, '0')}`, sn, type: 'Laptop' });

test('Google Sheets copies with quoted cells are read as-is', () => {
  assert.deepEqual(parseTsv('a\t"x\ty"\t"say ""hi"""\r\n"two\nlines"\t\tc\n'), [['a', 'x\ty', 'say "hi"'], ['two\nlines', '', 'c']]);
});

test('rows already in the sheet are kept as they are and the app fills in around them', () => {
  const sheetText = 'ITD-SHR1-BM02\tSHEET-SN\tDesktop\n\n';
  const m = mergeWithSheet({ sheetText, cols, rows: [row(1, 'A'), row(2, 'B'), row(3, 'C')], prefix: 'BM' });
  assert.deepEqual(m.table, [
    ['ITD-SHR1-BM01', 'A', 'Laptop'],
    ['ITD-SHR1-BM02', 'SHEET-SN', 'Desktop'],
    ['ITD-SHR1-BM03', 'C', 'Laptop'],
  ]);
  assert.deepEqual(m.kept, ['BM02']);
  assert.deepEqual(m.added, ['BM01', 'BM03']);
  assert.deepEqual(m.order.map(r => [r.from, r.first, r.last]), [['app', 'BM01', 'BM01'], ['sheet', 'BM02', 'BM02'], ['app', 'BM03', 'BM03']]);
});

test('headers stay on top, rows without a code go last, sort is numeric, widths are padded', () => {
  const sheetText = 'ITEM\tS.N.\tType\nITD-SHR1-BM10\tX\tDesktop\tnote\nsomething else\nITD-SHR1-BM09\tY\t';
  const m = mergeWithSheet({ sheetText, cols, rows: [row(1, 'A'), row(11, 'K')], prefix: 'bm' });
  assert.deepEqual(m.table.map(r => r[0]), ['ITEM', 'ITD-SHR1-BM01', 'ITD-SHR1-BM09', 'ITD-SHR1-BM10', 'ITD-SHR1-BM11', 'something else']);
  assert.ok(m.table.every(r => r.length === 4));
  assert.equal(m.topRows, 1);
  assert.equal(m.otherRows, 1);
  assert.equal(m.sheetWidth, 4);
});

test('the item code is found in another column when ITEM is not copied', () => {
  const m = mergeWithSheet({ sheetText: 'SN1\tBM05\n', cols: [['sn', 'S.N.']], rows: [{ itemLookup: 'BM05', sn: 'Z' }], prefix: 'BM' });
  assert.deepEqual(m.sheetCodes, ['BM05']);
  assert.deepEqual(m.table, [['SN1', 'BM05']]);
});

test('without a prefix, numbers are only taken as item codes from the ITEM column', () => {
  const rows = [{ itemLookup: '01', item: 'ITD-SHR1-01', sn: 'A' }, { itemLookup: '2', item: 'ITD-SHR1-2', sn: 'B' }];
  const m = mergeWithSheet({ sheetText: 'ITD-SHR1-02\tSHEET\n', cols: [['item', 'ITEM'], ['sn', 'S.N.']], rows, prefix: '' });
  assert.deepEqual(m.table, [['ITD-SHR1-01', 'A'], ['ITD-SHR1-02', 'SHEET']]);
  assert.deepEqual(m.kept, ['2']);
  const noItemCol = mergeWithSheet({ sheetText: '2020\t7\n', cols: [['sn', 'S.N.'], ['year', 'Year']], rows: [], prefix: '' });
  assert.deepEqual(noItemCol.sheetCodes, []);
});
