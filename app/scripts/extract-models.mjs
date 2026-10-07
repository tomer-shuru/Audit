// Builds src/data/default-models.json from the Models sheet of a fixture
// Usage: node scripts/extract-models.mjs [fixture-name]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] || 'current';
const rows = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', name, 'Models.json'), 'utf8'));
const has = v => v !== '' && v != null;
const body = rows.slice(1);

const models = body.filter(r => has(r[0]))
  .map(r => ({ id: String(r[0]), name: String(r[1] ?? ''), type: r[2] ?? '', year: r[3] ?? '', screen: r[4] ?? '', weight: r[5] ?? '' }));
const typeMap = body.filter(r => has(r[6]) && has(r[7])).map(r => ({ type: String(r[6]), blanccoType: String(r[7]) }));
const typeWeights = body.filter(r => has(r[8])).map(r => ({ type: String(r[8]), weight: has(r[9]) ? r[9] : '' }));
const cleanupRules = body.filter(r => has(r[11])).map(r => String(r[11]));
const diagCodes = rows.slice(2).filter(r => has(r[13]) && has(r[14])).map(r => ({ code: String(r[13]), description: String(r[14]) }));

const out = { models, typeMap, typeWeights, cleanupRules, diagCodes };
fs.writeFileSync(path.join(root, 'src', 'data', 'default-models.json'), JSON.stringify(out, null, 1));
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
