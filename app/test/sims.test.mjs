import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/engine/report.js';
import { buildSims, makeSimsLookups, translateDiagnostics, simsErasure, purchaseDescription, hddRows, simsIssues, SIMS_COLUMNS } from '../src/engine/sims.js';
import { DEFAULT_CONFIG } from '../src/engine/config.js';
import models from '../src/data/default-models.json' with { type: 'json' };

const project = (extra = {}) => ({
  settings: { projectNumber: 'SHR1', prefix: 'GG', endClient: 'X' },
  inputs: { reports: '', blanccoFiles: [] },
  manual: {}, overrides: {}, simsOverrides: {}, ...extra,
});
const sims = p => buildSims(buildReport(p, models), p, models);
const lk = makeSimsLookups(models);
const notebook = lk.codesFor('Notebook');

test('the columns are D to T of the SIMS sheet', () => {
  assert.equal(SIMS_COLUMNS.length, 17);
  assert.equal(SIMS_COLUMNS[0][1], 'Item No');
  assert.equal(SIMS_COLUMNS.at(-1)[1], 'Blancco Result');
});

test('every built-in type has a SIMS category with codes', () => {
  for (const { type } of models.simsCategories) {
    const cat = lk.category(type);
    assert.ok(cat, type);
    assert.ok(lk.codesFor(cat), `${type} -> ${cat}`);
  }
  assert.equal(lk.codesFor('Switch').get('144'), 'NWS144');
  assert.equal(lk.codesFor('Data Carrier (loose)').get('144'), 'DCR144');
});

test('issue numbers mean the same in every category', () => {
  const issues = simsIssues(models);
  assert.ok(issues.length > 150);
  assert.equal(issues.find(i => i.no === '107').description, 'keyboard defect');
});

test('diagnostics become the codes of the category', () => {
  assert.deepEqual(translateDiagnostics('Chassis damage D, KB discolored C', notebook, lk),
    { codes: 'LPT032,LPT110', remark: '', unknown: [], missing: [] });
  assert.equal(translateDiagnostics('Chassis damage B', lk.codesFor('PC'), lk).codes, 'BSU033');
  assert.equal(translateDiagnostics('Outdated', lk.codesFor('All in One System'), lk).codes, 'AIO144');
  // several of our spellings for one code; capitals, dashes and spaces don't matter
  for (const d of ['Sticky kb', 'KB sticky', 'kb  STICKY']) assert.equal(translateDiagnostics(d, notebook, lk).codes, 'LPT107');
  assert.equal(translateDiagnostics('Screen scratches -b', lk.codesFor('Monitor TFT'), lk).codes, 'TFT077');
  // one diagnostic, two codes
  assert.equal(translateDiagnostics('BIOS locked', notebook, lk).codes, 'LPT131,LPT151');
  // written like the SIMS issue itself
  assert.equal(translateDiagnostics('Fan defect', notebook, lk).codes, 'LPT083');
  // "Key * defect": any key
  for (const d of ['Key P defect', 'Key Capslock defect', 'key ctrl  DEFECT', 'Key left shift defect']) assert.equal(translateDiagnostics(d, notebook, lk).codes, 'LPT107', d);
  assert.equal(translateDiagnostics('Key defect', notebook, lk).codes, 'LPT172'); // needs a word in between
  assert.equal(translateDiagnostics('Keyboard defect', notebook, lk).codes, 'LPT107'); // the SIMS issue itself
  assert.equal(translateDiagnostics('Liquid marks, Battery Service', notebook, lk).codes, 'LPT116,LPT014');
  assert.equal(translateDiagnostics('Liquid marks', lk.codesFor('Monitor TFT'), lk).codes, 'TFT116');
});

