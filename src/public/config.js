/*
 * KO 2027 — Event settings shown on the public site.
 * Edit text here; nothing else needs to change.
 */
(function (root) {
  'use strict';

  var EVENT = {
    name: 'Khalsa Olympics',
    year: 2027,
    edition: '5th Annual',
    tagline: 'More than a game.',
    venue: 'Paramount Fine Foods Centre',
    city: 'Mississauga, Ontario', // TODO confirm — README/brief say Brampton; designs + 2026 say Mississauga
    fields: 'Fields A–D (outside) · Gyms 1–3 (inside)',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Paramount+Fine+Foods+Centre+Mississauga',
    timezone: 'America/Toronto',
    contactEmail: '',          // TODO add organizer email to show a Contact link

    // Each sport gets its own day. Times are local (Toronto).
    days: [
      { sport: 'soccer', date: '2027-06-01', label: 'Day 1' },
      { sport: 'basketball', date: '2027-06-02', label: 'Day 2' },
      { sport: 'volleyball', date: '2027-06-03', label: 'Day 3' }
    ],

    // Display names for divisions — TBD (maybe Elite / Open / Rec).
    divisions: { d1: 'Division 1', d2: 'Division 2', d3: 'Division 3' }
  };

  var SPORTS = {
    soccer: {
      name: 'Soccer', icon: 'soccer', tagline: 'Passion. Speed. Unity.',
      bracket: 'groups2',
      timer: { direction: 'down', minutes: 20 },
      // Admin "build schedule" defaults (2026: 20-min games, 28-min slots, Fields A–D)
      scheduleDefaults: { courts: 'Field A, Field B, Field C, Field D', start: '09:00', slotMinutes: 28, gamesPerTeam: null },
      format: 'Two groups play a round robin. Top 2 in each group reach the semifinals ' +
        '(A1 vs B2, B1 vs A2), then the Final and 3rd place match.',
      ranking: 'Win 3 pts · Draw 1 · Loss 0. Ties: head-to-head (2 teams), goal difference ' +
        '(max ±5 per game), goals scored.',
      forfeit: 'No-show: opponent gets the win (+3 pts); the no-show team loses 3 pts.'
    },
    basketball: {
      name: 'Basketball', icon: 'basketball', tagline: 'Teamwork. Precision. Determination.',
      bracket: 'top8',
      timer: { direction: 'down', minutes: 20 },
      scheduleDefaults: { courts: 'Gym 1, Gym 2, Gym 3', start: '10:00', slotMinutes: 30, gamesPerTeam: 4 },
      format: 'Round robin, then the top 8 play quarterfinals (1v8, 4v5, 2v7, 3v6), ' +
        'semifinals, the Final and 3rd place.',
      ranking: 'Ranked by wins. Ties: head-to-head (2 teams), point difference ' +
        '(max ±20 per game), points scored.',
      forfeit: 'No-show: opponent gets the win and +10 difference.'
    },
    volleyball: {
      name: 'Volleyball', icon: 'volleyball', tagline: 'Energy. Trust. Resilience.',
      bracket: 'top4',
      timer: { direction: 'up' }, // stopwatch, no limit
      scheduleDefaults: { courts: 'Gym 1, Gym 2, Gym 3', start: '10:00', slotMinutes: 30, gamesPerTeam: 3 },
      format: 'Best-of-3-sets matches. Round robin, then the top 4 play semifinals ' +
        '(1v4, 2v3), the Final and 3rd place.',
      ranking: 'Ranked by match wins. Ties: head-to-head (2 teams), set difference, point ' +
        'difference (max ±15 per match), points scored.',
      forfeit: 'No-show: opponent gets a 2–0 win and +10 difference.'
    }
  };

  // Past champions, newest first. Add older years to the end.
  var CHAMPIONS = [
    { year: 2026, soccer: 'Mohali FC', basketball: 'Sher Elite', volleyball: 'Chinguacousy Ekta' },
    { year: 2025, soccer: 'Singhs United', basketball: 'Chardikala United', volleyball: 'Kalgiyan Valeh Di Team' }
  ];

  var LAST_YEAR = {
    year: 2026,
    stats: [
      { value: '48+', label: 'Teams' },
      { value: '3', label: 'Sports' },
      { value: '4,000+', label: 'Attendees' }
    ]
  };

  // Photos. Google Drive file ids from the organizers' 2026 photo folder ("cam 2",
  // https://drive.google.com/drive/folders/1xI2N1oOH2fQ8Ce8cs1F-v4EKGKHPKIg4).
  // They only load while that folder is shared "anyone with the link"; a photo that
  // fails to load is skipped. A path like 'assets/photos/x.jpg' uses a local file.
  var PHOTOS = {
    // Home page hero slideshow, in order (crossfades every 6 s)
    slides: [
      '1UTNg4d2orK2kY3G4RZ_iRk4sU4v1kL6j', // IMG_0582 soccer
      '1os9GoXrKh44ZhqLbzRQ6AfA15hYeklxd', // IMG_1034 volleyball block
      '1IY3ZKwGMTKsc1hC4TCmcXQc_jIX-3XtG', // IMG_1505 basketball
      '1hmGhFeMcMA0VUjGWl7zUbUTb06tFst77', // IMG_0484 soccer
      '1l211Iv1HEV1NG8gwd187hPc0ievUDEPa', // IMG_1208 volleyball at the net
      '12Mg_OHIk9TRwIBXE9ysTbJOKKbw1iLdj', // IMG_0760 gym
      '13tvElyLsdSKCVCFZHe5ziSuHMU7tZhGT', // IMG_0607 soccer
      '1uQGsoEyOPYmIvipz9rrBEGPLLI4mc9AK', // IMG_1158 volleyball
      '1G2JZ-TCe8VzvF-VjIA47Tyk3kE1y0_xz', // IMG_1529 basketball
      '15oEq2IZE0xECd3we46S1JJmJmCfFWIif', // IMG_0932 community
      '1LzzfHIunhWMaW1U4scrO3axauzWASa0r', // IMG_0557 soccer
      '1tewwz-anWi3QCaNJ6HkDglC_CP-r1YxU', // IMG_1184 team
      'assets/photos/hero-volleyball.jpg'  // from the 2027 homepage design
    ],
    soccer: '1UTNg4d2orK2kY3G4RZ_iRk4sU4v1kL6j',
    basketball: '1IY3ZKwGMTKsc1hC4TCmcXQc_jIX-3XtG',
    volleyball: '1os9GoXrKh44ZhqLbzRQ6AfA15hYeklxd'
  };
  function photoUrl(idOrPath, size) {
    if (/[\/.]/.test(idOrPath)) {
      // local file — make it absolute, since CSS url() inside a stylesheet resolves
      // relative to the stylesheet, not the page
      return root.document ? new URL(idOrPath, root.document.baseURI).href : idOrPath;
    }
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(idOrPath) + '&sz=' + (size || 'w1600');
  }

  root.KO = root.KO || {};
  // 2026 sponsors (from the 2027 homepage design) — thanked on the Info page.
  var PARTNERS_2026 = [
    'Jaswant Singh Khalra Khalsa School', 'Cycom Technology Solutions', 'HB Accounting & Tax Services',
    'Cloud Vital Technologies', 'KM School', 'Raise the Stars', "Healthy 'N Fit Nutrition",
    'King Consultants', 'India Bazar', 'Home Mortgage Care', 'Aroga Lifestyle Medicine', 'Pinnia.ca',
    'GTA Decor', 'Maa Boli', "Mr. Singh's Pizza", 'Jaggi Accounting Services'
  ];

  root.KO.config = {
    EVENT: EVENT, SPORTS: SPORTS, CHAMPIONS: CHAMPIONS, LAST_YEAR: LAST_YEAR,
    PARTNERS_2026: PARTNERS_2026, PHOTOS: PHOTOS, photoUrl: photoUrl
  };
})(typeof window !== 'undefined' ? window : this);
