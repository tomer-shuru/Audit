import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { parsePastedTable, downloadXlsx, toTsv, readTableFiles } from '../src/ui/io.js';
import { buildReport, EXPORT_COLUMNS, LOCKED_COLUMNS } from '../src/engine/report.js';
import { loadFixture, fixtureNames } from './fixture.js';
import models from '../src/data/default-models.json' with { type: 'json' };

XLSX.set_fs(fs); // the ESM build needs fs injected to write files under Node

test('pasted Blancco rows keep serials and text as-is', () => {
  const t = parsePastedTable('System serial\tDisk serial\tCapacity\tErasure state\n0012345\t212730498071\t51\tSuccessful\n');
  assert.deepEqual(t, [['System serial', 'Disk serial', 'Capacity', 'Erasure state'], ['0012345', '212730498071', '51', 'Successful']]);
  const c = parsePastedTable('System serial,Comment\nABC,"CD B, DI C"\n');
  assert.deepEqual(c[1], ['ABC', 'CD B, DI C']);
});

test('reads several files, including .zip files with CSVs in sub-folders', async () => {
  const zip = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(zip, 'a.csv', Buffer.from('System serial,Erasure state\nAAA,Successful\n'));
  XLSX.CFB.utils.cfb_add(zip, 'sub/b.csv', Buffer.from('System serial,Erasure state\nBBB,Failed\n'));
  XLSX.CFB.utils.cfb_add(zip, 'readme.pdf', Buffer.from('not a table'));
  const zipBytes = XLSX.CFB.write(zip, { fileType: 'zip', type: 'buffer' });
  const files = [
    new File([zipBytes], 'export.zip'),
    new File(['System serial,Erasure state\nCCC,Successful\n'], 'c.csv'),
  ];
  const out = await readTableFiles(files);
  assert.deepEqual(out.map(f => f.name).sort(), ['c.csv', 'export.zip › a.csv', 'export.zip › sub/b.csv']);
  assert.deepEqual(out.find(f => f.name.endsWith('b.csv')).table, [['System serial', 'Erasure state'], ['BBB', 'Failed']]);
  await assert.rejects(readTableFiles([new File(['x'], 'notes.pdf')]), /isn't a \.csv/);
});

test('copy only includes the chosen rows and columns, without Item Lookup', () => {
  const rows = [{ itemLookup: 'GG01', item: 'ITD-1-GG01', sn: 'A', diagnostics: 'x\ty' }, { itemLookup: 'GG02', item: 'ITD-1-GG02', sn: 'B' }];
  assert.ok(!EXPORT_COLUMNS.some(([k]) => k === 'itemLookup'));
  assert.equal(EXPORT_COLUMNS[0][0], 'item');
  const cols = [['item', 'ITEM'], ['diagnostics', 'Diagnostics']];
  assert.equal(toTsv(cols, rows, true), 'ITEM\tDiagnostics\nITD-1-GG01\tx y\nITD-1-GG02\t');
  assert.equal(toTsv(cols, rows.slice(1), false), 'ITD-1-GG02\t');
});

test('xlsx export has Audit Report and Locked and Faulty sheets', { skip: !fixtureNames().length }, () => {
  const { project } = loadFixture(fixtureNames()[0]);
  const report = buildReport(project, models);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    downloadXlsx([
      { name: 'Audit Report', cols: EXPORT_COLUMNS, rows: report.rows },
      { name: 'Locked and Faulty', cols: LOCKED_COLUMNS, rows: report.lockedFaulty },
    ], project.settings);
  } finally { process.chdir(cwd); }
  const file = path.join(dir, fs.readdirSync(dir)[0]);
  const wb = XLSX.read(fs.readFileSync(file));
  assert.deepEqual(wb.SheetNames, ['Audit Report', 'Locked and Faulty']);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Audit Report'], { header: 1 });
  assert.equal(rows.length, report.rows.length + 1);
  assert.equal(rows[0][0], 'ITEM');
});
