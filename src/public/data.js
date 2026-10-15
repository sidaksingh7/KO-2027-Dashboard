/*
 * KO 2027 — Public data source.
 *
 *   KO.data.start(onChange)   calls onChange(store) now and on every update
 *
 *   store = {
 *     mode: 'live' | 'demo',
 *     now(): ms                 current time (demo: a fixed moment on Day 2, ticking)
 *     views: { soccer: { d1: divisionView, ... }, ... }   (see helpers.divisionView)
 *     banner: { text, level } | null
 *     connected: boolean
 *   }
 *
 * Live mode reads ONLY published/ (principle 1) plus event/banner — from Firebase,
 * or from the in-browser sandbox while Firebase isn't configured.
 * Demo mode (built-in made-up tournament): ?demo=1, or sandbox with nothing published.
 * ?demo=0 forces live mode.
 */
(function (root) {
  'use strict';

  var KO = root.KO;
  var H = KO.helpers;

  // Calls back with true (use demo) or false (use the database).
  function decideDemo(cb) {
    var m = /[?&]demo=([01])/.exec(root.location.search);
    if (m) return cb(m[1] === '1');
    if (KO.mode !== 'sandbox') return cb(false);
    KO.db.ref('ko2027').once('value').then(function (snap) {
      var tree = snap.val() || {};
      var any = H.SPORT_ORDER.some(function (s) {
        return tree[s] && H.DIVISION_ORDER.some(function (d) { return tree[s][d] && tree[s][d].published; });
      });
      cb(!any);
    });
  }

  function start(onChange) {
    var store = { mode: 'live', views: null, banner: null, connected: false, now: null };
    decideDemo(function (demo) { begin(store, demo, onChange); });
    return store;
  }

  function begin(store, useDemo, onChange) {
    var raw = {};
    store.source = KO.mode; // 'firebase' | 'sandbox'

    function emit() {
      store.views = H.buildViews(raw);
      onChange(store);
    }

    if (useDemo) {
      var demo = KO.demo.build();
      var loadedAt = Date.now();
      store.mode = 'demo';
      store.connected = true;
      store.now = function () { return demo.now + (Date.now() - loadedAt); };
      store.banner = demo.banner;
      raw = demo.divisions;
      emit();
      return;
    }

    store.now = KO.now;
    // Coalesce bursts of updates (9 divisions arriving at once) into one render.
    // First draw waits for all 9 divisions (or 3 s) so nothing flashes "empty".
    var pending = null;
    var loaded = {};
    var ready = false;
    function schedule() {
      if (!ready) {
        if (Object.keys(loaded).length < 9) return;
        ready = true;
      }
      if (pending) return;
      pending = setTimeout(function () { pending = null; emit(); }, 50);
    }

    H.SPORT_ORDER.forEach(function (sport) {
      raw[sport] = {};
      H.DIVISION_ORDER.forEach(function (div) {
        KO.publishedRef(sport, div).on('value', function (snap) {
          raw[sport][div] = snap.val() || {};
          loaded[sport + div] = true;
          schedule();
        }, function (err) {
          console.error('[KO] could not read ' + sport + '/' + div, err);
        });
      });
    });

    KO.eventRef('banner').on('value', function (snap) {
      var b = snap.val();
      store.banner = b && b.text ? b : null;
      schedule();
    });

    KO.onConnectionChange(function (ok) {
      store.connected = ok;
      schedule();
    });

    setTimeout(function () { if (!ready) { ready = true; emit(); } }, 3000);
  }

  KO.data = { start: start };
})(typeof window !== 'undefined' ? window : this);
