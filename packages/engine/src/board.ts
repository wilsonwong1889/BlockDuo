import type { Board, Cell, Piece } from './types.js';

export const SIZE = 8;
export const CELLS = SIZE * SIZE;

export const idx = (row: number, col: number): number => row * SIZE + col;
export const rowOf = (i: number): number => Math.floor(i / SIZE);
export const colOf = (i: number): number => i % SIZE;

export function emptyBoard(): Board {
  return new Uint8Array(CELLS);
}

export function cloneBoard(board: Board): Board {
  return new Uint8Array(board);
}

export function cellAt(board: Board, row: number, col: number): Cell {
  return board[idx(row, col)] as Cell;
}

/** Can `piece` be placed with its normalised origin at (row, col)? */
export function fits(board: Board, piece: Piece, row: number, col: number): boolean {
  if (row < 0 || col < 0 || row + piece.h > SIZE || col + piece.w > SIZE) return false;
  for (const [dr, dc] of piece.cells) {
    if (board[idx(row + dr, col + dc)] !== 0) return false;
  }
  return true;
}

/** Every legal origin for `piece` on `board`. */
export function legalAnchors(board: Board, piece: Piece): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const maxRow = SIZE - piece.h;
  const maxCol = SIZE - piece.w;
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= maxCol; c++) {
      if (fits(board, piece, r, c)) out.push([r, c]);
    }
  }
  return out;
}

export function hasAnyPlacement(board: Board, piece: Piece): boolean {
  const maxRow = SIZE - piece.h;
  const maxCol = SIZE - piece.w;
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= maxCol; c++) {
      if (fits(board, piece, r, c)) return true;
    }
  }
  return false;
}

/**
 * Paint `piece` onto a copy of `board`. Caller must have checked `fits` first —
 * this is the hot path and does not re-validate.
 */
export function place(
  board: Board,
  piece: Piece,
  row: number,
  col: number,
  color: Exclude<Cell, 0>,
): Board {
  const next = cloneBoard(board);
  for (const [dr, dc] of piece.cells) {
    next[idx(row + dr, col + dc)] = color;
  }
  return next;
}

export interface Clears {
  rows: number[];
  cols: number[];
  /** Every board index that clears, de-duplicated across row/column overlaps. */
  cellIndices: number[];
}

export function findClears(board: Board): Clears {
  const rows: number[] = [];
  const cols: number[] = [];

  for (let r = 0; r < SIZE; r++) {
    let full = true;
    for (let c = 0; c < SIZE; c++) {
      if (board[idx(r, c)] === 0) {
        full = false;
        break;
      }
    }
    if (full) rows.push(r);
  }

  for (let c = 0; c < SIZE; c++) {
    let full = true;
    for (let r = 0; r < SIZE; r++) {
      if (board[idx(r, c)] === 0) {
        full = false;
        break;
      }
    }
    if (full) cols.push(c);
  }

  // A cell sitting where a full row crosses a full column belongs to both, but
  // must only be counted (and animated) once.
  const seen = new Set<number>();
  for (const r of rows) for (let c = 0; c < SIZE; c++) seen.add(idx(r, c));
  for (const c of cols) for (let r = 0; r < SIZE; r++) seen.add(idx(r, c));

  return { rows, cols, cellIndices: [...seen].sort((a, b) => a - b) };
}

/**
 * Rows and columns clear simultaneously, and nothing falls afterwards — there is
 * no gravity in this genre. That is what makes leftover holes permanent and the
 * board state the real opponent.
 */
export function applyClears(board: Board, clears: Clears): Board {
  if (clears.cellIndices.length === 0) return board;
  const next = cloneBoard(board);
  for (const i of clears.cellIndices) next[i] = 0;
  return next;
}

export function isEmpty(board: Board): boolean {
  for (let i = 0; i < CELLS; i++) if (board[i] !== 0) return false;
  return true;
}

export function filledCount(board: Board): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (board[i] !== 0) n++;
  return n;
}

/** Debug/test helper: 8 lines of '.' and '#'. */
export function boardToString(board: Board): string {
  const lines: string[] = [];
  for (let r = 0; r < SIZE; r++) {
    let line = '';
    for (let c = 0; c < SIZE; c++) line += board[idx(r, c)] === 0 ? '.' : '#';
    lines.push(line);
  }
  return lines.join('\n');
}

/** Inverse of boardToString, for building test fixtures readably. */
export function boardFromString(s: string, color: Exclude<Cell, 0> = 1): Board {
  const lines = s.trim().split('\n').map((l) => l.trim());
  if (lines.length !== SIZE) throw new Error(`Expected ${SIZE} rows, got ${lines.length}`);
  const board = emptyBoard();
  lines.forEach((line, r) => {
    if (line.length !== SIZE) throw new Error(`Row ${r} has ${line.length} cells`);
    [...line].forEach((ch, c) => {
      board[idx(r, c)] = ch === '.' ? 0 : color;
    });
  });
  return board;
}
