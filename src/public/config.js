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
      format: 'Two groups play a round robin. Top 2 in each group reach the semifinals ' +
        '(A1 vs B2, B1 vs A2), then the Final and 3rd place match.',
      ranking: 'Win 3 pts · Draw 1 · Loss 0. Ties: head-to-head (2 teams), goal difference ' +
        '(max ±5 per game), goals scored.',
      forfeit: 'No-show: opponent gets the win (+3 pts); the no-show team loses 3 pts.'
    },
    basketball: {
      name: 'Basketball', icon: 'basketball', tagline: 'Teamwork. Precision. Determination.',
      bracket: 'top8',
      format: 'Round robin, then the top 8 play quarterfinals (1v8, 4v5, 2v7, 3v6), ' +
        'semifinals, the Final and 3rd place.',
      ranking: 'Ranked by wins. Ties: head-to-head (2 teams), point difference ' +
        '(max ±20 per game), points scored.',
      forfeit: 'No-show: opponent gets the win and +10 difference.'
    },
    volleyball: {
      name: 'Volleyball', icon: 'volleyball', tagline: 'Energy. Trust. Resilience.',
      bracket: 'top4',
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

  // Photos. `hero` is a local file (from the 2027 homepage design). The sport photos
  // come from the organizers' Google Drive archive (2026) and only load if that folder
  // is shared publicly — otherwise cards fall back to the plain brand background.
  var PHOTOS = {
    hero: 'assets/photos/hero-volleyball.jpg',
    soccer: '1IHvB456wjzb6wJwHB6UL7-M_RCzvdF16',
    basketball: '1YHc5xBV68wlAaVaMvuOxLUG5IvjGp1vm',
    volleyball: '1a0VuekY97k_ffwvVXCDgEnrBxHOQeLqw'
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
