import { useState } from 'react';
import { unlockAudio } from '../audio/sfx';
import { AdSlot } from '../components/AdSlot';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MovePrompt } from '../components/MovePrompt';
import { useProgress } from '../progress/ProgressContext';
import { loadBest, loadClassicGame } from '../storage';

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
  const [panel, setPanel] = useState<'new-game' | null>(null);
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

      {/* A free spin nobody notices is a free spin nobody takes, and a text
          link next to two others was not noticeable. */}
      <button
        className={`home-wheel${profile?.freeSpinAvailable ? ' ready' : ''}`}
        onClick={onWheel}
      >
        <span className="home-wheel-dial" aria-hidden />
        <span className="home-wheel-copy">
          <strong>Daily wheel</strong>
          <small>
            {profile?.freeSpinAvailable
              ? 'Free spin ready'
              : `${profile?.adSpinsLeft ?? 0} advert spin${(profile?.adSpinsLeft ?? 0) === 1 ? '' : 's'} left today`}
          </small>
        </span>
        <span className="gem-pill">◈ {profile?.gems?.toLocaleString() ?? '—'}</span>
      </button>

      {best > 0 && <p className="home-best">Best {best.toLocaleString()}</p>}

      {/* Renders only on the address the game used to live at. */}
      <MovePrompt />

      {/* Settings live on the profile now, so this row is one thing rather
          than a list of three competing for the same glance. */}
      <div className="home-tools" aria-label="More options">
        <button className="link-btn" onClick={onProfile}>
          Your profile &amp; settings
        </button>
      </div>

      {/* Plain anchors to the written pages, not routes: a crawler and a
          reviewer both need to reach them without running the app, and pages
          nothing links to may as well not exist. */}
      <nav className="home-pages" aria-label="About this site">
        <a className="link-btn" href="/how-to-play.html">
          How to play
        </a>
        <span aria-hidden>·</span>
        <a className="link-btn" href="/about.html">
          About
        </a>
        <span aria-hidden>·</span>
        <a className="link-btn" href="/contact.html">
          Contact
        </a>
        <span aria-hidden>·</span>
        <a className="link-btn" href="/privacy.html">
          Privacy
        </a>
        <span aria-hidden>·</span>
        <a className="link-btn" href="/terms.html">
          Terms
        </a>
      </nav>

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
