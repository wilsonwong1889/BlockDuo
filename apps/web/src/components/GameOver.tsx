import type { CoinReward } from '@blokduo/engine';
import { Modal } from './Modal';

interface Stat {
  label: string;
  value: string | number;
}

interface Props {
  title?: string;
  score: number;
  best?: number;
  stats: Stat[];
  primaryLabel?: string;
  onPrimary: () => void;
  onHome: () => void;
  note?: string;
  reward?: CoinReward | null;
  rewardStatus?: 'pending' | 'awarded' | 'queued' | 'unavailable' | null;
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
  reward,
  rewardStatus,
}: Props) {
  const isRecord = best !== undefined && score > 0 && score >= best;

  return (
    // Not dismissible: a finished game has no "cancel" to go back to, so Escape
    // does nothing and Android's back button falls through to leaving for Home.
    <Modal title={title} dismissible={false}>
      {isRecord && <div className="record-badge">New best!</div>}

      <div className="final-score">{score.toLocaleString()}</div>
      {best !== undefined && <div className="final-best">Best {best.toLocaleString()}</div>}

      {note && <p className="panel-note">{note}</p>}

      {reward && rewardStatus !== 'unavailable' && (
        <div className="reward-card" aria-live="polite">
          <div className="reward-total">+{reward.totalCoins.toLocaleString()} coins</div>
          <div className="reward-detail">
            {reward.baseCoins.toLocaleString()} base
            {reward.multiplier > 1 && (
              <> · ×{reward.multiplier.toFixed(2).replace(/0$/, '')} survival</>
            )}
          </div>
          {rewardStatus === 'pending' && <div className="reward-status">Saving reward…</div>}
          {rewardStatus === 'queued' && (
            <div className="reward-status">Saved offline — syncs when you reconnect</div>
          )}
        </div>
      )}

      {rewardStatus === 'unavailable' && (
        <p className="reward-status">This older saved game has no verifiable move history.</p>
      )}

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
    </Modal>
  );
}
