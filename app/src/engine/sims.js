// The SIMS output: the Audit Report rows laid out like the SIMS "Item per service project" sheet
// (columns D to T of their template), with our diagnostics turned into SIMS diagnostic codes.
// The Dictionary holds the SIMS lists: simsCodes (category, code, description), simsAliases (our diagnostics
// per SIMS issue number), simsIgnore (diagnostics left out) and simsCategories (our type -> SIMS category).
import { str, isBlank, joinNonEmpty } from './rules.js';
import { DEFAULT_CONFIG, withDefaults } from './config.js';

// Columns D to T of the SIMS sheet, in order. label = the header in their template (some are empty),
// name = what the app calls the column. The empty columns are kept so a paste at column D lines up.
export const SIMS_COLUMNS = [
  ['item', 'Item No'], ['sn', 'Serial No'], ['asset', 'Client asset tag'], ['blankG', '', '(empty)'],
  ['imei', '3rd Party No / IMEI No'], ['category', 'Category'], ['modelLine', 'Model'], ['modelNo', 'Model No'],
  ['blankL', '', '(empty)'], ['purchase', 'Purchase Description'], ['diagnostics', '', 'Diagnostics'],
  ['codes', 'Diagnostic Codes'], ['remark', 'Item Remark'], ['grade', 'Grade'], ['status', 'Item Status'],
  ['weight', 'Weight (kg)'], ['erased', 'Blancco Result'],
];
export const SIMS_FIRST_COLUMN = 'D'; // where the columns start in the SIMS template
// SIMS columns that are the same field as in the Audit Report: editing them changes both
export const SIMS_SHARED = new Set(['sn', 'asset', 'diagnostics', 'weight']);
export const simsEditable = key => key !== 'item';

// "Screen scratches -b" = "screen scratches b": capitals, dashes and extra spaces don't matter
export const normDiag = s => str(s).toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
const normName = s => str(s).toLowerCase().replace(/\s+/g, ' ').trim();
export const issueNo = code => (str(code).trim().match(/(\d+)$/) || [])[1] ?? '';
export const splitList = s => str(s).split(',').map(x => x.trim()).filter(x => x !== '');

// the SIMS issues: one per issue number, with its description and the categories that have a code for it
export function simsIssues(models) {
  const map = new Map();
  for (const c of models.simsCodes || []) {
    const no = issueNo(c.code);
    if (!no) continue;
    if (!map.has(no)) map.set(no, { no, description: str(c.description).trim(), categories: [] });
    map.get(no).categories.push(str(c.category).trim());
  }
  return [...map.values()].sort((a, b) => Number(a.no) - Number(b.no) || a.no.localeCompare(b.no));
}

export function makeSimsLookups(models) {
  const codes = models.simsCodes || [];
  // codes per category (the category names of the codes list): number -> code
  const byCategory = new Map();
  for (const c of codes) {
    const cat = normName(c.category), no = issueNo(c.code);
    if (!cat || !no) continue;
    if (!byCategory.has(cat)) byCategory.set(cat, new Map());
    if (!byCategory.get(cat).has(no)) byCategory.get(cat).set(no, str(c.code).trim());
  }
  const issues = simsIssues(models);
  const description = new Map(issues.map(i => [i.no, i.description]));
  // our diagnostics -> issue numbers (one diagnostic may give several codes, e.g. BIOS locked)
  const aliases = new Map();
  const addAlias = (text, no) => {
    const k = normDiag(text);
    if (!k) return;
    if (!aliases.has(k)) aliases.set(k, []);
    if (!aliases.get(k).includes(no)) aliases.get(k).push(no);
  };
  for (const a of models.simsAliases || []) for (const t of splitList(a.aliases)) addAlias(t, str(a.no).trim());
  // a diagnostic written exactly like a SIMS issue ("Fan defect") needs no alias
  for (const i of issues) if (!aliases.has(normDiag(i.description))) addAlias(i.description, i.no);
  const ignore = new Set((models.simsIgnore || []).flatMap(splitList).map(normDiag));
  const seeRemarks = issues.find(i => normName(i.description) === 'see remarks')?.no ?? '172';

  const types = new Map(), categories = new Map();
  for (const t of models.simsCategories || []) {
    const row = { category: str(t.category).trim(), codes: str(t.codes).trim() || str(t.category).trim() };
    if (!row.category) continue;
    if (!types.has(normName(t.type))) types.set(normName(t.type), row);
    if (!categories.has(normName(row.category))) categories.set(normName(row.category), row.codes);
  }
  return {
    description, seeRemarks, ignore,
    numbers: diag => aliases.get(normDiag(diag)) || [],
    isIgnored: diag => ignore.has(normDiag(diag)),
    // the SIMS category for one of our types ('' when there is none); a type that is already a SIMS category is kept
    category: type => types.get(normName(type))?.category ?? (byCategory.has(normName(type)) || categories.has(normName(type)) ? str(type).trim() : ''),
    // the category whose codes a SIMS category uses (Switch -> Network Switch), as its codes (number -> code) or null
    codesFor: category => byCategory.get(normName(categories.get(normName(category)) ?? category)) || null,
    codesName: category => categories.get(normName(category)) ?? str(category).trim(),
  };
}

