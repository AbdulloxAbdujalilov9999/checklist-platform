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

- **Sync to Sheet** (next to the driver name, and in the header) pushes and
  pulls *only the driver you're currently viewing* — it won't pull in a
  teammate's brand-new driver, just catch this one up.
- **Sync All** pushes every driver on your device, then pulls *everything*
  the sheet has — this is the one that brings in new drivers the rest of
  the team has added.

Deleting a driver (via the pencil icon → Edit → Delete) also tells the
sheet: it removes that driver's row and records the name as deleted, so a
teammate's device that still has that driver locally won't just push it
right back on their next sync. Deleting a checklist *item* is different —
see the "Removed" behavior above; that one's a visible, reversible flag,
not an actual delete, and it does sync normally as part of the driver's
data either way.

Uploaded documents stay device-local (only checklist text/status syncs, not
the files themselves) — the sheet is for shared checklist status, not
document storage.

The pull step talks to Apps Script over JSONP (a `<script>` tag), not
`fetch()` — a plain `fetch()` GET to an Apps Script web app frequently fails
with a generic "Failed to fetch" because Apps Script's redirect doesn't
reliably carry the CORS headers `fetch()` needs; a `<script>` load isn't
subject to CORS at all, so it works regardless. **This means the sheet's
Apps Script must be running the version of `Code.gs` in this repo** (it
added `doGet` JSONP support) — if you deployed an earlier version, or your
own script before this existed, redeploy it (**Deploy → Manage deployments →
Edit → New version**, not a brand new deployment, so the URL stays the
same) or "Sync to Sheet"/"Sync All" will push fine but the pull half will
fail with a timeout error telling you to do exactly this.

**This has changed again** to support deleting drivers (above) — `Code.gs`
now also tracks deleted driver names in a second "DeletedDrivers" tab so a
deletion sticks. If you deploy this update, redeploy the Apps Script the
same way (**Deploy → Manage deployments → Edit → New version**) or driver
deletion will remove the driver locally but leave their row in the sheet,
where it'll get pushed right back on the next sync.

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
