'use strict';

const assert = require('node:assert');
const AsyncKeyLock = require('D:/manager/src/services/async-key-lock.js');

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runScenario1_BurstWaitTimeout() {
  console.log('--- Scenario 1: Burst of wait timeouts with trailing task ---');
  const lock = new AsyncKeyLock();
  let concurrent = 0;
  let maxConcurrent = 0;

  // Task 0: running for 80ms
  const t0 = lock.run('k1', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(80);
    concurrent--;
    return 't0';
  });

  // Tasks 1..20: queued with waitTimeoutMs 15ms
  const burst = [];
  for (let i = 1; i <= 20; i++) {
    burst.push(
      lock.run('k1', async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(10);
        concurrent--;
        return `t${i}`;
      }, { waitTimeoutMs: 15 }).catch((err) => {
        assert.ok(/Timeout waiting for local key lock/.test(err.message));
        return 'timeout';
      })
    );
  }

  // Wait 30ms for all burst tasks to time out waiting
  await sleep(30);

  // Task 21: arrives while Task 0 is still running
  let t21StartedAt = 0;
  const t21 = lock.run('k1', async () => {
    t21StartedAt = Date.now();
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(20);
    concurrent--;
    return 't21';
  }, { waitTimeoutMs: 200 });

  const results = await Promise.all([t0, ...burst, t21]);
  assert.strictEqual(results[0], 't0');
  for (let i = 1; i <= 20; i++) {
    assert.strictEqual(results[i], 'timeout');
  }
  assert.strictEqual(results[21], 't21');
  assert.strictEqual(maxConcurrent, 1, `maxConcurrent must be 1, got ${maxConcurrent}`);
  assert.strictEqual(lock.size(), 0, `lock.size() must be 0, got ${lock.size()}`);
  console.log('✅ Scenario 1 passed.');
}

async function runScenario2_InterleavedWaitTimeouts() {
  console.log('--- Scenario 2: Interleaved wait timeouts and executions ---');
  const lock = new AsyncKeyLock();
  let concurrent = 0;
  let maxConcurrent = 0;
  const order = [];

  const t1 = lock.run('k2', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(50);
    order.push('t1');
    concurrent--;
  });

  const t2 = lock.run('k2', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(30);
    order.push('t2');
    concurrent--;
  }, { waitTimeoutMs: 150 });

  const t3 = lock.run('k2', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(30);
    order.push('t3');
    concurrent--;
  }, { waitTimeoutMs: 20 }).catch(() => order.push('t3_timeout'));

  const t4 = lock.run('k2', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(30);
    order.push('t4');
    concurrent--;
  }, { waitTimeoutMs: 250 });

  const t5 = lock.run('k2', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(30);
    order.push('t5');
    concurrent--;
  }, { waitTimeoutMs: 15 }).catch(() => order.push('t5_timeout'));

  const t6 = lock.run('k2', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(30);
    order.push('t6');
    concurrent--;
  }, { waitTimeoutMs: 350 });

  await Promise.allSettled([t1, t2, t3, t4, t5, t6]);

  assert.strictEqual(maxConcurrent, 1, `maxConcurrent must be 1, got ${maxConcurrent}`);
  assert.strictEqual(lock.size(), 0, `lock.size() must be 0, got ${lock.size()}`);
  assert.deepStrictEqual(order, ['t5_timeout', 't3_timeout', 't1', 't2', 't4', 't6']);
  console.log('✅ Scenario 2 passed.');
}

async function runScenario3_ExecTimeoutHoldQueued() {
  console.log('--- Scenario 3: Execution timeout holds lock until task settles ---');
  const lock = new AsyncKeyLock();
  let concurrent = 0;
  let maxConcurrent = 0;
  let t1SettledAt = 0;
  let t2StartedAt = 0;

  const t1 = lock.run('k3', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(100);
    t1SettledAt = Date.now();
    concurrent--;
  }, { executionTimeoutMs: 30 }).catch((err) => {
    assert.ok(/Execution timeout/.test(err.message));
  });

  await sleep(10); // Ensure t1 starts

  const t2 = lock.run('k3', async () => {
    t2StartedAt = Date.now();
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(30);
    concurrent--;
  }, { waitTimeoutMs: 300 });

  await Promise.all([t1, t2]);
  assert.strictEqual(maxConcurrent, 1, `maxConcurrent must be 1, got ${maxConcurrent}`);
  assert.ok(t2StartedAt >= t1SettledAt - 5, `t2 (${t2StartedAt}) started before t1 settled (${t1SettledAt})`);
  assert.strictEqual(lock.size(), 0);
  console.log('✅ Scenario 3 passed.');
}

