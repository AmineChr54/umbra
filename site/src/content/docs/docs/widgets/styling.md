---
title: Styling and tokens
description: The design tokens in umbra.css, how themes and user appearance settings reach your widget, motion, and Windows contrast themes.
sidebar: { order: 5 }
---

`https://umbra.local/shared/umbra.css` gives every widget the same foundation: the Segoe UI Variable font stack, tabular numbers (`.num`) and a set of design tokens. **Use the tokens instead of hard-coded colors**, so the user's theme and appearance settings restyle your widget.

## Tokens

| Token | Default | Used for |
|---|---|---|
| `--bg` | `#000` | Window background |
| `--surface-1`, `--surface-2`, `--surface-3` | `#0a0a0c`, `#111114`, `#17171c` | Cards and raised areas |
| `--line`, `--line-strong` | white at 7 % / 12 % | Hairlines and borders |
| `--text`, `--text-2`, `--text-3` | `#f4f5f7`, `#a3a7b1`, `#6b707b` | Primary, secondary and muted text |
| `--accent`, `--accent-strong`, `--accent-soft` | `#8b93ff`, `#a9afff`, 14 % accent | Highlights, active states, glows |
| `--up`, `--down`, `--flat` | `#2fd58b`, `#ff5a5f`, `#9aa0aa` | Rising, falling and unchanged values |
| `--radius-s`, `--radius-m`, `--radius-l` | `8px`, `12px`, `18px` | Corner radii |

Read [`shared/umbra.css`](https://github.com/AmineChr54/umbra/blob/main/shared/umbra.css) for the complete list.

```css
.card { background: var(--surface-1); border: 1px solid var(--line); border-radius: var(--radius-m); }
.delta.up   { color: var(--up); }
.delta.down { color: var(--down); }
```

## Themes and user settings

The host turns the active [theme](/umbra/docs/themes/build-a-theme/) into one `:root { ... }` rule, which `umbra.js` applies after `umbra.css`. A widget that uses tokens follows the theme live. Set `"themeable": false` in the manifest to opt out.

On top of that, the user can set:

- a **corner radius** (overrides `--radius-s/m/l`),
- an **accent color** (`--accent`, `--accent-strong`, `--accent-soft`, also `umbra.settings.accent`; empty means the theme, "Match Windows accent" follows the system),
- **light text** (brighter `--text*`),
- an **interface font** (`--font`, `--font-display`) and **text size** (`--font-scale`, applied to the base font size, so use `em`/`rem` to follow it),
- a window **border**, and **reduce transparency** (solid `--line*` and `--accent-soft`; avoid translucent colors of your own if you want to honor it).

## Motion

`<html data-motion="on|off">` reflects the user's Animations setting and Windows' reduced-motion preference, and `umbra.css` turns off CSS animations when it's `off`. **Calm** animation speed sets `--motion-scale: 2`; multiply your durations:

```css
.panel { transition: opacity calc(200ms * var(--motion-scale, 1)); }
```

`umbra.tween` skips straight to the end value when motion is off.

## Windows contrast themes

When Windows has a contrast theme on, the page runs with `forced-colors: active`. Windows replaces colors and drops `box-shadow`s and most backgrounds, and `umbra.css` maps the tokens to system colors (`Canvas`, `CanvasText`, `Highlight`; `--up`, `--down` and `--flat` all become `CanvasText`), ignoring theme tokens. To stay readable:

- draw borders and separators with `border` or `outline`, not shadows,
- don't rely on color alone: give a rising or falling value the `trend-up` or `trend-down` class and `umbra.css` adds ▲ or ▼ in front of it (only in that mode),
- use `forced-color-adjust: none` only for things that must keep their own colors, such as a chart, and pick system colors yourself then.

## Sizing

Layout in CSS pixels and let the page fill its window. Users can resize a widget freely, and Umbra zooms the page; see [Page and lifecycle](/umbra/docs/widgets/page-and-lifecycle/#size-zoom-and-edit-mode). Follow the [design guidelines](/umbra/docs/widgets/design-guidelines/) for the house style.
