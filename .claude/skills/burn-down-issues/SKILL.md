---
name: burn-down-issues
description: Take the most important open GitHub issues on AmineChr54/umbra and solve them in parallel with a few delegated agents, token-economically. Use for "work through the open issues", "tackle the top issues in parallel", "how many issues can we solve".
---

# Burn down the top issues in parallel

Goal: solve as many high-value issues as the usage budget allows, fast, without inflating context.

1. **Survey** (one call; `no:assignee` skips issues someone else has claimed):
   `gh issue list -R AmineChr54/umbra --state open --search "no:assignee" --limit 50 --json number,title,labels --jq '.[] | "#\(.number) \(.title) [\(.labels|map(.name)|join(","))]"'`
   Without write access to the repo (`gh repo view AmineChr54/umbra --json viewerPermission`), you are a contributor:
   work from a fork, comment "I'm taking this" on each picked issue, open PRs and skip step 6 (the maintainer merges).
2. **Pick** by priority (`p0` > `p1` > `p2`), then cheap bugs and `good first issue`. Skip issues that need a human
   (`status: needs-verification`, signing, real-hardware checks) and say so.
3. **Batch into agents, the sweet spot is 3 (max 4):**
   - Group by area so PRs don't touch the same files (host / widgets / bugfixes / docs). Related small issues share one agent.
   - Two big issues in the same files (e.g. both in `App.cs`) go in different batches, the second after the first merges.
   - Never one agent for everything (slow); never one agent per tiny issue (each re-reads the codebase, which inflates tokens).
4. **Launch in one message** with `isolation: "worktree"` and the right `subagent_type` (`widget-builder` for widgets,
   `general-purpose` for host/bugs). Each prompt must contain: the issue numbers (`gh issue view N`), a pointer to `CLAUDE.md`,
   the branch name, `Closes #N` in the PR, the commit/PR attribution lines from the session reminder, "be economical: don't
   read files you don't need", and "final report: 5 lines max (PR URL, what was done, what needs a human check)".
5. **Monitor usage**: note the token total before launch and after each report. Estimate cost per agent from the delta,
   then decide how many more issues fit in the next batch. Report the running tally to the user (issues done, tokens used, remaining).
6. **Merge automatically, without asking**: the user has authorised the loop to merge green PRs. Agents only open PRs;
   the loop merges. Repo setup: auto-merge and delete-branch-on-merge are on, and `main` requires the `build-test` and
   `smoke` checks (no required reviews), so `gh pr merge N --auto --squash` waits for CI and merges by itself.
   When an agent reports a PR, run that command. Merge PRs that touch the same files (`App.cs`, `Control.cs`, `widgets/index.json`) one at a time, and have
   the next one rebased first (for `widgets/index.json`, rerun `node scripts/catalog.mjs`). Then `git pull` main.
   If CI is red, send the failure back to that agent with SendMessage rather than starting a new one.
7. **Loop until done**: run the whole thing as `/loop` in dynamic mode (no interval). Agent completions wake the loop, so
   `ScheduleWakeup` is only a fallback heartbeat (about 1500 s). Each tick: read the new agent reports, merge green PRs,
   post the tally, and launch the next batch (steps 1-4) if there's room. Loop prompt:
   `/loop Continue the burn-down-issues skill on AmineChr54/umbra: launch the next batch of top open issues via agents, merge finished PRs yourself (gh pr merge, after CI is green), report token usage tally, stop when no suitable issues remain.`
   Stop (`ScheduleWakeup` with `stop: true`) when no suitable issues remain or the user's usage limit is reached, and send a one-line `PushNotification`.
8. **Wrap up**: relay each PR URL and any human-check items (drag behaviour, real hardware). Always list what was left for a human
   (`status: needs-verification`, signing, real hardware).
