import {
  DEFAULT_DUO_MODE,
  decodeState,
  encodeState,
  DEFAULT_CLASSIC_MODE,
  isDuoMode,
  replayActions,
  type ClassicMode,
  type DuoMode,
  type GameAction,
  type GameState,
  type Move,
  type WireGameState,
} from '@blokduo/engine';

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
  savedRanked: 'blokduo.saved.ranked.v1',
  name: 'blokduo.name',
  clientId: 'blokduo.clientId',
  progressIdentity: 'blokduo.progressIdentity.v1',
  pendingClassic: 'blokduo.pendingClassic.v1',
  settings: 'blokduo.settings.v1',
  duoMode: 'blokduo.duoMode.v1',
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
  /** Placements and any powers used, in the order they happened. */
  moves: GameAction[];
  /** Whether it was a ranked run, so a retry claims it as the same game. */
  ranked?: boolean;
}

export interface SavedClassicGame {
  state: GameState;
  moves: GameAction[];
  /** Old saves did not include a transcript and cannot be server-verified. */
  rewardEligible: boolean;
}

/**
 * Whether this transcript really produces this game.
 *
 * Counting entries against moveCount was enough while every entry was a
 * placement. Powers break that in both directions — a rotation adds an entry
 * without a placement, an undo removes a placement without removing entries —
 * so the only honest check is to replay it and see.
 */
function transcriptMatches(state: GameState, moves: GameAction[]): boolean {
  try {
    const replayed = replayActions(state.seed, moves);
    return replayed.moveCount === state.moveCount && replayed.score === state.score;
  } catch {
    return false;
  }
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

/** The lobby reopens on the mode you last created a room in. */
export function loadDuoMode(): DuoMode {
  const saved = read<unknown>(KEYS.duoMode, null);
  return isDuoMode(saved) ? saved : DEFAULT_DUO_MODE;
}

export const saveDuoMode = (mode: DuoMode) => write(KEYS.duoMode, mode);

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
/**
 * Casual and Ranked keep separate saves.
 *
 * They are different games with different rules, so finishing one must not
 * throw the other away — a ranked run left half-played is still there when the
 * casual game it was interrupted for ends.
 */
const slotFor = (mode: ClassicMode) => (mode === 'ranked' ? KEYS.savedRanked : KEYS.savedV2);

export function saveGame(
  state: GameState | null,
  moves: GameAction[] = [],
  mode: ClassicMode = DEFAULT_CLASSIC_MODE,
) {
  const slot = slotFor(mode);
  if (!state || state.over) {
    remove(slot);
    if (mode === DEFAULT_CLASSIC_MODE) remove(KEYS.saved);
    return;
  }
  write(slot, { state: encodeState(state), moves });
  // A successful write makes the legacy save redundant. Removing it also
  // prevents a stale v1 game from resurfacing after this game is cleared.
  if (mode === DEFAULT_CLASSIC_MODE) remove(KEYS.saved);
}

export function loadGame(): GameState | null {
  return loadClassicGame()?.state ?? null;
}

export function loadClassicGame(
  mode: ClassicMode = DEFAULT_CLASSIC_MODE,
): SavedClassicGame | null {
  const modern = read<{ state: WireGameState; moves: GameAction[] } | null>(slotFor(mode), null);
  if (modern) {
    try {
      const state = decodeState(modern.state);
      const moves = Array.isArray(modern.moves) ? modern.moves : [];
      if (state.over) return null;
      return { state, moves, rewardEligible: transcriptMatches(state, moves) };
    } catch {
      return null;
    }
  }

  // The legacy slot only ever held casual games.
  const wire = mode === DEFAULT_CLASSIC_MODE ? read<WireGameState | null>(KEYS.saved, null) : null;
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


