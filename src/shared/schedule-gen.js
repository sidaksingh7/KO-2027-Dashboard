/*
 * KO 2027 — Schedule generators.
 *
 *   KO.schedule.roundRobin(sport, division, teamIds, { gamesPerTeam, group })
 *       Round-robin games. Full round robin by default; gamesPerTeam limits it
 *       (2026: basketball 3, volleyball 2 games per team).
 *   KO.schedule.bracket(sport, division, format)
 *       Empty bracket games wired for KO.resolveBracket(). format:
 *         'top8'    QF (1v8, 4v5, 2v7, 3v6) → SF → Final + 3rd    (basketball-style)
 *         'top4'    SF (1v4, 2v3) → Final + 3rd                    (volleyball-style)
 *         'groups2' SF (A1vB2, B1vA2) → Final + 3rd                (soccer-style)
 *   KO.schedule.assignSlots(games, { courts, startsAt, slotMs, minRestSlots })
 *       Gives each game a court + start time (ms epoch). No team is double-booked.
 *
 * Every function returns a NEW games map keyed by game id:
 *   {sport}-{division}-{round}-{slot}, e.g. 'soccer-d1-rr-7', 'basketball-d2-qf-1'.
 * Group games use round 'ga' / 'gb' (group A / B), e.g. 'soccer-d1-ga-3'.
 */
