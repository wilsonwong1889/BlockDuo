import { useRef, useState, type CSSProperties } from 'react';
import {
  MAX_AD_SPINS_PER_DAY,
  WHEEL_COST_COINS,
  WHEEL_SEGMENTS,
  WHEEL_WEDGES,
  POWER_COSTS,
} from '@blokduo/engine';
import { showRewardedAd } from '../ads';
import { useFreeSpinWait } from '../game/useFreeSpinWait';
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

/** Prize value to colour, so a prize's wedges all look alike. */
const COLOUR_OF = new Map<number, string>(
  WHEEL_SEGMENTS.map((segment, index) => [
    segment.gems,
    SEGMENT_COLOURS[index % SEGMENT_COLOURS.length],
  ]),
);

/** The prize drawn as a single sliver, whose odds the striking-off chases. */
const RARE_GEMS = WHEEL_WEDGES.find((w) => w.rare)?.gems ?? null;

/** A struck wedge, drawn as spent rather than removed. */
const STRUCK_COLOUR = 'rgba(255, 255, 255, 0.07)';

function gradientFor(marked: readonly number[]): string {
  const struck = new Set(marked);
  const stops = WHEEL_WEDGES.map((wedge, index) => {
    const colour = struck.has(index)
      ? STRUCK_COLOUR
      : (COLOUR_OF.get(wedge.gems) ?? SEGMENT_COLOURS[0]);
    return `${colour} ${wedge.start}deg ${wedge.start + wedge.size}deg`;
  });
  return `conic-gradient(from 0deg, ${stops.join(', ')})`;
}

/** What each prize is worth now, given what is left on the board. */
function liveOdds(marked: readonly number[]): Array<{ gems: number; share: number }> {
  const struck = new Set(marked);
  const live = WHEEL_WEDGES.filter((_, index) => !struck.has(index));
  const total = live.reduce((sum, wedge) => sum + wedge.weight, 0);
  return WHEEL_SEGMENTS.map((segment) => ({
    gems: segment.gems,
    share: total
      ? live.filter((w) => w.gems === segment.gems).reduce((sum, w) => sum + w.weight, 0) / total
      : 0,
  }));
}

/** Where the wheel must stop for `wedge` to sit under the pointer. */
function restingAngle(from: number, wedgeIndex: number): number {
  const wedge = WHEEL_WEDGES[wedgeIndex] ?? WHEEL_WEDGES[0];
  const current = ((from % 360) + 360) % 360;
  // The pointer is at the top, so the wedge's centre has to come round to 0.
  const wanted = (360 - wedge.centre) % 360;
  const delta = (wanted - current + 360) % 360;
  return from + 360 * SPIN_TURNS + delta;
}

/**
 * Where each spark flies. Fixed rather than random per win, so the burst is
 * the same shape every time and reads as part of the wheel.
 */
const SPARKS = Array.from({ length: 14 }, (_, i) => ({
  angle: (360 / 14) * i + (i % 3) * 7,
  reach: `${-4.4 - (i % 4) * 0.7}rem`,
}));

const prefersStillness = () =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('reduce-motion');

