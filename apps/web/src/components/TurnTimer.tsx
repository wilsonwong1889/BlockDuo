import { memo, useEffect, useState } from 'react';
import { TURN_MS } from '@blokduo/engine';

interface Props {
  /** Turn deadline translated onto the local device clock. */
  deadline: number;
  /** A full turn in this room's mode, which is what the bar is a fraction of. */
  turnMs?: number;
}

export function turnTime(deadline: number, now: number, turnMs: number = TURN_MS) {
  const remainingMs = Math.max(0, deadline - now);
  return {
    remainingMs,
    seconds: Math.ceil(remainingMs / 1000),
    fraction: turnMs > 0 ? Math.min(1, remainingMs / turnMs) : 0,
  };
}

/**
 * Owns the fast-moving Duo clock so its four visual updates per second never
 * rerender the board, tray, players, or score. Date.now() makes it catch up
 * immediately after a backgrounded phone resumes.
 */
function TurnTimerView({ deadline, turnMs = TURN_MS }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline]);

  const { seconds, fraction } = turnTime(deadline, now, turnMs);
  // A fifth of the turn, so "hurry up" means the same thing in a five-second
  // room as it does in a sixty-second one.
  const urgent = seconds * 1000 <= Math.max(1_000, turnMs / 5);

  return (
    <span
      className={`turn-timer${urgent ? ' urgent' : ''}`}
      aria-label={`${seconds} seconds left`}
    >
      <span className="turn-timer-bar" style={{ transform: `scaleX(${fraction})` }} />
      <span className="turn-timer-value">{seconds}s</span>
    </span>
  );
}

export const TurnTimer = memo(TurnTimerView);
