// Spreadsheet-style behaviour for the Review and Manual entries tables: a selected cell and ranges,
// moving with the keyboard, typing to edit, copy / cut / paste (also blocks from Google Sheets or Excel),
// Delete, fill down, and undo / redo through the app.
//
// The app redraws its tables after every change, so a Grid keeps the selection itself and is attached
// to the new <table> after each render. Cells carry data-r (row) and data-c (column); header cells data-hc.
// Keyboard and clipboard go through a hidden textarea, which reliably receives copy / cut / paste.
import { parseTsv } from './merge.js';

const grids = new Map();
export const grid = name => grids.get(name) || grids.set(name, new Grid()).get(name);

const clampTo = (v, max) => Math.max(0, Math.min(max, v));
const cellText = v => String(v ?? '').replace(/\s*[\t\r\n]+\s*/g, ' ').trim();

class Grid {
  constructor() {
    this.sel = { r: 0, c: 0, r2: 0, c2: 0 }; // active cell (r, c) and the other corner of the range (r2, c2)
    this.edit = null;                        // cell being typed in: { r, c, cell, typed }
    this.busy = false;                       // a change is being saved and the table redrawn
    this.dragging = false;
    this.painted = [];

    const sink = this.sink = document.createElement('textarea');
    sink.className = 'grid-sink';
    sink.setAttribute('aria-hidden', 'true');
    sink.tabIndex = -1;
    document.body.appendChild(sink);
    sink.addEventListener('keydown', e => this.onKey(e));
    sink.addEventListener('copy', e => this.onCopy(e, false));
    sink.addEventListener('cut', e => this.onCopy(e, true));
    sink.addEventListener('paste', e => this.onPaste(e));
    sink.addEventListener('focus', () => this.setFocus(true));
    sink.addEventListener('blur', () => { if (!this.busy && !this.edit) this.setFocus(false); });
    document.addEventListener('mousemove', e => this.onDrag(e));
    document.addEventListener('mouseup', () => { this.dragging = false; });
  }

  // opts: { rows, cols, value(r, c), editable(r, c), commit(changes: [{ r, c, value }]), undo(), redo() }
  attach(table, opts) {
    this.table = table; this.opts = opts;
    this.cells = [];
    for (const el of table.querySelectorAll('[data-r]')) (this.cells[+el.dataset.r] ||= [])[+el.dataset.c] = el;
    this.edit = null;
    this.painted = [];
    table.classList.add('sheet');
    table.addEventListener('mousedown', e => this.onMouseDown(e));
    table.addEventListener('dblclick', e => { if (this.pos(e.target)) this.startEdit(false); });
    this.clamp();
    this.paint();
    this.setFocus(this.focused);
  }

  get empty() { return !this.opts || this.opts.rows === 0 || this.opts.cols === 0; }

  setFocus(on) {
    this.focused = on && document.activeElement === this.sink || !!this.edit;
    this.table?.classList.toggle('has-focus', this.focused);
  }

  focus() {
    this.sink.value = ' '; // something selected, so the browser always offers copy / cut
    this.sink.focus({ preventScroll: true });
    this.sink.select();
    this.setFocus(true);
  }

  // select a cell (and optionally focus the table), e.g. after adding a row
  select(r, c, { focus = false } = {}) {
    Object.assign(this.sel, { r, c, r2: r, c2: c });
    this.clamp(); this.paint(); this.reveal();
    if (focus) this.focus();
  }

  clamp() {
    if (this.empty) return;
    const s = this.sel, R = this.opts.rows - 1, C = this.opts.cols - 1;
    s.r = clampTo(s.r, R); s.r2 = clampTo(s.r2, R); s.c = clampTo(s.c, C); s.c2 = clampTo(s.c2, C);
  }

  range() {
    const s = this.sel;
    return { r1: Math.min(s.r, s.r2), r2: Math.max(s.r, s.r2), c1: Math.min(s.c, s.c2), c2: Math.max(s.c, s.c2) };
  }

