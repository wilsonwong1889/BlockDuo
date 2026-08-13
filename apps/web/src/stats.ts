export interface GameStatistics {
  gamesPlayed: number;
  highestCombo: number;
  totalLines: number;
  totalScore: number;
  duoWins: number;
  recordedGameIds: string[];
}

export interface CompletedGame {
  id: string;
  score: number;
  highestCombo: number;
  lines: number;
  duoWin?: boolean;
}

export const EMPTY_STATISTICS: GameStatistics = {
  gamesPlayed: 0,
  highestCombo: 0,
  totalLines: 0,
  totalScore: 0,
  duoWins: 0,
  recordedGameIds: [],
};

/** Add one finished game exactly once, even if React or a reconnect reports it again. */
export function addCompletedGame(
  statistics: GameStatistics,
  game: CompletedGame,
): GameStatistics {
  if (!game.id || statistics.recordedGameIds.includes(game.id)) return statistics;

  return {
    gamesPlayed: statistics.gamesPlayed + 1,
    highestCombo: Math.max(statistics.highestCombo, Math.max(0, game.highestCombo)),
    totalLines: statistics.totalLines + Math.max(0, game.lines),
    totalScore: statistics.totalScore + Math.max(0, game.score),
    duoWins: statistics.duoWins + (game.duoWin ? 1 : 0),
    // Finished Classic games cannot be reopened and Duo rooms expire, so this
    // bounded history is ample protection without growing local storage forever.
    recordedGameIds: [...statistics.recordedGameIds, game.id].slice(-500),
  };
}

export function averageScore(statistics: GameStatistics): number {
  return statistics.gamesPlayed > 0
    ? Math.round(statistics.totalScore / statistics.gamesPlayed)
    : 0;
}
