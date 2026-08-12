# Block-Puzzle Game — Build Plan (Web + App + Live 2-Player Co-op)

Status: **plan only, nothing built yet.**
Goal: one-shot implementable spec — every rule, constant, file and message is pinned down so the build is
mechanical rather than exploratory.

---

## 0. Naming / IP note (read once, then move on)

"Block Blast!" is a published title (Hungry Studio). Game *mechanics* aren't copyrightable, so a clone of the
rules is fine — but the name, logo, block art, sound effects and UI chrome are not. So: original name, original
palette, original sounds. Working name used throughout this doc: **BLOKDUO** (placeholder, swap freely).

---

## 1. Research findings — how the classic game actually works

Verified across several sources (see Sources at the end):

| Rule | Value |
|---|---|
| Board | 8 × 8 grid, starts empty |
| Pieces offered | 3 at a time, in a tray below the board |
| Rotation | **Not allowed** — a piece must be used in the orientation it was dealt |
| Refill | New set of 3 only after **all three** have been placed |
| Placement | Drag/drop onto any position where every cell of the piece lands on empty cells, in bounds |
| Clearing | Any fully filled row **or** column clears; multiple lines clear simultaneously from one placement |
| Gravity | **None** — remaining blocks do not fall or shift after a clear (this is the key difference from Tetris) |
| Game over | No remaining tray piece has any legal placement anywhere on the board |
| Scoring | Points per placed cell, +10 per line cleared, multiplied up by combos (multi-line in one move) and streaks (clearing on consecutive moves); breaking a streak resets the multiplier |
| Shapes | ~14 shape families / ~19 named variants; expands to **37 distinct fixed-orientation pieces** (catalog in §4.2) |

Exact published multiplier tables don't exist — the real game's formula isn't disclosed. So §4.4 defines a
concrete, tuned formula in one config object. It reproduces the *feel* (multi-line clears and streaks are worth
far more than plain placements) and can be retuned by editing a single file.

---

## 2. What gets built

**Deliverable A — Website game.** Classic single-player mode. Responsive, mouse + touch, works offline once
loaded, local high score. This is the whole game.

**Deliverable B — App (iOS + Android).** Ships the *same* build wrapped natively, so classic mode is identical
by construction — not a reimplementation. Adds:

**Deliverable C — Duo mode (in both web and app).** Two players, one shared board, alternating live turns,
one shared score. Server-authoritative so neither client can cheat or desync.

---

## 3. Architecture

```
blokduo/                       pnpm workspace
├─ packages/engine/            ← pure TypeScript, zero deps, no DOM, deterministic
│   ├─ src/board.ts            board repr, fits(), place(), findClears(), applyClears()
│   ├─ src/pieces.ts           the 37-piece catalog + weights
│   ├─ src/rng.ts              mulberry32 seeded PRNG
│   ├─ src/deal.ts             weighted hand dealing + assisted-deal rule
│   ├─ src/scoring.ts          ALL tunable constants live here
│   ├─ src/game.ts             reducer: (GameState, Move) -> {state, events}
│   └─ src/index.ts
├─ apps/web/                   ← Vite + React + TS. The website AND the app's payload.
│   ├─ src/game/               React bindings over engine (hooks, store)
│   ├─ src/components/         Board, Cell, Tray, DraggablePiece, Hud, GameOver, DuoHud…
│   ├─ src/net/                WebSocket client for duo mode
│   ├─ src/audio/              WebAudio SFX (synthesised, no asset licensing)
│   └─ src/styles/
├─ apps/server/                ← Cloudflare Worker + Durable Object (one DO per room)
│   ├─ src/worker.ts           routing: POST /room (create), GET /room/:code/ws (upgrade)
│   └─ src/RoomDO.ts           authoritative duo game
└─ apps/mobile/                ← Capacitor project; www/ = apps/web build output
    ├─ ios/  android/
    └─ capacitor.config.ts
```

