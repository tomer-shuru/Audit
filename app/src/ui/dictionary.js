// Settings › Dictionary: the lists the report is built with (models, make names, types, weights, codes, SIMS lists).
// Saving them (on this computer and to the shared models.json) is in folder.js.
import { simsIssues, splitList, normDiag } from '../engine/sims.js';
import { downloadJson, readJsonFile } from './io.js';
import { state, withNewLists } from './state.js';
import { $, esc, plural, toast, gridKeys, redrawKeepingCaret, flash } from './util.js';
import { render } from './app.js';
import { shared, isModelsData, loadSharedModels, saveModels, renderShared } from './folder.js';

const MODEL_TABS = {
  models: { label: 'Models', key: 'models', hint: 'Mac model IDs (e.g. MacBookPro18,3) and Windows model names, with the details used in the report.',
    cols: [['id', 'Model ID'], ['name', 'Model name'], ['type', 'Type'], ['year', 'Year'], ['screen', 'Screen'], ['weight', 'Weight']] },
  makeMap: { label: 'Make names', key: 'makeMap', hint: 'Turns the make reported by the tools into the name shown in the report, e.g. "Dell Inc." to "Dell". Not case-sensitive.',
    cols: [['from', 'Reported make'], ['to', 'Report make']], unique: 'from' },
  typeMap: { label: 'Type mapping', key: 'typeMap', hint: 'Turns the chassis type reported by the tools (Blancco / Windows) into the type shown in the report.',
    cols: [['blanccoType', 'Reported type'], ['type', 'Report type']] },
  typeWeights: { label: 'Weights', key: 'typeWeights', hint: 'Weight (kg) written in the report for each device type.',
    cols: [['type', 'Type'], ['weight', 'Weight']] },
  cleanupRules: { label: 'Model cleanup', key: 'cleanupRules', hint: 'Text removed from model names (Windows reports and Blancco), top to bottom. Models in the Models list use their name from there instead. Put longer phrases above shorter ones (e.g. "Mobile Workstation PC" before "Mobile Workstation"). Case-sensitive: "HP" doesn’t remove "Hp".',
    cols: [['_', 'Remove this text']] },
  diagCodes: { label: 'Diagnostic codes', key: 'diagCodes', hint: 'Type a code (e.g. LM) in any diagnostics field and the report shows the description instead. Case-sensitive.',
    cols: [['code', 'Code'], ['description', 'Description']], unique: 'code' },
  // used only when a project's output is SIMS
  simsDiag: { label: 'SIMS diagnostics', key: 'simsAliases', custom: nav => renderSimsDiag(nav), count: () => state.models.simsAliases.filter(a => String(a.aliases ?? '').trim()).length,
    hint: 'Our diagnostics, as they come out in the report, next to the SIMS issue they mean. Every device gets the code of its category: Notebook LPT107, PC BSU107 … Capitals, extra spaces and dashes don\'t matter; * stands for any word(s), e.g. Key * defect. A diagnostic on two issues gets both codes (BIOS locked: password protected + no audit). Diagnostics written exactly like a SIMS issue (e.g. Fan defect) work without being listed. Diagnostics with no code go to Item Remark, with the category\'s "see remarks" code.' },
  simsCodes: { label: 'SIMS codes', key: 'simsCodes', hint: 'The SIMS diagnostic codes per category (from their template). A code ends in the issue number, which means the same in every category (LPT107 and BSU107 are both keyboard defect). Also written to the Diagnostic codes tab of the SIMS file.',
    cols: [['category', 'Category'], ['code', 'Code'], ['description', 'Description']], unique: 'code', filters: { category: 'category' }, noMove: true },
  simsCategories: { label: 'SIMS categories', key: 'simsCategories', hint: 'Turns our device type into the SIMS Category column. "Codes from" is the category in SIMS codes whose codes the device gets, when it isn\'t the same (Switch uses Network Switch codes, loose disks use Data Carrier codes). Not case-sensitive.',
    cols: [['type', 'Our type'], ['category', 'SIMS category'], ['codes', 'Codes from']], unique: 'type', uniqueText: 'Each type can only be used once.', banner: () => simsCategoriesBanner() },
};

