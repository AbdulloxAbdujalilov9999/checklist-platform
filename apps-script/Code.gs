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
 *   Row 4: Item | Completed | Has Issue | Comment | Removed   <- header
 *   Row 5+: one row per checklist item, with real checkboxes on the
 *           Completed / Has Issue / Removed columns — ticking one by hand
 *           in the sheet is picked up on the next pull, same as an edit
 *           made in the app.
 *
 * A hidden "Index" tab tracks which tab belongs to which driver (by the
 * app's own driver id, so renaming a driver renames its tab instead of
 * creating a duplicate) and a "DeletedDrivers" tab tombstones driver ids
 * that were deliberately deleted, so a stale push can't resurrect one.
 *
 * Manually deleting a driver's tab in the Sheet is itself treated as a
 * delete: both doPost (push) and doGet (pull) notice the Index points at a
 * tab that no longer exists, and self-heal by tombstoning that driver id
 * instead of recreating it — so deleting a tab by hand is enough, you don't
 * have to also edit the Index or DeletedDrivers tabs.
 *
 * doPost (called by "Sync to Sheet" / "Sync All", and by driver deletion):
 *   - payload.action === "deleteDriver": deletes the driver's tab and
 *     tombstones their id.
 *   - otherwise: creates or updates the driver's tab (payload needs id,
 *     driverName, truck, trailer, items).
 * doGet (called when the app pulls team changes): returns every driver
 *   (id, driverName, truck, trailer, items, updatedAt) by reading each
 *   tab listed in the Index.
 *
 * doGet responds JSONP-style (wrapping the JSON in a callback function call)
 * when called with a `callback` query parameter, which is how the app calls
 * it — a plain `<script src="...">` tag load isn't subject to CORS the way
 * fetch() is, so this works from any browser regardless of how the web app
 * deployment's CORS headers behave. A plain GET with no callback still
 * returns normal JSON, e.g. for testing the URL directly in a browser.
 */

var INDEX_SHEET_NAME = "Index";
var INDEX_HEADER_ROW = ["Driver ID", "Tab Name", "Driver Name", "Truck", "Trailer", "Updated At"];

var DELETED_SHEET_NAME = "DeletedDrivers";
var DELETED_HEADER_ROW = ["Driver ID", "Driver Name", "Deleted At"];

var TABLE_HEADER_ROW = ["Item", "Completed", "Has Issue", "Comment", "Removed"];
var ITEMS_START_ROW = 5;
var RESERVED_SHEET_NAMES = [INDEX_SHEET_NAME, DELETED_SHEET_NAME];

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getIndexSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(INDEX_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(INDEX_SHEET_NAME);
    sheet.appendRow(INDEX_HEADER_ROW);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getDeletedSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(DELETED_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DELETED_SHEET_NAME);
    sheet.appendRow(DELETED_HEADER_ROW);
    sheet.setFrozenRows(1);
  }
  return sheet;
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

// Returns {rowIndex, tabName, driverName, truck, trailer} (1-based rowIndex
// into the Index sheet) or null if this driver id isn't indexed.
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
      };
    }
  }
  return null;
}

function appendIndexRow_(indexSheet, row) {
  indexSheet.appendRow([row.id, row.tabName, row.driverName, row.truck || "", row.trailer || "", new Date().toISOString()]);
}

function updateIndexRow_(indexSheet, rowIndex, row) {
  indexSheet
    .getRange(rowIndex, 1, 1, INDEX_HEADER_ROW.length)
    .setValues([[row.id, row.tabName, row.driverName, row.truck || "", row.trailer || "", new Date().toISOString()]]);
}

function removeIndexRowAt_(indexSheet, rowIndex) {
  indexSheet.deleteRow(rowIndex);
}

function isDeleted_(deletedSheet, driverId) {
  var data = deletedSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(driverId)) return true;
  }
  return false;
}

