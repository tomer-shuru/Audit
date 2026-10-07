import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { parsePastedTable, downloadXlsx, reportTsv } from '../src/ui/io.js';
import { buildReport } from '../src/engine/report.js';
import { loadFixture, fixtureNames } from './fixture.js';
import models from '../src/data/default-models.json' with { type: 'json' };

XLSX.set_fs(fs); // the ESM build needs fs injected to write files under Node

test('pasted Blancco rows keep serials and text as-is', () => {
  const t = parsePastedTable('System serial\tDisk serial\tCapacity\tErasure state\n0012345\t212730498071\t51\tSuccessful\n');
  assert.deepEqual(t, [['System serial', 'Disk serial', 'Capacity', 'Erasure state'], ['0012345', '212730498071', '51', 'Successful']]);
  const c = parsePastedTable('System serial,Comment\nABC,"CD B, DI C"\n');
  assert.deepEqual(c[1], ['ABC', 'CD B, DI C']);
});

test('xlsx export has Audit Report and Locked and Faulty sheets', { skip: !fixtureNames().length }, () => {
  const { project } = loadFixture(fixtureNames()[0]);
  const report = buildReport(project, models);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try { downloadXlsx(report, project.settings); } finally { process.chdir(cwd); }
  const file = path.join(dir, fs.readdirSync(dir)[0]);
  const wb = XLSX.read(fs.readFileSync(file));
  assert.deepEqual(wb.SheetNames, ['Audit Report', 'Locked and Faulty']);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Audit Report'], { header: 1 });
  assert.equal(rows.length, report.rows.length + 1);
  assert.equal(rows[0][1], 'ITEM');
  assert.equal(reportTsv(report, false).split('\n').length, report.rows.length);
});
