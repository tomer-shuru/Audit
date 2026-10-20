// The project setup window: project number, end client, item code prefix and first item number
import { itemCode, itemName } from '../engine/report.js';
import { state, canEditSettings } from './state.js';
import { $, esc } from './util.js';
import { changed } from './app.js';

// force: a project that isn't set up yet (the window can't be closed without saving)
// onSave: runs once the settings are saved (a new project: create its file)
// start: when the app opens (see start.js): { last: "Acme · SHR11734" or '' (no last project), note,
//   onContinue(), onOpen(), okToStartNew() }
let afterSave = null, start = null;
export function openSetup({ force = false, onSave = null, start: startWith = null } = {}) {
  afterSave = onSave; start = startWith;
  const d = $('#setupDialog');
  $('#setupStart').hidden = !start;
  d.dataset.start = start ? '1' : '';
  const cont = $('#setupContinue');
  cont.hidden = !start?.last;
  if (start?.last) cont.innerHTML = `Continue where you left off: <b>${esc(start.last)}</b>${start.note ? `<span class="setup-note">${esc(start.note)}</span>` : ''}`;
  const s = state.project.settings;
  const f = $('#setupForm');
  f.projectNumber.value = s.projectNumber; f.prefix.value = s.prefix; f.endClient.value = s.endClient; f.startNumber.value = s.startNumber ?? 1;
  // a shared project's settings are changed by the person who shared it
  const locked = !canEditSettings();
  for (const el of f.querySelectorAll('input')) el.disabled = locked;
  f.querySelector('[type=submit]').hidden = locked;
  $('#setupLocked').hidden = !locked;
  $('#setupLocked').textContent = locked ? `This is a shared project: only ${state.collab.owner} can change these.` : '';
  $('#setupCancel').textContent = locked ? 'Close' : 'Cancel';
  $('#setupCancel').hidden = force;
  d.dataset.force = force ? '1' : '';
  updatePreview();
  d.showModal();
  if (start?.last) cont.focus(); else f.projectNumber.focus();
}

// another project was opened (from the start window's Open, or File › Open): the start window isn't needed anymore
export function closeStart() {
  const d = $('#setupDialog');
  if (d.open && d.dataset.start) { start = null; afterSave = null; d.dataset.start = ''; d.close(); }
}

function updatePreview() {
  const f = $('#setupForm');
  const s = { projectNumber: f.projectNumber.value.trim(), prefix: f.prefix.value.trim().toUpperCase() };
  const n = Number(f.startNumber.value) || 0;
  $('#setupPreview').textContent = `Items: ${itemCode(s, n)}, ${itemCode(s, n + 1)}… → ${itemName({ projectNumber: s.projectNumber || '…' }, itemCode(s, n), state.config)}`;
}

export function initSetup() {
  $('#projectChip').onclick = () => openSetup();
  const f = $('#setupForm');
  f.oninput = updatePreview;
  $('#setupContinue').onclick = () => { const s = start; start = null; afterSave = null; $('#setupDialog').dataset.start = ''; $('#setupDialog').close(); s.onContinue(); };
  $('#setupOpen').onclick = () => start?.onOpen();
  f.onsubmit = e => {
    e.preventDefault();
    if (start && !start.okToStartNew()) return;
    start = null; $('#setupDialog').dataset.start = '';
    const s = state.project.settings;
    s.projectNumber = f.projectNumber.value.trim();
    s.prefix = f.prefix.value.trim().toUpperCase();
    s.endClient = f.endClient.value.trim();
    s.startNumber = Number(f.startNumber.value) || 0;
    $('#setupDialog').close();
    changed();
    const run = afterSave; afterSave = null;
    run?.();
  };
  $('#setupCancel').onclick = () => $('#setupDialog').close();
  $('#setupDialog').oncancel = e => { if ($('#setupDialog').dataset.force) e.preventDefault(); };
}
