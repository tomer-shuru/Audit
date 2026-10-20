import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';
import { readPdfFiles, sortPdfs, mergePdfs, pdfFileName } from '../src/ui/pdfs.js';

const makePdf = async pages => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
};

test('PDFs are found in files and in .zip files (also in sub-folders); other files are skipped', async () => {
  const zip = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(zip, 'r1.pdf', await makePdf(1));
  XLSX.CFB.utils.cfb_add(zip, 'sub/r2.pdf', await makePdf(2));
  XLSX.CFB.utils.cfb_add(zip, 'notes.txt', Buffer.from('x'));
  const empty = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(empty, 'a.csv', Buffer.from('x'));
  const files = [
    new File([XLSX.CFB.write(zip, { fileType: 'zip', type: 'buffer' })], 'Reports.zip'),
    new File([await makePdf(3)], 'Single.PDF'),
    new File(['x'], 'list.xlsx'),
    new File([XLSX.CFB.write(empty, { fileType: 'zip', type: 'buffer' })], 'other.zip'),
  ];
  const { pdfs, skipped } = await readPdfFiles(files);
  assert.deepEqual(pdfs.map(p => p.name).sort(), ['Reports.zip › r1.pdf', 'Reports.zip › sub/r2.pdf', 'Single.PDF']);
  assert.deepEqual(skipped, ['list.xlsx', 'other.zip (no PDFs inside)']);
});

test('merges every page in order; a file that is not a PDF is reported, the rest still merge', async () => {
  const list = [{ name: 'a.pdf', bytes: await makePdf(2) }, { name: 'broken.pdf', bytes: new Uint8Array([1, 2, 3]) }, { name: 'b.pdf', bytes: await makePdf(3) }];
  const { bytes, pages, failed } = await mergePdfs(list);
  assert.equal(pages, 5);
  assert.deepEqual(failed, ['broken.pdf']);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 5);
});

test('merge order is by the file name (not its zip or folder), numbers counted as numbers', () => {
  assert.deepEqual(sortPdfs([{ name: 'r10.pdf' }, { name: 'R2.pdf' }, { name: 'r1.pdf' }]).map(p => p.name), ['r1.pdf', 'R2.pdf', 'r10.pdf']);
  assert.deepEqual(sortPdfs([{ name: 'Reports.zip › GG10.pdf' }, { name: 'Reports.zip › more/GG3.pdf' }, { name: 'GG1.pdf' }]).map(p => p.name),
    ['GG1.pdf', 'Reports.zip › more/GG3.pdf', 'Reports.zip › GG10.pdf']);
});

test('merged file name', () => {
  assert.equal(pdfFileName('WipingReports-SHR11734'), 'WipingReports-SHR11734.pdf');
  assert.equal(pdfFileName('a/b: c.pdf '), 'a-b- c.pdf');
  assert.equal(pdfFileName('  '), 'Merged.pdf');
});
