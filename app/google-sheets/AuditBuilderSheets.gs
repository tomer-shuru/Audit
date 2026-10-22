// Audit Builder <-> Google Sheets
//
// A small Google Apps Script that lets Audit Builder read a project's Google Sheet and write the Final Report rows
// into it (Final Report > Send to Google Sheet, Data tab > Load from Google Sheet). The app can't use Google's sign-in
// itself because it is opened as a file, so this script does the reading and writing, as the person who deployed it:
// it reaches every sheet that person can edit, and nobody else has to sign in.
//
// Setting it up once (see "GOOGLE SHEETS" in How to use Audit Builder.txt):
//   1. script.google.com > New project, paste this whole file over what is there, and name the project
//      "Audit Builder Sheets".
//   2. Put a key of your own (a long random text, no spaces) between the quotes below.
//   3. Deploy > New deployment > type "Web app": Execute as "Me", Who has access "Anyone". Deploy, allow access.
//   4. Copy the Web app URL into Audit Builder: Settings > DevMode > Google Sheets, with the same key. Save.
// After changing this file: Deploy > Manage deployments > edit (pencil) > Version "New version" > Deploy
// (the URL stays the same).
//
// The app does the thinking (which row each item goes to, what would be overwritten) and shows it first; this
// script only reads the sheet and makes the changes it is sent.

const KEY = 'PUT-YOUR-KEY-HERE';

// requests from the app: JSON { key, action: 'read' | 'write', sheetId, gid, … }; the answer is JSON too
// ({ error } when something went wrong)
function doPost(e) {
  let answer;
  try {
    const req = JSON.parse(e.postData.contents);
    if (KEY === 'PUT-YOUR-KEY-HERE' || req.key !== KEY) throw new Error('wrong key: the key in DevMode > Google Sheets must be the one in the script');
    if (!ACTIONS[req.action]) throw new Error('unknown action ' + req.action);
    answer = ACTIONS[req.action](req);
  } catch (err) {
    answer = { error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(answer)).setMimeType(ContentService.MimeType.JSON);
}

// opening the URL in a browser: says it works
function doGet() {
  return ContentService.createTextOutput('Audit Builder Sheets is running.');
}

// the tab of the link (gid), or the first tab
function openTab(req) {
  let ss;
  try {
    ss = SpreadsheetApp.openById(req.sheetId);
  } catch (err) {
    throw new Error('not-a-sheet: ' + err.message);
  }
  const tabs = ss.getSheets();
  const tab = req.gid === '' || req.gid == null ? tabs[0] : tabs.find(t => String(t.getSheetId()) === String(req.gid));
  if (!tab) throw new Error('The tab in the link isn\'t in the sheet any more. Copy the link again with the tab open.');
  return { ss, tab };
}

// New rows get the look of a normal row (model) instead of the row next to them, which may be the header.
// model 0: no row to copy, so they are plain.
function dressLike(tab, model, first, n) {
  const added = tab.getRange(first, 1, n, tab.getMaxColumns());
  if (!model) { added.clearFormat(); added.clearDataValidations(); return; }
  const from = tab.getRange(model, 1, 1, tab.getMaxColumns());
  from.copyTo(added, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  from.copyTo(added, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  tab.setRowHeights(first, n, tab.getRowHeight(model));
}

const ACTIONS = {
  // every cell as it is shown
  read(req) {
    const { ss, tab } = openTab(req);
    return { title: ss.getName(), tab: tab.getName(), values: tab.getDataRange().getDisplayValues() };
  },

  // req.expect: [{ row, col, value }]   cells that must still show what the app saw (else nothing is changed)
  // req.updates: [{ row, col, values }] values written from (row, col) to the right
  // req.inserts: [{ row, where: 'after' | 'before', col, rows }]   new rows next to a row
  // req.formatFrom: the row the new rows look like (colors, font, height, drop-downs), 0 = plain new rows
  // Rows and columns count from 1.
  write(req) {
    const { tab } = openTab(req);
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const shown = tab.getDataRange().getDisplayValues();
      for (const c of req.expect) {
        const now = (shown[c.row - 1] || [])[c.col - 1] || '';
        if (now !== c.value) throw new Error('changed: the sheet changed since it was read (row ' + c.row + '). Send again.');
      }
      const lastCol = Math.max(0, ...req.updates.map(u => u.col + u.values.length - 1), ...req.inserts.map(i => i.col + i.rows[0].length - 1));
      if (lastCol > tab.getMaxColumns()) tab.insertColumnsAfter(tab.getMaxColumns(), lastCol - tab.getMaxColumns());

      // the changes to rows that are there first, then new rows from the bottom up, so row numbers stay right
      for (const u of req.updates) tab.getRange(u.row, u.col, 1, u.values.length).setValues([u.values]);
      const inserts = req.inserts.slice().sort((a, b) => b.row - a.row);
      let model = req.formatFrom || 0;
      for (const i of inserts) {
        const n = i.rows.length, first = i.where === 'before' ? i.row : i.row + 1;
        if (i.where === 'before') tab.insertRowsBefore(i.row, n);
        else tab.insertRowsAfter(i.row, n);
        if (model >= first) model += n; // the row to look like moved down
        dressLike(tab, model, first, n);
        tab.getRange(first, i.col, n, i.rows[0].length).setValues(i.rows);
      }
      SpreadsheetApp.flush();
      return { updated: req.updates.length, inserted: inserts.reduce((n, i) => n + i.rows.length, 0) };
    } finally {
      lock.releaseLock();
    }
  },
};
