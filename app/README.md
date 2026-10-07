# Audit Builder

Offline replacement for `Audit.xlsm`. The whole app is one file: **`dist/AuditBuilder.html`**. Copy it anywhere and open it in Chrome or Edge; nothing needs installing.

## Using it
1. **Project setup** opens automatically: project number, end client, item prefix, start number.
2. **Data**: load the Blancco export (file or paste) and paste the Mac and Windows report lines.
3. **Manual entries**: devices the tools can't read (dead, locked…). Works like the old My_Audit sheet.
4. **Review**: the finished Audit Report. Click any cell to change it; clear the cell to undo.
5. **Export**: copy the rows into the Google Sheet, or download an `.xlsx`.

**Save project** writes a `.audit.json` file; **Open…** loads one again. Open also imports an old `Audit.xlsm`.
Work is also auto-saved in the browser, but the project file is the real record.

## Development
```
npm install
npm test        # rule tests + comparison with real Audit.xlsm output
npm run build   # writes dist/AuditBuilder.html
```
- `src/engine/` – all calculation rules (one function per old formula), no browser code
- `src/ui/` – screens, styles, file import/export
- `src/data/default-models.json` – built-in Models list, diag codes, weights, cleanup rules

To check the app against a workbook: `npm run fixture -- <path-to-Audit.xlsm> <name>` and run `npm test`.
Fixtures hold client serial numbers, so `test/fixtures/` is git-ignored.
