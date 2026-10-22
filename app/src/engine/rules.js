// Field-level rules ported from the formulas in Audit.xlsm.
// Each function notes the sheet/column it replaces.
import { DEFAULT_CONFIG } from './config.js';

export const str = v => (v == null ? '' : String(v));
export const isBlank = v => v == null || String(v).trim() === '';
// trimmed and lower case: compares names and words without caring about capitals or outer spaces
export const low = v => str(v).trim().toLowerCase();
export const eqi = (a, b) => low(a) === low(b);
// does text contain word (any capitals)? An empty word never matches.
export const hasText = (text, word) => low(word) !== '' && str(text).toLowerCase().includes(low(word));
// adds value to the list kept under key in a Map
export const pushTo = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
export const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Excel TEXTJOIN(sep, TRUE, ...) - skips empty values
export const joinNonEmpty = (sep, ...vals) => vals.flat().map(str).filter(v => v !== '').join(sep);

// Excel TRIM: strips ends and collapses inner runs of spaces
export const excelTrim = s => str(s).replace(/ +/g, ' ').trim();

// Excel "--x" coercion: "83" -> 83, "69.0%" -> 0.69; NaN when not numeric
export function toNumber(v) {
  if (typeof v === 'number') return v;
  const s = str(v).trim();
  const m = s.match(/^-?\d+(?:\.\d+)?(%?)$/);
  if (!m) return NaN;
  return m[1] ? parseFloat(s) / 100 : parseFloat(s);
}

// Battery grade (Output_Mac N / Output_Win N / CSV U,V); grades from the config, checked top to bottom
export function batteryGrade(pct, grades = DEFAULT_CONFIG.battery) {
  if (Number.isNaN(pct)) return '';
  const g = grades.find(x => (x.op === '<' ? pct < Number(x.value) : pct <= Number(x.value)));
  return g ? str(g.label) : '';
}

// Output_Win AF: battery health written as a fraction (0.69) becomes 69
export function windowsBatteryPct(raw) {
  const n = toNumber(raw);
  if (Number.isNaN(n)) return NaN;
  return n <= 1 ? n * 100 : n;
}

// Output_Mac L: "16 GB LPDDR5" -> "16 GB DDR5"
export function formatRamMac(raw) {
  const s = str(raw);
  const sp = s.indexOf(' ');
  const ddr = s.indexOf('DDR');
  if (sp < 1 || ddr < 0) return s;
  return s.slice(0, sp) + ' GB DDR' + s.charAt(ddr + 3);
}

// Output_Win L: "16 GB DDR5" -> "16 GB DDR5", "8 GB x2 DDR4 ..." -> "8 GB x2 DDR4"
export function formatRamWindows(raw) {
  const s = str(raw);
  if (s === '' || s === '0') return '';
  const sp = s.indexOf(' ');
  const ddr = s.indexOf('DDR');
  if (sp < 1 || ddr < 0) return s;
  const size = s.slice(0, sp);
  const ddrTxt = 'DDR' + s.charAt(ddr + 3);
  let mult = '';
  const xi = s.indexOf(' x');
  if (xi >= 0) {
    const after = s.slice(xi + 2);
    const sp2 = after.indexOf(' ');
    mult = 'x' + (sp2 >= 0 ? after.slice(0, sp2) : after);
  }
  return joinNonEmpty(' ', size, 'GB', mult, ddrTxt);
}

// CSV N: "32 GiB" + "DDR4 / DDR4" -> "32 GB DDR4"
export function formatRamBlancco(totalMemory, memoryType) {
  const size = str(totalMemory).replace(/i/g, '');
  // one type per memory slot: "DDR4 / DDR4", or "DDR4;Empty slot" in newer exports (empty slots are skipped)
  const ddr = str(memoryType).split(/\s*[/;,]\s*/).find(p => p.toUpperCase().includes('DDR')) || '';
  return joinNonEmpty(' ', size, ddr);
}

// CSV Q helpers: "512.1 GB" -> "512 GB"
export function formatDiskCapacity(cap) {
  const s = str(cap);
  const sp = s.indexOf(' ');
  if (sp < 0) return s;
  const n = Number(s.slice(0, sp));
  if (s.slice(0, sp).trim() === '' || Number.isNaN(n)) return s;
  return Math.trunc(n) + ' ' + s.slice(sp + 1);
}

// disk interface -> name in the Disk column (config "Disk types", top to bottom), or the interface as it is
export function diskKind(iface, kinds = DEFAULT_CONFIG.diskKinds) {
  const k = kinds.find(x => hasText(iface, x.match));
  return k ? str(k.name) : str(iface);
}

