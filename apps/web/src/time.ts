/**
 * How long ago something happened, in the words a player would use.
 *
 * Recent play is the part anyone reading a profile actually cares about — "is
 * this person still around?" — so the near past stays relative and only the
 * distant past falls back to a date, where the exact day has stopped mattering.
 */
export function timeAgo(at: number, now: number = Date.now()): string {
  const ms = now - at;
  if (!Number.isFinite(ms)) return 'unknown';
  if (ms < 0) return 'just now';

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(at);
}
