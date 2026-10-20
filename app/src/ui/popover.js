// A small menu under a button (the column filters, Copy ▾, Download ▾). One at a time; a click elsewhere or Esc closes it.
// The table may be redrawn while it is open (a filter applies at once): the menu stays where it is.
let current = null;

export function closePopover() {
  if (!current) return;
  current.el.remove();
  current.anchor?.classList.remove('open');
  current = null;
}

// anchor: the button it opens from; html: its content; attach(el): sets up its controls;
// key: names the menu, so a second click on its button closes it even after the table was redrawn
export function openPopover(anchor, html, attach, { className = '', key = '' } = {}) {
  const again = current && (current.anchor === anchor || (key && current.key === key));
  closePopover();
  if (again) return null; // a second click on the same button closes it
  const el = document.createElement('div');
  el.className = `popover ${className}`;
  el.innerHTML = html;
  document.body.appendChild(el);
  const a = anchor.getBoundingClientRect();
  const left = Math.min(Math.max(8, a.left), window.innerWidth - el.offsetWidth - 8);
  const below = a.bottom + 4, room = window.innerHeight - below - 8;
  el.style.left = `${left}px`;
  el.style.top = `${room >= Math.min(el.offsetHeight, 240) ? below : Math.max(8, a.top - el.offsetHeight - 4)}px`;
  el.style.maxHeight = `${Math.max(240, room)}px`;
  anchor.classList.add('open');
  current = { el, anchor, key };
  attach?.(el);
  return el;
}

// (a click on the menu's own button is left to that button, which closes it)
const ownButton = t => current.anchor.contains(t) || (current.key && t.closest?.(`[data-popover="${CSS.escape(current.key)}"]`));
document.addEventListener('mousedown', e => { if (current && !current.el.contains(e.target) && !ownButton(e.target)) closePopover(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && current) { e.stopPropagation(); closePopover(); } }, true);
window.addEventListener('resize', closePopover);
