---
title: Build a theme
description: Create a theme.json, test it live, and publish it to the catalog.
sidebar: { order: 1 }
---

A theme restyles every widget through the design tokens of `umbra.css`. It is **data only**, so it's a single file:

```
themes/ember/
  theme.json      required
  preview.png     optional
```

```json
{
  "$schema": "https://raw.githubusercontent.com/AmineChr54/umbra/main/schemas/theme.schema.json",
  "id": "ember",
  "name": "Ember",
  "description": "Warm orange accent on deep brown-black surfaces.",
  "author": "your-github-name",
  "version": "1.0.0",
  "tokens": {
    "--accent": "#ff8a3d",
    "--accent-soft": "rgba(255, 138, 61, 0.15)",
    "--radius-m": "8px"
  }
}
```

## Rules

- `id` equals the folder name: 2 to 40 lowercase letters, digits and dashes. `default` is taken. **Bump `version` on every change.**
- `tokens` may only use the names in the [token reference](/umbra/docs/themes/token-reference/). Anything else (CSS, `url()`, scripts, other tokens, subfolders) fails validation.
- **Leave out what you don't change.** Left-out tokens keep the default "Umbra Black" look.
- Keep `--bg` at the default `#000` unless the theme is about the background, and keep text readable: check the contrast of `--text` and `--text-2` on your surfaces.

## Try it

```powershell
umbractl install-theme ember         # install a catalog theme
umbractl themes                      # installed and community themes
umbractl theme ember                 # switch live (every widget and Settings)
umbractl capture settings:themes themes.png
```

To test a local file, copy the folder to `%APPDATA%\Umbra\themes\<id>\` and run `umbractl themes`, then `umbractl theme <id>`. Then check a few widgets with `umbractl capture <widget> shot.png`.

## Publish

1. Run `node scripts/catalog.mjs`: it validates your theme and regenerates `themes/index.json`. Never edit the index by hand.
2. Open a pull request with your `themes/<id>/` folder and the regenerated index.
3. CI runs `node scripts/catalog.mjs --check` and fails if the index is out of date.

## How a theme is applied

The host turns the active theme into one `:root { ... }` rule, and `shared/umbra.js` applies it after `umbra.css`, so widgets need no code to support themes. A widget with `"themeable": false` is left alone. The user's own appearance settings (accent, corner radius, font, light text, reduced transparency) are applied on top of the theme. See [Appearance and themes](/umbra/docs/using/appearance/) and the [theme.json schema](/umbra/docs/reference/theme-schema/).

Catalog tokens are re-validated before Settings draws them, so a theme can never smuggle in anything but colors and radii.
