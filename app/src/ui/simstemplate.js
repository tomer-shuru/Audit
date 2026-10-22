// Fills the SIMS template (.xlsx) with a project: Item per service project (columns D to T), HDD and
// Diagnostic codes. Everything else in their file (logos, comments, colours, the Summary formulas, the
// SLS grading file) stays as it is; Excel / Google Sheets recalculate the Summary when the file opens.
// Works on the file's XML directly, because the xlsx library can't write styles.
import * as XLSX from 'xlsx';

const CFB = XLSX.CFB;
const dec = new TextDecoder(), enc = new TextEncoder();

export const SIMS_TEMPLATE = { folder: 'Templates', file: 'SIMS.xlsx' }; // in the shared Audit Builder folder
export const LOCK_TEMPLATE = { folder: 'Templates', file: 'Locked devices request.xlsx' };
const LOCK_SHEET = '2. Locked devices request';
const SHEETS = { items: 'Item per service project', hdd: 'HDD', codes: 'Diagnostic codes' };

const colIndex = letters => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const escXml = v => String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (attrs, name) => (attrs.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];
const textOf = xml => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => unescXml(m[1])).join('');

const ROW_RE = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

function entry(zip, path) {
  const e = CFB.find(zip, '/' + path);
  if (!e) return null;
  return { get: () => dec.decode(e.content instanceof Uint8Array ? e.content : new Uint8Array(e.content)), set: text => { e.content = enc.encode(text); e.size = e.content.length; } };
}

// sheet name -> path of its XML, from workbook.xml and its relationships
function sheetPaths(zip) {
  const wb = entry(zip, 'xl/workbook.xml').get();
  const rels = entry(zip, 'xl/_rels/workbook.xml.rels').get();
  const target = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(m => [attr(m[1], 'Id'), attr(m[1], 'Target')]));
  return new Map([...wb.matchAll(/<sheet\b([^>]*)\/?>/g)].map(m => {
    const t = target.get(attr(m[1], 'r:id')) || '';
    return [unescXml(attr(m[1], 'name') || ''), t.startsWith('/') ? t.slice(1) : `xl/${t}`];
  }));
}

function parseRows(sheetXml) {
  const m = sheetXml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!m) throw new Error('a sheet has no cells part');
  const rows = [...(m[1] || '').matchAll(ROW_RE)].map(rm => ({
    r: Number(attr(rm[1], 'r')), attrs: rm[1], raw: rm[0],
    cells: [...(rm[2] || '').matchAll(CELL_RE)].map(cm => ({ col: colIndex((attr(cm[1], 'r') || '').replace(/\d+/g, '')), attrs: cm[1], inner: cm[2] ?? null, raw: cm[0] })),
  }));
  return { rows, before: sheetXml.slice(0, m.index), after: sheetXml.slice(m.index + m[0].length) };
}

const cellValue = (c, sst) => {
  if (c.inner == null) return '';
  const t = attr(c.attrs, 't');
  if (t === 's') return sst[Number((c.inner.match(/<v>([^<]*)<\/v>/) || [])[1])]?.text ?? '';
  if (t === 'inlineStr') return textOf(c.inner);
  return unescXml((c.inner.match(/<v>([^<]*)<\/v>/) || [])[1] ?? '');
};

function newCell(col, r, style, value) {
  const ref = `${colName(col)}${r}`, s = style ? ` s="${style}"` : '';
  if (value === '' || value == null) return style ? `<c r="${ref}"${s}/>` : '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escXml(value)}</t></is></c>`;
}

