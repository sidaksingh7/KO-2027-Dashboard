# KO 2027 Dashboard — Architecture

Live scoring for Khalsa Olympics 2027 (June 1–3, 2027 · Paramount Fine Foods Centre, Brampton).
Day 1 soccer, Day 2 basketball, Day 3 volleyball. 3 divisions per sport (`d1`, `d2`, `d3`),
8–10 teams each.

**Stack:** vanilla HTML/CSS/JS (no build step) · Firebase Realtime Database (compat SDK) ·
Firebase Auth email/password for admins · GitHub Pages hosting.

---

## Principles (non-negotiable)

1. **Published vs live.** `published/` holds finalized data; public pages read only from it,
   so they never flicker. `live/` holds in-progress game state for TVs and admin.
2. **Isolation per sport per division.** Everything lives under `ko2027/{sport}/{division}/`.
   A bug in `soccer/d1` cannot touch `basketball/d3`.
3. **Running timers are immutable.** A sync can never change a running timer's duration.
4. **Per-field last-write-wins.** Every write carries an `updatedAt` per field.
5. **One cascade function.** QF → SF → Final is a single pure, tested function used by
   admin, public and TV code alike.

---

## Firebase layout

```
ko2027/
  admin/admins/{uid}: true       who may write (security rules check this)
  event/banner                   { text, level } shown on public site + TVs
  {sport}/{division}/            sport = soccer | basketball | volleyball, division = d1 | d2 | d3
    live/                        admin writes here; TVs + admin read here
      teams/{teamId}             { name, group? }   group 'A'|'B' for soccer
      games/{gameId}             game (below), with updatedAt per field
      timers/{gameId}            timer (src/shared/timer.js)
      dq/{teamId}: true
      manualOrder: [teamId]      coin-flip order for unbreakable ties
    published/                   public site reads ONLY here
      teams, games, groups, dq, manualOrder, publishedAt
```

**The published gate.** Admin → Publish copies a division's live teams/games/groups/dq/
manualOrder into `published/` in one write. Teams and schedule changes reach the public
site only that way. Once a division has been published, every scored game is also copied
to `published/games/{id}` as a single write, so public scores stay current but never show
half-written data. Timers are never published (TVs read them from `live/`).

Security rules: `database.rules.json` — everyone may read `live/`, `published/`, `event/`;
only users listed in `admin/admins` may write. Setup steps: [SETUP.md](SETUP.md).

Paths are never written by hand: use `KO.publishedPath / livePath / adminPath`
(or the `…Ref` versions). They reject unknown sports/divisions and characters Firebase forbids.

### Sandbox mode

Until the Firebase config in `src/shared/firebase.js` is filled in, `KO.db` is a
**sandbox** (`src/shared/local-db.js`): the same API (`on/off/once/set/update/transaction`)
saved in the browser's localStorage, live across tabs. Admin needs no login, and the
public site shows the built-in demo tournament until something is published to the
sandbox. Admin → Publish → *Load demo tournament* fills it for a full dry run.

### Timestamps

All times are **ms epoch numbers**. Use `KO.now()`, not `Date.now()`: it's `Date.now()`
corrected by Firebase's server-clock offset, so devices with wrong clocks still agree on
which write is newer. (2026: a phone with a fast clock could win every sync.)

Per-field stamps sit in an `updatedAt` object beside the fields they describe:

```js
KO.stampedUpdate(KO.liveRef('soccer', 'd1', 'games', id), { score1: 3 })
// writes  score1: 3,  updatedAt/score1: <now>
```

---

## Shared code (`src/shared/`)

Each file is a plain `<script>` (no modules — works when you double-click an HTML file)
that adds to one global, `window.KO`. They also load in Node for tests.

Load order in HTML:

```html
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-database-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
<script src="src/shared/local-db.js"></script>
<script src="src/shared/firebase.js"></script>
<script src="src/shared/cascade.js"></script>
<script src="src/shared/standings.js"></script>
<script src="src/shared/timer.js"></script>
<script src="src/shared/schedule-gen.js"></script>
```

| File | Provides | Pure? |
|---|---|---|
| `firebase.js` | `KO.db`, `KO.auth`, path helpers, `KO.now()`, `KO.stampedUpdate()`, `KO.onConnectionChange()`, `KO.signIn/signOut/onAuthChange()` | path helpers yes |
| `cascade.js` | `KO.resolveBracket(games, seeds, dqTeamIds)` | yes |
| `standings.js` | `KO.computeStandings(games, teamIds, { sport, groups, dqTeamIds, manualOrder })` | yes |
| `timer.js` | `KO.timer.createTimer/start/pause/reset/adjust/elapsed/shown/display/mergeTimer` | yes |
| `schedule-gen.js` | `KO.schedule.roundRobin/bracket/assignSlots` | yes |
| `local-db.js` | `KO.createLocalDb()` — sandbox stand-in for the Firebase database | — |
| `brand.css` | Colours, fonts, buttons, tabs, chips, cards (2027 navy/gold design) | — |

---

## Pages

| Page | Files | Reads | For |
|---|---|---|---|
| `index.html` | `src/public/*` | `published/` + `event/banner` | Spectators (phone-first) |
| `admin.html` | `src/admin/*` | `live/` (+ publishedAt) | Scorekeepers, organizers |
| `tv.html` | `src/tv/*` | `live/` (incl. timers) | Venue screens |

All three use the same `helpers.divisionView()` → standings + `resolveBracket()`, so a
bracket can never look different on the public site, admin and TVs.

