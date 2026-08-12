/**
 * Every scoring number in the game lives here.
 *
 * The original game's exact multiplier table has never been published, so these
 * are tuned to reproduce the *shape* of it: placing pieces is worth almost
 * nothing, clearing one line is worth a little, and multi-line clears on a hot
 * streak are worth an order of magnitude more. Retuning the game's feel should
 * only ever mean editing this file.
 */
export const SCORING = {
  /** Points for each cell of a placed piece. */
  POINTS_PER_CELL: 1,

  /** Base points per cleared line, before bonuses and multipliers. */
  LINE_BASE: 10,

  /**
   * Extra points for clearing several lines with one placement.
   * Index = number of lines cleared. Clearing 4 at once is worth far more than
   * four separate single clears — that asymmetry is the whole game.
   */
  MULTI_LINE_BONUS: [0, 0, 20, 60, 120, 200, 300, 420, 560] as const,

  /** Each consecutive clearing move adds this much to the multiplier. */
  STREAK_STEP: 0.5,

  /** Multiplier ceiling, so late-game streaks stay large but not absurd. */
  STREAK_MAX: 4.0,

  /** Wiping the board completely. Rare and worth chasing. */
  PERFECT_CLEAR: 300,
} as const;

/** Multiplier for a placement made with `streakBefore` consecutive clears behind it. */
export function streakMultiplier(streakBefore: number): number {
  return Math.min(1 + SCORING.STREAK_STEP * streakBefore, SCORING.STREAK_MAX);
}

/** Points awarded for clearing `lines` lines at the given streak. */
export function clearScore(lines: number, streakBefore: number): number {
  if (lines <= 0) return 0;
  const bonus =
    SCORING.MULTI_LINE_BONUS[Math.min(lines, SCORING.MULTI_LINE_BONUS.length - 1)];
  return Math.round((lines * SCORING.LINE_BASE + bonus) * streakMultiplier(streakBefore));
}
