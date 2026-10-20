// npm run rollback: a release went wrong, so put the version before it back in the Drive folder.
// It swaps AuditBuilder.html (and the guide) with the copies in "Previous version", so running it again undoes it.
// Coworkers get the restored version the next time they open the app (or press F5).
import fs from 'node:fs';
import path from 'node:path';
import { PREVIOUS, versionOf } from './release-files.mjs';

const target = process.argv[2];
if (!target || !fs.existsSync(target)) throw new Error(`Publish folder not found: ${target}`);
const prev = path.join(target, PREVIOUS);
if (!fs.existsSync(path.join(prev, 'AuditBuilder.html'))) throw new Error(`No previous version in ${prev} (it is kept from the next release on)`);

for (const name of ['AuditBuilder.html', 'How to use Audit Builder.txt']) {
  const live = path.join(target, name), old = path.join(prev, name), tmp = path.join(prev, `${name}.swap`);
  if (!fs.existsSync(old)) continue;
  fs.copyFileSync(old, tmp);
  if (fs.existsSync(live)) fs.copyFileSync(live, old);
  fs.copyFileSync(tmp, live);
  fs.rmSync(tmp);
}
console.log(`Rolled back: the app in ${target} is now ${versionOf(path.join(target, 'AuditBuilder.html'))}`);
console.log(`(${versionOf(path.join(prev, 'AuditBuilder.html'))} is kept in ${PREVIOUS}; run it again to undo)`);
