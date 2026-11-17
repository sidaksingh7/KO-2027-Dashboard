/*
 * KO 2027 — Team and player stats (pure).
 *
 * Input is a division view from helpers.divisionView(): games with resolved
 * teams (g.t1.id / g.t2.id), results, scoring events, and view.teams with rosters:
 *   teams: { teamId: { name, roster: { playerId: { name, number } } } }
 *
 *   KO.stats.teamStats(view)       → rows, best first
 *   KO.stats.playerStats(view)     → rows, best first
 *   KO.stats.boxScore(game, view)  → { side1: [...], side2: [...] } per-player lines
 *
 * Scoring events (src/admin/scoring.js) say who scored:
 *   soccer 'goal' / 'yellow' / 'red'; basketball 'pts' (1, 2 or 3);
 *   volleyball 'kill' / 'ace' / 'block' / 'opp-error' (no player).
 */
(function (root) {
  'use strict';

  var STAGE = { pool: 0, qf: 1, sf: 2, third: 3, final: 4 };
  var STAGE_NAME = ['Pool', 'Quarterfinal', 'Semifinal', '3rd place game', 'Final'];

  function arr(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x.filter(Boolean);
    return Object.keys(x).sort(function (a, b) { return a - b; }).map(function (k) { return x[k]; }).filter(Boolean);
  }

  function played(g) { return g.status === 'live' || g.status === 'final'; }

  // Points actually scored in a game, per side (volleyball: all rally points).
  function gamePoints(g) {
    if (g.sport === 'volleyball') {
      var a = 0, b = 0;
      arr(g.sets).forEach(function (s) { a += s.s1 || 0; b += s.s2 || 0; });
      if (g.status === 'live') { a += g.score1 || 0; b += g.score2 || 0; }
      return [a, b];
    }
    return [g.score1 || 0, g.score2 || 0];
  }

  // Ranks with ties sharing a number: keyFn returns an array compared in order.
  function rank(rows, keyFn) {
    var prev = null, r = 0;
    rows.forEach(function (row, i) {
      var k = JSON.stringify(keyFn(row));
      if (k !== prev) { r = i + 1; prev = k; }
      row.rank = r;
    });
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Teams
  // ---------------------------------------------------------------------------

  function teamStats(view) {
    var sport = view.sport;
    var rows = {};
    Object.keys(view.teams || {}).forEach(function (id) {
      rows[id] = {
        teamId: id, name: view.teams[id].name, gp: 0, w: 0, l: 0, d: 0,
        pf: 0, pa: 0, diff: 0, setsW: 0, setsL: 0, form: [], bigWin: 0,
        stage: 0, place: null
      };
    });

    var games = (view.games || []).slice().sort(function (a, b) { return (a.startsAt || 0) - (b.startsAt || 0); });
    games.forEach(function (g) {
      var ids = [g.t1 && g.t1.id, g.t2 && g.t2.id];
      // how far each team got: any bracket game they're in
      if (g.isBracket) {
        ids.forEach(function (id) {
          if (rows[id]) rows[id].stage = Math.max(rows[id].stage, STAGE[g.round] || 0);
        });
      }
      if (g.status !== 'final' || !rows[ids[0]] || !rows[ids[1]]) return;
      var pts = gamePoints(g);
      var r = g.result || {};
      [0, 1].forEach(function (i) {
        var me = rows[ids[i]];
        var mine = pts[i], theirs = pts[1 - i];
        me.gp++;
        if (!g.forfeitBy) { me.pf += mine; me.pa += theirs; }
        if (sport === 'volleyball') {
          me.setsW += i === 0 ? (g.setsWon1 || 0) : (g.setsWon2 || 0);
          me.setsL += i === 0 ? (g.setsWon2 || 0) : (g.setsWon1 || 0);
        }
        var out;
        if (r.decided && r.winnerId) out = r.winnerId === ids[i] ? 'W' : 'L';
        else if (!g.isBracket && mine === theirs) out = 'D';
        else out = mine > theirs ? 'W' : 'L';
        if (out === 'W') { me.w++; if (!g.forfeitBy) me.bigWin = Math.max(me.bigWin, mine - theirs); }
        else if (out === 'L') me.l++;
        else me.d++;
        me.form.push(out);
      });
    });

    // Final placings from the medal games
    function placeFrom(round, first, second) {
      var g = (view.games || []).filter(function (x) { return x.round === round; })[0];
      if (!g || !g.result || !g.result.decided) return;
      if (g.result.winnerId && rows[g.result.winnerId]) rows[g.result.winnerId].place = first;
      if (g.result.loserId && rows[g.result.loserId]) rows[g.result.loserId].place = second;
    }
    placeFrom('final', 1, 2);
    placeFrom('third', 3, 4);

    var standingsOrder = {};
    (view.standings || []).forEach(function (s, i) { standingsOrder[s.teamId] = i; });

    var list = Object.keys(rows).map(function (id) {
      var x = rows[id];
      x.diff = x.pf - x.pa;
      x.ppg = x.gp ? x.pf / x.gp : 0;
      x.papg = x.gp ? x.pa / x.gp : 0;
      x.reached = STAGE_NAME[x.stage];
      x.form = x.form.slice(-5);
      return x;
    });
    function key(x) {
      return [x.place || 99, -x.stage, standingsOrder[x.teamId] == null ? 999 : standingsOrder[x.teamId]];
    }
    list.sort(function (a, b) {
      var ka = key(a), kb = key(b);
      for (var i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return a.name.localeCompare(b.name);
    });
    return rank(list, key);
  }

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------

  function blankPlayer(teamId, team, pid, p) {
    return {
      playerId: pid, name: p ? p.name : 'Unknown player', number: p && p.number != null ? p.number : '',
      teamId: teamId, team: team ? team.name : teamId, gp: 0,
      pts: 0, goals: 0, yellow: 0, red: 0, ft: 0, fg2: 0, fg3: 0,
      kill: 0, ace: 0, block: 0, high: 0
    };
  }

  // Adds one event to a player line.
  function addEvent(line, e) {
    if (e.kind === 'goal') { line.goals += 1; line.pts += 1; }
    else if (e.kind === 'yellow') line.yellow += 1;
    else if (e.kind === 'red') line.red += 1;
    else if (e.kind === 'pts') {
      line.pts += e.pts;
      if (e.pts === 1) line.ft++; else if (e.pts === 2) line.fg2++; else if (e.pts === 3) line.fg3++;
    } else if (e.kind === 'kill' || e.kind === 'ace' || e.kind === 'block') {
      line[e.kind] += 1; line.pts += 1;
    }
  }

  function playerStats(view) {
    var sport = view.sport;
    var teams = view.teams || {};
    var lines = {};
    function line(teamId, pid) {
      var k = teamId + '|' + pid;
      if (!lines[k]) {
        var roster = (teams[teamId] && teams[teamId].roster) || {};
        lines[k] = blankPlayer(teamId, teams[teamId], pid, roster[pid]);
      }
      return lines[k];
    }
    // everyone on a roster appears, even with no points yet
    Object.keys(teams).forEach(function (tid) {
      Object.keys(teams[tid].roster || {}).forEach(function (pid) { line(tid, pid); });
    });

    (view.games || []).forEach(function (g) {
      if (!played(g)) return;
      var ids = [g.t1 && g.t1.id, g.t2 && g.t2.id];
      // games played: every roster player of both teams
      ids.forEach(function (tid) {
        if (!tid || !teams[tid]) return;
        Object.keys(teams[tid].roster || {}).forEach(function (pid) { line(tid, pid).gp++; });
      });
      var inGame = {};
      arr(g.events).forEach(function (e) {
        if (!e.playerId) return;
        var tid = ids[e.side - 1];
        if (!tid) return;
        var l = line(tid, e.playerId);
        addEvent(l, e);
        if (e.pts) inGame[tid + '|' + e.playerId] = (inGame[tid + '|' + e.playerId] || 0) + (e.kind === 'goal' ? 1 : e.pts);
      });
      Object.keys(inGame).forEach(function (k) { lines[k].high = Math.max(lines[k].high, inGame[k]); });
    });

    var list = Object.keys(lines).map(function (k) {
      var x = lines[k];
      x.ppg = x.gp ? x.pts / x.gp : 0;
      return x;
    });
    var key = function (x) {
      if (sport === 'soccer') return [-x.goals, x.red, x.yellow];
      return [-x.pts, -x.ppg];
    };
    list.sort(function (a, b) {
      var ka = key(a), kb = key(b);
      for (var i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return a.name.localeCompare(b.name);
    });
    return rank(list, key);
  }

  // Per-player lines for one game: { side1: [line], side2: [line], noPlayer: [n1, n2] }
  function boxScore(game, view) {
    var teams = (view && view.teams) || {};
    var ids = [game.t1 && game.t1.id, game.t2 && game.t2.id];
    var out = { side1: [], side2: [], noPlayer: [0, 0] };
    [0, 1].forEach(function (i) {
      var tid = ids[i];
      var roster = (tid && teams[tid] && teams[tid].roster) || {};
      var lines = {};
      Object.keys(roster).forEach(function (pid) { lines[pid] = blankPlayer(tid, teams[tid], pid, roster[pid]); });
      arr(game.events).forEach(function (e) {
        if (e.side !== i + 1) return;
        if (!e.playerId) { out.noPlayer[i] += e.pts || 0; return; }
        if (!lines[e.playerId]) lines[e.playerId] = blankPlayer(tid, teams[tid], e.playerId, null);
        addEvent(lines[e.playerId], e);
      });
      out['side' + (i + 1)] = Object.keys(lines).map(function (k) { return lines[k]; })
        .sort(function (a, b) { return b.pts - a.pts || b.goals - a.goals || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }); });
    });
    return out;
  }

  // Roster text → { playerId: { name, number } }. One player per line:
  //   "24 Sandhu", "#7 Gurpreet Singh", "Harjot Kaur" (no number)
  function parseRoster(text, slugify) {
    var roster = {};
    var errors = [];
    String(text || '').split(/\r?\n/).forEach(function (raw, i) {
      var line = raw.trim();
      if (!line) return;
      var m = /^#?\s*(\d{1,3})\s*[-–.:)]?\s+(.+)$/.exec(line);
      var number = m ? m[1] : '';
      var name = (m ? m[2] : line).replace(/\s+/g, ' ').trim();
      if (!name) { errors.push('Line ' + (i + 1) + ' has no name'); return; }
      var id = slugify((number ? number + '-' : '') + name);
      if (roster[id]) { errors.push(name + ' is listed twice'); return; }
      roster[id] = { name: name, number: number };
    });
    return { roster: roster, errors: errors };
  }

  function rosterText(roster) {
    return Object.keys(roster || {}).map(function (k) { return roster[k]; })
      .sort(function (a, b) { return String(a.number).localeCompare(String(b.number), undefined, { numeric: true }) || a.name.localeCompare(b.name); })
      .map(function (p) { return (p.number !== '' && p.number != null ? p.number + ' ' : '') + p.name; }).join('\n');
  }

  var api = {
    teamStats: teamStats,
    playerStats: playerStats,
    boxScore: boxScore,
    parseRoster: parseRoster,
    rosterText: rosterText,
    STAGE_NAME: STAGE_NAME
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.KO = root.KO || {};
    root.KO.stats = api;
  }
})(typeof window !== 'undefined' ? window : this);
