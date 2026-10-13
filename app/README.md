# Audit Builder

Offline replacement for `Audit.xlsm`. The whole app is one file: **`AuditBuilder.html`**. Copy it anywhere and open it in Chrome or Edge; nothing needs installing.
Coworkers open it from the shared Drive folder (via Drive for desktop), so they get updates automatically; see `docs/How to use Audit Builder.txt`.

## Using it
1. **Project setup** opens automatically: project number, end client, item prefix.
2. **Data**: add Blancco exports (several .csv / .xlsx files, or .zip files containing them; or paste) and paste the Mac and Windows report lines (together in one box).
3. **Manual entries**: devices the tools can't read (dead, locked…). Works like the old My_Audit sheet.
4. **Review**: the finished Audit Report. Click any cell to change it; clear the cell to undo. Rows with a warning are tinted; click a warning to jump to its row.
5. **Export** (button on Review): copy the rows into the Google Sheet, or download an `.xlsx`.

**SIMS output**: the "Output" picker (top bar, also on Review and in the Export window) switches a project to the SIMS contractor's layout (columns D to T of their "Item per service project" sheet), with our diagnostics turned into SIMS diagnostic codes. The data and Manual entries stay the same. Export then copies the SIMS rows and the HDD list, and fills their template (`G:\My Drive\Audit Builder\Templates\SIMS.xlsx`) keeping its logos, comments and Summary formulas. The SIMS codes, our diagnostics per SIMS issue and the type → category list are in the Dictionary.

**DevMode** (button in the top bar, password protected): edit the rules the report is built with: battery grades, Blancco messages and comment columns, erasure words and texts, disk types, texts (ITD, "-", lock texts), "no asset tag" values, makes whose model is in System version, check levels (red / yellow / gray / off), report and Locked and Faulty column order and headers, Blancco column names. Changes are previewed against the open project and only apply when saved. They are saved to the shared `G:\My Drive\Audit Builder\Config\config.json` (everyone connects to it once, like the Dictionary), which keeps its last 20 versions for restoring. Only a hash of the password is stored; the default is set in `src/engine/config.js` and can be changed in DevMode.

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
- `src/engine/config.js` – DevMode rules: defaults (= the workbook's behaviour), filling in missing values, validation
- `src/engine/sims.js` – the SIMS layout: rows, diagnostic codes, checks, HDD list
- `src/ui/simstemplate.js` – fills the SIMS template .xlsx (edits its XML, so their styles and formulas stay)
- `scripts/extract-sims.mjs` – reloads the SIMS codes from a SIMS template into `default-models.json` (with the built-in translations)
- `src/ui/devmode.js` – DevMode window, password, shared config.json

To check the app against a workbook: `npm run fixture -- <path-to-Audit.xlsm> <name>` and run `npm test`.
Fixtures hold client serial numbers, so `test/fixtures/` is git-ignored.
