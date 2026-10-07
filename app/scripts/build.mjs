// Bundles the app into a single offline HTML file: AuditBuilder.html (in the app folder)
// With --zip it also packs the app and the user guide into dist/AuditBuilder <version>.zip
// With --publish <folder> it copies the app and the guide into that (Drive) folder
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as XLSX from 'xlsx';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = path.join(root, 'src', 'ui');
const dist = path.join(root, 'dist');

// version = build date and time, shown in the app's top bar and used in the zip name
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const version = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;

const result = await esbuild.build({
  entryPoints: [path.join(ui, 'main.js')],
  bundle: true, minify: true, format: 'iife', target: 'es2022', write: false,
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(ui, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(ui, 'index.html'), 'utf8')
  .replace('/*CSS*/', () => css)
  .replace('/*JS*/', () => js)
  .replace('{{VERSION}}', version);

const out = path.join(root, 'AuditBuilder.html');
fs.writeFileSync(out, html);
console.log(`Built ${path.relative(root, out)} (${Math.round(html.length / 1024)} KB), version ${version}`);

if (process.argv.includes('--zip')) {
  fs.mkdirSync(dist, { recursive: true });
  for (const old of fs.readdirSync(dist)) if (/^AuditBuilder .*\.zip$/.test(old)) fs.rmSync(path.join(dist, old));
  const guide = 'How to use Audit Builder.txt';
  const zip = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(zip, 'Audit Builder/AuditBuilder.html', Buffer.from(html));
  XLSX.CFB.utils.cfb_add(zip, `Audit Builder/${guide}`, fs.readFileSync(path.join(root, 'docs', guide)));
  const zipPath = path.join(dist, `AuditBuilder ${version}.zip`);
  fs.writeFileSync(zipPath, XLSX.CFB.write(zip, { fileType: 'zip', type: 'buffer', compression: true }));
  console.log(`Packed ${path.relative(root, zipPath)} (${Math.round(fs.statSync(zipPath).size / 1024)} KB)`);
}

// --publish <folder>: put the app and the guide in the shared Drive folder (Drive for desktop syncs it).
// The app keeps the same file name, so coworkers' shortcuts open the new version automatically.
const pi = process.argv.indexOf('--publish');
if (pi > 0) {
  const target = process.argv[pi + 1];
  if (!target || !fs.existsSync(target)) throw new Error(`Publish folder not found: ${target}`);
  const guide = 'How to use Audit Builder.txt';
  fs.copyFileSync(out, path.join(target, 'AuditBuilder.html'));
  fs.copyFileSync(path.join(root, 'docs', guide), path.join(target, guide));
  for (const old of fs.readdirSync(target)) {
    if (/^AuditBuilder .*\.zip$/.test(old)) {
      fs.rmSync(path.join(target, old));
      console.log(`Removed old ${old} from ${target}`);
    }
  }
  console.log(`Published AuditBuilder.html (version ${version}) and the guide to ${target}`);
}
