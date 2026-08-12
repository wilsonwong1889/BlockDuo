import { useState } from 'react';
import { isMuted, setMuted } from '../audio/sfx';
import { loadBest, saveMuted } from '../storage';

interface Props {
  onClassic: () => void;
  onDuo: () => void;
}

export function HomeScreen({ onClassic, onDuo }: Props) {
  const [muted, setMutedState] = useState(isMuted());
  const best = loadBest();

  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    saveMuted(next);
    setMutedState(next);
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

      <div className="home-actions">
        <button className="btn primary big" onClick={onClassic}>
          Play classic
        </button>
        <button className="btn big" onClick={onDuo}>
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
          <li>The game ends when none of your remaining pieces fit anywhere.</li>
        </ul>
      </details>
    </div>
  );
}
