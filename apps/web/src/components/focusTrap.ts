/**
 * Focus containment for a modal dialog.
 *
 * The DOM query has to live in the browser, but the wrapping arithmetic is what
 * actually decides where Tab lands, so it is kept separate and testable.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hasAttribute('hidden') && element.offsetParent !== null,
  );
}

/**
 * Where Tab should go from `current`, wrapping at both ends so focus can never
 * leave the dialog.
 *
 * `current` is -1 when focus is somewhere outside the list — a fresh dialog, or
 * the panel itself holding focus because it had nothing focusable to hand it to.
 * Tab from there enters at the near end rather than being swallowed.
 */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}
