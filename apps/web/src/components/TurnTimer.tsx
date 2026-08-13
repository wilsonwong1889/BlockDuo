import { memo, useEffect, useState } from 'react';
import { TURN_MS } from '@blokduo/engine';

interface Props {
  /** Turn deadline translated onto the local device clock. */
  deadline: number;
}

export function turnTime(deadline: number, now: number) {
  const remainingMs = Math.max(0, deadline - now);
  return {
    remainingMs,
    seconds: Math.ceil(remainingMs / 1000),
    fraction: Math.min(1, remainingMs / TURN_MS),
  };
}

/**
 * Owns the fast-moving Duo clock so its four visual updates per second never
 * rerender the board, tray, players, or score. Date.now() makes it catch up
 * immediately after a backgrounded phone resumes.
 */
function TurnTimerView({ deadline }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline]);

  const { seconds, fraction } = turnTime(deadline, now);

  return (
    <span
      className={`turn-timer${seconds <= 10 ? ' urgent' : ''}`}
      aria-label={`${seconds} seconds left`}
    >
      <span className="turn-timer-bar" style={{ transform: `scaleX(${fraction})` }} />
      <span className="turn-timer-value">{seconds}s</span>
    </span>
  );
}

export const TurnTimer = memo(TurnTimerView);
