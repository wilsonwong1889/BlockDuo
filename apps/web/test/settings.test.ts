import { describe, expect, it } from 'vitest';
import { resolveReducedMotion } from '../src/storage';

describe('resolveReducedMotion', () => {
  it('follows the device while the toggle has never been used', () => {
    expect(resolveReducedMotion(null, true)).toBe(true);
    expect(resolveReducedMotion(null, false)).toBe(false);
  });

  it('lets an explicit no override a device that asked to reduce motion', () => {
    expect(resolveReducedMotion(false, true)).toBe(false);
  });

  it('lets an explicit yes reduce motion on a device that did not ask', () => {
    expect(resolveReducedMotion(true, false)).toBe(true);
  });
});
