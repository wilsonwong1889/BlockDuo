/**
 * How many dialogs are currently open.
 *
 * The game screens listen for keys on `window` — Escape clears the selected
 * piece — and so does every open dialog. Two listeners on the same target
 * cannot be separated with stopPropagation, and stopImmediatePropagation would
 * make the outcome depend on which listener registered first. A count the game
 * screens can ask about is the version that does not depend on ordering.
 */

let openCount = 0;

/** Register an open dialog. Call the returned function when it closes. */
export function openModal(): () => void {
  openCount += 1;
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    openCount -= 1;
  };
}

export const isModalOpen = () => openCount > 0;
