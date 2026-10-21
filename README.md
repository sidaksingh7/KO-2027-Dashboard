# KO 2027 Dashboard

Live scoring, brackets, and standings for **Khalsa Olympics 2027**.

**Event:** June 1–3, 2027
**Venue:** Paramount Fine Foods Centre, Brampton, Ontario
**Scale:** 72–90 teams across 3 sports and 3 divisions per sport

## Status

Under construction. Target completion: May 22, 2027.

## What this is

A rebuild of KO-2026-Dashboard, redesigned for 3x the team count and informed by lessons from the 2026 event.

Public spectator view + admin scorekeeper tool + live TV screens for the venue. Firebase-synced in real time. Hosted on GitHub Pages.

## Architecture

See ARCHITECTURE.md for the full plan.

Short version:
- Static vs live data separation so TVs can't blank mid-event
- Isolated namespaces per sport per division so one bug can't take down everything
- Published gates so admin controls when spectators see new data
- Team-first navigation — search a team name, see all their games

## Repo structure

- index.html — Public landing (search, nav, status banner)
- admin.html — Scorekeeper admin tool
- src/public/ — Full Schedule, Playoffs, Team Detail, Tournament Info
- src/admin/ — Admin app logic
- src/tv/ — TV screen routes
- src/shared/firebase.js — Firebase config + initialization
- src/shared/cascade.js — Bracket cascade (QF to SF to Final)
- src/shared/standings.js — Standings calculator
- src/shared/timer.js — Timer state + sync merge logic
- src/shared/schedule-gen.js — Round-robin + bracket generators
- tests/ — Unit tests

## Development

Clone the repo, then open index.html or admin.html in your browser. No build step needed.

Vanilla HTML, CSS, and JavaScript. No framework, no bundler.

## Team

Built by Sidak and Arshdeep.

## License

Private. All rights reserved by the Khalsa Olympics organizing team.