// SIMS categories: rows whose codes aren't in the SIMS codes list, and our types (from Weights) with no SIMS category
function simsCategoriesBanner() {
  const m = state.models, norm = v => String(v ?? '').trim().toLowerCase();
  const codeCats = new Set(m.simsCodes.map(c => norm(c.category)));
  const bad = m.simsCategories.filter(c => norm(c.category) && !codeCats.has(norm(c.codes || c.category))).map(c => c.codes || c.category);
  const types = new Set(m.simsCategories.map(c => norm(c.type)));
  const missing = m.typeWeights.map(t => String(t.type ?? '').trim()).filter(t => t && !types.has(norm(t)) && !codeCats.has(norm(t)));
  return `${bad.length ? `<div class="banner bad">Not a category in SIMS codes: <b>${esc([...new Set(bad)].join(', '))}</b>. Those devices get no codes.</div>` : ''}
    ${missing.length ? `<div class="banner bad">Types in Weights with no SIMS category: <b>${esc(missing.join(', '))}</b>.</div>` : ''}`;
}

export function renderModels() {
  const t = MODEL_TABS[state.modelsTab];
  const nav = `<nav class="subtabs">${Object.entries(MODEL_TABS).map(([id, x]) => `${id === 'simsDiag' ? '<span class="subtab-sep">SIMS output:</span>' : ''}<button data-mt="${id}" class="${id === state.modelsTab ? 'active' : ''}">${x.label} <span class="muted">${x.count ? x.count() : state.models[x.key].length}</span></button>`).join('')}</nav>
    <p class="hint">${esc(t.hint)}</p>`;
  if (t.custom) t.custom(nav); else renderModelList(t, nav);
  document.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { state.modelsTab = b.dataset.mt; renderModels(); });
}

