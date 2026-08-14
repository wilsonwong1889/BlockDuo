import { cloneBoard, hasAnyPlacement, SIZE } from './board.js';
import { dealHand, HAND_SIZE } from './deal.js';
import { applyMove, isGameOver, newGame } from './game.js';
import { getPiece, rotatedPieceId } from './pieces.js';
import type { Board, GameEvent, GameState, HandSlot, Move } from './types.js';

/**
 * Gem-bought powers, and the transcript that keeps them honest.
 *
 * A Classic game is verified by replaying it, so a power that only existed in
 * the browser would make every game that used one unverifiable — no coins, no
 * leaderboard. Each power is therefore an entry in the transcript the server
 * already replays, and the rules below are enforced in the replay rather than
 * in the UI. A client that rewrites its own transcript still has to produce one
 * that replays.
 */

export const POWER_COSTS = {
  /** Take the last placed piece back off the board and into its slot. */
  undo: 1,
  /** Turn one held piece a quarter turn clockwise. */
  rotate: 2,
  /** Throw the whole hand away and deal another. */
  reroll: 3,
} as const;

export type PowerName = keyof typeof POWER_COSTS;

/** Undos per game. The others are limited only by what you can pay. */
export const MAX_UNDOS = 3;

/**
 * Rows a revive clears, from the bottom up, before it starts trying harder.
 *
 * A revive has to actually save the game. Dealing a fresh hand alone would not:
 * a game ends because nothing in the hand fits, and on a nearly full board the
 * next hand very often does not fit either. Clearing space is the only version
 * that always works, and the bottom rows are the ones a player has usually
 * given up on.
 */
export const REVIVE_ROWS = 2;

/**
 * How many of the three pieces a revive must leave playable.
 *
 * One would technically be a game, but a single forced move that ends the run
 * again is not a revive — it is the same loss with an advert in front of it.
 * Two means a choice, which is the least a player can be given back.
 */
export const REVIVE_MIN_PLAYABLE = 2;

/** Draws attempted per board before more rows are cleared. */
const REVIVE_DEAL_ATTEMPTS = 24;

/**
 * Revives per game.
 *
 * Uncapped, a player with patience could take one score to any number they
 * liked, and the leaderboards would stop meaning anything. Three is a cap, not
 * a law of the game — it is one constant.
 */
export const MAX_REVIVES = 3;

export type GameAction =
  /** No tag is a placement, so every transcript written before powers is one. */
  | ({ t?: 'place' } & Move)
  | { t: 'undo' }
  | { t: 'reroll' }
  | { t: 'rotate'; slot: number }
  /** Paid for with an advert rather than gems, so it costs no gems. */
  | { t: 'revive' };

export const actionKind = (action: GameAction): 'place' | PowerName | 'revive' =>
  't' in action && action.t ? action.t : 'place';

/** What a run of actions costs in gems. */
export function gemCost(actions: readonly GameAction[]): number {
  return actions.reduce((total, action) => {
    const kind = actionKind(action);
    // A revive is bought with an advert, so it adds nothing to the gem bill.
    if (kind === 'place' || kind === 'revive') return total;
    return total + POWER_COSTS[kind];
  }, 0);
}

/** What one spin of the wheel costs. Gems have no other source. */
export const WHEEL_COST_COINS = 10_000;

/** Spins an advert can buy in a day, on top of the free one. */
export const MAX_AD_SPINS_PER_DAY = 3;

/** How a spin was paid for. */
export type SpinSource = 'free' | 'ad' | 'coins';

/**
 * The wheel, as whole percentage points. Ordered as it is drawn, smallest
 * prize first, so the rare one sits at the end where a player looks for it.
 */
export const WHEEL_SEGMENTS = [
  { gems: 1, weight: 25 },
  { gems: 2, weight: 25 },
  { gems: 3, weight: 25 },
  { gems: 10, weight: 24 },
  { gems: 50, weight: 1 },
] as const;

