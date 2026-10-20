// SVG icons: the save status at the top (like Google Sheets), the shared-project chip and the light / dark button
const svg = (attrs, paths) => `<svg ${attrs}viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ${paths}</svg>`;
const cloud = '<path d="M7 18h10.5a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 7 18z"/>';
const round = 'stroke-linecap="round" stroke-linejoin="round">';

export const ICONS = {
  sync: svg('class="spin" ', 'stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>'),
  done: svg('', `${round}${cloud}<path d="M9.5 13.5l2 2 3.5-3.5"/>`),
  error: svg('', `${round}${cloud}<path d="M12 10v3M12 15.5v.01"/>`),
  off: svg('', `${round}${cloud}<path d="M4 4l16 16"/>`),
  people: svg('', `${round}<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>`),
  sun: svg('', 'stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('', 'stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  // the column filter button: an arrow, or a funnel once the column is filtered
  menu: svg('', `${round}<path d="M7 10l5 5 5-5"/>`),
  filter: svg('', `${round}<path d="M3 5h18l-7 8v6l-4-2v-4z"/>`),
};