// filters above the big lists (SIMS codes, SIMS diagnostics): text search and a category
const modelsFilter = id => (state.modelsFilter[id] ??= { q: '', category: '', mapped: false });
function filterBar(id, { categories, mapped, shown, total }) {
  const f = modelsFilter(id);
  return `<div class="pick-bar filter-bar">
    <input type="search" id="modelsSearch" placeholder="Search…" value="${esc(f.q)}">
    ${categories ? `<select id="modelsCategory"><option value="">All categories</option>${categories.map(c => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
    ${mapped ? `<label class="check"><input type="checkbox" id="modelsMapped" ${f.mapped ? 'checked' : ''}> ${esc(mapped)}</label>` : ''}
    <span class="muted">${shown === total ? plural(total, 'row') : `${shown} of ${plural(total, 'row')} shown`}</span>
  </div>`;
}
function attachFilterBar(id) {
  const f = modelsFilter(id);
  let timer;
  $('#modelsSearch').oninput = e => {
    f.q = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => redrawKeepingCaret(e.target, renderModels), 150);
  };
  const cat = $('#modelsCategory');
  if (cat) cat.onchange = e => { f.category = e.target.value; renderModels(); };
  const mapped = $('#modelsMapped');
  if (mapped) mapped.onchange = e => { f.mapped = e.target.checked; renderModels(); };
}

function renderModelList(t, nav) {
  const list = state.models[t.key];
  const val = (item, k) => (k === '_' ? item : item[k]);
  // tabs with a unique column (diagnostic codes): find values used more than once
  const keyOf = item => String(val(item, t.unique) ?? '').trim().toLowerCase();
  const counts = new Map();
  if (t.unique) for (const item of list) { const k = keyOf(item); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
  const isDup = item => t.unique && (counts.get(keyOf(item)) || 0) > 1;
  const dups = [...new Set(list.filter(isDup).map(item => String(val(item, t.unique)).trim()))];

  // filtered tabs show only the matching rows (each keeps its place in the list, data-i)
  const f = t.filters ? modelsFilter(state.modelsTab) : null;
  const q = f?.q.trim().toLowerCase() || '';
  const rows = list.map((item, i) => [item, i]).filter(([item]) => !f
    || ((!f.category || String(item[t.filters.category] ?? '').trim() === f.category)
    && (!q || t.cols.some(([k]) => String(val(item, k) ?? '').toLowerCase().includes(q)))));
  const filtering = f && (q || f.category);
  const categories = t.filters?.category ? [...new Set(list.map(x => String(x[t.filters.category] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)) : null;

  $('#modelsBody').innerHTML = `${nav}
    ${t.banner ? t.banner() : ''}
    ${dups.length ? `<div class="banner bad">Used more than once: <b>${esc(dups.join(', '))}</b>. Only the first one counts. Remove or rename the extra rows (highlighted).</div>` : ''}
    ${f ? filterBar(state.modelsTab, { categories, shown: rows.length, total: list.length }) : ''}
    <div class="table-wrap tall"><table class="grid">
      <thead><tr><th>#</th>${t.cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows.map(([item, i]) => `<tr data-i="${i}" class="${isDup(item) ? 'issue-error' : ''}"><th>${i + 1}</th>${t.cols.map(([k]) => `<td contenteditable="plaintext-only" data-k="${k}">${esc(val(item, k))}</td>`).join('')}
        <td class="row-tools">${t.noMove || filtering ? '' : `<button class="icon-btn" data-up="${i}" title="Move up">↑</button>`}<button class="icon-btn" data-rm="${i}" title="Remove">✕</button></td></tr>`).join('')}
      </tbody></table></div>
    <button class="btn" id="modelsAdd">Add row</button>`;

  if (f) attachFilterBar(state.modelsTab);
  document.querySelectorAll('#modelsBody td[data-k]').forEach(td => {
    td.onblur = () => {
      const i = Number(td.parentElement.dataset.i), k = td.dataset.k, v = td.textContent.trim();
      if (k === t.unique && v !== '') {
        const other = list.findIndex((item, j) => j !== i && keyOf(item) === v.toLowerCase());
        if (other >= 0) {
          // not allowed: put the old value back and point at the existing row
          td.textContent = val(list[i], k) ?? '';
          toast(`${val(list[other], k)} already exists (row ${other + 1}). ${t.uniqueText || 'Each code can only be used once.'}`, 'bad');
          const tr = document.querySelector(`#modelsBody tr[data-i="${other}"]`);
          if (tr) { tr.scrollIntoView({ block: 'nearest' }); flash(tr); }
          return;
        }
      }
      const num = /^(year|screen|weight)$/.test(k) && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
      const before = val(list[i], k);
      if (before === num || (before ?? '') === v) return;
      if (k === '_') list[i] = v; else list[i][k] = num;
      saveModels();
      if ((k === t.unique && before !== v) || t.banner) renderModels(); // refresh duplicate highlighting / warnings
    };
    td.onkeydown = gridKeys;
  });
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { list.splice(Number(b.dataset.rm), 1); saveModels(); renderModels(); });
  document.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.up); if (i < 1) return;
    [list[i - 1], list[i]] = [list[i], list[i - 1]]; saveModels(); renderModels();
  });
  $('#modelsAdd').onclick = () => {
    const row = t.key === 'cleanupRules' ? '' : Object.fromEntries(t.cols.map(([k]) => [k, '']));
    // a new SIMS code starts in the category being looked at
    if (f) { if (f.category) row[t.filters.category] = f.category; f.q = ''; }
    list.push(row);
    saveModels(); renderModels();
    const cells = document.querySelectorAll('#modelsBody tbody tr:last-child td[data-k]');
    const cell = [...cells].find(c => !c.textContent) || cells[0];
    cell?.scrollIntoView({ block: 'nearest' }); cell?.focus();
  };
}

