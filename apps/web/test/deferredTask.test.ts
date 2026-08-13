import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredTask } from '../src/performance/deferredTask';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('deferred task', () => {
  it('coalesces bursts until the caller has been quiet', () => {
    const work = vi.fn();
    const deferred = createDeferredTask(work, 1_000, 5_000);

    deferred.schedule();
    vi.advanceTimersByTime(700);
    deferred.schedule();
    vi.advanceTimersByTime(999);
    expect(work).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    vi.runOnlyPendingTimers();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('checkpoints continuous activity at the maximum wait', () => {
    const work = vi.fn();
    const deferred = createDeferredTask(work, 1_000, 2_500);

    deferred.schedule();
    vi.advanceTimersByTime(800);
    deferred.schedule();
    vi.advanceTimersByTime(800);
    deferred.schedule();
    vi.advanceTimersByTime(899);
    expect(work).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    vi.runOnlyPendingTimers();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('flushes immediately and cancels obsolete work', () => {
    const work = vi.fn();
    const deferred = createDeferredTask(work);

    deferred.schedule();
    deferred.flush();
    deferred.schedule();
    deferred.cancel();
    vi.runAllTimers();

    expect(work).toHaveBeenCalledTimes(1);
  });
});
