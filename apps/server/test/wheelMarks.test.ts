import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { WHEEL_WEDGES, type ProgressProfile, type WheelResult } from '@blokduo/engine';

const ORIGIN = 'https://blokduo.test';

interface Credentials {
  clientId: string;
  token: string;
}

async function post<T>(path: string, body: unknown): Promise<{ response: Response; body: T }> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: (await response.json()) as T };
}

async function createPlayer(name: string): Promise<Credentials> {
  const result = await post<{ identity: Credentials }>('/api/progress/player', { name });
  expect(result.response.status).toBe(200);
  return result.body.identity;
}

/** Free spin, then adverts — the spins a player can actually take in a day. */
async function spin(identity: Credentials, viaAd = false) {
  const result = await post<WheelResult>('/api/progress/wheel', {
    credentials: identity,
    watchedAd: viaAd,
  });
  expect(result.response.status).toBe(200);
  return result.body;
}

/**
 * Striking wedges off is the part a client must not be trusted with: it is
 * what decides how likely the rare prize is, so it lives on the server and
 * these are the properties that make it worth anything.
 */
describe('the wheel remembers what it has paid', () => {
  it('strikes off the wedge it landed on', async () => {
    const player = await createPlayer('Striker');
    const first = await spin(player);
    expect(first.profile.markedWedges).toContain(first.wedge);
    expect(first.profile.markedWedges).toHaveLength(1);
  });

  it('never lands on a wedge already struck', async () => {
    const player = await createPlayer('NoRepeats');
    const seen: number[] = [];
    // Free spin plus the day's adverts, which is all a player gets.
    seen.push((await spin(player)).wedge);
    for (let i = 0; i < 3; i++) seen.push((await spin(player, true)).wedge);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('pays what the wedge it stopped on is worth', async () => {
    const player = await createPlayer('Consistent');
    const result = await spin(player);
    expect(result.gems).toBe(WHEEL_WEDGES[result.wedge].gems);
    expect(result.profile.gems).toBe(result.gems);
  });

  it('gives the wedges back on reset', async () => {
    const player = await createPlayer('Resetter');
    await spin(player);
    const reset = await post<ProgressProfile>('/api/progress/wheel/reset', {
      credentials: player,
    });
    expect(reset.response.status).toBe(200);
    expect(reset.body.markedWedges).toEqual([]);
    // Gems already won are not taken back — resetting trades odds, not prizes.
    expect(reset.body.gems).toBeGreaterThan(0);
  });

  it('refuses to reset for credentials that are not signed in', async () => {
    const player = await createPlayer('NotYou');
    const bad = await post('/api/progress/wheel/reset', {
      credentials: { clientId: player.clientId, token: 'wrong' },
    });
    expect(bad.response.status).toBe(401);
  });

  it('starts every player with a full board', async () => {
    const player = await createPlayer('Fresh');
    const profile = await post<ProgressProfile>('/api/progress/profile', {
      credentials: player,
    });
    expect(profile.body.markedWedges).toEqual([]);
  });
});
