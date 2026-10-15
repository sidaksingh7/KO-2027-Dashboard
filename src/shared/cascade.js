/*
 * KO 2027 — Bracket cascade.
 *
 * ONE function, resolveBracket(), used by admin, public and TV pages.
 * Matchups are never copied forward and saved; every page recomputes them from
 * the finished results each time it renders, so a QF winner always shows on its
 * SF card and an SF winner always shows on the Final card.
 *
 * GAME SHAPE (input)
 *   {
 *     source1: { seed: '1' } | { seed: 'A1' } | { winnerOf: gameId } | { loserOf: gameId } | { teamId: id },
 *     source2: (same),
 *     status: 'scheduled' | 'live' | 'final',
 *     score1, score2,          // numbers
 *     setsWon1, setsWon2,      // volleyball only — if present, sets decide the winner
 *     winnerId,                // optional: scorekeeper's pick (needed when the score is tied)
 *     name                     // optional display name, e.g. 'QF1' (otherwise built from the id)
 *   }
 *   Games with no source1/source2 use team1Id/team2Id directly (e.g. round-robin games).
 *
 * OUTPUT — a new object, same keys; each game gets:
 *   slot1, slot2: { teamId, label, dq, empty }
 *       teamId  the team in this slot, or null while still undecided
 *       label   what to show when teamId is null ('Winner of QF1', 'Seed 3', 'No team')
 *       dq      true if this team is disqualified
 *       empty   true if this slot will never get a team (both feeders DQ'd)
 *   result: { decided, winnerId, loserId, walkover, problem }
 *       decided   true once the winner (or "no team") is known
 *       walkover  true if decided by DQ / no opponent instead of a played result
 *       problem   message for the scorekeeper when data needs fixing, else null
 *
 * RULES
 *   1. A game counts once status is 'final'. Winner = higher score (volleyball: more sets).
 *      A tie needs winnerId set by the scorekeeper.
 *   2. A DQ'd team's played games keep their results. In its next unplayed game the
 *      opponent advances by walkover.
 *   3. If both teams in a game are out (DQ'd or "No team"), the next round gets
 *      "No team" and whoever is in the other slot advances.
 */
