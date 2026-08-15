# BLOKDUO

**Live: https://blokduo.ca** — also on `www.`, and still on
https://blokduo.wilsonwong1889.workers.dev so older invite links keep working.

An 8×8 block puzzle you can play solo, or two-up on one shared board, live.

Classic mode is the familiar game: three pieces at a time, no rotation, fill a
row or column to clear it, and nothing falls afterwards. Duo mode is the same
game with two people alternating turns from the same tray — the piece you take
is one your partner can't have, so you're constantly setting each other up.

## Layout

```
packages/engine   The rules. Pure TypeScript, no dependencies, no DOM.
apps/web          Vite + React. The website, and the app's payload.
apps/server       Cloudflare Worker + one Durable Object per room.
apps/mobile       Capacitor shell wrapping the web build for iOS and Android.
```

The engine is imported by both the browser and the Durable Object. That is the
load-bearing decision in the whole project: there is one implementation of the
rules, so the server can never disagree with the client about what a legal move
is or what it scored, and the rules are testable with no browser involved.

## Running it

```bash
npm install
```

Classic mode needs nothing but the web app:

```bash
npm run dev
```

Duo also needs the room server, in a second terminal:

```bash
npm run dev:server
```

The web app talks to `http://localhost:8787` in development. Give a turn timer
you can actually work with while developing:

```bash
npx wrangler dev --var TURN_MS:900000
```

### In Docker

Both halves at once, with nothing installed on the host but Docker:

```bash
docker compose up
```

The site is on http://localhost:5173 and the rooms on http://localhost:8787,
which is exactly the pair of ports the dev client already expects. Source is
bind-mounted, so hot reload works; `node_modules` is not, because the container
installs a Linux dependency tree and the host's is not one. Durable Object
storage lives in a named volume, so rooms and progress survive `docker compose
restart`, and `docker compose down -v` is how you throw them away.

To run the deployed shape instead — the built site and the rooms as one Worker
on one origin, http://localhost:8787:

```bash
docker compose --profile preview up --build
```

