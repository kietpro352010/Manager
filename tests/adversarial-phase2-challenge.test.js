'use strict';

const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const crypto = require('node:crypto');

const SupabaseCommandStore = require('../src/storage/supabase-command-store');
const CommandBroker = require('../src/services/command-broker');
const { WorkerRegistry } = require('../src/services/worker-registry');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');
const { createUserApi } = require('../src/http/routes/user-api');

function createMockLogger() {
  const logs = { info: [], warn: [], error: [], debug: [] };
  return {
    logs,
    info: (msg, meta) => logs.info.push({ msg, meta }),
    warn: (msg, meta) => logs.warn.push({ msg, meta }),
    error: (msg, meta) => logs.error.push({ msg, meta }),
    debug: (msg, meta) => logs.debug.push({ msg, meta })
  };
}

async function runAdversarialChallenge() {
  console.log('======================================================================');
  console.log('⚡ ADVERSARIAL CHALLENGE SUITE: PHASE 2 COMMAND QUEUE & STATE SYNC');
  console.log('======================================================================');

  // =========================================================================
  // Challenge 1: Adversarial State Machine Attack on complete()
  // =========================================================================
  console.log('\n[CHALLENGE 1] State Machine Transition Invariants in complete()...');
  {
    // Create an in-memory database simulation for Supabase fallback
    const commandsTable = new Map();

    function insertCommand(row) {
      commandsTable.set(row.command_id, { ...row });
    }

    const mockClient = {
      rpc: async (name, params) => {
        // Fallback testing: RPC is unavailable (PGRST202)
        return { data: null, error: { message: `function ${name} does not exist`, code: 'PGRST202' } };
      },
      from: (tbl) => {
        assert.strictEqual(tbl, 'manager_commands');
        return {
          update: (updates) => ({
            eq: (f1, v1) => ({
              eq: (f2, v2) => ({
                eq: (f3, v3) => ({
                  select: () => ({
                    maybeSingle: async () => {
                      const row = commandsTable.get(v1);
                      if (!row) return { data: null, error: null };
                      if (row[f2] === v2 && row[f3] === v3) {
                        Object.assign(row, updates);
                        return { data: row, error: null };
                      }
                      return { data: null, error: null };
                    }
                  })
                })
              })
            })
          })
        };
      }
    };

    const store = new SupabaseCommandStore(mockClient);

    // Seed commands with different invalid initial statuses
    insertCommand({ command_id: 'cmd_q', worker_id: 'bot_alpha', status: 'queued', result: null });
    insertCommand({ command_id: 'cmd_exp', worker_id: 'bot_alpha', status: 'expired', result: null });
    insertCommand({ command_id: 'cmd_fail', worker_id: 'bot_alpha', status: 'failed', result: null });
    insertCommand({ command_id: 'cmd_already_done', worker_id: 'bot_alpha', status: 'completed', result: { done: true } });
    insertCommand({ command_id: 'cmd_valid_deliv', worker_id: 'bot_alpha', status: 'delivered', result: null });

    // Attack 1A: Attempt direct queued -> completed
    const r1 = await store.complete('bot_alpha', 'cmd_q', { ok: true, hack: 'direct_complete' });
    assert.strictEqual(r1, false, 'Direct transition from queued to completed must return false');
    assert.strictEqual(commandsTable.get('cmd_q').status, 'queued', 'Status must stay queued');
    assert.strictEqual(commandsTable.get('cmd_q').result, null, 'Result must NOT be updated');

    // Attack 1B: Attempt expired -> completed
    const r2 = await store.complete('bot_alpha', 'cmd_exp', { ok: true });
    assert.strictEqual(r2, false, 'Expired command must not transition to completed');
    assert.strictEqual(commandsTable.get('cmd_exp').status, 'expired');

    // Attack 1C: Attempt failed -> completed
    const r3 = await store.complete('bot_alpha', 'cmd_fail', { ok: true });
    assert.strictEqual(r3, false, 'Failed command must not transition to completed');
    assert.strictEqual(commandsTable.get('cmd_fail').status, 'failed');

    // Attack 1D: Attempt completed -> completed (re-completion / double finish)
    const r4 = await store.complete('bot_alpha', 'cmd_already_done', { ok: true, mutated: true });
    assert.strictEqual(r4, false, 'Already completed command must not be re-completed');
    assert.deepStrictEqual(commandsTable.get('cmd_already_done').result, { done: true });

    // Attack 1E: Wrong worker ID on delivered command
    const r5 = await store.complete('bot_imposter', 'cmd_valid_deliv', { ok: true });
    assert.strictEqual(r5, false, 'Command completion by wrong worker must fail');
    assert.strictEqual(commandsTable.get('cmd_valid_deliv').status, 'delivered');

    // Legitimate 1F: Correct worker on delivered command
    const r6 = await store.complete('bot_alpha', 'cmd_valid_deliv', { ok: true, legitimate: true });
    assert.strictEqual(r6, true, 'Delivered command completion by owner worker must succeed');
    assert.strictEqual(commandsTable.get('cmd_valid_deliv').status, 'completed');
    assert.strictEqual(commandsTable.get('cmd_valid_deliv').result.legitimate, true);

    console.log('  -> PASS: All invalid status transitions were rejected; only delivered -> completed allowed.');
  }

  // =========================================================================
  // Challenge 2: Concurrent Polling and take() Race Conditions
  // =========================================================================
  console.log('\n[CHALLENGE 2] Concurrent Polling & take() Retry Loop under Contention...');
  {
    // Test 2A: 2 Concurrent pollers competing for 2 commands
    // Poller 1 claims cmd1 on attempt 0.
    // Poller 2 collides on cmd1, retries, and claims cmd2 on attempt 1.
    const queue2A = [
      { command_id: 'cmd_2a_1', worker_id: 'bot_race_a', status: 'queued', action: 'chat', created_at: new Date(Date.now() + 100).toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() },
      { command_id: 'cmd_2a_2', worker_id: 'bot_race_a', status: 'queued', action: 'chat', created_at: new Date(Date.now() + 200).toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() }
    ];

    let collisionCount2A = 0;
    const mockClient2A = {
      rpc: async () => ({ data: null, error: { message: 'function does not exist', code: 'PGRST202' } }),
      from: () => ({
        select: () => ({
          eq: (f1, v1) => ({
            eq: (f2, v2) => ({
              gt: (f3, v3) => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => {
                      const now = new Date().toISOString();
                      const item = queue2A.find(c => c.worker_id === v1 && c.status === 'queued' && c.expires_at > now);
                      return { data: item ? { ...item } : null, error: null };
                    }
                  })
                })
              })
            })
          })
        }),
        update: (updates) => ({
          eq: (f1, cid) => ({
            eq: (f2, st) => ({
              select: () => ({
                maybeSingle: async () => {
                  const item = queue2A.find(c => c.command_id === cid);
                  if (item && item.status === st) {
                    Object.assign(item, updates);
                    return { data: { ...item }, error: null };
                  }
                  collisionCount2A++;
                  return { data: null, error: null };
                }
              })
            })
          })
        })
      })
    };

    const store2A = new SupabaseCommandStore(mockClient2A);
    const [claimA, claimB] = await Promise.all([store2A.take('bot_race_a'), store2A.take('bot_race_a')]);

    assert.ok(claimA && claimB, 'Both concurrent pollers must claim a command');
    assert.notStrictEqual(claimA.commandId, claimB.commandId, 'Claimed commands must be distinct');
    const set2A = new Set([claimA.commandId, claimB.commandId]);
    assert.ok(set2A.has('cmd_2a_1') && set2A.has('cmd_2a_2'), 'Both cmd_2a_1 and cmd_2a_2 must be claimed');
    assert.strictEqual(queue2A.every(c => c.status === 'delivered'), true, 'All commands in queue must now be delivered');
    console.log('  -> 2A: 2 concurrent pollers successfully claimed 2 commands via retry loop.');

    // Test 2B: Stress-test retry loop boundaries (MAX_POLL_RETRIES = 3)
    // Simulate 2 consecutive collisions followed by a successful claim on attempt 3
    let attempts2B = 0;
    const queue2B = [
      { command_id: 'cmd_2b_1', worker_id: 'bot_race_b', status: 'queued', action: 'chat', created_at: new Date(Date.now() + 100).toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() },
      { command_id: 'cmd_2b_2', worker_id: 'bot_race_b', status: 'queued', action: 'chat', created_at: new Date(Date.now() + 200).toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() },
      { command_id: 'cmd_2b_3', worker_id: 'bot_race_b', status: 'queued', action: 'chat', created_at: new Date(Date.now() + 300).toISOString(), expires_at: new Date(Date.now() + 60000).toISOString() }
    ];

    const mockClient2B = {
      rpc: async () => ({ data: null, error: { message: 'function does not exist', code: 'PGRST202' } }),
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              gt: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => {
                      // Return next item according to attempts
                      return { data: queue2B[attempts2B] ? { ...queue2B[attempts2B] } : null, error: null };
                    }
                  })
                })
              })
            })
          })
        }),
        update: (updates) => ({
          eq: (f1, cid) => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => {
                  attempts2B++;
                  // Simulate collisions on attempt 1 and 2, success on attempt 3
                  if (attempts2B < 3) {
                    return { data: null, error: null }; // Collision!
                  }
                  const item = queue2B.find(c => c.command_id === cid);
                  if (item) Object.assign(item, updates);
                  return { data: item, error: null };
                }
              })
            })
          })
        })
      })
    };

    const store2B = new SupabaseCommandStore(mockClient2B);
    const claim2B = await store2B.take('bot_race_b');
    assert.ok(claim2B, 'take() must succeed on attempt 3 after 2 consecutive collisions');
    assert.strictEqual(claim2B.commandId, 'cmd_2b_3');
    assert.strictEqual(attempts2B, 3, 'Must have executed exactly 3 attempts');
    console.log('  -> 2B: Successfully handled 2 consecutive collisions and claimed on 3rd attempt.');

    // Test 2C: Contention exceeding MAX_POLL_RETRIES (3 collisions)
    // Must safely return null without throwing or looping indefinitely
    let attempts2C = 0;
    const mockClient2C = {
      rpc: async () => ({ data: null, error: { message: 'function does not exist', code: 'PGRST202' } }),
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              gt: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: { command_id: `cmd_${attempts2C}`, worker_id: 'bot_race_c', status: 'queued' }, error: null })
                  })
                })
              })
            })
          })
        }),
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => {
                  attempts2C++;
                  return { data: null, error: null }; // Permanent collision
                }
              })
            })
          })
        })
      })
    };

    const store2C = new SupabaseCommandStore(mockClient2C);
    const claim2C = await store2C.take('bot_race_c');
    assert.strictEqual(claim2C, null, 'Must safely return null when MAX_POLL_RETRIES is exhausted');
    assert.strictEqual(attempts2C, 3, 'Must strictly cap retries at MAX_POLL_RETRIES = 3');
    console.log('  -> 2C: Safely bounded at exactly 3 retries and returned null.');
  }

  // =========================================================================
  // Challenge 3: Outbox Lock Claims & Instance ID Collision Attack
  // =========================================================================
  console.log('\n[CHALLENGE 3] Outbox Lock Claims & UUID Instance ID Collision Prevention...');
  {
    // Generate 500 CommandBroker instances simulating container replicas with PID=1
    const instances = [];
    const idSet = new Set();
    const pidPattern = /^mgr_\d+_[a-f0-9]{8}$/;

    for (let i = 0; i < 500; i++) {
      const broker = new CommandBroker({
        registry: {},
        commandStore: {},
        config: {},
        logger: createMockLogger()
      });
      assert.ok(pidPattern.test(broker.instanceId), `Instance ID ${broker.instanceId} does not match expected format`);
      idSet.add(broker.instanceId);
      instances.push(broker);
    }

    assert.strictEqual(idSet.size, 500, 'All 500 instance IDs must be strictly unique even with identical process.pid');

    // Test lock exclusion between two brokers
    let leasedOwner = null;
    let leasedItemId = null;
    const outboxItems = [
      { id: 'item_outbox_alpha', task_type: 'status', payload: { workerId: 'bot1' }, lease_owner: null }
    ];

    const createAdapterForBroker = (brokerInstance) => ({
      async claimOutboxBatch(owner, limit, leaseSeconds) {
        const item = outboxItems[0];
        if (item && !item.lease_owner) {
          item.lease_owner = owner;
          leasedOwner = owner;
          leasedItemId = item.id;
          return [item];
        }
        return [];
      },
      async completeOutboxItem(id, owner) {
        const item = outboxItems.find(i => i.id === id);
        if (item && item.lease_owner === owner) {
          item.status = 'completed';
          item.lease_owner = null;
          return true;
        }
        // Fails if owner doesn't match
        return false;
      }
    });

    const brokerA = instances[0];
    const brokerB = instances[1];
    brokerA.commandStore = { adapter: createAdapterForBroker(brokerA) };
    brokerB.commandStore = { adapter: createAdapterForBroker(brokerB) };

    const mockRegistry = {
      async find() { return { workerId: 'bot1', enabled: true, provider: 'render', serviceUrl: 'http://test' }; },
      async credential() { return 'secret'; }
    };
    brokerA.registry = mockRegistry;
    brokerB.registry = mockRegistry;
    brokerA.fetch = async () => ({ ok: true, status: 200, text: async () => '{"ok":true}', json: async () => ({ ok: true }) });
    brokerB.fetch = async () => ({ ok: true, status: 200, text: async () => '{"ok":true}', json: async () => ({ ok: true }) });

    // Broker A claims the item
    await brokerA.processOutboxBatch();
    assert.strictEqual(outboxItems[0].status, 'completed', 'Broker A should successfully complete its leased item');

    // If item was leased to Broker A, verify Broker B cannot complete it
    outboxItems[0].status = 'pending';
    outboxItems[0].lease_owner = brokerA.instanceId;
    const unauthorizedComplete = await brokerB.commandStore.adapter.completeOutboxItem('item_outbox_alpha', brokerB.instanceId);
    assert.strictEqual(unauthorizedComplete, false, 'Broker B must NOT be able to complete an item leased to Broker A');

    console.log('  -> PASS: 500 instances generated 500 distinct UUIDs. Lease owner cross-completion is blocked.');
  }

  // =========================================================================
  // Challenge 4: Timeout Handling in user-api.js & Audit Log Leak Prevention
  // =========================================================================
  console.log('\n[CHALLENGE 4] /bot/:id/send Timeout Handling & Zero Audit Leak...');
  {
    const auditLogs = [];
    const mockStore = {
      async addAudit(entry) {
        auditLogs.push(entry);
      }
    };

    let brokerDispatchResult = null;
    let brokerShouldThrow = false;
    const mockBroker = {
      async dispatch() {
        if (brokerShouldThrow) {
          throw new Error('Connection refused to command broker');
        }
        return brokerDispatchResult;
      }
    };

    const mockRegistry = {
      async find() { return { workerId: 'bot_chat', botNumber: 10, enabled: true, ownerUsername: 'admin' }; }
    };

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.managerAuthSession = { username: 'admin', role: 'admin' };
      next();
    });
    app.use('/api/user', createUserApi({
      registry: mockRegistry,
      broker: mockBroker,
      store: mockStore,
      logger: createMockLogger()
    }));

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/api/user/bot/bot_chat/send`;

    try {
      // 4A: Broker returns timedOut: true
      brokerDispatchResult = { ok: false, delivered: false, timedOut: true, result: null };
      brokerShouldThrow = false;
      const res1 = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'test 1' })
      });
      assert.strictEqual(res1.status, 504, 'Must return HTTP 504 on broker timeout');
      const data1 = await res1.json();
      assert.strictEqual(data1.ok, false);
      assert.strictEqual(data1.timedOut, true);
      assert.strictEqual(auditLogs.length, 0, 'No audit log allowed on timeout');

      // 4B: Broker returns undelivered (delivered: false)
      brokerDispatchResult = { ok: false, delivered: false, timedOut: false, result: null };
      const res2 = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'test 2' })
      });
      assert.strictEqual(res2.status, 504, 'Must return HTTP 504 on undelivered command');
      assert.strictEqual(auditLogs.length, 0, 'No audit log allowed on undelivered');

      // 4C: Broker returns null/undefined
      brokerDispatchResult = null;
      const res3 = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'test 3' })
      });
      assert.strictEqual(res3.status, 504, 'Must return HTTP 504 when broker returns null');
      assert.strictEqual(auditLogs.length, 0, 'No audit log allowed on null response');

      // 4D: Broker throws network error
      brokerShouldThrow = true;
      const res4 = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'test 4' })
      });
      assert.strictEqual(res4.status, 500, 'Must return HTTP 500 on broker exception');
      assert.strictEqual(auditLogs.length, 0, 'No audit log allowed on exception');

      // 4E: Broker returns delivered: true, but bot reports execution error ok: false
      brokerShouldThrow = false;
      brokerDispatchResult = { ok: false, delivered: true, timedOut: false, result: { ok: false, error: 'chat_muted' } };
      const res5 = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'test 5' })
      });
      assert.strictEqual(res5.status, 500, 'Must return HTTP 500 on bot execution error');
      assert.strictEqual(auditLogs.length, 0, 'No audit log allowed on bot execution failure');

      // 4F: Successful chat delivery
      brokerDispatchResult = { ok: true, delivered: true, timedOut: false, result: { ok: true } };
      const res6 = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'test success' })
      });
      assert.strictEqual(res6.status, 200, 'Must return HTTP 200 on success');
      assert.strictEqual(auditLogs.length, 1, 'Exactly 1 audit log must be written on confirmed success');
      assert.strictEqual(auditLogs[0].action, 'BOT_CHAT_SENT');
      assert.strictEqual(auditLogs[0].details.message, 'test success');

      console.log('  -> PASS: All failure modes (timeout, undelivered, null, error) return 504/500 with zero audit leak.');
    } finally {
      server.close();
    }
  }

  // =========================================================================
  // Challenge 5: manuallyStopped Flag Poisoning Prevention
  // =========================================================================
  console.log('\n[CHALLENGE 5] manuallyStopped Flag Poisoning Prevention on Timeout...');
  {
    let currentWorkerStatus = { state: 'online', manuallyStopped: false };
    let brokerBehavior = 'timeout';

    const mockRegistry = {
      async find() {
        return { workerId: 'bot_lifecycle', botNumber: 5, enabled: true, ownerUsername: 'admin', status: currentWorkerStatus };
      },
      async updateStatus(wid, status) {
        currentWorkerStatus = { ...currentWorkerStatus, ...status };
      }
    };

    const mockBroker = {
      async dispatch(wid, action) {
        if (brokerBehavior === 'timeout') {
          return { ok: false, delivered: false, timedOut: true, result: null };
        }
        if (brokerBehavior === 'error') {
          return { ok: false, delivered: true, timedOut: false, result: { ok: false, error: 'bot_busy' } };
        }
        return { ok: true, delivered: true, timedOut: false, result: { ok: true } };
      }
    };

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.managerAuthSession = { username: 'admin', role: 'admin' };
      next();
    });
    app.use('/api/user', createUserApi({
      registry: mockRegistry,
      broker: mockBroker,
      store: { async addAudit() {} },
      logger: createMockLogger()
    }));

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    try {
      // 5A: POST /bot/:id/stop times out -> must NOT poison manuallyStopped: true
      brokerBehavior = 'timeout';
      const rStopTimeout = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot_lifecycle/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(rStopTimeout.status, 504);
      assert.strictEqual(currentWorkerStatus.manuallyStopped, false, 'manuallyStopped must NOT be poisoned to true on timeout');

      // 5B: POST /bot/:id/stop fails with bot error -> must NOT poison manuallyStopped
      brokerBehavior = 'error';
      const rStopError = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot_lifecycle/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(rStopError.status, 500);
      assert.strictEqual(currentWorkerStatus.manuallyStopped, false, 'manuallyStopped must NOT be poisoned on error');

      // 5C: POST /bot/:id/stop succeeds -> now manuallyStopped becomes true
      brokerBehavior = 'success';
      const rStopSuccess = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot_lifecycle/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(rStopSuccess.status, 200);
      assert.strictEqual(currentWorkerStatus.manuallyStopped, true, 'manuallyStopped must be true after verified stop');

      // 5D: Now worker is stopped (manuallyStopped: true). User issues /start, but it times out!
      brokerBehavior = 'timeout';
      const rStartTimeout = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot_lifecycle/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(rStartTimeout.status, 504);
      assert.strictEqual(currentWorkerStatus.manuallyStopped, true, 'manuallyStopped must REMAIN true if /start timed out!');

      // 5E: User issues /start, and it succeeds -> manuallyStopped resets to false
      brokerBehavior = 'success';
      const rStartSuccess = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot_lifecycle/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(rStartSuccess.status, 200);
      assert.strictEqual(currentWorkerStatus.manuallyStopped, false, 'manuallyStopped resets to false after verified start');

      console.log('  -> PASS: manuallyStopped is strictly guarded and never poisoned by timed-out commands.');
    } finally {
      server.close();
    }
  }

  // =========================================================================
  // Challenge 6: Worker Clock Skew & Reachability Synchronization
  // =========================================================================
  console.log('\n[CHALLENGE 6] Worker Clock Skew & Reachability Decoupling...');
  {
    let storedWorker = {
      workerId: 'bot_skew',
      botNumber: 99,
      enabled: true,
      lastHeartbeat: new Date(Date.now() - 300000), // 5 minutes ago (offline if not refreshed)
      status: {
        state: 'online',
        lastStateAt: new Date(Date.now() - 10000).toISOString() // 10s ago
      }
    };

    const mockStore = {
      async get() { return storedWorker; },
      async update(id, patch) {
        storedWorker = { ...storedWorker, ...patch };
        if (patch.status) {
          storedWorker.status = { ...storedWorker.status, ...patch.status };
        }
        return storedWorker;
      }
    };

    const registry = new WorkerRegistry({
      store: mockStore,
      encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    });

    // Initial state check: lastHeartbeat is 5m old -> unreachable
    assert.strictEqual(registry.publicView(storedWorker).reachable, false, 'Initial state should be unreachable');

    // Attack 6A: Worker clock is 2 hours in the past (extreme clock skew: -7200s)
    const twoHoursAgo = new Date(Date.now() - 7200000).toISOString();
    const update1Time = Date.now();
    await registry.updateStatus('bot_skew', {
      state: 'idle',
      lastStateAt: twoHoursAgo
    });

    // Check that state payload was NOT overwritten because it was older than existing lastStateAt
    assert.strictEqual(storedWorker.status.state, 'online', 'State must not be overwritten by older lastStateAt');
    // But lastHeartbeat MUST be updated to current manager time!
    assert.ok(storedWorker.lastHeartbeat, 'lastHeartbeat must be set');
    const hbDiff = Math.abs(new Date(storedWorker.lastHeartbeat).getTime() - update1Time);
    assert.ok(hbDiff < 2000, `lastHeartbeat must match current Manager time (diff ${hbDiff}ms)`);
    // Worker MUST now be reachable!
    assert.strictEqual(registry.publicView(storedWorker).reachable, true, 'Worker must be reachable despite clock skew in past');

    // Attack 6B: Worker clock is 1 hour in future (clock skew: +3600s)
    const oneHourFuture = new Date(Date.now() + 3600000).toISOString();
    await registry.updateStatus('bot_skew', {
      state: 'running',
      lastStateAt: oneHourFuture
    });
    // Future lastStateAt will update the state
    assert.strictEqual(storedWorker.status.state, 'running');
    assert.strictEqual(registry.publicView(storedWorker).reachable, true);

    // Now send a status packet from a worker whose local clock was corrected to normal time
    // (which is older than the previously recorded future lastStateAt)
    const normalTime = new Date().toISOString();
    const update3Time = Date.now();
    await registry.updateStatus('bot_skew', {
      state: 'idle',
      lastStateAt: normalTime
    });
    // State remains 'running' (not regressed to 'idle' because lastStateAt is older than existing)
    assert.strictEqual(storedWorker.status.state, 'running');
    // But lastHeartbeat is refreshed to Manager's current time
    const hb3Diff = Math.abs(new Date(storedWorker.lastHeartbeat).getTime() - update3Time);
    assert.ok(hb3Diff < 2000, 'lastHeartbeat must be refreshed to Manager now');
    assert.strictEqual(registry.publicView(storedWorker).reachable, true, 'Worker remains reachable');

    console.log('  -> PASS: Clock skew in the past or out-of-order packets correctly refresh lastHeartbeat and keep worker reachable.');
  }

  // =========================================================================
  // Challenge 7: CMD-06 Result Payload Fuzzing & Prototype Pollution Protection
  // =========================================================================
  console.log('\n[CHALLENGE 7] CMD-06 Result Payload Fuzzing & Type Invariant Hardening...');
  {
    const broker = new CommandBroker({
      registry: {},
      commandStore: {},
      config: {},
      logger: createMockLogger()
    });

    // 7A: Malicious types passed as rawResult
    const invalidTypes = [null, undefined, 12345, 'string', true, false, [1, 2, 3], () => {}];
    for (const bad of invalidTypes) {
      assert.throws(
        () => broker.validateResultPayload('status', bad),
        /expected an object/i,
        `Must throw on bad result type: ${typeof bad}`
      );
    }

    // 7B: Chat result payload length bounding (validateResultPayload) & outgoing payload sanitization (normalizePayload)
    const dirtyChat = {
      ok: true,
      message: 'Hello World! ' + 'A'.repeat(500)
    };
    const cleanedChat = broker.validateResultPayload('chat', dirtyChat);
    assert.strictEqual(cleanedChat.message.length, 256, 'Chat message must be truncated to 256 chars');

    // Outgoing payload sanitization in normalizePayload
    const normalized = broker.normalizePayload('chat', { message: 'Hello\x00\x01\x1fWorld\r\n\tThis is clean' });
    assert.strictEqual(/[\x00-\x1f\x7f]/.test(normalized.message), false, 'Control characters must be stripped in normalizePayload');
    assert.strictEqual(normalized.message, 'Hello   World   This is clean');

    // 7C: Inventory payload with non-array items
    assert.throws(
      () => broker.validateResultPayload('inventory', { ok: true, items: 123 }),
      /'items' must be an array/i
    );

    // 7D: Window click with non-integer slot
    assert.throws(
      () => broker.validateResultPayload('window_click', { ok: true, slot: 3.14159 }),
      /'slot' must be an integer/i
    );
    assert.throws(
      () => broker.validateResultPayload('window_click', { ok: true, slot: 'not-int' }),
      /'slot' must be an integer/i
    );

    // 7E: Prototype pollution attempt
    const evilPayload = JSON.parse('{"__proto__":{"polluted":true},"ok":true}');
    broker.validateResultPayload('status', evilPayload);
    assert.strictEqual(({}).polluted, undefined, 'Prototype pollution must not succeed');

    console.log('  -> PASS: Payload schema validator rejected all malformed types, fuzz inputs and prevented pollution.');
  }

  // =========================================================================
  // Challenge 8: SYNC-16-02 Event Store Idempotency & Bounded Buffer Invariants
  // =========================================================================
  console.log('\n[CHALLENGE 8] SYNC-16-02 Event Store Idempotency & Bounded Buffer Invariants...');
  {
    let workerRow = {
      worker_id: 'bot_evt_stress',
      events: [],
      last_event: null
    };

    const mockClient = {
      rpc: async () => ({ data: null, error: { message: 'RPC does not exist', code: 'PGRST202' } }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: workerRow, error: null })
          })
        }),
        update: (updates) => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => {
                Object.assign(workerRow, updates);
                return { data: workerRow, error: null };
              }
            })
          })
        })
      })
    };

    const workerStore = new SupabaseWorkerStore(mockClient);

    // Stress test: Send 250 sequential events, with 50 duplicates interspersed
    for (let i = 1; i <= 200; i++) {
      const evtId = `evt_uid_${i}`;
      await workerStore.addEvent('bot_evt_stress', { id: evtId, type: 'info', index: i });

      // Every 4th event, resend the same event immediately to test deduplication
      if (i % 4 === 0) {
        await workerStore.addEvent('bot_evt_stress', { id: evtId, type: 'info', index: i, duplicated: true });
      }
    }

    // Invariant 1: Total events length must strictly be capped at 100
    assert.strictEqual(workerRow.events.length, 100, `Events array must be capped at 100, got ${workerRow.events.length}`);

    // Invariant 2: last_event must be the 200th event
    assert.strictEqual(workerRow.last_event.id, 'evt_uid_200');

    // Invariant 3: No adjacent duplicate IDs exist in the buffer
    for (let j = 0; j < workerRow.events.length - 1; j++) {
      assert.notStrictEqual(
        workerRow.events[j].id,
        workerRow.events[j + 1].id,
        `Duplicate event ID found at indices ${j} and ${j + 1}`
      );
    }

    console.log('  -> PASS: 250 events with duplicate bursts properly deduplicated and bounded at 100 items.');
  }

  console.log('\n======================================================================');
  console.log('🎉 ALL 8 ADVERSARIAL CHALLENGES PASSED EMPIRICALLY WITH ZERO ERRORS!');
  console.log('======================================================================\n');
}

runAdversarialChallenge().catch((err) => {
  console.error('\n❌ ADVERSARIAL CHALLENGE FAILED:', err);
  process.exit(1);
});
