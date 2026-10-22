// The SIMS output: the Audit Report rows laid out like the SIMS "Item per service project" sheet
// (columns D to T of their template), with our diagnostics turned into SIMS diagnostic codes.
// The Dictionary holds the SIMS lists: simsCodes (category, code, description), simsAliases (our diagnostics
// per SIMS issue number), simsIgnore (diagnostics left out) and simsCategories (our type -> SIMS category).
import { str, low, isBlank, joinNonEmpty, escapeRegExp, commaParts, wordMatcher, isLockedOrFaulty } from './rules.js';
import { DEFAULT_CONFIG, withDefaults, warnAdder } from './config.js';
import { itemKey, resultPassed, resultFailed } from './sources.js';

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

// The SIMS "Locked devices request" (their own workbook, tab "2. Locked devices request", columns B to H):
// one row per lock of a device that is locked now, columns C (Lock Type) to H. Model No. is the SIMS Model column as
// shown; Project No. (B) is already in their file and stays as it is; Password is for them to fill in.
export const LOCK_REQUEST_COLUMNS = [
  ['lockType', 'Lock Type'], ['asset', 'Client asset tag'], ['sn', 'Serial No.'],
  ['imei', 'IMEI No. (for mobile devices)'], ['modelNo', 'Model No.:'], ['password', 'Password'],
];

// their Lock Type drop-down list (the hidden Data tab of the workbook)
export const SIMS_LOCK_TYPE_LIST = [
  'Apple DEP', 'Apple Find My', 'Apple Firmware Password', 'Apple MDM (Mobile Device Management)', 'Apple Startup Security',
  'Asset Tags', 'Bios Password', 'Chrome OS Enterprise', 'Computrace', 'Dell iDRAC', 'HP iLO', 'IBM IMM', 'Microsoft SEMM',
  'Windows Autopilot/Azure',
];

// config simsLockTypes -> lockTypes(locked, make): the Lock Types of a Locked or Faulty text (each part takes the
// first row that matches it and is for its make; each type once) and the parts that say "lock" but got none
const saysLock = wordMatcher(['lock', 'locked']);
function lockTyper(cfg) {
  const rules = cfg.simsLockTypes.map(r => ({ make: low(r.make), type: str(r.type).trim(), matches: wordMatcher(commaParts(r.words)) }));
  return (locked, make) => {
    const types = [], unknown = [];
    for (const part of commaParts(locked)) {
      const rule = rules.find(r => (!r.make || r.make === low(make)) && r.matches(part));
      if (rule && !types.includes(rule.type)) types.push(rule.type);
      else if (!rule && saysLock(part)) unknown.push(part);
    }
    return { types, unknown };
  };
}

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
  // "*" stands for any word(s): "Key * defect" covers "Key P defect", "Key Capslock defect"…
  const aliases = new Map(), patterns = [];
  const addAlias = (text, no) => {
    const k = normDiag(text);
    if (!k) return;
    let nos;
    if (k.includes('*')) {
      let p = patterns.find(x => x.text === k);
      if (!p) {
        p = { text: k, re: new RegExp(`^${k.split('*').map(escapeRegExp).join('.+')}$`), nos: [] };
        patterns.push(p);
      }
      nos = p.nos;
    } else {
      if (!aliases.has(k)) aliases.set(k, []);
      nos = aliases.get(k);
    }
    if (!nos.includes(no)) nos.push(no);
  };
  // exact spellings first, then the ones with "*"
  const numbersOf = diag => {
    const k = normDiag(diag);
    return aliases.get(k) || [...new Set(patterns.filter(p => p.re.test(k)).flatMap(p => p.nos))];
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
    numbers: numbersOf,
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
  const text = (word, part) => {
    if (resultPassed(word, cfg.erasure)) return cfg.texts.simsErased;
    if (resultFailed(word, cfg.erasure)) return cfg.texts.simsNotErased;
    return part;
  };
  return splitList(blancco).flatMap(part => {
    const [, word, n] = part.match(/^(.*?)(?:\s+x(\d+))?$/i);
    return Array(Number(n || 1)).fill(text(word, part));
  }).join(' ');
}

// CPU, RAM and disk in one cell ("i7-8650U,16 GB DDR4,512 GB NVMe"), or "n/a" when there are none
export function purchaseDescription(row, cfg = DEFAULT_CONFIG) {
  const parts = [row.cpu, row.ram, row.disk].map(v => str(v).trim()).filter(v => v !== '');
  return parts.length && !parts.every(v => /^-+$/.test(v)) ? parts.join(',') : cfg.texts.simsNoSpecs;
}

/**
 * report: buildReport()'s result; project: for the SIMS edits (project.simsOverrides: { [itemCode]: { column: value } })
 * sheet: rows already in the SIMS sheet (Data tab), { [itemCode]: { SIMS column key: value } }: a SIMS column
 * the app has nothing for is taken from there (the shared columns already came through buildReport).
 * Returns { rows, warnings }: one SIMS row per report row (keys from SIMS_COLUMNS, plus itemLookup and the
 * row's _sources / _edited / _base / _fromSheet), and the SIMS checks.
 */
