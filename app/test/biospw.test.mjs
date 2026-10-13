import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBiosPasswords, matchBiosPasswords } from '../src/engine/biospw.js';

// same layout as Microsoft's BulkBiosPasswordDetails file, made-up values
const FILE = `AssetNo;Password

11111111;aaaa1111bbbb
11111111;12345678987654321
22222222;cccc2222dddd
22222222;eeee3333ffff
22222222;12345678987654321
33333333;****************
0444;gggg4444
44444444;
not a password line
`;

test('reads the password file: several passwords per asset tag, in file order', () => {
  const p = parseBiosPasswords(FILE);
  assert.deepEqual(p.assets.map(a => [a.asset, a.passwords]), [
    ['11111111', ['aaaa1111bbbb', '12345678987654321']],
    ['22222222', ['cccc2222dddd', 'eeee3333ffff', '12345678987654321']],
    ['33333333', ['****************']],
    ['0444', ['gggg4444']],
  ]);
  assert.equal(p.count, 7);
  assert.equal(p.skipped, 2); // the asset with no password and the line that isn't asset;password
  assert.deepEqual(parseBiosPasswords('11111111,abc\r\n22222222\tdef').assets.map(a => a.passwords[0]), ['abc', 'def']);
});

test('finds the item for each asset tag; items first by item number, then assets not in the project', () => {
  const rows = [
    { itemLookup: 'GG07', item: 'ITD-X-GG07', sn: 'S7', asset: '22222222', make: 'Microsoft', model: 'Surface Laptop 4', diagnostics: 'BIOS locked' },
    { itemLookup: 'GG02', item: 'ITD-X-GG02', sn: 'S2', asset: ' 444', modelLine: 'Lenovo,P14S Gen 1', locked: 'BIOS locked' },
    { itemLookup: 'GG03', item: 'ITD-X-GG03', sn: 'S3', asset: '99999999', locked: 'BIOS locked' },
    { itemLookup: 'GG04', item: 'ITD-X-GG04', sn: 'S4', asset: '', diagnostics: 'Outdated' },
  ];
  const m = matchBiosPasswords(parseBiosPasswords(FILE), rows, r => Number(r.itemLookup.slice(2)));
  assert.deepEqual(m.rows.map(r => [r.item, r.asset, r.device]), [
    ['ITD-X-GG02', '0444', 'Lenovo,P14S Gen 1'],
    ['ITD-X-GG07', '22222222', 'Microsoft Surface Laptop 4'],
    ['', '11111111', ''],
    ['', '33333333', ''],
  ]);
  assert.equal(m.matched, 2);
  assert.deepEqual(m.rows[1].passwords, ['cccc2222dddd', 'eeee3333ffff', '12345678987654321']);
  // BIOS locked in the project, but the file has no password for it
  assert.deepEqual(m.lockedWithout.map(r => r.itemLookup), ['GG03']);
});