test('diagnostics without a code go to Item Remark with "see remarks"; Ok is left out; codes only once', () => {
  const t = translateDiagnostics('Screen scratches B, Display B, Physical desertion, Speaker defect, Chassis damage C', notebook, lk);
  assert.equal(t.codes, 'LPT077,LPT057,LPT032,LPT172');
  assert.equal(t.remark, 'Physical desertion,Speaker defect');
  assert.deepEqual(t.unknown, ['Physical desertion']);
  assert.deepEqual(t.missing, [{ diag: 'Speaker defect', nos: ['178'] }]); // a SIMS issue, but notebooks have no code for it
  assert.deepEqual(translateDiagnostics('Ok', notebook, lk), { codes: '', remark: '', unknown: [], missing: [] });
  assert.equal(translateDiagnostics('Battery C, Battery D, Ok', notebook, lk).codes, 'LPT014');
  // an issue the category has no code for (monitors have no keyboard)
  const m = translateDiagnostics('Sticky kb', lk.codesFor('Monitor TFT'), lk);
  assert.equal(m.codes, 'TFT172');
  assert.equal(m.remark, 'Sticky kb');
  assert.equal(m.missing[0].diag, 'Sticky kb');
});

test('Blancco result, Purchase Description', () => {
  assert.equal(simsErasure('Pass'), 'Erased');
  assert.equal(simsErasure('Pass x2'), 'Erased Erased');
  assert.equal(simsErasure('Pass, Fail'), 'Erased Not Erased');
  assert.equal(simsErasure(''), '');
  assert.equal(purchaseDescription({ cpu: 'i5-4258U', ram: '8 GB DDR3', disk: '251 GB SSD' }), 'i5-4258U,8 GB DDR3,251 GB SSD');
  assert.equal(purchaseDescription({ cpu: '', ram: '-', disk: '-' }), 'n/a');
  assert.equal(purchaseDescription({}, { ...DEFAULT_CONFIG, texts: { ...DEFAULT_CONFIG.texts, simsNoSpecs: '-' } }), '-');
});

test('SIMS rows from the report, with SIMS edits and checks', () => {
  const p = project({
    manual: {
      GG01: { sn: 'C02', asset: '3878696', type: 'Laptop', make: 'Apple', model: 'Pro A2251', screen: '13', year: '2020', cpu: 'i7', ram: '32 GB', disk: '2 TB SSD', diagnostics: 'Physical desertion, Chassis damage C', blancco: 'Pass' },
      GG02: { sn: 'X1', type: 'Smart board', diagnostics: 'Outdated' },
      GG03: { sn: 'X2', type: 'Monitor', diagnostics: 'Outdated', snDataCarrier: 'S66X, W620' },
    },
    overrides: { GG01: { sn: 'C02N' } },
    simsOverrides: { GG01: { category: 'Tablet' }, GG03: { remark: 'checked' } },
  });
  const s = sims(p);
  const [a, b, c] = s.rows;
  assert.equal(a.item, 'ITD-SHR1-GG01');
  assert.equal(a.sn, 'C02N');
  assert.ok(a._edited.includes('sn') && a._edited.includes('category'));
  assert.equal(a.category, 'Tablet');
  assert.equal(a._base.category, 'Notebook');
  assert.equal(a.codes, 'TAB032,TAB172'); // codes of the typed category
  assert.equal(a.remark, 'Physical desertion');
  assert.equal(a.modelLine, 'Apple,Pro A2251,13,2020');
  assert.equal(a.purchase, 'i7,32 GB,2 TB SSD');
  assert.equal(a.erased, 'Erased');
  assert.equal(a.weight, 2);
  assert.equal(b.category, '');
  assert.equal(b.codes, '');
  assert.equal(b.remark, '');
  assert.equal(c.codes, 'TFT144');
  assert.equal(c.remark, 'checked');
  const texts = s.warnings.map(w => w.text);
  assert.ok(texts.some(t => t.includes('"Physical desertion" has no SIMS code') && t.includes('GG01')));
  assert.ok(texts.some(t => t.includes('type "Smart board" has no SIMS category')));
  assert.deepEqual(hddRows(buildReport(p, models).rows).map(r => [r.item, r.serial]), [['ITD-SHR1-GG03', 'S66X'], ['ITD-SHR1-GG03', 'W620']]);
});

