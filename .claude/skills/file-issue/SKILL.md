---
name: file-issue
description: File a well-formed GitHub issue on AmineChr54/umbra with type/area/priority labels so it lands on the Umbra Roadmap board. Use when you find a bug you won't fix now, or to log a feature/roadmap item.
---

# File an issue

1. Search first for duplicates: `gh issue list -R AmineChr54/umbra --search "<keywords>" --state all`.
2. Write the body.
   - **Bug:**
     - What happens and what was expected.
     - Steps to reproduce (ideally `umbractl` commands).
     - The Umbra version (`umbractl status`).
     - Relevant `umbractl logs` lines.
     - The suspected code location as `path:line`.
   - **Feature:** the problem, the proposal and acceptance criteria as a checklist.
3. Create it:
   ```bash
   gh issue create -R AmineChr54/umbra --title "<imperative, specific>" --body-file body.md \
     --label "type: bug" --label "area: host" --label "priority: p2" [--milestone "v1.2"]
   ```
   Labels: `type: bug|feature|docs|widget|chore`, `area: host|widgets|settings|sdk|ai|installer|ci|docs`, `priority: p0|p1|p2`, and optionally `good first issue` or `help wanted`.
4. Put it on the board: `gh project item-add 5 --owner AmineChr54 --url <issue-url>` (Umbra Roadmap is project 5). New issues are also auto-added once the board's auto-add workflow is on.
5. Report the issue URL.

Security vulnerabilities are never public issues. Use a private security advisory (see SECURITY.md).