export function buildSims(report, project, models, config, sheet = null) {
  const cfg = withDefaults(config);
  const lk = makeSimsLookups(models);
  const edits = project.simsOverrides || {};
  const warnings = [];
  const add = warnAdder(cfg, warnings);
  const noCategory = new Map(), noCodes = new Map(), unknown = new Map(), missing = new Map();
  const note = (map, key, item, extra) => { if (!map.has(key)) map.set(key, { items: [], ...extra }); map.get(key).items.push(item); };
  const sheetBy = new Map(Object.entries(sheet || {}).map(([c, rec]) => [itemKey(c), rec]));

  const rows = report.rows.map(r => {
    const code = r.itemLookup;
    const ov = edits[code] || {};
    const sh = sheetBy.get(itemKey(code));
    // a SIMS column the app has nothing for comes from the SIMS sheet rows
    const fromSheet = r._fromSheet.filter(f => SIMS_SHARED.has(f));
    const orSheet = (k, v, empty = isBlank(v)) => {
      if (!empty || !sh || isBlank(sh[k])) return v;
      fromSheet.push(k);
      return str(sh[k]).trim();
    };
    const purchase = purchaseDescription(r, cfg);
    const row = {
      itemLookup: code, item: r.item, sn: r.sn, asset: r.asset, blankG: orSheet('blankG', ''), imei: orSheet('imei', ''),
      category: orSheet('category', lk.category(r.type)), modelLine: orSheet('modelLine', joinNonEmpty(',', r.make, r.model, r.screen, r.year)),
      modelNo: orSheet('modelNo', ''), blankL: orSheet('blankL', ''),
      purchase: orSheet('purchase', purchase, purchase === cfg.texts.simsNoSpecs), diagnostics: r.diagnostics,
      grade: orSheet('grade', ''), status: orSheet('status', ''), weight: r.weight, erased: orSheet('erased', simsErasure(r.blancco, cfg)),
      locked: r.locked, _sources: r._sources, _edited: r._edited.filter(f => SIMS_SHARED.has(f)), _base: { ...r._base }, _fromSheet: fromSheet,
    };
    // SIMS-only edits replace the value; a typed category also decides which codes are used
    const apply = keys => {
      for (const k of keys) {
        if (isBlank(ov[k]) || SIMS_SHARED.has(k) || !simsEditable(k)) continue;
        row._base[k] = row[k]; row[k] = str(ov[k]); row._edited.push(k);
        row._fromSheet = row._fromSheet.filter(x => x !== k);
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
    // no codes from the diagnostics: the sheet's codes and Item Remark, if it has them
    if (isBlank(row.codes) && sh && !isBlank(sh.codes)) {
      row.codes = str(sh.codes).trim(); row.remark = str(sh.remark).trim();
      row._fromSheet.push('codes', ...(row.remark ? ['remark'] : []));
    }
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
  // the Locked devices request: a row per lock of each device; a lock with no Lock Type gets a note
  const lockRequest = [], noType = new Map(), lockTypes = lockTyper(cfg);
  const makeOf = new Map(report.rows.map(x => [x.itemLookup, x.make])); // the SIMS row has the make only inside Model
  for (const row of rows) {
    if (!isLockedOrFaulty(row.locked)) continue;
    const { types, unknown } = lockTypes(row.locked, makeOf.get(row.itemLookup));
    types.forEach((lockType, i) => lockRequest.push({
      itemLookup: row.itemLookup, _key: `${row.itemLookup}#${i}`, lockType,
      asset: row.asset, sn: row.sn, imei: row.imei, modelNo: row.modelLine, password: '',
    }));
    for (const u of unknown) note(noType, normDiag(u), row.itemLookup, { text: u });
  }
  for (const { items, text } of noType.values()) {
    add('simsNoLockType', { item: items[0], items, text: `SIMS: "${text}" has no Lock Type, so it isn't on the Locked devices request (${list(items)}). Add it in DevMode › Locked and Faulty › SIMS Lock Types.` });
  }
  return { rows, warnings, lockRequest };
}

// The HDD sheet: one row per data carrier serial in "S.N. Data carrier" (several can be separated by commas,
// semicolons, spaces or new lines). _key tells the rows of one item apart.
export const HDD_COLUMNS = [['item', 'Item No'], ['serial', 'Data Carrier Serial No']];
export function hddRows(reportRows) {
  return reportRows.flatMap(r => str(r.snDataCarrier).split(/[\s,;]+/).filter(s => s !== '')
    .map((serial, i) => ({ itemLookup: r.itemLookup, item: r.item, serial, _key: `${r.itemLookup}#${i}` })));
}
