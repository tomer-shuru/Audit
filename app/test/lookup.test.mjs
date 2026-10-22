import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceMatch } from '../src/engine/lookup.js';

const row = { itemLookup: 'GG07', item: 'ITD-SHR11734-GG07', sn: 'C02X-1234 ABC', asset: 'WIX00417' };

test('finds an item by its code, the whole ITEM text, or its number alone', () => {
  for (const q of ['GG07', 'gg7', ' GG07 ', 'ITD-SHR11734-GG07', '7', '07']) assert.equal(deviceMatch(row, q), 'item', q);
  assert.equal(deviceMatch(row, '17'), '');
  assert.equal(deviceMatch({ ...row, itemLookup: 'MS-M07' }, '7'), 'item');
});

test('finds part of a serial or asset tag, without capitals, spaces or dashes', () => {
  assert.equal(deviceMatch(row, 'c02x1234'), 'sn');
  assert.equal(deviceMatch(row, '234 a'), 'sn');
  assert.equal(deviceMatch(row, '0417'), 'asset');
  assert.equal(deviceMatch(row, 'wix'), 'asset');
});

test('a too short or empty search finds nothing', () => {
  assert.equal(deviceMatch(row, ''), '');
  assert.equal(deviceMatch(row, 'ab'), '');
  assert.equal(deviceMatch({ itemLookup: '', sn: '', asset: '' }, 'abc'), '');
});
