import { describe, expect, it } from 'vitest';
import { nextFocusIndex } from '../src/components/focusTrap';
import { isModalOpen, openModal } from '../src/components/modalStack';
import { runBackHandlers, type BackHandler } from '../src/native/useBackHandler';

describe('nextFocusIndex', () => {
  it('walks forward and wraps at the end, so focus cannot leave the dialog', () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 1, false)).toBe(2);
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });

  it('walks backward and wraps at the start', () => {
    expect(nextFocusIndex(3, 2, true)).toBe(1);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });

  it('enters at the near end when focus is not yet in the list', () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
  });

  it('reports nothing to focus for an empty dialog', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
  });
});

describe('modal stack', () => {
  it('counts nested dialogs and only clears once the last one closes', () => {
    expect(isModalOpen()).toBe(false);
    const closeOuter = openModal();
    const closeInner = openModal();

    expect(isModalOpen()).toBe(true);
    closeInner();
    expect(isModalOpen()).toBe(true);
    closeOuter();
    expect(isModalOpen()).toBe(false);
  });

  it('ignores a repeated close, which StrictMode will produce', () => {
    const close = openModal();
    close();
    close();

    expect(isModalOpen()).toBe(false);
  });
});

describe('runBackHandlers', () => {
  it('offers the press to the newest handler first', () => {
    const seen: string[] = [];
    const stack: BackHandler[] = [
      () => {
        seen.push('screen');
        return false;
      },
      () => {
        seen.push('dialog');
        return true;
      },
    ];

    expect(runBackHandlers(stack)).toBe(true);
    expect(seen).toEqual(['dialog']);
  });

  it('falls through to the screen when the dialog declines', () => {
    const seen: string[] = [];
    const stack: BackHandler[] = [
      () => {
        seen.push('screen');
        return true;
      },
      () => {
        seen.push('dialog');
        return false;
      },
    ];

    expect(runBackHandlers(stack)).toBe(true);
    expect(seen).toEqual(['dialog', 'screen']);
  });

  it('leaves an unclaimed press to the default, which is leaving the app', () => {
    expect(runBackHandlers([() => false])).toBe(false);
    expect(runBackHandlers([])).toBe(false);
  });
});
