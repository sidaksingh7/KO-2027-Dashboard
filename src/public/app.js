/*
 * KO 2027 — Public site controller: routing, rendering, events.
 */
(function (root) {
  'use strict';

  var KO = root.KO;
  var H = KO.helpers;
  var V = KO.views;
  var doc = root.document;

  var MY_TEAM_KEY = 'ko2027.myTeam';

  var state = {
    store: null,
    page: 'home',
    params: {},
    query: '',
    liveSport: null,
    myTeam: readMyTeam(),
    slides: KO.config.PHOTOS.slides.map(function (p) { return { url: KO.config.photoUrl(p, 'w2000'), bad: false }; }),
    slide: 0
  };

  // ---------------------------------------------------------------------------
  // Hero slideshow: preload, skip photos that fail, advance every 3 s.
  // Only the slide classes change, so live score re-renders don't restart it.
  // ---------------------------------------------------------------------------

  state.slides.forEach(function (x, i) {
    var img = new Image();
    img.onerror = function () {
      x.bad = true;
      if (state.slide === i) showSlide(1); else updateSlideDom();
    };
    // load the first two right away, the rest a little later
    setTimeout(function () { img.src = x.url; }, i < 2 ? 0 : 800 + i * 250);
  });

  function showSlide(dir) {
    var n = state.slides.length;
    for (var step = 1; step <= n; step++) {
      var i = (state.slide + dir * step + n * step) % n;
      if (!state.slides[i].bad) { state.slide = i; break; }
    }
    updateSlideDom();
  }

  function updateSlideDom() {
    var slides = doc.querySelectorAll('.hero-slide');
    if (!slides.length) return;
    slides.forEach(function (el) {
      var i = +el.getAttribute('data-i');
      el.classList.toggle('on', i === state.slide);
      el.classList.toggle('bad', state.slides[i].bad);
    });
    var ok = state.slides.filter(function (x) { return !x.bad; });
    var count = doc.querySelector('.hero-count b');
    if (count) {
      var pos = ok.indexOf(state.slides[state.slide]) + 1;
      count.textContent = (pos < 10 ? '0' : '') + pos;
      count.parentNode.childNodes[1].textContent = ' / ' + (ok.length < 10 ? '0' : '') + ok.length + ' ';
    }
  }

  var reduceMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setInterval(function () {
    if (reduceMotion || doc.hidden || state.page !== 'home') return;
    showSlide(1);
  }, 3000);

  // My Team lives in this browser only. Storage can be blocked (private mode) —
  // the site still works, it just won't remember.
  function readMyTeam() {
    try { return root.localStorage.getItem(MY_TEAM_KEY) || null; } catch (e) { return null; }
  }
  function writeMyTeam(id) {
    state.myTeam = id;
    try {
      if (id) root.localStorage.setItem(MY_TEAM_KEY, id);
      else root.localStorage.removeItem(MY_TEAM_KEY);
    } catch (e) { /* ignore */ }
  }

  var NAV = [
    ['home', 'Home', '#'],
    ['schedule', 'Schedule', '#schedule'],
    ['playoffs', 'Playoffs', '#playoffs'],
    ['stats', 'Stats', '#stats'],
    ['info', 'Info', '#info'],
    ['guests', 'Guests', '#guests'],
    ['myteam', 'My Team', '#myteam']
  ];

  function renderNav() {
    var active = state.page === 'team' ? (state.params.team === state.myTeam ? 'myteam' : '') : state.page;
    doc.getElementById('nav').innerHTML = NAV.map(function (n) {
      return '<a href="' + n[2] + '"' + (n[0] === active ? ' aria-current="page"' : '') + '>' + n[1] + '</a>';
    }).join('');
  }

  function renderBanner() {
    var el = doc.getElementById('banner');
    var s = state.store;
    var parts = [];
    if (s.banner) parts.push('<div class="banner banner-' + H.escapeHtml(s.banner.level || 'info') + '"><div class="wrap">' + H.escapeHtml(s.banner.text) + '</div></div>');
    if (!s.connected && s.mode === 'live' && s.views) parts.push('<div class="banner banner-warn"><div class="wrap">Reconnecting… scores may be out of date.</div></div>');
    el.innerHTML = parts.join('');
  }

  function renderPage() {
    var html;
    switch (state.page) {
      case 'schedule': html = V.schedule(state); break;
      case 'playoffs': html = V.playoffs(state); break;
      case 'team': html = V.team(state, state.params.team); break;
      case 'myteam': html = V.myTeam(state); break;
      case 'info': html = V.info(state); break;
      case 'guests': html = V.guests(state); break;
      case 'stats': html = V.stats(state); break;
      case 'game': html = V.game(state, state.params.game); break;
      default: html = V.home(state);
    }
    var app = doc.getElementById('app');

    // Keep the search box usable if a score update arrives while someone types.
    var active = doc.activeElement;
    var typing = active && (active.id === 'team-search' || active.id === 'stats-search');
    var typingId = typing ? active.id : null;
    var sel = typing ? [active.selectionStart, active.selectionEnd] : null;

    app.innerHTML = html;

    if (typing) {
      var input = doc.getElementById(typingId);
      if (input) {
        input.focus();
        try { input.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ }
      }
    }
  }

  function render() {
    if (!state.store || !state.store.views) return;
    renderNav();
    renderBanner();
    renderPage();
  }

  function route() {
    var r = H.parseHash(root.location.hash);
    if (r.params.game) r.page = 'game';
    var changed = r.page !== state.page || JSON.stringify(r.params) !== JSON.stringify(state.params);
    state.page = r.page;
    state.params = r.params;
    if (changed) { state.query = ''; }
    if (changed && r.page !== 'stats') { state.statsQuery = ''; state.statsLimit = 25; }
    render();
    if (changed) root.scrollTo(0, 0);
    doc.title = pageTitle();
  }

  function pageTitle() {
    var base = 'Khalsa Olympics 2027';
    var names = { schedule: 'Schedule', playoffs: 'Playoffs', info: 'Info', myteam: 'My Team', guests: 'Special Guests', stats: 'Stats', game: 'Box score' };
    if (state.page === 'team' && state.store && state.store.views) {
      var t = H.findTeam(state.store.views, state.params.team);
      if (t) return t.name + ' · ' + base;
    }
    return names[state.page] ? names[state.page] + ' · ' + base : base;
  }

  // ---------------------------------------------------------------------------
  // Events (one delegated listener for the whole page)
  // ---------------------------------------------------------------------------

  doc.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');
    if (action === 'go') {
      root.location.hash = el.getAttribute('data-href');
    } else if (action === 'stats-more') {
      state.statsLimit = (state.statsLimit || 25) + 50;
      render();
    } else if (action === 'slide') {
      showSlide(+el.getAttribute('data-dir'));
    } else if (action === 'live-sport') {
      state.liveSport = el.getAttribute('data-sport');
      render();
    } else if (action === 'my-team') {
      var id = el.getAttribute('data-team');
      writeMyTeam(state.myTeam === id ? null : id);
      render();
    }
  });

  doc.addEventListener('input', function (e) {
    if (e.target.id === 'stats-search') {
      state.statsQuery = e.target.value;
      state.statsLimit = 25;
      render(); // the search box keeps focus (see renderPage)
      return;
    }
    if (e.target.id !== 'team-search') return;
    state.query = e.target.value;
    // Only redraw the results list — not the whole page — while typing.
    var box = doc.getElementById('search-results');
    if (box) box.innerHTML = V.searchResults(state);
  });

  doc.addEventListener('keydown', function (e) {
    if (e.target.id === 'team-search' && e.key === 'Enter') {
      var first = doc.querySelector('#search-results .sr-item');
      if (first) root.location.hash = first.getAttribute('href');
    }
    if (e.target.id === 'team-search' && e.key === 'Escape') {
      e.target.value = '';
      state.query = '';
      doc.getElementById('search-results').innerHTML = '';
    }
  });

  root.addEventListener('hashchange', route);

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  KO.data.start(function (store) {
    // Demo mode calls this before start() returns, so keep the store from here.
    state.store = store;
    // route() also covers the first render.
    if (!state._started) { state._started = true; route(); } else { render(); doc.title = pageTitle(); }
  });

  // Countdown / "today" text and demo clock move on their own.
  setInterval(function () {
    var a = doc.activeElement;
    if (a && a.id === 'team-search' && state.query) return; // don't disturb typing
    render();
  }, 30000);
})(typeof window !== 'undefined' ? window : this);
