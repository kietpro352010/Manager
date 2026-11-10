'use strict';

class AsyncKeyLock {
  constructor() {
    this.tails = new Map();
    this.counts = new Map();
  }

  async run(keyValue, task, { waitTimeoutMs = 12000, executionTimeoutMs = 30000 } = {}) {
    const key = String(keyValue);
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
      if (waitTimeoutMs > 0) {
        waitTimer = setTimeout(() => {
          reject(new Error(`Timeout waiting for local key lock: ${key} (${waitTimeoutMs}ms)`));
        }, waitTimeoutMs);
        waitTimer.unref?.();
      }
    });

    try {
      await Promise.race([previous.catch(() => {}), timeoutPromise]);
    } catch (waitErr) {
      release();
      this.decrementCount(key, tail);
      throw waitErr;
    } finally {
      if (waitTimer) clearTimeout(waitTimer);
    }

    let execTimer = null;
    const execTimeoutPromise = new Promise((_, reject) => {
      if (executionTimeoutMs > 0) {
        execTimer = setTimeout(() => {
          reject(new Error(`Execution timeout for local key lock: ${key} (${executionTimeoutMs}ms)`));
        }, executionTimeoutMs);
        execTimer.unref?.();
      }
    });

    try {
      return await Promise.race([task(), execTimeoutPromise]);
    } finally {
      if (execTimer) clearTimeout(execTimer);
      release();
      this.decrementCount(key, tail);
    }
  }

  decrementCount(key, tail) {
    const current = (this.counts.get(key) || 1) - 1;
    if (current <= 0) {
      this.counts.delete(key);
      this.tails.delete(key);
    } else {
      this.counts.set(key, current);
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }

  size() {
    return this.tails.size;
  }

  clear() {
    this.tails.clear();
    this.counts.clear();
  }
}

module.exports = AsyncKeyLock;
