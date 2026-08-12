import { useEffect, useRef, useState } from 'react';

/**
 * Counts the displayed score up to the real one instead of snapping.
 *
 * A big combo should feel like it is being paid out, and the roll also gives the
 * eye something to follow when the number jumps by hundreds.
 */
function useCountUp(target: number, ms = 420) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const raf = useRef(0);

  useEffect(() => {
    if (shown === target) return;
    const start = performance.now();
    from.current = shown;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // Ease-out: fast at first, so the number reads as reacting immediately.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from.current + (target - from.current) * eased));
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // `shown` deliberately omitted: including it restarts the tween every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