async function runScenario4_ExecTimeoutAndWaitTimeoutCombined() {
  console.log('--- Scenario 4: Exec timeout combined with queued wait timeout ---');
  const lock = new AsyncKeyLock();
  let concurrent = 0;
  let maxConcurrent = 0;
  let t1SettledAt = 0;
  let t3StartedAt = 0;

  const t1 = lock.run('k4', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(120);
    t1SettledAt = Date.now();
    concurrent--;
  }, { executionTimeoutMs: 30 }).catch(() => {});

  await sleep(5);

  // t2 will time out waiting at 50ms while t1 is still in background
  const t2 = lock.run('k4', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(30);
    concurrent--;
  }, { waitTimeoutMs: 50 }).catch(() => {});

  // t3 queued behind t2 with generous wait timeout
  const t3 = lock.run('k4', async () => {
    t3StartedAt = Date.now();
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(30);
    concurrent--;
  }, { waitTimeoutMs: 300 });

  await Promise.all([t1, t2, t3]);
  assert.strictEqual(maxConcurrent, 1, `maxConcurrent must be 1, got ${maxConcurrent}`);
  assert.ok(t3StartedAt >= t1SettledAt - 5, `t3 (${t3StartedAt}) started before t1 settled (${t1SettledAt})`);
  assert.strictEqual(lock.size(), 0);
  console.log('✅ Scenario 4 passed.');
}

async function runScenario5_SyncAndAsyncExceptions() {
  console.log('--- Scenario 5: Synchronous and Asynchronous task failures ---');
  const lock = new AsyncKeyLock();
  let concurrent = 0;
  let maxConcurrent = 0;

  // Sync throw
  await assert.rejects(
    async () => await lock.run('k5', () => { throw new Error('boom_sync'); }),
    /boom_sync/
  );
  assert.strictEqual(lock.size(), 0);

  // Async rejection
  await assert.rejects(
    async () => await lock.run('k5', async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await sleep(10);
      concurrent--;
      throw new Error('boom_async');
    }),
    /boom_async/
  );
  assert.strictEqual(lock.size(), 0);

  // Next task should work normally
  const res = await lock.run('k5', async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(10);
    concurrent--;
    return 'recovered';
  });
  assert.strictEqual(res, 'recovered');
  assert.strictEqual(maxConcurrent, 1);
  assert.strictEqual(lock.size(), 0);
  console.log('✅ Scenario 5 passed.');
}

async function runScenario6_MultiKeyIndependence() {
  console.log('--- Scenario 6: Multiple independent keys run concurrently ---');
  const lock = new AsyncKeyLock();
  let activeKeys = 0;
  let maxActiveKeys = 0;

  const tA = lock.run('keyA', async () => {
    activeKeys++;
    maxActiveKeys = Math.max(maxActiveKeys, activeKeys);
    await sleep(50);
    activeKeys--;
  });

  const tB = lock.run('keyB', async () => {
    activeKeys++;
    maxActiveKeys = Math.max(maxActiveKeys, activeKeys);
    await sleep(50);
    activeKeys--;
  });

  await Promise.all([tA, tB]);
  assert.strictEqual(maxActiveKeys, 2, 'Distinct keys must run concurrently');
  assert.strictEqual(lock.size(), 0);
  console.log('✅ Scenario 6 passed.');
}

async function runScenario7_RapidChurn() {
  console.log('--- Scenario 7: 300 rapid sequential and overlapping tasks ---');
  const lock = new AsyncKeyLock();
  let concurrent = 0;
  let maxConcurrent = 0;
  const count = 300;
  const tasks = [];

  for (let i = 0; i < count; i++) {
    tasks.push(
      lock.run('churn_key', async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(1);
        concurrent--;
        return i;
      })
    );
  }

  const results = await Promise.all(tasks);
  assert.strictEqual(results.length, count);
  assert.strictEqual(maxConcurrent, 1, `maxConcurrent must be 1, got ${maxConcurrent}`);
  assert.strictEqual(lock.size(), 0, `lock.size() must be 0, got ${lock.size()}`);
  console.log('✅ Scenario 7 passed.');
}

async function main() {
  await runScenario1_BurstWaitTimeout();
  await runScenario2_InterleavedWaitTimeouts();
  await runScenario3_ExecTimeoutHoldQueued();
  await runScenario4_ExecTimeoutAndWaitTimeoutCombined();
  await runScenario5_SyncAndAsyncExceptions();
  await runScenario6_MultiKeyIndependence();
  await runScenario7_RapidChurn();
  console.log('\n🌟 ALL 7 ADVERSARIAL STRESS TEST SCENARIOS PASSED 100%!');
}

main().catch((err) => {
  console.error('❌ ADVERSARIAL TEST FAILED:', err);
  process.exit(1);
});
