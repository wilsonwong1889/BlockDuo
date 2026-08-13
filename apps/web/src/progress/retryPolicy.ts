import { GAME_SEED_RANGE } from '@blokduo/engine';

/**
 * Legacy transcripts are understood by every deployed server version, so a
 * 4xx means they are permanently invalid. Version-tagged transcripts may have
 * reached an older Worker during a rollback; keep those until a compatible
 * rules verifier is live again.
 */
export function shouldDiscardPendingClassic(seed: number, status: number): boolean {
  if (status < 400 || status >= 500) return false;
  return !(status === 400 && seed >= GAME_SEED_RANGE);
}
