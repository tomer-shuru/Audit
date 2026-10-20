// Shared by build.mjs (--publish) and rollback.mjs: where the version before the last release is kept
import fs from 'node:fs';

export const PREVIOUS = 'Previous version'; // a folder next to AuditBuilder.html in the Drive folder

// the version shown in the app's top bar ("2026-10-20 1352"), read from a built AuditBuilder.html
export const versionOf = file => /class="version"[^>]*>([^<]+)</.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? 'unknown version';