// Our diagnostics ("Chassis damage C, Sticky kb, Liquid marks") -> SIMS codes for the category ("LPT032,LPT107,LPT172")
// and the Item Remark ("Liquid marks"): diagnostics without a code go to the remark, with the category's
// "see remarks" code. unknown: diagnostics with no SIMS issue; missing: an issue the category has no code for.
export function translateDiagnostics(diagnostics, codes, lk) {
  const out = [], remark = [], unknown = [], missing = [];
  for (const d of splitList(diagnostics)) {
    if (lk.isIgnored(d)) continue;
    const nos = lk.numbers(d);
    if (!nos.length) { unknown.push(d); remark.push(d); continue; }
    const found = nos.map(no => codes?.get(no)).filter(Boolean);
    if (!found.length) { missing.push({ diag: d, nos }); remark.push(d); continue; }
    for (const c of found) if (!out.includes(c)) out.push(c);
  }
  if (remark.length) {
    const see = codes?.get(lk.seeRemarks);
    if (see && !out.includes(see)) out.push(see);
  }
  return { codes: out.join(','), remark: [...new Set(remark)].join(','), unknown, missing };
}

// Blancco result "Pass x2, Fail" -> "Erased Erased Not Erased" (texts from the config)
export function simsErasure(blancco, cfg = DEFAULT_CONFIG) {
  const { passText, failText } = cfg.erasure;
  return splitList(blancco).flatMap(part => {
    const m = part.match(/^(.*?)(?:\s+x(\d+))?$/i);
    const word = m[1].trim().toLowerCase(), n = Number(m[2] || 1);
    const text = word.startsWith(str(passText).trim().toLowerCase()) ? cfg.texts.simsErased
      : word.includes(str(failText).trim().toLowerCase()) ? cfg.texts.simsNotErased : part;
    return Array(n).fill(text);
  }).join(' ');
}

// CPU, RAM and disk in one cell ("i7-8650U,16 GB DDR4,512 GB NVMe"), or "n/a" when there are none
export function purchaseDescription(row, cfg = DEFAULT_CONFIG) {
  const parts = [row.cpu, row.ram, row.disk].map(v => str(v).trim()).filter(v => v !== '');
  return parts.length && !parts.every(v => /^-+$/.test(v)) ? parts.join(',') : cfg.texts.simsNoSpecs;
}

/**
 * report: buildReport()'s result; project: for the SIMS edits (project.simsOverrides: { [itemCode]: { column: value } })
 * Returns { rows, warnings }: one SIMS row per report row (keys from SIMS_COLUMNS, plus itemLookup and the
 * row's _sources / _edited / _base), and the SIMS checks.
 */
