// The menu bar (File, Settings, Tools), the light / dark button, and the keyboard shortcuts
import { state, load, store, TABS, STORE_THEME } from './state.js';
import { $ } from './util.js';
import { ICONS } from './icons.js';
import { setTab } from './app.js';
import { saveProject } from './project.js';
import { biosFile } from './bios-tab.js';

// Click a menu to open it; while one is open, moving over another opens that one (like Windows).
// Esc or a click elsewhere closes it; arrow keys move through the items.
export function initMenus() {
  const menus = [...document.querySelectorAll('#menubar .menu')];
  let open = null;
  const show = m => {
    for (const x of menus) {
      x.classList.toggle('open', x === m);
      x.querySelector('.menu-btn').setAttribute('aria-expanded', String(x === m));
    }
    open = m;
  };
  for (const m of menus) {
    const btn = m.querySelector('.menu-btn');
    btn.onclick = () => show(open === m ? null : m);
    btn.onmouseenter = () => { if (open && open !== m) show(m); };
    // an item's own click handler runs, then the menu closes
    m.querySelector('.menu-list').addEventListener('click', e => { if (e.target.closest('button')) show(null); });
    m.addEventListener('keydown', e => {
      const items = [...m.querySelectorAll('.menu-list button:not([hidden])')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); if (open !== m) show(m); items[(i + 1) % items.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (open !== m) show(m); items[(i - 1 + items.length) % items.length]?.focus(); }
      else if (e.key === 'Escape' && open) { show(null); btn.focus(); }
    });
  }
  document.addEventListener('mousedown', e => { if (open && !e.target.closest('#menubar .menu')) show(null); });
}

// light / dark: the system's until the button is used, then the one picked
function applyTheme(theme) {
  const t = theme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  const b = $('#btnTheme');
  b.innerHTML = t === 'dark' ? ICONS.sun : ICONS.moon;
  b.title = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}
export function initTheme() {
  applyTheme(load(STORE_THEME, null));
  $('#btnTheme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    store(STORE_THEME, next); applyTheme(next);
  };
}

// Ctrl+S / Ctrl+Shift+S: Save / Save as. Alt+1 … Alt+4: the tabs (the number keys above the letters;
// Alt + the number pad types characters in Windows)
export function initShortcuts() {
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); document.activeElement?.blur?.(); saveProject({ saveAs: e.shiftKey }); }
    const n = /^Digit([1-9])$/.exec(e.code)?.[1];
    if (n && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !document.querySelector('dialog[open]')) {
      const tab = TABS[n - 1];
      if (!tab || (tab === 'bios' && !biosFile())) return;
      e.preventDefault();
      document.activeElement?.blur?.(); // a cell being typed in is kept first
      if (tab !== state.tab) setTab(tab);
    }
  });
}
