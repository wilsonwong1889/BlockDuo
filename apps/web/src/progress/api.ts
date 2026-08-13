import type {
  ClaimResult,
  GameMode,
  LeaderboardScope,
  LeaderboardView,
  Move,
  ProgressProfile,
} from '@blokduo/engine';
import { apiUrl } from '../net/config';
import {
  clearProgressIdentity,
  loadName,
  loadProgressIdentity,
  saveProgressIdentity,
  type ProgressIdentity,
} from '../storage';

let identityRequest: Promise<ProgressIdentity> | null = null;

export class ProgressApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ProgressApiError('Could not reach the progression server', 0);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A proxy can replace an error with an HTML page. Use the friendly fallback.
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : 'The progression server rejected that request';
    throw new ProgressApiError(message, response.status);
  }
  return payload as T;
}

export async function ensureProgressIdentity(): Promise<ProgressIdentity> {
  const stored = loadProgressIdentity();
  if (stored?.clientId && stored.token) return stored;
  if (identityRequest) return identityRequest;

  identityRequest = post<{ identity: ProgressIdentity }>('/api/progress/player', {
    name: loadName() || 'Player',
  })
    .then(({ identity }) => {
      saveProgressIdentity(identity);
      return identity;
    })
    .finally(() => {
      identityRequest = null;
    });
  return identityRequest;
}

async function authenticated<T>(path: string, body: Record<string, unknown> = {}) {
  let credentials = await ensureProgressIdentity();
  try {
    return await post<T>(path, { ...body, credentials });
  } catch (error) {
    // A local identity can outlive a server reset. Recover once with a fresh
    // guest rather than leaving every progression screen permanently broken.
    if (!(error instanceof ProgressApiError) || error.status !== 401) throw error;
    clearProgressIdentity();
    credentials = await ensureProgressIdentity();
    return post<T>(path, { ...body, credentials });
  }
}

export function fetchProfile(name?: string): Promise<ProgressProfile> {
  return authenticated('/api/progress/profile', name === undefined ? {} : { name });
}

export function addFriend(friendCode: string): Promise<ProgressProfile> {
  return authenticated('/api/progress/friends/add', { friendCode });
}

export function removeFriend(friendCode: string): Promise<ProgressProfile> {
  return authenticated('/api/progress/friends/remove', { friendCode });
}

export function fetchLeaderboard(
  mode: GameMode,
  scope: LeaderboardScope,
): Promise<LeaderboardView> {
  return authenticated('/api/progress/leaderboard', { mode, scope });
}

export function claimClassic(seed: number, moves: Move[]): Promise<ClaimResult> {
  return authenticated('/api/progress/classic', { seed, moves });
}

export async function fetchRoomTicket(code: string, name: string): Promise<string> {
  const result = await authenticated<{ ticket: string }>(`/api/room/${code}/ticket`, { name });
  return result.ticket;
}

export function announceProgressChange() {
  window.dispatchEvent(new Event('blokduo:progress-change'));
}
