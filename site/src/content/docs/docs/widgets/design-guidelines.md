---
title: Design guidelines
description: The house style for Umbra widgets - true black, tokens, tabular numbers, calm motion and honest data - and how reviewers judge a widget.
sidebar: { order: 9 }
---

Umbra widgets should look like they belong together on one desktop. These rules are what reviewers check.

## Look

- **True black background (`#000`)**, no transparency. Umbra is built for OLED, where black pixels are off, and the window has DWM-drawn rounded corners and a hairline border.
- **Use the tokens** for every color, radius and font (`var(--text)`, `var(--accent)`, `var(--radius-m)`), so themes work. See [Styling and tokens](/umbra/docs/widgets/styling/).
- **Segoe UI Variable** comes from `umbra.css`; don't ship your own fonts unless the widget is about typography.
- **Text 11 px or larger.** Use `font-variant-numeric: tabular-nums` (the `.num` class) for numbers that change, so they don't jitter.
- Fit the declared `width` × `height` exactly. The window doesn't scroll or reflow; when the user resizes it, Umbra zooms the whole page. Let the page fill its window (`height: 100%`, flex, grid) so extra room gets used.

## Motion

- **Calm by default.** No constant animation. A short entrance and meaningful transitions are fine.
- Respect `html[data-motion="off"]` (`umbra.css` already disables CSS animations there) and multiply durations by `var(--motion-scale, 1)`.
- Use `umbra.tween` for number animations, since it jumps to the end value when motion is off or the window is hidden.

## Data and behavior

- **No network calls faster than `umbra.every` schedules them.** If you run your own timers, stop them while `umbra.settings.paused` is true and use `umbra.settings.refreshSeconds` as the interval.
- **Show freshness.** Dim stale numbers and put an `<umbra-status>` in the footer. See [Freshness and offline](/umbra/docs/widgets/offline/).
- **Format for the user's region** with `umbra.locale`, `umbra.hour12` and `umbra.fmt`, not a hard-coded `"en-US"`.
- **Save what the widget creates** in `umbra.store`, never in `localStorage`.
- **Handle edit mode and locking.** Don't rely on mouse interaction while `umbra.settings.editMode` is true; mark buttons `data-no-drag` so clicks stay clicks.
- Recompute anything derived from "today" in `umbra.onTimeChanged`.

## Accessibility

- Give controls real labels, and keep contrast readable on your surfaces.
- Don't rely on color alone for rising or falling values: add the `trend-up` / `trend-down` classes so Windows contrast themes get ▲ and ▼.
- Draw borders with `border`/`outline`, not `box-shadow`, so they survive forced-colors mode.

## Honest permissions

- Declare **only** the hosts the widget calls, and only the permissions its purpose needs.
- Prefer designs that work offline.
- If you need a local command, read [Running local commands](/umbra/docs/widgets/local-commands/) first; it makes review stricter.

## Before you open a pull request

- [ ] `widget.json` has a clear one-sentence `description`, a `version`, and `$schema`.
- [ ] A 2× `preview.png` on a black background (`umbractl capture <id> preview.png`).
- [ ] No hard-coded colors; checked at 50 %, 100 % and 200 % size.
- [ ] Checked with animations off and with the offline simulation.
- [ ] `node scripts/catalog.mjs` passes and `widgets/index.json` is regenerated.
