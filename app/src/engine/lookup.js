// Finding a device in a project's report rows by item code / number, serial number (S.N.) or asset tag
// (Tools › Find a device searches every project in the Projects folder with it).
import { str } from './rules.js';
import { itemKey } from './sources.js';

// serials and asset tags are compared without capitals, spaces or dashes
const squash = v => str(v).toLowerCase().replace(/[\s-]+/g, '');
const number = v => str(v).replace(/^0+(?=\d)/, '');
// an item code without the zeros in front of its number: GG07 and GG7 are the same item
const codeKey = v => itemKey(v).replace(/\d+$/, number);
// a part of a serial or asset tag needs this many characters, so "1" doesn't find half of all devices
export const MIN_PART = 3;

// What a search text finds in a report row: 'item', 'sn' or 'asset' (the first that matches), or '' for nothing.
//   an item code: GG07, gg7, ITD-SHR11734-GG07 (the whole ITEM column)
//   a number alone: the item number (7 finds GG07 and MS-M07, not GG17), and serials / asset tags containing it
//   any other text: part of the serial or asset tag
export function deviceMatch(row, query) {
  const q = str(query).trim();
  if (!q) return '';
  const code = itemKey(row.itemLookup);
  if (code && (codeKey(q) === codeKey(code) || codeKey(q) === codeKey(row.item))) return 'item';
  if (/^\d+$/.test(q) && number(code.match(/(\d+)$/)?.[1]) === number(q)) return 'item';
  const part = squash(q);
  if (part.length < MIN_PART) return '';
  return ['sn', 'asset'].find(f => squash(row[f]).includes(part)) || '';
}
