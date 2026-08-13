import {
  applyClears,
  emptyBoard,
  findClears,
  fits,
  hasAnyPlacement,
  isEmpty,
  place,
} from './board.js';
import { dealHand, dealOpeningHand, HAND_SIZE } from './deal.js';
import { getPiece, hasPiece } from './pieces.js';
import { randomSeed } from './rng.js';
import { clearScore, SCORING, streakMultiplier } from './scoring.js';
import type { ApplyResult, GameEvent, GameState, Move } from './types.js';

/**
 * The seed also carries the rules version used to create the opening hand.
 *
 * Seeds 0..2^32-1 are the original rules and must never change: saved games and
 * server-verified Classic transcripts contain only their seed and moves. The
 * next 32-bit range opts into the setup-friendly opening while retaining a
 * normal 32-bit PRNG state underneath.
 */
export const GAME_SEED_RANGE = 0x1_0000_0000;
export const LEGACY_GAME_RULES = 0;
export const OPENING_ASSIST_GAME_RULES = 1;
export const CURRENT_GAME_RULES = OPENING_ASSIST_GAME_RULES;
export const MAX_GAME_SEED = GAME_SEED_RANGE * (CURRENT_GAME_RULES + 1) - 1;

export function gameSeed(rngSeed: number, rules = CURRENT_GAME_RULES): number {
  if (!Number.isInteger(rngSeed) || rngSeed < 0 || rngSeed >= GAME_SEED_RANGE) {
    throw new RangeError('PRNG seed must be an unsigned 32-bit integer');
  }
  if (!Number.isInteger(rules) || rules < LEGACY_GAME_RULES || rules > CURRENT_GAME_RULES) {
    throw new RangeError('Unsupported game rules version');
  }
  return rules * GAME_SEED_RANGE + rngSeed;
}

export function gameRules(seed: number): number {
  return Math.floor(seed / GAME_SEED_RANGE);
}

export function isSupportedGameSeed(seed: number): boolean {
  return Number.isSafeInteger(seed) && seed >= 0 && seed <= MAX_GAME_SEED;
}

export function newGame(seed: number = gameSeed(randomSeed())): GameState {
  if (!isSupportedGameSeed(seed)) throw new RangeError('Unsupported game seed');
  const board = emptyBoard();
  const rules = gameRules(seed);
  const initialRng = seed - rules * GAME_SEED_RANGE;
  const { hand, rng } =
    rules === OPENING_ASSIST_GAME_RULES
      ? dealOpeningHand(initialRng, board)
      : dealHand(initialRng, board);
  return {
    board,
    hand,
    score: 0,
    streak: 0,
    bestStreak: 0,
    linesCleared: 0,
    moveCount: 0,
    seed,
    rng,
    over: false,
  };
}

/** No remaining tray piece fits anywhere. Checked after every placement. */
export function isGameOver(state: GameState): boolean {
  return !state.hand.some(
    (slot) => slot !== null && hasAnyPlacement(state.board, getPiece(slot.pieceId)),
  );
}

/**
 * The one place the rules live. Pure: no timers, no DOM, and no randomness
 * beyond the seeded PRNG carried in `state`. The browser and the multiplayer
 * Durable Object both call this, which is why they can never disagree about
 * what a legal move is or what it scored.
 */
export function applyMove(state: GameState, move: Move): ApplyResult {
  if (state.over) return { ok: false, reason: 'game-over' };

  if (!Number.isInteger(move.slot) || move.slot < 0 || move.slot >= HAND_SIZE) {
    return { ok: false, reason: 'no-such-slot' };
  }
  const slot = state.hand[move.slot];
  if (!slot || !hasPiece(slot.pieceId)) return { ok: false, reason: 'empty-slot' };

  const piece = getPiece(slot.pieceId);
  if (
    !Number.isInteger(move.row) ||
    !Number.isInteger(move.col) ||
    move.row < 0 ||
    move.col < 0 ||
    move.row + piece.h > 8 ||
    move.col + piece.w > 8
  ) {
    return { ok: false, reason: 'out-of-bounds' };
  }
  if (!fits(state.board, piece, move.row, move.col)) {
    return { ok: false, reason: 'occupied' };
  }

  const events: GameEvent[] = [];
  const streakBefore = state.streak;

  // 1. Paint the piece.
  let board = place(state.board, piece, move.row, move.col, slot.color);
  const placePoints = piece.cells.length * SCORING.POINTS_PER_CELL;
  let score = state.score + placePoints;
  events.push({
    type: 'placed',
    slot: move.slot,
    row: move.row,
    col: move.col,
    cells: piece.cells.length,
    points: placePoints,
  });

  // 2. Clear full rows and columns simultaneously. Nothing falls afterwards.
  const clears = findClears(board);
  const lines = clears.rows.length + clears.cols.length;
  if (lines > 0) {
    board = applyClears(board, clears);
    const points = clearScore(lines, streakBefore);
    score += points;
    events.push({
      type: 'cleared',
      rows: clears.rows,
      cols: clears.cols,
      cellIndices: clears.cellIndices,
      points,
      multiplier: streakMultiplier(streakBefore),
    });
  }

  const streak = lines > 0 ? state.streak + 1 : 0;
  if (lines > 0) events.push({ type: 'streak', streak });

  // 3. Perfect clear: the board is completely empty again.
  if (lines > 0 && isEmpty(board)) {
    score += SCORING.PERFECT_CLEAR;
    events.push({ type: 'perfect', points: SCORING.PERFECT_CLEAR });
  }

  // 4. Consume the slot; refill only once all three have been used.
  const hand = [...state.hand];
  hand[move.slot] = null;
  let rng = state.rng;
  // Counted rather than tested with `every(s => s === null)`: TS infers a type
  // predicate from that callback and narrows `hand` itself to null[], which then
  // rejects the refill assignment below.
  const remaining = hand.filter((s) => s !== null).length;
  if (remaining === 0) {
    const dealt = dealHand(rng, board);
    for (let i = 0; i < HAND_SIZE; i++) hand[i] = dealt.hand[i];
    rng = dealt.rng;
    events.push({ type: 'refill' });
  }

  const next: GameState = {
    board,
    hand,
    score,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    linesCleared: state.linesCleared + lines,
    moveCount: state.moveCount + 1,
    seed: state.seed,
    rng,
    over: false,
  };

  next.over = isGameOver(next);
  if (next.over) events.push({ type: 'gameover', score: next.score });

  return { ok: true, result: { state: next, events } };
}

/** Replay a game from its seed and move list — used by tests and for debugging. */
export function replay(seed: number, moves: Move[]): GameState {
  let state = newGame(seed);
  for (const move of moves) {
    const res = applyMove(state, move);
    if (!res.ok) throw new Error(`Illegal move in replay: ${res.reason}`);
    state = res.result.state;
  }
  return state;
}
