import { useEffect, useRef, useState } from 'react';

/**
 * Counts the displayed score up to the real one instead of snapping.
 *
 * A big combo should feel like it is being paid out, and the roll also gives the
 * eye something to follow when the number jumps by hundreds.
 */
function useCountUp(target: number, ms = 420) {
  const [shown, setShown] = useState(target);
  // The displayed value is mirrored in a ref so the animation frame never reads
  // it through a stale closure, and so a new target picked up mid-tween starts
  // from wherever the number actually is rather than from where it began.
  const shownRef = useRef(target);
  const targetRef = useRef(target);
  const raf = useRef(0);

  targetRef.current = target;

  useEffect(() => {
    if (shownRef.current === target) return;

    const from = shownRef.current;
    const start = performance.now();

    const apply = (value: number) => {
      shownRef.current = value;
      setShown(value);
    };

    const step = (now: number) => {
      // Clamped at both ends: the first frame's timestamp can predate `start`,
      // and a backgrounded tab resumes with a huge one.
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      // Ease-out, so the number reads as reacting immediately.
      const eased = 1 - Math.pow(1 - t, 3);
      apply(Math.round(from + (targetRef.current - from) * eased));

      if (t < 1) {
        raf.current = requestAnimationFrame(step);
      } else {
        // Always finish exactly on the target; rounding mid-tween must never
        // leave the score reading something other than the real score.
        apply(targetRef.current);
      }
    };

    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);

  return shown;
}

interface Props {
  score: number;
  best: number;
  streak: number;
  label?: string;
}

export function Hud({ score, best, streak, label = 'Score' }: Props) {
  const shown = useCountUp(score);
  const beatingBest = score > 0 && score >= best;

  return (
    <div className="hud">
      <div className="hud-block">
        <span className="hud-label">{label}</span>
        <span className={`hud-score${beatingBest ? ' record' : ''}`}>{shown.toLocaleString()}</span>
      </div>

      <div className={`streak${streak > 0 ? ' active' : ''}`} aria-live="polite">
        {streak > 0 ? (
          <>
            <span className="streak-flame" aria-hidden>
              ★
            </span>
            <span>
              {streak} in a row · ×{Math.min(1 + 0.5 * streak, 4).toFixed(1)}
            </span>
          </>
        ) : (
          <span className="streak-hint">Clear a line to start a streak</span>
        )}
      </div>

      <div className="hud-block right">
        <span className="hud-label">Best</span>
        <span className="hud-best">{best.toLocaleString()}</span>
      </div>
    </div>
  );
}
