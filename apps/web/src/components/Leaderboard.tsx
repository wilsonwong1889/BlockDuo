import type { LeaderboardBoard, LeaderboardEntry } from '@blokduo/engine';

interface Props {
  title: string;
  subtitle: string;
  board: LeaderboardBoard | null;
  /** Shown when the board has loaded and has nothing in it. */
  emptyText: string;
  loading: boolean;
}

/** Gold, silver, bronze. Anything below is a plain number. */
const MEDALS = ['gold', 'silver', 'bronze'] as const;
const PLACES = ['1st', '2nd', '3rd'] as const;

const medalOf = (rank: number) => (rank <= MEDALS.length ? MEDALS[rank - 1] : null);

export function Leaderboard({ title, subtitle, board, emptyText, loading }: Props) {
  return (
    <section className="board-section">
      <div className="leaderboard-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {board?.selfRank && <span className="rank-pill">You #{board.selfRank}</span>}
      </div>

      <div className="leaderboard-list" aria-live="polite">
        {loading && <p className="empty-board">Loading scores…</p>}
        {board && board.entries.length === 0 && <p className="empty-board">{emptyText}</p>}
        {board?.entries.map((entry) => (
          <Row entry={entry} key={`${entry.rank}-${entry.name}`} />
        ))}

        {/* Ranked past the visible cut: show the row, not just the number. */}
        {board?.self && (
          <>
            <div className="leader-gap" aria-hidden>
              ⋯
            </div>
            <Row entry={board.self} />
          </>
        )}
      </div>
    </section>
  );
}

function Row({ entry }: { entry: LeaderboardEntry }) {
  const medal = medalOf(entry.rank);
  return (
    <div className={`leader-row${entry.isYou ? ' you' : ''}${medal ? ` ${medal}` : ''}`}>
      <span
        className={`leader-rank${medal ? ` medal ${medal}` : ''}`}
        aria-label={medal ? `${PLACES[entry.rank - 1]}, ${medal}` : `Rank ${entry.rank}`}
      >
        {entry.rank}
      </span>
      <span className="leader-name">
        {entry.name}
        {entry.isYou && <small>You</small>}
      </span>
      <span className="leader-pieces">{entry.moveCount} pieces</span>
      <strong className="leader-score">{entry.score.toLocaleString()}</strong>
    </div>
  );
}
