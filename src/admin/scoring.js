/*
 * KO 2027 — Scorekeeper actions (pure).
 *
 * Each action takes the CURRENT game and returns either
 *   { patch: { field: value, ... } }   fields to change, or
 *   { error: 'message' }               action not allowed right now.
 *
 * applyPatch(game, patch, now) returns the new game with an updatedAt stamp per
 * changed field (principle 4). Admin runs actions inside a database transaction,
 * so they always apply to the latest saved game — two +1 taps both count.
 *
 * Volleyball: score1/score2 are the CURRENT set. endSet() moves them into sets[]
 * and the match finishes automatically when a team wins 2 sets (best of 3).
 */
(function (root) {
  'use strict';

  var SETS_TO_WIN = 2;

  function ok(patch) { return { patch: patch }; }
  function err(msg) { return { error: msg }; }

  function sideKey(side) {
    if (side !== 1 && side !== 2) throw new Error('side must be 1 or 2');
    return 'score' + side;
  }

  function startGame(game) {
    if (game.status === 'live') return err('Game is already live');
    if (game.status === 'final') return err('Game is final — reopen it first');
    return ok({ status: 'live' });
  }

  // n can be negative (undo). Scores never go below 0.
  function addPoints(game, side, n) {
    if (game.status !== 'live') return err('Start the game before scoring');
    var key = sideKey(side);
    var next = Math.max(0, (game[key] || 0) + n);
    if (next === (game[key] || 0)) return err('Score is already 0');
    var patch = {};
    patch[key] = next;
    return ok(patch);
  }

  // Type in a score directly (fixing a mistake). Allowed live or final.
  function setScore(game, s1, s2) {
    if (!(s1 >= 0) || !(s2 >= 0) || s1 % 1 || s2 % 1) return err('Scores must be whole numbers, 0 or more');
    return ok({ score1: s1, score2: s2 });
  }

  function setsArray(game) {
    // Firebase may hand arrays back as objects {0:…,1:…}
    var s = game.sets || [];
    if (!Array.isArray(s)) s = Object.keys(s).sort(function (a, b) { return a - b; }).map(function (k) { return s[k]; });
    return s.filter(Boolean).map(function (x) { return { s1: x.s1 || 0, s2: x.s2 || 0, done: !!x.done }; });
  }

  function endSet(game) {
    if (game.sport !== 'volleyball') return err('Only volleyball has sets');
    if (game.status !== 'live') return err('Start the game before ending a set');
    var a = game.score1 || 0, b = game.score2 || 0;
    if (a === b) return err('A set can’t end tied');
    var sets = setsArray(game).filter(function (s) { return s.done; });
    sets.push({ s1: a, s2: b, done: true });
    var won1 = sets.filter(function (s) { return s.s1 > s.s2; }).length;
    var won2 = sets.length - won1;
    var patch = { sets: sets, setsWon1: won1, setsWon2: won2, score1: 0, score2: 0 };
    if (won1 >= SETS_TO_WIN || won2 >= SETS_TO_WIN) {
      patch.status = 'final';
      // keep the last set's score visible on the card
      patch.score1 = a; patch.score2 = b;
      patch.currentSet = sets.length;
    } else {
      patch.currentSet = sets.length + 1;
    }
    return ok(patch);
  }

  // Undo the last finished set (puts its score back as the current set).
  function undoSet(game) {
    if (game.sport !== 'volleyball') return err('Only volleyball has sets');
    var sets = setsArray(game).filter(function (s) { return s.done; });
    if (!sets.length) return err('No finished set to undo');
    var last = sets.pop();
    var won1 = sets.filter(function (s) { return s.s1 > s.s2; }).length;
    return ok({
      sets: sets, setsWon1: won1, setsWon2: sets.length - won1,
      score1: last.s1, score2: last.s2, currentSet: sets.length + 1, status: 'live'
    });
  }

  // isBracket: playoff games can't end in a tie without a winner pick.
  function finalize(game, isBracket) {
    if (game.status === 'final') return err('Game is already final');
    if (game.status !== 'live') return err('Start the game first');
    if (game.sport === 'volleyball') {
      var w1 = game.setsWon1 || 0, w2 = game.setsWon2 || 0;
      if (w1 === w2) return err('Volleyball: end the deciding set first (sets are ' + w1 + '–' + w2 + ')');
      return ok({ status: 'final' });
    }
    if (isBracket && (game.score1 || 0) === (game.score2 || 0) && !game.winnerId) {
      return err('Playoff game is tied — pick the winner (e.g. penalties) first');
    }
    return ok({ status: 'final' });
  }

  // Scorekeeper's pick for a tied playoff game. null clears it.
  function setWinner(game, teamId, team1Id, team2Id) {
    if (teamId !== null && teamId !== team1Id && teamId !== team2Id) return err('That team isn’t in this game');
    return ok({ winnerId: teamId });
  }

  // side = the team that did NOT show up.
  function forfeit(game, side) {
    sideKey(side);
    if (game.status === 'final' && game.forfeitBy == null) return err('Game is final — reopen it first');
    var patch = { forfeitBy: side, status: 'final', score1: 0, score2: 0 };
    if (game.sport === 'volleyball') {
      patch.setsWon1 = side === 2 ? 2 : 0;
      patch.setsWon2 = side === 1 ? 2 : 0;
      patch.sets = [];
    }
    return ok(patch);
  }

  function clearForfeit(game) {
    if (game.forfeitBy == null) return err('No forfeit to clear');
    return ok({ forfeitBy: null, status: 'live' });
  }

  function reopen(game) {
    if (game.status !== 'final') return err('Game isn’t final');
    return ok({ status: 'live' });
  }

  // New game with the patch applied and each changed field stamped.
  function applyPatch(game, patch, now) {
    var out = {};
    Object.keys(game || {}).forEach(function (k) { out[k] = game[k]; });
    out.updatedAt = {};
    Object.keys((game && game.updatedAt) || {}).forEach(function (k) { out.updatedAt[k] = game.updatedAt[k]; });
    Object.keys(patch).forEach(function (k) {
      if (patch[k] === null) delete out[k];
      else out[k] = patch[k];
      out.updatedAt[k] = now;
    });
    return out;
  }

  var api = {
    startGame: startGame,
    addPoints: addPoints,
    setScore: setScore,
    endSet: endSet,
    undoSet: undoSet,
    finalize: finalize,
    setWinner: setWinner,
    forfeit: forfeit,
    clearForfeit: clearForfeit,
    reopen: reopen,
    applyPatch: applyPatch,
    setsArray: setsArray
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.KO = root.KO || {};
    root.KO.scoring = api;
  }
})(typeof window !== 'undefined' ? window : this);
