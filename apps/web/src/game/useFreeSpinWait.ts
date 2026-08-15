import { useEffect, useState } from 'react';
import { formatWait, msUntilUtcMidnight } from '../time';

/**
 * How often the countdown is recomputed.
 *
 * It is displayed to the minute, so a shorter tick would redraw the same
 * string over and over. Twenty seconds keeps the change to a minute's worth of
 * lateness at most, which nobody waiting seven hours will notice.
 */
const TICK_MS = 20_000;

/**
 * The wait until the next free spin, as words, kept current.
 *
 * Returns null when there is nothing to wait for, so callers can render the
 * spin itself rather than a countdown to a spin already available.
 */
export function useFreeSpinWait(available: boolean): string | null {
  const [wait, setWait] = useState(() => msUntilUtcMidnight());

  useEffect(() => {
    if (available) return;
    // Recomputed from the clock each tick rather than counted down, so a
    // backgrounded tab that stops firing timers is right again the moment it
    // comes back instead of resuming from where it was frozen.
    const id = window.setInterval(() => setWait(msUntilUtcMidnight()), TICK_MS);
    setWait(msUntilUtcMidnight());
    return () => window.clearInterval(id);
  }, [available]);

  return available ? null : formatWait(wait);
}
