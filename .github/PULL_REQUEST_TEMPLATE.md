## What and why

Closes #

## How I tested it

- [ ] `dotnet build Umbra.slnx -warnaserror` and `dotnet test Umbra.slnx` pass
- [ ] Widgets: `node scripts/catalog.mjs` passes, and I checked a capture (`umbractl capture <id> shot.png`)
- [ ] UI changes: before/after screenshots below (captures only, no full-desktop screenshots)
- [ ] Needs a human check on real hardware (Win+D, dragging, multi-monitor): yes / no

## Checklist

- [ ] Widget hosts in `permissions.hosts` are exactly the ones used
- [ ] Docs updated (README, `docs/widget-sdk.md`, `CLAUDE.md`) if behaviour or APIs changed
