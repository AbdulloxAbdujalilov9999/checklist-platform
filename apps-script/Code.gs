/**
 * Backend for the Driver Fleet & Safety Compliance Portal's "Sync to Sheet"
 * feature. Deploy this bound to a Google Sheet, then paste the deployment's
 * web app URL into the app's Settings panel. See ../README.md for the full
 * deployment walkthrough.
 *
 * Data model: every driver gets their OWN sheet tab (named after them) —
 * a real, human-readable table you can open directly in Google Sheets:
 *
 *   Row 1: Truck:   <truck>
 *   Row 2: Trailer: <trailer>
 *   Row 3: (blank)
 *   Row 4: Item | Completed | Has Issue | Comment   <- header
 *   Row 5+: one row per checklist item, with real checkboxes on the
 *           Completed / Has Issue columns — ticking one by hand in the
 *           sheet is picked up on the next pull, same as an edit made in
 *           the app.
 *
 * A single "Index" tab (kept as the LAST tab in the spreadsheet, so driver
 * tabs stay up front) tracks every driver ever synced: which tab belongs to
 * which driver id (so renaming a driver renames its tab instead of
 * creating a duplicate), and a "Removed" checkbox column that marks a
 * driver as deleted instead of ever deleting its Index row — a deleted
 * driver's row stays as a record, just flagged, so a stale push can't
 * resurrect it.
 *
 * Manually deleting a driver's tab in the Sheet is itself treated as a
 * delete: both doPost (push) and doGet (pull) notice the Index points at a
 * tab that no longer exists and flag that row Removed instead of
 * recreating it — so deleting a tab by hand is enough, you don't have to
 * also edit the Index.
 *
 * doPost (called by "Sync to Sheet" / "Sync All", and by driver deletion):
 *   - payload.action === "deleteDriver": deletes the driver's tab and
 *     flags their Index row Removed.
 *   - otherwise: creates or updates the driver's tab (payload needs id,
 *     driverName, truck, trailer, items).
 * doGet (called when the app pulls team changes): returns every
 *   non-removed driver (id, driverName, truck, trailer, items, updatedAt)
 *   by reading each tab listed in the Index.
 *
 * doGet responds JSONP-style (wrapping the JSON in a callback function call)
 * when called with a `callback` query parameter, which is how the app calls
 * it — a plain `<script src="...">` tag load isn't subject to CORS the way
 * fetch() is, so this works from any browser regardless of how the web app
 * deployment's CORS headers behave. A plain GET with no callback still
 * returns normal JSON, e.g. for testing the URL directly in a browser.
 */

var INDEX_SHEET_NAME = "Index";
var INDEX_HEADER_ROW = ["Driver ID", "Tab Name", "Driver Name", "Truck", "Trailer", "Updated At", "Removed"];
var INDEX_COL_REMOVED = 7;

var TABLE_HEADER_ROW = ["Item", "Completed", "Has Issue", "Comment"];
var ITEMS_START_ROW = 5;
var RESERVED_SHEET_NAMES = [INDEX_SHEET_NAME];

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function moveToEnd_(ss, sheet) {
  var sheets = ss.getSheets();
  var alreadyLast = sheets.length > 0 && sheets[sheets.length - 1].getSheetId() === sheet.getSheetId();
  if (alreadyLast) return;

  var previouslyActive = ss.getActiveSheet();
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(ss.getNumSheets());
  if (previouslyActive && previouslyActive.getSheetId() !== sheet.getSheetId()) {
    ss.setActiveSheet(previouslyActive);
  }
}

function getIndexSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(INDEX_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(INDEX_SHEET_NAME);
    sheet.appendRow(INDEX_HEADER_ROW);
    sheet.setFrozenRows(1);
  }
  migrateIndexSheet_(ss, sheet);
  styleIndexSheet_(sheet);
  moveToEnd_(ss, sheet);
  return sheet;
}

// Cosmetic only — cheap to re-run on every call, and keeps a manually
// tweaked Index looking consistent again after the next sync.
function styleIndexSheet_(sheet) {
  var headerRange = sheet.getRange(1, 1, 1, INDEX_HEADER_ROW.length);
  headerRange
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground("#5f6368")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(2, 170);
  sheet.setColumnWidth(3, 170);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 100);
  sheet.setColumnWidth(6, 170);
  sheet.setColumnWidth(INDEX_COL_REMOVED, 90);
  sheet.getRange(1, INDEX_COL_REMOVED, 1, 1).setHorizontalAlignment("center");
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, INDEX_COL_REMOVED, lastRow - 1, 1).setHorizontalAlignment("center");
  }
  sheet.setTabColor("#9aa0a6");
}

