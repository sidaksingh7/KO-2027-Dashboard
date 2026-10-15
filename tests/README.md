# Tests

Every file in `src/shared/` has a matching `tests/<name>.test.js`. Tests are plain
JavaScript with `assert` — no test framework to install.

## Run them in the browser (no install)

Open `tests/run.html` in Chrome. It runs every test file and shows a green
"All N tests passed" or red sections for anything that failed (with the reason).

If double-clicking the file shows red errors about scripts not loading, serve the
folder locally instead. In Terminal, from the project folder:

```bash
python3 -m http.server 8027
```

then open http://localhost:8027/tests/run.html.

## Run them with Node

With Node installed (https://nodejs.org → LTS):

```bash
node tests/cascade.test.js
```

Each file prints `ok` per test and `N passed` at the end; a failure stops with the error.

## Adding a test file

1. Create `tests/<name>.test.js` using the same `test(name, fn)` pattern as the others.
2. Add it to the `SUITES` list at the top of the script in `tests/run.html`, with the
   `src/shared/` files it needs.

| File | Covers |
|---|---|
| firebase.test.js | Path helpers, sport/division validation, per-field updatedAt writer |
| cascade.test.js | Bracket resolution, all 3 formats, DQ walkovers, the 2026 QF→SF→Final bug |
| standings.test.js | Points, tiebreaks, difference caps, forfeits, DQ, seeds |
| timer.test.js | Start/pause/reset/adjust, countdown vs stopwatch, sync merge (2026 reset bug) |
| schedule-gen.test.js | Round robin, games-per-team, groups, bracket templates, court/time slots |
| integration.test.js | Schedule → results → standings → seeds → bracket champion |
| public-helpers.test.js | Public page helpers: team search, Toronto times, division views, routing |
| local-db.test.js | Sandbox database (the Firebase stand-in used before config is pasted) |
| scoring.test.js | Scorekeeper actions: points, volleyball sets, finals, playoff ties, forfeits |
