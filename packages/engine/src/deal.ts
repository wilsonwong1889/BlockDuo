import { hasAnyPlacement } from './board.js';
import { getPiece, pieceForRoll, TOTAL_WEIGHT } from './pieces.js';
import { nextInt } from './rng.js';
import type { Board, Cell, HandSlot } from './types.js';

export const HAND_SIZE = 3;
export const COLOR_COUNT = 7;

/**
 * New games compare a few ordinary deals and keep the hand with the strongest
 * shared row/column setup. The candidate count is intentionally small: the
 * opening is friendlier, but the player still has to recognise and build the
 * line rather than being handed a guaranteed clear.
 */
export const OPENING_HAND_CANDIDATES = 4;

/**
 * If a fresh hand of three has no legal placement at all, re-roll it.
 *
 * Without this you can lose the instant a hand appears, through no decision of
 * your own, which feels arbitrary. With it, losses trace back to a move you
 * actually made earlier in the hand.
 *
 * This is deliberately best-effort rather than a guarantee. Forcing a fitting
 * piece into the hand would mean a near-full board could always be played on,
 * and games would stop ending. Measured success rate over 2000 seeds:
 *
 *   board state                    unassisted   assisted
 *   half full                          100%       100%
 *   near-full, two pieces still fit     16%        97%
 *   one empty cell, only a 1x1 fits      5%        57%
 *
 * So the nudge does its job everywhere that matters, and stops helping exactly
 * where the player has genuinely filled the board and the game should end.
 */
export const MAX_REROLLS = 20;

export interface DealResult {
  hand: HandSlot[];
  rng: number;
}

function drawSlot(rng: number): { slot: HandSlot; rng: number } {
  const pick = nextInt(rng, TOTAL_WEIGHT);
  const piece = pieceForRoll(pick.value);
  const col = nextInt(pick.state, COLOR_COUNT);
  return {
    slot: { pieceId: piece.id, color: (col.value + 1) as Exclude<Cell, 0> },
    rng: col.state,
  };
}

function drawHand(rng: number): DealResult {
  const hand: HandSlot[] = [];
  let state = rng;
  for (let i = 0; i < HAND_SIZE; i++) {
    const d = drawSlot(state);
    hand.push(d.slot);
    state = d.rng;
  }
  return { hand, rng: state };
}

export function handIsPlayable(hand: (HandSlot | null)[], board: Board): boolean {
  return hand.some((slot) => slot !== null && hasAnyPlacement(board, getPiece(slot.pieceId)));
}

/**
 * How many cells this hand can contribute toward one horizontal or vertical
 * line when each piece is oriented as dealt. This is only a setup heuristic: it
 * deliberately does not promise that the pieces can or will clear a line.
 */
export function openingLinePotential(hand: ReadonlyArray<HandSlot>): number {
  let horizontal = 0;
  let vertical = 0;

  for (const slot of hand) {
    const piece = getPiece(slot.pieceId);
    const rowCounts = new Array<number>(piece.h).fill(0);
    const colCounts = new Array<number>(piece.w).fill(0);
    for (const [row, col] of piece.cells) {
      rowCounts[row] += 1;
      colCounts[col] += 1;
    }
    horizontal += Math.max(...rowCounts);
    vertical += Math.max(...colCounts);
  }

  return Math.max(horizontal, vertical);
}

function openingHandScore(hand: ReadonlyArray<HandSlot>): number {
  // Line potential dominates. The small tie-breaker favours pieces that remain
  // easy to place around one another while the board is being established.
  const flexible = hand.reduce(
    (count, slot) => count + (getPiece(slot.pieceId).cells.length <= 4 ? 1 : 0),
    0,
  );
  return openingLinePotential(hand) * 10 + flexible;
}

/**
 * Deal a new hand of three. Deterministic given (rng, board): the re-roll loop
 * consumes PRNG draws, so the server and any replay land on the same hand.
 */
export function dealHand(rng: number, board: Board, assisted = true): DealResult {
  let result = drawHand(rng);
  if (!assisted) return result;

  for (let attempt = 0; attempt < MAX_REROLLS; attempt++) {
    if (handIsPlayable(result.hand, board)) return result;
    result = drawHand(result.rng);
  }
  return result;
}

/**
 * Pick a deterministic, setup-friendly opening from a small fixed set of normal
 * deals. All candidates are consumed from the PRNG even when the first wins, so
 * refills remain reproducible from the returned state.
 *
 * Kept separate from `dealHand`: old saved games and score transcripts must
 * retain their exact historical deal sequence.
 */
export function dealOpeningHand(rng: number, board: Board): DealResult {
  let candidate = dealHand(rng, board);
  let bestHand = candidate.hand;
  let bestScore = openingHandScore(bestHand);

  for (let attempt = 1; attempt < OPENING_HAND_CANDIDATES; attempt++) {
    candidate = dealHand(candidate.rng, board);
    const score = openingHandScore(candidate.hand);
    if (score > bestScore) {
      bestHand = candidate.hand;
      bestScore = score;
    }
  }

  return { hand: bestHand, rng: candidate.rng };
}
