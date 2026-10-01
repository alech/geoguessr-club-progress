# GeoGuessr Club Progress

A [Tampermonkey](https://www.tampermonkey.net/) userscript for
[GeoGuessr](https://www.geoguessr.com/).

*For club members who want to know whether the weekly mission board is going to
get cleared — and who still needs to pull their weight.*

GeoGuessr clubs share a weekly mission board: 100 missions spread over five
boards, one mission per member per challenge day (which rolls over at 11:00
UTC). The club page shows the board, but not how the week is going. This
userscript adds a **Progress** tab next to **Stats** on your club page that does.

## What it does

- **Overall progress** — missions finished out of 100, coloured green if the
  club is on pace to clear every board by the end of the week at its current
  speed and red if not, plus how many missions a day are still needed. A marker
  shows where an even pace would be right now.
- **Open missions** — every mission that has been taken but not finished, how
  long it has been open (yellow after 6 hours, red after 12) and whether the
  member asked for help.
- **Missions finished per challenge day** — one bar per 11:00–11:00 UTC day,
  green above the daily target of 14, yellow at exactly 14, red below. For the
  days ahead the target line moves to the number still needed.
- **Members** — every member with the number of missions finished and helped,
  and a check mark per challenge day: a large green ✓ for a mission they
  finished, a small purple ✓ for one they helped with. Hover a cell to see
  which missions it was.
- **Missions** — every finished mission, grouped by challenge day, with who took
  it, when, and who helped.
- **Earlier weeks** — a week picker next to the Refresh button shows the same
  overview for past weeks.

All times are shown in UTC. The tab refreshes itself once a minute while it is
open.

## How it works

The script reads the same endpoints the club page uses —
`/api/v4/missions/club/board` for the board and `/api/v4/clubs/{id}/members`
for nicknames — with your existing GeoGuessr session. It never writes anything.

GeoGuessr only offers the current and the previous week
(`/api/v4/missions/club/board/previous`), so the script saves every week it sees
in your browser's local storage. The week picker therefore starts with last
week and grows from there; it only knows about weeks while you had the script
installed, and only in that browser.

GeoGuessr is a single-page app, so the script watches the page for the club tab
bar, adds a copy of one of its tab buttons, and swaps in its own panel when that
tab is selected. It only activates on `/clubs/my`.

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Open the
   [userscript](https://github.com/alech/geoguessr-club-progress/raw/refs/heads/main/geoguessr-club-progress.user.js)
   — Tampermonkey detects the `.user.js` file and prompts you to install it.
3. Open your club page on GeoGuessr and click **Progress**.

## Caveat

The tab is found through GeoGuessr's generated CSS class names
(`club-tabs_tabsWrapper…`). If GeoGuessr changes its club page, the tab may
simply not appear until the script is updated.

## License

Released under [CC0 1.0 Universal](LICENSE) — public domain.
