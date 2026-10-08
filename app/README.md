# Audit Builder

Offline replacement for `Audit.xlsm`. The whole app is one file: **`AuditBuilder.html`**. Copy it anywhere and open it in Chrome or Edge; nothing needs installing.
Coworkers open it from the shared Drive folder (via Drive for desktop), so they get updates automatically; see `docs/How to use Audit Builder.txt`.

## Using it
1. **Project setup** opens automatically: project number, end client, item prefix.
2. **Data**: add Blancco exports (several .csv / .xlsx files, or .zip files containing them; or paste) and paste the Mac and Windows report lines (together in one box).
3. **Manual entries**: devices the tools can't read (dead, locked…). Works like the old My_Audit sheet.
4. **Review**: the finished Audit Report. Click any cell to change it; clear the cell to undo. Rows with a warning are tinted; click a warning to jump to its row.
5. **Export**: copy the rows into the Google Sheet, or download an `.xlsx`.

**Save project** writes a `.audit.json` file; **Open…** loads one again. Open also imports an old `Audit.xlsm`.
Work is also auto-saved in the browser, but the project file is the real record.

## Development
```
npm install
npm test        # rule tests + comparison with real Audit.xlsm output
npm run build   # writes AuditBuilder.html
npm run release # build + copy AuditBuilder.html and the guide to G:\My Drive\Audit Builder (coworkers get it automatically)
npm run package # optional: also writes dist/AuditBuilder <version>.zip (app + guide) for sending as a zip
```
- `src/engine/` – all calculation rules (one function per old formula), no browser code
- `src/ui/` – screens, styles, file import/export
- `src/data/default-models.json` – built-in Models list, diag codes, weights, cleanup rules

To check the app against a workbook: `npm run fixture -- <path-to-Audit.xlsm> <name>` and run `npm test`.
Fixtures hold client serial numbers, so `test/fixtures/` is git-ignored.
