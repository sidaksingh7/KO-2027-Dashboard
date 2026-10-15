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
 * Live mode reads ONLY published/ (principle 1) plus event/banner.
 * Demo mode: Firebase not configured, or ?demo=1. Force live with ?demo=0.
 */
(function (root) {
  'use strict';

  var KO = root.KO;
  var H = KO.helpers;

  function wantsDemo() {
    var m = /[?&]demo=([01])/.exec(root.location.search);
    if (m) return m[1] === '1';
    return !KO.isConfigured;
  }

  function start(onChange) {
    var store = { mode: 'live', views: null, banner: null, connected: false, now: null };
    var raw = {};

    function emit() {
      store.views = H.buildViews(raw);
      onChange(store);
    }

    if (wantsDemo()) {
      var demo = KO.demo.build();
      var loadedAt = Date.now();
      store.mode = 'demo';
      store.connected = true;
      store.now = function () { return demo.now + (Date.now() - loadedAt); };
      store.banner = demo.banner;
      raw = demo.divisions;
      emit();
      return store;
    }

    store.now = KO.now;
    // Coalesce bursts of updates (9 divisions arriving at once) into one render.
    var pending = null;
    function schedule() {
      if (pending) return;
      pending = setTimeout(function () { pending = null; emit(); }, 50);
    }

    H.SPORT_ORDER.forEach(function (sport) {
      raw[sport] = {};
      H.DIVISION_ORDER.forEach(function (div) {
        KO.publishedRef(sport, div).on('value', function (snap) {
          raw[sport][div] = snap.val() || {};
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

    emit();
    return store;
  }

  KO.data = { start: start };
})(typeof window !== 'undefined' ? window : this);
