/**
 * Display-name moderation.
 *
 * Names are public: they sit on the global leaderboard and on profile pages
 * anyone can open by URL. Stripping control characters is not moderation, so
 * this is the filter that decides what a stranger is allowed to be called.
 *
 * It lives in the engine because it has to be enforced on the server — a client
 * check is a suggestion — but the pure rules are also what the client uses to
 * refuse a name before sending it, so both sides agree on the answer.
 */

export const MAX_NAME_LENGTH = 20;
export const FALLBACK_NAME = 'Player';

/**
 * Characters swapped for the letters they stand in for, so a filter cannot be
 * walked around with `$` and `0`.
 */
const LOOKALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
  '+': 't',
};

/**
 * Long enough to be unambiguous wherever they appear, so they are matched even
 * when padded with other letters.
 */
const BLOCKED_ANYWHERE = [
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'molest',
  'pedophile',
  'paedophile',
  'kkk',
  'hitler',
  'nazi',
  'whore',
  'wanker',
  'bastard',
  'bollocks',
];

/**
 * Short enough to appear innocently inside ordinary words, so they only count
 * as their own word. Without this, "classic", "bass" and "Scunthorpe" are all
 * banned — the mistake this rule exists to avoid.
 */
const BLOCKED_WORDS = [
  // Short, or hiding inside longer innocent words: "cunt" is in Scunthorpe and
  // "rapist" is in therapist, which is exactly how filters embarrass themselves.
  'cunt',
  'rapist',
  'ass',
  'arse',
  'cock',
  'dick',
  'shit',
  'piss',
  'fuck',
  'slut',
  'twat',
  'rape',
  'nazi',
];

/** Lowercased, with lookalike characters folded back to letters. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .split('')
    .map((character) => LOOKALIKES[character] ?? character)
    .join('');
}

/** Whether a name may be shown to other people. */
export function isAllowedName(value: string): boolean {
  const normalized = normalizeName(value);

  // Separators removed, so "f u c k" and "f-u-c-k" are the same word.
  const letters = normalized.replace(/[^a-z]/g, '');
  if (BLOCKED_ANYWHERE.some((term) => letters.includes(term))) return false;

  // Whole words only, against both the spaced and the run-together forms.
  const blockedWord = (word: string) =>
    // Plurals count as the same word; anything more is a losing game against
    // spelling, and a wrong refusal is worse than a missed one.
    BLOCKED_WORDS.some((term) => word === term || word === `${term}s`);

  const words = normalized.split(/[^a-z]+/).filter(Boolean);
  if (words.some(blockedWord)) return false;
  if (blockedWord(letters)) return false;

  return true;
}

/**
 * The name to store: trimmed, capped, and never empty.
 *
 * A disallowed name becomes the fallback rather than an error here, because
 * this is also the path a Duo result takes when it records who played. Callers
 * that can report a refusal — a player renaming themselves — should ask
 * `isAllowedName` first and say so.
 */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return FALLBACK_NAME;
  const cleaned = value
    // Control characters, which can hide text or wreck a layout.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  if (!cleaned) return FALLBACK_NAME;
  return isAllowedName(cleaned) ? cleaned : FALLBACK_NAME;
}
