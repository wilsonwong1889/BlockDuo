/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 *
 * The whole engine is deterministic: a game is fully reproducible from its seed
 * plus the list of moves. The multiplayer server relies on this to stay in sync
 * with clients, and the tests rely on it for golden-file comparisons.
 *
 * State is passed in and out explicitly rather than held in a closure so it can
 * live inside GameState and be serialised over the wire.
 */
export function nextRandom(state: number): { value: number; state: number } {
  let s = (state + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: s };
}

/** Integer in [0, max). */
export function nextInt(state: number, max: number): { value: number; state: number } {
  const r = nextRandom(state);
  return { value: Math.floor(r.value * max), state: r.state };
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