// SIMS diagnostics: one row per SIMS issue (from the SIMS codes), with our diagnostics that mean it.
// The first row lists diagnostics that are left out of the SIMS output altogether (e.g. Ok).
function renderSimsDiag(nav) {
  const m = state.models;
  const issues = simsIssues(m);
  const known = new Set(issues.map(i => i.no));
  const aliasOf = new Map(m.simsAliases.map(a => [String(a.no).trim(), String(a.aliases ?? '')]));
  // our diagnostics on an issue number the SIMS codes don't have (any more)
  const orphans = [...aliasOf].filter(([no, a]) => !known.has(no) && a.trim()).map(([no, aliases]) => ({ no, description: '(not in SIMS codes)', categories: [], aliases, orphan: true }));
  const all = [
    { no: '', description: 'Leave out: no code and nothing in Item Remark', categories: [], aliases: m.simsIgnore.join(', '), ignore: true },
    ...issues.map(i => ({ ...i, aliases: aliasOf.get(i.no) || '' })), ...orphans,
  ];
  const f = modelsFilter('simsDiag');
  const q = f.q.trim().toLowerCase();
  const rows = all.filter(r => r.ignore || ((!f.mapped || r.aliases.trim()) && (!q || [r.no, r.description, r.aliases].some(v => v.toLowerCase().includes(q)))));
  // a diagnostic that is left out but also written on an issue
  const ignored = new Set(m.simsIgnore.flatMap(splitList).map(normDiag));
  const clash = [...new Set(m.simsAliases.flatMap(a => splitList(a.aliases)).filter(d => ignored.has(normDiag(d))))];
  const mappedCount = issues.filter(i => (aliasOf.get(i.no) || '').trim()).length;
  const categories = r => (r.ignore ? '' : r.categories.length === 1 ? esc(r.categories[0]) : r.categories.length ? `${r.categories.length} categories` : '');

  $('#modelsBody').innerHTML = `${nav}
    ${clash.length ? `<div class="banner bad">Written under "Leave out" and on an issue as well: <b>${esc(clash.join(', '))}</b>. "Leave out" wins; remove one of them.</div>` : ''}
    ${orphans.length ? `<div class="banner bad">Our diagnostics on issue numbers that aren't in SIMS codes: <b>${esc(orphans.map(o => o.no).join(', '))}</b>. They give no code; move them to an issue that exists.</div>` : ''}
    ${filterBar('simsDiag', { mapped: 'Only issues with our diagnostics', shown: rows.length - 1, total: all.length - 1 })}
    <div class="table-wrap tall"><table class="grid sims-diag">
      <thead><tr><th>No.</th><th>SIMS issue</th><th>Our diagnostics <span class="muted">(separate with commas)</span></th><th>Categories</th></tr></thead>
      <tbody>${rows.map(r => `<tr data-no="${esc(r.no)}" class="${r.ignore ? 'ignore-row' : r.orphan ? 'issue-error' : ''}">
        <th>${r.ignore ? '—' : esc(r.no)}</th><td class="${r.ignore ? '' : 'muted-cell'}">${esc(r.description)}</td>
        <td contenteditable="plaintext-only" data-aliases>${esc(r.aliases)}</td>
        <td class="muted-cell" title="${esc(r.categories.join(', '))}">${categories(r)}</td></tr>`).join('')}
      </tbody></table></div>
    <p class="hint">${plural(mappedCount, 'issue')} with our diagnostics. To add a new SIMS code or category, use the SIMS codes tab.</p>`;

  attachFilterBar('simsDiag');
  document.querySelectorAll('#modelsBody td[data-aliases]').forEach(td => {
    td.onblur = () => {
      const no = td.parentElement.dataset.no, list = splitList(td.textContent);
      if (no === '') {
        if (list.join(', ') === m.simsIgnore.join(', ')) return;
        m.simsIgnore = list;
      } else {
        const text = list.join(', ');
        const i = m.simsAliases.findIndex(a => String(a.no).trim() === no);
        if ((i >= 0 ? String(m.simsAliases[i].aliases ?? '') : '') === text) return;
        if (i >= 0 && text) m.simsAliases[i].aliases = text;
        else if (i >= 0) m.simsAliases.splice(i, 1);
        else if (text) m.simsAliases.push({ no, aliases: text });
      }
      td.textContent = list.join(', ');
      saveModels();
      renderModels();
    };
    td.onkeydown = gridKeys;
  });
}

// the Dictionary window's buttons
export function initDictionary() {
  $('#btnModels').onclick = async () => {
    renderModels(); renderShared(); $('#modelsDialog').showModal();
    if (shared.status === 'ok') await loadSharedModels(); // pick up coworkers' latest changes first
  };
  $('#modelsClose').onclick = () => { $('#modelsDialog').close(); render(); };
  $('#modelsExport').onclick = () => downloadJson(state.models, 'models.json');
  $('#modelsImport').onclick = () => $('#modelsFile').click();
  const sharedNote = () => (shared.status === 'ok' ? ' This also changes the shared list for everyone.' : '');
  $('#modelsFile').onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      const m = await readJsonFile(file);
      if (!isModelsData(m)) throw new Error('not a Dictionary file');
      if (!confirm(`Replace the Dictionary with ${file.name}?${sharedNote()}`)) return;
      state.models = withNewLists(m); renderModels(); await saveModels(); toast('Dictionary imported');
    } catch (err) { toast(`Couldn't import: ${err.message}`, 'bad'); }
  };
}
