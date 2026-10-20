// PDF files for Tools › PDF merger: read them (also out of .zip files) and merge them into one PDF.
import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';

const isPdf = name => /\.pdf$/i.test(name) && !name.split('/').pop().startsWith('.');

// files: File objects (.pdf, or .zip files with PDFs in them, also in sub-folders).
// Returns { pdfs: [{ name, bytes }] (a PDF from a zip is named "export.zip › folder/report.pdf"), skipped: names of other files }
export async function readPdfFiles(files) {
  const pdfs = [], skipped = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name)) {
      const zip = XLSX.CFB.read(bytes, { type: 'array' });
      let found = 0;
      zip.FileIndex.forEach((entry, i) => {
        const inner = zip.FullPaths[i].replace(/^Root Entry\//, '').replace(/\\/g, '/');
        if (entry.type !== 2 || !entry.size || inner.startsWith('__MACOSX/') || !isPdf(inner)) return;
        pdfs.push({ name: `${file.name} › ${inner}`, bytes: new Uint8Array(entry.content) });
        found++;
      });
      if (!found) skipped.push(`${file.name} (no PDFs inside)`);
    } else if (isPdf(file.name)) pdfs.push({ name: file.name, bytes });
    else skipped.push(file.name);
  }
  return { pdfs, skipped };
}

// the order they are merged in: by the file's own name (not the zip or folder it came from), numbers counted as
// numbers (GG2 before GG10); the same name twice: by where it came from
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const baseName = name => name.split(/[/›]/).pop().trim();
export const sortPdfs = list => [...list].sort((a, b) => byName(baseName(a.name), baseName(b.name)) || byName(a.name, b.name));

// list: [{ name, bytes }] in order. Returns { bytes (the merged PDF), pages, failed: names that couldn't be read }
export async function mergePdfs(list) {
  const out = await PDFDocument.create();
  const failed = [];
  for (const { name, bytes } of list) {
    try {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
    } catch { failed.push(name); }
  }
  return { bytes: await out.save(), pages: out.getPageCount(), failed };
}

// a file name for the merged PDF: characters Windows doesn't allow become -, and it ends in .pdf
export const pdfFileName = name => `${String(name ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.pdf$/i, '').replace(/[. ]+$/, '') || 'Merged'}.pdf`;
