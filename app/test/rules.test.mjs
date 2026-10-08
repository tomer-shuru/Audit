import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shortCpu, formatRamMac, formatRamWindows, formatRamBlancco, formatDiskCapacity, diskKind,
  batteryGrade, windowsBatteryPct, expandDiagCodes, cleanModelName, proper, formatDiagnostics,
} from '../src/engine/rules.js';
import { erasureSummary, mergeTables, normalizeBlancco, blanccoComments, formatReportDisk } from '../src/engine/sources.js';
import models from '../src/data/default-models.json' with { type: 'json' };

test('shortCpu', () => {
  assert.equal(shortCpu('Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz'), 'i7-8700');
  assert.equal(shortCpu('11th Gen Intel(R) Core(TM) i7-11850H @ 2.50GHz'), 'i7-11850H');
  assert.equal(shortCpu('12th Gen Intel(R) Core(TM) i7-1270P'), 'i7-1270P');
  assert.equal(shortCpu('Intel(R) Xeon(R) CPU E5-2620 v4 @ 2.10GHz'), 'Xeon E5-2620 v4');
  assert.equal(shortCpu('AMD Ryzen 5 PRO 4650U with Radeon Graphics'), 'Ryzen 5 PRO 4650U');
  assert.equal(shortCpu('AMD Ryzen 7 PRO 7840U w/ Radeon 780M Graphics'), 'Ryzen 7 PRO 7840U');
  assert.equal(shortCpu('AMD Ryzen 9 8-Core Processor'), 'Ryzen 9');
  assert.equal(shortCpu('Intel(R) Core(TM) Ultra 7 155H'), 'Ultra 7 155H');
  assert.equal(shortCpu('M1 Pro'), '');
  assert.equal(shortCpu(''), '');
});

test('RAM formats', () => {
  assert.equal(formatRamMac('16 GB LPDDR5'), '16 GB DDR5');
  assert.equal(formatRamMac('8 GB'), '8 GB');
  assert.equal(formatRamWindows('16 GB DDR5'), '16 GB DDR5');
  assert.equal(formatRamWindows('16 GB x2 DDR4'), '16 GB x2 DDR4');
  assert.equal(formatRamWindows(''), '');
  assert.equal(formatRamBlancco('32 GiB', 'DDR4 / DDR4 / DDR4 / DDR4'), '32 GB DDR4');
  assert.equal(formatRamBlancco('16 GiB', 'Unknown / LPDDR5'), '16 GB LPDDR5');
});

test('disks', () => {
  assert.equal(formatDiskCapacity('512.1 GB'), '512 GB');
  assert.equal(formatDiskCapacity('2 TB'), '2 TB');
  assert.equal(diskKind('NVMe'), 'NVMe');
  assert.equal(diskKind('SATA/SSD'), 'SSD');
  assert.equal(diskKind('SATA'), 'HDD');
  assert.equal(diskKind('USB'), 'USB');
  assert.equal(formatReportDisk('NONE'), '-');
  assert.equal(formatReportDisk(' none '), '-');
  assert.equal(formatReportDisk('500 GB SSD'), '500 GB SSD');
});

test('erasure summary', () => {
  const s = erasureSummary([
    { serial: 'A', erasure: 'Successful' }, { serial: 'A', erasure: 'Successful' },
    { serial: 'B', erasure: 'Failed' }, { serial: 'C', erasure: 'Successful' }, { serial: 'C', erasure: 'Failed' },
    { serial: 'D', erasure: '' },
  ]);
  assert.equal(s('A'), 'Pass x2');
  assert.equal(s('b'), 'Fail');
  assert.equal(s('C'), 'Pass, Fail');
  assert.equal(s('D'), '');
  assert.equal(s('Z'), '');
});

test('battery grades', () => {
  assert.equal(batteryGrade(54.9), 'Battery Defect');
  assert.equal(batteryGrade(55), 'Battery D');
  assert.equal(batteryGrade(69), 'Battery D');
  assert.equal(batteryGrade(80), 'Battery C');
  assert.equal(batteryGrade(81), '');
  assert.equal(windowsBatteryPct('69.0%'), 69);
  assert.equal(windowsBatteryPct('0.5'), 50);
  assert.equal(windowsBatteryPct('88'), 88);
});

