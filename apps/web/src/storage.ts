import {
  decodeState,
  encodeState,
  type GameState,
  type Move,
  type WireGameState,
} from '@blokduo/engine';
import {
  addCompletedGame,
  type CompletedGame,
  type GameStatistics,
} from './stats';

/**
 * Local persistence. Deliberately tolerant: a corrupt or outdated value should
 * cost the player their saved game at worst, never a white screen, so every read
 * is wrapped and falls back to a sane default.
 */

const KEYS = {
  best: 'blokduo.best',
  muted: 'blokduo.muted',
  saved: 'blokduo.saved.v1',
  savedV2: 'blokduo.saved.v2',
  name: 'blokduo.name',
  clientId: 'blokduo.clientId',
  progressIdentity: 'blokduo.progressIdentity.v1',
  pendingClassic: 'blokduo.pendingClassic.v1',
  settings: 'blokduo.settings.v1',
  statistics: 'blokduo.statistics.v1',
} as const;

export interface AppSettings {
  sound: boolean;
  haptics: boolean;
  /** null follows the device; a boolean is a choice the player made. */
  reducedMotion: boolean | null;
  highContrast: boolean;
}

/**
 * An explicit choice wins over the device, in both directions. Someone who has
 * reduced motion on system-wide but wants the animations here has to be able to
 * say so, which is the case a bare media query cannot express.
 */
export function resolveReducedMotion(
  preference: boolean | null,
  systemPrefersReduce: boolean,
): boolean {
  return preference ?? systemPrefersReduce;
}

export interface ProgressIdentity {
  clientId: string;
  token: string;
}

export interface PendingClassicClaim {
  seed: number;
  moves: Move[];
}

export interface SavedClassicGame {
  state: GameState;
  moves: Move[];
  /** Old saves did not include a transcript and cannot be server-verified. */
  rewardEligible: boolean;
}

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

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage is best-effort; gameplay must continue even when it is blocked.
  }
}

export const loadBest = () => read<number>(KEYS.best, 0);
export const saveBest = (score: number) => write(KEYS.best, score);

export const loadMuted = () => read<boolean>(KEYS.muted, false);
export const saveMuted = (muted: boolean) => write(KEYS.muted, muted);

export function loadAppSettings(): AppSettings {
  const saved = read<Partial<AppSettings> | null>(KEYS.settings, null);
  return {
    sound: saved?.sound ?? !loadMuted(),
    haptics: saved?.haptics ?? true,
    reducedMotion: typeof saved?.reducedMotion === 'boolean' ? saved.reducedMotion : null,
    highContrast: saved?.highContrast ?? false,
  };
}

export function saveAppSettings(settings: AppSettings) {
  write(KEYS.settings, settings);
  // Keep the former sound preference in sync for compatibility with older builds.
  saveMuted(!settings.sound);
}

export const loadName = () => read<string>(KEYS.name, '');
export const saveName = (name: string) => write(KEYS.name, name);

/**
 * A stable per-device id. The server uses it to hand a reconnecting player back
 * their own seat, so a dropped connection returns to the same game instead of
 * being treated as a stranger asking to join.
 */
export function loadClientId(): string {
  const existing = read<string>(KEYS.clientId, '');
  if (existing) return existing;
  const fresh =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `c${Date.now()}${Math.random().toString(36).slice(2)}`;
  write(KEYS.clientId, fresh);
  return fresh;
}

export const loadProgressIdentity = () =>
  read<ProgressIdentity | null>(KEYS.progressIdentity, null);
export const saveProgressIdentity = (identity: ProgressIdentity) =>
  write(KEYS.progressIdentity, identity);
export const clearProgressIdentity = () => remove(KEYS.progressIdentity);

/** Persist the in-progress classic game so a refresh or a backgrounded tab does not lose it. */
export function saveGame(state: GameState | null, moves: Move[] = []) {
  if (!state || state.over) {
    remove(KEYS.saved);
    remove(KEYS.savedV2);
    return;
  }
  write(KEYS.savedV2, { state: encodeState(state), moves });
  // A successful v2 write makes the legacy save redundant. Removing it also
  // prevents a stale v1 game from resurfacing after this game is cleared.
  remove(KEYS.saved);
}

export function loadGame(): GameState | null {
  return loadClassicGame()?.state ?? null;
}

export function loadClassicGame(): SavedClassicGame | null {
  const modern = read<{ state: WireGameState; moves: Move[] } | null>(KEYS.savedV2, null);
  if (modern) {
    try {
      const state = decodeState(modern.state);
      const moves = Array.isArray(modern.moves) ? modern.moves : [];
      if (state.over) return null;
      return { state, moves, rewardEligible: state.moveCount === moves.length };
    } catch {
      return null;
    }
  }

  const wire = read<WireGameState | null>(KEYS.saved, null);
  if (!wire) return null;
  try {
    const state = decodeState(wire);
    return state.over ? null : { state, moves: [], rewardEligible: state.moveCount === 0 };
  } catch {
    return null;
  }
}


export const loadPendingClassic = () =>
  read<PendingClassicClaim[]>(KEYS.pendingClassic, []);

export function appendPendingClassic(
  pending: PendingClassicClaim[],
  claim: PendingClassicClaim,
): PendingClassicClaim[] {
  const fingerprint = JSON.stringify([claim.seed, claim.moves]);
  if (pending.some((item) => JSON.stringify([item.seed, item.moves]) === fingerprint)) {
    return pending;
  }
  return [...pending, claim];
}

export function queuePendingClassic(claim: PendingClassicClaim) {
  const pending = loadPendingClassic();
  const next = appendPendingClassic(pending, claim);
  if (next !== pending) write(KEYS.pendingClassic, next);
}

export function removePendingClassic(claim: PendingClassicClaim) {
  const fingerprint = JSON.stringify([claim.seed, claim.moves]);
  const remaining = loadPendingClassic().filter(
    (item) => JSON.stringify([item.seed, item.moves]) !== fingerprint,
  );
  if (remaining.length) write(KEYS.pendingClassic, remaining);
  else remove(KEYS.pendingClassic);
}

export function loadStatistics(): GameStatistics {
  const saved = read<Partial<GameStatistics> | null>(KEYS.statistics, null);
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  return {
    gamesPlayed: count(saved?.gamesPlayed),
    highestCombo: count(saved?.highestCombo),
    totalLines: count(saved?.totalLines),
    totalScore: count(saved?.totalScore),
    duoWins: count(saved?.duoWins),
    recordedGameIds: Array.isArray(saved?.recordedGameIds) ? saved.recordedGameIds : [],
  };
}

export function recordCompletedGame(game: CompletedGame): GameStatistics {
  const current = loadStatistics();
  const next = addCompletedGame(current, game);
  if (next !== current) write(KEYS.statistics, next);
  return next;
}
