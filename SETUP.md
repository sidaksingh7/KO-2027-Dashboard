# Setup — from sandbox to the real thing

Until step 1 is done, every page runs in **sandbox mode**: data is saved only in your own
browser, the admin page needs no login, and the public site shows a demo tournament.
That's safe for trying things out. Do these steps once, in order.

---

## 1. Paste your Firebase config

1. Go to <https://console.firebase.google.com> and open **khalsa-olympics-2027**.
2. Click the **gear icon** (top left, next to "Project Overview") → **Project settings**.
3. On the **General** tab, scroll to **Your apps**.
   - No web app yet? Click the **`</>`** icon, nickname it `ko-dashboard`, leave
     "Firebase Hosting" unticked, click **Register app**.
4. Under **SDK setup and configuration**, choose **Config**.
5. Open `src/shared/firebase.js` and replace each `'PASTE_HERE'` with the matching value
   (keep the quotes). Leave `databaseURL` as it is.

These values aren't secret — the security rules (step 3) protect the data.

## 2. Turn on admin login

1. In the Firebase console left menu: **Build → Authentication** → **Get started**.
2. **Sign-in method** tab → **Email/Password** → switch **Enable** on → **Save**.
3. **Users** tab → **Add user** → enter the email + a password for each admin
   (you, Arshdeep, head scorekeepers). Repeat per person.
4. Each user now has a **User UID** column (a long code like `aB3dE…`). Copy each one.

## 3. Make those users admins + lock the database

1. Left menu: **Build → Realtime Database** → **Data** tab.
2. Hover the top line (the database URL) → click **+**.
   - Key: `ko2027` → click **+** on it → key `admin` → **+** → key `admins` → **+** →
     key = *a User UID from step 2*, value = `true`. Click **Add**.
   - Repeat the last part for each admin UID.
3. **Rules** tab → delete everything there → paste the whole contents of
   `database.rules.json` from this repo → **Publish**.

Now: anyone can *read* scores (public site + TVs), only admins can *change* anything.

## 4. Try it

1. Open `admin.html` → sign in with an admin email/password.
2. The badge at the top says **Live data** (not Sandbox).
3. Teams → add a few teams → Schedule → Preview → Save → Publish.
4. Open `index.html` — the teams and schedule appear.

## 5. Put it online (GitHub Pages)

1. Push the repo to GitHub (GitHub Desktop: **Push origin**).
2. On github.com open the repo → **Settings** → **Pages** (left menu).
3. **Source**: *Deploy from a branch* → Branch: **main**, folder **/ (root)** → **Save**.
4. After a minute the page shows your site address, e.g.
   `https://sidaksingh7.github.io/KO-2027-Dashboard/`
   - Public site: that address
   - Admin: `…/admin.html`
   - TVs: `…/tv.html`
5. Back in Firebase: **Authentication → Settings → Authorized domains → Add domain** →
   `sidaksingh7.github.io`. (Login won't work from the website without this.)

> Note: if the repo is private, GitHub Pages needs a paid GitHub plan (Pro / Team).
> Otherwise make the repo public — there are no secrets in it.

---

## Game-day cheat sheet

| Who | Opens | Does |
|---|---|---|
| Scorekeeper | `admin.html` → Score → tap the game | Start clock, tap +1/+2/+3, **Final** when done |
| Organizer | `admin.html` → Publish | Publish after team/schedule changes; set the banner |
| TV laptop | `tv.html` → pick a screen → full screen (F11) | Nothing — it updates itself |
| Spectators | the site address | Search their team |

**Volleyball:** score buttons count the current set → **End set** after each set → the match
finishes itself when a team wins 2 sets.

**Tied playoff game** (e.g. soccer penalties): pick the winner on the scoring screen, then Final.

**No-show:** scoring screen → *Corrections & forfeits* → "*Team* didn't show".

**Coin flip for a tie in standings:** Standings → **↑ Move up** on the tied team.