That serves what was built into the image, so it wants `--build` to pick up
changes. It also binds the same port as the dev `server` service, so run one or
the other. Neither is a deployment: both run the rooms under `wrangler dev`,
which is the real `workerd` runtime locally — the Worker itself still ships with
`npm run deploy` ([Deploying](#deploying)). That is also why the image is Debian
rather than Alpine, since `workerd` is glibc-only.

### Tests

```bash
npm test
```

That runs every workspace: the engine's rules and invariant checks across 40
full random games, the web app's pure-logic suites, and the server's integration
tests, which drive two live WebSockets against a real Durable Object including
the alarm-driven turn timeout. The server half boots the real `workerd` runtime,
so it takes a few seconds where the other two are instant.

One workspace on its own:

```bash
npm run test --workspace=@blokduo/server
```

`npm run typecheck` covers all three the same way.

### Playing against a stand-in partner

Two browser tabs can't both be visible in one preview pane, so there's a bot
that speaks the protocol and makes only legal moves:

```bash
node apps/server/scripts/partner-bot.ts ROOMCODE 3
```

## The rules, precisely

| | |
|---|---|
| Board | 8 × 8 |
| Pieces | 3 at a time, from a weighted bag of 37 fixed orientations |
| Rotation | Never |
| Refill | Only once all three have been placed |
| Clearing | Full rows and columns go simultaneously; a shared cell counts once |
| Gravity | None — the holes you leave are permanent |
| Game over | No remaining tray piece fits anywhere |

Scoring lives entirely in [`packages/engine/src/scoring.ts`](packages/engine/src/scoring.ts):
one point per placed cell, ten per cleared line, a superlinear bonus for
multi-line clears, and a multiplier that grows while you clear on consecutive
turns. Retuning the game's feel should only ever mean editing that file.

Dealing is nudged: if a fresh hand of three has no legal placement at all, it is
re-rolled. This is deliberately best-effort rather than guaranteed — forcing a
fitting piece would mean a near-full board could always be played on and games
would stop ending. Measured effect is in the comments on `MAX_REROLLS`.

## Duo mode

One Durable Object per room code, addressed by `idFromName`, so the code alone
is enough to find a game with nothing to look up anywhere else.

- Clients apply moves optimistically and reconcile against the server's reply.
  A rejection rolls straight back to the authoritative board.
- 45s turn timer. On expiry the turn **passes** rather than auto-placing a piece
  somewhere the player didn't choose.
- The clock pauses if the player to move drops, and resumes when they return.
- A seat freed after the 60s grace leaves the game running for whoever is still
  there, with the room code still open for the partner to come back into.

## Deploying

Every update takes the next version number, which lives in `version.json`:

```bash
npm run bump
```

`1.month.day.build`, where build counts that day's updates and resets each day.
It is a committed file rather than a count of the day's commits because the
deploy builds from a shallow clone — asking git there sees one commit and
stamped every deploy `.1`, whichever update it really was. Keeping it in the
repo also makes the version a property of the commit, so rebuilding the same
commit does not invent a new one.

The site and the room server are **one Worker**. Build the web app first, since
the Worker uploads `apps/web/dist` as its static assets:

```bash
npm run build && npm run deploy --workspace=@blokduo/server
```

Assets are matched first; anything unmatched (`/api/*`) reaches the Worker. No
SPA fallback is configured because routing is done with the hash, so every
request path is just `/`. One origin means the web client needs no
configuration to find the room server.

Duo runs on the **Workers Free plan** — Durable Objects are included there, but
only SQLite-backed ones, which is what `new_sqlite_classes` in
[`wrangler.jsonc`](apps/server/wrangler.jsonc) selects.

To play a live duo game against a stand-in partner:

```bash
BLOKDUO_ORIGIN=https://blokduo.ca node apps/server/scripts/partner-bot.ts ROOMCODE
```

### Seeing how it is going

Daily counts of what the server did — players created, games claimed by mode,
rooms opened, wheel spins — are kept for 90 days and read behind a secret:

```bash
npx wrangler secret put ADMIN_TOKEN --config apps/server/wrangler.jsonc
curl "https://blokduo.ca/api/admin/metrics?token=SECRET&days=14"
```

Without the secret set the endpoint answers 404, because a metrics endpoint
that opens itself when nobody configured it is the wrong default. Nothing in
there identifies a player: a day, a name and a number.

## Custom domain

The app builds every URL it uses — API calls, the room socket, invite links —
from `window.location.origin`, so it follows whatever domain serves it. Pointing
`blokduo.ca` here needed no code change.

**This is done.** `blokduo.ca` is a zone on the Cloudflare account, the
nameservers moved at Spaceship on 2026-08-14, and both `blokduo.ca` and
`www.blokduo.ca` are attached to the Worker by the `routes` block in
[`wrangler.jsonc`](wrangler.jsonc). Cloudflare issued the certificates and
manages the DNS rows itself — there is no origin server to point at, because the
Worker *is* the origin, and nothing should be added beside those rows by hand.

What the steps were, if another domain is ever added: add the zone in the
dashboard, move the registrar's nameservers to the two Cloudflare gives you,
then attach the domain. Workers custom domains need the zone on Cloudflare — a
plain CNAME at another DNS host will not do. Attaching in the dashboard is the
safer first move, because it checks the zone exists where wrangler simply fails
the deploy. Budget hours, not minutes: a same-day registration waits on the
registry publishing the delegation before any of it can take effect.

The `workers.dev` address keeps working, so invite links already in circulation
stay valid, and links made after the switch carry the new domain — both are
built from wherever the page was loaded. That survival is **not** automatic:
giving a Worker `routes` turns its `workers.dev` address off unless
`"workers_dev": true` says otherwise, which is why both wrangler configs set it
explicitly. Removing it silently breaks every link on the old origin.

The one origin written down rather than discovered is the native build's
`VITE_SERVER_URL`.

## Advertising

Two different things, which are easy to confuse because both are Google:

**Rewarded video** — watch an advert, get a reward — is what the strategy
document is built around, and it is an *app* format. AdMob serves it on Android
and iOS; AdSense has no rewarded format at all. That seam lives in
[`src/ads/index.ts`](apps/web/src/ads/index.ts) and is still on its placeholder,
which resolves as though an advert was watched so the quotas, refusals and
rewards can be built and tested before a network exists. The wheel already
spends it: [`ProgressDO`](apps/server/src/ProgressDO.ts) accepts an `ad` spin
source with a daily cap.

**Display banners** on the website are AdSense, and that is
[`src/ads/adsense.ts`](apps/web/src/ads/adsense.ts). Nothing loads unless a
publisher ID is configured, so an unconfigured build carries no third-party
script at all — and it never runs inside the native shell, where AdSense would
breach programme policy and AdMob is the right product anyway.

To turn it on, once there is an approved AdSense account:

```bash
# Build the site with the publisher ID and the unit's slot ID.
VITE_ADSENSE_CLIENT=ca-pub-0000000000000000 \
VITE_ADSENSE_SLOT_HOME=0000000000 \
  npm run build

# Authorise the same publisher to sell the inventory. Note: no `ca-` prefix
# here — ads.txt takes the `pub-` form, the client tag takes `ca-pub-`.
npx wrangler secret put ADSENSE_PUB_ID
```

`/ads.txt` is served by the Worker rather than shipped as a file, so a build
without an ID returns 404 instead of publishing a placeholder. That file is an
authorisation record — it tells advert buyers who may sell this site's
inventory — so a stub left in by accident vouches for the wrong account rather
than doing nothing.

Placement is a policy matter, not only a design one. Adverts sit on menus and
result screens, never beside the board: Google treats an advert close enough to
a control to be tapped mid-drag as invalid traffic, and the strategy document
rules out forced adverts inside play regardless.

[`/privacy.html`](apps/web/public/privacy.html) is a plain crawlable page, not a
hash route, because a reviewer and a crawler both need to reach it. In
production it is canonically `/privacy` — Workers assets redirects the `.html`
form to it — while the link in the game keeps the extension, which is the one
URL that resolves in local dev as well. It carries
the advertising-cookie disclosure AdSense requires, and it names
`privacy@blokduo.ca` — **an address that does not exist yet**; point it
somewhere with Cloudflare Email Routing before applying, or change it.

## The app

```bash
npm run sync --workspace=@blokduo/mobile
npm run open:android --workspace=@blokduo/mobile
```

The native shell ships the web build verbatim, which is what makes "the app has
the exact same classic mode" a guarantee rather than something to maintain. On
top of it: haptics on placing and clearing, a dark status bar, portrait lock,
Android back-button handling, and `blokduo://duo/CODE` deep links so a shared
invite opens the room directly.

**The native build must be given `VITE_SERVER_URL`** — it is served from the
bundle, so there is no origin for the duo server to be relative to.

```bash
VITE_SERVER_URL=https://blokduo.ca npm run sync --workspace=@blokduo/mobile
```

### iOS needs a toolchain this machine doesn't have yet

The Xcode project is generated and the web assets are copied into it, but
`pod install` could not run:

- CocoaPods isn't installed — `brew install cocoapods`
- `xcode-select` points at the Command Line Tools rather than a full Xcode —
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`

Both need your password, so they're yours to run. Android is fully set up and
syncs cleanly.
