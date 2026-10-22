import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetLink, findItems, planSend, sheetRowsText } from '../src/engine/gsheet.js';

const settings = { prefix: 'GG', projectNumber: 'SHR1' };
const cols = [['item', 'ITEM'], ['sn', 'S.N.'], ['asset', 'Asset'], ['weight', 'Weight']];
const row = (code, sn, asset, weight) => ({ itemLookup: code, item: `ITD-SHR1-${code}`, sn, asset, weight });
// a sheet like theirs: a title, the header, items with a gap (GG03 missing), a price column after ours
const sheet = () => [
  ['Audit report', '', '', '', ''],
  ['ITEM', 'S.N.', 'Asset', 'Weight', 'Price'],
  ['ITD-SHR1-GG01', 'A1', '', '1.60', '$2'],
  ['ITD-SHR1-GG02', 'B2', 'TAG2', '', ''],
  ['ITD-SHR1-GG04', '', '', '', ''],
];

test('a Google Sheets link: the sheet and its tab', () => {
  assert.deepEqual(sheetLink('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=123'), { id: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', gid: '123' });
  assert.deepEqual(sheetLink('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit'), { id: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', gid: '' });
  assert.equal(sheetLink('https://example.com/x'), null);
});

test('finds the item column and rows, also with GG7 for GG07', () => {
  const f = findItems(sheet(), { prefix: 'GG', itemPrefix: 'ITD', itemLabel: 'ITEM' });
  assert.equal(f.itemCol, 0);
  assert.equal(f.headerRow, 1);
  assert.deepEqual([...f.items], [['GG1', 2], ['GG2', 3], ['GG4', 4]]);
  // a sheet with only the header: found by the header
  assert.deepEqual(findItems([['x'], ['', 'ITEM']], { prefix: 'GG', itemPrefix: 'ITD', itemLabel: 'ITEM' }).itemCol, 1);
  assert.equal(findItems([['nothing']], { prefix: 'GG', itemPrefix: 'ITD', itemLabel: 'ITEM' }), null);
});

test('send: fills empty cells, finds collisions, skips our empty cells and equal values, new items go in order', () => {
  const p = planSend({ values: sheet(), cols, settings, itemPrefix: 'ITD', rows: [
    row('GG01', 'A1', 'TAG1', '1.6'),     // asset empty there: filled; weight 1.6 = 1.60
    row('GG02', 'B2-NEW', '', '2'),      // S.N. differs: collision; our empty asset leaves TAG2
    row('GG03', 'C3', '', '1'),          // not in the sheet: inserted after GG02
    { itemLookup: 'GG05', _empty: true }, // an empty row of ours: not sent
    row('GG06', 'F6', '', ''),           // after GG04
  ] });
  assert.deepEqual(p.fills.map(x => [x.row, x.c, x.value]), [[2, 2, 'TAG1'], [3, 3, '2']]);
  assert.deepEqual(p.collisions.map(x => [x.item, x.label, x.theirs, x.ours]), [['GG02', 'S.N.', 'B2', 'B2-NEW']]);
  assert.equal(p.same, 4); // GG01 item, S.N., weight; GG02 item
  assert.deepEqual(p.newItems.map(n => [n.item, n.row, n.where]), [['GG03', 3, 'after'], ['GG06', 4, 'after']]);
  assert.deepEqual(p.headers, []);

  const skip = p.request(false);
  assert.deepEqual(skip.updates, [{ row: 3, col: 3, values: ['TAG1'] }, { row: 4, col: 4, values: ['2'] }]);
  assert.deepEqual(skip.inserts, [
    { row: 4, where: 'after', col: 1, rows: [['ITD-SHR1-GG03', 'C3', '', '1']] },
    { row: 5, where: 'after', col: 1, rows: [['ITD-SHR1-GG06', 'F6', '', '']] },
  ]);
  // the item cells of the rows touched, and every cell written, as they were read
  assert.deepEqual(skip.expect.map(e => [e.row, e.col, e.value]), [
    [3, 1, 'ITD-SHR1-GG01'], [4, 1, 'ITD-SHR1-GG02'], [5, 1, 'ITD-SHR1-GG04'], [3, 3, ''], [4, 4, ''],
  ]);
  // overwriting: the collision joins GG02's update, side by side with the weight, and must still be "B2" when written
  const over = p.request(true);
  assert.deepEqual(over.updates, [{ row: 3, col: 3, values: ['TAG1'] }, { row: 4, col: 2, values: ['B2-NEW'] }, { row: 4, col: 4, values: ['2'] }]);
  assert.ok(over.expect.some(e => e.row === 4 && e.col === 2 && e.value === 'B2'));
});

test('send: items before the sheet\'s first go above it; an empty sheet gets them under the header', () => {
  const values = [['ITEM', 'S.N.', 'Asset', 'Weight'], ['ITD-SHR1-GG05', 'E', '', '']];
  const p = planSend({ values, cols, settings, itemPrefix: 'ITD', rows: [row('GG01', 'A', '', ''), row('GG02', 'B', '', '')] });
  assert.deepEqual(p.request(false).inserts, [{ row: 2, where: 'before', col: 1, rows: [['ITD-SHR1-GG01', 'A', '', ''], ['ITD-SHR1-GG02', 'B', '', '']] }]);
  const empty = planSend({ values: [['ITEM', 'S.N.', 'Asset', 'Weight']], cols, settings, itemPrefix: 'ITD', rows: [row('GG01', 'A', '', '')] });
  assert.deepEqual(empty.request(false).inserts, [{ row: 1, where: 'after', col: 1, rows: [['ITD-SHR1-GG01', 'A', '', '']] }]);
});

test('send: our columns start at the sheet\'s item column (SIMS starts at D); headers that differ are listed', () => {
  const values = [['', '', '', 'ITEM', 'Serial', 'Asset', 'Weight'], ['', '', '', 'ITD-SHR1-GG01', '', '', '']];
  const p = planSend({ values, cols, settings, itemPrefix: 'ITD', rows: [row('GG01', 'S', '', '')] });
  assert.equal(p.firstCol, 3);
  assert.deepEqual(p.request(false).updates, [{ row: 2, col: 5, values: ['S'] }]);
  assert.deepEqual(p.headers, [{ label: 'S.N.', theirs: 'Serial' }]);
  assert.match(planSend({ values, cols: cols.slice(1), settings, itemPrefix: 'ITD', rows: [] }).error, /item column is hidden/);
});

test('load: the sheet\'s item rows in our columns', () => {
  const r = sheetRowsText({ values: sheet(), cols, settings, itemPrefix: 'ITD' });
  assert.equal(r.count, 3);
  assert.equal(r.text.split('\n')[1], 'ITD-SHR1-GG02\tB2\tTAG2\t');
});

test('send: new rows look like the sheet\'s first item row, or its first filled row under the header, never the header', () => {
  assert.equal(planSend({ values: sheet(), cols, settings, itemPrefix: 'ITD', rows: [row('GG03', 'C', '', '')] }).request(false).formatFrom, 3);
  // like Tiktok: the sheet has other codes (M01…) but none of ours, so ours go under the header and look like M01's row
  const values = [['Item', 'S.N.', 'Asset', 'Weight'], ['ITD-SHR1-M01', 'X', '', ''], ['ITD-SHR1-M02', 'Y', '', '']];
  const p = planSend({ values, cols, settings, itemPrefix: 'ITD', rows: [row('GG01', 'A', '', '')] }).request(false);
  assert.deepEqual([p.inserts[0].row, p.inserts[0].where, p.formatFrom], [1, 'after', 2]);
  // only a header: plain new rows
  assert.equal(planSend({ values: [['ITEM', 'S.N.', 'Asset', 'Weight']], cols, settings, itemPrefix: 'ITD', rows: [row('GG01', 'A', '', '')] }).request(false).formatFrom, 0);
});