function tombstone_(deletedSheet, driverId, driverName) {
  if (!driverId) return;
  if (isDeleted_(deletedSheet, driverId)) return;
  deletedSheet.appendRow([driverId, driverName || "", new Date().toISOString()]);
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
// doesn't collide with itself) and the reserved Index/DeletedDrivers tabs.
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

function writeDriverTable_(tab, name, truck, trailer, items) {
  tab.clear();
  tab.getRange(1, 1, 1, 2).setValues([["Truck:", truck || ""]]);
  tab.getRange(2, 1, 1, 2).setValues([["Trailer:", trailer || ""]]);
  tab.getRange(4, 1, 1, TABLE_HEADER_ROW.length).setValues([TABLE_HEADER_ROW]);
  tab.getRange(4, 1, 1, TABLE_HEADER_ROW.length).setFontWeight("bold");

  var rows = (items || []).map(function (it) {
    return [it.text || "", Boolean(it.completed), Boolean(it.hasIssue), it.comment || "", Boolean(it.removed)];
  });

  if (rows.length > 0) {
    tab.getRange(ITEMS_START_ROW, 1, rows.length, 5).setValues(rows);
    tab.getRange(ITEMS_START_ROW, 2, rows.length, 1).insertCheckboxes();
    tab.getRange(ITEMS_START_ROW, 3, rows.length, 1).insertCheckboxes();
    tab.getRange(ITEMS_START_ROW, 5, rows.length, 1).insertCheckboxes();
  }

  tab.setColumnWidth(1, 260);
  tab.setColumnWidth(4, 260);
}

function readDriverTable_(tab) {
  var truck = tab.getRange(1, 2).getValue() || "";
  var trailer = tab.getRange(2, 2).getValue() || "";

  var lastRow = tab.getLastRow();
  var items = [];
  if (lastRow >= ITEMS_START_ROW) {
    var data = tab.getRange(ITEMS_START_ROW, 1, lastRow - ITEMS_START_ROW + 1, 5).getValues();
    for (var i = 0; i < data.length; i++) {
      var text = String(data[i][0] || "").trim();
      if (!text) continue;
      items.push({
        text: text,
        completed: Boolean(data[i][1]),
        hasIssue: Boolean(data[i][2]),
        comment: data[i][3] || "",
        removed: Boolean(data[i][4]),
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
  var deletedSheet = getDeletedSheet_();

  if (isDeleted_(deletedSheet, id)) return { skipped: true };

  var existing = findIndexRow_(indexSheet, id);

  if (existing) {
    var tab = ss.getSheetByName(existing.tabName);
    if (!tab) {
      // The tab was deleted by hand directly in the Sheet — respect that as
      // an intentional delete instead of silently recreating it.
      removeIndexRowAt_(indexSheet, existing.rowIndex);
      tombstone_(deletedSheet, id, name);
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
  return { skipped: false };
}

function deleteDriverEverywhere_(id, driverName) {
  var ss = getSpreadsheet_();
  var indexSheet = getIndexSheet_();
  var deletedSheet = getDeletedSheet_();

  var existing = id ? findIndexRow_(indexSheet, id) : null;
  if (existing) {
    var tab = ss.getSheetByName(existing.tabName);
    if (tab) ss.deleteSheet(tab);
    removeIndexRowAt_(indexSheet, existing.rowIndex);
  }
  tombstone_(deletedSheet, id, driverName);
}

function readAllDrivers_() {
  var ss = getSpreadsheet_();
  var indexSheet = getIndexSheet_();
  var deletedSheet = getDeletedSheet_();
  var data = indexSheet.getDataRange().getValues();
  var drivers = [];

  // Iterate back-to-front so deleting stale index rows mid-loop doesn't
  // skip the row that shifts into the current position.
  for (var i = data.length - 1; i >= 1; i--) {
    var id = data[i][0];
    var tabName = data[i][1];
    var driverName = data[i][2];
    if (!id) continue;

    var tab = ss.getSheetByName(tabName);
    if (!tab) {
      // Tab deleted by hand — self-heal: stop tracking it and tombstone the
      // id so no device's next push recreates it.
      removeIndexRowAt_(indexSheet, i + 1);
      tombstone_(deletedSheet, id, driverName);
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
