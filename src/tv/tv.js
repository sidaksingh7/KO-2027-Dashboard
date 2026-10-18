/*
 * KO 2027 — Venue TV screens. Read live/ (principle 1: TVs and admin read live).
 *
 *   tv.html                              picker: lists every screen
 *   tv.html#court=Gym%201&sport=basketball   one field/gym: current game + clock, else next up
 *   tv.html#board=basketball             live games, up next, standings rotating by division
 *   tv.html#bracket=basketball           playoff bracket, rotating by division
 *
 * Sandbox with nothing in it → shows the built-in demo tournament.
 */
(function (root) {
  'use strict';

  var KO = root.KO;
  var H = KO.helpers;
  var C = KO.config;
  var T = KO.timer;
  var esc = H.escapeHtml;
  var TZ = C.EVENT.timezone;
  var doc = root.document;
  var ROTATE_MS = 12000;

  var state = { raw: null, timers: {}, banner: null, now: KO.now, demo: false, route: { page: 'home', params: {} }, rot: 0 };

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  function views() {
    var out = {};
    H.SPORT_ORDER.forEach(function (s) {
      out[s] = {};
      H.DIVISION_ORDER.forEach(function (d) {
        var l = (state.raw && state.raw[s] && state.raw[s][d]) || {};
        var data = state.demo ? l : KO.adminData.viewData(l);
        out[s][d] = H.divisionView(s, d, data);
      });
    });
    return out;
  }

  function timerFor(g) {
    return (state.timers[g.sport] && state.timers[g.sport][g.division] && state.timers[g.sport][g.division][g.id]) || null;
  }

  // Demo data only when forced (?demo=1) or when the in-browser sandbox is empty.
  // With real Firebase we never read the whole tree: the security rules only
  // allow reading each division's live/published, so that read would be refused.
  function decideDemo(cb) {
    var forced = /[?&]demo=([01])/.exec(root.location.search);
    if (forced) return cb(forced[1] === '1');
    if (KO.mode !== 'sandbox') return cb(false);
    KO.db.ref('ko2027').once('value').then(function (snap) {
      var tree = snap.val() || {};
      cb(!H.SPORT_ORDER.some(function (s) {
        return tree[s] && H.DIVISION_ORDER.some(function (d) { return tree[s][d] && tree[s][d].live; });
      }));
    });
  }

  function start() {
    decideDemo(function (useDemo) {
      if (useDemo) {
        var demo = KO.demo.build();
        var loadedAt = Date.now();
        state.demo = true;
        state.raw = demo.divisions;
        state.banner = { text: 'Demo data', level: 'info' };
        state.now = function () { return demo.now + (Date.now() - loadedAt); };
        render();
        return;
      }
      state.raw = {};
      var pending = null;
      function changed() {
        if (pending) return;
        pending = setTimeout(function () { pending = null; render(); }, 40);
      }
      H.SPORT_ORDER.forEach(function (s) {
        state.raw[s] = {};
        state.timers[s] = {};
        H.DIVISION_ORDER.forEach(function (d) {
          KO.liveRef(s, d).on('value', function (snap) {
            var v = snap.val() || {};
            state.timers[s][d] = v.timers || {};
            state.raw[s][d] = v;
            changed();
          });
        });
      });
      KO.eventRef('banner').on('value', function (snap) { state.banner = snap.val(); changed(); });
    });
  }

  // ---------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------

  function sportName(s) { return C.SPORTS[s].name; }
  function divName(d) { return C.EVENT.divisions[d]; }

  function header(title, sub) {
    return '<header class="tv-head">' +
      '<div class="tv-brand"><span class="crest"><img src="assets/brand/crest.png" alt=""></span>' +
        '<span><b>Khalsa Olympics</b><small>' + C.EVENT.year + ' · ' + esc(C.EVENT.venue) + '</small></span></div>' +
      '<div class="tv-title"><div class="kicker">' + esc(sub || '') + '</div><h1>' + esc(title) + '</h1></div>' +
      '<div class="tv-clock" id="tv-clock">' + esc(H.formatTime(state.now(), TZ)) + '</div>' +
    '</header>' +
    (state.banner && state.banner.text ? '<div class="tv-banner tv-banner-' + esc(state.banner.level || 'info') + '">' + esc(state.banner.text) + '</div>' : '');
  }

  function clockHtml(g) {
    var t = timerFor(g);
    if (!t) return '';
    return '<div class="tv-timer' + (t.running ? ' running' : '') + '" data-timer="' + esc(g.sport + '|' + g.division + '|' + g.id) + '">' + esc(T.display(t, state.now())) + '</div>';
  }

  function score(g, n) {
    if (g.status === 'scheduled') return '';
    return esc(g['score' + n] || 0);
  }

  function setsLine(g) {
    if (g.sport !== 'volleyball' || g.status === 'scheduled') return '';
    var sets = KO.scoring.setsArray(g).filter(function (s) { return s.done; });
    return '<div class="tv-sets">Sets <b>' + (g.setsWon1 || 0) + '–' + (g.setsWon2 || 0) + '</b>' +
      sets.map(function (s, i) { return '<span>S' + (i + 1) + ' ' + s.s1 + '–' + s.s2 + '</span>'; }).join('') +
      (g.status === 'live' ? '<span class="cur">Set ' + (g.currentSet || sets.length + 1) + '</span>' : '') + '</div>';
  }

  function statusTag(g) {
    if (g.status === 'live') return '<span class="pill pill-live">Live</span>';
    if (g.status === 'final') return '<span class="pill pill-final">Final</span>';
    return '<span class="pill pill-gold">' + esc(H.formatTime(g.startsAt, TZ)) + '</span>';
  }

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  function courtScreen(court, sport) {
    var v = views();
    var games = H.allGames(v, sport).filter(function (g) { return g.court === court; });
    var now = state.now();
    var cur = games.filter(function (g) { return g.status === 'live'; })[0] ||
      games.filter(function (g) { return g.status === 'scheduled'; })[0] || null;
    var after = cur ? games.filter(function (g) { return g.status === 'scheduled' && g.id !== cur.id; }).slice(0, 3) : [];
    var r = cur && cur.result || {};
    var body;
    if (!cur) {
      body = '<div class="tv-empty">No more games on ' + esc(court) + ' today.</div>';
    } else {
      var isNext = cur.status !== 'live';
      body = '<section class="court-main">' +
        '<div class="kicker">' + esc(divName(cur.division) + ' · ' + KO.gameName(cur.id, cur)) + ' ' + statusTag(cur) + '</div>' +
        (isNext ? '<div class="up-next-label">Up next · ' + esc(H.formatTime(cur.startsAt, TZ)) + '</div>' : clockHtml(cur)) +
        '<div class="court-board">' +
          '<div class="cb-team' + (r.winnerId && r.winnerId === cur.t1.id ? ' won' : '') + '"><div class="cb-name">' + esc(cur.t1.name) + '</div><div class="cb-score">' + score(cur, 1) + '</div></div>' +
          '<div class="cb-vs">vs</div>' +
          '<div class="cb-team' + (r.winnerId && r.winnerId === cur.t2.id ? ' won' : '') + '"><div class="cb-name">' + esc(cur.t2.name) + '</div><div class="cb-score">' + score(cur, 2) + '</div></div>' +
        '</div>' + setsLine(cur) +
      '</section>';
    }
    var later = after.length ? '<footer class="tv-later"><span class="kicker">Later on ' + esc(court) + '</span>' + after.map(function (g) {
      return '<span class="tl-item"><b>' + esc(H.formatTime(g.startsAt, TZ)) + '</b> ' + esc(g.t1.name) + ' vs ' + esc(g.t2.name) + '</span>';
    }).join('') + '</footer>' : '';
    void now;
    return header(court, sportName(sport)) + body + later;
  }

  function gameCard(g) {
    var r = g.result || {};
    return '<div class="tv-card status-' + esc(g.status) + '">' +
      '<div class="tc-meta"><span>' + esc(g.court || '') + ' · ' + esc(divName(g.division)) + ' · ' + esc(KO.gameName(g.id, g)) + '</span>' + statusTag(g) + '</div>' +
      '<div class="tc-row' + (r.winnerId === g.t1.id && r.winnerId ? ' won' : '') + '"><span>' + esc(g.t1.name) + '</span><b>' + score(g, 1) + '</b></div>' +
      '<div class="tc-row' + (r.winnerId === g.t2.id && r.winnerId ? ' won' : '') + '"><span>' + esc(g.t2.name) + '</span><b>' + score(g, 2) + '</b></div>' +
      (g.status === 'live' ? clockHtml(g) : '') + setsLine(g) +
    '</div>';
  }

  function standingsMini(view) {
    var adv = { soccer: 2, basketball: 8, volleyball: 4 }[view.sport];
    var groups = {};
    view.standings.forEach(function (r) { (groups[r.group || ''] = groups[r.group || ''] || []).push(r); });
    return Object.keys(groups).sort().map(function (g) {
      var n = 0;
      return (g ? '<h3 class="tv-sub">Group ' + esc(g) + '</h3>' : '') + '<table class="tv-table"><thead><tr><th>#</th><th class="tm">Team</th><th>W</th><th>L</th>' +
        (view.sport === 'soccer' ? '<th>D</th><th>Pts</th>' : '<th>Diff</th>') + '</tr></thead><tbody>' +
        groups[g].map(function (r) {
          if (!r.dq) n++;
          return '<tr class="' + (!r.dq && n <= adv ? 'q' : '') + (r.dq ? ' dq' : '') + '"><td>' + (r.dq ? '–' : r.rank) + '</td><td class="tm">' + esc(r.name) + '</td><td>' + r.wins + '</td><td>' + r.losses + '</td>' +
            (view.sport === 'soccer' ? '<td>' + r.draws + '</td><td><b>' + r.points + '</b></td>' : '<td>' + (r.diff > 0 ? '+' : '') + r.diff + '</td>') + '</tr>';
        }).join('') + '</tbody></table>';
    }).join('');
  }

  function boardScreen(sport) {
    var v = views();
    var games = H.allGames(v, sport);
    var ln = H.liveAndNext(games, state.now());
    var div = H.DIVISION_ORDER[state.rot % 3];
    var liveCards = ln.live.length ? ln.live.map(gameCard).join('') : '<div class="tv-empty small">No games live right now</div>';
    var upNext = ln.next.length ? ln.next.map(gameCard).join('') : '';
    return header(sportName(sport), 'Live scores') +
      '<div class="board">' +
        '<section class="board-games"><h2 class="tv-h2"><span class="live-dot"></span>Live now</h2><div class="tv-grid">' + liveCards + '</div>' +
          (upNext ? '<h2 class="tv-h2">Up next · ' + esc(H.formatTime(ln.next[0].startsAt, TZ)) + '</h2><div class="tv-grid">' + upNext + '</div>' : '') +
        '</section>' +
        '<aside class="board-side"><h2 class="tv-h2">' + esc(divName(div)) + ' standings</h2>' + standingsMini(v[sport][div]) +
          '<div class="rot-dots">' + H.DIVISION_ORDER.map(function (d) { return '<span class="' + (d === div ? 'on' : '') + '"></span>'; }).join('') + '</div></aside>' +
      '</div>';
  }

  function bracketScreen(sport, fixedDiv) {
    var v = views();
    var div = fixedDiv || H.DIVISION_ORDER[state.rot % 3];
    var view = v[sport][div];
    var rounds = [['qf', 'Quarterfinals'], ['sf', 'Semifinals'], ['final', 'Final'], ['third', '3rd place']];
    var cols = rounds.map(function (rd) {
      var list = view.games.filter(function (g) { return g.isBracket && g.round === rd[0]; });
      if (!list.length) return '';
      return '<div class="br-col br-' + rd[0] + '"><h3 class="tv-sub">' + rd[1] + '</h3>' + list.map(gameCard).join('') + '</div>';
    }).join('');
    var champ = '';
    var f = view.games.filter(function (g) { return g.round === 'final'; })[0];
    if (f && f.result && f.result.decided && f.result.winnerId) {
      champ = '<div class="tv-champ"><span class="kicker">' + C.EVENT.year + ' ' + esc(divName(div)) + ' champion</span><b>' + esc(view.teams[f.result.winnerId] ? view.teams[f.result.winnerId].name : '') + '</b> <span class="gold">♛</span></div>';
    }
    return header(sportName(sport) + ' playoffs', divName(div)) + champ +
      (cols ? '<div class="tv-bracket">' + cols + '</div>' : '<div class="tv-empty">Bracket not set yet</div>');
  }

  function picker() {
    var v = views();
    var items = H.SPORT_ORDER.map(function (s) {
      var courts = {};
      H.allGames(v, s).forEach(function (g) { if (g.court) courts[g.court] = true; });
      var cs = Object.keys(courts).sort();
      return '<section class="pick-sport"><h2 class="tv-h2">' + esc(sportName(s)) + '</h2><div class="pick-links">' +
        '<a class="btn" href="#board=' + s + '">Live board</a>' +
        '<a class="btn btn-outline" href="#bracket=' + s + '">Bracket (rotating)</a>' +
        cs.map(function (c) { return '<a class="btn btn-outline" href="' + H.buildHash('court', { court: c, sport: s }).replace('#court&', '#') + '">' + esc(c) + '</a>'; }).join('') +
      '</div></section>';
    }).join('');
    return header('TV screens', 'Pick a screen for this TV') +
      '<div class="picker"><p class="muted">Open this page on each TV and choose what it shows. Press F11 (or ⌃⌘F on Mac) for full screen.</p>' + items + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Render + routing
  // ---------------------------------------------------------------------------

  function render() {
    if (!state.raw) return;
    var p = state.route.params;
    var html;
    if (p.court) html = courtScreen(p.court, C.SPORTS[p.sport] ? p.sport : 'soccer');
    else if (p.board && C.SPORTS[p.board]) html = boardScreen(p.board);
    else if (p.bracket && C.SPORTS[p.bracket]) html = bracketScreen(p.bracket, C.EVENT.divisions[p.division] ? p.division : null);
    else html = picker();
    doc.getElementById('tv').innerHTML = html;
    tick();
  }

  function tick() {
    var c = doc.getElementById('tv-clock');
    if (c) c.textContent = H.formatTime(state.now(), TZ);
    doc.querySelectorAll('[data-timer]').forEach(function (el) {
      var k = el.getAttribute('data-timer').split('|');
      var t = state.timers[k[0]] && state.timers[k[0]][k[1]] && state.timers[k[0]][k[1]][k[2]];
      if (!t) return;
      el.textContent = T.display(t, state.now());
      el.classList.toggle('up', T.isTimeUp(t, state.now()));
    });
  }

  function route() {
    state.route = H.parseHash(root.location.hash);
    state.rot = 0;
    render();
  }

  root.addEventListener('hashchange', route);
  setInterval(tick, 250);
  setInterval(function () { state.rot++; render(); }, ROTATE_MS);

  state.route = H.parseHash(root.location.hash);
  start();
})(typeof window !== 'undefined' ? window : this);