  paint() {
    for (const el of this.painted) el.classList.remove('sel', 'active');
    this.painted = [];
    if (this.empty) return;
    const { r1, r2, c1, c2 } = this.range();
    const multi = r1 !== r2 || c1 !== c2;
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const el = this.cells[r]?.[c];
        if (el && multi) { el.classList.add('sel'); this.painted.push(el); }
      }
    }
    const a = this.cells[this.sel.r]?.[this.sel.c];
    if (a) { a.classList.add('active'); this.painted.push(a); }
  }

  // scroll just enough to show the cell, treating the frozen column and the header row as the edges
  reveal(r = this.sel.r2, c = this.sel.c2) {
    const cell = this.cells[r]?.[c], wrap = this.table.closest('.table-wrap');
    if (!cell) return;
    if (!wrap) { cell.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
    const box = wrap.getBoundingClientRect(), at = cell.getBoundingClientRect();
    const left = box.left + wrap.clientLeft, top = box.top + wrap.clientTop;
    const frozen = cell.classList.contains('sticky') ? 0
      : Math.max(0, ...[...cell.parentElement.querySelectorAll('.sticky')].map(x => x.getBoundingClientRect().right - left));
    const head = this.table.tHead?.getBoundingClientRect().height || 0;
    // moving onto the frozen column from another column: back to the start, like Excel
    if (cell.classList.contains('sticky')) { if (this.revealedCol !== c) wrap.scrollLeft = 0; }
    else {
      if (at.left < left + frozen) wrap.scrollLeft -= left + frozen - at.left;
      else if (at.right > left + wrap.clientWidth) wrap.scrollLeft += at.right - (left + wrap.clientWidth);
    }
    this.revealedCol = c;
    if (at.top < top + head) wrap.scrollTop -= top + head - at.top;
    else if (at.bottom > top + wrap.clientHeight) wrap.scrollTop += at.bottom - (top + wrap.clientHeight);
    // the page itself, when the table is partly off screen
    const now = cell.getBoundingClientRect();
    if (now.top < 0 || now.bottom > window.innerHeight) cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  pos(target) {
    const el = target.closest?.('[data-r]');
    return el && this.table.contains(el) ? { r: +el.dataset.r, c: +el.dataset.c } : null;
  }

  // ---------- mouse ----------
  onMouseDown(e) {
    if (e.button !== 0 || e.target.closest('input, button, label, a')) return;
    const head = e.target.closest('[data-hc]');
    if (head && this.table.contains(head)) { // column header: select the whole column
      e.preventDefault();
      if (this.edit) this.commitEdit();
      const c = +head.dataset.hc;
      if (e.shiftKey) Object.assign(this.sel, { r: 0, r2: this.opts.rows - 1, c2: c });
      else Object.assign(this.sel, { r: 0, c, r2: this.opts.rows - 1, c2: c });
      this.paint(); this.focus();
      return;
    }
    const p = this.pos(e.target);
    if (!p) return;
    if (this.edit && this.edit.r === p.r && this.edit.c === p.c) return; // clicking inside the cell being edited
    e.preventDefault();
    if (this.edit) this.commitEdit();
    if (e.shiftKey) Object.assign(this.sel, { r2: p.r, c2: p.c });
    else Object.assign(this.sel, { r: p.r, c: p.c, r2: p.r, c2: p.c });
    this.revealedCol = p.c;
    this.dragging = true;
    this.paint(); this.focus();
  }

  onDrag(e) {
    if (!this.dragging || !this.table) return;
    const p = this.pos(e.target);
    if (!p || (p.r === this.sel.r2 && p.c === this.sel.c2)) return;
    Object.assign(this.sel, { r2: p.r, c2: p.c });
    this.paint();
  }

  // ---------- keyboard ----------
  onKey(e) {
    if (this.empty || e.isComposing) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key;
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const page = Math.max(1, Math.floor((this.table.closest('.table-wrap')?.clientHeight || 400) / 30) - 1);
    let handled = true;
    if (arrows[k]) {
      const [dr, dc] = arrows[k];
      if (ctrl) this.jump(dr, dc, e.shiftKey); else this.move(dr, dc, e.shiftKey);
    } else if (k === 'Tab') this.move(0, e.shiftKey ? -1 : 1);
    else if (k === 'Enter') this.move(e.shiftKey ? -1 : 1, 0);
    else if (k === 'PageDown' || k === 'PageUp') this.move(k === 'PageDown' ? page : -page, 0, e.shiftKey);
    else if (k === 'Home') this.to(ctrl ? 0 : null, 0, e.shiftKey);
    else if (k === 'End') this.to(ctrl ? this.opts.rows - 1 : null, this.opts.cols - 1, e.shiftKey);
    else if (k === 'F2') this.startEdit(false);
    else if (k === 'Delete' || k === 'Backspace') this.clearRange();
    else if (ctrl && k.toLowerCase() === 'a') { Object.assign(this.sel, { r: 0, c: 0, r2: this.opts.rows - 1, c2: this.opts.cols - 1 }); this.paint(); }
    else if (ctrl && k.toLowerCase() === 'd') this.fillDown();
    else if (ctrl && k.toLowerCase() === 'z' && !e.shiftKey) this.opts.undo?.();
    else if (ctrl && (k.toLowerCase() === 'y' || (k.toLowerCase() === 'z' && e.shiftKey))) this.opts.redo?.();
    else if (k.length === 1 && !ctrl && !e.altKey) this.startEdit(true, k);
    else handled = false; // Ctrl+C / X / V go on to the copy / cut / paste events
    if (handled) e.preventDefault();
  }

  move(dr, dc, extend = false) {
    const s = this.sel;
    if (extend) { s.r2 += dr; s.c2 += dc; } else { s.r = (s.r2 = s.r + dr); s.c = (s.c2 = s.c + dc); }
    this.clamp(); this.paint(); this.reveal();
  }

  // Ctrl+arrow, like Excel: inside a block of filled cells go to its last filled cell;
  // otherwise go to the next filled cell, or to the edge of the table if there is none
  jump(dr, dc, extend) {
    const s = this.sel;
    let r = extend ? s.r2 : s.r, c = extend ? s.c2 : s.c;
    const R = this.opts.rows - 1, C = this.opts.cols - 1;
    const inside = (y, x) => y >= 0 && y <= R && x >= 0 && x <= C;
    const filled = (y, x) => String(this.opts.value(y, x) ?? '').trim() !== '';
    if (inside(r + dr, c + dc)) {
      if (filled(r, c) && filled(r + dr, c + dc)) {
        while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) { r += dr; c += dc; }
      } else {
        do { r += dr; c += dc; } while (inside(r + dr, c + dc) && !filled(r, c));
      }
    }
    this.to(dr ? r : null, dc ? c : null, extend);
  }

  to(r, c, extend) {
    const s = this.sel;
    if (extend) { if (r !== null) s.r2 = r; if (c !== null) s.c2 = c; } else {
      if (r !== null) s.r = r; if (c !== null) s.c = c;
      s.r2 = s.r; s.c2 = s.c;
    }
    this.clamp(); this.paint(); this.reveal();
  }

  // ---------- typing in a cell ----------
  // typed: started by typing a character (replaces the content; arrows then move on, like Excel)
  startEdit(typed, char = '') {
    const { r, c } = this.sel;
    if (!this.opts.editable(r, c)) return;
    Object.assign(this.sel, { r2: r, c2: c });
    this.paint();
    const cell = this.cells[r]?.[c];
    if (!cell) return;
    this.edit = { r, c, cell, typed };
    cell.contentEditable = 'plaintext-only';
    cell.classList.add('editing');
    cell.textContent = typed ? char : String(this.opts.value(r, c) ?? '');
    cell.addEventListener('keydown', e => this.onEditKey(e));
    cell.addEventListener('blur', () => { if (!this.busy && this.edit?.cell === cell) this.commitEdit({ refocus: false }); });
    cell.addEventListener('paste', e => {
      const text = e.clipboardData.getData('text/plain');
      if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return; // a single value goes into the cell as usual
      e.preventDefault(); this.cancelEdit(); this.pasteText(text); // a block of cells: paste it into the grid
    });
    cell.focus();
    const range = document.createRange();
    range.selectNodeContents(cell); range.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
    this.setFocus(true);
  }

  onEditKey(e) {
    const { typed } = this.edit;
    const go = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); this.commitEdit(); this.move(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === 'Tab') { e.preventDefault(); this.commitEdit(); this.move(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
    else if (go && typed) { e.preventDefault(); this.commitEdit(); this.move(...go); }
    e.stopPropagation();
  }

  commitEdit({ refocus = true } = {}) {
    const { r, c, cell } = this.edit;
    const value = cell.textContent.trim();
    this.edit = null;
    this.busy = true;
    try {
      if (refocus) this.focus();
      cell.contentEditable = 'false'; cell.classList.remove('editing');
      if (value !== String(this.opts.value(r, c) ?? '').trim()) this.opts.commit([{ r, c, value }]);
      else cell.textContent = this.opts.value(r, c) ?? '';
    } finally { this.busy = false; }
    if (!refocus) this.setFocus(false);
  }

  cancelEdit() {
    const { r, c, cell } = this.edit;
    this.edit = null;
    this.busy = true;
    try {
      cell.contentEditable = 'false'; cell.classList.remove('editing');
      cell.textContent = this.opts.value(r, c) ?? '';
      this.focus();
    } finally { this.busy = false; }
  }

  // ---------- changes to several cells ----------
  save(changes) {
    const list = changes.filter(x => this.opts.editable(x.r, x.c));
    if (!list.length) return false;
    this.busy = true;
    try { this.opts.commit(list); } finally { this.busy = false; }
    return true;
  }

  clearRange() {
    const { r1, r2, c1, c2 } = this.range(), changes = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) changes.push({ r, c, value: '' });
    this.save(changes);
  }

  // Ctrl+D: copy the top row of the selection down (one row selected: copy the row above into it)
  fillDown() {
    let { r1, r2, c1, c2 } = this.range();
    if (r1 === r2) { if (r1 === 0) return; r1--; }
    const changes = [];
    for (let c = c1; c <= c2; c++) {
      const v = this.opts.value(r1, c) ?? '';
      for (let r = r1 + 1; r <= r2; r++) changes.push({ r, c, value: String(v) });
    }
    this.save(changes);
  }

  selectionText() {
    const { r1, r2, c1, c2 } = this.range(), lines = [];
    for (let r = r1; r <= r2; r++) {
      const line = [];
      for (let c = c1; c <= c2; c++) line.push(cellText(this.opts.value(r, c)));
      lines.push(line.join('\t'));
    }
    return lines.join('\n');
  }

  onCopy(e, cut) {
    if (this.empty) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', this.selectionText());
    if (cut) this.clearRange();
    this.flashCopied();
  }

  flashCopied() {
    const { r1, r2, c1, c2 } = this.range();
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const el = this.cells[r]?.[c];
      if (el) { el.classList.remove('copied'); void el.offsetWidth; el.classList.add('copied'); }
    }
  }

  onPaste(e) {
    if (this.empty) return;
    e.preventDefault();
    this.pasteText(e.clipboardData.getData('text/plain'));
  }

  // one value fills the whole selection; a block is pasted from the selection's top-left cell
  pasteText(text) {
    const rows = parseTsv(text);
    if (!rows.length) return;
    const { r1, r2, c1, c2 } = this.range(), changes = [];
    const R = this.opts.rows - 1, C = this.opts.cols - 1;
    let end;
    if (rows.length === 1 && rows[0].length === 1) {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) changes.push({ r, c, value: cellText(rows[0][0]) });
      end = { r: r2, c: c2 };
    } else {
      rows.forEach((line, i) => line.forEach((v, j) => {
        if (r1 + i <= R && c1 + j <= C) changes.push({ r: r1 + i, c: c1 + j, value: cellText(v) });
      }));
      end = { r: Math.min(R, r1 + rows.length - 1), c: Math.min(C, c1 + Math.max(...rows.map(x => x.length)) - 1) };
    }
    Object.assign(this.sel, { r: r1, c: c1, r2: end.r, c2: end.c });
    if (!this.save(changes)) this.paint();
  }
}
