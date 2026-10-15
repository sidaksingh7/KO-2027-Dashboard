/*
 * KO 2027 — Round-robin standings + seeding.
 *
 *   KO.computeStandings(games, teamIds, { sport, groups, dqTeamIds, manualOrder })
 *     → { rows: [...], seeds: { '1': teamId, ... } }      // or { A1, A2, B1, B2, ... } with groups
 *
 * `seeds` plugs straight into KO.resolveBracket().
 *
 * WHICH GAMES COUNT
 *   Round-robin games only: status 'final', team1Id + team2Id set, no source1/source2
 *   (bracket games have sources). With groups, a game counts if both teams are in the same group.
 *
 * RANKING (per sport)
 *   soccer:      points (W3 D1 L0) → head-to-head → goal diff → goals scored
 *   basketball:  wins → head-to-head → point diff → points scored
 *   volleyball:  wins → head-to-head → set diff → point diff → points scored
 *   then:        options.manualOrder (admin's coin-flip order); if still tied, alphabetical
 *                and both rows get needsTiebreak: true so admin can see it.
 *   Head-to-head is only used when exactly 2 teams are tied.
 *   One game can add at most DIFF_CAP[sport] (+ or −) to the difference.
 *
 * FORFEITS (no-show in one game — same rules as 2026)
 *   Game has forfeitBy: 1 or 2 (the side that didn't show). Scores are ignored.
 *   basketball/volleyball: opponent gets the win and +10 diff (volleyball also 2–0 in sets),
 *                          no-show gets the loss and −10.
 *   soccer: opponent gets the win (+3 pts), no-show gets the loss and −3 pts.
 *
 * DISQUALIFIED TEAMS (options.dqTeamIds)
 *   Their played games still count for opponents. They're listed last, marked dq: true,
 *   and never get a seed.
 *
 * VOLLEYBALL: wins come from setsWon1/setsWon2; point diff is summed from sets[] ({ s1, s2 }).
 */
