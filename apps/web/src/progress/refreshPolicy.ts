/**
 * How long an ambient refresh waits before another is worth a round trip.
 *
 * Short enough that a player who leaves the game and comes back a minute later
 * sees current numbers, long enough that flicking between apps does not cost a
 * request each time.
 */
export const AMBIENT_REFRESH_MS = 30_000;

/**
 * Whether a refresh nobody asked for is worth making.
 *
 * `focus` fires every time an app-switched phone returns to the game, and each
 * refresh is an RPC session against a single Durable Object that serves every
 * player — so an idle player flicking between apps can cost more requests than
 * one actually playing.
 *
 * Two things are deliberately not throttled. A finished game still waiting to
 * be claimed always goes through, because that is somebody's reward sitting in
 * a queue and the event that woke us may be the connection coming back. And
 * refreshes caused by the player — a claim, a spin — do not come through here
 * at all: the numbers on screen are wrong until those land.
 */
export function shouldRefreshOnAmbientEvent(
  now: number,
  lastRefreshAt: number,
  pendingClaims: number,
): boolean {
  if (pendingClaims > 0) return true;
  return now - lastRefreshAt >= AMBIENT_REFRESH_MS;
}
