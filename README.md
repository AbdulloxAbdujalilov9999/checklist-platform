# Driver Fleet & Safety Compliance Portal

A single-file, offline-capable checklist for tracking each driver's compliance
documents (registration, insurance, DOT inspections, MVR, DOT physical, etc.),
flagging issues with notes, and attaching scanned documents/photos.

Everything runs in the browser — there is no backend or account system.
Data (drivers, checklist items, comments, and uploaded documents) is stored
locally per-browser using IndexedDB.

The app ships pre-configured to sync with the team's shared Google Sheet (see
[Google Sheets sync](#google-sheets-sync-share-this-with-your-team) below), so
syncing works for everyone out of the box — no setup needed unless you want
to point it at a different sheet.

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
- The `×` on a checklist item doesn't delete it — it moves the item to a
  **Removed** section at the bottom, struck through, so the team can still
  see it used to be a requirement. Tap the ↺ restore icon there to bring it
  back, or the `×` again to delete it permanently (this second delete is the
  only one that's unrecoverable, and it needs confirmation). "Removed" syncs
  like any other status, so a teammate's device shows the same item crossed
  out too instead of it just disappearing on theirs.
- On mobile, tap the ☰ icon to open the driver list drawer.
- Each driver in the sidebar has a pencil icon instead of a delete button —
  tap it to rename the driver or delete them (deleting requires
  confirmation, and also removes them from the shared sheet — see below).
  There's no one-tap delete from the list anymore, on purpose.

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
same driver list and checklist state across everyone's browser.

**Every driver gets their own tab in the Sheet** — a real, readable table,
not a hidden data blob:

```
Truck:    TR-104
Trailer:  53-V-201
                                                     <- blank spacer row
Item                    Completed  Has Issue  Comment
Registration            [x]        [ ]
Insurance               [ ]        [ ]
Cab Card / IRP          [ ]        [x]         Waiting on renewal
...
```

The Completed / Has Issue columns are real checkboxes — you can open the
Sheet and tick one by hand, and the app picks that up on its next pull,
same as if it had been changed in the app itself. A driver's checklist
"Removed" status (see below) is local to the app and isn't a column here —
it doesn't sync to the sheet at all.

Each driver's tab is formatted, not just raw values: a colored header row,
gridlines, alternating row shading, wrapped comment text, and any row with
"Has Issue" checked gets highlighted amber automatically. A driver with any
open issue also gets an orange sheet-tab color, so you can spot who needs
attention just from the tab strip without opening anything.

One more tab supports this and can be left alone: **Index**, kept as the
last tab in the spreadsheet. It's one row per driver ever synced —
tracking which sheet tab is theirs (so renaming a driver renames its tab
instead of creating a duplicate) and a Removed checkbox that marks a
driver as deleted without ever deleting its row, so a stale device can't
resurrect one (see "Deleting drivers" below).

Every sync is two-way:

1. **Push** — the driver(s) you're syncing get their tab created or fully
   rewritten to match your current data.
2. **Pull** — right after pushing, the app reads every driver tab listed in
   the Index and merges them into your local list: drivers that exist in
   the sheet but not on your device are added (so if the sheet has 10
   drivers and you only have 3, syncing brings in the other 7), and for
   drivers you already have, name/truck/trailer and each item's
   completed/issue/comment status is updated to match the sheet.

- **Sync to Sheet** (next to the driver name, and in the header) pushes and
  pulls *only the driver you're currently viewing* — it won't pull in a
  teammate's brand-new driver, just catch this one up. It never removes any
  local driver.
- **Sync All** pushes every driver on your device, then pulls *everything*
  the sheet has, including removing local drivers that no longer exist in
  the sheet **at all** — see "Deleting drivers" below. This is the one that
  brings in new drivers the rest of the team has added.

Uploaded documents stay device-local (only checklist text/status syncs, not
the files themselves) — the sheet is for shared checklist status, not
document storage.

### Deleting drivers

Deleting via the app (pencil icon → Edit → Delete) removes that driver's
tab from the sheet and checks the Removed box on their Index row, so a
teammate's device that still has that driver locally won't just push it
right back on their next sync.

**You can also just delete a driver's tab directly in the Sheet** — right-click
the tab → Delete. The app notices the Index points at a tab that's gone and
treats it as deleted: the next **Sync All** from any device removes that
driver locally too. You don't need to touch the Index tab yourself; both
push and pull self-heal a dangling Index row into a proper Removed flag the
moment they notice it.

Because this now means "missing from the sheet" can delete a driver
locally, it relies on the push that runs right before every Sync All's pull
actually reaching the sheet — a driver you added but haven't synced even
once yet is fine (Sync All pushes it first, in the same run, before
pulling), but if your connection drops mid-sync you could see a driver
disappear locally that wasn't really deleted. If that ever happens, restore
it from a backup (see above) or just re-add it and sync again.

Deleting a checklist *item* is different — see the "Removed" behavior
higher up; that one's a visible, reversible flag on an item, not an actual
delete, and (unlike driver deletion) it's local-only and doesn't sync to
the sheet at all.

### Why JSONP instead of fetch()

The pull step talks to Apps Script over JSONP (a `<script>` tag), not
`fetch()` — a plain `fetch()` GET to an Apps Script web app frequently fails
with a generic "Failed to fetch" because Apps Script's redirect doesn't
reliably carry the CORS headers `fetch()` needs; a `<script>` load isn't
subject to CORS at all, so it works regardless.

**This means the sheet's Apps Script must be running the `Code.gs` in this
repo** — if you deployed an earlier version (or your own script from before
any of this existed), redeploy it: **Deploy → Manage deployments → Edit →
New version** (not a brand new deployment, so the URL stays the same), or
"Sync to Sheet"/"Sync All" will push fine but the pull half will fail with
an error telling you to do exactly this.

**The per-driver-tab schema above is a breaking change from earlier
versions of `Code.gs`**, which stored everything in one flat "Drivers" list
(with a hidden JSON blob per row) instead of one tab per driver. If your
sheet still has that old flat "Drivers" tab, redeploy with the current
`Code.gs` the same way, then delete the old "Drivers" tab by hand once
you've confirmed the new per-driver tabs have the data you expect (nothing
on the *app* side depends on the old sheet layout — every device's own
local data is unaffected, and a Sync All from each device repopulates the
new tabs from scratch).

If your sheet has an older *pair* of tracking tabs — a separate "Index" and
"DeletedDrivers" — that's from a since-merged intermediate version.
Redeploy with the current `Code.gs` and the next sync migrates this
automatically: it adds the Removed column to your existing Index if it's
missing, folds every row from "DeletedDrivers" into Index (flagged
Removed), deletes the now-empty "DeletedDrivers" tab, and pins Index as
the last tab — no manual cleanup needed.

### Using a different sheet

The **⚙ Settings** panel comes pre-filled with the team's shared Apps Script
URL, so most people never need to touch this. To point the app at a
*different* sheet instead (e.g. a separate team, or your own test sheet):

1. Create a Google Sheet (or use an existing one).
2. In it, open **Extensions → Apps Script**.
3. Delete the placeholder code and paste in the contents of
   [`apps-script/Code.gs`](apps-script/Code.gs) from this repo.
4. Click **Deploy → New deployment**, choose type **Web app**, set
   **Execute as: Me** and **Who has access: Anyone** (or "Anyone within
   [your org]" if you're on Google Workspace and want it restricted to your
   organization), then **Deploy**.
5. Copy the resulting web app URL (ends in `/exec`).
6. In the checklist app, open **⚙ Settings**, replace the URL under
   "Google Sheets sync" with your new one, and **Save**.
7. Share that URL with whoever should sync against this new sheet — they
   paste it into their own **⚙ Settings** the same way.

Clear the field (and Save) to keep a device fully local with no sync at all.

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