(function (root) {
  'use strict';

  var DIFF_CAP = { soccer: 5, basketball: 20, volleyball: 15 };
  var FORFEIT_DIFF = { basketball: 10, volleyball: 10 };
  var SOCCER_FORFEIT_PENALTY = 3;

  function toSet(list) {
    var set = {};
    if (Array.isArray(list)) list.forEach(function (id) { set[id] = true; });
    else if (list) Object.keys(list).forEach(function (id) { if (list[id]) set[id] = true; });
    return set;
  }

  function cap(n, limit) {
    return Math.max(-limit, Math.min(limit, n));
  }

  function emptyRow(teamId, group) {
    return {
      teamId: teamId, group: group || null, rank: 0,
      played: 0, wins: 0, losses: 0, draws: 0,
      points: 0,               // table points (soccer); for others = wins + 0.5 × draws
      scored: 0, allowed: 0, diff: 0,
      setsWon: 0, setsLost: 0, setDiff: 0,
      dq: false, needsTiebreak: false,
      h2h: {}                  // opponentId → table points earned against them
    };
  }

  // Applies one finished game to the two rows.
  function applyGame(sport, game, r1, r2) {
    var limit = DIFF_CAP[sport];
    r1.played++; r2.played++;

    if (game.forfeitBy === 1 || game.forfeitBy === 2) {
      var win = game.forfeitBy === 1 ? r2 : r1;
      var lose = game.forfeitBy === 1 ? r1 : r2;
      win.wins++; lose.losses++;
      if (sport === 'soccer') {
        win.points += 3;
        lose.points -= SOCCER_FORFEIT_PENALTY;
        addH2h(win, lose, 3, 0);
      } else {
        var amt = FORFEIT_DIFF[sport];
        win.scored += amt; win.diff += amt;
        lose.allowed += amt; lose.diff -= amt;
        if (sport === 'volleyball') {
          win.setsWon += 2; win.setDiff += 2;
          lose.setsLost += 2; lose.setDiff -= 2;
        }
        win.points += 1;
        addH2h(win, lose, 1, 0);
      }
      return;
    }

    var a, b; // the numbers that decide who won
    if (sport === 'volleyball') {
      a = game.setsWon1 || 0;
      b = game.setsWon2 || 0;
      r1.setsWon += a; r1.setsLost += b; r1.setDiff += a - b;
      r2.setsWon += b; r2.setsLost += a; r2.setDiff += b - a;
      var p1 = 0, p2 = 0;
      (game.sets || []).forEach(function (s) {
        if (!s) return;
        p1 += s.s1 || 0;
        p2 += s.s2 || 0;
      });
      addScore(r1, r2, p1, p2, limit);
    } else {
      a = game.score1 || 0;
      b = game.score2 || 0;
      addScore(r1, r2, a, b, limit);
    }

    var winPts = sport === 'soccer' ? 3 : 1;
    var drawPts = sport === 'soccer' ? 1 : 0.5;
    if (a > b) {
      r1.wins++; r2.losses++; r1.points += winPts;
      addH2h(r1, r2, winPts, 0);
    } else if (b > a) {
      r2.wins++; r1.losses++; r2.points += winPts;
      addH2h(r2, r1, winPts, 0);
    } else {
      r1.draws++; r2.draws++; r1.points += drawPts; r2.points += drawPts;
      addH2h(r1, r2, drawPts, drawPts);
    }
  }

  function addScore(r1, r2, s1, s2, limit) {
    var d = cap(s1 - s2, limit);
    r1.scored += s1; r1.allowed += s2; r1.diff += d;
    r2.scored += s2; r2.allowed += s1; r2.diff -= d;
  }

  function addH2h(rA, rB, ptsA, ptsB) {
    rA.h2h[rB.teamId] = (rA.h2h[rB.teamId] || 0) + ptsA;
    rB.h2h[rA.teamId] = (rB.h2h[rA.teamId] || 0) + ptsB;
  }

  // Tiebreak steps after table points, best first (higher is better).
  function tiebreakKeys(sport) {
    if (sport === 'volleyball') return ['setDiff', 'diff', 'scored'];
    return ['diff', 'scored'];
  }

  function rankRows(rows, sport, manualIndex) {
    var keys = tiebreakKeys(sport);

    // 0 means "still tied" after every rule except alphabetical.
    function compare(a, b, useH2h) {
      if (a.dq !== b.dq) return a.dq ? 1 : -1;
      if (b.points !== a.points) return b.points - a.points;
      if (useH2h) {
        var ha = a.h2h[b.teamId] || 0;
        var hb = b.h2h[a.teamId] || 0;
        if (hb !== ha) return hb - ha;
      }
      for (var i = 0; i < keys.length; i++) {
        if (b[keys[i]] !== a[keys[i]]) return b[keys[i]] - a[keys[i]];
      }
      var ma = manualIndex(a.teamId);
      var mb = manualIndex(b.teamId);
      if (ma !== mb) return ma - mb;
      return 0;
    }

    // Count teams sharing (dq, points) so head-to-head only applies to 2-way ties.
    var tieSize = {};
    rows.forEach(function (r) {
      var k = r.dq + '|' + r.points;
      tieSize[k] = (tieSize[k] || 0) + 1;
    });
    function cmp(a, b) {
      var useH2h = a.dq === b.dq && a.points === b.points && tieSize[a.dq + '|' + a.points] === 2;
      return compare(a, b, useH2h) || (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0);
    }

    rows.sort(cmp);
    for (var i = 0; i < rows.length; i++) {
      rows[i].rank = i + 1;
      if (i > 0 && !rows[i].dq && compare(rows[i - 1], rows[i], tieSize[rows[i].dq + '|' + rows[i].points] === 2) === 0) {
        rows[i - 1].needsTiebreak = true;
        rows[i].needsTiebreak = true;
      }
    }
    return rows;
  }

  function computeStandings(games, teamIds, options) {
    options = options || {};
    var sport = options.sport;
    if (!DIFF_CAP.hasOwnProperty(sport)) {
      throw new Error('Unknown sport "' + sport + '"');
    }
    var dq = toSet(options.dqTeamIds);
    var manual = options.manualOrder || [];
    function manualIndex(id) {
      var i = manual.indexOf(id);
      return i === -1 ? Infinity : i;
    }

    // groupOf[teamId] = 'A' | 'B' | null
    var groupOf = {};
    var groupNames = options.groups ? Object.keys(options.groups).sort() : [null];
    if (options.groups) {
      groupNames.forEach(function (g) {
        options.groups[g].forEach(function (id) { groupOf[id] = g; });
      });
    } else {
      (teamIds || []).forEach(function (id) { groupOf[id] = null; });
    }

    var rowsById = {};
    Object.keys(groupOf).forEach(function (id) {
      rowsById[id] = emptyRow(id, groupOf[id]);
      rowsById[id].dq = !!dq[id];
    });

    Object.keys(games || {}).forEach(function (gameId) {
      var g = games[gameId];
      if (!g || g.status !== 'final' || g.source1 || g.source2) return;
      var r1 = rowsById[g.team1Id];
      var r2 = rowsById[g.team2Id];
      if (!r1 || !r2 || r1.group !== r2.group) return;
      applyGame(sport, g, r1, r2);
    });

    var allRows = [];
    var seeds = {};
    groupNames.forEach(function (g) {
      var rows = Object.keys(rowsById)
        .map(function (id) { return rowsById[id]; })
        .filter(function (r) { return r.group === g; });
      rankRows(rows, sport, manualIndex);
      var n = 0;
      rows.forEach(function (r) {
        if (!r.dq) {
          n++;
          seeds[(g || '') + n] = r.teamId;
        }
        allRows.push(r);
      });
    });

    return { rows: allRows, seeds: seeds };
  }

  var api = { computeStandings: computeStandings, DIFF_CAP: DIFF_CAP };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.KO = root.KO || {};
    root.KO.computeStandings = computeStandings;
  }
})(typeof window !== 'undefined' ? window : this);
