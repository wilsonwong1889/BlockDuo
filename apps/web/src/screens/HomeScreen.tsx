import { useState } from 'react';
import { unlockAudio } from '../audio/sfx';
import { AdSlot } from '../components/AdSlot';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SettingsPanel } from '../components/SettingsPanel';
import { updateAppSettings } from '../preferences';
import { useProgress } from '../progress/ProgressContext';
import {
  loadAppSettings,
  loadBest,
  loadClassicGame,
  type AppSettings,
} from '../storage';

interface Props {
  onClassic: () => void;
  onNewClassic: () => void;
  onRanked: () => void;
  onNewRanked: () => void;
  onProfile: () => void;
  onWheel: () => void;
  onDuo: () => void;
  onSocial: () => void;
}

export function HomeScreen({
  onClassic,
  onNewClassic,
  onRanked,
  onNewRanked,
  onDuo,
  onSocial,
  onProfile,
  onWheel,
}: Props) {
  const [settings, setSettings] = useState(loadAppSettings);
  const [panel, setPanel] = useState<'settings' | 'new-game' | null>(null);
  const { profile } = useProgress();

  // Read once on mount, not on every render: loadClassicGame parses a whole
  // board, and opening either panel would pay for it again. Navigating swaps
  // this screen out entirely, so coming back from a game remounts it with fresh
  // values — there is no stale copy to keep in step.
  const [initial] = useState(() => ({
    best: loadBest(),
    game: loadClassicGame(),
    ranked: loadClassicGame('ranked'),
  }));
  const { best, game: savedGame, ranked: savedRanked } = initial;
  const hasSavedProgress = !!savedGame && savedGame.state.moveCount > 0;
  const hasRankedProgress = !!savedRanked && savedRanked.state.moveCount > 0;

  const changeSettings = (next: AppSettings) => {
    setSettings(next);
    updateAppSettings(next);
  };

  const startClassic = () => {
    unlockAudio();
    onClassic();
  };

  const startDuo = () => {
    unlockAudio();
    onDuo();
  };

  const startNewClassic = () => {
    if (hasSavedProgress) setPanel('new-game');
    else onNewClassic();
  };

  const startRanked = () => {
    unlockAudio();
    if (hasRankedProgress) onRanked();
    else onNewRanked();
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
        {hasSavedProgress ? (
          <>
            <button className="btn primary big" onClick={startClassic}>
              Continue Classic
              <span className="btn-sub">
                Score {savedGame.state.score.toLocaleString()} · {savedGame.state.moveCount} pieces
              </span>
            </button>
            <button className="btn" onClick={startNewClassic}>
              New Classic game
            </button>
          </>
        ) : (
          <button className="btn primary big" onClick={startNewClassic}>
            Play Classic
          </button>
        )}
        <button className="btn big ranked-btn" onClick={startRanked}>
          {hasRankedProgress ? 'Continue Ranked' : 'Ranked Classic'}
          <span className="btn-sub">
            {hasRankedProgress
              ? `Score ${savedRanked.state.score.toLocaleString()} · ${savedRanked.state.moveCount} pieces`
              : 'No powers · this is the leaderboard'}
          </span>
        </button>
        <button className="btn big" onClick={startDuo}>
          Play duo
          <span className="btn-sub">Two players, one board, live</span>
        </button>
      </div>

      {best > 0 && <p className="home-best">Best {best.toLocaleString()}</p>}

      <div className="home-tools" aria-label="More options">
        <button className="link-btn" onClick={onProfile}>
          Your profile
        </button>
        <span aria-hidden>·</span>
        <button className="link-btn" onClick={onWheel}>
          Wheel
          {/* A free spin nobody notices is a free spin nobody takes. */}
          {profile?.freeSpinAvailable && <span className="free-dot" aria-label="free spin ready" />}
        </button>
        <span aria-hidden>·</span>
        <button className="link-btn" onClick={() => setPanel('settings')}>
          Settings
        </button>
        <span aria-hidden>·</span>
        {/* Reachable from the game itself, which is what an advert network and
            a player both expect — and a plain link, so a crawler sees it. */}
        <a className="link-btn" href="/privacy.html">
          Privacy
        </a>
      </div>

      {/* Menus and result screens only. An advert next to the board would be
          tapped by accident mid-drag, which Google counts as invalid traffic. */}
      <AdSlot slot={import.meta.env.VITE_ADSENSE_SLOT_HOME ?? ''} />

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

      {panel === 'settings' && (
        <SettingsPanel
          settings={settings}
          onChange={changeSettings}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'new-game' && (
        <ConfirmDialog
          title="Start a new game?"
          message="Your saved Classic board and score will be replaced."
          confirmLabel="Start new game"
          danger
          onConfirm={onNewClassic}
          onCancel={() => setPanel(null)}
        />
      )}
    </div>
  );
}
