import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ProgressProfile } from '@blokduo/engine';

const ORIGIN = 'https://blokduo.test';

interface Credentials {
  clientId: string;
  token: string;
}

interface Player {
  identity: Credentials;
  profile: ProgressProfile;
}

async function post<T>(path: string, body: unknown): Promise<{ response: Response; body: T }> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: (await response.json()) as T };
}

async function createPlayer(name: string): Promise<Player> {
  const result = await post<Player>('/api/progress/player', { name });
  expect(result.response.status).toBe(200);
  return result.body;
}

const mint = (identity: Credentials) =>
  post<{ code: string; expiresAt: number }>('/api/progress/transfer/create', identity);

const claim = (code: string) =>
  post<{ identity: Credentials }>('/api/progress/transfer/claim', { code });

/**
 * Carrying a profile between origins.
 *
 * The progression data is one Durable Object behind every hostname, so nothing
 * is being copied here — what moves is the credential that says which profile
 * belongs to this browser, because localStorage is keyed per origin and a
 * player who changes domain would otherwise be handed a new one.
 *
 * A code is a bearer credential for a whole account, so the properties worth
 * pinning down are the ones that stop it being one for longer than intended.
 */
describe('transferring a profile between origins', () => {
  it('hands back the credentials of the profile that minted the code', async () => {
    const player = await createPlayer('Mover');
    const created = await mint(player.identity);
    expect(created.response.status).toBe(200);

    const claimed = await claim(created.body.code);
    expect(claimed.response.status).toBe(200);
    expect(claimed.body.identity.clientId).toBe(player.identity.clientId);
  });

  it('leaves the original device working, rather than logging it out', async () => {
    const player = await createPlayer('Stayer');
    const created = await mint(player.identity);
    await claim(created.body.code);

    // The same credentials the old origin still holds.
    const after = await post<ProgressProfile>('/api/progress/profile', player.identity);
    expect(after.response.status).toBe(200);
    expect(after.body.clientId).toBe(player.identity.clientId);
  });

  it('reaches the same profile the claimed credentials name', async () => {
    const player = await createPlayer('Same');
    const created = await mint(player.identity);
    const claimed = await claim(created.body.code);

    const viaClaimed = await post<ProgressProfile>(
      '/api/progress/profile',
      claimed.body.identity,
    );
    expect(viaClaimed.response.status).toBe(200);
    expect(viaClaimed.body.friendCode).toBe(player.profile.friendCode);
  });

  it('spends the code, so a leaked link cannot be replayed', async () => {
    const player = await createPlayer('Once');
    const created = await mint(player.identity);

    expect((await claim(created.body.code)).response.status).toBe(200);

    const second = await claim(created.body.code);
    expect(second.response.status).toBe(404);
  });

  it('refuses to mint for credentials that are not signed in', async () => {
    const player = await createPlayer('Impostor');
    const bad = await mint({ clientId: player.identity.clientId, token: 'not-the-token' });
    expect(bad.response.status).toBe(401);
  });

  it('refuses a code that was never issued', async () => {
    const guessed = await claim('0'.repeat(32));
    expect(guessed.response.status).toBe(404);
  });

  it('refuses input that is not a code at all', async () => {
    expect((await claim('')).response.status).toBe(400);
    expect((await claim('short')).response.status).toBe(400);
    // Right length, wrong alphabet — hex only, so this is not a near miss.
    expect((await claim('z'.repeat(32))).response.status).toBe(400);
  });

  it('gives each mint a distinct code', async () => {
    const player = await createPlayer('Twice');
    const first = await mint(player.identity);
    const second = await mint(player.identity);
    expect(first.body.code).not.toBe(second.body.code);
    // Both live: minting again is how somebody retries after a failed move.
    expect((await claim(first.body.code)).response.status).toBe(200);
    expect((await claim(second.body.code)).response.status).toBe(200);
  });

  it('dates the code, so the client can say when it stops working', async () => {
    const player = await createPlayer('Clock');
    const created = await mint(player.identity);
    expect(created.body.expiresAt).toBeGreaterThan(Date.now());
    expect(created.body.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
  });
});