**Why this shape:** the engine is a pure package imported by *both* the browser and the Durable Object. One
implementation of the rules → the server can never disagree with the client about what's legal. It's also
trivially unit-testable with no DOM.

**Why Capacitor over a React Native rewrite:** the requirement is "the app has the *exact same* classic game
mode." Capacitor ships the identical bundle, so "exact same" is guaranteed rather than maintained by hand. A
DOM/CSS board at 8×8 = 64 cells is nowhere near a performance problem.

---

## 4. Engine spec (`packages/engine`)

### 4.1 Data model

```ts
type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;   // 0 = empty, 1-7 = colour id
type Board = Uint8Array;                      // length 64, index = row * 8 + col

interface Piece {
  id: string;            // 'L4-r90', '3x3', …
  cells: [number, number][];  // [row, col] offsets, normalised so min row = min col = 0
  w: number; h: number;
  weight: number;        // deal frequency
}

interface GameState {
  board: Board;
  hand: (string | null)[];   // 3 slots, null = already placed
  score: number;
  streak: number;            // consecutive placements that cleared >= 1 line
  best: number;
  seed: number; drawCount: number;   // deterministic dealing
  over: boolean;
  moveCount: number;
}

type Move = { slot: 0|1|2; row: number; col: number };
```

### 4.2 Piece catalog — 37 fixed-orientation pieces

No rotation in-game, so every orientation is its own piece.

| Family | Orientations | Count |
|---|---|---|
| Single 1×1 | — | 1 |
| Domino | 1×2, 2×1 | 2 |
| Bar-3 | 1×3, 3×1 | 2 |
| Bar-4 (I) | 1×4, 4×1 | 2 |
| Bar-5 | 1×5, 5×1 | 2 |
| Square 2×2 (O) | — | 1 |
| Rect 2×3 | 2×3, 3×2 | 2 |
| Square 3×3 | — | 1 |
| Corner triomino | 4 | 4 |
| L tetromino | 4 | 4 |
| J tetromino | 4 | 4 |
| T tetromino | 4 | 4 |
| S tetromino | 2 | 2 |
| Z tetromino | 2 | 2 |
| Big corner (3+3, 5 cells) | 4 | 4 |
| **Total** | | **37** |

Deal weights (higher = more common): dominoes/bar-3/2×2 = 6, corner triomino = 5, tetrominoes = 4,
bar-5 / 2×3 / big corner = 3, single 1×1 = 2, 3×3 = 1. All in `pieces.ts`, one table.

### 4.3 Core algorithms

- `fits(board, piece, row, col)` → every offset cell in bounds and empty. O(cells).
- `legalAnchors(board, piece)` → list of (row,col); used for hints, game-over check, and the AI opponent later.
- `place(board, piece, row, col, colour)` → new board (copy-on-write).
- `findClears(board)` → `{rows: number[], cols: number[]}`.
- `applyClears(board, clears)` → cells in both a full row and a full column are cleared once, not twice.
- `isGameOver(state)` → no non-null hand slot has any legal anchor. **Check after every placement**, not just on refill.
- `deal(seed, drawCount, board)` → 3 weighted-random pieces. *Assisted dealing* (flag, default **on**): if none
  of the 3 fits the current board, re-roll up to 20 times before accepting. Effect: you never lose the instant a
  hand appears — you lose from a decision you made mid-hand. This is what makes good clones feel fair.
- RNG: `mulberry32(seed)` advanced `drawCount` times — deterministic, so a game is fully reproducible from
  `(seed, moveList)`. Essential for the multiplayer server and for replay/debugging.

### 4.4 Scoring — `scoring.ts` (every number here is one edit away from being retuned)

```ts
POINTS_PER_CELL   = 1
LINE_BASE         = 10
MULTI_LINE_BONUS  = [0, 0, 20, 60, 120, 200, 300, 420, 560]   // index = lines cleared this move
STREAK_STEP       = 0.5      // multiplier grows 1.0 → 1.5 → 2.0 …
STREAK_MAX        = 4.0
PERFECT_CLEAR     = 300      // board completely empty after a clear
```