test('fills the SIMS template: rows in D to T, HDD, codes; old rows and their texts are gone', async () => {
  const XLSX = await import('xlsx');
  const { fillSimsTemplate } = await import('../src/ui/simstemplate.js');
  const header = ['PTB Project No', 'PTB Description', 'Collection Date', ...SIMS_COLUMNS.map(c => c[1]), 'Additional data deletions', 'Price', 'Currency'];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Audit - & Settlement - Report'], ['Notebook', { f: 'COUNTIF(\'Item per service project\'!I:I,A2)', v: 7 }]]), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ['EUS1', 'ITAD', '1.1.2026', 'ITD-OLD-01', 'OLDSERIAL'], ['EUS1', 'ITAD', '1.1.2026', 'ITD-OLD-02', 'OLDSERIAL2']]), 'Item per service project');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], [], [], ['Item No', 'Data Carrier Serial No'], ['ITD-OLD-01', 'OLDDISK']]), 'HDD');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['category', 'code', 'description'], ['Old', 'OLD001', 'old']]), 'Diagnostic codes');
  const template = XLSX.write(wb, { type: 'array', bookType: 'xlsx', bookSST: true });

  const items = [SIMS_COLUMNS.map(([k]) => (k === 'item' ? 'ITD-NEW-01' : k === 'weight' ? 2 : k === 'sn' ? '0012' : ''))];
  const out = fillSimsTemplate(new Uint8Array(template), { items, hdd: [['ITD-NEW-01', 'D1']], codes: [['Notebook', 'LPT144', 'outdated']] });
  const back = XLSX.read(out);
  const rows = XLSX.utils.sheet_to_json(back.Sheets['Item per service project'], { header: 1, defval: '' });
  assert.equal(rows[1][3], 'ITD-NEW-01');
  assert.equal(rows[1][4], '0012'); // serials stay text
  assert.equal(rows[1][18], 2);
  assert.equal(rows[1][0], ''); // A to C are left empty
  assert.ok(!rows.slice(2).some(r => r.some(v => v !== '')), 'old rows are emptied');
  assert.deepEqual(XLSX.utils.sheet_to_json(back.Sheets.HDD, { header: 1, defval: '' }).filter(r => r.some(v => v !== '')), [['Item No', 'Data Carrier Serial No'], ['ITD-NEW-01', 'D1']]);
  assert.deepEqual(XLSX.utils.sheet_to_json(back.Sheets['Diagnostic codes'], { header: 1 }), [['category', 'code', 'description'], ['Notebook', 'LPT144', 'outdated']]);
  const files = XLSX.CFB.read(out, { type: 'array' });
  const text = p => new TextDecoder().decode(XLSX.CFB.find(files, p).content);
  assert.ok(!/OLDSERIAL|OLDDISK|OLD001/.test(text('/xl/sharedStrings.xml')), 'no text of the old rows stays in the file');
  assert.match(text('/xl/workbook.xml'), /fullCalcOnLoad="1"/);
  // the Summary formula stays, its old result is dropped so it's recalculated
  assert.match(text('/xl/worksheets/sheet1.xml'), /<f>COUNTIF/);
  assert.doesNotMatch(text('/xl/worksheets/sheet1.xml'), /<v>7<\/v>/);
  // a template whose columns moved is refused
  const moved = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(moved, XLSX.utils.aoa_to_sheet([['', '', '', 'Item No', 'Serial No']]), 'Item per service project');
  assert.throws(() => fillSimsTemplate(new Uint8Array(XLSX.write(moved, { type: 'array', bookType: 'xlsx' })), {}), /columns .* have changed/);
});
