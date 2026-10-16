# Security

Umbra runs widgets written by other people on your desktop, so the sandbox matters.

## The model

- A widget page can only load content from Umbra itself and from the HTTPS hosts it lists in
  `permissions.hosts`. Every other request (fetch, images, scripts, fonts) is answered with HTTP 403.
- Widgets can't navigate away, open windows or reach the file system. Their only native bridge is
  `fetchJson` (declared hosts only), `openUrl` (opens the browser) and dragging.
- Catalog installs and agent-created widgets accept only safe relative paths and an allow-list of file types,
  up to 5 MB. Everything is validated in a temporary folder before anything is installed.
- The automation pipe (`umbractl`, MCP) accepts connections only from the same Windows user. There's no network listener.
- Every widget in the catalog was reviewed in a public pull request.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through
[GitHub security advisories](https://github.com/AmineChr54/umbra/security/advisories/new) with the steps to
reproduce and the Umbra version. You'll get an answer within a few days, and credit in the release notes if you want it.

Sandbox escapes, path traversal in installs, ways for one user to control another user's Umbra, and anything
that lets a widget run native code are all in scope.
