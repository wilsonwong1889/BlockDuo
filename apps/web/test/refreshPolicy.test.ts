import { describe, expect, it } from 'vitest';
import { AMBIENT_REFRESH_MS, shouldRefreshOnAmbientEvent } from '../src/progress/refreshPolicy';

/**
 * The throttle exists to stop an idle player costing requests, so the cases
 * worth pinning are the two it must never swallow: a reward still queued, and
 * a genuine return after being away.
 */
describe('ambient refresh', () => {
  const now = 1_000_000;

  it('refreshes when enough time has passed', () => {
    expect(shouldRefreshOnAmbientEvent(now, now - AMBIENT_REFRESH_MS, 0)).toBe(true);
    expect(shouldRefreshOnAmbientEvent(now, now - AMBIENT_REFRESH_MS * 10, 0)).toBe(true);
  });

  it('skips a second wake-up moments after the first', () => {
    expect(shouldRefreshOnAmbientEvent(now, now, 0)).toBe(false);
    expect(shouldRefreshOnAmbientEvent(now, now - 1_000, 0)).toBe(false);
  });

  it('never delays a finished game still waiting to be claimed', () => {
    // The event may be the connection coming back, and that reward is the one
    // thing a player would notice going missing.
    expect(shouldRefreshOnAmbientEvent(now, now, 1)).toBe(true);
    expect(shouldRefreshOnAmbientEvent(now, now - 1, 3)).toBe(true);
  });

  it('refreshes on the first event of a session', () => {
    // Nothing has been fetched yet, so the stamp is still zero.
    expect(shouldRefreshOnAmbientEvent(now, 0, 0)).toBe(true);
  });

  it('does not stall forever if a clock jumps backwards', () => {
    // A device whose clock moved back would otherwise sit permanently inside
    // the window. It refuses once, then the next event clears it.
    expect(shouldRefreshOnAmbientEvent(now, now + 60_000, 0)).toBe(false);
    expect(shouldRefreshOnAmbientEvent(now + 90_000, now + 60_000, 0)).toBe(true);
  });
});
