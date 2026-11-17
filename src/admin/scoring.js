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

  // ---------------------------------------------------------------------------
  // Scoring events: every point (and soccer card) records WHO did it, for stats.
  //   event = { side: 1|2, pts, kind, playerId|null, set? , at }
  //   kind: soccer 'goal' | 'yellow' | 'red'; basketball 'pts';
  //         volleyball 'kill' | 'ace' | 'block' | 'opp-error' (no player)
  // ---------------------------------------------------------------------------

  var VB_KINDS = ['kill', 'ace', 'block', 'opp-error'];

  function eventsArray(game) {
    var e = game.events || [];
    if (!Array.isArray(e)) e = Object.keys(e).sort(function (a, b) { return a - b; }).map(function (k) { return e[k]; });
    return e.filter(Boolean);
  }

  // A point (or points) for one side, credited to a player.
  //   opts = { playerId, kind, at }
  function scoreEvent(game, side, pts, opts) {
    opts = opts || {};
    if (game.status !== 'live') return err('Start the game before scoring');
    var key = sideKey(side);
    if (!(pts >= 1 && pts <= 3) || pts % 1) return err('Points must be 1, 2 or 3');
    var sport = game.sport;
    var kind = opts.kind || (sport === 'soccer' ? 'goal' : sport === 'volleyball' ? 'kill' : 'pts');
    if (sport === 'volleyball' && VB_KINDS.indexOf(kind) === -1) return err('Unknown volleyball point type');
    if (sport === 'soccer' && kind !== 'goal') return err('Use a card action for cards');
    var player = kind === 'opp-error' ? null : (opts.playerId || null);
    if (!player && kind !== 'opp-error') return err('Pick the player who scored');
    var ev = { side: side, pts: pts, kind: kind, playerId: player, at: opts.at || 0 };
    if (sport === 'volleyball') ev.set = game.currentSet || (setsArray(game).filter(function (x) { return x.done; }).length + 1);
    var patch = {};
    patch[key] = (game[key] || 0) + pts;
    patch.events = eventsArray(game).concat([ev]);
    return ok(patch);
  }

  // Soccer yellow / red card for a player (no score change).
  function cardEvent(game, side, color, playerId, at) {
    if (game.sport !== 'soccer') return err('Cards are for soccer');
    if (game.status !== 'live') return err('Start the game first');
    sideKey(side);
    if (color !== 'yellow' && color !== 'red') return err('Card must be yellow or red');
    if (!playerId) return err('Pick the player');
    return ok({ events: eventsArray(game).concat([{ side: side, pts: 0, kind: color, playerId: playerId, at: at || 0 }]) });
  }

  // −1: removes that side's most recent scoring event (and its points). In
  // volleyball only events from the current set count. Falls back to a plain
  // −1 if the score was typed in without events.
  function undoLastScore(game, side) {
    if (game.status !== 'live') return err('Start the game before scoring');
    var key = sideKey(side);
    var events = eventsArray(game);
    var cur = game.sport === 'volleyball' ? (game.currentSet || 1) : null;
    for (var i = events.length - 1; i >= 0; i--) {
      var e = events[i];
      if (e.side === side && e.pts > 0 && (cur === null || e.set === cur)) {
        var patch = {};
        patch[key] = Math.max(0, (game[key] || 0) - e.pts);
        patch.events = events.slice(0, i).concat(events.slice(i + 1));
        return ok(patch);
      }
    }
    return addPoints(game, side, -1);
  }

  // Remove one specific event (e.g. a card given by mistake).
  function removeEvent(game, index) {
    var events = eventsArray(game);
    var e = events[index];
    if (!e) return err('That entry no longer exists');
    var patch = { events: events.slice(0, index).concat(events.slice(index + 1)) };
    var cur = game.sport === 'volleyball' ? (game.currentSet || 1) : null;
    if (e.pts > 0 && (cur === null || e.set === cur)) {
      var key = sideKey(e.side);
      patch[key] = Math.max(0, (game[key] || 0) - e.pts);
    }
    return ok(patch);
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
    setsArray: setsArray,
    eventsArray: eventsArray,
    scoreEvent: scoreEvent,
    cardEvent: cardEvent,
    undoLastScore: undoLastScore,
    removeEvent: removeEvent,
    VB_KINDS: VB_KINDS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.KO = root.KO || {};
    root.KO.scoring = api;
  }
})(typeof window !== 'undefined' ? window : this);
