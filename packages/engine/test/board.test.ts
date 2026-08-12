import { describe, expect, it } from 'vitest';
import {
  applyClears,
  boardFromString,
  boardToString,
  emptyBoard,
  filledCount,
  findClears,
  fits,
  hasAnyPlacement,
  isEmpty,
  legalAnchors,
  place,
} from '../src/board.js';
import { getPiece } from '../src/pieces.js';

const FULL_ROW_0 = `
########
........
........
........
........
........
........
........
`;

const FULL_COL_0 = `
#.......
#.......
#.......
#.......
#.......
#.......
#.......
#.......
`;

const CROSS = `
########
#.......
#.......
#.......
#.......
#.......
#.......
#.......
`;

describe('fits', () => {
  it('accepts an in-bounds placement on an empty board', () => {
    expect(fits(emptyBoard(), getPiece('3x3'), 0, 0)).toBe(true);
    expect(fits(emptyBoard(), getPiece('3x3'), 5, 5)).toBe(true);
  });

  it('rejects placements that run off the board', () => {
    const b = emptyBoard();
    expect(fits(b, getPiece('3x3'), 6, 5)).toBe(false);
    expect(fits(b, getPiece('1x5'), 0, 4)).toBe(false);
    expect(fits(b, getPiece('5x1'), 4, 0)).toBe(false);
    expect(fits(b, getPiece('1x1'), -1, 0)).toBe(false);
    expect(fits(b, getPiece('1x1'), 0, -1)).toBe(false);
  });

  it('rejects placements that overlap an occupied cell', () => {
    const b = boardFromString(FULL_ROW_0);
    expect(fits(b, getPiece('1x1'), 0, 3)).toBe(false);
    expect(fits(b, getPiece('1x1'), 1, 3)).toBe(true);
    expect(fits(b, getPiece('2x2'), 0, 0)).toBe(false);
    expect(fits(b, getPiece('2x2'), 1, 0)).toBe(true);
  });
});

describe('legalAnchors', () => {
  it('finds every anchor for a 1x1 on an empty board', () => {
    expect(legalAnchors(emptyBoard(), getPiece('1x1'))).toHaveLength(64);
  });

  it('respects the bounding box for large pieces', () => {
    expect(legalAnchors(emptyBoard(), getPiece('3x3'))).toHaveLength(36);
    expect(legalAnchors(emptyBoard(), getPiece('1x5'))).toHaveLength(8 * 4);
  });

  it('returns nothing when the board is full', () => {
    const full = boardFromString('########\n'.repeat(8).trim());
    expect(legalAnchors(full, getPiece('1x1'))).toHaveLength(0);
    expect(hasAnyPlacement(full, getPiece('1x1'))).toBe(false);
  });
});

describe('place', () => {
  it('does not mutate the board it was given', () => {
    const before = emptyBoard();
    const after = place(before, getPiece('2x2'), 0, 0, 3);
    expect(filledCount(before)).toBe(0);
    expect(filledCount(after)).toBe(4);
  });

  it('paints exactly the piece cells in the given colour', () => {
    const b = place(emptyBoard(), getPiece('C3-a'), 2, 2, 5);
    expect(boardToString(b)).toBe(
      ['........', '........', '..#.....', '..##....', '........', '........', '........', '........'].join('\n'),
    );
    expect(b[2 * 8 + 2]).toBe(5);
  });
});

describe('findClears', () => {
  it('finds a full row', () => {
    const c = findClears(boardFromString(FULL_ROW_0));
    expect(c.rows).toEqual([0]);
    expect(c.cols).toEqual([]);
    expect(c.cellIndices).toHaveLength(8);
  });

  it('finds a full column', () => {
    const c = findClears(boardFromString(FULL_COL_0));
    expect(c.rows).toEqual([]);
    expect(c.cols).toEqual([0]);
    expect(c.cellIndices).toHaveLength(8);
  });

  it('counts the intersection cell only once when a row and column both clear', () => {
    const c = findClears(boardFromString(CROSS));
    expect(c.rows).toEqual([0]);
    expect(c.cols).toEqual([0]);
    // 8 + 8 cells minus the shared corner.
    expect(c.cellIndices).toHaveLength(15);
  });

  it('finds nothing on an empty board', () => {
    const c = findClears(emptyBoard());
    expect(c.rows).toEqual([]);
    expect(c.cols).toEqual([]);
    expect(c.cellIndices).toEqual([]);
  });
});

describe('applyClears', () => {
  it('empties exactly the cleared cells and leaves the rest standing', () => {
    const board = boardFromString(CROSS);
    const cleared = applyClears(board, findClears(board));
    expect(isEmpty(cleared)).toBe(true);
  });

  it('does not make anything fall — there is no gravity', () => {
    const board = boardFromString(`
      ########
      ..#.....
      ..#.....
      ........
      ........
      ........
      ........
      ........
    `);
    const cleared = applyClears(board, findClears(board));
    expect(boardToString(cleared)).toBe(
      ['........', '..#.....', '..#.....', '........', '........', '........', '........', '........'].join('\n'),
    );
  });

  it('returns the same board instance when nothing clears', () => {
    const board = emptyBoard();
    expect(applyClears(board, findClears(board))).toBe(board);
  });
});

describe('board string helpers', () => {
  it('round-trips', () => {
    expect(boardToString(boardFromString(CROSS))).toBe(CROSS.trim());
  });

  it('rejects malformed fixtures', () => {
    expect(() => boardFromString('###')).toThrow(/Expected 8 rows/);
    expect(() => boardFromString('###\n'.repeat(8).trim())).toThrow(/has 3 cells/);
  });
});