**Public** (`#`, `#schedule`, `#playoffs`, `#team=<id>`, `#myteam`, `#info`): hero + find
your team + live scores + sports + past champions; schedule by day/division; standings +
bracket per division; team page (next game, field, results); My Team remembered on the
device; venue, rules, conduct, langar, past champions, 2026 partners.
Event text (venue, days, formats, champions history) lives in `src/public/config.js`.

**Admin** (`#score`, `#game=<id>`, `#teams`, `#schedule`, `#standings`, `#publish`):
- Every game change runs `scoring.js` inside a **transaction**, so it applies to the latest
  saved game (two +1 taps both count; an offline phone can't overwrite newer scores).
- Schedule is built for a whole sport at once (all divisions share the fields/gyms).
- Timers: start/pause/set time/reset — only reset changes duration (timer rule 3).

**TV** (`#board=<sport>`, `#court=<name>&sport=<sport>`, `#bracket=<sport>`): auto-rotating
divisions every 12 s; court screens show the running clock.

How they connect:

```
schedule-gen  ──games──▶  (scorekeeper enters results)  ──▶  standings  ──seeds──▶  cascade
   bracket() games carry source1/source2; cascade fills in the teams on every render
```

### IDs

- Teams: `{team-name}-{sport}-{division}` (e.g. `babbar-khalsa-ballers-soccer-d1`)
- Games: `{sport}-{division}-{round}-{slot}`. Rounds: `rr` round robin, `ga`/`gb` soccer
  group A/B, `qf`, `sf`, `final`, `third`.

### Game shape

```js
{
  id, sport, division, round, status: 'scheduled' | 'live' | 'final',
  team1Id, team2Id,              // round robin
  source1, source2,              // bracket: { seed: '1' | 'A1' } | { winnerOf: id } | { loserOf: id }
  score1, score2,                // volleyball: CURRENT set's score
  sets, currentSet, setsWon1, setsWon2,   // volleyball only — best of 3
  winnerId,                      // scorekeeper's pick for a tie (soccer penalties)
  forfeitBy: 1 | 2,              // no-show in one game
  court, slot, startsAt, endsAt  // from assignSlots
  updatedAt: { field: ms }       // one stamp per changed field (scoring.applyPatch)
}
```

---

## Decisions

### Bracket cascade (`cascade.js`)
- **Matchups are computed on every render, never copied forward and saved.** The 2026 bug
  (QF winners missing from SF cards, SF winners missing from the Final) came from a copy
  step that didn't always run. Now there is no copy step.
- A game counts once `status: 'final'`. Winner = higher score (volleyball: sets won). A tie
  needs `winnerId`.
- **DQ:** played results stand; the DQ'd team's next opponent advances by walkover. If both
  teams in a game are out, the next round shows "No team" and the other slot advances.
- Bad data (missing feeder game, loops, tied with no winner) produces an error or a
  `result.problem` message for admin — never a silent blank.

### Standings (`standings.js`)
| | Primary | Then |
|---|---|---|
| Soccer | points W3 D1 L0 | head-to-head → goal diff → goals scored |
| Basketball | wins | head-to-head → point diff → points scored |
| Volleyball | wins (best of 3) | head-to-head → set diff → point diff → points scored |

- Head-to-head only when **exactly two** teams are tied.
- Difference capped per game: **soccer ±5, basketball ±20, volleyball ±15** (review).
- Forfeits (same as 2026): basketball/volleyball ±10 diff (volleyball also 2–0 in sets);
  soccer +3 / −3 points.
- DQ'd teams: listed last, no seed; their played games still count for opponents.
- Unbreakable ties are flagged `needsTiebreak`; admin settles them with `manualOrder` (coin flip).

### Timer (`timer.js`)
2026 timers reset mid-game because (a) one timestamp covered the whole timer, so a stale
copy could replace a running one, (b) device clocks decided "newer", and (c) duration could
be changed from several places. Now:
- `running`, `startedAt`, `accumulated` change together and win/lose a merge together.
- **Only `reset()` changes duration.** In a merge, a running timer keeps the duration of the
  run that's on the clock — a stale copy with a newer duration stamp can't change it.
- Exact timestamp ties resolve the same way on every device.
- Countdown stops at 00:00 (`isTimeUp`); volleyball counts up with no limit.
- Clock corrections (`adjust`) change elapsed time, never duration.
- Half/period number is a game field, not part of the timer.

### Schedule (`schedule-gen.js`)
- Round robin via the circle method. `gamesPerTeam` limits games (2026: basketball 3,
  volleyball 2). Soccer groups play a full round robin inside each group.
- Bracket templates: `top8` (QF 1v8, 4v5, 2v7, 3v6), `top4` (SF 1v4, 2v3),
  `groups2` (SF A1vB2, B1vA2); all end with Final + 3rd place.
- `assignSlots` fills courts greedily: no double-booking, optional rest gap
  (`minRestSlots`), bracket games after their feeders. Divisions sharing courts never collide.
- Not handled yet: hand-picked "protected" matchups (2026 seeded RR so top teams didn't meet)
  and teams entered in two sports on the same day. Admin will be able to edit games by hand.

---

## Testing

Every function in `src/shared/` is tested before any UI uses it — see [tests/README.md](tests/README.md).
Open `tests/run.html` in a browser, or run `node tests/<name>.test.js`.

## Timeline

- Shared foundation + tests ✅
- Public pages ✅
- Admin + auth, teams, scheduling, live scoring ✅ (auth untested until Firebase is configured)
- TV screens ✅
- Next: paste Firebase config ([SETUP.md](SETUP.md)), volunteer dry runs, polish

**Out of scope for 2027:** bilingual UI, video highlights, historical archive, native apps,
spectator accounts, cross-division play.
