import { hasAnyPlacement } from './board.js';
import { getPiece, pieceForRoll, TOTAL_WEIGHT } from './pieces.js';
import { nextInt } from './rng.js';
import type { Board, Cell, HandSlot } from './types.js';

export const HAND_SIZE = 3;
export const COLOR_COUNT = 7;

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
