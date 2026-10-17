/*
 * KO 2027 — Public page templates. Each function returns an HTML string.
 * All text from data goes through esc().
 */
(function (root) {
  'use strict';

  var KO = root.KO;
  var H = KO.helpers;
  var C = KO.config;
  var esc = H.escapeHtml;
  var TZ = C.EVENT.timezone;

  var ROUND_NAMES = {
    rr: 'Pool play', ga: 'Group A', gb: 'Group B',
    qf: 'Quarterfinal', sf: 'Semifinal', final: 'Final', third: '3rd place'
  };
  var ADVANCE = { soccer: 2, basketball: 8, volleyball: 4 }; // per group / table

  var ICONS = {
    soccer: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.2l3.6 2.6-1.4 4.2H9.8L8.4 9.8z" fill="currentColor"/><path d="M12 7.2V2.6M15.6 9.8l4.3-1.4M14.2 14l2.7 3.7M9.8 14l-2.7 3.7M8.4 9.8L4.1 8.4" stroke="currentColor" stroke-width="1.4"/></svg>',
    basketball: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 12h19M12 2.5v19M5.3 5.3c3 2.4 3 11 0 13.4M18.7 5.3c-3 2.4-3 11 0 13.4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    volleyball: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 2.5c-1 4.5 0 8 0 9.5s-4.6 4.4-8.8 4.4M12 12c1.7.8 6.6 0 9.2-3.5M12 12c-.6 2 .9 6.6 4.7 8.8" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'
  };
  function icon(sport) { return '<span class="sport-icon">' + (ICONS[sport] || '') + '</span>'; }

  function sportName(s) { return C.SPORTS[s].name; }
  function divName(d) { return C.EVENT.divisions[d]; }
  function dayFor(sport) { return C.EVENT.days.filter(function (d) { return d.sport === sport; })[0]; }
  function dayDateLabel(sport) {
    var d = dayFor(sport);
    var p = d.date.split('-').map(Number);
    // noon UTC keeps the date stable in Toronto
    return H.formatDate(Date.UTC(p[0], p[1] - 1, p[2], 16), TZ);
  }
  function shortDate(sport) {
    var parts = dayDateLabel(sport).split(', ');
    return parts[0].slice(0, 3) + ' · ' + parts[1];
  }
  function href(page, params) { return H.buildHash(page, params || {}); }
  function teamLink(side, cls) {
    if (!side.known) return '<span class="tbd ' + (cls || '') + '">' + esc(side.name) + '</span>';
    return '<a class="team-link ' + (cls || '') + '" href="' + href('team', { team: side.id }) + '">' +
      esc(side.name) + (side.dq ? ' <span class="pill pill-dq">DQ</span>' : '') + '</a>';
  }

  // ---------------------------------------------------------------------------
  // Shared pieces
  // ---------------------------------------------------------------------------

  function statusPill(g) {
    if (g.status === 'live') {
      var extra = g.sport === 'volleyball' && g.currentSet ? ' · Set ' + g.currentSet : '';
      return '<span class="pill pill-live">Live' + esc(extra) + '</span>';
    }
    if (g.status === 'final') {
      var tag = g.forfeitBy ? 'Forfeit' : g.result && g.result.walkover ? 'Walkover' : 'Final';
      return '<span class="pill pill-final">' + tag + '</span>';
    }
    return '';
  }

  // '10:30' with a small AM/PM
  function clock(ms) {
    if (ms == null) return 'TBD';
    var parts = H.formatTime(ms, TZ).split(' ');
    return esc(parts[0]) + '<small>' + esc(parts[1] || '') + '</small>';
  }

  function roundLabel(g) {
    return ROUND_NAMES[g.round] || g.round;
  }

  // One schedule row (Gameday Hub style): time | sport · round / teams | score
  function gameRow(g, opts) {
    opts = opts || {};
    var score = H.scoreText(g);
    var r = g.result || {};
    var win1 = r.decided && r.winnerId && r.winnerId === g.t1.id;
    var win2 = r.decided && r.winnerId && r.winnerId === g.t2.id;
    var meta = [];
    if (opts.showSport !== false) meta.push(sportName(g.sport));
    if (opts.showDivision !== false) meta.push(divName(g.division));
    meta.push(roundLabel(g));
    var sets = '';
    if (g.sport === 'volleyball' && g.sets && g.sets.length) {
      sets = '<div class="sets">' + g.sets.map(function (s) {
        return '<span class="' + (s.done ? '' : 'cur') + '">' + esc(s.s1) + '–' + esc(s.s2) + '</span>';
      }).join('') + '</div>';
    }
    var hi = opts.highlight;
    return '<article class="game-row status-' + esc(g.status) + '">' +
      '<div class="gr-time"><span class="t">' + clock(g.startsAt) + '</span>' +
        '<span class="c">' + esc(g.court || '') + '</span></div>' +
      '<div class="gr-main">' +
        '<div class="gr-meta">' + esc(meta.join(' · ')) + ' ' + statusPill(g) + '</div>' +
        '<div class="gr-team' + (win1 ? ' win' : '') + (hi && g.t1.id === hi ? ' mine' : '') + '">' + teamLink(g.t1) +
          (score ? '<b class="sc">' + esc(score[0]) + '</b>' : '') + '</div>' +
        '<div class="gr-team' + (win2 ? ' win' : '') + (hi && g.t2.id === hi ? ' mine' : '') + '">' + teamLink(g.t2) +
          (score ? '<b class="sc">' + esc(score[1]) + '</b>' : '') + '</div>' +
        sets +
        (r.problem && g.isBracket && g.status === 'final' ? '<div class="gr-note">' + esc(r.problem) + '</div>' : '') +
      '</div>' +
    '</article>';
  }

  function findTeamBlock(state, opts) {
    opts = opts || {};
    return '<section class="find card-glow' + (opts.compact ? ' compact' : '') + '">' +
      '<div class="kicker">Start here</div>' +
      '<h2 class="display">Find your team</h2>' +
      '<p class="lead">Search your team to see only your games, field and next match.</p>' +
      '<label class="label" for="team-search">Team name</label>' +
      '<div class="search-box">' +
        '<input id="team-search" class="input" type="search" autocomplete="off" placeholder="Search or choose a team…" ' +
          'value="' + esc(state.query || '') + '" data-action="search">' +
        '<div class="search-results" id="search-results">' + searchResults(state) + '</div>' +
      '</div>' +
    '</section>';
  }

  function searchResults(state) {
    if (!state.query) return '';
    var list = H.searchTeams(H.allTeams(state.store.views), state.query, 12);
    if (!list.length) return '<div class="sr-empty">No team matches “' + esc(state.query) + '”</div>';
    return list.map(function (t) {
      return '<a class="sr-item" href="' + href('team', { team: t.id }) + '">' +
        icon(t.sport) + '<span class="n">' + esc(t.name) + '</span>' +
        '<span class="m">' + esc(sportName(t.sport) + ' · ' + divName(t.division)) + '</span></a>';
    }).join('');
  }

  function sectionHead(kicker, title, extra) {
    return '<header class="sec-head"><div><div class="kicker">' + esc(kicker) + '</div>' +
      '<h2 class="display">' + esc(title) + '</h2></div>' + (extra || '') + '</header>';
  }

  // ---------------------------------------------------------------------------
  // Home
  // ---------------------------------------------------------------------------

  function statusLine(state) {
    var now = state.store.now();
    var ph = H.eventPhase(now, C.EVENT.days, TZ);
    if (ph.phase === 'before') {
      return ph.daysUntil === 1 ? 'Kicks off tomorrow' : ph.daysUntil + ' days to go';
    }
    if (ph.phase === 'during') return 'Today: ' + sportName(ph.day.sport) + ' · ' + ph.day.label;
    if (ph.phase === 'between') return 'Next: ' + sportName(ph.day.sport);
    return 'Thank you for an incredible ' + C.EVENT.year;
  }

  // Crossfading photo slideshow behind the hero. app.js advances state.slide
  // and skips photos that fail to load; re-renders keep the current photo.
  function heroSlides(state) {
    var slides = state.slides || [];
    return '<div class="hero-slides" aria-hidden="true">' + slides.map(function (x, i) {
      return '<div class="hero-slide' + (i === state.slide ? ' on' : '') + (x.bad ? ' bad' : '') + '" data-i="' + i + '" ' +
        'style="background-image:url(\'' + esc(x.url) + '\')"></div>';
    }).join('') + '</div><div class="hero-shade"></div>';
  }

  function heroNav(state) {
    var slides = state.slides || [];
    var ok = slides.filter(function (x) { return !x.bad; });
    var pos = Math.max(0, ok.indexOf(slides[state.slide]));
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return (ok.length > 1 ? '<div class="hero-nav wrap"><span class="hero-count"><b>' + pad(pos + 1) + '</b> / ' + pad(ok.length) +
      ' <span>Moments from the games</span></span>' +
      '<span class="hero-arrows"><button data-action="slide" data-dir="-1" aria-label="Previous photo">←</button>' +
      '<button data-action="slide" data-dir="1" aria-label="Next photo">→</button></span></div>' : '');
  }

  function home(state) {
    var E = C.EVENT;
    var now = state.store.now();
    var ph = H.eventPhase(now, E.days, TZ);
    var focusSport = state.liveSport || (ph.day ? ph.day.sport : 'soccer');

    var hero =
      '<section class="hero">' +
        heroSlides(state) +
        '<div class="wrap hero-inner">' +
          '<div class="kicker hero-ed">' + esc(E.edition) + '</div>' +
          '<h1 class="hero-title"><span>' + esc(E.name.split(' ')[0]) + '</span>' +
            '<span class="gold">' + esc(E.name.split(' ').slice(1).join(' ')) + ' ' + E.year + '</span></h1>' +
          '<p class="hero-when">June 1–3, ' + E.year + ' · ' + esc(E.venue) + '</p>' +
          '<p class="script hero-script" aria-hidden="true">More Than<br>A Game</p>' +
          '<div class="hero-status"><span class="dot"></span>' + esc(statusLine(state)) + '</div>' +
          '<div class="hero-actions">' +
            '<a class="btn" href="#myteam">Find your team →</a>' +
            '<a class="btn btn-outline" href="#schedule">Full schedule</a>' +
          '</div>' +
          '<ul class="pillars">' +
            '<li><span class="pi gurmukhi">ੴ</span><b>Faith</b><small>Stronger souls</small></li>' +
            '<li><span class="pi">◎</span><b>Sports</b><small>Healthier lives</small></li>' +
            '<li><span class="pi">✦</span><b>Community</b><small>A brighter tomorrow</small></li>' +
          '</ul>' +
        '</div>' +
        heroNav(state) +
      '</section>';

    var all = H.allGames(state.store.views, focusSport);
    var ln = H.liveAndNext(all, now);
    var liveList = ln.live.length ? ln.live : ln.next;
    var liveTitle = ln.live.length ? 'Live now' : ln.next.length ? 'Up next' : 'Latest results';
    if (!liveList.length) {
      liveList = all.filter(function (g) { return g.status === 'final'; }).slice(-4).reverse();
    }
    var live =
      '<section class="live-panel card">' +
        '<div class="lp-head"><div class="kicker"><span class="live-dot"></span>Live scores</div>' +
          '<a class="arrow-link" href="' + href('schedule', { sport: focusSport }) + '">View all</a></div>' +
        '<div class="seg seg-sm" role="group" aria-label="Sport">' +
          H.SPORT_ORDER.map(function (s) {
            return '<button data-action="live-sport" data-sport="' + s + '" aria-pressed="' + (s === focusSport) + '">' + esc(sportName(s)) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="lp-sub">' + esc(liveTitle) + '</div>' +
        (liveList.length
          ? liveList.slice(0, 6).map(function (g) { return gameRow(g, { showSport: false }); }).join('')
          : '<p class="empty">No games scheduled yet for ' + esc(sportName(focusSport)) + '.</p>') +
      '</section>';

    var sports =
      '<section class="wrap sec">' +
        sectionHead('Three sports. One community.', 'Our sports') +
        '<div class="sport-cards">' +
          H.SPORT_ORDER.map(function (s, i) {
            var d = dayFor(s);
            return '<a class="sport-card" href="' + href('schedule', { sport: s }) + '" style="--photo:url(\'' + esc(C.photoUrl(C.PHOTOS[s], 'w1000')) + '\')">' +
              '<span class="sc-num">0' + (i + 1) + ' / ' + esc(d.label) + ' · ' + esc(shortDate(s)) + '</span>' +
              icon(s) +
              '<h3>' + esc(sportName(s)) + '</h3>' +
              '<p>' + esc(C.SPORTS[s].tagline) + '</p>' +
              '<span class="sc-arrow">→</span></a>';
          }).join('') +
        '</div>' +
      '</section>';

    return hero +
      '<div class="wrap home-grid">' + findTeamBlock(state) + live + '</div>' +
      sports +
      '<section class="wrap sec">' + championsBlock() + '</section>' +
      numbersBlock() +
      missionBlock();
  }

  function championsBlock() {
    var cur = C.CHAMPIONS[0];
    var cards = H.SPORT_ORDER.map(function (s) {
      return '<div class="champ card">' + icon(s) +
        '<div><div class="champ-sport">' + esc(sportName(s)) + ' <span class="gold">♛</span></div>' +
        '<div class="champ-team">' + esc(cur[s]) + '</div></div></div>';
    }).join('');
    var history = '<table class="champ-table"><thead><tr><th>Year</th>' +
      H.SPORT_ORDER.map(function (s) { return '<th>' + esc(sportName(s)) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      C.CHAMPIONS.map(function (row) {
        return '<tr><th>' + esc(row.year) + '</th>' +
          H.SPORT_ORDER.map(function (s) { return '<td>' + esc(row[s] || '—') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    return sectionHead('Defending champions', cur.year + ' Champions') +
      '<div class="champs">' + cards + '</div>' +
      '<h3 class="sub-head">Past champions</h3>' + history;
  }

  function numbersBlock() {
    var L = C.LAST_YEAR;
    return '<section class="numbers"><div class="wrap">' +
      '<div class="kicker">' + esc(L.year) + ' by the numbers</div>' +
      '<div class="num-row">' + L.stats.map(function (s) {
        return '<div class="num card"><strong>' + esc(s.value) + '</strong><span>' + esc(s.label) + '</span></div>';
      }).join('') + '</div></div></section>';
  }

  function missionBlock() {
    return '<section class="mission"><div class="wrap mission-inner">' +
      '<div><div class="kicker">Our mission</div>' +
      '<h2 class="serif">Building stronger people through sports, faith &amp; community.</h2></div>' +
      '<p class="lead">Khalsa Olympics brings together athletes, families and communities through competition, ' +
      'culture and seva — inspiring healthier lives, stronger connections and a brighter future for the next generation.</p>' +
      '</div></section>';
  }

  // ---------------------------------------------------------------------------
  // Schedule
  // ---------------------------------------------------------------------------

  function schedule(state) {
    var p = state.params;
    var now = state.store.now();
    var ph = H.eventPhase(now, C.EVENT.days, TZ);
    var sport = C.SPORTS[p.sport] ? p.sport : (ph.day ? ph.day.sport : 'soccer');
    var div = C.EVENT.divisions[p.division] ? p.division : 'all';
    var d = dayFor(sport);

    var games = H.allGames(state.store.views, sport).filter(function (g) {
      return div === 'all' || g.division === div;
    });
    var slots = H.groupBySlot(games);

    var seg = '<div class="seg" role="group" aria-label="Day">' + H.SPORT_ORDER.map(function (s) {
      return '<button data-action="go" data-href="' + href('schedule', { sport: s, division: div === 'all' ? '' : div }) +
        '" aria-pressed="' + (s === sport) + '"><span>' + esc(sportName(s)) + '</span><small>' + esc(shortDate(s)) + '</small></button>';
    }).join('') + '</div>';

    var chips = '<div class="chips" role="group" aria-label="Division">' +
      [['all', 'All divisions']].concat(H.DIVISION_ORDER.map(function (x) { return [x, divName(x)]; })).map(function (c) {
        return '<button class="chip" data-action="go" data-href="' + href('schedule', { sport: sport, division: c[0] === 'all' ? '' : c[0] }) +
          '" aria-pressed="' + (c[0] === div) + '">' + esc(c[1]) + '</button>';
      }).join('') + '</div>';

    var body = slots.length ? slots.map(function (slot) {
      var isNow = slot.games.some(function (g) { return g.status === 'live'; });
      return '<div class="slot' + (isNow ? ' slot-now' : '') + '">' + slot.games.map(function (g) {
        return gameRow(g, { showSport: false, showDivision: div === 'all' });
      }).join('') + '</div>';
    }).join('') : '<p class="empty">The ' + esc(sportName(sport)) + ' schedule hasn’t been published yet.</p>';

    return '<div class="wrap page">' +
      findTeamBlock(state, { compact: true }) +
      '<section class="sec">' +
        '<div class="kicker">' + esc(d.label + ' · ' + dayDateLabel(sport)) + '</div>' +
        '<h1 class="display">Full tournament schedule</h1>' +
        '<div class="filters">' + seg + chips + '</div>' +
        '<div class="schedule">' + body + '</div>' +
      '</section></div>';
  }

  // ---------------------------------------------------------------------------
  // Playoffs: standings + bracket
  // ---------------------------------------------------------------------------

  function standingsTable(rows, sport, advance) {
    var soccer = sport === 'soccer';
    var vb = sport === 'volleyball';
    var head = '<tr><th class="rk">#</th><th class="tm">Team</th><th>P</th><th>W</th><th>L</th>' +
      (soccer ? '<th>D</th><th>GD</th><th>Pts</th>' : vb ? '<th>Sets</th><th>Diff</th>' : '<th>Diff</th><th>PF</th>') + '</tr>';
    var n = 0;
    var body = rows.map(function (r) {
      if (!r.dq) n++;
      var q = !r.dq && n <= advance;
      var diff = (r.diff > 0 ? '+' : '') + r.diff;
      return '<tr class="' + (q ? 'q' : '') + (r.dq ? ' dq' : '') + '">' +
        '<td class="rk">' + (r.dq ? '–' : r.rank) + '</td>' +
        '<td class="tm"><a href="' + href('team', { team: r.teamId }) + '">' + esc(r.name) + '</a>' +
          (r.dq ? ' <span class="pill pill-dq">DQ</span>' : '') +
          (r.needsTiebreak && r.played ? ' <span class="pill pill-gold" title="Tied — decided by coin flip">Tie</span>' : '') + '</td>' +
        '<td>' + r.played + '</td><td>' + r.wins + '</td><td>' + r.losses + '</td>' +
        (soccer ? '<td>' + r.draws + '</td><td>' + diff + '</td><td class="pts">' + r.points + '</td>'
          : vb ? '<td>' + r.setsWon + '–' + r.setsLost + '</td><td>' + diff + '</td>'
          : '<td>' + diff + '</td><td>' + r.scored + '</td>') +
      '</tr>';
    }).join('');
    return '<div class="table-scroll"><table class="standings"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function bracketBlock(view) {
    var rounds = ['qf', 'sf', 'final', 'third'];
    var games = view.games.filter(function (g) { return g.isBracket; });
    if (!games.length) return '<p class="empty">Bracket not set up yet.</p>';
    return '<div class="bracket">' + rounds.map(function (rd) {
      var list = games.filter(function (g) { return g.round === rd; });
      if (!list.length) return '';
      return '<div class="br-round"><h4>' + esc(rd === 'qf' ? 'Quarterfinals' : rd === 'sf' ? 'Semifinals' : ROUND_NAMES[rd]) + '</h4>' +
        list.map(function (g) {
          var r = g.result || {};
          var score = H.scoreText(g);
          function line(side, n) {
            var won = r.decided && r.winnerId && r.winnerId === side.id;
            var lost = r.decided && r.loserId && r.loserId === side.id;
            return '<div class="br-team' + (won ? ' win' : '') + (lost ? ' lose' : '') + '">' + teamLink(side) +
              (score ? '<b>' + esc(score[n - 1]) + '</b>' : '') + '</div>';
          }
          return '<div class="br-game' + (g.round === 'final' ? ' br-final' : '') + '">' +
            '<div class="br-meta"><span>' + esc(KO.gameName(g.id, g)) + '</span>' +
              '<span>' + (g.startsAt != null ? esc(H.formatTime(g.startsAt, TZ)) : '') + (g.court ? ' · ' + esc(g.court) : '') + '</span>' +
              statusPill(g) + '</div>' +
            line(g.t1, 1) + line(g.t2, 2) + '</div>';
        }).join('') + '</div>';
    }).join('') + '</div>';
  }

  function champion(view) {
    var f = view.games.filter(function (g) { return g.round === 'final'; })[0];
    if (!f || !f.result || !f.result.decided || !f.result.winnerId) return '';
    var name = view.teams[f.result.winnerId] ? view.teams[f.result.winnerId].name : f.result.winnerId;
    return '<div class="champion-banner"><span class="kicker">' + C.EVENT.year + ' champion</span><strong>' + esc(name) + '</strong><span class="gold">♛</span></div>';
  }

  function playoffs(state) {
    var p = state.params;
    var now = state.store.now();
    var ph = H.eventPhase(now, C.EVENT.days, TZ);
    var sport = C.SPORTS[p.sport] ? p.sport : (ph.day ? ph.day.sport : 'soccer');
    var div = C.EVENT.divisions[p.division] ? p.division : 'd1';
    var view = state.store.views[sport][div];
    var adv = ADVANCE[sport];

    var seg = '<div class="seg" role="group" aria-label="Sport">' + H.SPORT_ORDER.map(function (s) {
      return '<button data-action="go" data-href="' + href('playoffs', { sport: s, division: div }) + '" aria-pressed="' + (s === sport) + '">' + esc(sportName(s)) + '</button>';
    }).join('') + '</div>';
    var chips = '<div class="chips" role="group" aria-label="Division">' + H.DIVISION_ORDER.map(function (x) {
      return '<button class="chip" data-action="go" data-href="' + href('playoffs', { sport: sport, division: x }) + '" aria-pressed="' + (x === div) + '">' + esc(divName(x)) + '</button>';
    }).join('') + '</div>';

    var tables;
    if (!view.standings.length) {
      tables = '<p class="empty">Teams for this division haven’t been published yet.</p>';
    } else if (view.hasGroups) {
      var groups = {};
      view.standings.forEach(function (r) { (groups[r.group] = groups[r.group] || []).push(r); });
      tables = Object.keys(groups).sort().map(function (g) {
        return '<h3 class="sub-head">Group ' + esc(g) + '</h3>' + standingsTable(groups[g], sport, adv);
      }).join('');
    } else {
      tables = standingsTable(view.standings, sport, adv);
    }

    return '<div class="wrap page">' +
      '<div class="kicker">' + esc(dayFor(sport).label + ' · ' + dayDateLabel(sport)) + '</div>' +
      '<h1 class="display">Playoffs</h1>' +
      '<p class="lead">' + esc(C.SPORTS[sport].format) + '</p>' +
      '<div class="filters">' + seg + chips + '</div>' +
      champion(view) +
      '<div class="po-grid">' +
        '<section><h2 class="display-sm">Bracket</h2>' + bracketBlock(view) + '</section>' +
        '<section><h2 class="display-sm">Standings</h2>' +
          '<p class="muted small">Top ' + adv + (view.hasGroups ? ' in each group' : '') + ' advance (gold). ' + esc(C.SPORTS[sport].ranking) + '</p>' +
          tables + '</section>' +
      '</div></div>';
  }

  // ---------------------------------------------------------------------------
  // Team + My Team
  // ---------------------------------------------------------------------------

  function team(state, id) {
    var views = state.store.views;
    var t = H.findTeam(views, id);
    if (!t) {
      return '<div class="wrap page"><h1 class="display">Team not found</h1>' +
        '<p class="lead">We couldn’t find that team. Try searching instead.</p>' + findTeamBlock(state) + '</div>';
    }
    var view = views[t.sport][t.division];
    var list = H.teamGames(view, id);
    var row = view.standings.filter(function (r) { return r.teamId === id; })[0];
    var now = state.store.now();
    var next = list.filter(function (x) { return x.game.status !== 'final'; })[0];
    var isMine = state.myTeam === id;

    var record = row ? (row.wins + '–' + row.losses + (t.sport === 'soccer' ? '–' + row.draws : '')) : '0–0';
    var nextCard = '';
    if (next) {
      var g = next.game;
      var when = g.status === 'live' ? 'Playing now' :
        (g.startsAt != null ? H.formatTime(g.startsAt, TZ) + ' · ' + H.formatDate(g.startsAt, TZ) : 'Time TBD');
      nextCard = '<section class="next-card card card-gold">' +
        '<div class="kicker">' + (g.status === 'live' ? '<span class="live-dot"></span>Live now' : 'Next game') + '</div>' +
        '<div class="nc-vs">vs ' + teamLink(next.opponent) + '</div>' +
        '<div class="nc-when"><span>' + esc(when) + '</span>' + (g.court ? '<span class="nc-court">' + esc(g.court) + '</span>' : '') + '</div>' +
        '<div class="muted small">' + esc(roundLabel(g)) + '</div>' +
      '</section>';
      void now;
    } else if (list.length) {
      nextCard = '<section class="next-card card"><div class="kicker">All games played</div><div class="nc-vs">Thanks for playing!</div></section>';
    }

    var played = list.filter(function (x) { return x.game.status === 'final'; });
    var upcoming = list.filter(function (x) { return x.game.status !== 'final'; });

    return '<div class="wrap page team-page">' +
      '<div class="kicker">' + esc(sportName(t.sport) + ' · ' + divName(t.division)) + '</div>' +
      '<h1 class="display team-name">' + esc(t.name) + '</h1>' +
      '<div class="team-stats">' +
        '<div><strong>' + esc(record) + '</strong><span>' + (t.sport === 'soccer' ? 'W–L–D' : 'W–L') + '</span></div>' +
        (row && !row.dq ? '<div><strong>#' + row.rank + '</strong><span>' + (row.group ? 'Group ' + esc(row.group) : 'Standing') + '</span></div>' : '') +
        (row && t.sport === 'soccer' ? '<div><strong>' + row.points + '</strong><span>Points</span></div>' : '') +
        (row && row.dq ? '<div><strong class="loss">DQ</strong><span>Disqualified</span></div>' : '') +
      '</div>' +
      '<button class="btn ' + (isMine ? 'btn-ghost' : '') + ' btn-sm" data-action="my-team" data-team="' + esc(id) + '">' +
        (isMine ? '★ My team' : '☆ Make this my team') + '</button>' +
      nextCard +
      (upcoming.length ? '<h2 class="display-sm">Upcoming</h2><div class="schedule">' +
        upcoming.map(function (x) { return gameRow(x.game, { showSport: false, showDivision: false, highlight: id }); }).join('') + '</div>' : '') +
      (played.length ? '<h2 class="display-sm">Results</h2><div class="schedule">' +
        played.map(function (x) {
          return '<div class="result-wrap"><span class="outcome o-' + (x.outcome || 'n') + '">' + (x.outcome || '') + '</span>' +
            gameRow(x.game, { showSport: false, showDivision: false, highlight: id }) + '</div>';
        }).join('') + '</div>' : '') +
      (!list.length ? '<p class="empty">No games scheduled yet.</p>' : '') +
      '<p><a class="arrow-link" href="' + href('playoffs', { sport: t.sport, division: t.division }) + '">Standings &amp; bracket</a></p>' +
    '</div>';
  }

  function myTeam(state) {
    if (state.myTeam && H.findTeam(state.store.views, state.myTeam)) return team(state, state.myTeam);
    var teams = H.allTeams(state.store.views);
    var by = {};
    teams.forEach(function (t) { (by[t.sport + '|' + t.division] = by[t.sport + '|' + t.division] || []).push(t); });
    var lists = H.SPORT_ORDER.map(function (s) {
      return '<section class="team-list"><h2 class="display-sm">' + icon(s) + esc(sportName(s)) + '</h2>' +
        H.DIVISION_ORDER.map(function (d) {
          var arr = (by[s + '|' + d] || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
          if (!arr.length) return '';
          return '<h3 class="sub-head">' + esc(divName(d)) + '</h3><div class="tl-grid">' + arr.map(function (t) {
            return '<a href="' + href('team', { team: t.id }) + '">' + esc(t.name) + '</a>';
          }).join('') + '</div>';
        }).join('') + '</section>';
    }).join('');
    return '<div class="wrap page">' + findTeamBlock(state) +
      '<p class="muted small">Pick your team once — this phone remembers it.</p>' +
      '<div class="kicker" style="margin-top:32px">All teams</div>' + lists + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Info
  // ---------------------------------------------------------------------------

  function info() {
    var E = C.EVENT;
    function card(title, body, open) {
      return '<details class="info-card card"' + (open ? ' open' : '') + '><summary><h2>' + esc(title) + '</h2><span class="ic-arrow">↗</span></summary>' +
        '<div class="ic-body">' + body + '</div></details>';
    }
    var venue = '<p><b>' + esc(E.venue) + '</b>, ' + esc(E.city) + '</p><p>' + esc(E.fields) + '</p>' +
      '<ul class="days">' + E.days.map(function (d) {
        return '<li><b>' + esc(d.label) + '</b> · ' + esc(dayDateLabel(d.sport)) + ' — ' + esc(sportName(d.sport)) + '</li>';
      }).join('') + '</ul>' +
      '<p><a class="btn btn-sm" href="' + esc(E.mapsUrl) + '" target="_blank" rel="noopener">Open in Google Maps ↗</a></p>' +
      '<p class="muted small">Parking details will be posted closer to the event.</p>';
    var rules = H.SPORT_ORDER.map(function (s) {
      var S = C.SPORTS[s];
      return '<h3 class="sub-head">' + icon(s) + esc(S.name) + '</h3>' +
        '<p><b>Format.</b> ' + esc(S.format) + '</p><p><b>Standings.</b> ' + esc(S.ranking) + '</p><p><b>Forfeits.</b> ' + esc(S.forfeit) + '</p>';
    }).join('') + '<p class="muted small">Game lengths and roster limits will be confirmed closer to the event.</p>';
    var conduct = '<p>Play hard, play fair, respect the refs and the sangat. Referees may disqualify a team for ' +
      'unsportsmanlike conduct; a disqualified team’s remaining games are awarded to their opponents.</p>' +
      '<p class="muted small">Full code of conduct to be published by the organizers.</p>';
    var spectators = '<p>Free entry for families. Langar, food times, gym capacity and seating details will be posted before the event.</p>';
    var champs = '<table class="champ-table"><thead><tr><th>Year</th>' +
      H.SPORT_ORDER.map(function (s) { return '<th>' + esc(sportName(s)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      C.CHAMPIONS.map(function (row) {
        return '<tr><th>' + esc(row.year) + '</th>' + H.SPORT_ORDER.map(function (s) { return '<td>' + esc(row[s] || '—') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    var partners = '<ul class="partners">' + C.PARTNERS_2026.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>';

    return '<div class="wrap page">' +
      '<div class="kicker">Before you arrive</div><h1 class="display">Tournament info</h1>' +
      '<div class="info-cards">' +
        card('Venue & parking', venue, true) +
        card('Rules by sport', rules) +
        card('Code of conduct', conduct) +
        card('Spectators & langar', spectators) +
        card('Past champions', champs) +
        card('Thank you to our 2026 partners', partners) +
      '</div></div>';
  }

  KO.views = {
    home: home,
    schedule: schedule,
    playoffs: playoffs,
    team: team,
    myTeam: myTeam,
    info: info,
    searchResults: searchResults,
    statusLine: statusLine
  };
})(typeof window !== 'undefined' ? window : this);
