// Field-level rules ported from the formulas in Audit.xlsm.
// Each function notes the sheet/column it replaces.

export const str = v => (v == null ? '' : String(v));
export const isBlank = v => v == null || String(v).trim() === '';
export const eqi = (a, b) => str(a).trim().toLowerCase() === str(b).trim().toLowerCase();

// Excel TEXTJOIN(sep, TRUE, ...) - skips empty values
export const joinNonEmpty = (sep, ...vals) => vals.flat().map(str).filter(v => v !== '').join(sep);

// Excel TRIM: strips ends and collapses inner runs of spaces
export const excelTrim = s => str(s).replace(/ +/g, ' ').trim();

// Excel "--x" coercion: "83" -> 83, "69.0%" -> 0.69; NaN when not numeric
export function toNumber(v) {
  if (typeof v === 'number') return v;
  const s = str(v).trim();
  if (s === '') return NaN;
  if (/^-?\d+(\.\d+)?%$/.test(s)) return parseFloat(s) / 100;
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return NaN;
}

// Battery grade (Output_Mac N / Output_Win N / CSV U,V)
export function batteryGrade(pct) {
  if (Number.isNaN(pct)) return '';
  if (pct < 55) return 'Battery Defect';
  if (pct <= 69) return 'Battery D';
  if (pct <= 80) return 'Battery C';
  return '';
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
  const ddr = str(memoryType).split(' / ').find(p => p.toUpperCase().includes('DDR')) || '';
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

export function diskKind(iface) {
  const s = str(iface).toLowerCase();
  if (s.includes('nvme')) return 'NVMe';
  if (s.includes('ssd')) return 'SSD';
  if (s.includes('sata')) return 'HDD';
  return str(iface);
}

// CPU_Formula sheet: raw CPU string -> short name ("i7-8700", "Ryzen 5 PRO 4650U", "Ultra 7 155H", "Xeon E5-2620 v4")
export function shortCpu(raw) {
  const b = str(raw);
  if (b === '') return '';
  const after = (text, delim) => { const i = text.indexOf(delim); return i < 0 ? null : text.slice(i + delim.length); };

  const ultraIdx = b.toLowerCase().indexOf('ultra');
  const ultraCase = b.indexOf('Ultra');
  if (ultraIdx >= 0) {
    // E: "Ultra" & TEXTAFTER(B,"Ultra") - TEXTAFTER is case-sensitive, so lower-case "ultra" yields an error -> ""
    if (ultraCase >= 0) return 'Ultra' + b.slice(ultraCase + 5);
  }

  let ryzenPart = after(b, 'Ryzen ');
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
    padded = padded.split(' ' + code + ' ').join(' ' + description + ' ');
    // second pass catches back-to-back codes that shared a space
    padded = padded.split(' ' + code + ' ').join(' ' + description + ' ');
  }
  return excelTrim(padded).split(' , ').join(', ');
}

// Excel PROPER
export const proper = s => str(s).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (m, p, c) => p + c.toUpperCase());