Per placement:

```
streakMult   = min(1 + STREAK_STEP * streakBefore, STREAK_MAX)
placeScore   = cells * POINTS_PER_CELL
clearScore   = round((n * LINE_BASE + MULTI_LINE_BONUS[n]) * streakMult)      // n = lines cleared
perfect      = boardEmpty ? PERFECT_CLEAR : 0
score       += placeScore + clearScore + perfect
streak       = n > 0 ? streak + 1 : 0
```

Worked example: 4 lines cleared on a 3rd-consecutive clearing move →
`(4*10 + 120) * min(1+0.5*2, 4) = 160 * 2.0 = 320`, plus cells placed.

### 4.5 Reducer

`applyMove(state, move) -> { state, events }` where `events` drives animation/audio:
`{ type:'placed'|'cleared'|'combo'|'streak'|'perfect'|'refill'|'gameover', … }`. Pure — no timers, no DOM,
no randomness outside the seeded RNG. Same function runs in the browser and in the Durable Object.

---

## 5. Web game spec (`apps/web`)

### Screens
1. **Home** — Play Classic · Play Duo · Best score · How to play · Sound toggle
2. **Classic** — board, tray, HUD (score / best / streak pill), pause, restart
3. **Duo lobby** — create room (6-char code + share link) or join by code
4. **Duo game** — shared board, tray, turn banner, turn timer ring, both players' contributions
5. **Game over** — score, best-beaten celebration, per-player split in duo, Play again / Rematch

### Drag & drop (this is where a clone lives or dies)
- Pointer Events only (`pointerdown/move/up` + `setPointerCapture`) — one code path for mouse, touch and pen.
- **Finger offset:** on touch, the piece lifts ~48px above the touch point so it isn't hidden by the thumb.
  This single detail is most of the "feels like the real game" difference.
- **Snap ghost:** the target cells are highlighted live while dragging — green tint if legal, red if not, and
  rows/columns that *would* clear pulse brighter.
- Snap uses the piece's top-left anchor derived from the drag origin, then rounds to the nearest cell; drops
  outside the board or on an illegal spot spring the piece back to the tray with a bounce.
