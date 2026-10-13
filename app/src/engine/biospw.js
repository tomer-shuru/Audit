// Tools › Microsoft BIOS passwords: reads the BulkBiosPasswordDetails .txt Microsoft sends
// ("AssetNo;Password", one line per password, an asset tag can have several) and finds the
// project's item for each asset tag.
import { str, joinNonEmpty } from './rules.js';

// "07600013 " = "7600013": spaces, capitals and leading zeros don't matter
const normAsset = s => str(s).trim().toLowerCase().replace(/^0+(?=\d)/, '');

// text -> { assets: [{ asset, passwords }] in file order, count (passwords), skipped (lines that weren't asset;password) }
export function parseBiosPasswords(text) {
  const byAsset = new Map();
  let count = 0, skipped = 0;
  for (const raw of str(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^;,\t]+)[;,\t](.*)$/);
    if (!m || /^asset/i.test(m[1].trim())) { if (!/^asset/i.test(line)) skipped++; continue; }
    const asset = m[1].trim(), password = m[2].trim();
    if (!password) { skipped++; continue; }
    const k = normAsset(asset);
    if (!byAsset.has(k)) byAsset.set(k, { asset, passwords: [] });
    const entry = byAsset.get(k);
    if (!entry.passwords.includes(password)) { entry.passwords.push(password); count++; }
  }
  return { assets: [...byAsset.values()], count, skipped };
}

/**
 * parsed: parseBiosPasswords(); rows: the project's rows (Review rows: { item, itemLookup, sn, asset, make, model
 * or modelLine, diagnostics, locked }); order(row): sort key for a row (item number), null for none.
 * Returns { rows, unmatched, lockedWithout }:
 * rows = one per asset tag in the file, with its project item(s) (first the ones in the project, by item number),
 * lockedWithout = BIOS-locked items in the project with no password in the file.
 */
export function matchBiosPasswords(parsed, rows, order = () => null) {
  const items = new Map();
  for (const r of rows) {
    const k = normAsset(r.asset);
    if (!k) continue;
    if (!items.has(k)) items.set(k, []);
    items.get(k).push(r);
  }
  const device = r => str(r.modelLine) || joinNonEmpty(' ', r.make, r.model);
  const out = parsed.assets.map(({ asset, passwords }, i) => {
    const found = items.get(normAsset(asset)) || [];
    return {
      key: `bios:${i}`, asset, passwords, inProject: found.length > 0,
      item: found.map(r => r.item).join(', '), code: found[0]?.itemLookup ?? '',
      sn: found.map(r => r.sn).filter(Boolean).join(', '), device: [...new Set(found.map(device).filter(Boolean))].join(', '),
      _order: found.length ? order(found[0]) : null, _file: i,
    };
  });
  out.sort((a, b) => (a.inProject !== b.inProject ? (a.inProject ? -1 : 1)
    : a._order !== null && b._order !== null ? a._order - b._order || a._file - b._file
    : a._order !== null ? -1 : b._order !== null ? 1 : a._file - b._file));
  const inFile = new Set(parsed.assets.map(a => normAsset(a.asset)));
  const lockedWithout = rows.filter(r => /bios/i.test(`${str(r.locked)} ${str(r.diagnostics)}`) && !inFile.has(normAsset(r.asset)));
  return { rows: out, matched: out.filter(r => r.inProject).length, lockedWithout };
}
