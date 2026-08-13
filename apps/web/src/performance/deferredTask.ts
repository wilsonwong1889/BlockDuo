interface IdleHost {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
  cancelIdleCallback?: (id: number) => void;
}

export interface DeferredTask {
  /** Mark work dirty and wait for a quiet/idle window. Repeated calls coalesce. */
  schedule: () => void;
  /** Run dirty work synchronously, used when the app backgrounds or navigates. */
  flush: () => void;
  /** Forget dirty work and cancel every pending callback. */
  cancel: () => void;
}

/**
 * Coalesce expensive best-effort work behind interaction and animation.
 *
 * The quiet timer keeps a burst of moves free of storage/serialization work,
 * while maxWait guarantees a long uninterrupted game is still checkpointed.
 * Once quiet, requestIdleCallback lets the browser pick the least disruptive
 * moment; the timeout fallback works in Safari and native WebViews without it.
 */
export function createDeferredTask(
  task: () => void,
  quietMs = 1_200,
  maxWaitMs = 6_000,
): DeferredTask {
  let dirty = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleCallback: number | null = null;

  const idleHost = globalThis as typeof globalThis & IdleHost;

  const cancelQuiet = () => {
    if (quietTimer !== null) clearTimeout(quietTimer);
    quietTimer = null;
  };

  const cancelIdle = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
    if (idleCallback !== null) idleHost.cancelIdleCallback?.(idleCallback);
    idleCallback = null;
  };

  const cancelTimers = () => {
    cancelQuiet();
    cancelIdle();
    if (maxTimer !== null) clearTimeout(maxTimer);
    maxTimer = null;
  };

  const run = () => {
    if (!dirty) return;
    dirty = false;
    cancelTimers();
    task();
  };

  const requestRun = () => {
    cancelQuiet();
    cancelIdle();
    if (!dirty) return;
    if (idleHost.requestIdleCallback) {
      idleCallback = idleHost.requestIdleCallback(run, { timeout: 1_000 });
    } else {
      idleTimer = setTimeout(run, 0);
    }
  };

  return {
    schedule() {
      dirty = true;
      cancelQuiet();
      cancelIdle();
      quietTimer = setTimeout(requestRun, quietMs);
      if (maxTimer === null) {
        maxTimer = setTimeout(() => {
          maxTimer = null;
          requestRun();
        }, maxWaitMs);
      }
    },
    flush: run,
    cancel() {
      dirty = false;
      cancelTimers();
    },
  };
}