- Also support click-to-select → click-to-place (keyboard/accessibility path, and it's faster on desktop).

### Feel
- CSS `transform`-only animations (no layout thrash): place = 60ms squash; clear = 220ms per-cell stagger
  sweeping outward from the placement; score = count-up + floating `+N` at the clear point; combo = screen shake
  scaled to lines cleared.
- Audio synthesised at runtime with WebAudio (oscillator + envelope) — no licensed assets, ~40 lines,
  rising pitch per streak step. Muted by default until first interaction (browser autoplay policy).
- Palette: 7 block colours checked for colour-blind separability; colour is never the only signal.

### Responsive & persistence
- Board sized off `min(vw, vh)` with `dvh` units and `env(safe-area-inset-*)`; portrait-first, landscape
  supported. `touch-action: none` on the board, no double-tap zoom.
- `localStorage`: best score, sound pref, in-progress classic game (resume after refresh/backgrounding).
- PWA manifest + service worker → installable, and classic mode works fully offline.

---

## 6. Duo mode spec (the new part)

### 6.1 Rules

- **2 players exactly.** Shared 8×8 board, shared tray of 3, **shared score**.
- Strict alternation: P1 places one piece → P2 places one piece → P1 … The tray refills when all 3 slots are
  used, so a hand spans three turns and crosses between players. That's what makes it co-op — you're setting up
  your partner, and the piece you take is a piece they can't have.
- Game over: same condition as classic — no remaining tray piece fits anywhere. It's a shared loss, whoever's
  turn it is.
- **Turn timer: 45s.** On expiry the turn passes to the partner (they place instead) — nobody is force-placed
  into a bad spot. Three consecutive timeouts from the same player ends the room.
- End screen shows the shared score plus each player's contribution (cells placed, lines cleared, best combo).
- *Alternative under consideration:* each player gets their own private tray of 3 and they alternate onto the
  shared board. More individual agency, less "together." Shared tray is the default; the alternative is a
  server flag so both can be play-tested without a rewrite.

### 6.2 Server — Cloudflare Worker + Durable Object

One Durable Object instance per room code. The DO is the single source of truth: it holds the board, the seed,
whose turn it is, and the score. Clients render optimistically and reconcile on the server's reply.

- `POST /room` → creates a room, returns a 6-char code (unambiguous alphabet, no O/0/I/1).
- `GET /room/:code/ws` → WebSocket upgrade, routed to that room's DO.
- WebSocket **Hibernation API** (`ctx.acceptWebSocket`) so an idle room costs nothing while players think.
- `ctx.storage` persists the room (few hundred bytes) → survives DO eviction and redeploys.
- `ctx.storage.setAlarm()` drives the turn timer and garbage-collects rooms idle > 30 min.

### 6.3 Wire protocol (JSON)

Client → Server
```
{ t:'join',   code, name, clientId }
{ t:'place',  seq, slot, row, col }
{ t:'ready' } | { t:'rematch' } | { t:'emote', id } | { t:'leave' }
```

Server → Client
```
{ t:'state',    snapshot }                       // full state; sent on join/resync
{ t:'applied',  seq, by, slot, row, col, clears, scoreDelta, hand, turn, streak }
{ t:'rejected', seq, reason, snapshot }          // client rolls back to snapshot
{ t:'turn',     turn, deadline }
{ t:'peer',     connected, name }
{ t:'over',     score, stats }
{ t:'error',    code, message }
```

- Every client move carries a monotonic `seq`; the server validates with the **same engine** and either
  broadcasts `applied` or returns `rejected` + authoritative snapshot. Illegal or out-of-turn moves are
  impossible to force through.
- Optimistic UI: apply locally on drop, roll back if `rejected` arrives. At LAN/4G latency the rollback is
  effectively never seen.

### 6.4 Connection handling
- Disconnect → 60s grace; partner sees "Wilson is reconnecting…" with a countdown, board frozen, timer paused.
- Rejoin with the same `clientId` restores the seat and replays the full snapshot.
- Grace expires → the remaining player picks "Continue solo (keep the score)" or "End game".
- Heartbeat ping/pong every 20s to detect half-open mobile connections.

### 6.5 Matchmaking
Phase 1: room code + share link (`/duo/ABCDEF` — opening the link auto-joins). Covers "play with a friend,"
which is the whole ask. Phase 2 (optional later): a "quick match" queue DO pairing two waiting strangers.

---

## 7. App spec (`apps/mobile`)

- Capacitor 7; `webDir` points at the `apps/web` production build. Classic mode is byte-identical to the web.
- Native additions: `@capacitor/haptics` (light tap on place, heavier on multi-line clear), `@capacitor/status-bar`,
  splash screen, `@capacitor/preferences` for best score, `@capacitor/share` for the duo invite link, deep link
  `blokduo://duo/CODE` + universal links so a tapped invite opens straight into the room.
- Lock to portrait, disable overscroll/rubber-band on the board, respect safe areas on notched devices.
- Store prep: icon set, screenshots, privacy policy (duo mode transmits nothing but a display name and moves),
  age rating, no ads / no IAP in v1.

---

## 8. Testing

| Layer | Tool | What |
|---|---|---|
| Engine | Vitest | `fits`/`place`/`findClears` unit tests; **property tests**: a placement never overwrites a filled cell, score is deterministic for a given `(seed, moves)`, game-over is only reported when zero legal anchors exist across all hand slots; golden-file test on a 200-move scripted game |
| Server | `@cloudflare/vitest-pool-workers` | two simulated sockets: turn alternation, out-of-turn rejection, illegal-move rejection, timeout pass, disconnect/rejoin snapshot equality |
| Web | Playwright | drag-place with synthetic pointer events, clear animation, game-over screen, duo happy-path with two browser contexts against a local `wrangler dev` |
| Manual | — | real iOS + Android device pass for touch offset, haptics, safe areas |

Target: engine at 100% branch coverage. It's ~400 lines of pure functions — cheap to fully cover, and it's the
piece that both other layers trust.

---

## 9. Build order (designed to be run in one pass)

| # | Phase | Output | Est. |
|---|---|---|---|
| 1 | Scaffold | pnpm workspace, TS configs, Vite, Vitest, wrangler, ESLint | 30m |
| 2 | Engine | pieces, rng, board, deal, scoring, game reducer + full test suite | 2h |
| 3 | Board UI | static render, HUD, tray, palette, layout at all sizes | 1.5h |
| 4 | Drag & drop | pointer drag, finger offset, snap ghost, clear preview, click-to-place | 2.5h |
| 5 | Classic loop | refill, game over, restart, best score, resume, animations, audio | 2h |
| 6 | Polish + PWA | juice pass, manifest, service worker, offline, a11y | 1.5h |
| 7 | **Web game ships** | deploy to Cloudflare Pages | 15m |
| 8 | Duo server | Worker + RoomDO, protocol, timer alarm, storage, tests | 2.5h |
| 9 | Duo client | lobby, socket client, optimistic apply/rollback, turn UI, reconnect | 2.5h |
| 10 | Duo polish | invite link, emotes, end-of-game split, edge cases | 1h |
| 11 | Capacitor | iOS + Android projects, haptics, deep links, device testing | 2h |
| 12 | Store prep | icons, screenshots, metadata, privacy policy | 1.5h |

Phases 1–7 are a complete, shippable website game on their own. 8–10 add duo. 11–12 add the app.
Roughly 19h of build time; phases 2 and 4 carry most of the risk.

---

## 10. Decisions needed before the build starts

1. **Name** — needed for the repo, package names, bundle ID, and domain.
2. **Duo tray model** — shared tray (recommended, maximally co-op) vs. per-player tray.
3. **Multiplayer backend** — Cloudflare Workers + Durable Objects (recommended: authoritative rooms are exactly
   what DOs are for, and it's ~free at this scale) vs. Supabase Realtime (already in use elsewhere, but it's a
   broadcast channel, so the authority has to be faked client-side).
4. **App packaging** — Capacitor (recommended: guarantees "exact same classic mode") vs. a React Native rewrite.
5. **Project location** — new repo at `~/Desktop/<name>/`, separate from StudioBookingSoftware.

---

## Sources

- [Scoring, Combos, and Streaks — Block Blast Online](https://blockblast.free/wiki/scoring-and-combos/)
- [How to Play Block Blast — Block Blast Online](https://blockblast.free/wiki/how-to-play-blockblast/)
- [How Block Blast Scoring Works](https://blocksolver.bitbucket.io/)
- [How do combos work in Block Blast? — Playgama](https://playgama.com/blog/game-faqs/how-do-combos-work-and-how-to-get-them-in-block-blast/)
- [How Many Blocks Are in Block Blast? — Playgama](https://playgama.com/blog/game-faqs/how-many-blocks-are-there-in-block-blast/)
- [Block Blast Piece Shapes: Complete Guide](https://smartblockblastsolver.com/blogs/block-blast-pieces)
- [Block Blast Piece Shapes Guide](https://blockblastsolve.com/block-blast-piece-shapes-guide/)
- [Block Blast Score Rules — Base Points, Combos & Multipliers](https://onlineblockblastsolver.com/block-blast-score-rules/)
- [tokaa1/blockerino — Block-Blast clone (reference implementation)](https://github.com/tokaa1/blockerino)
- [RisticDjordje/BlockBlast-Game-AI-Agent — reimplementation + RL agents](https://github.com/RisticDjordje/BlockBlast-Game-AI-Agent)
