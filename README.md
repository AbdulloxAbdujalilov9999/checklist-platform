# Driver Fleet & Safety Compliance Portal

A single-file, offline-capable checklist for tracking each driver's compliance
documents (registration, insurance, DOT inspections, MVR, DOT physical, etc.),
flagging issues with notes, and attaching scanned documents/photos.

Everything runs in the browser — there is no backend or account system.
Data (drivers, checklist items, comments, and uploaded documents) is stored
locally per-browser using IndexedDB. To use it with a team, set up
[Google Sheets sync](#google-sheets-sync-share-this-with-your-team) below —
the shared sheet is what keeps everyone's copy of the checklist in sync.

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

## Google Sheets sync (share this with your team)

Since there's no server, a shared Google Sheet is what lets a team see the
same driver list and checklist state across everyone's browser. Every sync
is two-way:

1. **Push** — the driver(s) you're syncing are written to the shared sheet
   (this always fully overwrites that driver's row with your current data —
   the sheet ends up exactly matching what you just pushed for that driver).
2. **Pull** — right after pushing, the app reads back *every* driver
   currently in the sheet and merges them into your local list: drivers that
   exist in the sheet but not on your device are added (so if the sheet has
   10 drivers and you only have 3, syncing brings in the other 7), and for
   drivers you already have, each item's completed/issue/comment status is
   updated to match the sheet.

A pull never deletes anything locally — it only adds drivers/items or
updates the status of ones that already match by name, so nothing you or a
teammate has entered gets silently wiped. Do this after any change you want
the team to see, and again whenever you want to catch up on theirs.

- **Sync to Sheet** pushes the driver you're currently viewing, then pulls.
- **Sync All** pushes every driver on your device, then pulls.

Uploaded documents stay device-local (only checklist text/status syncs, not
the files themselves) — the sheet is for shared checklist status, not
document storage.

### Setting it up

1. Create a Google Sheet for your team (or use an existing one).
2. In it, open **Extensions → Apps Script**.
3. Delete the placeholder code and paste in the contents of
   [`apps-script/Code.gs`](apps-script/Code.gs) from this repo.
4. Click **Deploy → New deployment**, choose type **Web app**, set
   **Execute as: Me** and **Who has access: Anyone** (or "Anyone within
   [your org]" if you're on Google Workspace and want it restricted to your
   organization), then **Deploy**.
5. Copy the resulting web app URL (ends in `/exec`).
6. In the checklist app, open **⚙ Settings**, paste that URL under
   "Google Sheets sync", and **Save**.
7. Share the same URL with your teammates — they paste it into their own
   **⚙ Settings** the same way. Everyone syncing against the same URL is now
   working off the same shared sheet.

Leave the URL blank to keep a device fully local with no sync.

When you edit `Code.gs` after deployment, use **Deploy → Manage deployments
→ Edit (pencil) → New version** so the same `/exec` URL picks up the change,
rather than creating a whole new deployment (which would produce a new URL
everyone has to re-paste).

## Notes

- Files are capped at 20MB each.
- There is no login/auth; anyone with access to the device/browser profile
  can see and edit the local data. Don't use this for anything that needs
  access control beyond "whoever has this browser open."
- The Apps Script URL is a shared secret, not a login: anyone who has it can
  read and write the whole sheet (that's what lets your team sync at all).
  Only share it with people who should have that access, and use the
  Workspace-restricted deployment option in step 4 above if you want it
  limited to your organization's Google accounts.
