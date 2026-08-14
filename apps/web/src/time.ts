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