export const WHEEL_TOTAL_WEIGHT = WHEEL_SEGMENTS.reduce((sum, s) => sum + s.weight, 0);

/**
 * Which segment a roll lands on. `roll` is 0..WHEEL_TOTAL_WEIGHT-1.
 *
 * Kept pure and separate from where the randomness comes from, so the payout
 * table can be tested exactly instead of sampled and hoped over.
 */
export function wheelSegment(roll: number): (typeof WHEEL_SEGMENTS)[number] {
  const bounded = Math.min(
    WHEEL_TOTAL_WEIGHT - 1,
    Math.max(0, Math.floor(Number.isFinite(roll) ? roll : 0)),
  );
  let seen = 0;
  for (const segment of WHEEL_SEGMENTS) {
    seen += segment.weight;
    if (bounded < seen) return segment;
  }
  return WHEEL_SEGMENTS[WHEEL_SEGMENTS.length - 1];
}

/**
 * A game in progress, with just enough behind it to undo.
 *
 * Only the state before each of the last few placements is kept, because that
 * is the only thing an undo ever returns to. Keeping every intermediate state
 * instead would grow with each rotation bought and could still evict the
 * placement an undo needed — a player who rotates four times would push it out
 * of a fixed-length history.
 */
export interface Session {
  state: GameState;
  /** Oldest first, one per recent placement, at most MAX_UNDOS of them. */
  checkpoints: GameState[];
  undosUsed: number;
  revivesUsed: number;
}

export function newSession(seed?: number): Session {
  return { state: newGame(seed), checkpoints: [], undosUsed: 0, revivesUsed: 0 };
}

export function sessionFrom(state: GameState, undosUsed = 0): Session {
  return { state, checkpoints: [], undosUsed, revivesUsed: 0 };
}

/** A revive is only offered on a game that has actually ended. */
export function canRevive(session: Session): boolean {
  return session.state.over && session.revivesUsed < MAX_REVIVES;
}

export const revivesLeft = (session: Session) =>
  Math.max(0, MAX_REVIVES - session.revivesUsed);

/** Undo needs a placement to reverse, an unfinished game, and a spare use. */
export function canUndo(session: Session): boolean {
  return (
    session.undosUsed < MAX_UNDOS &&
    session.checkpoints.length > 0 &&
    !session.state.over
  );
}

export const undosLeft = (session: Session) => Math.max(0, MAX_UNDOS - session.undosUsed);

function rerolled(state: GameState): GameState {
  const dealt = dealHand(state.rng, state.board);
  const hand = [...state.hand];
  for (let i = 0; i < HAND_SIZE; i++) hand[i] = dealt.hand[i];
  const next: GameState = { ...state, hand, rng: dealt.rng };
  next.over = isGameOver(next);
  return next;
}

function rotated(state: GameState, slot: number): GameState | null {
  const held = state.hand[slot];
  if (!held) return null;
  const hand = [...state.hand];
  hand[slot] = { ...held, pieceId: rotatedPieceId(held.pieceId) };
  const next: GameState = { ...state, hand };
  next.over = isGameOver(next);
  return next;
}

function playableCount(hand: ReadonlyArray<HandSlot | null>, board: Board): number {
  return hand.filter((slot) => slot && hasAnyPlacement(board, getPiece(slot.pieceId))).length;
}

/** A hand with at least `wanted` pieces that fit, or null if none was drawn. */
function dealAtLeast(rng: number, board: Board, wanted: number) {
  let draw = dealHand(rng, board, false);
  for (let attempt = 0; attempt < REVIVE_DEAL_ATTEMPTS; attempt++) {
    if (playableCount(draw.hand, board) >= wanted) return draw;
    draw = dealHand(draw.rng, board, false);
  }
  return null;
}

