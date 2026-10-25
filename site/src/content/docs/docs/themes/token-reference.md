---
title: Token reference
description: Every token a theme can set, its default, what it's for, and the value formats Umbra accepts.
sidebar: { order: 2 }
---

A theme's `tokens` map may contain only these names.

## Colors

| Token | Default | Used for |
|---|---|---|
| `--bg` | `#000` | Window background |
| `--surface-1` | `#0a0a0c` | Cards and raised areas |
| `--surface-2` | `#111114` | Second surface level |
| `--surface-3` | `#17171c` | Third surface level, tracks and chips |
| `--line` | white at 7 % | Hairlines |
| `--line-strong` | white at 12 % | Borders |
| `--text` | `#f4f5f7` | Primary text |
| `--text-2` | `#a3a7b1` | Secondary text |
| `--text-3` | `#6b707b` | Muted text |
| `--accent` | `#8b93ff` | Highlights, active states |
| `--accent-strong` | `#a9afff` | Stronger accent for hover and emphasis |
| `--accent-soft` | 14 % accent | Soft accent fills and glows |
| `--up` | `#2fd58b` | Rising values |
| `--down` | `#ff5a5f` | Falling values |
| `--flat` | `#9aa0aa` | Unchanged values |

**Color values** may be `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, or `rgb()`, `rgba()`, `hsl()` or `hsla()`.

## Radii

| Token | Default | Used for |
|---|---|---|
| `--radius-s` | `8px` | Small controls |
| `--radius-m` | `12px` | Cards |
| `--radius-l` | `18px` | Large surfaces |

**Length values** are `0` to `99` (with up to three decimals) followed by `px` or `rem`, for example `8px` or `0.75rem`.

## Limits

- A value is at most 64 characters.
- Whitespace inside a value is collapsed to single spaces.
- Names not in this table, `url()`, `var()`, scripts, and CSS other than the value formats above are rejected, both by `node scripts/catalog.mjs` when you publish and by the host when a theme is installed or shown.

## What the user can override

The user's own settings win over a theme: corner radius (`--radius-s/m/l`), accent (`--accent*`), light text (`--text*`), interface font (`--font`, `--font-display`), text size (`--font-scale`), border and reduced transparency (`--line*`, `--accent-soft`). Windows contrast themes ignore themes entirely. See [Appearance and themes](/umbra/docs/using/appearance/).

The machine-readable definition is the [theme.json schema](/umbra/docs/reference/theme-schema/).
