/** 0 = empty, 1..7 = one of the seven block colours. */
export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Row-major 8x8 grid, index = row * 8 + col. */
export type Board = Uint8Array;

export interface Piece {
  id: string;
  /** [row, col] offsets, normalised so the minimum row and column are both 0. */
  cells: ReadonlyArray<readonly [number, number]>;
  /** Bounding box. */
  w: number;
  h: number;
  /** Relative frequency in the deal bag. */
  weight: number;
}

/** A piece sitting in the tray, with the colour it will paint onto the board. */
export interface HandSlot {
  pieceId: string;
  color: Exclude<Cell, 0>;
}

export interface GameState {
  board: Board;
  /** Always length 3. A null slot has already been placed. */
  hand: (HandSlot | null)[];
  score: number;
  /** Consecutive placements that cleared at least one line. */
  streak: number;
  /** Highest streak reached this game, for the end screen. */
  bestStreak: number;
  linesCleared: number;
  moveCount: number;
  /** The seed the game started from — replay a game from (seed, moves). */
  seed: number;
  /** Current PRNG state. Advanced only by dealing. */
  rng: number;
  over: boolean;
}

export interface Move {
  slot: number;
  row: number;
  col: number;
}

export type GameEvent =
  | { type: 'placed'; slot: number; row: number; col: number; cells: number; points: number }
  | { type: 'cleared'; rows: number[]; cols: number[]; cellIndices: number[]; points: number; multiplier: number }
  | { type: 'streak'; streak: number }
  | { type: 'perfect'; points: number }
  | { type: 'refill' }
  | { type: 'gameover'; score: number };

export interface MoveResult {
  state: GameState;
  events: GameEvent[];
}

/** Thrown-free result type: an illegal move returns ok:false and leaves state untouched. */
export type ApplyResult =
  | { ok: true; result: MoveResult }
  | { ok: false; reason: 'empty-slot' | 'no-such-slot' | 'out-of-bounds' | 'occupied' | 'game-over' };
