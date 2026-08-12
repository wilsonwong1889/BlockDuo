import {
  applyClears,
  emptyBoard,
  findClears,
  fits,
  hasAnyPlacement,
  isEmpty,
  place,
} from './board.js';
import { dealHand, HAND_SIZE } from './deal.js';
import { getPiece, hasPiece } from './pieces.js';
import { randomSeed } from './rng.js';
import { clearScore, SCORING, streakMultiplier } from './scoring.js';
import type { ApplyResult, GameEvent, GameState, Move } from './types.js';

export function newGame(seed: number = randomSeed()): GameState {
  const board = emptyBoard();
  const { hand, rng } = dealHand(seed, board);
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
