/*
 * KO 2027 — Game timer state + sync merge.
 *
 * Pure functions: every function takes `now` (ms) and returns a NEW timer — nothing is
 * changed in place and nothing talks to Firebase. Pages pass KO.now() (server-corrected
 * clock) so devices with wrong clocks still agree.
 *
 * TIMER SHAPE (all times in ms)
 *   {
 *     direction:   'down' (soccer, basketball) | 'up' (volleyball stopwatch)
 *     duration:    length of the period; null for 'up'
 *     running:     true while the clock is ticking
 *     startedAt:   when the current run started (null when paused)
 *     accumulated: time already played before the current run
 *     updatedAt:   { direction, duration, running, startedAt, accumulated }  — one stamp per field
 *   }
 *
 * THE THREE RULES (2026 timers reset mid-game; these prevent it)
 *   1. A running timer's duration is never changed by a sync merge.
 *   2. Merge is per-field last-write-wins on updatedAt.
 *   3. Only reset() — a scorekeeper action — can change duration.
 *
 * running / startedAt / accumulated always change together (one "clock" action),
 * so they're stamped with the same time and win or lose a merge together.
 */
(function (root) {
  'use strict';

  var CLOCK_FIELDS = ['running', 'startedAt', 'accumulated'];
  var ALL_FIELDS = ['direction', 'duration', 'running', 'startedAt', 'accumulated'];

  function copy(t) {
    var out = {};
    Object.keys(t).forEach(function (k) { out[k] = t[k]; });
    out.updatedAt = {};
    Object.keys(t.updatedAt || {}).forEach(function (k) { out.updatedAt[k] = t.updatedAt[k]; });
    return out;
  }

  function stamp(t, fields, now) {
    fields.forEach(function (f) { t.updatedAt[f] = now; });
    return t;
  }

  // ---------------------------------------------------------------------------
  // Create + scorekeeper actions
  // ---------------------------------------------------------------------------

  // createTimer({ direction: 'down', duration: 20 * 60000 }, now)
  // createTimer({ direction: 'up' }, now)
  function createTimer(opts, now) {
    var direction = opts && opts.direction === 'up' ? 'up' : 'down';
    var duration = direction === 'up' ? null : opts.duration;
    if (direction === 'down' && !(duration > 0)) {
      throw new Error('A countdown timer needs a duration in ms greater than 0');
    }
    return stamp({
      direction: direction,
      duration: duration,
      running: false,
      startedAt: null,
      accumulated: 0,
      updatedAt: {}
    }, ALL_FIELDS, now);
  }

  function start(t, now) {
    if (t.running) return t;
    var out = copy(t);
    out.running = true;
    out.startedAt = now;
    return stamp(out, CLOCK_FIELDS, now);
  }

  function pause(t, now) {
    if (!t.running) return t;
    var out = copy(t);
    out.accumulated = elapsed(t, now);
    out.running = false;
    out.startedAt = null;
    return stamp(out, CLOCK_FIELDS, now);
  }

  // The ONLY way duration changes. Stops the clock and zeroes it.
  // newDuration is optional — leave it out to keep the current duration.
  function reset(t, newDuration, now) {
    var out = copy(t);
    if (out.direction === 'down' && newDuration != null) {
      if (!(newDuration > 0)) throw new Error('Duration must be greater than 0');
      out.duration = newDuration;
    }
    out.running = false;
    out.startedAt = null;
    out.accumulated = 0;
    return stamp(out, ['duration'].concat(CLOCK_FIELDS), now);
  }

  // Correct the clock to show `shownMs` (time left for 'down', time played for 'up').
  // Changes elapsed time only — never duration — so it's safe while running.
  function adjust(t, shownMs, now) {
    if (!(shownMs >= 0)) throw new Error('Clock value must be 0 or more');
    var target = t.direction === 'down'
      ? Math.max(0, t.duration - Math.min(shownMs, t.duration))
      : shownMs;
    var out = copy(t);
    out.accumulated = target;
    out.startedAt = t.running ? now : null;
    return stamp(out, CLOCK_FIELDS, now);
  }

  // ---------------------------------------------------------------------------
  // Reading the clock
  // ---------------------------------------------------------------------------

  function elapsed(t, now) {
    var run = t.running && t.startedAt != null ? Math.max(0, now - t.startedAt) : 0;
    return (t.accumulated || 0) + run;
  }

  // What the clock face shows: time left ('down', never below 0) or time played ('up').
  function shown(t, now) {
    if (t.direction === 'up') return elapsed(t, now);
    return Math.max(0, t.duration - elapsed(t, now));
  }

  function isTimeUp(t, now) {
    return t.direction === 'down' && elapsed(t, now) >= t.duration;
  }

  // 65000 → '01:05'. Countdowns round up (shows 00:01 until it truly hits 0).
  function format(ms, roundUp) {
    var secs = roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
    var m = Math.floor(secs / 60);
    var s = secs % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function display(t, now) {
    return format(shown(t, now), t.direction === 'down');
  }

  // ---------------------------------------------------------------------------
  // Sync merge
  // ---------------------------------------------------------------------------

  function stampOf(t, f) {
    return (t.updatedAt && t.updatedAt[f]) || 0;
  }

  // Which side wins a field: newer stamp; on an exact tie, the larger value
  // (so every device picks the same side).
  function pick(local, remote, f) {
    var l = stampOf(local, f);
    var r = stampOf(remote, f);
    if (l !== r) return l > r ? local : remote;
    return JSON.stringify(remote[f]) > JSON.stringify(local[f]) ? remote : local;
  }

  // Newest clock action on a side (start / pause / reset / adjust).
  function clockStamp(t) {
    return Math.max(stampOf(t, 'running'), stampOf(t, 'startedAt'), stampOf(t, 'accumulated'));
  }

  function clockValue(t) {
    return JSON.stringify([t.running, t.startedAt, t.accumulated]);
  }

  function mergeTimer(local, remote) {
    if (!local) return remote || null;
    if (!remote) return local;

    var out = { updatedAt: {} };

    // running / startedAt / accumulated move as one unit: take them all from
    // whichever side made the most recent clock action.
    var lc = clockStamp(local);
    var rc = clockStamp(remote);
    var clockSide = lc !== rc
      ? (lc > rc ? local : remote)
      : (clockValue(remote) > clockValue(local) ? remote : local); // exact tie: same pick everywhere
    CLOCK_FIELDS.forEach(function (f) {
      out[f] = clockSide[f];
      out.updatedAt[f] = stampOf(clockSide, f);
    });

    out.direction = pick(local, remote, 'direction').direction;
    out.updatedAt.direction = Math.max(stampOf(local, 'direction'), stampOf(remote, 'direction'));

    // Rule 1: while running, duration belongs to the run that's on the clock.
    // A stale copy with a newer duration stamp cannot change it.
    // (A real reset + start elsewhere is a newer clock action, so it wins the
    // clock AND brings its duration — that's rule 3, a scorekeeper action.)
    var durSide = out.running ? clockSide : pick(local, remote, 'duration');
    out.duration = durSide.duration;
    out.updatedAt.duration = stampOf(durSide, 'duration');

    return out;
  }

  var api = {
    createTimer: createTimer,
    start: start,
    pause: pause,
    reset: reset,
    adjust: adjust,
    elapsed: elapsed,
    shown: shown,
    isTimeUp: isTimeUp,
    format: format,
    display: display,
    mergeTimer: mergeTimer
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.KO = root.KO || {};
    root.KO.timer = api;
  }
})(typeof window !== 'undefined' ? window : this);