/**
 * Clear space and deal three pieces, at least two of which fit.
 *
 * Two rows is where it starts, not where it stops: on a board jammed enough
 * that no draw leaves two playable pieces, another row comes off and it tries
 * again. An empty board fits everything, so this always finds an answer — the
 * guarantee is kept by clearing more, never by promising less.
 *
 * Deterministic in the state it is given, which is what lets the server replay
 * a revived game rather than take the client's word for the board it landed on.
 */
function revived(state: GameState): GameState | null {
  for (let rows = REVIVE_ROWS; rows <= SIZE; rows++) {
    const board = cloneBoard(state.board);
    board.fill(0, (SIZE - rows) * SIZE, SIZE * SIZE);

    const dealt = dealAtLeast(state.rng, board, REVIVE_MIN_PLAYABLE);
    if (!dealt) continue;

    const next: GameState = {
      ...state,
      board,
      hand: dealt.hand.slice(),
      rng: dealt.rng,
      // A revive breaks the chain: the run of clears did not continue through it.
      streak: 0,
      over: false,
    };
    next.over = isGameOver(next);
    if (!next.over) return next;
  }
  return null;
}

export type ActionResult =
  | { ok: true; session: Session; events: GameEvent[] }
  | { ok: false; reason: string };

export function applyAction(session: Session, action: GameAction): ActionResult {
  const { state } = session;

  switch (actionKind(action)) {
    case 'place': {
      const result = applyMove(state, action as Move);
      if (!result.ok) return { ok: false, reason: result.reason };
      // The board being left behind is what an undo comes back to.
      const checkpoints = [...session.checkpoints, state].slice(-MAX_UNDOS);
      return {
        ok: true,
        session: { ...session, state: result.result.state, checkpoints },
        events: result.result.events,
      };
    }

    case 'undo': {
      if (session.undosUsed >= MAX_UNDOS) return { ok: false, reason: 'no-undos-left' };
      if (state.over) return { ok: false, reason: 'game-over' };
      if (session.checkpoints.length === 0) return { ok: false, reason: 'nothing-to-undo' };

      // Anything bought since that placement goes back with it: it was bought
      // for a board that is being taken away.
      const checkpoints = [...session.checkpoints];
      const restored = checkpoints.pop()!;
      return {
        ok: true,
        session: {
          state: restored,
          checkpoints,
          undosUsed: session.undosUsed + 1,
          revivesUsed: session.revivesUsed,
        },
        events: [],
      };
    }

    case 'reroll':
      return {
        ok: true,
        session: { ...session, state: rerolled(state) },
        events: [],
      };

    case 'revive': {
      if (!state.over) return { ok: false, reason: 'not-over' };
      if (session.revivesUsed >= MAX_REVIVES) return { ok: false, reason: 'no-revives-left' };
      const next = revived(state);
      // Unreachable in practice — an empty board would fit anything — but a
      // revive that cannot deliver its promise refuses rather than half-keeps it.
      if (!next) return { ok: false, reason: 'still-over' };
      return {
        ok: true,
        // The old board is gone, so there is nothing left to undo back to.
        session: {
          state: next,
          checkpoints: [],
          undosUsed: session.undosUsed,
          revivesUsed: session.revivesUsed + 1,
        },
        events: [],
      };
    }

    case 'rotate': {
      const { slot } = action as { slot: number };
      const next = Number.isInteger(slot) && slot >= 0 && slot < HAND_SIZE
        ? rotated(state, slot)
        : null;
      if (!next) return { ok: false, reason: 'empty-slot' };
      return { ok: true, session: { ...session, state: next }, events: [] };
    }
  }
}

/**
 * Replay a whole game, powers included. Throws on anything that could not have
 * happened, which is what the server relies on.
 */
export function replayActions(seed: number, actions: readonly GameAction[]): GameState {
  let session = newSession(seed);
  for (const action of actions) {
    const result = applyAction(session, action);
    if (!result.ok) throw new Error(`Illegal action in replay: ${result.reason}`);
    session = result.session;
  }
  return session.state;
}
