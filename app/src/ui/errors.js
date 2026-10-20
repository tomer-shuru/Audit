// Something went wrong that the app didn't expect: say so (instead of a button that silently does nothing),
// with "Copy details" so the person can send the exact error along.
import { toast, copyAndTell } from './util.js';

let lastShown = 0;

function show(err, where) {
  if (Date.now() - lastShown < 3000) return; // one at a time, not a flood
  lastShown = Date.now();
  const message = err?.message || String(err ?? 'unknown error');
  const details = [
    `Audit Builder ${document.querySelector('.brand .version')?.textContent || ''}`,
    `${new Date().toLocaleString()} · ${where} · tab: ${document.querySelector('.tabs button.active')?.dataset.tab || '-'}`,
    message, err?.stack || '', navigator.userAgent,
  ].filter(Boolean).join('\n');
  toast(`Something went wrong: ${message}`, 'bad', { label: 'Copy details', run: () => copyAndTell(details, 'Copied the error details. Send them to whoever looks after Audit Builder.') });
}

export function watchErrors() {
  const page = location.href.split('#')[0];
  window.addEventListener('error', e => {
    if (!e.error && /ResizeObserver loop/.test(e.message)) return; // harmless browser notice
    if (e.filename && e.filename.split('#')[0] !== page) return; // a browser extension, not the app
    show(e.error || e.message, 'error');
  });
  window.addEventListener('unhandledrejection', e => {
    if (e.reason?.name === 'AbortError') return; // a file or folder picker that was cancelled
    show(e.reason, 'promise');
  });
}
