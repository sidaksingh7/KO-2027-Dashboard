/*
 * KO 2027 — Demo data.
 *
 * Builds a realistic, made-up tournament (same shape as Firebase `published/`) so
 * pages can be designed and tested before real data exists. Shown automatically
 * when Firebase isn't configured, or with ?demo=1 in the URL.
 *
 * The demo "clock" is fixed mid-way through Day 2 (basketball quarterfinals live):
 * soccer is finished, basketball is in progress, volleyball hasn't started.
 * Team names are invented.
 */
(function (root) {
  'use strict';

  var KO = root.KO;
  var schedule = KO.schedule;
  var computeStandings = KO.computeStandings;
  var resolveBracket = KO.resolveBracket;
  var teamId = KO.helpers.teamId;

  var MIN = 60000;

  // June is EDT (UTC−4) in Toronto.
  function local(date, h, m) {
    var p = date.split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2], h + 4, m || 0);
  }

  // Small seeded random generator so the demo looks the same every load.
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var NAMES = {
    soccer: [
      'Fateh FC', 'Singh Strikers', 'Panj Aab United', 'Chardi Kala FC', 'Nirbhau XI', 'Saint Soldiers',
      'Miri Piri FC', 'Sangat United', 'Lions of Malton', 'Kesri Knights', 'Five Rivers FC', 'Baaz FC',
      'Tegh Titans', 'Northside Singhs', 'Akal Athletic', 'Royal Sikhs FC', 'Dastar Dynamos', 'Shaheed FC',
      'Caledon Kings', 'Jhujaru FC', 'Seva Squad', 'Gatka Gunners', 'Daler FC', 'Bravehearts FC', 'Nihang Rovers',
      'Khanda FC', 'Heartlake United'
    ],
    basketball: [
      'Akal Ballers', 'Daler Dunkers', 'Khalsa Warriors', 'Sher Squad', 'Fateh Hoopers', 'Kesri Kings',
      'Panth Pride', 'Malton Mavericks', 'Five Rivers Ballers', 'Seva Shooters', 'Nirbhau Hoops', 'Tegh Titans',
      'Baaz Ballers', 'Charhdi Kala Hoops', 'Royal Sikhs', 'Dastar Dynasty', 'Springdale Singhs', 'Saint Soldiers',
      'Lion Hearts', 'Jhujaru Elite', 'Gurdwara Gunners', 'Miri Piri Elite', 'Brampton Bravehearts',
      'Mississauga Mavs', 'Caledon Crowns', 'Kaurs United', 'Etobicoke Eagles'
    ],
    volleyball: [
      'Kalgi Spikers', 'Ekta Smash', 'Fateh Volley', 'Sangat Setters', 'Nishan Net', 'Kesri Blockers',
      'Five Rivers Volley', 'Akal Aces', 'Baaz Blockers', 'Chardi Kala Spikers', 'Dhan Diggers',
      'Panth Power', 'Seva Servers', 'Sher Spikers', 'Royal Rally', 'Malton Volley', 'Khanda Kills',
      'Miri Piri Volley', 'Nirbhau Net', 'Tegh Smash', 'Lion Lifters', 'Gurmat Gold', 'Kaur Power',
      'Caledon Spikers', 'Dastar Diggers'
    ]
  };

  var SETUP = {
    soccer: {
      date: '2027-06-01', start: [9, 0], slotMs: 28 * MIN, courts: ['Field A', 'Field B', 'Field C', 'Field D'],
      sizes: { d1: 10, d2: 9, d3: 8 }, groups: true, bracket: 'groups2'
    },
    basketball: {
      date: '2027-06-02', start: [10, 0], slotMs: 30 * MIN, courts: ['Gym 1', 'Gym 2', 'Gym 3'],
      sizes: { d1: 10, d2: 9, d3: 8 }, gamesPerTeam: 4, bracket: 'top8'
    },
    volleyball: {
      date: '2027-06-03', start: [10, 0], slotMs: 30 * MIN, courts: ['Gym 1', 'Gym 2', 'Gym 3'],
      sizes: { d1: 9, d2: 8, d3: 8 }, gamesPerTeam: 3, bracket: 'top4'
    }
  };

  // ---------------------------------------------------------------------------

  function buildSport(sport, rand) {
    var cfg = SETUP[sport];
    var divisions = {};
    var allGames = {};
    var names = NAMES[sport].slice();
    var strength = {};

    ['d1', 'd2', 'd3'].forEach(function (div) {
      var teams = {};
      var ids = names.splice(0, cfg.sizes[div]).map(function (name) {
        var id = teamId(name, sport, div);
        teams[id] = { name: name };
        strength[id] = rand();
        return id;
      });
      var games;
      var groups = null;
      if (cfg.groups) {
        var half = Math.ceil(ids.length / 2);
        groups = { A: ids.slice(0, half), B: ids.slice(half) };
        games = Object.assign(
          schedule.roundRobin(sport, div, groups.A, { group: 'A' }),
          schedule.roundRobin(sport, div, groups.B, { group: 'B' })
        );
      } else {
        games = schedule.roundRobin(sport, div, ids, { gamesPerTeam: cfg.gamesPerTeam });
      }
      Object.assign(games, schedule.bracket(sport, div, cfg.bracket));
      Object.assign(allGames, games);
      divisions[div] = { teams: teams, games: {}, groups: groups, dq: {}, manualOrder: [] };
    });

    // One schedule per sport so divisions share fields/gyms without clashing.
    var timed = schedule.assignSlots(allGames, {
      courts: cfg.courts,
      startsAt: local(cfg.date, cfg.start[0], cfg.start[1]),
      slotMs: cfg.slotMs
    });
    Object.keys(timed).forEach(function (id) {
      var g = timed[id];
      g.endsAt = g.startsAt + cfg.slotMs - 5 * MIN;
      divisions[g.division].games[id] = g;
    });
    return { divisions: divisions, strength: strength, slotMs: cfg.slotMs };
  }

  function int(rand, lo, hi) {
    return lo + Math.floor(rand() * (hi - lo + 1));
  }

  // Fills in a finished (fraction = 1) or in-progress (fraction < 1) result.
  function playGame(g, t1, t2, strength, rand, fraction) {
    var p1 = 0.5 + (strength[t1] - strength[t2]) * 0.6; // chance team 1 is ahead
    var oneWins = rand() < p1;
    if (g.sport === 'soccer') {
      var hi = int(rand, 1, 4), lo = int(rand, 0, hi - 1);
      if (!g.isBracket && rand() < 0.18) lo = hi; // the odd draw
      g.score1 = Math.round((oneWins ? hi : lo) * fraction);
      g.score2 = Math.round((oneWins ? lo : hi) * fraction);
      if (fraction === 1 && g.isBracket && g.score1 === g.score2) g.winnerId = oneWins ? t1 : t2;
    } else if (g.sport === 'basketball') {
      var w = int(rand, 42, 68), l = w - int(rand, 2, 18);
      g.score1 = Math.round((oneWins ? w : l) * fraction);
      g.score2 = Math.round((oneWins ? l : w) * fraction);
      if (g.score1 === g.score2) g.score1 += 1;
    } else {
      // volleyball: best of 3 — sets to 25, third set to 15
      var sets = [];
      var won1 = 0, won2 = 0;
      var totalSets = rand() < 0.35 ? 3 : 2;
      for (var s = 0; s < totalSets; s++) {
        var cap = s === 2 ? 15 : 25;
        var setTo1 = totalSets === 3 && s < 2 ? s === 0 ? oneWins : !oneWins : oneWins;
        var loser = int(rand, Math.floor(cap * 0.5), cap - 2);
        sets.push(setTo1 ? { s1: cap, s2: loser, done: true } : { s1: loser, s2: cap, done: true });
        if (setTo1) won1++; else won2++;
      }
      if (fraction < 1) {
        // in progress: first set done, second set midway
        sets = sets.slice(0, 1);
        if (sets[0].s1 > sets[0].s2) won1 = 1, won2 = 0; else won1 = 0, won2 = 1;
        var a = int(rand, 8, 18), b = int(rand, 8, 18);
        sets.push({ s1: a, s2: b, done: false });
        g.score1 = a; g.score2 = b;
        g.currentSet = 2;
      } else {
        g.score1 = sets[sets.length - 1].s1;
        g.score2 = sets[sets.length - 1].s2;
        g.currentSet = sets.length;
      }
      g.sets = sets;
      g.setsWon1 = won1;
      g.setsWon2 = won2;
    }
    g.status = fraction === 1 ? 'final' : 'live';
  }

  // Plays every game that has started by `now`, in time order, resolving bracket
  // teams with the real standings + cascade code as it goes.
  function playUntil(sport, built, now, rand) {
    ['d1', 'd2', 'd3'].forEach(function (div) {
      var d = built.divisions[div];
      var order = Object.keys(d.games).sort(function (a, b) { return d.games[a].startsAt - d.games[b].startsAt; });
      order.forEach(function (id) {
        var g = d.games[id];
        if (g.startsAt > now) return;
        g.isBracket = !!g.source1;
        var t1 = g.team1Id, t2 = g.team2Id;
        if (g.isBracket) {
          var st = computeStandings(d.games, Object.keys(d.teams),
            { sport: sport, groups: d.groups || undefined, dqTeamIds: d.dq });
          var r = resolveBracket(d.games, st.seeds, d.dq)[id];
          t1 = r.slot1.teamId; t2 = r.slot2.teamId;
          if (!t1 || !t2) return;
        }
        var done = now >= g.endsAt;
        var fraction = done ? 1 : Math.max(0.2, (now - g.startsAt) / (g.endsAt - g.startsAt));
        playGame(g, t1, t2, built.strength, rand, done ? 1 : fraction);
        delete g.isBracket;
      });
    });
  }

  function build() {
    var rand = rng(2027);
    var built = {};
    ['soccer', 'basketball', 'volleyball'].forEach(function (sport) {
      built[sport] = buildSport(sport, rand);
    });

    // Demo clock: 12 minutes into the first basketball D1 quarterfinal.
    var now = built.basketball.divisions.d1.games['basketball-d1-qf-1'].startsAt + 12 * MIN;

    // A no-show in basketball D2 round robin, to show forfeits.
    var d2 = built.basketball.divisions.d2.games;
    var firstD2 = Object.keys(d2).filter(function (id) { return d2[id].team1Id; })[0];
    d2[firstD2].forfeitBy = 2;

    ['soccer', 'basketball', 'volleyball'].forEach(function (sport) {
      playUntil(sport, built[sport], now, rand);
    });
    if (d2[firstD2].status === 'final') { d2[firstD2].score1 = 0; d2[firstD2].score2 = 0; }

    var divisions = {};
    ['soccer', 'basketball', 'volleyball'].forEach(function (sport) {
      divisions[sport] = {};
      ['d1', 'd2', 'd3'].forEach(function (div) {
        var d = built[sport].divisions[div];
        d.publishedAt = now;
        divisions[sport][div] = d;
      });
    });

    return {
      now: now,
      divisions: divisions,
      banner: { text: 'Demo data — sample teams and scores. Real results appear here on game day.', level: 'info' }
    };
  }

  KO.demo = { build: build };
})(typeof window !== 'undefined' ? window : this);
