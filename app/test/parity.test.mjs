// Compares the app's output with the Audit Report / Locked and Faulty sheets saved in each fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, REPORT_COLUMNS, LOCKED_COLUMNS } from '../src/engine/report.js';
import { loadFixture, fixtureNames } from './fixture.js';
import models from '../src/data/default-models.json' with { type: 'json' };

const cell = v => (v == null ? '' : String(v));

for (const name of fixtureNames()) {
  test(`Audit Report matches workbook (${name})`, () => {
    const { project, expected } = loadFixture(name);
    const { rows } = buildReport(project, models);
    const diffs = [];
    const got = new Map(rows.map(r => [r.itemLookup, r]));
    for (const exp of expected) {
      const row = got.get(exp[0]);
      if (!row) { diffs.push(`${exp[0]}: missing from app output`); continue; }
      REPORT_COLUMNS.forEach(([key, label], j) => {
        if (cell(row[key]) !== cell(exp[j])) diffs.push(`${exp[0]} ${label}: app=${JSON.stringify(cell(row[key]))} excel=${JSON.stringify(cell(exp[j]))}`);
      });
    }
    const extra = rows.filter(r => !expected.some(e => e[0] === r.itemLookup)).map(r => r.itemLookup);
    if (extra.length) diffs.push(`extra rows in app: ${extra.join(', ')}`);
    assert.deepEqual(diffs, []);
  });

  test(`Locked and Faulty matches workbook (${name})`, () => {
    const { project, expectedLocked } = loadFixture(name);
    const { lockedFaulty } = buildReport(project, models);
    assert.deepEqual(lockedFaulty.map(r => LOCKED_COLUMNS.map(([k]) => cell(r[k]))), expectedLocked.map(r => r.map(cell)));
  });
}
