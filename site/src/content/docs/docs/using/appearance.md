---
title: Appearance and themes
description: Change corner radius, accent color, fonts, borders and motion for every widget, and switch community themes live.
sidebar: { order: 6 }
---

Umbra styles widgets through design tokens, so one setting restyles every widget that follows them. Changes apply live.

## Appearance settings

In **Settings → Appearance → Customize colors, text and size**:

| Setting | Effect |
|---|---|
| **Corner radius** | `default`, `sharp` or `round`. Overrides the theme's `--radius-s/m/l`. |
| **Accent color** | A color of your choice, or **Match Windows accent**, which follows the system accent live (lightened if it is too dark for black). Empty uses the theme's accent. |
| **Interface font and size** | Sets `--font` and `--font-scale`. Widgets that size text in `em`/`rem` follow the scale. |
| **Light text** | Brighter `--text*` colors. |
| **Window border** | On or off, and its color. |
| **Reduce transparency** | Solid `--line*` and `--accent-soft`, opaque windows. |
| **Animation speed** | `normal`, `calm` (animation durations doubled) or `off`. Windows' reduced-motion preference is respected. |
| **Size of new widgets** | The starting scale for new widgets, 0.5 to 3. |

The same settings from a terminal:

```powershell
umbractl general --corner-radius round --animation-speed calm
umbractl set-general --accent "#ff7a59" --light-text on --ui-font Consolas --font-scale 1.1 --border off --reduce-transparency on
```

## Themes

A theme restyles every widget at once: surfaces, lines, text, accent, up/down colors and corner radii. Switch in **Settings → Themes**, or:

```powershell
umbractl themes                  # installed themes and the community catalog
umbractl install-theme ember     # install from the catalog
umbractl theme ember             # switch, live (`umbractl theme default` for Umbra Black)
umbractl remove-theme ember
```

"Umbra Black" is the built-in default. The catalog ships Ember, Glacier and Mono. Themes are **data only**: a list of named color and radius tokens with strict value checks, never code, so a theme can't load anything. Your own appearance settings (accent, corner radius, font) are applied on top of the theme.

Widgets that set `"themeable": false` in their manifest keep their own look. To make a theme, see [Build a theme](/umbra/docs/themes/build-a-theme/).

## Windows contrast themes

When Windows has a contrast theme on, Umbra maps the tokens to system colors and ignores themes and accents, so widgets stay readable. Widget authors can read about it in the [styling guide](/umbra/docs/widgets/styling/).
