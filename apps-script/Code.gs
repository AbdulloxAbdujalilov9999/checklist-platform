/**
 * Backend for the Driver Fleet & Safety Compliance Portal's "Sync to Sheet"
 * feature. Deploy this bound to a Google Sheet, then paste the deployment's
 * web app URL into the app's Settings panel. See ../README.md for the full
 * deployment walkthrough.
 *
 * Data model: one row per driver in the "Drivers" sheet/tab. Checklist items
 * are stored as a JSON string in the "Items JSON" column so a single sync
 * call can push/pull a driver's full checklist in one request.
 *
 *   Driver Name | Truck | Trailer | Items JSON | Updated At
 *
 * A second "DeletedDrivers" sheet/tab tracks driver names that were
 * deliberately deleted from the app (one name per row). It exists so a
 * deletion sticks: without it, any other device that still has that driver
 * locally would just push it right back the next time it syncs. Once a name
 * is tombstoned there, upsertDriver_ refuses to recreate a row for it.
 *
 * doPost (called by "Sync to Sheet" / "Sync All", and by driver deletion):
 *   - payload.action === "deleteDriver": removes the driver's row (if any)
 *     and tombstones the name so it can't be resurrected by a stale push.
 *   - otherwise: upserts one driver's row (the normal sync payload).
 * doGet (called when the app pulls team changes): returns every driver row.
 *
 * doGet responds JSONP-style (wrapping the JSON in a callback function call)
 * when called with a `callback` query parameter, which is how the app calls
 * it — a plain `<script src="...">` tag load isn't subject to CORS the way
 * fetch() is, so this works from any browser regardless of how the web app
 * deployment's CORS headers behave. A plain `?` GET with no callback still
 * returns normal JSON, e.g. for testing the URL directly in a browser.
 */

var SHEET_NAME = "Drivers";
var HEADER_ROW = ["Driver Name", "Truck", "Trailer", "Items JSON", "Updated At"];

var DELETED_SHEET_NAME = "DeletedDrivers";
var DELETED_HEADER_ROW = ["Driver Name", "Deleted At"];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADER_ROW);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getDeletedSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
      deleteDriver_(getSheet_(), getDeletedSheet_(), payload.driverName);
      return jsonResponse_({ ok: true });
    }

    var skipped = upsertDriver_(getSheet_(), getDeletedSheet_(), payload);
    return jsonResponse_({ ok: true, skipped: skipped });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  var callback = e && e.parameter && e.parameter.callback;
  var result;
  try {
    var drivers = readAllDrivers_(getSheet_(), getDeletedSheet_());
    result = { ok: true, drivers: drivers };
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

function findRowByName_(sheet, name) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === name.toLowerCase()) {
      return i + 1; // 1-based sheet row
    }
  }
  return -1;
}

function isDriverDeleted_(deletedSheet, name) {
  return findRowByName_(deletedSheet, name) !== -1;
}

// Returns true if the upsert was skipped because this driver name was
// deliberately deleted from the app (a stale device pushing an old copy of
// a deleted driver shouldn't bring it back).
function upsertDriver_(sheet, deletedSheet, payload) {
  var name = String(payload.driverName || "").trim();
  if (!name) return false;

  if (isDriverDeleted_(deletedSheet, name)) {
    return true;
  }

  var rowIndex = findRowByName_(sheet, name);
  var row = [
    name,
    payload.truck || "",
    payload.trailer || "",
    JSON.stringify(payload.items || []),
    new Date().toISOString(),
  ];

  if (rowIndex === -1) {
    sheet.appendRow(row);
  } else {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  }
  return false;
}

function deleteDriver_(sheet, deletedSheet, driverName) {
  var name = String(driverName || "").trim();
  if (!name) return;

  var rowIndex = findRowByName_(sheet, name);
  if (rowIndex !== -1) {
    sheet.deleteRow(rowIndex);
  }

  if (!isDriverDeleted_(deletedSheet, name)) {
    deletedSheet.appendRow([name, new Date().toISOString()]);
  }
}

function readAllDrivers_(sheet, deletedSheet) {
  var data = sheet.getDataRange().getValues();
  var drivers = [];
  for (var i = 1; i < data.length; i++) {
    var name = data[i][0];
    if (!name) continue;
    if (deletedSheet && isDriverDeleted_(deletedSheet, String(name))) continue;
    var items = [];
    try {
      items = JSON.parse(data[i][3] || "[]");
    } catch (parseErr) {
      items = [];
    }
    drivers.push({
      driverName: name,
      truck: data[i][1] || "",
      trailer: data[i][2] || "",
      items: items,
      updatedAt: data[i][4] || "",
    });
  }
  return drivers;
}