test('diagnostic codes', () => {
  assert.equal(expandDiagCodes('CD B, LM B, DI C', models.diagCodes), 'Chassis damage B, Label marks B, Display C');
  assert.equal(expandDiagCodes('Battery D, KBS, AID', models.diagCodes), 'Battery D, KB Sticky, Apple ID');
  assert.equal(expandDiagCodes('label marks d', models.diagCodes), 'label marks d');
  assert.equal(expandDiagCodes('', models.diagCodes), '');
});

test('diagnostics capitalisation', () => {
  assert.equal(formatDiagnostics('display b, screen scratches b'), 'Display B, Screen scratches B');
  assert.equal(formatDiagnostics('label marks d, kb sticky'), 'Label marks D, Kb sticky');
  assert.equal(formatDiagnostics('Remote Locked, BIOS locked, Battery D'), 'Remote Locked, BIOS locked, Battery D');
  assert.equal(formatDiagnostics(' ok ,, dead'), 'Ok, Dead');
  assert.equal(formatDiagnostics(''), '');
});

test('merging several Blancco exports', () => {
  const a = [['System serial', 'Erasure state'], ['AAA', 'Successful'], ['BBB', 'Failed']];
  const b = [['Erasure state', 'System serial', 'Disk serial'], ['Successful', 'CCC', 'D1'], ['Failed', 'BBB', '']];
  assert.deepEqual(mergeTables([a, b]), [
    ['System serial', 'Erasure state', 'Disk serial'],
    ['AAA', 'Successful', ''], ['BBB', 'Failed', ''], ['CCC', 'Successful', 'D1'],
  ]);
  assert.deepEqual(mergeTables([]), []);
});

test('Blancco network message becomes "WiFi defect", from any comment column, listed once', () => {
  const net = 'Could not connect to the configured network.';
  assert.deepEqual(blanccoComments({ comment1: 'CD B, DI C', comment8: net }), ['CD B', 'DI C', 'WiFi defect']);
  assert.deepEqual(blanccoComments({ comment1: net, comment2: 'KBS' }), ['WiFi defect', 'KBS']);
  assert.deepEqual(blanccoComments({ comment1: 'CD C, WiFi defect, DI C', comment8: net }), ['CD C', 'WiFi defect', 'DI C']);
  assert.deepEqual(blanccoComments({ comment1: 'DI C', comment7: 'something else' }), ['DI C']);
  assert.deepEqual(blanccoComments({ comment1: 0, comment2: '' }), []);
});

test('repeated "Comment" headers keep their own columns', () => {
  const t = [['System serial', 'Comment', 'Comment', 'Comment'], ['S1', '', 'DI C, CD B', 'net']];
  assert.deepEqual(mergeTables([t]), [['System serial', 'Comment', 'Comment2', 'Comment3'], ['S1', '', 'DI C, CD B', 'net']]);
  const n = normalizeBlancco(t);
  assert.equal(n.rows[0].comment2, 'DI C, CD B');
  assert.equal(n.rows[0].comment3, 'net');
});

test('model cleanup and PROPER', () => {
  assert.equal(cleanModelName('HP EliteBook 840 G5 Notebook PC', models.cleanupRules), 'EliteBook 840 G5');
  assert.equal(proper('LENOVO'), 'Lenovo');
  assert.equal(proper('Dell Inc.'), 'Dell Inc.');
});

test('item code from Custom 1 when Device Identifier is missing or blank', () => {
  const cols = ['System manufacturer', 'System chassis type', 'Asset Tag', 'Erasure state', 'System serial', 'System version', 'System model',
    'Capacity', 'CPU model', 'Total Memory', 'Memory type', 'Disk capacity', 'Disk interface type', 'Disk serial'];
  const onlyCustom = normalizeBlancco([[...cols, 'Custom 1'], [...cols.map(() => ''), 'GG07']]);
  assert.deepEqual(onlyCustom.missing, []);
  assert.equal(onlyCustom.rows[0].item, 'GG07');
  const both = normalizeBlancco([[...cols, 'Device Identifier', 'Custom 1'], [...cols.map(() => ''), 'GG01', 'GG99'], [...cols.map(() => ''), '', 'GG02']]);
  assert.deepEqual(both.rows.map(r => r.item), ['GG01', 'GG02']);
  assert.deepEqual(normalizeBlancco([cols, cols.map(() => 'x')]).missing, ['Device Identifier (or Custom 1)']);
});
