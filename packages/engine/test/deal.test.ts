import { describe, expect, it } from 'vitest';
import { boardFromString, emptyBoard } from '../src/board.js';
import {
  HAND_SIZE,
  OPENING_HAND_CANDIDATES,
  dealHand,
  dealOpeningHand,
  handIsPlayable,
  openingLinePotential,
} from '../src/deal.js';
import { hasPiece } from '../src/pieces.js';

/** Every cell filled except one isolated hole at (7,7) — only a 1x1 can be played. */
const ALMOST_FULL = `
########
########
########
########
########
########
########
#######.
`;

/** Two cells free in a row: a 1x1 or a 1x2 fits, nothing else does. */
const NEAR_FULL = `
########
########
########
########
########
########
########
######..
`;

const HALF_FULL = `
########
########
########
########
........
........
........
........
`;

describe('dealHand', () => {
  it('always deals three known pieces in valid colours', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { hand } = dealHand(seed, emptyBoard());
      expect(hand).toHaveLength(HAND_SIZE);
      for (const slot of hand) {
        expect(hasPiece(slot.pieceId)).toBe(true);
        expect(slot.color).toBeGreaterThanOrEqual(1);
        expect(slot.color).toBeLessThanOrEqual(7);
      }
    }
  });

  it('is deterministic for a given seed and board', () => {
    const a = dealHand(12345, emptyBoard());
    const b = dealHand(12345, emptyBoard());
    expect(a).toEqual(b);
  });

  it('advances the PRNG so successive deals are not identical', () => {
    let rng = 999;
    const hands: string[] = [];
    for (let i = 0; i < 20; i++) {
      const res = dealHand(rng, emptyBoard());
      expect(res.rng).not.toBe(rng);
      rng = res.rng;
      hands.push(res.hand.map((s) => s.pieceId).join('|'));
    }
    expect(new Set(hands).size).toBeGreaterThan(1);
  });

  it('always deals a playable hand while the board still has real room', () => {
    const board = boardFromString(HALF_FULL);
    for (let seed = 0; seed < 300; seed++) {
      const { hand } = dealHand(seed, board);
      expect(handIsPlayable(hand, board), `seed ${seed}`).toBe(true);
    }
  });

  it('rescues the large majority of dead hands on a near-full board', () => {
    const board = boardFromString(NEAR_FULL);
    const rate = (assisted: boolean) => {
      let ok = 0;
      for (let seed = 0; seed < 500; seed++) {
        if (handIsPlayable(dealHand(seed, board, assisted).hand, board)) ok++;
      }
      return ok / 500;
    };
    expect(rate(false)).toBeLessThan(0.4);
    expect(rate(true)).toBeGreaterThan(0.9);
  });

  /**
   * The nudge is best-effort, not a guarantee — and deliberately so. On a board
   * one cell from full, ending the game is the correct outcome, so assisted
   * dealing helps but does not rescue every hand.
   */
  it('still lets a one-cell-from-full board end the game', () => {
    const board = boardFromString(ALMOST_FULL);
    let playable = 0;
    for (let seed = 0; seed < 500; seed++) {
      if (handIsPlayable(dealHand(seed, board).hand, board)) playable++;
    }
    expect(playable / 500).toBeGreaterThan(0.3); // much better than the ~5% unassisted
    expect(playable / 500).toBeLessThan(0.95); // but the game can still end
  });

  it('gives up rather than looping forever on a genuinely dead board', () => {
    const full = boardFromString('########\n'.repeat(8).trim());
    const { hand } = dealHand(7, full);
    expect(hand).toHaveLength(HAND_SIZE);
    expect(handIsPlayable(hand, full)).toBe(false);
  });
});

describe('deal weighting', () => {
  it('deals the rare 3x3 far less often than a common domino', () => {
    let big = 0;
    let domino = 0;
    let rng = 1;
    for (let i = 0; i < 3000; i++) {
      const res = dealHand(rng, emptyBoard());
      rng = res.rng;
      for (const slot of res.hand) {
        if (slot.pieceId === '3x3') big++;
        if (slot.pieceId === '1x2') domino++;
      }
    }
    expect(big).toBeGreaterThan(0);
    expect(domino).toBeGreaterThan(big * 3);
  });
});

describe('opening hand assist', () => {
  it('is deterministic and consumes a fixed set of ordinary candidate deals', () => {
    const board = emptyBoard();
    const assisted = dealOpeningHand(12345, board);
    expect(assisted).toEqual(dealOpeningHand(12345, board));

    let rng = 12345;
    for (let i = 0; i < OPENING_HAND_CANDIDATES; i++) {
      rng = dealHand(rng, board).rng;
    }
    expect(assisted.rng).toBe(rng);
  });

  it('materially improves early line setup across many seeds', () => {
    const board = emptyBoard();
    let ordinaryPotential = 0;
    let assistedPotential = 0;

    for (let seed = 0; seed < 1_000; seed++) {
      ordinaryPotential += openingLinePotential(dealHand(seed, board).hand);
      assistedPotential += openingLinePotential(dealOpeningHand(seed, board).hand);
    }

    // The small candidate choice raises average one-line coverage by about 16%
    // without changing the piece bag or guaranteeing a particular hand.
    expect(assistedPotential).toBeGreaterThan(ordinaryPotential * 1.12);
  });

  it('remains a nudge rather than guaranteeing a complete line', () => {
    const result = dealOpeningHand(23, emptyBoard());
    expect(openingLinePotential(result.hand)).toBeLessThan(8);
  });

  it('does not alter the legacy deal path used by saved games', () => {
    expect(dealHand(7, emptyBoard())).toEqual({
      hand: [
        { pieceId: '1x1', color: 1 },
        { pieceId: 'BC-180', color: 5 },
        { pieceId: 'L-90', color: 3 },
      ],
      rng: -1895507003,
    });
  });
});