(function (root) {
  'use strict';

  var ROUND_NAMES = { qf: 'QF', sf: 'SF', final: 'Final', third: '3rd Place' };

  // 'basketball-d1-qf-1' → 'QF1', 'basketball-d1-final-1' → 'Final',
  // 'soccer-d1-rr-4' → 'Game 4', 'soccer-d1-ga-2' → 'Group A · Game 2'
  function gameName(gameId, game) {
    if (game && game.name) return game.name;
    var parts = gameId.split('-');
    var slot = parts[parts.length - 1];
    var round = parts[parts.length - 2];
    if (round === 'final' || round === 'third') return ROUND_NAMES[round];
    if (round === 'rr') return 'Game ' + slot;
    if (/^g[a-z]$/.test(round)) return 'Group ' + round.charAt(1).toUpperCase() + ' · Game ' + slot;
    return (ROUND_NAMES[round] || String(round).toUpperCase()) + slot;
  }

  function toDqSet(dqTeamIds) {
    var set = {};
    if (Array.isArray(dqTeamIds)) {
      dqTeamIds.forEach(function (id) { set[id] = true; });
    } else if (dqTeamIds) {
      // Firebase-style map: { teamId: true }
      Object.keys(dqTeamIds).forEach(function (id) { if (dqTeamIds[id]) set[id] = true; });
    }
    return set;
  }

  function resolveBracket(games, seeds, dqTeamIds) {
    games = games || {};
    seeds = seeds || {};
    var dq = toDqSet(dqTeamIds);
    var resolved = {};
    var inProgress = {};

    function teamSlot(teamId, label) {
      return { teamId: teamId, label: label, dq: !!dq[teamId], empty: false };
    }
    function pendingSlot(label) {
      return { teamId: null, label: label, dq: false, empty: false };
    }
    function emptySlot() {
      return { teamId: null, label: 'No team', dq: false, empty: true };
    }

    function resolveSlot(gameId, game, n) {
      var source = game['source' + n];
      if (!source) {
        var fixed = game['team' + n + 'Id'];
        return fixed ? teamSlot(fixed, fixed) : pendingSlot('TBD');
      }
      if (source.teamId) return teamSlot(source.teamId, source.teamId);
      if (source.seed != null) {
        var seeded = seeds[source.seed];
        var label = 'Seed ' + source.seed;
        return seeded ? teamSlot(seeded, label) : pendingSlot(label);
      }
      var fromId = source.winnerOf || source.loserOf;
      if (!fromId) {
        throw new Error(gameId + ' source' + n + ' must have one of: seed, winnerOf, loserOf, teamId');
      }
      if (!games[fromId]) {
        throw new Error(gameId + ' source' + n + ' points to missing game "' + fromId + '"');
      }
      var from = resolveGame(fromId);
      var isWinner = !!source.winnerOf;
      var label2 = (isWinner ? 'Winner of ' : 'Loser of ') + gameName(fromId, games[fromId]);
      if (!from.result.decided) return pendingSlot(label2);
      var id = isWinner ? from.result.winnerId : from.result.loserId;
      return id ? teamSlot(id, label2) : emptySlot();
    }

    function decided(winnerId, loserId, walkover) {
      return { decided: true, winnerId: winnerId, loserId: loserId, walkover: walkover, problem: null };
    }
    function undecided(problem) {
      return { decided: false, winnerId: null, loserId: null, walkover: false, problem: problem || null };
    }

    // Winner of a game where both teams are known and the game is final.
    function playedResult(game, t1, t2) {
      if (game.winnerId) {
        if (game.winnerId === t1) return decided(t1, t2, false);
        if (game.winnerId === t2) return decided(t2, t1, false);
        return undecided('Saved winner "' + game.winnerId + '" is not in this game — re-pick the winner');
      }
      var useSets = typeof game.setsWon1 === 'number' || typeof game.setsWon2 === 'number';
      var a = useSets ? game.setsWon1 : game.score1;
      var b = useSets ? game.setsWon2 : game.score2;
      if (typeof a !== 'number' || typeof b !== 'number') {
        return undecided('Marked final but ' + (useSets ? 'sets won' : 'score') + ' is missing');
      }
      if (a > b) return decided(t1, t2, false);
      if (b > a) return decided(t2, t1, false);
      return undecided('Tied — scorekeeper must pick a winner');
    }

    function gameResult(game, s1, s2) {
      var known1 = !!s1.teamId;
      var known2 = !!s2.teamId;

      // Rule 2: a played game keeps its result, even if a team was DQ'd afterwards.
      if (known1 && known2 && game.status === 'final') return playedResult(game, s1.teamId, s2.teamId);

      var out1 = s1.empty || s1.dq;
      var out2 = s2.empty || s2.dq;
      var active1 = known1 && !s1.dq;
      var active2 = known2 && !s2.dq;

      // Rule 3: nobody left to play.
      if (out1 && out2) return decided(null, null, true);
      // Walkover: one side is out, the other has a team.
      if (out1 && active2) return decided(s2.teamId, s1.teamId, true);
      if (out2 && active1) return decided(s1.teamId, s2.teamId, true);

      if (game.status === 'final') return undecided('Marked final but a team slot is not decided yet');
      return undecided(null);
    }

    function resolveGame(gameId) {
      if (resolved[gameId]) return resolved[gameId];
      if (inProgress[gameId]) throw new Error('Bracket loop: ' + gameId + ' depends on itself');
      inProgress[gameId] = true;

      var game = games[gameId];
      var s1 = resolveSlot(gameId, game, 1);
      var s2 = resolveSlot(gameId, game, 2);
      var out = {};
      Object.keys(game).forEach(function (k) { out[k] = game[k]; });
      out.slot1 = s1;
      out.slot2 = s2;
      out.result = gameResult(game, s1, s2);

      delete inProgress[gameId];
      resolved[gameId] = out;
      return out;
    }

    Object.keys(games).forEach(resolveGame);
    return resolved;
  }

  var api = { resolveBracket: resolveBracket, gameName: gameName };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.KO = root.KO || {};
    root.KO.resolveBracket = resolveBracket;
    root.KO.gameName = gameName;
  }
})(typeof window !== 'undefined' ? window : this);