// CPU_Formula sheet: raw CPU string -> short name ("i7-8700", "Ryzen 5 PRO 4650U", "Ultra 7 155H", "Xeon E5-2620 v4")
export function shortCpu(raw) {
  const b = str(raw);
  if (b === '') return '';
  const after = (text, delim) => { const i = text.indexOf(delim); return i < 0 ? null : text.slice(i + delim.length); };

  // E: "Ultra" & TEXTAFTER(B,"Ultra") - TEXTAFTER is case-sensitive, so a lower-case "ultra" falls through
  const ultra = b.indexOf('Ultra');
  if (ultra >= 0) return 'Ultra' + b.slice(ultra + 5);

  const ryzenPart = after(b, 'Ryzen ');
  if (ryzenPart !== null && ryzenPart !== '') {
    const t = ryzenPart.split(' ');
    const model = t.findIndex(x => x.length >= 4 && /^\d{4}/.test(x)) + 1;
    const noise = t.findIndex(x => { const l = x.toLowerCase(); return l === 'with' || l === 'w/' || l === 'processor' || l.includes('-core'); }) + 1;
    const n = model > 0 ? model : (noise > 1 ? noise - 1 : t.length);
    return 'Ryzen ' + t.slice(0, n).filter(x => x !== '').join(' ');
  }

  let intelPart = after(b, 'Core(TM) ');
  if (intelPart === null) intelPart = after(b, 'Xeon(R) ');
  if (intelPart !== null && intelPart !== '') {
    if (b.toLowerCase().includes('xeon(r)')) {
      const beforeAt = (intelPart + '@').split('@')[0];
      return 'Xeon ' + excelTrim(beforeAt.split('CPU').join(''));
    }
    return intelPart.trim().split(' ')[0].trim();
  }
  return '';
}

// Output_Win G: strip cleanup phrases (case-sensitive, in order) from a raw model name
export function cleanModelName(raw, cleanupRules) {
  let s = str(raw);
  if (s === '' || s === '0') return '';
  for (const r of cleanupRules) if (r !== '') s = s.split(r).join('');
  return excelTrim(s);
}

// Named function ExpandDiagCodes: replaces whole-word codes with their descriptions (case-sensitive)
export function expandDiagCodes(txt, diagCodes) {
  const s = str(txt);
  if (s === '') return '';
  let padded = ' ' + s.split(',').join(' , ') + ' ';
  for (const { code, description } of diagCodes) {
    if (!code) continue;
    // one pass that also catches back-to-back codes sharing a space; a second pass would expand
    // a description that starts with its own code again ("LED" -> "LED marks" -> "LED marks marks")
    const re = new RegExp('(?<= )' + escapeRegExp(code) + '(?= )', 'g');
    padded = padded.replace(re, () => description);
  }
  return excelTrim(padded).split(' , ').join(', ');
}

// "Chassis damage C, RM" -> ["Chassis damage C", "RM"]
export const commaParts = s => str(s).split(',').map(x => x.trim()).filter(Boolean);

// a test for "does this text contain one of the words": whole words, any capitals, spaces and dashes between words
// don't matter. "RM" matches "RM" and "rm" but not "ARM"; "Bios lock" doesn't match "Key Capslock defect".
// Made once per list (the regexes are built here), then used for every text.
export function wordMatcher(words) {
  const res = words.map(w => str(w).trim().split(/[\s_-]+/).filter(Boolean).map(escapeRegExp).join('[\\s_-]+')).filter(Boolean)
    .map(w => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, 'iu'));
  return text => res.some(re => re.test(str(text)));
}

// Locked or Faulty: "-" typed in the column means the device isn't locked or faulty
export const NOT_LOCKED = '-';
export const isLockedOrFaulty = v => !isBlank(v) && str(v).trim() !== NOT_LOCKED;
// the Locked or Faulty value plus each diagnostic the matcher picks (config lockedWords), leaving out ones already
// there (any capitals): ("Bios Locked", "Display B, BIOS locked, Dead") -> "Bios Locked, Dead". "-" stays "-".
export function withLockedDiagnostics(locked, diagnostics, isLockedWord) {
  if (str(locked).trim() === NOT_LOCKED) return NOT_LOCKED;
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ');
  const have = new Set(commaParts(locked).map(norm));
  const add = [];
  for (const part of commaParts(diagnostics)) {
    if (!isLockedWord(part) || have.has(norm(part))) continue;
    have.add(norm(part));
    add.push(part);
  }
  return joinNonEmpty(', ', locked, ...add);
}

// "display b, screen scratches b" -> "Display B, Screen scratches B":
// each comma-separated part starts with a capital, and a trailing grade letter is upper-cased
export function formatDiagnostics(txt) {
  return str(txt).split(',').map(p => p.trim()).filter(p => p !== '')
    .map(p => (p.charAt(0).toUpperCase() + p.slice(1)).replace(/(\s)([a-z])$/i, (m, sp, letter) => sp + letter.toUpperCase()))
    .join(', ');
}

// Excel PROPER
export const proper = s => str(s).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (m, p, c) => p + c.toUpperCase());
