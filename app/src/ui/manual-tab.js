// Manual entries tab: devices the tools can't read, typed in by hand
import { MANUAL_FIELDS, itemCode } from '../engine/report.js';
import { itemKey } from '../engine/sources.js';
import { state, recordEdit } from './state.js';
import { $, esc, plural, toast } from './util.js';
import { grid } from './grid.js';
import { changed, render, undoEdit, redoEdit } from './app.js';

const sortedCodes = man => Object.keys(man).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

// suggest the code after the highest one used so far (GG01 for an empty project)
function nextFreeNumber() {
  const p = state.project.settings;
  const prefix = itemKey(p.prefix);
  let max = 0;
  for (const code of [...Object.keys(state.project.manual), ...state.report.rows.map(r => r.itemLookup)]) {
    const k = itemKey(code);
    if (k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length))) max = Math.max(max, Number(k.slice(prefix.length)));
  }
  const start = Number(p.startNumber);
  return Math.max(max + 1, Number.isInteger(start) && start >= 0 ? start : 1);
}

export function renderManual(main) {
  const man = state.project.manual;
  const codes = sortedCodes(man);
  const sel = state.manualSelected;
  for (const c of [...sel]) if (!(c in man)) sel.delete(c);
  const allSelected = codes.length > 0 && codes.every(c => sel.has(c));
  const prefix = esc(state.project.settings.prefix);

  main.innerHTML = `
  <section class="card">
    <div class="card-head">
      <div><h2>Manual entries</h2>
      <p class="hint">For devices the tools can't read (dead, locked, no report). Anything typed here takes priority over the tools' data;
      Diagnostics and Locked/Faulty are added to what the tools found.</p></div>
      <div class="actions">
        ${sel.size ? `<button class="btn danger" id="delSelected">Delete ${plural(sel.size, 'selected item')}</button>` : ''}
        <span class="range-add" title="Add a manual entry for this item number">
          <span class="prefix">${prefix}</span><input id="newCode" type="number" min="0" value="${nextFreeNumber()}" aria-label="Item number">
          <button class="btn primary" id="addManual">Add item</button>
        </span>
        <span class="range-add" title="Add a manual entry for every item number in the range">
          <span class="muted">or items</span>
          <span class="prefix">${prefix}</span><input id="rangeFrom" type="number" min="0" value="${nextFreeNumber()}" aria-label="First item number">
          <span class="muted">to</span>
          <span class="prefix">${prefix}</span><input id="rangeTo" type="number" min="0" aria-label="Last item number">
          <button class="btn" id="addRange">Add range</button>
        </span>
      </div>
    </div>
    ${codes.length ? `
    <div class="table-wrap">
      <table class="grid manual">
        <thead><tr><th class="sticky item-col" data-hc="0"><label class="row-pick"><input type="checkbox" id="selAll" ${allSelected ? 'checked' : ''} title="Select all"></label>Item</th>${MANUAL_FIELDS.map(([, l], j) => `<th data-hc="${j + 1}">${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${codes.map((code, i) => `
          <tr data-code="${esc(code)}" class="${sel.has(code) ? 'selected' : ''}">
            <th class="sticky item-col" data-r="${i}" data-c="0">
              <label class="row-pick"><input type="checkbox" data-sel="${esc(code)}" ${sel.has(code) ? 'checked' : ''} title="Select ${esc(code)}"></label>
              <button class="icon-btn" data-del="${esc(code)}" title="Delete ${esc(code)}">✕</button>
              ${esc(code)}
            </th>
            ${MANUAL_FIELDS.map(([f], j) => `<td data-r="${i}" data-c="${j + 1}">${esc(man[code][f] ?? '')}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<p class="empty">No manual entries yet. Add an item for every device you have to fill in by hand.</p>'}
  </section>`;

  // deleting is instant; the toast offers Undo
  const remove = list => {
    recordEdit();
    const removed = list.map(c => [c, man[c]]);
    for (const c of list) { delete man[c]; sel.delete(c); }
    changed();
    toast(list.length === 1 ? `Deleted ${list[0]}` : `Deleted ${plural(list.length, 'item')}`, 'ok', {
      label: 'Undo',
      run: () => { for (const [c, rec] of removed) man[c] = rec; changed(); },
    });
  };
  const delSel = $('#delSelected');
  if (delSel) delSel.onclick = () => remove(codes.filter(c => sel.has(c)));
  const selAll = $('#selAll');
  if (selAll) selAll.onchange = e => { if (e.target.checked) codes.forEach(c => sel.add(c)); else sel.clear(); render(); };
  main.querySelectorAll('[data-sel]').forEach(cb => cb.onchange = e => {
    const c = cb.dataset.sel;
    if (e.target.checked) sel.add(c); else sel.delete(c);
    render();
  });
  main.querySelectorAll('[data-del]').forEach(b => b.onclick = () => remove([b.dataset.del]));

  // after adding: select the (first) new item's first cell, ready to type
  const selectNew = code => grid('manual').select(sortedCodes(man).indexOf(code), 1, { focus: true });

  $('#addManual').onclick = () => {
    const n = Number($('#newCode').value);
    if ($('#newCode').value === '' || !Number.isInteger(n) || n < 0) { toast('Enter the item number, e.g. 12', 'bad'); return; }
    const code = itemCode(state.project.settings, n);
    if (Object.keys(man).some(c => itemKey(c) === itemKey(code))) { toast(`${code} already has a manual entry`, 'bad'); return; }
    recordEdit();
    man[code] = {};
    changed();
    selectNew(code);
  };
  $('#newCode').onkeydown = e => { if (e.key === 'Enter') $('#addManual').click(); };

  // add every item number from .. to (items that already have a manual entry are skipped)
  $('#addRange').onclick = () => {
    const from = Number($('#rangeFrom').value), to = Number($('#rangeTo').value || $('#rangeFrom').value);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) { toast('Enter the first and last item number, e.g. 10 to 20', 'bad'); return; }
    if (to - from >= 500) { toast('That\'s more than 500 items. Add a smaller range.', 'bad'); return; }
    const have = new Set(Object.keys(man).map(itemKey));
    const add = [];
    for (let n = from; n <= to; n++) { const code = itemCode(state.project.settings, n); if (!have.has(itemKey(code))) add.push(code); }
    const skipped = to - from + 1 - add.length;
    if (!add.length) { toast('All of these already have a manual entry', 'bad'); return; }
    recordEdit();
    for (const code of add) man[code] = {};
    changed();
    selectNew(add[0]);
    toast(`Added ${add.length === 1 ? add[0] : `${plural(add.length, 'item')} (${add[0]}–${add[add.length - 1]})`}${skipped ? `, ${skipped} already there` : ''}`);
  };
  for (const id of ['#rangeFrom', '#rangeTo']) $(id).onkeydown = e => { if (e.key === 'Enter') $('#addRange').click(); };

  const table = main.querySelector('table.manual');
  if (table) grid('manual').attach(table, {
    rows: codes.length, cols: MANUAL_FIELDS.length + 1,
    value: (r, c) => (c === 0 ? codes[r] : man[codes[r]][MANUAL_FIELDS[c - 1][0]] ?? ''),
    editable: (r, c) => c > 0,
    commit: changes => {
      recordEdit();
      for (const { r, c, value } of changes) {
        const rec = man[codes[r]], f = MANUAL_FIELDS[c - 1][0];
        if (value) rec[f] = value; else delete rec[f];
      }
      changed();
    },
    undo: undoEdit, redo: redoEdit,
  });
}
