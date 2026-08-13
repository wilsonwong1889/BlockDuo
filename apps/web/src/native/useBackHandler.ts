import { useEffect, useRef } from 'react';

/** Returns true if the back press was dealt with and should go no further. */
export type BackHandler = () => boolean;

/**
 * Android's back button, offered to whatever is on top first.
 *
 * `initNative` turns the hardware press into a cancelable `blokduo:back` event;
 * anything that claims it stops the default, which is to walk back to Home and
 * then out of the app. Handlers are tried newest first, so a dialog opened over
 * a screen answers before the screen does.
 */
export function runBackHandlers(stack: readonly BackHandler[]): boolean {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i]()) return true;
  }
  return false;
}

const stack: BackHandler[] = [];
let listening = false;

function onBack(event: Event) {
  if (runBackHandlers(stack)) event.preventDefault();
}

export function useBackHandler(handler: BackHandler, active = true) {
  // The live handler is read through a ref so that a re-render does not
  // re-register it, which would quietly move it to the top of the stack.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;

    if (!listening) {
      listening = true;
      window.addEventListener('blokduo:back', onBack);
    }

    const entry: BackHandler = () => handlerRef.current();
    stack.push(entry);
    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [active]);
}
