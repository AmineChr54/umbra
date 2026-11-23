# Work Hours

A time tracker for a job with a fixed number of hours a week (20 by default), so you land on your hours: not more, not less.

- **Start / Stop** a timer with an optional note ("What are you working on?"). It keeps counting while Umbra is closed or the PC sleeps, because only the start time is saved. Click **since 09:12** to fix when it started, or the **×** to discard it (with Undo).
- **The ring** fills up to your weekly target. Next to it: what's left, and how much a day that is over the workdays left ("Today: 1h 10m more, then ≈ 3h 40m a day"). It turns amber near the target, green at it, and red once you're 30 minutes over; overtime shows as `+0:40`.
- **The week strip** shows each day's hours against an even daily share; click a day to see its entries.
- **Add time** you forgot, or click an entry to change or delete it. Write the length as `1:30`, `2h`, `45m` or give start and end (an end before the start means it ended after midnight). Entries can't overlap or end in the future.
- **Earlier weeks** (the bars icon): each week's total, how far off the target it was, and the balance over all weeks.
- **Copy** (the copy icon) puts the week's timesheet on the clipboard as tab-separated rows (date, start, end, hours, note, then the total) that paste straight into Excel or Google Sheets.

## Toasts

With **Notifications** on (and allowed for the widget, which it asks on the first Start):

- a warning before you reach the target (15 minutes by default, **Warn before the target**),
- one when you reach it, with a **Stop timer** button,
- one when a timer has been running for a long time (4 hours by default, **Remind me when a timer runs for**), in case you forgot it.

Each shows once per week (or per timer). Nothing is shown for a threshold passed while Umbra was closed.

## Options

| Option | Default | |
|---|---|---|
| Hours a week | 20 | the weekly target |
| Workdays | Monday to Friday | used for the per-day pace |
| Week starts on | Monday | |
| Warn before the target (minutes) | 15 | 0 for no warning |
| Remind me when a timer runs for (hours) | 4 | 0 for never |
| Carry over/under time into the next week | off | 21 h last week makes this week's target 19 h; weeks with no time at all (holidays) don't count |
| Notifications | on | |

Data stays on this PC in the widget's own store (`umbra.store`): entries of the last 400 days, the running timer, and which toasts were shown.
