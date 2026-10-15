/*
 * KO 2027 — Firebase setup + path helpers.
 *
 * HOW TO LOAD (in index.html / admin.html, before any other src/ script):
 *
 *   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-database-compat.js"></script>
 *   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
 *   <script src="src/shared/firebase.js"></script>
 *
 * Everything is exposed on one global: window.KO (e.g. KO.liveRef('soccer', 'd1', 'games')).
 * The path helpers also work in Node so they can be unit tested (tests/firebase.test.js).
 *
 * DATA LAYOUT
 *   ko2027/{sport}/{division}/published/...  finalized data — public pages read this
 *   ko2027/{sport}/{division}/live/...       in-progress game state — TVs + admin read this
 *   ko2027/admin/...                          admin-only settings (banner, admin list, etc.)
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // TODO: PASTE YOUR FIREBASE CONFIG HERE
  //
  // Where to find it:
  //   1. Go to https://console.firebase.google.com and open "khalsa-olympics-2027".
  //   2. Click the gear icon (top left, next to "Project Overview") → "Project settings".
  //   3. On the "General" tab, scroll down to "Your apps".
  //      - If there's no web app yet, click the "</>" icon, give it a nickname
  //        (e.g. "ko-dashboard"), leave "Firebase Hosting" unchecked, click "Register app".
  //   4. Under "SDK setup and configuration", choose "Config".
  //   5. Copy each value into the matching line below (keep the quotes).
  //
  // These values are NOT secret — they're visible to anyone who opens the site.
  // What protects the data is the Realtime Database security rules.
  // ---------------------------------------------------------------------------
  var FIREBASE_CONFIG = {
    apiKey: 'PASTE_HERE',
    authDomain: 'PASTE_HERE',
    databaseURL: 'https://khalsa-olympics-2027-default-rtdb.firebaseio.com',
    projectId: 'PASTE_HERE',
    storageBucket: 'PASTE_HERE',
    messagingSenderId: 'PASTE_HERE',
    appId: 'PASTE_HERE'
  };

  var ROOT = 'ko2027';
  var SPORTS = ['soccer', 'basketball', 'volleyball'];
  var DIVISIONS = ['d1', 'd2', 'd3'];

  // Characters Firebase does not allow in a key.
  var BAD_KEY_CHARS = /[.#$\[\]]/;

  // ---------------------------------------------------------------------------
  // Path helpers (pure — no Firebase needed)
  // ---------------------------------------------------------------------------

  function checkSportDivision(sport, division) {
    if (SPORTS.indexOf(sport) === -1) {
      throw new Error('Unknown sport "' + sport + '". Expected one of: ' + SPORTS.join(', '));
    }
    if (DIVISIONS.indexOf(division) === -1) {
      throw new Error('Unknown division "' + division + '". Expected one of: ' + DIVISIONS.join(', '));
    }
  }

  // Turns ('games', 'soccer-d1-qf-1/score1') into ['games', 'soccer-d1-qf-1', 'score1'],
  // rejecting empty segments and characters Firebase can't store.
  function cleanSegments(parts) {
    var out = [];
    parts.forEach(function (part) {
      if (typeof part !== 'string' && typeof part !== 'number') {
        throw new Error('Path parts must be strings, got ' + typeof part);
      }
      String(part).split('/').forEach(function (seg) {
        if (seg === '') throw new Error('Empty path segment in "' + parts.join('/') + '"');
        if (BAD_KEY_CHARS.test(seg)) {
          throw new Error('Path segment "' + seg + '" contains one of . # $ [ ]');
        }
        out.push(seg);
      });
    });
    return out;
  }

  function join(base, subParts) {
    return [base].concat(cleanSegments(subParts)).join('/');
  }

  // publishedPath('soccer', 'd1', 'standings') → 'ko2027/soccer/d1/published/standings'
  function publishedPath(sport, division) {
    checkSportDivision(sport, division);
    return join(ROOT + '/' + sport + '/' + division + '/published', [].slice.call(arguments, 2));
  }

  // livePath('soccer', 'd1', 'games', 'soccer-d1-qf-1') → 'ko2027/soccer/d1/live/games/soccer-d1-qf-1'
  function livePath(sport, division) {
    checkSportDivision(sport, division);
    return join(ROOT + '/' + sport + '/' + division + '/live', [].slice.call(arguments, 2));
  }

  // adminPath('banner') → 'ko2027/admin/banner'
  function adminPath() {
    return join(ROOT + '/admin', [].slice.call(arguments));
  }

  // Builds one multi-path update that writes each field AND its updatedAt time.
  //   stampedFields({ score1: 3, 'timer/running': true }, 1700000000000) →
  //   { score1: 3, 'updatedAt/score1': 1700000000000,
  //     'timer/running': true, 'timer/updatedAt/running': 1700000000000 }
  // Each field's timestamp sits in an "updatedAt" object beside it, so
  // per-field last-write-wins (timer.js) can compare them.
  function stampedFields(fields, now) {
    var update = {};
    Object.keys(fields).forEach(function (key) {
      var segs = cleanSegments([key]);
      var leaf = segs.pop();
      if (leaf === 'updatedAt') throw new Error('Cannot stamp a field named "updatedAt"');
      var stampPath = segs.concat(['updatedAt', leaf]).join('/');
      update[segs.concat([leaf]).join('/')] = fields[key];
      update[stampPath] = now;
    });
    return update;
  }

  var KO = {
    SPORTS: SPORTS.slice(),
    DIVISIONS: DIVISIONS.slice(),
    publishedPath: publishedPath,
    livePath: livePath,
    adminPath: adminPath,
    stampedFields: stampedFields
  };

  // In Node (unit tests) stop here — no Firebase.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = KO;
    return;
  }

  // ---------------------------------------------------------------------------
  // Browser: connect to Firebase
  // ---------------------------------------------------------------------------

  var firebase = root.firebase;
  if (!firebase) {
    throw new Error('Firebase SDK not loaded. Add the three firebase-*-compat.js <script> tags before firebase.js.');
  }

  if (FIREBASE_CONFIG.apiKey === 'PASTE_HERE') {
    console.warn('[KO] Firebase config not filled in yet (see TODO in src/shared/firebase.js). ' +
      'Database reads may work, but admin login will not.');
  }

  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);

  var db = firebase.database();
  var auth = firebase.auth();

  // Gap between this device's clock and Firebase's server clock, in ms.
  // Firebase fills it in shortly after connecting.
  var serverTimeOffset = 0;
  db.ref('.info/serverTimeOffset').on('value', function (snap) {
    serverTimeOffset = snap.val() || 0;
  });

  // Current time in ms epoch, corrected to Firebase's clock so two devices
  // with wrong clocks still agree on which write is newer.
  function now() {
    return Date.now() + serverTimeOffset;
  }

  KO.db = db;
  KO.auth = auth;
  KO.now = now;

  KO.publishedRef = function () { return db.ref(publishedPath.apply(null, arguments)); };
  KO.liveRef = function () { return db.ref(livePath.apply(null, arguments)); };
  KO.adminRef = function () { return db.ref(adminPath.apply(null, arguments)); };

  // Writes fields under ref, each with its own updatedAt. Returns a Promise.
  //   KO.stampedUpdate(KO.liveRef('soccer', 'd1', 'games', gameId), { score1: 3 })
  KO.stampedUpdate = function (ref, fields) {
    return ref.update(stampedFields(fields, now()));
  };

  // fn(true) when connected to Firebase, fn(false) when offline. Returns an unsubscribe function.
  KO.onConnectionChange = function (fn) {
    var ref = db.ref('.info/connected');
    var handler = function (snap) { fn(snap.val() === true); };
    ref.on('value', handler);
    return function () { ref.off('value', handler); };
  };

  // Admin login (email/password accounts are created in the Firebase console).
  KO.signIn = function (email, password) {
    return auth.signInWithEmailAndPassword(email, password);
  };
  KO.signOut = function () {
    return auth.signOut();
  };
  // fn(user) on login, fn(null) on logout. Returns an unsubscribe function.
  KO.onAuthChange = function (fn) {
    return auth.onAuthStateChanged(fn);
  };

  root.KO = KO;
})(typeof window !== 'undefined' ? window : this);
