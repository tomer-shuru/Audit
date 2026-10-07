// Bundles the app into a single offline HTML file: dist/AuditBuilder.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = path.join(root, 'src', 'ui');

const result = await esbuild.build({
  entryPoints: [path.join(ui, 'main.js')],
  bundle: true, minify: true, format: 'iife', target: 'es2022', write: false,
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(ui, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(ui, 'index.html'), 'utf8')
  .replace('/*CSS*/', () => css)
  .replace('/*JS*/', () => js);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'AuditBuilder.html');
fs.writeFileSync(out, html);
console.log(`Built ${path.relative(root, out)} (${Math.round(html.length / 1024)} KB)`);
