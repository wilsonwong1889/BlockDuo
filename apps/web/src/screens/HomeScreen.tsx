import { useState } from 'react';
import { isMuted, setMuted, unlockAudio } from '../audio/sfx';
import { useProgress } from '../progress/ProgressContext';
import { loadBest, saveMuted } from '../storage';

interface Props {
  onClassic: () => void;
  onDuo: () => void;
  onSocial: () => void;
}

export function HomeScreen({ onClassic, onDuo, onSocial }: Props) {
  const [muted, setMutedState] = useState(isMuted());
  const { profile } = useProgress();
  const best = loadBest();

  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    if (!next) unlockAudio();
    saveMuted(next);
    setMutedState(next);
  };

  const startClassic = () => {
    unlockAudio();
    onClassic();
  };

  const startDuo = () => {
    unlockAudio();
    onDuo();
  };

  return (
    <div className="screen home">
      <div className="home-logo" aria-hidden>
        <span className="logo-block c1" />
        <span className="logo-block c4" />
        <span className="logo-block c6" />
        <span className="logo-block c3" />
      </div>

      <h1 className="home-title">
        BLOK<span className="accent">DUO</span>
      </h1>
      <p className="home-tagline">Fill rows and columns. Solo, or two-up on one board.</p>

      <button className="home-progress" onClick={onSocial}>
        <span>
          <strong>Weekly leaderboard</strong>
          <small>{profile?.friends.length ?? 0} friends · resets Monday</small>
        </span>
        <span className="coin-pill">◆ {profile?.coins.toLocaleString() ?? '—'}</span>
      </button>

      <div className="home-actions">
        <button className="btn primary big" onClick={startClassic}>
          Play classic
        </button>
        <button className="btn big" onClick={startDuo}>
          Play duo
          <span className="btn-sub">Two players, one board, live</span>
        </button>
      </div>

      {best > 0 && <p className="home-best">Best {best.toLocaleString()}</p>}

      <button className="link-btn" onClick={toggleSound}>
        Sound: {muted ? 'off' : 'on'}
      </button>

      <details className="how-to">
        <summary>How to play</summary>
        <ul>
          <li>Drag a piece onto the 8×8 board. Pieces cannot be rotated.</li>
          <li>Fill a whole row or column and it clears.</li>
          <li>Nothing falls after a clear — the holes you leave are permanent.</li>
          <li>Clear on consecutive turns to build a streak multiplier.</li>
          <li>You get three pieces at a time; a new set arrives when all three are used.</li>
          <li>New games begin with a hand chosen to make early line-building friendlier.</li>
          <li>The game ends when none of your remaining pieces fit anywhere.</li>
          <li>
            A finished score becomes coins 1:1, with +0.25× every 25 pieces survived (up to
            2×).
          </li>
          <li>Your best completed Classic game or Duo team game ranks until Monday UTC.</li>
        </ul>
      </details>
    </div>
  );
}
