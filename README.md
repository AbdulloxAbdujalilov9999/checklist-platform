# Driver Fleet & Safety Compliance Portal

A single-file, offline-capable checklist for tracking each driver's compliance
documents (registration, insurance, DOT inspections, MVR, DOT physical, etc.),
flagging issues with notes, and attaching scanned documents/photos.

Everything runs in the browser — there is no backend or account system.
Data (drivers, checklist items, comments, and uploaded documents) is stored
locally per-browser using IndexedDB.

## Using it

Open `index.html` in any modern browser (desktop or mobile), or serve the
folder with any static file host / GitHub Pages.

- **Add a driver** from the sidebar, then fill in truck/trailer numbers.
- Each driver starts with the standard 16-item compliance checklist. Add
  custom items with the `+` field above the checklist.
- Tap the circle to mark an item complete, or the `!` to flag an issue and
  leave a comment.
- Tap the paperclip to attach a PDF/photo to an item (this also marks it
  complete); tap **View** to preview it, or the `×` to remove it.
- On mobile, tap the ☰ icon to open the driver list drawer.

## Backup & restore

All data lives only in the browser that created it (per-device, per-browser).
Use **Export backup** (sidebar, or the ⚙ Settings panel) to download a JSON
file containing every driver, checklist item, comment, and attached document
(embedded as base64). **Import backup** restores from that file — this
replaces whatever is currently on the device, after a confirmation prompt.

Back up regularly, and especially before clearing site data or switching
browsers/devices.

## Google Sheets sync (optional)

The **Sync to Sheet** / **Sync All** buttons can push a driver's checklist
status to a Google Sheet via a Google Apps Script web app you control. Open
**⚙ Settings** and paste your own deployed Apps Script web app URL — nothing
is sent anywhere until you set this. Leave it blank to keep all data local.

## Notes

- Files are capped at 20MB each.
- There is no login/auth; anyone with access to the device/browser profile
  can see and edit the data. Don't use this for anything that needs access
  control beyond "whoever has this browser open."