(function (root) {
  'use strict';

  function newGame(sport, division, round, slot, extra) {
    var game = {
      id: sport + '-' + division + '-' + round + '-' + slot,
      sport: sport,
      division: division,
      round: round,
      status: 'scheduled',
      score1: 0,
      score2: 0
    };
    if (sport === 'volleyball') {
      game.sets = [];
      game.currentSet = 1;
      game.setsWon1 = 0;
      game.setsWon2 = 0;
    }
    Object.keys(extra || {}).forEach(function (k) { game[k] = extra[k]; });
    return game;
  }

  // Circle method: returns rounds, each a list of [teamA, teamB] pairs.
  // With an odd number of teams one team sits out each round.
  function circleRounds(teamIds) {
    var list = teamIds.slice();
    if (list.length % 2 === 1) list.push(null); // null = bye
    var n = list.length;
    var rounds = [];
    for (var r = 0; r < n - 1; r++) {
      var pairs = [];
      for (var i = 0; i < n / 2; i++) {
        var a = list[i];
        var b = list[n - 1 - i];
        if (a !== null && b !== null) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
      }
      rounds.push(pairs);
      // keep list[0] fixed, rotate the rest one step
      list.splice(1, 0, list.pop());
    }
    return rounds;
  }

  function roundRobin(sport, division, teamIds, opts) {
    opts = opts || {};
    if (!teamIds || teamIds.length < 2) throw new Error('Need at least 2 teams');
    var seen = {};
    teamIds.forEach(function (id) {
      if (seen[id]) throw new Error('Team listed twice: ' + id);
      seen[id] = true;
    });

    var rounds = circleRounds(teamIds);
    var limit = opts.gamesPerTeam;
    if (limit != null) {
      if (!(limit >= 1) || limit > teamIds.length - 1) {
        throw new Error('gamesPerTeam must be between 1 and ' + (teamIds.length - 1));
      }
    }

    var roundCode = opts.group ? 'g' + String(opts.group).toLowerCase() : 'rr';
    var played = {};
    teamIds.forEach(function (id) { played[id] = 0; });

    var games = {};
    var slot = 0;
    rounds.forEach(function (pairs, r) {
      pairs.forEach(function (pair) {
        if (limit != null && (played[pair[0]] >= limit || played[pair[1]] >= limit)) return;
        played[pair[0]]++;
        played[pair[1]]++;
        var extra = { team1Id: pair[0], team2Id: pair[1], roundNumber: r + 1 };
        if (opts.group) extra.group = opts.group;
        var g = newGame(sport, division, roundCode, ++slot, extra);
        games[g.id] = g;
      });
    });
    return games;
  }

  var FORMATS = {
    top8: function (p) {
      return [
        ['qf', 1, { seed: '1' }, { seed: '8' }],
        ['qf', 2, { seed: '4' }, { seed: '5' }],
        ['qf', 3, { seed: '2' }, { seed: '7' }],
        ['qf', 4, { seed: '3' }, { seed: '6' }],
        ['sf', 1, { winnerOf: p + 'qf-1' }, { winnerOf: p + 'qf-2' }],
        ['sf', 2, { winnerOf: p + 'qf-3' }, { winnerOf: p + 'qf-4' }]
      ];
    },
    top4: function () {
      return [
        ['sf', 1, { seed: '1' }, { seed: '4' }],
        ['sf', 2, { seed: '2' }, { seed: '3' }]
      ];
    },
    groups2: function () {
      return [
        ['sf', 1, { seed: 'A1' }, { seed: 'B2' }],
        ['sf', 2, { seed: 'B1' }, { seed: 'A2' }]
      ];
    }
  };

  function bracket(sport, division, format) {
    if (!FORMATS[format]) {
      throw new Error('Unknown bracket format "' + format + '". Expected: ' + Object.keys(FORMATS).join(', '));
    }
    var p = sport + '-' + division + '-';
    var rows = FORMATS[format](p).concat([
      ['final', 1, { winnerOf: p + 'sf-1' }, { winnerOf: p + 'sf-2' }],
      ['third', 1, { loserOf: p + 'sf-1' }, { loserOf: p + 'sf-2' }]
    ]);
    var games = {};
    rows.forEach(function (r) {
      var g = newGame(sport, division, r[0], r[1], { source1: r[2], source2: r[3] });
      games[g.id] = g;
    });
    return games;
  }

  // Greedy slot filling, in the order given (round by round). Each game goes in
  // the earliest slot where a court is free and neither team is already playing
  // (or played within the last minRestSlots slots).
  // Bracket games (no teams yet) go after everything they depend on: seeded games
  // after that division's last round-robin game, later rounds after their feeders.
  function assignSlots(games, opts) {
    opts = opts || {};
    var courts = opts.courts;
    if (!courts || !courts.length) throw new Error('assignSlots needs at least one court');
    if (!(opts.slotMs > 0)) throw new Error('assignSlots needs slotMs (length of one slot in ms)');
    var startsAt = opts.startsAt || 0;
    var rest = opts.minRestSlots || 0;

    var all = Object.keys(games);
    var withTeams = all.filter(function (id) { return games[id].team1Id; });
    var bracketIds = all.filter(function (id) { return !games[id].team1Id; });
    withTeams.sort(function (a, b) { return (games[a].roundNumber || 0) - (games[b].roundNumber || 0); });

    var courtBusy = [];   // courtBusy[slot] = courts used in that slot
    var teamSlots = {};   // teamId → [slots]
    var slotOf = {};      // gameId → slot
    var lastRR = {};      // 'sport-division' → last round-robin slot
    var out = {};

    function teamFree(id, slot) {
      return (teamSlots[id] || []).every(function (s) { return Math.abs(s - slot) > rest; });
    }

    function place(id, earliest) {
      var g = games[id];
      var slot = earliest;
      while (
        (courtBusy[slot] || 0) >= courts.length ||
        (g.team1Id && (!teamFree(g.team1Id, slot) || !teamFree(g.team2Id, slot)))
      ) {
        slot++;
        if (slot > 10000) throw new Error('Could not fit ' + id + ' into the schedule');
      }
      var copy = {};
      Object.keys(g).forEach(function (k) { copy[k] = g[k]; });
      copy.court = courts[courtBusy[slot] || 0];
      copy.slot = slot + 1;
      copy.startsAt = startsAt + slot * opts.slotMs;
      courtBusy[slot] = (courtBusy[slot] || 0) + 1;
      slotOf[id] = slot;
      out[id] = copy;
      return slot;
    }

    withTeams.forEach(function (id) {
      var g = games[id];
      var slot = place(id, 0);
      (teamSlots[g.team1Id] = teamSlots[g.team1Id] || []).push(slot);
      (teamSlots[g.team2Id] = teamSlots[g.team2Id] || []).push(slot);
      var key = g.sport + '-' + g.division;
      lastRR[key] = Math.max(lastRR[key] == null ? -1 : lastRR[key], slot);
    });

    // Bracket games: keep placing any whose feeders are all placed.
    var left = bracketIds.slice();
    while (left.length) {
      var progress = false;
      left = left.filter(function (id) {
        var g = games[id];
        var earliest = 0;
        var ready = true;
        [g.source1, g.source2].forEach(function (src) {
          if (!src) return;
          var from = src.winnerOf || src.loserOf;
          if (from) {
            if (slotOf[from] == null) { ready = from in games ? false : ready; return; }
            earliest = Math.max(earliest, slotOf[from] + 1);
          } else if (src.seed != null) {
            var last = lastRR[g.sport + '-' + g.division];
            if (last != null) earliest = Math.max(earliest, last + 1);
          }
        });
        if (!ready) return true;
        place(id, earliest);
        progress = true;
        return false;
      });
      if (!progress) throw new Error('Bracket games depend on each other in a loop: ' + left.join(', '));
    }
    return out;
  }

  var api = {
    roundRobin: roundRobin,
    bracket: bracket,
    assignSlots: assignSlots,
    FORMATS: Object.keys(FORMATS)
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.KO = root.KO || {};
    root.KO.schedule = api;
  }
})(typeof window !== 'undefined' ? window : this);
