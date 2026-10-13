// Puts the SIMS lists into src/data/default-models.json: the diagnostic codes from a SIMS template's
// "Diagnostic codes" tab, plus the built-in translations of our diagnostics and device types.
// Usage: node scripts/extract-sims.mjs <SIMS template .xlsx>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/extract-sims.mjs <SIMS template .xlsx>');

const wb = XLSX.read(fs.readFileSync(file));
const ws = wb.Sheets['Diagnostic codes'];
if (!ws) throw new Error('The file has no "Diagnostic codes" tab');
const simsCodes = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).slice(1)
  .filter(r => String(r[1]).trim())
  .map(([category, code, description]) => ({ category: String(category).trim(), code: String(code).trim(), description: String(description).trim() }));

// our diagnostics -> SIMS issue number (the digits at the end of a code: LPT107, BSU107 = 107 keyboard defect).
// From the SIMS report of SHR11708 and the earlier SIMS.xlsx; capitals, spaces and dashes don't matter.
const ALIASES = {
  '014': 'Battery C, Battery D, Battery defect, Battery service',
  '016': 'Battery missing',
  '018': 'Bezel broken',
  '030': 'Broken chassis, Chassis broken',
  '032': 'Chassis damage C, Chassis damage D',
  '033': 'Chassis damage B',
  '034': 'Label marks B, Label marks C, Label marks D',
  '037': 'Chassis scratches C, Chassis scratches D',
  '038': 'Chassis scratches B',
  '040': 'Charging port defect',
  '056': 'Display C, Display D',
  '057': 'Display B',
  '058': 'Broken, Broken screen, Screen broken',
  '067': 'LED spots C, LED spots D, LED marks C, LED marks D',
  '068': 'LED spots B, LED marks B',
  '072': 'Screen defect',
  '076': 'Screen scratches C, Screen scratches D',
  '077': 'Screen scratches B',
  '078': 'Dead',
  '083': 'Fan noise, Noisy fan',
  '090': 'US kb, Foreign kb',
  '098': 'Storage defect',
  '101': 'Storage missing',
  '104': 'USB defect, L1 USB defect, L2 USB defect, L3 USB defect, R1 USB defect, R2 USB defect, R3 USB defect, USB L1 defect, USB L2 defect, USB L3 defect',
  '107': 'Sticky kb, KB sticky, KB defect, Key * defect',
  '109': 'KB missing',
  '110': 'KB discolored B, KB discolored C, KB discolored D',
  '116': 'Liquid marks',
  '120': 'Bad MB',
  '124': 'No RAM',
  '131': 'BIOS locked, Apple ID, Apple ID lock, Apple ID locked, Find My locked, Find My lock, Remote locked, Remote management, Prototype',
  '133': 'No display',
  '144': 'Outdated',
  '151': 'BIOS locked, Apple ID, Apple ID lock, Apple ID locked, Find My locked, Find My lock, Remote locked, Remote management',
  '189': 'TP defect, Sticky TP, TP sticky',
  '190': 'TP discolored, TP discolored B, TP discolored C, TP discolored D',
  '199': 'Camera defect',
};
const simsAliases = Object.entries(ALIASES).map(([no, aliases]) => ({ no, aliases }));
// left out of the SIMS codes and the Item Remark
const simsIgnore = ['Ok'];

// our device type -> SIMS category (the Category column), and the category whose codes it uses
// (empty = the same name). Switch and loose disks use the codes the SHR11708 report used.
const CATEGORIES = [
  ['Laptop', 'Notebook'], ['Desktop SFF', 'PC'], ['Desktop Tower', 'PC'], ['Desktop Mini', 'PC'], ['Server', 'Server'],
  ['All-in-One', 'All in One System'], ['Monitor', 'Monitor TFT'], ['TV', 'Monitor TFT'], ['Projector', 'Projector & Beamer'],
  ['Keyboard', 'Other'], ['Mouse', 'Other'], ['Webcam', 'Other'], ['Printer', 'Printer'], ['Scanner', 'Scanner'],
  ['Router', 'Router'], ['Switch', 'Switch', 'Network Switch'], ['Modem', 'Network Equipment'], ['Access Point', 'Other'],
  ['Smartphone', 'Mobile Telephone'], ['Tablet', 'Tablet'], ['Smartwatch', 'Other'], ['IP Phone', 'IP telephone'],
  ['UPS', 'Other'], ['KVM Switch', 'Network Equipment'], ['Docking Station', 'Other'], ['Network equipment', 'Network Equipment'],
  ['Other', 'Other'], ['Loose SSD', 'Data Carrier (loose)', 'Data Carrier'], ['Loose HDD', 'Data Carrier (loose)', 'Data Carrier'],
  ['Loose NVME', 'Data Carrier (loose)', 'Data Carrier'],
];
const simsCategories = CATEGORIES.map(([type, category, codes = '']) => ({ type, category, codes }));

const target = path.join(root, 'src', 'data', 'default-models.json');
const models = JSON.parse(fs.readFileSync(target, 'utf8'));
Object.assign(models, { simsCodes, simsAliases, simsIgnore, simsCategories });
fs.writeFileSync(target, JSON.stringify(models, null, 1));
console.log({ simsCodes: simsCodes.length, simsAliases: simsAliases.length, simsIgnore: simsIgnore.length, simsCategories: simsCategories.length });