export function WheelScreen({ onHome }: Props) {
  const { profile, spinWheel, resetWheel } = useProgress();
  const [spinning, setSpinning] = useState(false);
  const [won, setWon] = useState<number | null>(null);
  const [wasFree, setWasFree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [angle, setAngle] = useState(0);
  const [shownMarks, setShownMarks] = useState<number[]>([]);
  const [resetting, setResetting] = useState(false);
  const [justRefilled, setJustRefilled] = useState(false);
  // The profile's gem total arrives with the server's answer, which is long
  // before the wheel stops. Showing it straight away would announce the prize
  // over the top of the animation, so the header counts up on landing instead.
  const [heldGems, setHeldGems] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  // Read during a spin, so it does not go stale behind the state update.
  const angleRef = useRef(0);

  const coins = profile?.coins ?? 0;
  const freeSpin = profile?.freeSpinAvailable ?? false;
  // A free spin is always affordable, which is the whole point of it.
  const affordable = freeSpin || coins >= WHEEL_COST_COINS;

  const adSpinsLeft = profile?.adSpinsLeft ?? 0;
  const freeSpinWait = useFreeSpinWait(freeSpin);
  const marked = profile?.markedWedges ?? [];
  // Held back while the wheel is still turning: striking the wedge off the
  // moment the server answered would show the result before it landed.
  const shown = spinning ? shownMarks : marked;
  const odds = liveOdds(shown);
  const rareShare = odds.find((row) => row.gems === RARE_GEMS)?.share ?? 0;
  const left = WHEEL_WEDGES.length - shown.length;
  const wonRare = won !== null && won === RARE_GEMS;

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
    const before = profile?.markedWedges ?? [];
    setHeldGems(profile?.gems ?? 0);
    try {
      const result = await spinWheel(viaAd);
      setWasFree(result.free);
      // Freeze the board as it was, so the wedge being aimed at is still there
      // to aim at while the wheel turns.
      setShownMarks(before);

      const still = prefersStillness();
      const next = still ? angleRef.current : restingAngle(angleRef.current, result.wedge);
      angleRef.current = next;
      setAngle(next);

      // The server decided before the wheel moved; this is only the telling of
      // it. Held until the wheel has actually stopped on the prize, or the
      // number would give away the answer while it was still turning.
      window.setTimeout(
        () => {
          setWon(result.gems);
          setSpinning(false);
          setHeldGems(null);
          setCounting(true);
          window.setTimeout(() => setCounting(false), 600);
          if (result.refilled) setJustRefilled(true);
        },
        still ? 0 : SPIN_MS,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The spin did not go through');
      setSpinning(false);
      setHeldGems(null);
    }
  };

  return (
    <div className="screen social-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onHome} aria-label="Back to menu">
          ‹
        </button>
        <span className="topbar-title">Wheel</span>
        <span className={`gem-pill${counting ? ' counting' : ''}`}>
          ◈ {(heldGems ?? profile?.gems)?.toLocaleString() ?? '—'}
        </span>
      </header>

      <section className="social-card wheel-card">
        <div
          className={`wheel-stage${spinning ? ' spinning' : ''}${
            won !== null ? ' landed' : ''
          }${wonRare ? ' rare' : ''}`}
        >
          <span className="wheel-glow" aria-hidden />
          <span className="wheel-pointer" aria-hidden />
          <div
            className="wheel"
            aria-hidden
            style={{
              background: gradientFor(shown),
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
            {WHEEL_WEDGES.map((wedge, index) => {
              const struck = shown.includes(index);
              return (
                <span
                  className={`wheel-label${wedge.rare ? ' rare' : ''}${struck ? ' struck' : ''}`}
                  key={`${wedge.gems}-${index}`}
                  style={{
                    transform: `rotate(${wedge.centre}deg) translateY(calc(var(--label-radius) * -1))`,
                  }}
                >
                  {struck ? '✕' : wedge.gems}
                </span>
              );
            })}
          </div>
          <div className={`wheel-hub${won !== null ? ' won' : ''}`} aria-hidden>
            ◈
          </div>
          {won !== null && (
            <>
              <span className={`wheel-sparks${wonRare ? ' rare' : ''}`} aria-hidden>
                {SPARKS.map((spark) => (
                  <span
                    key={spark.angle}
                    style={
                      {
                        '--spark-angle': `${spark.angle}deg`,
                        '--spark-reach': spark.reach,
                      } as CSSProperties
                    }
                  />
                ))}
              </span>
              <span className={`wheel-burst${wonRare ? ' rare' : ''}`} aria-hidden>
                +{won}
              </span>
            </>
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

        {!freeSpin && (
          <p className="panel-note">
            <span className="next-spin">Next free spin in {freeSpinWait}</span>
            {!affordable &&
              ` · ${(WHEEL_COST_COINS - coins).toLocaleString()} more coins to spin now`}
          </p>
        )}
      </section>

      <section className="leaderboard-card">
        <div className="leaderboard-heading">
          <div>
            <h2>What it pays</h2>
            <p>
              {left === WHEEL_WEDGES.length
                ? 'A full board. Every wedge still standing.'
                : `${left} of ${WHEEL_WEDGES.length} wedges left — the odds below are what is on the board now.`}
            </p>
          </div>
          {shown.length > 0 && (
            <button
              className="btn compact"
              onClick={() => {
                setResetting(true);
                void resetWheel().finally(() => setResetting(false));
              }}
              disabled={resetting || spinning}
            >
              {resetting ? 'Resetting…' : 'Reset'}
            </button>
          )}
        </div>

        {RARE_GEMS !== null && (
          <p className="panel-note rare-odds">
            ◈ {RARE_GEMS} is now <strong>{(rareShare * 100).toFixed(rareShare < 0.1 ? 1 : 0)}%</strong>
            {shown.length > 0 && ' — every spin strikes a wedge off and shortens the odds.'}
          </p>
        )}
        {justRefilled && (
          <p className="panel-note">The board emptied, so it filled back up. Odds are back to full.</p>
        )}

        <div className="odds-list">
          {odds.map((row, index) => (
            <div className={`odds-row${row.share === 0 ? ' spent' : ''}`} key={row.gems}>
              <span className="odds-prize">
                <span
                  className="odds-swatch"
                  aria-hidden
                  style={{ background: SEGMENT_COLOURS[index % SEGMENT_COLOURS.length] }}
                />
                ◈ {row.gems}
              </span>
              <span className="odds-bar" aria-hidden>
                <span style={{ width: `${row.share * 100}%` }} />
              </span>
              <strong>
                {row.share === 0
                  ? 'gone'
                  : `${(row.share * 100).toFixed(row.share < 0.1 ? 1 : 0)}%`}
              </strong>
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
