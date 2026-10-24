# Private widgets

Widgets kept out of the public catalog (`node scripts/catalog.mjs` only reads `widgets/`, and refuses `"private": true`
there). Their `widget.json` carries `"private": true`: Umbra shows a **Private** badge in My widgets, never offers a catalog
update for them, and a catalog widget with the same id can't replace them.

The sources live here as plain folders (reviewable diffs) rather than as a committed zip.

## Install (owners)

Either of these, on each PC:

- Settings > Browse > **From folder...** and pick `private-widgets/buddy`, or zip that folder and use **Install from file...**
  (a zip that holds the `buddy` folder, or just its files, both work).
- `umbractl install-local private-widgets/buddy --accept-permissions` (the flag accepts its relay host).

To update, install the newer folder or zip again; the saved pairing is kept.

## buddy

Two stars, you and your friend, paired with a one-time code over the relay in `tools/buddy-relay`. Whoever creates the
code is the left star (`star1.png`) and whoever joins is the right one (`star2.png`), so both PCs show the same picture.
Right-click > "I'm the left/right star" swaps it on one PC if needed.
