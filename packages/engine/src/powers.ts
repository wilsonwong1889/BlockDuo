import { dealHand, HAND_SIZE } from './deal.js';
import { applyMove, isGameOver, newGame } from './game.js';
import { rotatedPieceId } from './pieces.js';
import type { GameEvent, GameState, Move } from './types.js';

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


export type GameAction =
  /** No tag is a placement, so every transcript written before powers is one. */
  | ({ t?: 'place' } & Move)
  | { t: 'undo' }
  | { t: 'reroll' }
  | { t: 'rotate'; slot: number };

export const actionKind = (action: GameAction): 'place' | PowerName =>
  't' in action && action.t ? action.t : 'place';

/** What a run of actions costs in gems. */
export function gemCost(actions: readonly GameAction[]): number {
  return actions.reduce((total, action) => {
    const kind = actionKind(action);
    return kind === 'place' ? total : total + POWER_COSTS[kind];
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
}

export function newSession(seed?: number): Session {
  return { state: newGame(seed), checkpoints: [], undosUsed: 0 };
}

export function sessionFrom(state: GameState, undosUsed = 0): Session {
  return { state, checkpoints: [], undosUsed };
}

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
