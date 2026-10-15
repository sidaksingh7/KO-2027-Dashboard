/*
 * KO 2027 — Pure helpers for the public pages (no DOM, no Firebase). Tested in
 * tests/public-helpers.test.js.
 *
 * PUBLISHED DIVISION SHAPE  (ko2027/{sport}/{division}/published)
 *   {
 *     teams:  { teamId: { name } },
 *     games:  { gameId: game },           // round robin + bracket games
 *     groups: { A: [teamId], B: [...] },  // soccer only
 *     dq:     { teamId: true },
 *     manualOrder: [teamId],              // admin coin-flip order
 *     publishedAt: ms
 *   }
 */
(function (root) {
  'use strict';

  var KO = root.KO || {};
  var computeStandings = KO.computeStandings ||
    (typeof require === 'function' && require('../shared/standings.js').computeStandings);
  var resolveBracket = KO.resolveBracket ||
    (typeof require === 'function' && require('../shared/cascade.js').resolveBracket);

  var SPORT_ORDER = ['soccer', 'basketball', 'volleyball'];
  var DIVISION_ORDER = ['d1', 'd2', 'd3'];

  // ---------------------------------------------------------------------------
  // Text
  // ---------------------------------------------------------------------------

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 'Babbar Khalsa Ballers!' → 'babbar-khalsa-ballers'
  function slugify(name) {
    return String(name).toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Team ids follow {team-name}-{sport}-{division}
  function teamId(name, sport, division) {
    return slugify(name) + '-' + sport + '-' + division;
  }

  // ---------------------------------------------------------------------------
  // Time (always shown in the event's timezone, whatever the phone is set to)
  // ---------------------------------------------------------------------------

  function formatTime(ms, timeZone) {
    return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timeZone });
  }

  function formatDate(ms, timeZone) {
    return new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: timeZone });
  }

  // 'YYYY-MM-DD' of a moment in the event timezone
  function dayKey(ms, timeZone) {
    var parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timeZone })
      .formatToParts(new Date(ms));
    var get = function (t) { return parts.filter(function (p) { return p.type === t; })[0].value; };
    return get('year') + '-' + get('month') + '-' + get('day');
  }

  // Where are we relative to the event days?
  //   { phase: 'before' | 'during' | 'between' | 'after', day: {sport,date,label} | null, daysUntil }
  function eventPhase(now, days, timeZone) {
    var today = dayKey(now, timeZone);
    var first = days[0].date;
    var last = days[days.length - 1].date;
    var match = days.filter(function (d) { return d.date === today; })[0] || null;
    if (match) return { phase: 'during', day: match, daysUntil: 0 };
    if (today < first) {
      var diff = Math.round((Date.parse(first) - Date.parse(today)) / 86400000);
      return { phase: 'before', day: days[0], daysUntil: diff };
    }
    if (today > last) return { phase: 'after', day: null, daysUntil: 0 };
    var next = days.filter(function (d) { return d.date > today; })[0];
    return { phase: 'between', day: next, daysUntil: 1 };
  }

  // ---------------------------------------------------------------------------
  // Division → everything a page needs
  // ---------------------------------------------------------------------------

  // Turns one published division into: games with both teams resolved (bracket
  // included), standings rows, seeds. Every page uses this, so they all agree.
  function divisionView(sport, division, data) {
    data = data || {};
    var teams = data.teams || {};
    var games = data.games || {};
    var teamIds = Object.keys(teams);

    var opts = { sport: sport, dqTeamIds: data.dq, manualOrder: data.manualOrder };
    if (data.groups) opts.groups = data.groups;
    var st = computeStandings(games, teamIds, opts);

    var resolved = resolveBracket(games, st.seeds, data.dq);

    function side(game, n) {
      var slot = game['slot' + n];
      var id = slot.teamId;
      return {
        id: id,
        name: id ? (teams[id] ? teams[id].name : id) : slot.label,
        known: !!id,
        dq: slot.dq
      };
    }

    var list = Object.keys(resolved).map(function (id) {
      var g = resolved[id];
      var out = {};
      Object.keys(g).forEach(function (k) { out[k] = g[k]; });
      out.id = out.id || id;
      out.sport = sport;
      out.division = division;
      out.t1 = side(g, 1);
      out.t2 = side(g, 2);
      out.isBracket = !!(g.source1 || g.source2);
      return out;
    });
    list.sort(byTime);

    var rows = st.rows.map(function (r) {
      var copy = {};
      Object.keys(r).forEach(function (k) { copy[k] = r[k]; });
      copy.name = teams[r.teamId] ? teams[r.teamId].name : r.teamId;
      return copy;
    });

    return {
      sport: sport,
      division: division,
      teams: teams,
      games: list,
      standings: rows,
      seeds: st.seeds,
      hasGroups: !!data.groups,
      publishedAt: data.publishedAt || null
    };
  }

  function byTime(a, b) {
    var ta = a.startsAt == null ? Infinity : a.startsAt;
    var tb = b.startsAt == null ? Infinity : b.startsAt;
    if (ta !== tb) return ta - tb;
    return String(a.court || '').localeCompare(String(b.court || ''));
  }

  // All divisions: { soccer: { d1: data } } → { soccer: { d1: view } }
  function buildViews(divisions) {
    var out = {};
    SPORT_ORDER.forEach(function (sport) {
      out[sport] = {};
      DIVISION_ORDER.forEach(function (div) {
        var data = divisions && divisions[sport] && divisions[sport][div];
        out[sport][div] = divisionView(sport, div, data);
      });
    });
    return out;
  }

  function allGames(views, sport) {
    var list = [];
    (sport ? [sport] : SPORT_ORDER).forEach(function (s) {
      DIVISION_ORDER.forEach(function (d) {
        if (views[s] && views[s][d]) list = list.concat(views[s][d].games);
      });
    });
    return list.sort(byTime);
  }

  function allTeams(views) {
    var list = [];
    SPORT_ORDER.forEach(function (s) {
      DIVISION_ORDER.forEach(function (d) {
        var v = views[s] && views[s][d];
        if (!v) return;
        Object.keys(v.teams).forEach(function (id) {
          list.push({ id: id, name: v.teams[id].name, sport: s, division: d });
        });
      });
    });
    return list;
  }

  function findTeam(views, id) {
    return allTeams(views).filter(function (t) { return t.id === id; })[0] || null;
  }

  // Team search: whole name starts with query > a word starts with it > contains it.
  function searchTeams(teams, query, limit) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var scored = [];
    teams.forEach(function (t) {
      var name = t.name.toLowerCase();
      var score = -1;
      if (name.indexOf(q) === 0) score = 0;
      else if ((' ' + name).indexOf(' ' + q) !== -1) score = 1;
      else if (name.indexOf(q) !== -1) score = 2;
      if (score >= 0) scored.push({ t: t, score: score });
    });
    scored.sort(function (a, b) {
      return a.score - b.score || a.t.name.localeCompare(b.t.name) ||
        SPORT_ORDER.indexOf(a.t.sport) - SPORT_ORDER.indexOf(b.t.sport);
    });
    return scored.slice(0, limit || 20).map(function (x) { return x.t; });
  }

  // A team's games, each with the opponent and result from this team's side.
  function teamGames(view, id) {
    return view.games.filter(function (g) {
      return g.t1.id === id || g.t2.id === id;
    }).map(function (g) {
      var mine = g.t1.id === id ? 1 : 2;
      var r = g.result || {};
      var outcome = null;
      if (r.decided) {
        if (r.winnerId === id) outcome = 'W';
        else if (r.loserId === id) outcome = 'L';
      } else if (g.status === 'final' && !g.isBracket && r.winnerId == null && g.score1 === g.score2 && g.setsWon1 == null) {
        outcome = 'D';
      }
      return { game: g, side: mine, opponent: mine === 1 ? g.t2 : g.t1, outcome: outcome };
    });
  }

  // Games grouped by start time: [{ startsAt, games: [...] }]
  function groupBySlot(games) {
    var groups = [];
    games.forEach(function (g) {
      var last = groups[groups.length - 1];
      if (last && last.startsAt === g.startsAt) last.games.push(g);
      else groups.push({ startsAt: g.startsAt, games: [g] });
    });
    return groups;
  }

  // Live games, plus the next start time's games, for the "Now playing" panel.
  function liveAndNext(games, now) {
    var live = games.filter(function (g) { return g.status === 'live'; });
    var upcoming = games.filter(function (g) {
      return g.status === 'scheduled' && g.startsAt != null && g.startsAt >= now - 15 * 60000;
    });
    var nextAt = upcoming.length ? upcoming[0].startsAt : null;
    return {
      live: live,
      next: upcoming.filter(function (g) { return g.startsAt === nextAt; })
    };
  }

  // Score text for a game card: volleyball shows sets won, others the score.
  function scoreText(g) {
    if (g.status === 'scheduled') return null;
    if (g.sport === 'volleyball') return [g.setsWon1 || 0, g.setsWon2 || 0];
    return [g.score1 || 0, g.score2 || 0];
  }

  // ---------------------------------------------------------------------------
  // Routing: '#schedule&sport=soccer&division=d1' / '#team=babbar-…-soccer-d1'
  // ---------------------------------------------------------------------------

  function parseHash(hash) {
    var parts = String(hash || '').replace(/^#\/?/, '').split('&').filter(Boolean);
    var page = 'home';
    var params = {};
    parts.forEach(function (p, i) {
      var eq = p.indexOf('=');
      if (eq === -1) {
        if (i === 0) page = decodeURIComponent(p);
        return;
      }
      var k = decodeURIComponent(p.slice(0, eq));
      var v = decodeURIComponent(p.slice(eq + 1));
      params[k] = v;
      if (i === 0 && k === 'team') page = 'team';
    });
    return { page: page, params: params };
  }

  function buildHash(page, params) {
    var out = [];
    if (page === 'team') return '#team=' + encodeURIComponent(params.team);
    if (page && page !== 'home') out.push(encodeURIComponent(page));
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] != null && params[k] !== '') out.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    });
    return '#' + out.join('&');
  }

  var api = {
    SPORT_ORDER: SPORT_ORDER,
    DIVISION_ORDER: DIVISION_ORDER,
    escapeHtml: escapeHtml,
    slugify: slugify,
    teamId: teamId,
    formatTime: formatTime,
    formatDate: formatDate,
    dayKey: dayKey,
    eventPhase: eventPhase,
    divisionView: divisionView,
    buildViews: buildViews,
    allGames: allGames,
    allTeams: allTeams,
    findTeam: findTeam,
    searchTeams: searchTeams,
    teamGames: teamGames,
    groupBySlot: groupBySlot,
    liveAndNext: liveAndNext,
    scoreText: scoreText,
    parseHash: parseHash,
    buildHash: buildHash
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.KO = root.KO || {};
    root.KO.helpers = api;
  }
})(typeof window !== 'undefined' ? window : this);
