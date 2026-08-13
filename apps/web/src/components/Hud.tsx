import { useEffect, useRef } from 'react';
import { streakMultiplier } from '@blokduo/engine';
import { chainTier } from '../game/feedback';

/**
 * Counts the displayed score up to the real one instead of snapping.
 *
 * A big combo should feel like it is being paid out, and the roll also gives the
 * eye something to follow when the number jumps by hundreds.
 */
function useCountUp(target: number, ms = 420) {
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const initialText = useRef(target.toLocaleString());
  // Animate the text node directly. Score changes no longer rerender the HUD,
  // board, and tray on every frame of the count-up.
  const shownRef = useRef(target);
  const targetRef = useRef(target);
  const raf = useRef(0);

  targetRef.current = target;

  useEffect(() => {
    if (shownRef.current === target) return;

    if (
      document.documentElement.classList.contains('reduce-motion') ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      shownRef.current = target;
      if (elementRef.current) elementRef.current.textContent = target.toLocaleString();
      return;
    }

    const from = shownRef.current;
    const start = performance.now();

    const apply = (value: number) => {
      if (shownRef.current === value) return;
      shownRef.current = value;
      if (elementRef.current) elementRef.current.textContent = value.toLocaleString();
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

  return { elementRef, initialText: initialText.current };
}

interface Props {
  score: number;
  best?: number;
  streak: number;
  label?: string;
}

export function Hud({ score, best, streak, label = 'Score' }: Props) {
  const { elementRef: scoreRef, initialText } = useCountUp(score);
  const beatingBest = best !== undefined && score > 0 && score >= best;
  const nextMultiplier = streakMultiplier(streak).toFixed(1);
  const fullStreakCopy =
    streak === 0
      ? 'Clear a line to start a streak'
      : `${streak === 1 ? 'Chain started' : `Combo ×${streak}`} · next ×${nextMultiplier}`;
  const compactStreakCopy = streak === 0 ? 'Start chain' : `${streak} · ${nextMultiplier}×`;
  const accessibleStreakCopy =
    streak === 0
      ? fullStreakCopy
      : `${streak === 1 ? 'Chain started' : `Combo ${streak}`}. The next line clear scores ${nextMultiplier} times points.`;

  return (
    <div className="hud">
      <div className="hud-block">
        <span className="hud-label">{label}</span>
        <span ref={scoreRef} className={`hud-score${beatingBest ? ' record' : ''}`}>
          {initialText}
        </span>
      </div>

      <div
        className={`streak${streak > 0 ? ' active' : ''}`}
        data-chain-tier={chainTier(streak)}
        aria-live="polite"
        aria-atomic="true"
        title={accessibleStreakCopy}
      >
        {streak > 0 && (
          <span className="streak-flame" aria-hidden>
            ★
          </span>
        )}
        <span className={`streak-copy${streak === 0 ? ' streak-hint' : ''}`} aria-hidden>
          {fullStreakCopy}
        </span>
        <span
          className={`streak-copy-compact${streak === 0 ? ' streak-hint' : ''}`}
          aria-hidden
        >
          {compactStreakCopy}
        </span>
        <span className="streak-accessible">{accessibleStreakCopy}</span>
      </div>

      <div className="hud-block right">
        <span className="hud-label">{best === undefined ? 'Mode' : 'Best'}</span>
        <span className="hud-best">{best === undefined ? 'Co-op' : best.toLocaleString()}</span>
      </div>
    </div>
  );
}
