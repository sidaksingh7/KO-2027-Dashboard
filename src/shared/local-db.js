/*
 * KO 2027 — Sandbox database.
 *
 * A small stand-in for the Firebase Realtime Database API (the parts this project
 * uses), saved in the browser's localStorage. Used automatically while the Firebase
 * config isn't filled in, so admin, public and TV pages can be tried end to end.
 * Tabs in the same browser see each other's changes live.
 *
 * Supported:  db.ref(path) → ref.child(), .on('value', cb), .off('value', cb),
 *             .once('value'), .set(v), .update({ 'a/b': v }), .remove(),
 *             .transaction(fn)
 *             snapshot.val(), snapshot.exists()
 *             '.info/connected' (always true), '.info/serverTimeOffset' (0)
 *
 *   KO.createLocalDb({ storage, key })   storage defaults to window.localStorage
 */
(function (root) {
  'use strict';

  function clone(v) {
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
  }

  function splitPath(path) {
    return String(path || '').split('/').filter(Boolean);
  }

  // Firebase drops empty objects and nulls; mimic that so reads match.
  function prune(v) {
    if (v === null || typeof v !== 'object') return v === undefined ? null : v;
    var isArr = Array.isArray(v);
    var out = isArr ? [] : {};
    var any = false;
    Object.keys(v).forEach(function (k) {
      var p = prune(v[k]);
      if (p !== null) { out[k] = p; any = true; }
      else if (isArr) out[k] = null;
    });
    if (isArr) {
      while (out.length && out[out.length - 1] === null) out.pop();
      return out.length ? out : null;
    }
    return any ? out : null;
  }

  function getAt(tree, parts) {
    var node = tree;
    for (var i = 0; i < parts.length; i++) {
      if (node === null || typeof node !== 'object') return null;
      node = node[parts[i]];
      if (node === undefined) return null;
    }
    return node === undefined ? null : node;
  }

  function setAt(tree, parts, value) {
    if (!parts.length) return clone(value) || {};
    var node = tree;
    for (var i = 0; i < parts.length - 1; i++) {
      if (node[parts[i]] === null || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
      node = node[parts[i]];
    }
    if (value === null || value === undefined) delete node[parts[parts.length - 1]];
    else node[parts[parts.length - 1]] = clone(value);
    return tree;
  }

  function snapshot(value, key) {
    return {
      key: key,
      val: function () { return clone(value); },
      exists: function () { return value !== null; }
    };
  }

  function createLocalDb(opts) {
    opts = opts || {};
    var storage = opts.storage !== undefined ? opts.storage : (root.localStorage || null);
    var KEY = opts.key || 'ko2027.sandbox';
    var tree = load();
    var listeners = []; // { parts, cb, last }

    function load() {
      try {
        var raw = storage && storage.getItem(KEY);
        return raw ? JSON.parse(raw) : {};
      } catch (e) { return {}; }
    }
    function save() {
      tree = prune(tree) || {};
      try { if (storage) storage.setItem(KEY, JSON.stringify(tree)); } catch (e) {
        if (root.console) root.console.warn('[KO sandbox] could not save', e);
      }
    }

    function valueFor(parts) {
      if (parts[0] === '.info') {
        if (parts[1] === 'connected') return true;
        if (parts[1] === 'serverTimeOffset') return 0;
        return null;
      }
      return prune(clone(getAt(tree, parts)));
    }

    // Tell every listener whose value actually changed.
    function notify() {
      listeners.slice().forEach(function (l) {
        var v = valueFor(l.parts);
        var s = JSON.stringify(v);
        if (s === l.last) return;
        l.last = s;
        l.cb(snapshot(v, l.parts[l.parts.length - 1] || null));
      });
    }

    // Other tabs writing the same storage key.
    if (root.addEventListener && storage === root.localStorage) {
      root.addEventListener('storage', function (e) {
        if (e.key !== KEY) return;
        tree = load();
        notify();
      });
    }

    function Ref(parts) {
      this.parts = parts;
      this.key = parts[parts.length - 1] || null;
      this.path = parts.join('/');
    }
    Ref.prototype.child = function (p) { return new Ref(this.parts.concat(splitPath(p))); };
    Ref.prototype.toString = function () { return 'local:/' + this.path; };
    Ref.prototype.on = function (event, cb) {
      if (event !== 'value') throw new Error('Sandbox only supports "value" listeners');
      var v = valueFor(this.parts);
      var l = { parts: this.parts, cb: cb, last: JSON.stringify(v) };
      listeners.push(l);
      var self = this;
      setTimeout(function () { cb(snapshot(v, self.key)); }, 0); // async, like Firebase
      return cb;
    };
    Ref.prototype.off = function (event, cb) {
      var path = this.path;
      listeners = listeners.filter(function (l) {
        return !(l.parts.join('/') === path && (!cb || l.cb === cb));
      });
    };
    Ref.prototype.once = function () {
      return Promise.resolve(snapshot(valueFor(this.parts), this.key));
    };
    Ref.prototype.set = function (value) {
      tree = setAt(tree, this.parts, value);
      save(); notify();
      return Promise.resolve();
    };
    Ref.prototype.remove = function () { return this.set(null); };
    Ref.prototype.update = function (values) {
      var base = this.parts;
      Object.keys(values).forEach(function (k) {
        tree = setAt(tree, base.concat(splitPath(k)), values[k]);
      });
      save(); notify();
      return Promise.resolve();
    };
    // Runs fn on the current value; undefined from fn = abort (like Firebase).
    Ref.prototype.transaction = function (fn) {
      tree = load(); // pick up other tabs' writes first
      var cur = valueFor(this.parts);
      var next = fn(clone(cur));
      if (next === undefined) {
        return Promise.resolve({ committed: false, snapshot: snapshot(cur, this.key) });
      }
      tree = setAt(tree, this.parts, next);
      save(); notify();
      return Promise.resolve({ committed: true, snapshot: snapshot(valueFor(this.parts), this.key) });
    };

    return {
      isSandbox: true,
      ref: function (path) { return new Ref(splitPath(path)); },
      // Wipe everything (admin "reset sandbox").
      clear: function () { tree = {}; save(); notify(); }
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createLocalDb: createLocalDb, prune: prune };
  } else {
    root.KO = root.KO || {};
    root.KO.createLocalDb = createLocalDb;
  }
})(typeof window !== 'undefined' ? window : this);