// Writes `data` (arrays of values, starting at column firstCol) under the header row found by isHeader, keeping
// each column's style. Template rows below the data are emptied in columns from..to; other columns are left alone.
function fillSheet(xml, sst, { isHeader, firstCol, from, to, data, name }) {
  const { rows, before, after } = parseRows(xml);
  const header = rows.find(row => isHeader(Object.fromEntries(row.cells.map(c => [colName(c.col), String(cellValue(c, sst)).trim()]))));
  if (!header) throw new Error(`the "${name}" tab doesn't have the expected headers`);
  const start = header.r + 1;
  const byR = new Map(rows.map(row => [row.r, row]));
  const styleRow = byR.get(start);
  const styleOf = col => (styleRow && attr(styleRow.cells.find(c => c.col === col)?.attrs || '', 's')) || '';
  const last = Math.max(start + data.length - 1, ...rows.map(row => row.r));

  const out = rows.filter(row => row.r < start).map(row => row.raw);
  function rebuild(row, values) {
    const cells = new Map(row.cells.map(c => [c.col, c]));
    const parts = [];
    for (const col of [...new Set([...cells.keys(), ...(values ? range(from, to) : [])])].sort((a, b) => a - b)) {
      const c = cells.get(col);
      if (col < from || col > to) { parts.push(c.raw); continue; }
      const v = values ? values[col - firstCol] : '';
      const cell = newCell(col, row.r, (c && attr(c.attrs, 's')) || styleOf(col), col >= firstCol ? v : '');
      if (cell) parts.push(cell);
    }
    return `<row${row.attrs}>${parts.join('')}</row>`;
  }
  for (let r = start; r <= last; r++) {
    const i = r - start, row = byR.get(r);
    if (row) out.push(rebuild(row, i < data.length ? data[i] : null));
    else if (i < data.length) out.push(rebuild({ r, attrs: ` r="${r}"`, cells: [] }, data[i]));
  }
  const end = start + data.length - 1;
  let result = `${before}<sheetData>${out.join('')}</sheetData>${after}`.replace(/<dimension\b[^>]*\/>/, '');
  result = result.replace(/(<autoFilter\b[^>]*\bref="\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?)(\d+)/, (m, a, n) => a + Math.max(Number(n), end));
  return result;
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// sharedStrings.xml -> [{ xml, text }]
function readSst(zip) {
  const e = entry(zip, 'xl/sharedStrings.xml');
  if (!e) return { e: null, list: [] };
  return { e, list: [...e.get().matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map(m => ({ xml: m[0], text: textOf(m[1] || '') })) };
}

/**
 * bytes: the template .xlsx; items: rows of the 17 values for columns D to T; hdd: [item, serial] rows;
 * codes: [category, code, description] rows. Returns the filled .xlsx as a Uint8Array.
 */
function openTemplate(bytes) {
  const zip = CFB.read(bytes, { type: 'array' });
  if (!entry(zip, 'xl/workbook.xml')) throw new Error('this isn\'t an Excel (.xlsx) file');
  const paths = sheetPaths(zip);
  const sheet = name => {
    const path = paths.get(name);
    const e = path && entry(zip, path);
    if (!e) throw new Error(`the template has no "${name}" tab`);
    return e;
  };
  return { zip, paths, sst: readSst(zip), sheet };
}

export function fillSimsTemplate(bytes, { items = [], hdd = [], codes = [] }) {
  const { zip, paths, sst, sheet } = openTemplate(bytes);

  const itemsSheet = sheet(SHEETS.items);
  itemsSheet.set(fillSheet(itemsSheet.get(), sst.list, {
    name: SHEETS.items, firstCol: 4, from: 1, to: 23, data: items,
    isHeader: h => {
      if (h.D !== 'Item No') return false;
      if (h.T !== 'Blancco Result') throw new Error('the columns of the "Item per service project" tab have changed (expected Item No in D and Blancco Result in T)');
      return true;
    },
  }));
  const hddSheet = sheet(SHEETS.hdd);
  hddSheet.set(fillSheet(hddSheet.get(), sst.list, { name: SHEETS.hdd, firstCol: 1, from: 1, to: 2, data: hdd, isHeader: h => h.A === 'Item No' }));
  const codesSheet = sheet(SHEETS.codes);
  codesSheet.set(fillSheet(codesSheet.get(), sst.list, { name: SHEETS.codes, firstCol: 1, from: 1, to: 3, data: codes, isHeader: h => /^category$/i.test(h.A || '') && /^code$/i.test(h.B || '') }));

  // the item tab's filter range grows with the rows
  const end = items.length + 1;
  return finish(zip, paths, sst, wbXml => wbXml.replace(/(<definedName\b[^>]*>'?Item per service project'?!\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?)(\d+)/, (m, a, n) => a + Math.max(Number(n), end)));
}

/**
 * The SIMS Locked devices request: bytes = their workbook; rows = the 6 values for columns C to H (Lock Type to
 * Password). Project No. (B), their instructions, lock descriptions and the Lock Type drop-down stay; the drop-down covers the rows.
 */
export function fillLockTemplate(bytes, rows) {
  const { zip, paths, sst, sheet } = openTemplate(bytes);
  const e = sheet(LOCK_SHEET);
  const xml = fillSheet(e.get(), sst.list, {
    name: LOCK_SHEET, firstCol: 3, from: 3, to: 8, data: rows,
    isHeader: h => {
      if (h.B !== 'Project No.') return false;
      if (h.C !== 'Lock Type' || h.E !== 'Serial No.') throw new Error(`the columns of the "${LOCK_SHEET}" tab have changed (expected Project No., Lock Type, Client asset tag, Serial No. from column B)`);
      return true;
    },
  });
  // the Lock Type drop-down (C<first row>:C<last row>): as far down as the rows go
  e.set(xml.replace(/(<dataValidation\b[^>]*\bsqref="\$?C\$?(\d+):\$?C\$?)(\d+)/, (m, a, first, last) => a + Math.max(Number(last), Number(first) + rows.length - 1)));
  return finish(zip, paths, sst);
}

// fixWorkbook: a last change to workbook.xml
function finish(zip, paths, sst, fixWorkbook = x => x) {
  // every sheet: drop the old results of formulas (they're recalculated when the file opens) and
  // keep only the shared strings still in use, so nothing of an earlier project stays hidden in the file
  const used = new Map();
  const sheets = [...paths.values()].map(p => entry(zip, p)).filter(Boolean);
  const texts = sheets.map(e => e.get().replace(CELL_RE, (raw, attrs, inner) => {
    if (inner == null) return raw;
    if (/<f[\s>/]/.test(inner)) return `<c${attrs.replace(/\s+t="[^"]*"/, '')}>${inner.replace(/<v>[^<]*<\/v>/, '')}</c>`;
    if (attr(attrs, 't') === 's') {
      const old = Number((inner.match(/<v>([^<]*)<\/v>/) || [])[1]);
      if (!used.has(old)) used.set(old, used.size);
      return `<c${attrs}>${inner.replace(/<v>[^<]*<\/v>/, `<v>${used.get(old)}</v>`)}</c>`;
    }
    return raw;
  }));
  sheets.forEach((e, i) => e.set(texts[i]));
  if (sst.e) {
    const keep = [...used.keys()].map(old => sst.list[old]?.xml ?? '<si><t></t></si>');
    sst.e.set(sst.e.get().replace(/<sst\b([^>]*)>[\s\S]*<\/sst>/, (m, attrs) =>
      `<sst${attrs.replace(/\s+(count|uniqueCount)="\d*"/g, '')} count="${keep.length}" uniqueCount="${keep.length}">${keep.join('')}</sst>`));
  }

  const wb = entry(zip, 'xl/workbook.xml');
  let wbXml = wb.get();
  wbXml = /<calcPr\b/.test(wbXml)
    ? wbXml.replace(/<calcPr\b([^>]*?)(\/?)>/, (m, a, close) => `<calcPr${a.replace(/\s+fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"${close}>`)
    : wbXml.replace(/(<\/definedNames>|<\/sheets>)/, '$1<calcPr fullCalcOnLoad="1"/>');
  wb.set(fixWorkbook(wbXml));
  // an old calculation chain would point at cells that changed
  if (CFB.find(zip, '/xl/calcChain.xml')) {
    CFB.utils.cfb_del(zip, '/xl/calcChain.xml');
    for (const [path, re] of [['[Content_Types].xml', /<Override\b[^>]*calcChain[^>]*\/>/], ['xl/_rels/workbook.xml.rels', /<Relationship\b[^>]*calcChain[^>]*\/>/]]) {
      const e = entry(zip, path); if (e) e.set(e.get().replace(re, ''));
    }
  }
  const out = CFB.write(zip, { fileType: 'zip', type: 'array', compression: true });
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

// type: the file's type (an .xlsx unless said otherwise, e.g. 'application/pdf' for the PDF merger)
export function downloadBytes(bytes, filename, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const blob = new Blob([bytes], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000); // a big file may take a moment to start saving
}
