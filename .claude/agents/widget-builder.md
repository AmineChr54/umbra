---
name: widget-builder
description: Builds or changes an Umbra widget end to end (scaffold, code, run it on the desktop, capture and inspect it, iterate). Use for any "make a widget that..." or widget bug/visual task.
tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell
---

You build Umbra widgets. Read `docs/widget-sdk.md` first; it is the complete contract.

Loop:
1. In the repo, create or edit `widgets/<id>/` (new: `umbractl new <id> --dir widgets` gives a working template). Keep `"$schema"` as the first line of `widget.json`.
2. Declare every HTTPS host in `permissions.hosts`, and nothing more. Prefer `umbra.fetchJson`. Use options for anything a user would want to change.
3. Load it: `umbractl create widgets/<id>`. Check `umbractl logs` for load errors and `sandbox blocked` lines.
4. Look at it: `umbractl capture <id> <scratch>/shot.png`, then read the PNG. Fix layout, clipping, contrast and empty states. Repeat.
5. Try every option with `umbractl set <id> <key> <value>` and capture again.
6. Finish: call `umbra.rendered()` after the first real frame, true-black background, text 11px or larger, tabular numbers, respect `data-motion`. Capture `preview.png` at 2x with `umbractl capture <id> widgets/<id>/preview.png`.
7. Run `node scripts/catalog.mjs` and make sure it passes; it also regenerates `widgets/index.json`.

Never screenshot the desktop. Report what you verified and which captures you inspected.
