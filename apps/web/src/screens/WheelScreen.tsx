import { useRef, useState } from 'react';
import {
  MAX_AD_SPINS_PER_DAY,
  WHEEL_COST_COINS,
  WHEEL_SEGMENTS,
  WHEEL_TOTAL_WEIGHT,
  POWER_COSTS,
} from '@blokduo/engine';
import { showRewardedAd } from '../ads';
import { useProgress } from '../progress/ProgressContext';

interface Props {
  onHome: () => void;
}

/** How long the wheel takes to run down. Long enough to be worth watching. */
const SPIN_MS = 3600;

/** Whole turns before it starts hunting for the prize. */
const SPIN_TURNS = 5;

/** One colour per prize, rarest last so the 50 stands out on the rim. */
const SEGMENT_COLOURS = [
  'rgba(110, 231, 255, 0.85)',
  'rgba(167, 139, 250, 0.85)',
  'rgba(52, 211, 153, 0.85)',
  'rgba(250, 204, 21, 0.9)',
  'rgba(244, 63, 94, 0.95)',
];

interface Wedge {
  gems: number;
  /** Degrees clockwise from the top. */
  start: number;
  size: number;
  centre: number;
  colour: string;
}

/**
 * The prizes as wedges, sized by their real odds.
 *
 * Drawn from the same table the server pays out of, so the 1-in-100 wedge is
 * genuinely a sliver — a wheel whose slices do not match its odds is a wheel
 * that lies about them.
 */
const WEDGES: Wedge[] = (() => {
  let acc = 0;
  return WHEEL_SEGMENTS.map((segment, index) => {
    const size = (segment.weight / WHEEL_TOTAL_WEIGHT) * 360;
    const start = acc;
    acc += size;
    return {
      gems: segment.gems,
      start,
      size,
      centre: start + size / 2,
      colour: SEGMENT_COLOURS[index % SEGMENT_COLOURS.length],
    };
  });
})();

const WHEEL_GRADIENT = `conic-gradient(from 0deg, ${WEDGES.map(
  (w) => `${w.colour} ${w.start}deg ${w.start + w.size}deg`,
).join(', ')})`;

/** Where the wheel must stop for `gems` to sit under the pointer. */
function restingAngle(from: number, gems: number): number {
  const wedge = WEDGES.find((w) => w.gems === gems) ?? WEDGES[0];
  const current = ((from % 360) + 360) % 360;
  // The pointer is at the top, so the wedge's centre has to come round to 0.
  const wanted = (360 - wedge.centre) % 360;
  const delta = (wanted - current + 360) % 360;
  return from + 360 * SPIN_TURNS + delta;
}

const prefersStillness = () =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('reduce-motion');

export function WheelScreen({ onHome }: Props) {
  const { profile, spinWheel } = useProgress();
  const [spinning, setSpinning] = useState(false);
  const [won, setWon] = useState<number | null>(null);
  const [wasFree, setWasFree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [angle, setAngle] = useState(0);
  // Read during a spin, so it does not go stale behind the state update.
  const angleRef = useRef(0);

  const coins = profile?.coins ?? 0;
  const freeSpin = profile?.freeSpinAvailable ?? false;
  // A free spin is always affordable, which is the whole point of it.
  const affordable = freeSpin || coins >= WHEEL_COST_COINS;

  const adSpinsLeft = profile?.adSpinsLeft ?? 0;

  const spin = async (viaAd = false) => {
    if (spinning) return;
    if (!viaAd && !affordable) return;

    if (viaAd) {
      setSpinning(true);
      const advert = await showRewardedAd('wheel-spin');
      if (!advert.watched) {
        setSpinning(false);
        setError('The advert did not finish, so no spin this time');
        return;
      }
    }
    setSpinning(true);
    setWon(null);
    setError(null);
    try {
      const result = await spinWheel(viaAd);
      setWasFree(result.free);

      const still = prefersStillness();
      const next = still ? angleRef.current : restingAngle(angleRef.current, result.gems);
      angleRef.current = next;
      setAngle(next);

      // The server decided before the wheel moved; this is only the telling of
      // it. Held until the wheel has actually stopped on the prize, or the
      // number would give away the answer while it was still turning.
      window.setTimeout(
        () => {
          setWon(result.gems);
          setSpinning(false);
        },
        still ? 0 : SPIN_MS,
      );
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
        <div className="wheel-stage">
          <span className="wheel-pointer" aria-hidden />
          <div
            className="wheel"
            aria-hidden
            style={{
              background: WHEEL_GRADIENT,
              transform: `rotate(${angle}deg)`,
              transition: spinning
                ? // Off the mark quickly, then a long run-down: the last
                  // quarter-turn takes longer than the first four turns, which
                  // is what makes it read as losing momentum rather than
                  // being switched off.
                  `transform ${SPIN_MS}ms cubic-bezier(0.08, 0.82, 0.12, 1)`
                : 'none',
            }}
          >
            {WEDGES.map((wedge) => (
              <span
                className="wheel-label"
                key={wedge.gems}
                style={{ transform: `rotate(${wedge.centre}deg) translateY(-3.35rem)` }}
              >
                {wedge.gems}
              </span>
            ))}
          </div>
          <div className={`wheel-hub${won !== null ? ' won' : ''}`} aria-hidden>
            ◈
          </div>
          {won !== null && (
            <span className="wheel-burst" aria-hidden>
              +{won}
            </span>
          )}
        </div>

        <div className="wheel-result" role="status" aria-live="polite">
          {spinning && 'Spinning…'}
          {!spinning &&
            won !== null &&
            `You won ${won} gem${won === 1 ? '' : 's'}${wasFree ? ' — free spin' : ''}`}
          {!spinning && won === null && !error && 'Spin for gems'}
          {error && <span className="error">{error}</span>}
        </div>

        <button
          className={`btn primary big${freeSpin ? ' free' : ''}`}
          onClick={() => void spin(false)}
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
        {!freeSpin && adSpinsLeft > 0 && (
          <button className="btn" onClick={() => void spin(true)} disabled={spinning}>
            Watch an advert for a spin
            <span className="btn-sub">
              {adSpinsLeft} of {MAX_AD_SPINS_PER_DAY} left today
            </span>
          </button>
        )}

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
          {WHEEL_SEGMENTS.map((segment, index) => (
            <div className="odds-row" key={segment.gems}>
              <span className="odds-prize">
                <span
                  className="odds-swatch"
                  aria-hidden
                  style={{ background: SEGMENT_COLOURS[index % SEGMENT_COLOURS.length] }}
                />
                ◈ {segment.gems}
              </span>
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
