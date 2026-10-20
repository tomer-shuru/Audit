// Tools › PDF merger: add PDFs (or .zip files with PDFs in them), see how many were found, and merge them into one PDF,
// named WipingReports-<project number> unless another name is typed. The files stay in the window while the app is
// open (they aren't saved in the project).
import { readPdfFiles, sortPdfs, mergePdfs, pdfFileName } from './pdfs.js';
import { downloadBytes } from './simstemplate.js';
import { state } from './state.js';
import { $, esc, plural, toast, askText, dropZone } from './util.js';

const TITLE = 'PDF merger';
let pdfs = []; // [{ name, bytes }], in merge order (by name)
let busy = false;

const size = n => (n < 1024 ** 2 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

export function openPdfMerger() {
  $('#collabTitle').textContent = TITLE;
  $('#collabActions').innerHTML = '<label class="btn">Add files…<input type="file" id="pdfAdd" accept=".pdf,.zip" multiple hidden></label>';
  $('#pdfAdd').onchange = e => { const list = [...e.target.files]; e.target.value = ''; addFiles(list); };
  renderPdfs();
  if (!$('#collabDialog').open) $('#collabDialog').showModal();
}

function renderPdfs() {
  const total = pdfs.reduce((n, p) => n + p.bytes.length, 0);
  const body = $('#collabBody');
  body.innerHTML = `
    <div class="dropzone files-drop" id="pdfDrop">
      <p class="hint">Merge PDFs (e.g. the wiping reports) into one file. Click Add files… or drop PDFs, or .zip files with PDFs in them, here.
      They are merged in the order below (by name).</p>
      ${pdfs.length ? `
      <div class="status good">✓ ${plural(pdfs.length, 'PDF file')} · ${size(total)}</div>
      <ul class="project-list">${pdfs.map((p, i) => `
        <li><div><b>${esc(p.name)}</b><br><span class="muted">${size(p.bytes.length)}</span></div>
          <button class="icon-btn" data-rm="${i}" title="Leave out ${esc(p.name)}">✕</button></li>`).join('')}
      </ul>
      <div class="dialog-actions">
        <button class="btn ghost" id="pdfClear">Remove all</button>
        <button class="btn primary" id="pdfMerge" ${busy ? 'disabled' : ''}>${busy ? 'Merging…' : `Merge ${plural(pdfs.length, 'PDF')}…`}</button>
      </div>` : '<p class="empty drop-hint">No PDFs yet. Add some, or drop them here.</p>'}
    </div>`;
  dropZone($('#pdfDrop'), addFiles);
  body.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { pdfs.splice(+b.dataset.rm, 1); renderPdfs(); });
  const clear = $('#pdfClear');
  if (clear) clear.onclick = () => { pdfs = []; renderPdfs(); };
  const merge = $('#pdfMerge');
  if (merge) merge.onclick = mergeNow;
}

// adding a file with the same name again replaces the earlier copy
async function addFiles(list) {
  if (!list.length) return;
  try {
    const { pdfs: found, skipped } = await readPdfFiles(list);
    const names = new Set(found.map(p => p.name));
    pdfs = sortPdfs([...pdfs.filter(p => !names.has(p.name)), ...found]);
    const left = skipped.length ? ` Skipped (not a PDF): ${skipped.join(', ')}` : '';
    toast(found.length ? `Found ${plural(found.length, 'PDF file')}.${left}` : `No PDFs found.${left}`, found.length ? 'ok' : 'bad');
  } catch (err) { toast(`Couldn't read the files: ${err.message}`, 'bad'); }
  renderPdfs();
}

async function mergeNow() {
  const number = state.project.settings.projectNumber.trim();
  const name = await askText({
    title: 'Merged PDF name', label: 'File name',
    value: `WipingReports${number ? `-${number}` : ''}`, ok: 'Merge and download',
    hint: `${plural(pdfs.length, 'PDF')} are merged into one file, saved like any download (usually to Downloads).`,
  });
  if (name === null) return;
  busy = true; renderPdfs();
  try {
    const { bytes, pages, failed } = await mergePdfs(pdfs);
    if (!pages) { toast(`Nothing merged: none of the files could be read as a PDF${failed.length ? ` (${failed.join(', ')})` : ''}`, 'bad'); return; }
    const file = pdfFileName(name);
    downloadBytes(bytes, file, 'application/pdf');
    toast(`Downloaded ${file}: ${plural(pdfs.length - failed.length, 'PDF')}, ${plural(pages, 'page')}${failed.length ? `. Couldn't read (left out): ${failed.join(', ')}` : ''}`, failed.length ? 'bad' : 'ok');
  } catch (err) {
    toast(`Couldn't merge: ${err.message}`, 'bad');
  } finally {
    busy = false;
    if ($('#collabDialog').open && $('#collabTitle').textContent === TITLE) renderPdfs();
  }
}

export function initPdfMerger() {
  $('#btnPdfMerge').onclick = openPdfMerger;
}
