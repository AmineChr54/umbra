---
name: new-widget
description: Create a new Umbra widget in widgets/<id> that passes catalog validation, runs on the desktop and has a 2x preview.png. Use for "add a widget", "make a widget that shows ...".
---

# New widget

1. Choose an id (lowercase, dashes) and check it's free: `ls widgets/`.
2. Scaffold it with `umbractl new <id> --name "<Name>" --dir widgets`. This writes `widget.json`, `index.html`, `style.css` and `main.js`.
3. Read `docs/widget-sdk.md`, then implement the widget:
   - List every host the widget fetches from in `permissions.hosts`, and use `umbra.fetchJson`.
   - Make user choices into `options`: `text`, `number` (min/max/step), `select` (needs choices) or `toggle`.
   - Size `width`/`height` to fit the content exactly, in logical px.
   - Give it empty, loading and offline states. Keep the last good data on errors.
   - Call `umbra.rendered()` after the first real frame.
4. Run it with `umbractl create widgets/<id>`, then `umbractl logs`.
5. Inspect it with `umbractl capture <id> <scratchpad>/<id>.png` and read the image. Iterate until it's crisp and balanced, with nothing clipped.
6. Make the preview with `umbractl capture <id> widgets/<id>/preview.png`, and set `"preview": "preview.png"`.
7. Validate with `node scripts/catalog.mjs`. It regenerates `widgets/index.json` (and `themes/index.json`); commit the result with the widget, since CI only runs `--check` and nothing commits it after merge. Never hand-edit the index.
8. Clean up with `umbractl remove <id>` if it was only loaded for testing.

Widgets are never built in; they are community widgets installed from Browse (`umbractl install <id>` once merged to main). A built-in would need a `<Content>` item in `src/Umbra/Umbra.csproj`, which needs review.
