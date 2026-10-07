// Loads a fixture extracted from Audit.xlsm (scripts/extract-fixture.mjs) as an app project.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const fixtureNames = () => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

const MY_AUDIT_FIELDS = [null, 'sn', 'asset', 'type', 'make', 'model', 'screen', 'year', 'cpu', 'ram', 'disk',
  'locked', 'diagnostics', 'blancco', 'snDataCarrier', 'noDataCarrier', 'destruction', 'comments', 'itemStatus', 'estValue'];

export function loadFixture(name) {
  const sheet = s => JSON.parse(fs.readFileSync(path.join(dir, name, s + '.json'), 'utf8'));
  const input = sheet('Input');
  const col = j => input.slice(1).map(r => r[j] ?? '');
  const settings = {
    projectNumber: String(input[1]?.[0] ?? ''), prefix: String(input[3]?.[0] ?? ''),
    endClient: String(input[5]?.[0] ?? ''), startNumber: Number(input[7]?.[0] || 1),
  };
  const blancco = input.map(r => r.slice(3, 33).map(v => v ?? ''));
  const manual = {};
  for (const r of sheet('My_Audit').slice(1)) {
    const rec = {};
    MY_AUDIT_FIELDS.forEach((f, j) => { if (f && r[j] !== '' && r[j] != null) rec[f] = r[j]; });
    if (Object.keys(rec).length) manual[r[0]] = rec;
  }
  const project = {
    settings,
    inputs: { mac: col(1).join('\n'), windows: col(2).join('\n'), blancco },
    manual,
  };
  const has = v => v !== '' && v != null;
  const expected = sheet('Audit_Report').slice(1).filter(r => r.slice(2, 23).some(has)).map(r => r.slice(0, 23));
  const expectedLocked = sheet('Locked_and_Faulty').slice(1).filter(r => r.slice(0, 6).some(has)).map(r => r.slice(0, 6));
  return { project, expected, expectedLocked };
}
