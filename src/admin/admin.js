/*
 * KO 2027 — Admin app (scorekeepers + organizers).
 *
 * Pages (hash): #score (game list) · #game=<id> (scorer) · #teams · #schedule
 *               #standings · #publish
 * Sport + division picked in the bar at the top (remembered on this device).
 */
(function (root) {
  'use strict';

  var KO = root.KO;
  var H = KO.helpers;
  var C = KO.config;
  var A = KO.adminData;
  var S = KO.scoring;
  var T = KO.timer;
  var esc = H.escapeHtml;
  var TZ = C.EVENT.timezone;
  var doc = root.document;

  var CTX_KEY = 'ko2027.admin.ctx';

  var state = {
    user: null,
    authReady: false,
    data: null,          // from A.watchAll
    sport: 'soccer',
    div: 'd1',
    page: 'score',
    params: {},
    toast: null,
    preview: null        // schedule preview
  };

  (function loadCtx() {
    try {
      var c = JSON.parse(root.localStorage.getItem(CTX_KEY) || '{}');
      if (C.SPORTS[c.sport]) state.sport = c.sport;
      if (C.EVENT.divisions[c.div]) state.div = c.div;
    } catch (e) { /* ignore */ }
  })();
  function saveCtx() {
    try { root.localStorage.setItem(CTX_KEY, JSON.stringify({ sport: state.sport, div: state.div })); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  function sportName(s) { return C.SPORTS[s].name; }
  function divName(d) { return C.EVENT.divisions[d]; }
  function live(sport, div) {
    return (state.data && state.data.live[sport || state.sport] && state.data.live[sport || state.sport][div || state.div]) || {};
  }
  function view(sport, div) {
    sport = sport || state.sport; div = div || state.div;
    return H.divisionView(sport, div, A.viewData(live(sport, div)));
  }
  function fmtTime(ms) { return ms == null ? 'TBD' : H.formatTime(ms, TZ); }
  function ago(ms) {
    if (!ms) return 'never';
    var m = Math.round((KO.now() - ms) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' days ago';
  }
  function toast(msg, kind) {
    state.toast = { msg: msg, kind: kind || 'ok', at: Date.now() };
    renderToast();
    setTimeout(function () {
      if (state.toast && Date.now() - state.toast.at >= 3900) { state.toast = null; renderToast(); }
    }, 4000);
  }
  function result(p, okMsg) {
    return Promise.resolve(p).then(function (r) {
      if (r && r.error) toast(r.error, 'err');
      else if (okMsg) toast(okMsg);
      return r;
    }, function (e) {
      toast(e && e.message ? e.message : 'Something went wrong', 'err');
    });
  }
  // local 'HH:MM' on the sport's day → ms
  function dayTime(sport, hhmm) {
    var d = C.EVENT.days.filter(function (x) { return x.sport === sport; })[0].date.split('-').map(Number);
    var t = String(hhmm).split(':').map(Number);
    // June = EDT (UTC−4)
    return Date.UTC(d[0], d[1] - 1, d[2], t[0] + 4, t[1] || 0);
  }
  function hhmm(ms) {
    var p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(new Date(ms));
    return p;
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  var NAV = [['score', 'Score'], ['teams', 'Teams'], ['schedule', 'Schedule'], ['standings', 'Standings'], ['publish', 'Publish']];

  function renderShell() {
    var sandbox = KO.mode === 'sandbox';
    doc.getElementById('mode').innerHTML = sandbox
      ? '<span class="pill pill-gold" title="Firebase not configured — changes stay in this browser">Sandbox</span>'
      : '<span class="pill pill-live" title="Using the real Firebase database">Live data</span>' +
        (state.connected
          ? ' <span class="pill pill-ok" title="Changes are reaching Firebase">● Connected</span>'
          : ' <span class="pill pill-offline" title="Changes are NOT reaching Firebase. They are kept on this device and sent when the connection returns.">Offline — not saving</span>');
    doc.getElementById('who').innerHTML = state.user
      ? '<span class="muted small">' + esc(state.user.email) + '</span>' +
        (sandbox ? '' : ' <button class="btn btn-ghost btn-sm" data-action="signout">Sign out</button>')
      : '';
  }

  function ctxBar() {
    return '<div class="ctx">' +
      '<div class="seg" role="group" aria-label="Sport">' + H.SPORT_ORDER.map(function (s) {
        return '<button data-action="sport" data-sport="' + s + '" aria-pressed="' + (s === state.sport) + '">' + esc(sportName(s)) + '</button>';
      }).join('') + '</div>' +
      (state.page === 'schedule' ? '' :
      '<div class="chips" role="group" aria-label="Division">' + H.DIVISION_ORDER.map(function (d) {
        return '<button class="chip" data-action="div" data-div="' + d + '" aria-pressed="' + (d === state.div) + '">' + esc(divName(d)) + '</button>';
      }).join('') + '</div>') +
    '</div>';
  }

  function nav() {
    var active = state.page === 'game' ? 'score' : state.page;
    return '<nav class="admin-nav">' + NAV.map(function (n) {
      return '<a href="#' + n[0] + '"' + (n[0] === active ? ' aria-current="page"' : '') + '>' + n[1] + '</a>';
    }).join('') + '</nav>';
  }

  function renderToast() {
    var el = doc.getElementById('toast');
    if (!state.toast) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="toast toast-' + state.toast.kind + '" role="status">' + esc(state.toast.msg) + '</div>';
  }

  // Keep typed-in values and focus across re-renders.
  function render() {
    renderShell();
    var app = doc.getElementById('app');
    var keep = {};
    app.querySelectorAll('input[id], select[id], textarea[id]').forEach(function (el) {
      keep[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    var focused = doc.activeElement && doc.activeElement.id;

    if (!state.authReady) { app.innerHTML = '<div class="wrap page"><p class="muted">Loading…</p></div>'; return; }
    if (!state.user) { app.innerHTML = loginPage(); return; }
    if (!state.data) { app.innerHTML = '<div class="wrap page"><p class="muted">Loading data…</p></div>'; return; }

    var body;
    switch (state.page) {
      case 'game': body = gamePage(state.params.game); break;
      case 'teams': body = teamsPage(); break;
      case 'schedule': body = schedulePage(); break;
      case 'standings': body = standingsPage(); break;
      case 'publish': body = publishPage(); break;
      default: body = scoreList();
    }
    var noCtx = state.page === 'game' || state.page === 'publish';
    app.innerHTML = nav() + '<div class="wrap page">' + (noCtx ? '' : ctxBar()) + body + '</div>';

    Object.keys(keep).forEach(function (id) {
      var el = doc.getElementById(id);
      if (!el || el.hasAttribute('data-fresh')) return;
      if (el.type === 'checkbox') el.checked = keep[id]; else el.value = keep[id];
    });
    if (focused) { var f = doc.getElementById(focused); if (f) f.focus(); }
    tickTimer();
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  function loginPage() {
    return '<div class="wrap page login">' +
      '<div class="kicker">Scorekeepers & organizers</div><h1 class="display">Admin sign in</h1>' +
      '<form id="login-form" class="card login-card">' +
        '<label class="label" for="login-email">Email</label>' +
        '<input class="input" id="login-email" type="email" autocomplete="username" required>' +
        '<label class="label" for="login-pass">Password</label>' +
        '<input class="input" id="login-pass" type="password" autocomplete="current-password" required>' +
        '<button class="btn" type="submit">Sign in</button>' +
        '<p class="muted small">Accounts are created by the organizers in the Firebase console.</p>' +
      '</form></div>';
  }

  // ---------------------------------------------------------------------------
  // Score: game list
  // ---------------------------------------------------------------------------

  function gameItem(g) {
    var score = H.scoreText(g);
    return '<a class="g-item status-' + esc(g.status) + '" href="#game=' + encodeURIComponent(g.id) + '">' +
      '<span class="gi-time">' + esc(fmtTime(g.startsAt)) + '<small>' + esc(g.court || '') + '</small></span>' +
      '<span class="gi-teams"><span>' + esc(g.t1.name) + '</span><span>' + esc(g.t2.name) + '</span></span>' +
      '<span class="gi-score">' + (score ? '<b>' + esc(score[0]) + '</b><b>' + esc(score[1]) + '</b>' : '') + '</span>' +
      '<span class="gi-meta">' + esc(KO.gameName(g.id, g)) +
        (g.status === 'live' ? ' <span class="pill pill-live">Live</span>' : g.status === 'final' ? ' <span class="pill pill-final">Final</span>' : '') +
      '</span></a>';
  }

  function scoreList() {
    var v = view();
    if (!v.games.length) {
      return '<p class="empty">No games for ' + esc(sportName(state.sport) + ' ' + divName(state.div)) + ' yet. ' +
        'Add teams, then build the schedule.</p><p><a class="btn" href="#teams">Teams →</a> <a class="btn btn-outline" href="#schedule">Schedule →</a></p>';
    }
    var liveG = v.games.filter(function (g) { return g.status === 'live'; });
    var next = v.games.filter(function (g) { return g.status === 'scheduled'; });
    var done = v.games.filter(function (g) { return g.status === 'final'; }).reverse();
    function block(title, list, open) {
      if (!list.length) return '';
      return '<details class="g-block"' + (open ? ' open' : '') + '><summary><h2 class="display-sm">' + esc(title) +
        ' <span class="count">' + list.length + '</span></h2></summary><div class="g-list">' + list.map(gameItem).join('') + '</div></details>';
    }
    return block('Live now', liveG, true) + block('Up next', next, true) + block('Final', done, false);
  }

  // ---------------------------------------------------------------------------
  // Scorer
  // ---------------------------------------------------------------------------

  var POINT_BUTTONS = { soccer: [1], basketball: [1, 2, 3], volleyball: [1] };

  function findGame(id) {
    for (var i = 0; i < H.SPORT_ORDER.length; i++) {
      for (var j = 0; j < H.DIVISION_ORDER.length; j++) {
        var s = H.SPORT_ORDER[i], d = H.DIVISION_ORDER[j];
        var games = live(s, d).games || {};
        if (games[id]) return { sport: s, div: d, game: view(s, d).games.filter(function (g) { return g.id === id; })[0] };
      }
    }
    return null;
  }

  function gamePage(id) {
    var f = findGame(id);
    if (!f) return '<p class="empty">Game not found.</p><p><a class="btn" href="#score">← Back to games</a></p>';
    var g = f.game;
    var sport = f.sport;
    var ready = g.t1.known && g.t2.known;
    var r = g.result || {};
    var timer = (live(sport, f.div).timers || {})[id] || null;
    var vb = sport === 'volleyball';
    var tied = (g.score1 || 0) === (g.score2 || 0);

    function teamCol(n) {
      var side = n === 1 ? g.t1 : g.t2;
      var score = vb ? g['score' + n] || 0 : g['score' + n] || 0;
      var won = r.decided && r.winnerId && r.winnerId === side.id;
      return '<div class="sc-team' + (won ? ' won' : '') + '">' +
        '<div class="sc-name">' + esc(side.name) + (side.dq ? ' <span class="pill pill-dq">DQ</span>' : '') + '</div>' +
        (vb ? '<div class="sc-sets">Sets <b>' + (g['setsWon' + n] || 0) + '</b></div>' : '') +
        '<div class="sc-score" aria-live="polite">' + esc(score) + '</div>' +
        '<div class="sc-btns">' +
          POINT_BUTTONS[sport].map(function (p) {
            return '<button class="btn sc-plus" data-action="points" data-side="' + n + '" data-n="' + p + '"' +
              (g.status !== 'live' || !ready ? ' disabled' : '') + '>+' + p + '</button>';
          }).join('') +
          '<button class="btn btn-outline sc-minus" data-action="points" data-side="' + n + '" data-n="-1"' +
            (g.status !== 'live' || !ready ? ' disabled' : '') + ' aria-label="Undo one point">−1</button>' +
        '</div></div>';
    }

    var timerCard = '<section class="timer-card card">' +
      '<div class="t-display" id="timer-display" data-game="' + esc(id) + '" data-sport="' + sport + '" data-div="' + f.div + '">' +
        (timer ? T.display(timer, KO.now()) : (C.SPORTS[sport].timer.direction === 'up' ? '00:00' : T.format(C.SPORTS[sport].timer.minutes * 60000))) + '</div>' +
      '<div class="t-sub">' + (C.SPORTS[sport].timer.direction === 'up' ? 'Stopwatch' : 'Countdown') +
        (timer && timer.direction === 'down' ? ' · ' + Math.round(timer.duration / 60000) + ' min' : '') + '</div>' +
      '<div class="t-btns">' +
        (timer && timer.running
          ? '<button class="btn" data-action="timer" data-op="pause">Pause</button>'
          : '<button class="btn" data-action="timer" data-op="start">Start clock</button>') +
        '<button class="btn btn-outline" data-action="timer" data-op="adjust">Set time…</button>' +
        '<button class="btn btn-outline" data-action="timer" data-op="reset">Reset…</button>' +
      '</div></section>';

    var setsInfo = '';
    if (vb) {
      var sets = S.setsArray(g).filter(function (s) { return s.done; });
      setsInfo = '<section class="vb-sets card">' +
        '<div class="kicker">Set ' + (g.currentSet || sets.length + 1) + (g.status === 'final' ? ' · match over' : '') + '</div>' +
        '<div class="sets">' + (sets.length ? sets.map(function (s, i) {
          return '<span>Set ' + (i + 1) + ': ' + s.s1 + '–' + s.s2 + '</span>';
        }).join('') : '<span class="muted">No sets finished yet</span>') + '</div>' +
        '<div class="t-btns">' +
          '<button class="btn" data-action="endset"' + (g.status !== 'live' ? ' disabled' : '') + '>End set ' + (g.currentSet || sets.length + 1) + '</button>' +
          '<button class="btn btn-outline" data-action="undoset"' + (!sets.length ? ' disabled' : '') + '>Undo last set</button>' +
        '</div><p class="muted small">Score buttons count the current set. The match ends automatically when a team wins 2 sets.</p></section>';
    }

    var winnerPick = '';
    if (g.isBracket && !vb && tied && ready && g.status !== 'scheduled') {
      winnerPick = '<section class="card pick"><div class="kicker">Tied playoff game — who won? (penalties / tiebreak)</div><div class="t-btns">' +
        [g.t1, g.t2].map(function (t) {
          return '<button class="btn ' + (g.winnerId === t.id ? '' : 'btn-outline') + '" data-action="winner" data-team="' + esc(t.id) + '">' +
            (g.winnerId === t.id ? '✓ ' : '') + esc(t.name) + '</button>';
        }).join('') + '</div></section>';
    }

    var statusBtns;
    if (!ready) {
      statusBtns = '<p class="notice">Teams aren’t decided yet — this game fills in when the earlier games are final.</p>';
    } else if (g.status === 'scheduled') {
      statusBtns = '<button class="btn btn-big" data-action="start">Start game</button>';
    } else if (g.status === 'live') {
      statusBtns = (vb ? '' : '<button class="btn btn-big" data-action="final">Final — end game</button>');
    } else {
      statusBtns = '<div class="final-note"><span class="pill pill-final">' + (g.forfeitBy ? 'Forfeit' : 'Final') + '</span> ' +
        (r.winnerId ? esc((g.t1.id === r.winnerId ? g.t1 : g.t2).name) + ' won' : '') + '</div>' +
        '<button class="btn btn-outline" data-action="reopen">Reopen game</button>';
    }

    return '<a class="back" href="#score">← All games</a>' +
      '<header class="sc-head">' +
        '<div class="kicker">' + esc(sportName(sport) + ' · ' + divName(f.div) + ' · ' + KO.gameName(id, g)) + '</div>' +
        '<div class="sc-when">' + esc(fmtTime(g.startsAt)) + (g.court ? ' · <b>' + esc(g.court) + '</b>' : '') + '</div>' +
      '</header>' +
      (r.problem && g.isBracket ? '<p class="notice">' + esc(r.problem) + '</p>' : '') +
      timerCard +
      '<section class="scoreboard">' + teamCol(1) + '<div class="sc-vs">vs</div>' + teamCol(2) + '</section>' +
      setsInfo + winnerPick +
      '<section class="sc-status">' + statusBtns + '</section>' +
      '<details class="sc-more card"><summary>Corrections &amp; forfeits</summary><div class="t-btns">' +
        '<button class="btn btn-outline" data-action="setscore"' + (!ready ? ' disabled' : '') + '>Type in score…</button>' +
        (g.forfeitBy
          ? '<button class="btn btn-outline" data-action="clearforfeit">Undo forfeit</button>'
          : '<button class="btn btn-outline" data-action="forfeit" data-side="1"' + (!ready ? ' disabled' : '') + '>' + esc(g.t1.name) + ' didn’t show</button>' +
            '<button class="btn btn-outline" data-action="forfeit" data-side="2"' + (!ready ? ' disabled' : '') + '>' + esc(g.t2.name) + ' didn’t show</button>') +
      '</div></details>';
  }

  function tickTimer() {
    var el = doc.getElementById('timer-display');
    if (!el) return;
    var t = (live(el.getAttribute('data-sport'), el.getAttribute('data-div')).timers || {})[el.getAttribute('data-game')];
    if (!t) return;
    el.textContent = T.display(t, KO.now());
    el.classList.toggle('t-up', T.isTimeUp(t, KO.now()));
    el.classList.toggle('t-running', !!t.running);
  }
  setInterval(tickTimer, 250);

  // ---------------------------------------------------------------------------
  // Teams
  // ---------------------------------------------------------------------------

  function teamsPage() {
    var l = live();
    var teams = l.teams || {};
    var dq = l.dq || {};
    var ids = Object.keys(teams).sort(function (a, b) { return teams[a].name.localeCompare(teams[b].name); });
    var soccer = state.sport === 'soccer';
    var groupSel = function (id, cur) {
      return '<select class="input input-sm" data-action="group" data-team="' + esc(id) + '" aria-label="Group">' +
        ['', 'A', 'B'].map(function (g) {
          return '<option value="' + g + '"' + ((cur || '') === g ? ' selected' : '') + '>' + (g ? 'Group ' + g : 'No group') + '</option>';
        }).join('') + '</select>';
    };
    return '<h1 class="display-sm">' + esc(sportName(state.sport) + ' · ' + divName(state.div)) + ' teams <span class="count">' + ids.length + '</span></h1>' +
      '<form id="add-team" class="add-team card">' +
        '<label class="label" for="team-name">Add a team</label>' +
        '<div class="row"><input class="input" id="team-name" placeholder="Team name" autocomplete="off" required>' +
        (soccer ? '<select class="input" id="team-group" aria-label="Group"><option value="A">Group A</option><option value="B">Group B</option></select>' : '') +
        '<button class="btn" type="submit">Add</button></div>' +
        '<p class="muted small">Tip: paste several names, one per line, to add them all at once.</p>' +
      '</form>' +
      (ids.length ? '<ul class="team-rows">' + ids.map(function (id) {
        var t = teams[id];
        var hasGames = A.teamHasGames(l, id);
        return '<li class="' + (dq[id] ? 'is-dq' : '') + '">' +
          '<span class="tr-name">' + esc(t.name) + (dq[id] ? ' <span class="pill pill-dq">DQ</span>' : '') + '</span>' +
          (soccer ? groupSel(id, t.group) : '') +
          '<span class="tr-btns">' +
            '<button class="btn btn-ghost btn-sm" data-action="rename" data-team="' + esc(id) + '">Rename</button>' +
            '<button class="btn btn-ghost btn-sm" data-action="dq" data-team="' + esc(id) + '">' + (dq[id] ? 'Undo DQ' : 'DQ') + '</button>' +
            '<button class="btn btn-ghost btn-sm" data-action="remove-team" data-team="' + esc(id) + '"' + (hasGames ? ' disabled title="Has games"' : '') + '>Remove</button>' +
          '</span></li>';
      }).join('') + '</ul>' : '<p class="empty">No teams yet.</p>') +
      '<p class="muted small">Teams reach the public site when you <a href="#publish">publish</a> this division.</p>';
  }

  // ---------------------------------------------------------------------------
  // Schedule (whole sport at once, so divisions share courts without clashing)
  // ---------------------------------------------------------------------------

  function schedulePage() {
    var sp = C.SPORTS[state.sport];
    var def = sp.scheduleDefaults;
    var bySport = state.data.live[state.sport];
    var started = A.startedGames(bySport);
    var counts = H.DIVISION_ORDER.map(function (d) {
      var l = bySport[d] || {};
      return divName(d) + ': ' + Object.keys(l.teams || {}).length + ' teams, ' + Object.keys(l.games || {}).length + ' games';
    });
    var fmt = sp.bracket;
    var form = '<form id="sched-form" class="card sched-form">' +
      '<h2 class="display-sm">Build the ' + esc(sp.name) + ' schedule</h2>' +
      '<p class="muted small">Builds all three divisions together so they share the ' + esc(state.sport === 'soccer' ? 'fields' : 'gyms') + ' without clashing. ' + esc(counts.join(' · ')) + '</p>' +
      '<div class="form-grid">' +
        '<label><span class="label">Playoff format</span><select class="input" id="s-format">' +
          [['top8', 'Top 8 → QF, SF, Final'], ['top4', 'Top 4 → SF, Final'], ['groups2', '2 groups → cross semis']].map(function (o) {
            return '<option value="' + o[0] + '"' + (o[0] === fmt ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select></label>' +
        '<label><span class="label">Games per team</span><input class="input" id="s-per" type="number" min="1" max="20" placeholder="All" value="' + (def.gamesPerTeam || '') + '"></label>' +
        '<label class="span2"><span class="label">Fields / gyms (comma separated)</span><input class="input" id="s-courts" value="' + esc(def.courts) + '"></label>' +
        '<label><span class="label">First game</span><input class="input" id="s-start" type="time" value="' + esc(def.start) + '"></label>' +
        '<label><span class="label">Minutes per slot</span><input class="input" id="s-slot" type="number" min="5" max="120" value="' + def.slotMinutes + '"></label>' +
        '<label><span class="label">Rest slots between a team\'s games</span><input class="input" id="s-rest" type="number" min="0" max="5" value="0"></label>' +
      '</div>' +
      '<p class="muted small">Games per team is ignored for the 2-group format (everyone plays their group).</p>' +
      '<div class="t-btns"><button class="btn" type="submit">Preview</button></div>' +
    '</form>';

    var preview = '';
    if (state.preview && state.preview.sport === state.sport) {
      var p = state.preview;
      if (p.error) {
        preview = '<p class="notice">' + esc(p.error) + '</p>';
      } else {
        var all = [];
        Object.keys(p.games).forEach(function (d) { Object.keys(p.games[d]).forEach(function (id) { all.push(p.games[d][id]); }); });
        all.sort(function (a, b) { return a.startsAt - b.startsAt; });
        var last = all[all.length - 1];
        preview = '<section class="card preview">' +
          '<div class="kicker">Preview</div>' +
          '<p><b>' + all.length + ' games</b> · first ' + esc(fmtTime(all[0].startsAt)) + ' · last starts ' + esc(fmtTime(last.startsAt)) + ' (' + esc(last.court) + ')</p>' +
          '<ul>' + H.DIVISION_ORDER.map(function (d) {
            var n = p.games[d] ? Object.keys(p.games[d]).length : 0;
            return '<li>' + esc(divName(d)) + ': ' + n + ' games</li>';
          }).join('') + '</ul>' +
          (started ? '<p class="notice">' + started + ' game(s) have already started or finished. Saving will erase their scores.</p>' : '') +
          '<div class="t-btns"><button class="btn" data-action="save-schedule">Save schedule (replaces current games)</button>' +
          '<button class="btn btn-outline" data-action="clear-preview">Cancel</button></div></section>';
      }
    }

    // current games of the selected division
    var v = view(state.sport, state.div);
    var list = '<h2 class="display-sm">Games · ' +
      '<span class="chips inline">' + H.DIVISION_ORDER.map(function (d) {
        return '<button class="chip" data-action="div" data-div="' + d + '" aria-pressed="' + (d === state.div) + '">' + esc(divName(d)) + '</button>';
      }).join('') + '</span></h2>' +
      (v.games.length ? '<div class="sched-table">' + v.games.map(function (g) {
        return '<div class="st-row">' +
          '<span class="st-time">' + esc(fmtTime(g.startsAt)) + '</span>' +
          '<span class="st-court">' + esc(g.court || '') + '</span>' +
          '<span class="st-teams">' + esc(g.t1.name) + ' <span class="muted">vs</span> ' + esc(g.t2.name) + ' <span class="muted small">' + esc(KO.gameName(g.id, g)) + '</span></span>' +
          '<span class="st-btns"><button class="btn btn-ghost btn-sm" data-action="edit-game" data-game="' + esc(g.id) + '">Edit</button>' +
          '<button class="btn btn-ghost btn-sm" data-action="delete-game" data-game="' + esc(g.id) + '">Delete</button></span>' +
        '</div>';
      }).join('') + '</div>' : '<p class="empty">No games yet.</p>');

    return form + preview + list;
  }

  // ---------------------------------------------------------------------------
  // Standings (+ coin-flip order) and bracket preview
  // ---------------------------------------------------------------------------

  function standingsPage() {
    var v = view();
    if (!v.standings.length) return '<p class="empty">No teams yet.</p>';
    var groups = {};
    v.standings.forEach(function (r) { (groups[r.group || ''] = groups[r.group || ''] || []).push(r); });
    var tables = Object.keys(groups).sort().map(function (g) {
      var rows = groups[g];
      return (g ? '<h3 class="sub-head">Group ' + esc(g) + '</h3>' : '') +
        '<div class="table-scroll"><table class="standings"><thead><tr><th>#</th><th class="tm">Team</th><th>P</th><th>W</th><th>L</th>' +
        (state.sport === 'soccer' ? '<th>D</th><th>Pts</th>' : '') + '<th>Diff</th><th></th></tr></thead><tbody>' +
        rows.map(function (r, i) {
          var canUp = r.needsTiebreak && i > 0 && rows[i - 1].needsTiebreak && rows[i - 1].points === r.points;
          return '<tr class="' + (r.dq ? 'dq' : '') + '"><td>' + (r.dq ? '–' : r.rank) + '</td><td class="tm">' + esc(r.name) +
            (r.dq ? ' <span class="pill pill-dq">DQ</span>' : '') + (r.needsTiebreak && r.played ? ' <span class="pill pill-gold">Tie</span>' : '') + '</td>' +
            '<td>' + r.played + '</td><td>' + r.wins + '</td><td>' + r.losses + '</td>' +
            (state.sport === 'soccer' ? '<td>' + r.draws + '</td><td>' + r.points + '</td>' : '') +
            '<td>' + (r.diff > 0 ? '+' : '') + r.diff + '</td>' +
            '<td>' + (canUp ? '<button class="btn btn-ghost btn-sm" data-action="move-up" data-team="' + esc(r.teamId) + '" title="Coin flip: move above the team before">↑ Move up</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).join('');

    var bracket = v.games.filter(function (g) { return g.isBracket; });
    var seeds = Object.keys(v.seeds).map(function (k) {
      var id = v.seeds[k];
      return '<span class="seed"><b>' + esc(k) + '</b> ' + esc(v.teams[id] ? v.teams[id].name : id) + '</span>';
    }).join('');

    return '<h1 class="display-sm">Standings · ' + esc(sportName(state.sport) + ' ' + divName(state.div)) + '</h1>' +
      '<p class="muted small">Same calculation as the public site. “Tie” = nothing breaks it; use ↑ after a coin flip.</p>' + tables +
      ((live().manualOrder || []).length ? '<p><button class="btn btn-ghost btn-sm" data-action="clear-order">Clear coin-flip order</button></p>' : '') +
      '<h2 class="display-sm">Seeds</h2><div class="seeds">' + (seeds || '<span class="muted">None yet</span>') + '</div>' +
      '<h2 class="display-sm">Bracket</h2>' + (bracket.length ? '<div class="g-list">' + bracket.map(gameItem).join('') + '</div>' : '<p class="empty">No bracket games — build the schedule.</p>');
  }

  // ---------------------------------------------------------------------------
  // Publish + banner + sandbox tools
  // ---------------------------------------------------------------------------

  function publishPage() {
    var d = state.data;
    var rows = H.SPORT_ORDER.map(function (s) {
      return '<tr><th>' + esc(sportName(s)) + '</th>' + H.DIVISION_ORDER.map(function (dv) {
        var l = d.live[s][dv] || {};
        var nt = Object.keys(l.teams || {}).length;
        var ng = Object.keys(l.games || {}).length;
        var at = d.publishedAt[s][dv];
        return '<td><div class="pub-cell"><span class="muted small">' + nt + ' teams · ' + ng + ' games</span>' +
          '<span class="small">' + (at ? 'Published ' + esc(ago(at)) : '<b>Not published</b>') + '</span>' +
          '<button class="btn btn-sm" data-action="publish" data-sport="' + s + '" data-div="' + dv + '"' + (nt ? '' : ' disabled') + '>Publish</button></div></td>';
      }).join('') + '</tr>';
    }).join('');
    var b = d.banner || {};
    var sandbox = KO.mode === 'sandbox';
    return '<h1 class="display-sm">Publish to the public site</h1>' +
      '<p class="muted small">The public site only shows what’s published. Publish after adding teams or changing the schedule. ' +
      'Once a division is published, scores update on the public site automatically.</p>' +
      '<div class="table-scroll"><table class="pub-table"><thead><tr><th></th>' +
        H.DIVISION_ORDER.map(function (dv) { return '<th>' + esc(divName(dv)) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p><button class="btn btn-outline" data-action="publish-all">Publish everything</button></p>' +

      '<form id="banner-form" class="card banner-form">' +
        '<h2 class="display-sm">Announcement banner</h2>' +
        '<p class="muted small">Shown at the top of every public page and TV. Leave empty to hide.</p>' +
        '<input class="input" id="banner-text" data-fresh value="' + esc(b.text || '') + '" placeholder="e.g. Basketball running 15 minutes behind">' +
        '<div class="row"><select class="input" id="banner-level" data-fresh>' +
          [['info', 'Gold (info)'], ['alert', 'Red (urgent)']].map(function (o) {
            return '<option value="' + o[0] + '"' + ((b.level || 'info') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select>' +
        '<button class="btn" type="submit">Save banner</button></div>' +
      '</form>' +

      '<section class="card links"><h2 class="display-sm">Open</h2><div class="t-btns">' +
        '<a class="btn btn-outline" href="index.html" target="_blank" rel="noopener">Public site ↗</a>' +
        '<a class="btn btn-outline" href="tv.html" target="_blank" rel="noopener">TV screens ↗</a>' +
      '</div></section>' +

      '<section class="card sandbox-tools"><h2 class="display-sm">Test teams</h2>' +
        '<p class="muted small">Adds 8 made-up teams to every division (soccer split into Groups A/B) and publishes them, ' +
        'so you can try the schedule, scoring and TVs. Your real teams are kept. Remove them before the event.</p><div class="t-btns">' +
        '<button class="btn" data-action="test-teams">Add test teams</button>' +
        '<button class="btn btn-outline" data-action="remove-test-teams">Remove test teams</button></div>' +
        (state.testStatus ? '<div class="notice' + (state.testStatus.err ? ' notice-err' : '') + '">' + esc(state.testStatus.text) + '</div>' : '') +
        '</section>' +

      (sandbox ? '<section class="card sandbox-tools"><h2 class="display-sm">Sandbox tools</h2>' +
        '<p class="muted small">Firebase isn’t set up yet, so everything here is saved only in this browser. ' +
        'Load a full made-up tournament to try every screen, then reset when done.</p><div class="t-btns">' +
        '<button class="btn" data-action="seed">Load demo tournament</button>' +
        '<button class="btn btn-outline" data-action="reset-sandbox">Reset sandbox</button></div></section>' : '');
  }

  // ---------------------------------------------------------------------------
  // Routing + events
  // ---------------------------------------------------------------------------

  // No "are you sure" pop-up: adding test teams never removes anything, and
  // Chrome can silently block pop-ups. The result shows on the Publish page.
  function runAddTestTeams() {
    state.testStatus = { text: 'Adding test teams…' };
    render();
    return A.addTestTeams().then(function (r) {
      state.testStatus = { text: (r.added ? 'Done: added ' + r.added + ' test teams' : 'Done: test teams were already there') +
        ' and published all 9 divisions.' };
      toast(state.testStatus.text);
      render();
    }, function (e) {
      state.testStatus = { err: true, text: 'Could not add test teams: ' + (e && e.code ? e.code + ' — ' : '') + (e && e.message ? e.message : String(e)) };
      toast(state.testStatus.text, 'err');
      render();
    });
  }

  function route() {
    var r = H.parseHash(root.location.hash);
    // Link admin.html#publish&do=add-test-teams adds the test teams by itself once
    // a signed-in admin opens it (used to set up a test run in one step).
    if (r.params['do'] === 'add-test-teams' && state.user && state.data) {
      root.history.replaceState(null, '', '#publish');
      r = H.parseHash('#publish');
      setTimeout(runAddTestTeams, 0);
    }
    var page = r.page === 'home' ? 'score' : r.page;
    if (r.params.game) page = 'game';
    var changed = page !== state.page || r.params.game !== state.params.game;
    state.page = page;
    state.params = r.params;
    if (page === 'game') {
      var f = findGame(r.params.game);
      if (f) { state.sport = f.sport; state.div = f.div; }
    }
    render();
    if (changed) root.scrollTo(0, 0);
  }
  // parseHash treats '#game=x' as params — handle it
  function currentGame() {
    var f = findGame(state.params.game);
    return f;
  }

  function act(fn, okMsg) {
    var f = currentGame();
    if (!f) return;
    return result(A.gameAction(f.sport, f.div, f.game.id, fn), okMsg);
  }

  doc.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'SELECT' || el.disabled) return;
    var a = el.getAttribute('data-action');
    var team = el.getAttribute('data-team');
    var f, g, sport, div;

    switch (a) {
      case 'signout': KO.signOut(); break;
      case 'sport':
        state.sport = el.getAttribute('data-sport'); state.preview = null; saveCtx();
        if (state.page === 'game') root.location.hash = '#score'; else render();
        break;
      case 'div': state.div = el.getAttribute('data-div'); saveCtx(); render(); break;

      // --- scorer
      case 'points':
        act(function (cur) { return S.addPoints(cur, +el.getAttribute('data-side'), +el.getAttribute('data-n')); });
        break;
      case 'start': act(S.startGame, 'Game started'); break;
      case 'final':
        f = currentGame();
        if (f && root.confirm('End the game? Final score ' + (f.game.score1 || 0) + '–' + (f.game.score2 || 0) + '.')) {
          act(function (cur) { return S.finalize(cur, f.game.isBracket); }, 'Game final');
          var t = (live(f.sport, f.div).timers || {})[f.game.id];
          if (t && t.running) A.timerAction(f.sport, f.div, f.game.id, function (cur, now) { return cur ? T.pause(cur, now) : cur; });
        }
        break;
      case 'reopen': if (root.confirm('Reopen this game for corrections?')) act(S.reopen, 'Game reopened'); break;
      case 'endset': act(S.endSet); break;
      case 'undoset': if (root.confirm('Undo the last finished set?')) act(S.undoSet); break;
      case 'winner':
        f = currentGame();
        act(function (cur) { return S.setWinner(cur, team, f.game.t1.id, f.game.t2.id); }, 'Winner set');
        break;
      case 'setscore':
        f = currentGame();
        var txt = root.prompt('Score as "' + f.game.t1.name + '–' + f.game.t2.name + '", e.g. 3-2' +
          (f.sport === 'volleyball' ? ' (current set)' : ''), (f.game.score1 || 0) + '-' + (f.game.score2 || 0));
        if (txt == null) break;
        var m = /^\s*(\d+)\s*[-–:]\s*(\d+)\s*$/.exec(txt);
        if (!m) { toast('Use the form 3-2', 'err'); break; }
        act(function (cur) { return S.setScore(cur, +m[1], +m[2]); }, 'Score updated');
        break;
      case 'forfeit':
        f = currentGame();
        var side = +el.getAttribute('data-side');
        var no = side === 1 ? f.game.t1 : f.game.t2;
        var yes = side === 1 ? f.game.t2 : f.game.t1;
        if (root.confirm(no.name + ' didn’t show. ' + yes.name + ' gets the win (' + C.SPORTS[f.sport].forfeit + ') Continue?')) {
          act(function (cur) { return S.forfeit(cur, side); }, 'Forfeit recorded');
        }
        break;
      case 'clearforfeit': act(S.clearForfeit, 'Forfeit removed'); break;

      // --- timer
      case 'timer':
        f = currentGame();
        if (!f) break;
        var op = el.getAttribute('data-op');
        if (op === 'start') {
          A.timerAction(f.sport, f.div, f.game.id, function (cur, now) { return T.start(cur || A.defaultTimer(f.sport, now), now); });
          if (f.game.status === 'scheduled' && f.game.t1.known && f.game.t2.known) act(S.startGame);
        } else if (op === 'pause') {
          A.timerAction(f.sport, f.div, f.game.id, function (cur, now) { return cur ? T.pause(cur, now) : cur; });
        } else if (op === 'reset') {
          var cfg = C.SPORTS[f.sport].timer;
          var mins = null;
          if (cfg.direction === 'down') {
            var cur0 = (live(f.sport, f.div).timers || {})[f.game.id];
            var ans = root.prompt('Reset the clock. Minutes for this period:', String(cur0 ? Math.round(cur0.duration / 60000) : cfg.minutes));
            if (ans == null) break;
            mins = parseFloat(ans);
            if (!(mins > 0)) { toast('Enter minutes, e.g. 20', 'err'); break; }
          } else if (!root.confirm('Reset the stopwatch to 00:00?')) break;
          result(A.timerAction(f.sport, f.div, f.game.id, function (cur, now) {
            return T.reset(cur || A.defaultTimer(f.sport, now), mins ? mins * 60000 : null, now);
          }), 'Clock reset');
        } else if (op === 'adjust') {
          var label = C.SPORTS[f.sport].timer.direction === 'down' ? 'Time LEFT on the clock' : 'Time PLAYED';
          var val = root.prompt(label + ' (mm:ss):', doc.getElementById('timer-display').textContent);
          if (val == null) break;
          var mm = /^\s*(\d+):(\d{1,2})\s*$/.exec(val);
          if (!mm) { toast('Use mm:ss, e.g. 12:30', 'err'); break; }
          var ms = (+mm[1] * 60 + +mm[2]) * 1000;
          result(A.timerAction(f.sport, f.div, f.game.id, function (cur, now) {
            return T.adjust(cur || A.defaultTimer(f.sport, now), ms, now);
          }), 'Clock set');
        }
        break;

      // --- teams
      case 'rename':
        g = live().teams[team];
        var nn = root.prompt('New name for ' + g.name + ':', g.name);
        if (nn != null) result(A.updateTeam(state.sport, state.div, team, { name: nn }), 'Renamed');
        break;
      case 'dq':
        var isDq = !!(live().dq || {})[team];
        if (root.confirm(isDq ? 'Undo DQ for ' + live().teams[team].name + '?' :
          'Disqualify ' + live().teams[team].name + '? Their remaining games go to their opponents and they drop to the bottom of the standings.')) {
          result(A.setDq(state.sport, state.div, team, !isDq), isDq ? 'DQ removed' : 'Team disqualified');
        }
        break;
      case 'remove-team':
        if (root.confirm('Remove ' + live().teams[team].name + '?')) result(A.removeTeam(state.sport, state.div, live(), team), 'Team removed');
        break;

      // --- schedule
      case 'save-schedule':
        var started = A.startedGames(state.data.live[state.sport]);
        if (started && root.prompt(started + ' game(s) already have scores that will be erased. Type REPLACE to continue.') !== 'REPLACE') break;
        if (!started && !root.confirm('Save this schedule? It replaces all current ' + sportName(state.sport) + ' games.')) break;
        result(A.saveSchedule(state.sport, state.preview.games).then(function () { state.preview = null; }), 'Schedule saved — publish when ready');
        break;
      case 'clear-preview': state.preview = null; render(); break;
      case 'edit-game':
        var lg = live().games[el.getAttribute('data-game')];
        var nt = root.prompt('Start time (HH:MM, 24-hour):', lg.startsAt ? hhmm(lg.startsAt) : '');
        if (nt == null) break;
        if (!/^\d{1,2}:\d{2}$/.test(nt.trim())) { toast('Use HH:MM, e.g. 14:30', 'err'); break; }
        var nc = root.prompt('Field / gym:', lg.court || '');
        if (nc == null) break;
        var startsAt = dayTime(state.sport, nt.trim());
        var len = lg.endsAt && lg.startsAt ? lg.endsAt - lg.startsAt : C.SPORTS[state.sport].scheduleDefaults.slotMinutes * 60000;
        result(A.editGame(state.sport, state.div, lg.id, { startsAt: startsAt, endsAt: startsAt + len, court: nc.trim() }), 'Game updated');
        break;
      case 'delete-game':
        if (root.confirm('Delete this game?')) result(A.deleteGame(state.sport, state.div, el.getAttribute('data-game')), 'Game deleted');
        break;

      // --- standings
      case 'move-up':
        var order = view().standings.map(function (r) { return r.teamId; });
        var i = order.indexOf(team);
        if (i > 0) { var tmp = order[i - 1]; order[i - 1] = order[i]; order[i] = tmp; }
        result(A.setManualOrder(state.sport, state.div, order), 'Order saved');
        break;
      case 'clear-order': result(A.setManualOrder(state.sport, state.div, null), 'Coin-flip order cleared'); break;

      // --- publish
      case 'publish':
        sport = el.getAttribute('data-sport'); div = el.getAttribute('data-div');
        result(A.publishDivision(sport, div), sportName(sport) + ' ' + divName(div) + ' published');
        break;
      case 'publish-all':
        if (!root.confirm('Publish all sports and divisions that have teams?')) break;
        var jobs = [];
        H.SPORT_ORDER.forEach(function (s) {
          H.DIVISION_ORDER.forEach(function (dv) {
            if (Object.keys((state.data.live[s][dv] || {}).teams || {}).length) jobs.push(A.publishDivision(s, dv));
          });
        });
        result(Promise.all(jobs), 'Published ' + jobs.length + ' division(s)');
        break;
      case 'test-teams':
        runAddTestTeams();
        break;
      case 'remove-test-teams':
        if (!root.confirm('Remove all test teams?')) break;
        result(A.removeTestTeams().then(function (r) {
          if (r.blocked.length) toast('Removed ' + r.removed + '. Not removed (they have games — clear the schedule first): ' + r.blocked.join(', '), 'err');
          else toast('Removed ' + r.removed + ' test teams');
          return r;
        }));
        break;
      case 'seed':
        if (root.confirm('Replace everything in the sandbox with a made-up demo tournament?')) result(A.seedDemo(), 'Demo tournament loaded');
        break;
      case 'reset-sandbox':
        if (root.confirm('Erase everything in the sandbox?')) result(A.resetSandbox(), 'Sandbox cleared');
        break;
    }
  });

  doc.addEventListener('change', function (e) {
    var el = e.target;
    if (el.getAttribute('data-action') === 'group') {
      result(A.updateTeam(state.sport, state.div, el.getAttribute('data-team'), { group: el.value || null }), 'Group saved');
    }
  });

  doc.addEventListener('submit', function (e) {
    e.preventDefault();
    var id = e.target.id;
    if (id === 'login-form') {
      result(KO.signIn(doc.getElementById('login-email').value, doc.getElementById('login-pass').value).catch(function (err) {
        return { error: 'Sign-in failed: ' + (err && err.message ? err.message : 'check email and password') };
      }));
    } else if (id === 'add-team') {
      var input = doc.getElementById('team-name');
      var grp = doc.getElementById('team-group');
      var names = input.value.split(/\n|,(?=\s*\S)/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (names.length <= 1) names = [input.value];
      var chain = Promise.resolve();
      var added = 0, errors = [];
      names.forEach(function (n) {
        chain = chain.then(function () {
          return A.addTeam(state.sport, state.div, n, grp ? grp.value : null).then(function (r) {
            if (r.error) errors.push(n + ': ' + r.error); else added++;
          });
        });
      });
      chain.then(function () {
        if (errors.length) toast(errors.join(' · '), 'err'); else toast(added === 1 ? 'Team added' : added + ' teams added');
        if (added) { input.value = ''; input.focus(); }
      });
    } else if (id === 'sched-form') {
      var courts = doc.getElementById('s-courts').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var startStr = doc.getElementById('s-start').value || '09:00';
      var per = parseInt(doc.getElementById('s-per').value, 10);
      var res = A.buildSchedule(state.sport, state.data.live[state.sport], {
        format: doc.getElementById('s-format').value,
        gamesPerTeam: per > 0 ? per : null,
        courts: courts.length ? courts : ['Court 1'],
        startsAt: dayTime(state.sport, startStr),
        slotMinutes: parseInt(doc.getElementById('s-slot').value, 10) || 30,
        minRestSlots: parseInt(doc.getElementById('s-rest').value, 10) || 0
      });
      state.preview = Object.assign({ sport: state.sport }, res);
      render();
    } else if (id === 'banner-form') {
      result(A.setBanner(doc.getElementById('banner-text').value, doc.getElementById('banner-level').value), 'Banner saved');
    }
  });

  // Paste a list of names → textarea-like behaviour on the single-line input
  doc.addEventListener('paste', function (e) {
    if (e.target.id !== 'team-name') return;
    var text = (e.clipboardData || root.clipboardData).getData('text');
    if (text.indexOf('\n') === -1) return;
    e.preventDefault();
    e.target.value = text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean).join(', ');
  });

  root.addEventListener('hashchange', route);

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  // Is this device actually reaching Firebase? Shown in the header, because
  // while offline Firebase keeps changes on the device and the page looks normal.
  state.connected = KO.mode === 'sandbox';
  KO.onConnectionChange(function (ok) {
    state.connected = ok;
    renderShell();
  });

  var watching = false;
  KO.onAuthChange(function (user) {
    state.user = user;
    state.authReady = true;
    if (user && !watching) {
      watching = true;
      A.watchAll(function (data) { state.data = data; route(); });
    }
    route();
  });
})(typeof window !== 'undefined' ? window : this);
