// Dumps every sheet of an Audit.xlsm (cached values) to test/fixtures/<name>/*.json
// Usage: node scripts/extract-fixture.mjs <path-to-xlsm> <fixture-name>
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const [, , file, name = 'current'] = process.argv;
if (!file) { console.error('usage: extract-fixture.mjs <xlsm> [name]'); process.exit(1); }

const wb = XLSX.read(fs.readFileSync(file), { cellFormula: false, cellDates: false });
const out = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'test', 'fixtures', name);
fs.mkdirSync(out, { recursive: true });

for (const sheet of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: '', blankrows: false });
  // trim trailing empty cells
  const trimmed = rows.map(r => { let n = r.length; while (n && (r[n - 1] === '' || r[n - 1] == null)) n--; return r.slice(0, n); });
  while (trimmed.length && trimmed[trimmed.length - 1].length === 0) trimmed.pop();
  fs.writeFileSync(path.join(out, sheet.replace(/[^\w]+/g, '_') + '.json'), JSON.stringify(trimmed, null, 0));
  console.log(sheet.padEnd(20), trimmed.length, 'rows');
}
