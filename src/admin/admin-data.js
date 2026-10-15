/*
 * KO 2027 — Admin data layer. All writes from admin.html go through here.
 *
 * LIVE DIVISION SHAPE  (ko2027/{sport}/{division}/live)
 *   {
 *     teams:  { teamId: { name, group? } },   // group 'A' | 'B' (soccer)
 *     games:  { gameId: game },               // each with updatedAt per field
 *     timers: { gameId: timer },              // see src/shared/timer.js
 *     dq:     { teamId: true },
 *     manualOrder: [teamId]
 *   }
 *
 * Publishing (the "published gate"):
 *   - publishDivision() copies teams/games/groups/dq/manualOrder → published/.
 *     Teams and schedule changes reach the public site only this way.
 *   - Once a division has been published, each scored game is also copied to
 *     published/games/{id} as one write, so public scores stay current without
 *     ever showing half-written data.
 */
(function (root) {
  'use strict';

  var KO = root.KO;
  var H = KO.helpers;
  var S = KO.scoring;
  var T = KO.timer;

  // { A: [ids], B: [ids] } from team.group, or null if no groups.
  function groupsFromTeams(teams) {
    var groups = {};
    Object.keys(teams || {}).forEach(function (id) {
      var g = teams[id].group;
      if (g) (groups[g] = groups[g] || []).push(id);
    });
    return Object.keys(groups).length ? groups : null;
  }

  // Live division data in the shape helpers.divisionView() expects.
  function viewData(live) {
    live = live || {};
    return {
      teams: live.teams || {},
      games: live.games || {},
      groups: groupsFromTeams(live.teams),
      dq: live.dq || {},
      manualOrder: live.manualOrder || []
    };
  }

  // ---------------------------------------------------------------------------
  // Watching
  // ---------------------------------------------------------------------------

  // cb(state) on any change. state = { live: {sport:{div:data}}, publishedAt: {sport:{div:ms}}, banner }
  function watchAll(cb) {
    var state = { live: {}, publishedAt: {}, banner: null };
    var pending = null;
    function changed() {
      if (pending) return;
      pending = setTimeout(function () { pending = null; cb(state); }, 30);
    }
    H.SPORT_ORDER.forEach(function (s) {
      state.live[s] = {};
      state.publishedAt[s] = {};
      H.DIVISION_ORDER.forEach(function (d) {
        KO.liveRef(s, d).on('value', function (snap) {
          state.live[s][d] = snap.val() || {};
          changed();
        });
        KO.publishedRef(s, d, 'publishedAt').on('value', function (snap) {
          state.publishedAt[s][d] = snap.val() || null;
          changed();
        });
      });
    });
    KO.eventRef('banner').on('value', function (snap) {
      state.banner = snap.val();
      changed();
    });
    return state;
  }

  // ---------------------------------------------------------------------------
  // Games + timers (transactions: always applied to the latest saved value)
  // ---------------------------------------------------------------------------

  // action(game) → { patch } | { error }. Resolves { error } or { game }.
  function gameAction(sport, div, gameId, action) {
    var error = null;
    var ref = KO.liveRef(sport, div, 'games', gameId);
    return ref.transaction(function (cur) {
      if (!cur) { error = 'Game not found'; return undefined; }
      cur.sport = cur.sport || sport;
      var res = action(cur);
      if (res.error) { error = res.error; return undefined; }
      return S.applyPatch(cur, res.patch, KO.now());
    }).then(function (r) {
      if (error || !r.committed) return { error: error || 'Not saved — try again' };
      var game = r.snapshot.val();
      return maybePublishGame(sport, div, gameId, game).then(function () { return { game: game }; });
    });
  }

  function maybePublishGame(sport, div, gameId, game) {
    return KO.publishedRef(sport, div, 'publishedAt').once('value').then(function (snap) {
      if (!snap.val()) return null; // division never published — nothing public to update
      return KO.publishedRef(sport, div, 'games', gameId).set(game);
    });
  }

  // fn(timer|null, now) → new timer. Applied to the latest saved timer.
  function timerAction(sport, div, gameId, fn) {
    return KO.liveRef(sport, div, 'timers', gameId).transaction(function (cur) {
      return fn(cur || null, KO.now());
    });
  }

  function defaultTimer(sport, now) {
    var t = KO.config.SPORTS[sport].timer;
    return T.createTimer({ direction: t.direction, duration: t.minutes ? t.minutes * 60000 : null }, now);
  }

  // ---------------------------------------------------------------------------
  // Teams
  // ---------------------------------------------------------------------------

  function addTeam(sport, div, name, group) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (!name) return Promise.resolve({ error: 'Enter a team name' });
    var id = H.teamId(name, sport, div);
    if (!H.slugify(name)) return Promise.resolve({ error: 'Team name needs letters or numbers' });
    var ref = KO.liveRef(sport, div, 'teams', id);
    return ref.once('value').then(function (snap) {
      if (snap.exists()) return { error: 'A team with that name is already in this division' };
      var team = { name: name, createdAt: KO.now() };
      if (group) team.group = group;
      return ref.set(team).then(function () { return { id: id }; });
    });
  }

  function updateTeam(sport, div, id, fields) {
    if (fields.name != null) {
      fields.name = String(fields.name).trim().replace(/\s+/g, ' ');
      if (!fields.name) return Promise.resolve({ error: 'Enter a team name' });
    }
    return KO.liveRef(sport, div, 'teams', id).update(fields).then(function () { return {}; });
  }

  function teamHasGames(live, id) {
    var games = (live && live.games) || {};
    return Object.keys(games).some(function (g) { return games[g].team1Id === id || games[g].team2Id === id; });
  }

  function removeTeam(sport, div, live, id) {
    if (teamHasGames(live, id)) return Promise.resolve({ error: 'This team has games scheduled. Clear the schedule first, or DQ the team instead.' });
    return KO.liveRef(sport, div, 'teams', id).remove().then(function () { return {}; });
  }

  function setDq(sport, div, id, on) {
    return KO.liveRef(sport, div, 'dq', id).set(on ? true : null);
  }

  function setManualOrder(sport, div, order) {
    return KO.liveRef(sport, div, 'manualOrder').set(order && order.length ? order : null);
  }

  // ---------------------------------------------------------------------------
  // Schedule
  // ---------------------------------------------------------------------------

  // Builds games for all three divisions of a sport at once so they share courts
  // without clashing. Returns { games: {div: {id: game}} } or { error }.
  function buildSchedule(sport, liveBySport, opts) {
    var all = {};
    var counts = {};
    var problems = [];
    H.DIVISION_ORDER.forEach(function (d) {
      var teams = (liveBySport[d] && liveBySport[d].teams) || {};
      var ids = Object.keys(teams).sort(function (a, b) { return teams[a].name.localeCompare(teams[b].name); });
      counts[d] = ids.length;
      if (!ids.length) return;
      try {
        var groups = groupsFromTeams(teams);
        if (opts.format === 'groups2') {
          if (!groups || !groups.A || !groups.B) throw new Error('put every team in Group A or B first');
          var missing = ids.filter(function (id) { return !teams[id].group; });
          if (missing.length) throw new Error(missing.length + ' team(s) have no group');
          Object.assign(all,
            KO.schedule.roundRobin(sport, d, groups.A, { group: 'A' }),
            KO.schedule.roundRobin(sport, d, groups.B, { group: 'B' }));
        } else {
          var per = opts.gamesPerTeam ? Math.min(opts.gamesPerTeam, ids.length - 1) : null;
          Object.assign(all, KO.schedule.roundRobin(sport, d, ids, per ? { gamesPerTeam: per } : {}));
        }
        var needed = opts.format === 'top8' ? 8 : opts.format === 'top4' ? 4 : 4;
        if (ids.length < needed) throw new Error('needs at least ' + needed + ' teams for ' + opts.format);
        Object.assign(all, KO.schedule.bracket(sport, d, opts.format));
      } catch (e) {
        problems.push(KO.config.EVENT.divisions[d] + ': ' + e.message);
      }
    });
    if (problems.length) return { error: problems.join(' · ') };
    if (!Object.keys(all).length) return { error: 'Add teams first' };

    var timed = KO.schedule.assignSlots(all, {
      courts: opts.courts,
      startsAt: opts.startsAt,
      slotMs: opts.slotMinutes * 60000,
      minRestSlots: opts.minRestSlots || 0
    });
    var byDiv = {};
    Object.keys(timed).forEach(function (id) {
      var g = timed[id];
      g.endsAt = g.startsAt + opts.slotMinutes * 60000;
      (byDiv[g.division] = byDiv[g.division] || {})[id] = g;
    });
    return { games: byDiv, counts: counts };
  }

  function startedGames(liveBySport) {
    var n = 0;
    H.DIVISION_ORDER.forEach(function (d) {
      var games = (liveBySport[d] && liveBySport[d].games) || {};
      Object.keys(games).forEach(function (id) { if (games[id].status !== 'scheduled') n++; });
    });
    return n;
  }

  // Replaces the games (and timers) of every division of the sport.
  function saveSchedule(sport, byDiv) {
    return Promise.all(H.DIVISION_ORDER.map(function (d) {
      return KO.liveRef(sport, d).update({ games: byDiv[d] || null, timers: null });
    }));
  }

  // Edit one game's time / court / teams (round robin only for teams).
  function editGame(sport, div, gameId, fields) {
    return gameAction(sport, div, gameId, function () { return { patch: fields }; });
  }

  function deleteGame(sport, div, gameId) {
    return Promise.all([
      KO.liveRef(sport, div, 'games', gameId).remove(),
      KO.liveRef(sport, div, 'timers', gameId).remove()
    ]);
  }

  // ---------------------------------------------------------------------------
  // Publishing + event banner
  // ---------------------------------------------------------------------------

  function publishDivision(sport, div) {
    return KO.liveRef(sport, div).once('value').then(function (snap) {
      var live = snap.val() || {};
      var data = viewData(live);
      var teams = {};
      Object.keys(data.teams).forEach(function (id) { teams[id] = { name: data.teams[id].name }; });
      return KO.publishedRef(sport, div).set({
        teams: teams,
        games: data.games,
        groups: data.groups,
        dq: live.dq || null,
        manualOrder: live.manualOrder || null,
        publishedAt: KO.now()
      });
    });
  }

  function unpublishDivision(sport, div) {
    return KO.publishedRef(sport, div).remove();
  }

  function setBanner(text, level) {
    text = String(text || '').trim();
    return KO.eventRef('banner').set(text ? { text: text, level: level || 'info', updatedAt: KO.now() } : null);
  }

  // ---------------------------------------------------------------------------
  // Sandbox tools (only when Firebase isn't configured)
  // ---------------------------------------------------------------------------

  function seedDemo() {
    if (KO.mode !== 'sandbox') return Promise.reject(new Error('Demo data can only be loaded into the sandbox'));
    var demo = KO.demo.build();
    var writes = [];
    H.SPORT_ORDER.forEach(function (s) {
      H.DIVISION_ORDER.forEach(function (d) {
        var div = demo.divisions[s][d];
        var teams = {};
        Object.keys(div.teams).forEach(function (id) {
          teams[id] = { name: div.teams[id].name };
          if (div.groups) {
            if (div.groups.A.indexOf(id) !== -1) teams[id].group = 'A';
            if (div.groups.B.indexOf(id) !== -1) teams[id].group = 'B';
          }
        });
        writes.push(KO.liveRef(s, d).set({ teams: teams, games: div.games, dq: div.dq, manualOrder: div.manualOrder }));
        writes.push(KO.publishedRef(s, d).set({
          teams: div.teams, games: div.games, groups: div.groups, dq: div.dq,
          manualOrder: div.manualOrder, publishedAt: KO.now()
        }));
      });
    });
    return Promise.all(writes);
  }

  function resetSandbox() {
    if (KO.mode !== 'sandbox' || !KO.db.clear) return Promise.reject(new Error('Only the sandbox can be reset'));
    KO.db.clear();
    return Promise.resolve();
  }

  KO.adminData = {
    groupsFromTeams: groupsFromTeams,
    viewData: viewData,
    watchAll: watchAll,
    gameAction: gameAction,
    timerAction: timerAction,
    defaultTimer: defaultTimer,
    addTeam: addTeam,
    updateTeam: updateTeam,
    removeTeam: removeTeam,
    teamHasGames: teamHasGames,
    setDq: setDq,
    setManualOrder: setManualOrder,
    buildSchedule: buildSchedule,
    startedGames: startedGames,
    saveSchedule: saveSchedule,
    editGame: editGame,
    deleteGame: deleteGame,
    publishDivision: publishDivision,
    unpublishDivision: unpublishDivision,
    setBanner: setBanner,
    seedDemo: seedDemo,
    resetSandbox: resetSandbox
  };
})(typeof window !== 'undefined' ? window : this);
