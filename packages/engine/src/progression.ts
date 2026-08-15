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

/**
 * Lifetime totals for one player.
 *
 * Every number here is derived on the server — Classic from replaying the
 * transcript, Duo from the room's own authoritative state — so a profile can be
 * shown to other people without showing them something a client made up.
 */
export interface PlayerStats {
  gamesPlayed: number;
  classicGames: number;
  duoGames: number;
  /** Best single game, either mode. */
  bestScore: number;
  totalScore: number;
  totalLines: number;
  /** Longest clearing streak reached in any one game. */
  bestStreak: number;
  coins: number;
  /**
   * When their most recent game finished. Null for a player whose last game
   * predates this being recorded — nothing stored it, so it is unknown rather
   * than long ago.
   */
  lastPlayedAt: number | null;
}

export const EMPTY_PLAYER_STATS: PlayerStats = {
  gamesPlayed: 0,
  classicGames: 0,
  duoGames: 0,
  bestScore: 0,
  totalScore: 0,
  totalLines: 0,
  bestStreak: 0,
  coins: 0,
  lastPlayedAt: null,
};

/** What anyone may see about a player. Deliberately no identifiers to act with. */
export interface PublicProfile {
  friendCode: string;
  name: string;
  joinedAt: number;
  stats: PlayerStats;
}

export function averageGameScore(stats: PlayerStats): number {
  return stats.gamesPlayed > 0 ? Math.round(stats.totalScore / stats.gamesPlayed) : 0;
}

export interface ProgressProfile {
  clientId: string;
  friendCode: string;
  name: string;
  coins: number;
  /** Spent on powers, won only from the wheel. */
  gems: number;
  /** Whether today's free spin is still waiting. */
  freeSpinAvailable: boolean;
  /** Advert-bought spins still available today. */
  adSpinsLeft: number;
  /**
   * Wedges already struck off, in `WHEEL_WEDGES` order.
   *
   * Every spin removes the wedge it landed on, so the odds of the rare prize
   * climb until it is the only thing left. Kept on the server because a client
   * that could edit this could strike off everything but the sliver.
   */
  markedWedges: number[];
  gamesPlayed: number;
  friends: FriendProfile[];
}

export interface WheelResult {
  gems: number;
  /** True when the day's free spin paid for this one. */
  free: boolean;
  /** What actually paid for it. */
  source: 'free' | 'ad' | 'coins';
  /**
   * Which wedge it stopped on, in `WHEEL_WEDGES` order.
   *
   * The prize alone is not enough to animate with: a prize is spread over
   * several wedges, and struck wedges slide the result along, so the wheel has
   * to be told the exact one or it would stop somewhere that is not what was
   * paid.
   */
  wedge: number;
  /** True when that spin emptied the board and refilled it. */
  refilled: boolean;
  profile: ProgressProfile;
}

/**
 * The UTC day a moment falls in, as its date.
 *
 * UTC so the free spin arrives at the same instant for everyone rather than
 * rolling around the world, and so a player cannot find a second one by
 * changing their device's timezone.
 */
export function utcDayKey(now: number | Date = Date.now()): string {
  const timestamp = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(timestamp)) throw new RangeError('Day timestamp must be finite');
  return new Date(timestamp).toISOString().slice(0, 10);
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
  /**
   * The public codes behind this row, in the same order as the names. A Duo row
   * has two and so opens no single profile; a solo row has one.
   */
  friendCodes?: string[];
}

export interface LeaderboardBoard {
  entries: LeaderboardEntry[];
  /** Rank across the whole board, which can be past the visible entries. */
  selfRank: number | null;
  /**
   * Your own row when it falls outside `entries`, so a player ranked past the
   * cut still sees their score rather than only a number they cannot place.
   * Null when you are already in the visible list, or have no score at all.
   */
  self: LeaderboardEntry | null;
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
