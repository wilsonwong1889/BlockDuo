const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Largest first, so the answer is given in the biggest unit that fits: 40 days
 * is "1 month ago" rather than "40 days ago". A month is taken as 30 days —
 * "last played" is a rough answer to a rough question, and calendar-exact
 * months would put a February gap and a March one in different buckets for no
 * benefit anyone reading a profile would notice.
 */
const UNITS = [
  { name: 'month', ms: 30 * DAY },
  { name: 'week', ms: 7 * DAY },
  { name: 'day', ms: DAY },
  { name: 'hour', ms: HOUR },
  { name: 'minute', ms: MINUTE },
] as const;

/**
 * How long until the day's free spin comes back.
 *
 * The server stamps the spin with a UTC day and refuses a second one inside
 * it, so the reset is UTC midnight wherever the player is — not their own
 * midnight, which for most of the world is a different moment. Working it out
 * here from the same rule means the countdown cannot disagree with the server
 * about when the spin actually returns.
 */
export function msUntilUtcMidnight(now: number = Date.now()): number {
  if (!Number.isFinite(now)) return 0;
  const at = new Date(now);
  const next = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
  return Math.max(0, next - now);
}

/**
 * A wait, in hours and minutes.
 *
 * Minutes are the finest unit on purpose: a seconds counter on a wait this
 * long invites watching rather than leaving, and would have to tick every
 * second to stay honest.
 */
export function formatWait(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'any moment';
  const minutes = Math.floor(ms / MINUTE);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0) return `${hours}h ${rest}m`;
  if (minutes > 0) return `${minutes}m`;
  return 'under a minute';
}

/**
 * How long ago something happened, in the words a player would use.
 *
 * Months are the ceiling. Someone who has not played in a year reads as
 * "12 months ago", which answers "are they still around?" as well as a year
 * would and keeps the whole scale in one set of units.
 */
export function timeAgo(at: number, now: number = Date.now()): string {
  const ms = now - at;
  if (!Number.isFinite(ms)) return 'unknown';
  if (ms < MINUTE) return 'just now';

  for (const unit of UNITS) {
    const count = Math.floor(ms / unit.ms);
    if (count >= 1) return `${count} ${unit.name}${count === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}