// One-time, idempotent upgrade for a sheet still on an older schema:
//   - adds the "Removed" column if this Index predates it
//   - folds in a separate "DeletedDrivers" tombstone tab if one still
//     exists, marking those driver ids Removed here, then deletes it —
//     after this runs once there's only ever the one Index tab.
// Safe to call on every request: once migrated, both checks are no-ops.
function migrateIndexSheet_(ss, indexSheet) {
  var lastCol = indexSheet.getLastColumn();
  var header = lastCol > 0 ? indexSheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];

  if (header.length < INDEX_COL_REMOVED || header[INDEX_COL_REMOVED - 1] !== "Removed") {
    indexSheet.getRange(1, INDEX_COL_REMOVED).setValue("Removed");
    var lastRow = indexSheet.getLastRow();
    if (lastRow > 1) {
      var removedRange = indexSheet.getRange(2, INDEX_COL_REMOVED, lastRow - 1, 1);
      var existingFlags = removedRange.getValues();
      removedRange.setValues(existingFlags.map(function (r) { return [Boolean(r[0])]; }));
      removedRange.insertCheckboxes();
    }
  }

  var deletedSheet = ss.getSheetByName("DeletedDrivers");
  if (!deletedSheet) return;

  var deletedData = deletedSheet.getDataRange().getValues();
  for (var i = 1; i < deletedData.length; i++) {
    var id = deletedData[i][0];
    var name = deletedData[i][1];
    var deletedAt = deletedData[i][2];
    if (!id) continue;

    var existing = findIndexRow_(indexSheet, id);
    if (existing) {
      if (!existing.removed) markIndexRowRemoved_(indexSheet, existing.rowIndex);
    } else {
      indexSheet.appendRow([id, "", name || "", "", "", deletedAt || new Date().toISOString(), true]);
      var newRow = indexSheet.getLastRow();
      indexSheet.getRange(newRow, INDEX_COL_REMOVED, 1, 1).insertCheckboxes();
    }
  }

  ss.deleteSheet(deletedSheet);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.parameter || !e.parameter.payload) {
      return jsonResponse_({ ok: false, error: "Missing payload" });
    }
    var payload = JSON.parse(e.parameter.payload);

    if (payload.action === "deleteDriver") {
      deleteDriverEverywhere_(payload.id, payload.driverName);
      return jsonResponse_({ ok: true });
    }

    var result = upsertDriver_(payload);
    return jsonResponse_({ ok: true, skipped: result.skipped || false });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  var callback = e && e.parameter && e.parameter.callback;
  var result;
  try {
    result = { ok: true, drivers: readAllDrivers_() };
  } catch (err) {
    result = { ok: false, error: String(err) };
  }

  if (callback) {
    var safeCallback = String(callback).replace(/[^a-zA-Z0-9_$]/g, "");
    return ContentService.createTextOutput(safeCallback + "(" + JSON.stringify(result) + ");").setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return jsonResponse_(result);
}

// ---------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------

// Returns {rowIndex, tabName, driverName, truck, trailer, removed} (1-based
// rowIndex into the Index sheet) or null if this driver id isn't indexed.
function findIndexRow_(indexSheet, driverId) {
  var data = indexSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(driverId)) {
      return {
        rowIndex: i + 1,
        tabName: data[i][1],
        driverName: data[i][2],
        truck: data[i][3],
        trailer: data[i][4],
        removed: Boolean(data[i][6]),
      };
    }
  }
  return null;
}

function appendIndexRow_(indexSheet, row) {
  indexSheet.appendRow([
    row.id,
    row.tabName,
    row.driverName,
    row.truck || "",
    row.trailer || "",
    new Date().toISOString(),
    false,
  ]);
  var lastRow = indexSheet.getLastRow();
  indexSheet.getRange(lastRow, INDEX_COL_REMOVED, 1, 1).insertCheckboxes();
}

