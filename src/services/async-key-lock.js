'use strict';

class AsyncKeyLock {
  constructor() {
    this.tails = new Map();
    this.counts = new Map();
    this.epoch = 0;
  }

  async run(keyValue, task, { waitTimeoutMs, executionTimeoutMs = 30000 } = {}) {
    const key = String(keyValue);
    const parsedExecMs = Number(executionTimeoutMs);
    const effectiveExecMs = Number.isFinite(parsedExecMs) ? parsedExecMs : 30000;
    const effectiveWaitMs = waitTimeoutMs === undefined ? Math.max(30000, effectiveExecMs) : waitTimeoutMs;
    const runEpoch = this.epoch;
    const count = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, count);

    const previous = this.tails.get(key) || Promise.resolve();
    let release;
    let released = false;
    const hold = new Promise((resolve) => {
      release = () => {
        if (!released) {
          released = true;
          resolve();
        }
      };
    });

    const tail = previous.then(() => hold, () => hold);
    this.tails.set(key, tail);

    let waitTimer = null;
    const timeoutPromise = new Promise((_, reject) => {
      if (effectiveWaitMs > 0) {
        waitTimer = setTimeout(() => {
          reject(new Error(`Timeout waiting for local key lock: ${key} (${effectiveWaitMs}ms)`));
        }, effectiveWaitMs);
        waitTimer.unref?.();
      }
    });

    try {
      await Promise.race([previous.catch(() => {}), timeoutPromise]);
    } catch (waitErr) {
      release();
      this.decrementCount(key, tail, runEpoch);
      throw waitErr;
    } finally {
      if (waitTimer) clearTimeout(waitTimer);
    }

    if (runEpoch !== this.epoch) {
      release();
      this.decrementCount(key, tail, runEpoch);
      throw new Error(`Lock cleared while waiting for key: ${key}`);
    }

    let execTimer = null;
    let timedOut = false;
    let taskSettled = false;
    let cleanedUp = false;
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const cleanupOnce = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      release();
      this.decrementCount(key, tail, runEpoch);
    };

    let taskPromise;
    try {
      taskPromise = Promise.resolve(task(ac ? { signal: ac.signal } : {}));
    } catch (syncErr) {
      taskPromise = Promise.reject(syncErr);
    }

    const execTimeoutPromise = new Promise((_, reject) => {
      if (effectiveExecMs > 0) {
        execTimer = setTimeout(() => {
          if (taskSettled) return;
          timedOut = true;
          const err = new Error(`Execution timeout for local key lock: ${key} (${effectiveExecMs}ms)`);
          ac?.abort(err);
          reject(err);
        }, effectiveExecMs);
        execTimer.unref?.();
      }
    });

    taskPromise.finally(() => {
      taskSettled = true;
      if (timedOut) {
        cleanupOnce();
      }
    }).catch(() => {});

    try {
      return await Promise.race([taskPromise, execTimeoutPromise]);
    } finally {
      if (execTimer) clearTimeout(execTimer);
      if (!timedOut || taskSettled) {
        cleanupOnce();
      }
    }
  }

  decrementCount(key, tail, runEpoch = this.epoch) {
    if (runEpoch !== this.epoch) return;
    const current = (this.counts.get(key) || 1) - 1;
    if (current <= 0) {
      this.counts.delete(key);
      if (!tail || this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    } else {
      this.counts.set(key, current);
    }
  }

  size() {
    return this.tails.size;
  }

  clear() {
    this.epoch += 1;
    this.tails.clear();
    this.counts.clear();
  }
}

module.exports = AsyncKeyLock;
