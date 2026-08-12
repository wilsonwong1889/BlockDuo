import type { Clears } from './board.js';
import type { WireGameState } from './serde.js';

/**
 * The duo wire protocol.
 *
 * It lives in the engine package because the browser and the Durable Object are
 * the only two things that speak it, and both already depend on the engine. One
 * definition means a protocol change cannot compile on one side and not the
 * other.
 */

/** How long a player has to place before their turn passes to their partner. */
export const TURN_MS = 45_000;

/** A dropped connection holds its seat this long before the game continues without it. */
export const RECONNECT_GRACE_MS = 60_000;

/** Rooms with no activity for this long are cleaned up. */
export const ROOM_IDLE_MS = 30 * 60_000;

/** Time out this many turns in a row and the room closes. */
export const MAX_CONSECUTIVE_TIMEOUTS = 3;

/** Codes avoid O/0 and I/1 — they are read aloud and typed by hand. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export type Seat = 0 | 1;

export interface PlayerView {
  name: string;
  connected: boolean;
  ready: boolean;
  /** Contribution stats, for the end-of-game split. */
  placements: number;
  cellsPlaced: number;
  linesCleared: number;
}

export interface RoomSnapshot {
  code: string;
  phase: 'waiting' | 'playing' | 'over';
  game: WireGameState;
  turn: Seat;
  /** A null seat is empty — either nobody has joined yet, or a partner left. */
  players: (PlayerView | null)[];
  /** Epoch ms when the current turn expires, or null when the clock is paused. */
  deadline: number | null;
  /** The server's clock, so clients can correct for skew instead of trusting their own. */
  serverNow: number;
  /** Increments on every applied move; lets a client spot a snapshot it has already seen. */
  version: number;
}

export type ClientMessage =
  | { t: 'place'; seq: number; slot: number; row: number; col: number }
  | { t: 'rematch' }
  | { t: 'emote'; id: string }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'welcome'; seat: Seat; snapshot: RoomSnapshot }
  | { t: 'state'; snapshot: RoomSnapshot }
  | {
      t: 'applied';
      by: Seat;
      slot: number;
      row: number;
      col: number;
      clears: Clears | null;
      scoreDelta: number;
      perfect: boolean;
      snapshot: RoomSnapshot;
    }
  | { t: 'rejected'; seq: number; reason: string; snapshot: RoomSnapshot }
  | { t: 'timeout'; seat: Seat; snapshot: RoomSnapshot }
  | { t: 'over'; snapshot: RoomSnapshot }
  | { t: 'emote'; by: Seat; id: string }
  | { t: 'pong'; serverNow: number }
  | { t: 'error'; code: string; message: string };

export function randomRoomCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return out;
}

export function isValidRoomCode(code: string): boolean {
  return (
    code.length === CODE_LENGTH && [...code].every((ch) => CODE_ALPHABET.includes(ch))
  );
}
