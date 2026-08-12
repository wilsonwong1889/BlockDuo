import { decodeState, encodeState, type GameState, type WireGameState } from '@blokduo/engine';

/**
 * Local persistence. Deliberately tolerant: a corrupt or outdated value should
 * cost the player their saved game at worst, never a white screen, so every read
 * is wrapped and falls back to a sane default.
 */

const KEYS = {
  best: 'blokduo.best',
  muted: 'blokduo.muted',
  saved: 'blokduo.saved.v1',
  name: 'blokduo.name',
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing, or the quota is full. Not worth interrupting play over.
  }
}

export const loadBest = () => read<number>(KEYS.best, 0);
export const saveBest = (score: number) => write(KEYS.best, score);

export const loadMuted = () => read<boolean>(KEYS.muted, false);
export const saveMuted = (muted: boolean) => write(KEYS.muted, muted);

export const loadName = () => read<string>(KEYS.name, '');
export const saveName = (name: string) => write(KEYS.name, name);

/** Persist the in-progress classic game so a refresh or a backgrounded tab does not lose it. */
export function saveGame(state: GameState | null) {
  if (!state || state.over) {
    try {
      localStorage.removeItem(KEYS.saved);
    } catch {
      /* ignore */
    }
    return;
  }
  write(KEYS.saved, encodeState(state));
}

export function loadGame(): GameState | null {
  const wire = read<WireGameState | null>(KEYS.saved, null);
  if (!wire) return null;
  try {
    const state = decodeState(wire);
    return state.over ? null : state;
  } catch {
    return null;
  }
}
