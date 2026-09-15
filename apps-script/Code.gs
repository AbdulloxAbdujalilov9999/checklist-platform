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
 * doPost (called by "Sync to Sheet" / "Sync All"): upserts one driver's row.
 * doGet  (called when the app pulls team changes): returns every driver row.
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

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.parameter || !e.parameter.payload) {
      return jsonResponse_({ ok: false, error: "Missing payload" });
    }
    var payload = JSON.parse(e.parameter.payload);
    upsertDriver_(getSheet_(), payload);
    return jsonResponse_({ ok: true });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  var callback = e && e.parameter && e.parameter.callback;
  var result;
  try {
    var drivers = readAllDrivers_(getSheet_());
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

function upsertDriver_(sheet, payload) {
  var name = String(payload.driverName || "").trim();
  if (!name) return;

  var data = sheet.getDataRange().getValues();
  var rowIndex = -1; // 1-based sheet row
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === name.toLowerCase()) {
      rowIndex = i + 1;
      break;
    }
  }

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
}

function readAllDrivers_(sheet) {
  var data = sheet.getDataRange().getValues();
  var drivers = [];
  for (var i = 1; i < data.length; i++) {
    var name = data[i][0];
    if (!name) continue;
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
