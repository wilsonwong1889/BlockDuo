# BLOKDUO

**Live: https://blokduo.wilsonwong1889.workers.dev**

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
BLOKDUO_ORIGIN=https://blokduo.wilsonwong1889.workers.dev node apps/server/scripts/partner-bot.ts ROOMCODE
```

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
VITE_SERVER_URL=https://your-worker.workers.dev npm run sync --workspace=@blokduo/mobile
```

### iOS needs a toolchain this machine doesn't have yet

The Xcode project is generated and the web assets are copied into it, but
`pod install` could not run:

- CocoaPods isn't installed — `brew install cocoapods`
- `xcode-select` points at the Command Line Tools rather than a full Xcode —
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`

Both need your password, so they're yours to run. Android is fully set up and
syncs cleanly.
