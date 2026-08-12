import type { Piece } from './types.js';

/**
 * The piece catalog.
 *
 * Pieces cannot be rotated in-game (this is true of the genre and it's what makes
 * board management the skill), so every orientation is stored as its own piece.
 * 14 shape families expand to 37 fixed-orientation pieces.
 *
 * `weight` is relative deal frequency. Small, flexible pieces are common; the 3x3
 * is deliberately rare because it single-handedly ends games.
 */

type Def = [id: string, cells: Array<[number, number]>, weight: number];

const DEFS: Def[] = [
  // --- singles, bars and rectangles -----------------------------------------
  ['1x1', [[0, 0]], 2],

  ['1x2', [[0, 0], [0, 1]], 6],
  ['2x1', [[0, 0], [1, 0]], 6],

  ['1x3', [[0, 0], [0, 1], [0, 2]], 6],
  ['3x1', [[0, 0], [1, 0], [2, 0]], 6],

  ['1x4', [[0, 0], [0, 1], [0, 2], [0, 3]], 4],
  ['4x1', [[0, 0], [1, 0], [2, 0], [3, 0]], 4],

  ['1x5', [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], 3],
  ['5x1', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 3],

  ['2x2', [[0, 0], [0, 1], [1, 0], [1, 1]], 6],
  ['2x3', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], 3],
  ['3x2', [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]], 3],
  ['3x3', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], 1],

  // --- corner triominoes (4 orientations) -----------------------------------
  ['C3-a', [[0, 0], [1, 0], [1, 1]], 5],
  ['C3-b', [[0, 0], [0, 1], [1, 0]], 5],
  ['C3-c', [[0, 0], [0, 1], [1, 1]], 5],
  ['C3-d', [[0, 1], [1, 0], [1, 1]], 5],

  // --- L tetromino (4) ------------------------------------------------------
  ['L-0', [[0, 0], [1, 0], [2, 0], [2, 1]], 4],
  ['L-90', [[0, 0], [0, 1], [0, 2], [1, 0]], 4],
  ['L-180', [[0, 0], [0, 1], [1, 1], [2, 1]], 4],
  ['L-270', [[0, 2], [1, 0], [1, 1], [1, 2]], 4],

  // --- J tetromino (4) ------------------------------------------------------
  ['J-0', [[0, 1], [1, 1], [2, 0], [2, 1]], 4],
  ['J-90', [[0, 0], [1, 0], [1, 1], [1, 2]], 4],
  ['J-180', [[0, 0], [0, 1], [1, 0], [2, 0]], 4],
  ['J-270', [[0, 0], [0, 1], [0, 2], [1, 2]], 4],

  // --- T tetromino (4) ------------------------------------------------------
  ['T-0', [[0, 0], [0, 1], [0, 2], [1, 1]], 4],
  ['T-90', [[0, 1], [1, 0], [1, 1], [2, 1]], 4],
  ['T-180', [[0, 1], [1, 0], [1, 1], [1, 2]], 4],
  ['T-270', [[0, 0], [1, 0], [1, 1], [2, 0]], 4],

  // --- S and Z tetrominoes (2 each) -----------------------------------------
  ['S-0', [[0, 1], [0, 2], [1, 0], [1, 1]], 4],
  ['S-90', [[0, 0], [1, 0], [1, 1], [2, 1]], 4],
  ['Z-0', [[0, 0], [0, 1], [1, 1], [1, 2]], 4],
  ['Z-90', [[0, 1], [1, 0], [1, 1], [2, 0]], 4],

  // --- big corners: 5 cells spanning a 3x3 box (4) --------------------------
  ['BC-0', [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], 3],
  ['BC-90', [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], 3],
  ['BC-180', [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]], 3],
  ['BC-270', [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]], 3],
];

function build([id, cells, weight]: Def): Piece {
  const minRow = Math.min(...cells.map((c) => c[0]));
  const minCol = Math.min(...cells.map((c) => c[1]));
  const normalised = cells.map(([r, c]) => [r - minRow, c - minCol] as const);
  return {
    id,
    cells: normalised,
    h: Math.max(...normalised.map((c) => c[0])) + 1,
    w: Math.max(...normalised.map((c) => c[1])) + 1,
    weight,
  };
}

export const PIECES: readonly Piece[] = DEFS.map(build);

const BY_ID = new Map(PIECES.map((p) => [p.id, p]));

export function getPiece(id: string): Piece {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Unknown piece id: ${id}`);
  return p;
}

export function hasPiece(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * Cumulative weight table, precomputed once so dealing is a single binary-free
 * scan rather than a rebuild per draw.
 */
export const TOTAL_WEIGHT = PIECES.reduce((sum, p) => sum + p.weight, 0);

const CUMULATIVE: number[] = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const p of PIECES) {
    acc += p.weight;
    out.push(acc);
  }
  return out;
})();

/** Pick a piece from the weighted bag given a uniform roll in [0, TOTAL_WEIGHT). */
export function pieceForRoll(roll: number): Piece {
  for (let i = 0; i < CUMULATIVE.length; i++) {
    if (roll < CUMULATIVE[i]) return PIECES[i];
  }
  return PIECES[PIECES.length - 1];
}
