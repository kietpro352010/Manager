'use strict';

class AsyncKeyLock {
  constructor() {
    this.tails = new Map();
  }

  async run(keyValue, task, { waitTimeoutMs = 30000 } = {}) {
    const key = String(keyValue);
    const previous = this.tails.get(key) || Promise.resolve();
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => hold);
    this.tails.set(key, tail);

    let waitTimer = null;
    let timedOut = false;
    const timeoutPromise = new Promise((_, reject) => {
      if (waitTimeoutMs > 0) {
        waitTimer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Timeout waiting for local key lock: ${key}`));
        }, waitTimeoutMs);
        waitTimer.unref?.();
      }
    });

    try {
      await Promise.race([previous.catch(() => {}), timeoutPromise]);
    } finally {
      if (waitTimer) clearTimeout(waitTimer);
    }

    try {
      return await task();
    } finally {
      release();
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
  }
}

module.exports = AsyncKeyLock;