export function buildSims(report, project, models, config) {
  const cfg = withDefaults(config);
  const lk = makeSimsLookups(models);
  const edits = project.simsOverrides || {};
  const warnings = [];
  const add = (check, w) => { const level = cfg.checks[check]; if (level && level !== 'off') warnings.push({ ...w, level }); };
  const noCategory = new Map(), noCodes = new Map(), unknown = new Map(), missing = new Map();
  const note = (map, key, item, extra) => { if (!map.has(key)) map.set(key, { items: [], ...extra }); map.get(key).items.push(item); };

  const rows = report.rows.map(r => {
    const code = r.itemLookup;
    const ov = edits[code] || {};
    const row = {
      itemLookup: code, item: r.item, sn: r.sn, asset: r.asset, blankG: '', imei: '',
      category: lk.category(r.type), modelLine: joinNonEmpty(',', r.make, r.model, r.screen, r.year), modelNo: '',
      blankL: '', purchase: purchaseDescription(r, cfg), diagnostics: r.diagnostics,
      grade: '', status: '', weight: r.weight, erased: simsErasure(r.blancco, cfg),
      locked: r.locked, _sources: r._sources, _edited: r._edited.filter(f => SIMS_SHARED.has(f)), _base: { ...r._base },
    };
    // SIMS-only edits replace the value; a typed category also decides which codes are used
    const apply = keys => {
      for (const k of keys) {
        if (isBlank(ov[k]) || SIMS_SHARED.has(k) || !simsEditable(k)) continue;
        row._base[k] = row[k]; row[k] = str(ov[k]); row._edited.push(k);
      }
    };
    apply(SIMS_COLUMNS.map(([k]) => k).filter(k => k !== 'codes' && k !== 'remark'));
    const codes = lk.codesFor(row.category);
    if (!isBlank(row.diagnostics)) {
      if (!row.category) note(noCategory, str(r.type).trim().toLowerCase(), code, { type: str(r.type).trim() });
      else if (!codes) note(noCodes, row.category.toLowerCase(), code, { category: row.category });
    }
    // without a category there are no codes, so nothing goes to Item Remark either (the check says why)
    if (codes) {
      const t = translateDiagnostics(row.diagnostics, codes, lk);
      row.codes = t.codes; row.remark = t.remark;
      for (const d of t.unknown) note(unknown, normDiag(d), code, { diag: d });
      for (const m of t.missing) note(missing, `${normDiag(m.diag)}|${row.category.toLowerCase()}`, code, { ...m, category: row.category });
    } else { row.codes = ''; row.remark = ''; }
    apply(['codes', 'remark']);
    return row;
  });

  const list = items => (items.length > 6 ? `${items.slice(0, 6).join(', ')} and ${items.length - 6} more` : items.join(', '));
  for (const { items, type } of noCategory.values()) {
    add('simsNoCategory', { item: items[0], items, text: `SIMS: type "${type || '(empty)'}" has no SIMS category, so no codes (${list(items)}). Add it in Dictionary › SIMS categories.` });
  }
  for (const { items, category } of noCodes.values()) {
    add('simsNoCategory', { item: items[0], items, text: `SIMS: category "${category}" isn't in the SIMS codes list (codes from "${lk.codesName(category)}"), so no codes (${list(items)}). Check Dictionary › SIMS categories.` });
  }
  for (const { items, diag } of unknown.values()) {
    add('simsNoCode', { item: items[0], items, text: `SIMS: "${diag}" has no SIMS code, so it went to Item Remark (${list(items)}). Add it in Dictionary › SIMS diagnostics.` });
  }
  for (const { items, diag, nos, category } of missing.values()) {
    const issue = nos.map(no => `${lk.description.get(no) || ''} (${no})`).join(' / ');
    add('simsNoCode', { item: items[0], items, text: `SIMS: "${diag}" is ${issue}, but ${category} has no code for it, so it went to Item Remark (${list(items)})` });
  }
  return { rows, warnings };
}

// The HDD sheet: one row per data carrier serial in "S.N. Data carrier" (several can be separated by commas,
// semicolons, spaces or new lines). _key tells the rows of one item apart.
export const HDD_COLUMNS = [['item', 'Item No'], ['serial', 'Data Carrier Serial No']];
export function hddRows(reportRows) {
  return reportRows.flatMap(r => str(r.snDataCarrier).split(/[\s,;]+/).filter(s => s !== '')
    .map((serial, i) => ({ itemLookup: r.itemLookup, item: r.item, serial, _key: `${r.itemLookup}#${i}` })));
}