function updateIndexRow_(indexSheet, rowIndex, row) {
  indexSheet
    .getRange(rowIndex, 1, 1, 6)
    .setValues([[row.id, row.tabName, row.driverName, row.truck || "", row.trailer || "", new Date().toISOString()]]);
}

function markIndexRowRemoved_(indexSheet, rowIndex) {
  indexSheet.getRange(rowIndex, INDEX_COL_REMOVED, 1, 1).setValue(true);
}

// ---------------------------------------------------------------------
// Tab naming
// ---------------------------------------------------------------------

function sanitizeTabName_(name) {
  var cleaned = String(name || "")
    .replace(/[\[\]\*\?\/\\:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) cleaned = "Driver";
  return cleaned.slice(0, 90);
}

// Ensures the tab name is unique among real sheet tabs, excluding the given
// existing tab name (so renaming a driver back to a name it already had
// doesn't collide with itself) and the reserved Index tab.
function uniqueTabName_(ss, baseName, currentTabName) {
  var existing = {};
  ss.getSheets().forEach(function (s) {
    var n = s.getName();
    if (RESERVED_SHEET_NAMES.indexOf(n) === -1 && n !== currentTabName) {
      existing[n] = true;
    }
  });
  if (!existing[baseName]) return baseName;
  var suffix = 2;
  while (existing[baseName + " (" + suffix + ")"]) suffix++;
  return baseName + " (" + suffix + ")";
}

// ---------------------------------------------------------------------
// Driver tab read/write
// ---------------------------------------------------------------------

var BRAND_COLOR = "#2249d6";
var ISSUE_COLOR = "#ff9f0a";
var ISSUE_ROW_COLOR = "#fff3cd";
var META_FILL = "#f6f8fb";
var GRID_COLOR = "#e4e8f0";

function writeDriverTable_(tab, name, truck, trailer, items) {
  tab.clear();
  tab.clearConditionalFormatRules();

  // Truck/Trailer meta card
  tab.getRange(1, 1, 1, 2).setValues([["Truck:", truck || ""]]);
  tab.getRange(2, 1, 1, 2).setValues([["Trailer:", trailer || ""]]);
  tab.getRange(1, 1, 2, 2).setBackground(META_FILL);
  tab.getRange(1, 1, 2, 1).setFontWeight("bold").setFontColor(BRAND_COLOR);
  tab
    .getRange(1, 1, 2, 4)
    .setBorder(false, false, true, false, false, false, GRID_COLOR, SpreadsheetApp.BorderStyle.SOLID);

  // Table header
  var headerRange = tab.getRange(4, 1, 1, TABLE_HEADER_ROW.length);
  headerRange.setValues([TABLE_HEADER_ROW]);
  headerRange
    .setFontWeight("bold")
    .setFontColor("#ffffff")
    .setBackground(BRAND_COLOR)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  tab.getRange(4, 1).setHorizontalAlignment("left");
  tab.getRange(4, 4).setHorizontalAlignment("left");

  var rows = (items || []).map(function (it) {
    return [it.text || "", Boolean(it.completed), Boolean(it.hasIssue), it.comment || ""];
  });

  if (rows.length > 0) {
    var dataRange = tab.getRange(ITEMS_START_ROW, 1, rows.length, 4);
    dataRange.setValues(rows);
    dataRange.setBorder(true, true, true, true, true, true, GRID_COLOR, SpreadsheetApp.BorderStyle.SOLID);
    dataRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

    tab.getRange(ITEMS_START_ROW, 2, rows.length, 1).insertCheckboxes();
    tab.getRange(ITEMS_START_ROW, 3, rows.length, 1).insertCheckboxes();
    tab.getRange(ITEMS_START_ROW, 2, rows.length, 2).setHorizontalAlignment("center");
    tab.getRange(ITEMS_START_ROW, 4, rows.length, 1).setWrap(true);

    // Highlight the whole row wherever "Has Issue" is checked.
    var issueRule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=$C" + ITEMS_START_ROW + "=TRUE")
      .setBackground(ISSUE_ROW_COLOR)
      .setRanges([dataRange])
      .build();
    tab.setConditionalFormatRules([issueRule]);

    var hasOpenIssue = rows.some(function (r) {
      return r[2] === true;
    });
    tab.setTabColor(hasOpenIssue ? ISSUE_COLOR : null);
  } else {
    tab.setTabColor(null);
  }

  tab.setColumnWidth(1, 260);
  tab.setColumnWidth(2, 100);
  tab.setColumnWidth(3, 100);
  tab.setColumnWidth(4, 260);
  tab.setFrozenRows(4);
}

function readDriverTable_(tab) {
  var truck = tab.getRange(1, 2).getValue() || "";
  var trailer = tab.getRange(2, 2).getValue() || "";

  var lastRow = tab.getLastRow();
  var items = [];
  if (lastRow >= ITEMS_START_ROW) {
    var data = tab.getRange(ITEMS_START_ROW, 1, lastRow - ITEMS_START_ROW + 1, 4).getValues();
    for (var i = 0; i < data.length; i++) {
      var text = String(data[i][0] || "").trim();
      if (!text) continue;
      items.push({
        text: text,
        completed: Boolean(data[i][1]),
        hasIssue: Boolean(data[i][2]),
        comment: data[i][3] || "",
      });
    }
  }
  return { truck: truck, trailer: trailer, items: items };
}

// ---------------------------------------------------------------------
// Upsert / delete
// ---------------------------------------------------------------------

function upsertDriver_(payload) {
  var id = String(payload.id || "").trim();
  var name = String(payload.driverName || "").trim();
  if (!id || !name) return { skipped: true };

  var ss = getSpreadsheet_();
  var indexSheet = getIndexSheet_();
  var existing = findIndexRow_(indexSheet, id);

  if (existing && existing.removed) {
    return { skipped: true, reason: "deleted" };
  }

  if (existing) {
    var tab = ss.getSheetByName(existing.tabName);
    if (!tab) {
      // The tab was deleted by hand directly in the Sheet — respect that as
      // an intentional delete instead of silently recreating it.
      markIndexRowRemoved_(indexSheet, existing.rowIndex);
      return { skipped: true, reason: "deleted" };
    }

    var desiredTabName = existing.tabName;
    if (existing.driverName !== name) {
      desiredTabName = uniqueTabName_(ss, sanitizeTabName_(name), existing.tabName);
      if (desiredTabName !== existing.tabName) tab.setName(desiredTabName);
    }

    writeDriverTable_(tab, name, payload.truck, payload.trailer, payload.items);
    updateIndexRow_(indexSheet, existing.rowIndex, {
      id: id,
      tabName: desiredTabName,
      driverName: name,
      truck: payload.truck,
      trailer: payload.trailer,
    });
    return { skipped: false };
  }

  var tabName = uniqueTabName_(ss, sanitizeTabName_(name), null);
  var newTab = ss.insertSheet(tabName);
  writeDriverTable_(newTab, name, payload.truck, payload.trailer, payload.items);
  appendIndexRow_(indexSheet, { id: id, tabName: tabName, driverName: name, truck: payload.truck, trailer: payload.trailer });
  moveToEnd_(ss, indexSheet);
  return { skipped: false };
}

function deleteDriverEverywhere_(id, driverName) {
  var ss = getSpreadsheet_();
  var indexSheet = getIndexSheet_();
  var existing = id ? findIndexRow_(indexSheet, id) : null;
  if (!existing) return;

  var tab = ss.getSheetByName(existing.tabName);
  if (tab) ss.deleteSheet(tab);
  markIndexRowRemoved_(indexSheet, existing.rowIndex);
}

function readAllDrivers_() {
  var ss = getSpreadsheet_();
  var indexSheet = getIndexSheet_();
  var data = indexSheet.getDataRange().getValues();
  var drivers = [];

  for (var i = 1; i < data.length; i++) {
    var id = data[i][0];
    var tabName = data[i][1];
    var driverName = data[i][2];
    var removed = Boolean(data[i][6]);
    if (!id || removed) continue;

    var tab = ss.getSheetByName(tabName);
    if (!tab) {
      // Tab deleted by hand — self-heal: flag this row Removed so no
      // device's next push recreates it.
      markIndexRowRemoved_(indexSheet, i + 1);
      continue;
    }

    var table = readDriverTable_(tab);
    drivers.push({
      id: id,
      driverName: driverName,
      truck: table.truck,
      trailer: table.trailer,
      items: table.items,
      updatedAt: data[i][5] || "",
    });
  }

  return drivers;
}
