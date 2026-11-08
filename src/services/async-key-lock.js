'use strict';

class AsyncKeyLock {
  constructor() { this.tails = new Map(); }

  async run(keyValue, task) {
    const key = String(keyValue);
    const previous = this.tails.get(key) || Promise.resolve();
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => hold);
    this.tails.set(key, tail);
    await previous.catch(() => {});
    try { return await task(); }
    finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

module.exports = AsyncKeyLock;
