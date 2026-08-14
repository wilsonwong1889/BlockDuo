import { useState } from 'react';
import {
  WHEEL_COST_COINS,
  WHEEL_SEGMENTS,
  WHEEL_TOTAL_WEIGHT,
  POWER_COSTS,
} from '@blokduo/engine';
import { useProgress } from '../progress/ProgressContext';

interface Props {
  onHome: () => void;
}

export function WheelScreen({ onHome }: Props) {
  const { profile, spinWheel } = useProgress();
  const [spinning, setSpinning] = useState(false);
  const [won, setWon] = useState<number | null>(null);
  const [wasFree, setWasFree] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coins = profile?.coins ?? 0;
  const freeSpin = profile?.freeSpinAvailable ?? false;
  // A free spin is always affordable, which is the whole point of it.
  const affordable = freeSpin || coins >= WHEEL_COST_COINS;

  const spin = async () => {
    if (spinning || !affordable) return;
    setSpinning(true);
    setWon(null);
    setError(null);
    try {
      const result = await spinWheel();
      setWasFree(result.free);
      // Held back so the wheel is seen to turn before it says what it landed
      // on; the server already decided, this is only the telling.
      window.setTimeout(() => {
        setWon(result.gems);
        setSpinning(false);
      }, 1400);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The spin did not go through');
      setSpinning(false);
    }
  };

  return (
    <div className="screen social-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onHome} aria-label="Back to menu">
          ‹
        </button>
        <span className="topbar-title">Wheel</span>
        <span className="gem-pill">◈ {profile?.gems?.toLocaleString() ?? '—'}</span>
      </header>

      <section className="social-card wheel-card">
        <div className={`wheel${spinning ? ' spinning' : ''}`} aria-hidden>
          <div className="wheel-face">◈</div>
        </div>

        <div className="wheel-result" role="status" aria-live="polite">
          {spinning && 'Spinning…'}
          {!spinning && won !== null &&
            `You won ${won} gem${won === 1 ? '' : 's'}${wasFree ? ' — free spin' : ''}`}
          {!spinning && won === null && !error && 'Spin for gems'}
          {error && <span className="error">{error}</span>}
        </div>

        <button
          className={`btn primary big${freeSpin ? ' free' : ''}`}
          onClick={spin}
          disabled={spinning || !affordable}
        >
          {spinning
            ? 'Spinning…'
            : freeSpin
              ? 'Free spin'
              : `Spin for ${WHEEL_COST_COINS.toLocaleString()} coins`}
          <span className="btn-sub">
            {freeSpin
              ? 'One a day, on the house'
              : `You have ${coins.toLocaleString()} coin${coins === 1 ? '' : 's'}`}
          </span>
        </button>
        {!freeSpin && !affordable && (
          <p className="panel-note">
            {(WHEEL_COST_COINS - coins).toLocaleString()} more coins, or come back tomorrow for a
            free spin.
          </p>
        )}
        {!freeSpin && affordable && (
          <p className="panel-note">Today&rsquo;s free spin is used. The next one is tomorrow.</p>
        )}
      </section>

      <section className="leaderboard-card">
        <div className="leaderboard-heading">
          <div>
            <h2>What it pays</h2>
            <p>Every spin, the same odds.</p>
          </div>
        </div>
        <div className="odds-list">
          {WHEEL_SEGMENTS.map((segment) => (
            <div className="odds-row" key={segment.gems}>
              <span className="odds-prize">◈ {segment.gems}</span>
              <span className="odds-bar" aria-hidden>
                <span style={{ width: `${(segment.weight / WHEEL_TOTAL_WEIGHT) * 100}%` }} />
              </span>
              <strong>{Math.round((segment.weight / WHEEL_TOTAL_WEIGHT) * 100)}%</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="leaderboard-card">
        <div className="leaderboard-heading">
          <div>
            <h2>What gems buy</h2>
            <p>In Classic, while you play.</p>
          </div>
        </div>
        <div className="odds-list">
          <div className="odds-row">
            <span className="odds-prize">◈ {POWER_COSTS.undo}</span>
            <span className="power-explain">Take the last piece back — three times a game</span>
          </div>
          <div className="odds-row">
            <span className="odds-prize">◈ {POWER_COSTS.rotate}</span>
            <span className="power-explain">Turn a held piece a quarter turn</span>
          </div>
          <div className="odds-row">
            <span className="odds-prize">◈ {POWER_COSTS.reroll}</span>
            <span className="power-explain">Throw the tray away and deal three more</span>
          </div>
        </div>
      </section>
    </div>
  );
}
