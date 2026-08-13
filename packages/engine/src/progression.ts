/** The game modes that participate in shared progression. */
export type GameMode = 'classic' | 'duo';

export const PROGRESSION = {
  SURVIVAL_STEP_MOVES: 25,
  SURVIVAL_STEP: 0.25,
  SURVIVAL_MAX_MULTIPLIER: 2,
  WEEK_MS: 7 * 24 * 60 * 60 * 1000,
} as const;

export interface CoinReward {
  /** Sanitised, whole-number game score used for the award. */
  score: number;
  /** Sanitised number of completed placements used for the multiplier. */
  moveCount: number;
  /** Every score point is worth one coin before the survival bonus. */
  baseCoins: number;
  multiplier: number;
  bonusCoins: number;
  totalCoins: number;
}

export interface WeeklyWindow {
  /** The UTC date of the Monday that begins this week. */
  key: string;
  /** Inclusive UTC epoch-millisecond boundary. */
  start: number;
  /** Exclusive UTC epoch-millisecond boundary. */
  end: number;
}

export interface FriendProfile {
  friendCode: string;
  name: string;
}

/** @deprecated Prefer FriendProfile. */
export type FriendView = FriendProfile;

export interface ProgressProfile {
  clientId: string;
  friendCode: string;
  name: string;
  coins: number;
  gamesPlayed: number;
  friends: FriendProfile[];
}

export type LeaderboardScope = 'global' | 'friends';

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
  moveCount: number;
  mode: GameMode;
  achievedAt: number;
  isYou: boolean;
  isFriend: boolean;
}

export interface LeaderboardBoard {
  entries: LeaderboardEntry[];
  /** Rank across the whole board, which can be past the visible entries. */
  selfRank: number | null;
}

/**
 * Both windows travel together: the screen shows all time above this week, and
 * asking for them separately would mean two round trips to draw one screen.
 */
export interface LeaderboardView {
  scope: LeaderboardScope;
  week: WeeklyWindow;
  allTime: LeaderboardBoard;
  weekly: LeaderboardBoard;
}

/** Storage window for a ranked score. All-time records never expire. */
export type LeaderboardWindow = 'alltime' | (string & {});

export interface ClaimResult {
  /** False when an already-processed game is returned idempotently. */
  awarded: boolean;
  reward: CoinReward;
  /** True when this result set a new personal best for the current week. */
  weeklyBest: boolean;
  profile: ProgressProfile;
}

function nonNegativeWhole(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

/**
 * Returns the survival multiplier earned for completed placements.
 * It rises by 0.25 every 25 moves and reaches its 2x cap at 100 moves.
 */
export function survivalMultiplier(moveCount: number): number {
  const moves = nonNegativeWhole(moveCount);
  const completedSteps = Math.floor(moves / PROGRESSION.SURVIVAL_STEP_MOVES);
  return Math.min(
    PROGRESSION.SURVIVAL_MAX_MULTIPLIER,
    1 + completedSteps * PROGRESSION.SURVIVAL_STEP,
  );
}

/** Convert a completed game's score into its deterministic coin award. */
export function coinReward(score: number, moveCount: number): CoinReward {
  const safeScore = nonNegativeWhole(score);
  const safeMoveCount = nonNegativeWhole(moveCount);
  const multiplier = survivalMultiplier(safeMoveCount);
  const totalCoins = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(safeScore * multiplier));

  return {
    score: safeScore,
    moveCount: safeMoveCount,
    baseCoins: safeScore,
    multiplier,
    bonusCoins: totalCoins - safeScore,
    totalCoins,
  };
}

/** Resolve the Monday-to-Monday UTC window containing the supplied instant. */
export function weekWindow(now: number | Date = Date.now()): WeeklyWindow {
  const timestamp = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(timestamp)) throw new RangeError('Week timestamp must be finite');

  const date = new Date(timestamp);
  const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const start = utcMidnight - daysSinceMonday * 24 * 60 * 60 * 1000;

  return {
    key: new Date(start).toISOString().slice(0, 10),
    start,
    end: start + PROGRESSION.WEEK_MS,
  };
}

/** Alias kept for callers that read more naturally as "the current week". */
export const currentWeek = weekWindow;
