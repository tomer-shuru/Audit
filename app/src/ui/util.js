// Small DOM and text helpers used by every screen
import { copyText } from './io.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

let toastTimer;
export function toast(msg, kind = 'ok', action = null) {
  const t = $('#toast');
  const host = document.querySelector('dialog[open]') || document.body; // a modal window would cover it otherwise
  if (t.parentElement !== host) host.appendChild(t);
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}`;
  t.className = `toast show ${kind}`;
  if (action) t.querySelector('button').onclick = () => { t.className = 'toast'; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, action ? 6000 : 2600);
}

// copies text and says how it went
export async function copyAndTell(text, done) {
  const ok = await copyText(text);
  toast(ok ? done : 'Copy failed. Try again.', ok ? 'ok' : 'bad');
}

// a search box that redraws its screen: the redrawn box keeps the focus and the cursor position
export function redrawKeepingCaret(input, draw) {
  const pos = input.selectionStart;
  draw();
  const again = document.getElementById(input.id);
  again.focus(); again.setSelectionRange(pos, pos);
}

// the scroll positions of the tables in el, to put back after redrawing it
export const tableScroll = el => [...el.querySelectorAll('.table-wrap')].map(w => [w.scrollLeft, w.scrollTop]);
export const restoreTableScroll = (el, before) => el.querySelectorAll('.table-wrap').forEach((w, i) => { if (before[i]) [w.scrollLeft, w.scrollTop] = before[i]; });

// briefly highlights a table row (restarting the animation if it's still running)
export function flash(tr) {
  tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash');
}

// the browser's file picker for one file; resolves to the file, or null
export function pickFile(accept) {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.onchange = () => resolve(input.files[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// Enter moves down, Tab moves right (default), Esc cancels: for the editable cells of the Dictionary tables
export function gridKeys(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const td = e.target, tr = td.parentElement;
    const next = tr.nextElementSibling?.children[td.cellIndex];
    td.blur();
    if (next?.isContentEditable) next.focus();
  }
}

export const ago = t => {
  if (!t) return 'not yet';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

// the save status at the top: [kind, icon, text, title]
export function renderSyncState(el, [kind, icon, text, title]) {
  el.className = `save-state sync ${kind}`;
  el.innerHTML = `${icon}<span>${esc(text)}</span>`;
  el.title = title;
}

// a box files can be dropped on: highlighted while files are dragged over it (also over its own contents)
export function dropZone(el, onFiles) {
  el.ondragover = e => { e.preventDefault(); el.classList.add('dragging'); };
  el.ondragleave = e => { if (!el.contains(e.relatedTarget)) el.classList.remove('dragging'); };
  el.ondrop = e => { e.preventDefault(); el.classList.remove('dragging'); onFiles([...e.dataTransfer.files]); };
}
