interface Stat {
  label: string;
  value: string | number;
}

interface Props {
  title?: string;
  score: number;
  best: number;
  stats: Stat[];
  primaryLabel?: string;
  onPrimary: () => void;
  onHome: () => void;
  note?: string;
}

export function GameOver({
  title = 'No moves left',
  score,
  best,
  stats,
  primaryLabel = 'Play again',
  onPrimary,
  onHome,
  note,
}: Props) {
  const isRecord = score > 0 && score >= best;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="panel">
        <h2 className="panel-title">{title}</h2>

        {isRecord && <div className="record-badge">New best!</div>}

        <div className="final-score">{score.toLocaleString()}</div>
        <div className="final-best">Best {best.toLocaleString()}</div>

        {note && <p className="panel-note">{note}</p>}

        <div className="stat-grid">
          {stats.map((s) => (
            <div key={s.label} className="stat">
              <span className="stat-value">{s.value}</span>
              <span className="stat-label">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="panel-actions">
          <button className="btn primary" onClick={onPrimary} autoFocus>
            {primaryLabel}
          </button>
          <button className="btn" onClick={onHome}>
            Home
          </button>
        </div>
      </div>
    </div>
  );
}
