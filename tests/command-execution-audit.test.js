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

async function runTests() {
  console.log('--- [COMMAND QUEUE ENGINE & BOTWORKER LIFECYCLE AUDIT TESTS (CMD-01..08, API-05..09, SYNC-16-01..02)] ---');

  // =========================================================================
  // 1. CMD-01: Enqueue Fallback Policy RPC Enforcement
  // =========================================================================
  console.log('1. Testing CMD-01: Enqueue Fallback Policy RPC Enforcement...');
  {
    // Case 1: RPC fails with permission/policy error (code 42501) -> MUST throw, NOT silently fallback
    const rpcPolicyError = { message: 'permission denied for table manager_commands', code: '42501' };
    const mockClientPolicyErr = {
      rpc: async () => ({ data: null, error: rpcPolicyError }),
      from: () => {
        throw new Error('Fallback table insert should NOT have been called on policy error!');
      }
    };
    const storePolicyErr = new SupabaseCommandStore(mockClientPolicyErr);
    await assert.rejects(
      storePolicyErr.enqueue({ workerId: 'w1', action: 'chat', payload: { message: 'hello' } }),
      (err) => err.code === '42501' || err.message.includes('permission denied'),
      'Must rethrow policy RPC rejection'
    );

    // Case 2: RPC missing / unavailable (PGRST202) -> MUST fallback cleanly
    let fallbackInserted = false;
    const mockClientRpcMissing = {
      rpc: async () => ({ data: null, error: { message: 'function manager_enqueue_worker_command does not exist', code: 'PGRST202' } }),
      from: () => ({
        insert: (row) => ({
          select: () => ({
            maybeSingle: async () => {
              fallbackInserted = true;
              return { data: { ...row, status: 'queued' }, error: null };
            }
          })
        })
      })
    };
    const storeRpcMissing = new SupabaseCommandStore(mockClientRpcMissing);
    const enqueued = await storeRpcMissing.enqueue({ workerId: 'w1', action: 'chat', payload: { message: 'hello' } });
    assert.strictEqual(fallbackInserted, true, 'Fallback must be used when RPC is unavailable');
    assert.strictEqual(enqueued.status, 'queued');
  }
  console.log('✅ CMD-01: Enqueue fallback policy RPC enforcement verified.');

  // =========================================================================
  // 2. CMD-02: Complete Fallback Disallows queued -> completed
  // =========================================================================
  console.log('2. Testing CMD-02: Complete Fallback Disallows queued -> completed...');
  {
    const rows = [
      { command_id: 'cmd_queued', worker_id: 'w1', status: 'queued', result: {} },
      { command_id: 'cmd_delivered', worker_id: 'w1', status: 'delivered', result: {} }
    ];

    const mockClient = {
      rpc: async () => ({ data: null, error: { message: 'function does not exist', code: 'PGRST202' } }),
      from: () => ({
        update: (updates) => ({
          eq: (f1, v1) => ({
            eq: (f2, v2) => ({
              eq: (f3, v3) => ({
                select: () => ({
                  maybeSingle: async () => {
                    const found = rows.find(r => r[f1] === v1 && r[f2] === v2 && r[f3] === v3);
                    if (found) {
                      Object.assign(found, updates);
                      return { data: found, error: null };
                    }
                    return { data: null, error: null };
                  }
                })
              })
            })
          })
        })
      })
    };

    const store = new SupabaseCommandStore(mockClient);

    // Attempting to complete a queued command directly must fail (return false)
    const completedQueued = await store.complete('w1', 'cmd_queued', { ok: true });
    assert.strictEqual(completedQueued, false, 'Direct transition from queued to completed must be disallowed');
    assert.strictEqual(rows[0].status, 'queued', 'Status must remain queued');

    // Completing a delivered command must succeed
    const completedDelivered = await store.complete('w1', 'cmd_delivered', { ok: true });
    assert.strictEqual(completedDelivered, true, 'Transition from delivered to completed must succeed');
    assert.strictEqual(rows[1].status, 'completed');
  }
  console.log('✅ CMD-02: Disallowing direct queued -> completed verified.');

  // =========================================================================
  // 3. CMD-03: Poll Fallback Concurrent Conflict Retry Loop
  // =========================================================================
  console.log('3. Testing CMD-03: Poll Fallback Concurrent Conflict Retry Loop...');
  {
    let attempts = 0;
    const queuedCommands = [
      { command_id: 'cmd_1', worker_id: 'w1', status: 'queued', action: 'chat', expires_at: new Date(Date.now() + 60000).toISOString() },
      { command_id: 'cmd_2', worker_id: 'w1', status: 'queued', action: 'status', expires_at: new Date(Date.now() + 60000).toISOString() }
    ];

    const mockClient = {
      rpc: async () => ({ data: null, error: { message: 'function does not exist', code: 'PGRST202' } }),
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              gt: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => {
                      // Return cmd_1 on attempt 0, cmd_2 on attempt 1
                      return { data: queuedCommands[attempts], error: null };
                    }
                  })
                })
              })
            })
          })
        }),
        update: (updates) => ({
          eq: (f1, v1) => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => {
                  attempts++;
                  // Simulate attempt 0 was concurrently updated by another worker (returns null)
                  if (v1 === 'cmd_1') {
                    return { data: null, error: null };
                  }
                  // Attempt 1 for cmd_2 succeeds
                  const cmd = queuedCommands.find(c => c.command_id === v1);
                  if (cmd) Object.assign(cmd, updates);
                  return { data: cmd, error: null };
                }
              })
            })
          })
        })
      })
    };

    const store = new SupabaseCommandStore(mockClient);
    const taken = await store.take('w1');
    assert.ok(taken, 'take() must return the next command via retry loop');
    assert.strictEqual(taken.commandId, 'cmd_2');
    assert.strictEqual(attempts, 2, 'Should have retried after the first concurrent collision');
  }
  console.log('✅ CMD-03: Poll fallback concurrent conflict retry loop verified.');

  // =========================================================================
  // 4. CMD-04: Durable Result Tracking in DB Surviving Restart (waitForResult)
  // =========================================================================
  console.log('4. Testing CMD-04: Durable Result Tracking in DB (waitForResult)...');
  {
    const storedCommands = new Map([
      ['cmd_done', { commandId: 'cmd_done', workerId: 'w1', action: 'status', status: 'completed', result: { ok: true, state: 'online' } }],
      ['cmd_failed', { commandId: 'cmd_failed', workerId: 'w1', action: 'chat', status: 'failed', result: { ok: false, error: 'disconnected' } }],
      ['cmd_expired', { commandId: 'cmd_expired', workerId: 'w1', action: 'inventory', status: 'expired', result: null }]
    ]);

    const mockStore = {
      async get(cid) {
        return storedCommands.get(cid) || null;
      }
    };

    const broker = new CommandBroker({
      registry: {},
      commandStore: mockStore,
      config: { commandResultTimeoutMs: 1000 },
      logger: createMockLogger()
    });

    // Case 1: In-memory waiter absent (simulating fresh Manager restart) -> recovers completed result from DB
    const resDone = await broker.waitForResult('cmd_done', { timeoutMs: 500 });
    assert.strictEqual(resDone.ok, true);
    assert.strictEqual(resDone.delivered, true);
    assert.strictEqual(resDone.result.state, 'online');

    // Case 2: Recovers failed result
    const resFailed = await broker.waitForResult('cmd_failed', { timeoutMs: 500 });
    assert.strictEqual(resFailed.ok, false);
    assert.strictEqual(resFailed.error, 'command_failed');

    // Case 3: Recovers expired result
    const resExpired = await broker.waitForResult('cmd_expired', { timeoutMs: 500 });
    assert.strictEqual(resExpired.ok, false);
    assert.strictEqual(resExpired.timedOut, true);
  }
  console.log('✅ CMD-04: Durable DB result tracking & waitForResult verified.');

  // =========================================================================
  // 5. CMD-05: Late Result Handling for Expired Commands & Timeout Disambiguation
  // =========================================================================
  console.log('5. Testing CMD-05: Late Result Handling for Expired Commands...');
  {
    const commandsDb = new Map([
      ['cmd_exp1', { commandId: 'cmd_exp1', workerId: 'w1', action: 'chat', status: 'expired', result: null }],
      ['cmd_done1', { commandId: 'cmd_done1', workerId: 'w1', action: 'status', status: 'completed', result: { ok: true } }]
    ]);

    let updateStatusCalled = false;
    const mockRegistry = {
      async updateStatus() { updateStatusCalled = true; }
    };

    const mockStore = {
      client: {
        from: (tbl) => ({
          update: (updates) => ({
            eq: (f1, v1) => ({
              eq: (f2, v2) => {
                const c = commandsDb.get(v1);
                if (c) Object.assign(c, updates);
                return Promise.resolve({ data: c, error: null });
              }
            })
          })
        })
      },
      async get(cid) { return commandsDb.get(cid) || null; },
      async complete() { return false; }
    };

    const broker = new CommandBroker({
      registry: mockRegistry,
      commandStore: mockStore,
      config: { commandResultTimeoutMs: 1000 },
      logger: createMockLogger()
    });

    // Late result reported for expired command: accepted idempotently with lateResult: true
    const lateReport = await broker.reportResult('w1', 'cmd_exp1', { ok: true, message: 'sent late' });
    assert.strictEqual(lateReport.ok, true);
    assert.strictEqual(lateReport.lateResult, true);
    assert.strictEqual(commandsDb.get('cmd_exp1').status, 'completed');

    // Result reported for already completed command: returns alreadyCompleted: true
    const alreadyDoneReport = await broker.reportResult('w1', 'cmd_done1', { ok: true });
    assert.strictEqual(alreadyDoneReport.ok, true);
    assert.strictEqual(alreadyDoneReport.alreadyCompleted, true);
  }
  console.log('✅ CMD-05: Late result handling & idempotent acceptance verified.');

  // =========================================================================
  // 6. CMD-06: Result Payload Schema Validation (validateResultPayload)
  // =========================================================================
  console.log('6. Testing CMD-06: Result Payload Schema Validation...');
  {
    const broker = new CommandBroker({
      registry: {},
      commandStore: {},
      config: {},
      logger: createMockLogger()
    });

    // 6a. Non-object result must throw
    assert.throws(
      () => broker.validateResultPayload('chat', 'not-an-object'),
      /expected an object/i
    );

    // 6b. Inventory result items must be an array if provided
    assert.throws(
      () => broker.validateResultPayload('inventory', { ok: true, items: 'not-an-array' }),
      /'items' must be an array/i
    );
    const validInv = broker.validateResultPayload('inventory', { ok: true, items: [{ id: 1, name: 'dirt' }] });
    assert.strictEqual(Array.isArray(validInv.items), true);

    // 6c. Window click slot must be integer if provided
    assert.throws(
      () => broker.validateResultPayload('window_click', { ok: true, slot: 'not-an-int' }),
      /'slot' must be an integer/i
    );
    const validClick = broker.validateResultPayload('window_click', { ok: true, slot: 5 });
    assert.strictEqual(validClick.slot, 5);

    // 6d. Chat message sanitized and truncated to 256
    const longMsg = 'a'.repeat(300);
    const validChat = broker.validateResultPayload('chat', { ok: true, message: longMsg });
    assert.strictEqual(validChat.message.length, 256);
  }
  console.log('✅ CMD-06: Result payload schema validation per action verified.');

  // =========================================================================
  // 7. CMD-07: Async cancelWorker and Awaiting clearWorker
  // =========================================================================
  console.log('7. Testing CMD-07: Async cancelWorker Awaits clearWorker...');
  {
    let clearWorkerAwaited = false;
    const mockStore = {
      async clearWorker(id) {
        await new Promise((r) => setTimeout(r, 20));
        clearWorkerAwaited = true;
      }
    };

    const broker = new CommandBroker({
      registry: {},
      commandStore: mockStore,
      config: {},
      logger: createMockLogger()
    });

    const cancelPromise = broker.cancelWorker('w1');
    assert.ok(cancelPromise instanceof Promise, 'cancelWorker must return a Promise (async)');
    await cancelPromise;
    assert.strictEqual(clearWorkerAwaited, true, 'clearWorker must have been awaited before cancelWorker resolves');
  }
  console.log('✅ CMD-07: Async cancelWorker & clearWorker completion verified.');

  // =========================================================================
  // 8. CMD-08: UUID instanceId as Outbox Lock Owner Claim
  // =========================================================================
  console.log('8. Testing CMD-08: UUID instanceId as Outbox Lock Owner Claim...');
  {
    let claimedOwner = null;
    let completedOwner = null;

    const mockAdapter = {
      async claimOutboxBatch(owner, limit, timeoutSec) {
        claimedOwner = owner;
        return [
          { id: 'outbox_1', task_type: 'status', payload: { workerId: 'w1' } }
        ];
      },
      async completeOutboxItem(id, owner) {
        completedOwner = owner;
      }
    };

    const mockRegistry = {
      async find(wid) {
        return { workerId: wid, enabled: true, provider: 'render', serviceUrl: 'http://mock-worker' };
      },
      async credential() { return 'sec123'; }
    };

    const broker = new CommandBroker({
      registry: mockRegistry,
      commandStore: { adapter: mockAdapter },
      config: {},
      logger: createMockLogger(),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, result: { state: 'online' } }),
        json: async () => ({ ok: true, result: { state: 'online' } })
      })
    });

    await broker.processOutboxBatch();
    assert.strictEqual(claimedOwner, broker.instanceId, 'Lock claim owner must be broker.instanceId (UUID)');
    assert.strictEqual(completedOwner, broker.instanceId, 'Complete claim owner must be broker.instanceId');
    assert.notStrictEqual(claimedOwner, `mgr_${process.pid}`, 'Lock claim owner must NOT be PID based');
  }
  console.log('✅ CMD-08: UUID instanceId outbox lock claim verified.');

  // =========================================================================
  // 9. API-09: Symmetrical Command Response DTO (Render vs WispByte)
  // =========================================================================
  console.log('9. Testing API-09: Symmetrical Command Response DTO...');
  {
    const mockRegistry = {
      async find(wid) {
        return {
          workerId: wid,
          enabled: true,
          provider: wid === 'render_bot' ? 'render' : 'wispbyte',
          serviceUrl: 'http://mock-render',
          lastHeartbeat: new Date().toISOString()
        };
      },
      async credential() { return 'secret'; },
      async updateStatus() {}
    };

    let enqueuedId = null;
    const mockStore = {
      async enqueue(cmd) {
        enqueuedId = cmd.commandId;
        return { ...cmd, status: 'queued' };
      },
      async expire() {},
      async complete() { return true; }
    };

    const broker = new CommandBroker({
      registry: mockRegistry,
      commandStore: mockStore,
      config: { commandResultTimeoutMs: 100 },
      logger: createMockLogger(),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, result: { ok: true, msg: 'chat sent' } }),
        json: async () => ({ ok: true, result: { ok: true, msg: 'chat sent' } })
      })
    });

    // 9a. Render push response shape
    const renderRes = await broker.dispatch('render_bot', 'chat', { message: 'hi render' });
    const expectedKeys = ['ok', 'delivered', 'timedOut', 'commandId', 'action', 'result'];
    for (const key of expectedKeys) {
      assert.ok(key in renderRes, `Render response missing key: ${key}`);
    }
    assert.strictEqual(renderRes.ok, true);
    assert.strictEqual(renderRes.delivered, true);
    assert.strictEqual(renderRes.timedOut, false);

    // 9b. WispByte pull success response shape
    const pollPromise = broker.dispatch('wisp_bot', 'chat', { message: 'hi wisp' });
    // Simulate worker reporting result
    await new Promise((r) => setTimeout(r, 10));
    await broker.reportResult('wisp_bot', enqueuedId, { ok: true, msg: 'chat sent' });
    const pollRes = await pollPromise;
    for (const key of expectedKeys) {
      assert.ok(key in pollRes, `WispByte response missing key: ${key}`);
    }
    assert.strictEqual(pollRes.ok, true);
    assert.strictEqual(pollRes.delivered, true);
    assert.strictEqual(pollRes.timedOut, false);
  }
  console.log('✅ API-09: Symmetrical command response DTO verified.');

  // =========================================================================
  // 10. API-05: Chat API Confirmation & Error Mapping (/bot/:id/send)
  // =========================================================================
  console.log('10. Testing API-05: Chat API Confirmation & Error Mapping (/bot/:id/send)...');
  {
    let auditCalled = false;
    const mockStore = {
      async addAudit() { auditCalled = true; }
    };

    let dispatchBehavior = 'timeout';
    const mockBroker = {
      async dispatch() {
        if (dispatchBehavior === 'timeout') {
          return { ok: false, delivered: false, timedOut: true, result: null };
        }
        if (dispatchBehavior === 'error') {
          return { ok: false, delivered: true, timedOut: false, result: { ok: false, error: 'bot_disconnected' } };
        }
        return { ok: true, delivered: true, timedOut: false, result: { ok: true } };
      }
    };

    const mockRegistry = {
      async find() { return { workerId: 'bot1', botNumber: 1, enabled: true, ownerUsername: 'admin' }; }
    };

    const app = express();
    app.use(express.json());
    // Attach mock session
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

    try {
      // 10a. Timeout -> returns 504 and NO audit log
      dispatchBehavior = 'timeout';
      auditCalled = false;
      const resTimeout = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'test chat' })
      });
      assert.strictEqual(resTimeout.status, 504, 'Must return HTTP 504 on command timeout');
      assert.strictEqual(auditCalled, false, 'Audit log must NOT be written when command times out');

      // 10b. Bot execution error -> returns 500
      dispatchBehavior = 'error';
      const resError = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'test chat' })
      });
      assert.strictEqual(resError.status, 500, 'Must return HTTP 500 on bot execution error');

      // 10c. Success -> returns 200 and writes audit log
      dispatchBehavior = 'success';
      const resSuccess = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'test chat' })
      });
      assert.strictEqual(resSuccess.status, 200, 'Must return HTTP 200 on confirmed delivery');
      assert.strictEqual(auditCalled, true, 'Audit log must be written on confirmed success');
    } finally {
      server.close();
    }
  }
  console.log('✅ API-05: Chat API confirmation & 504/500/200 mapping verified.');

  // =========================================================================
  // 11. API-06: Window GUI & Inventory Confirmation
  // =========================================================================
  console.log('11. Testing API-06: Window GUI & Inventory Broker Confirmation...');
  {
    let dispatchBehavior = 'timeout';
    const mockBroker = {
      async dispatch() {
        if (dispatchBehavior === 'timeout') {
          return { ok: false, delivered: false, timedOut: true, result: null };
        }
        if (dispatchBehavior === 'error') {
          return { ok: false, delivered: true, timedOut: false, result: { ok: false, error: 'no_window_open' } };
        }
        return { ok: true, delivered: true, timedOut: false, result: { ok: true, slot: 2 } };
      }
    };

    const mockRegistry = {
      async find() { return { workerId: 'bot1', botNumber: 1, enabled: true, ownerUsername: 'admin' }; }
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
      store: {},
      logger: createMockLogger()
    }));

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    try {
      // 11a. Window click timeout -> 504
      dispatchBehavior = 'timeout';
      const resClickTimeout = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot1/window/click`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slot: 2 })
      });
      assert.strictEqual(resClickTimeout.status, 504);

      // 11b. Window click error -> 500
      dispatchBehavior = 'error';
      const resClickErr = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot1/window/click`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slot: 2 })
      });
      assert.strictEqual(resClickErr.status, 500);

      // 11c. Inventory drop timeout -> 504
      dispatchBehavior = 'timeout';
      const resInvTimeout = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot1/inventory/drop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slot: 1 })
      });
      assert.strictEqual(resInvTimeout.status, 504);
    } finally {
      server.close();
    }
  }
  console.log('✅ API-06: Window click/close & inventory broker confirmation verified.');

  // =========================================================================
  // 12 & 13. API-07 & API-08: Defer manuallyStopped Flag & Lifecycle 504 Handlers
  // =========================================================================
  console.log('12 & 13. Testing API-07 & API-08: Defer manuallyStopped Flag & Lifecycle Timeout...');
  {
    let workerStatus = { state: 'online', manuallyStopped: false };
    let dispatchBehavior = 'timeout';

    const mockRegistry = {
      async find() { return { workerId: 'bot1', botNumber: 1, enabled: true, ownerUsername: 'admin', status: workerStatus }; },
      async updateStatus(wid, status) {
        workerStatus = { ...workerStatus, ...status };
      }
    };

    const mockBroker = {
      async dispatch() {
        if (dispatchBehavior === 'timeout') {
          return { ok: false, delivered: false, timedOut: true, result: null };
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
      // 12a. Stop command times out -> returns 504 and manuallyStopped is NOT set to true
      dispatchBehavior = 'timeout';
      const resStopTimeout = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot1/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(resStopTimeout.status, 504, 'Lifecycle timeout must return HTTP 504 (API-08)');
      assert.strictEqual(workerStatus.manuallyStopped, false, 'manuallyStopped must NOT be updated if execution timed out (API-07)');

      // 12b. Stop command succeeds -> returns 200 and manuallyStopped IS set to true
      dispatchBehavior = 'success';
      const resStopSuccess = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot1/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(resStopSuccess.status, 200);
      assert.strictEqual(workerStatus.manuallyStopped, true, 'manuallyStopped must be set to true upon confirmed stop (API-07)');

      // 12c. Start command succeeds -> manuallyStopped reset to false
      const resStartSuccess = await fetch(`http://127.0.0.1:${port}/api/user/bot/bot1/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(resStartSuccess.status, 200);
      assert.strictEqual(workerStatus.manuallyStopped, false, 'manuallyStopped must be reset to false upon confirmed start');
    } finally {
      server.close();
    }
  }
  console.log('✅ API-07 & API-08: Defer manuallyStopped flag & lifecycle 504 verified.');

  // =========================================================================
  // 14. SYNC-16-01: Decouple lastHeartbeat from lastStateAt
  // =========================================================================
  console.log('14. Testing SYNC-16-01: Decoupling lastHeartbeat from lastStateAt (Clock Skew)...');
  {
    let currentWorker = {
      workerId: 'w_skew',
      botNumber: 1,
      enabled: true,
      lastHeartbeat: new Date(Date.now() - 150000), // Stale heartbeat
      status: {
        state: 'online',
        lastStateAt: new Date(Date.now() + 600000).toISOString() // 10 minutes in the future!
      }
    };

    const mockStore = {
      async get() { return currentWorker; },
      async update(id, patch) {
        currentWorker = { ...currentWorker, ...patch };
        if (patch.status) currentWorker.status = { ...currentWorker.status, ...patch.status };
        return currentWorker;
      }
    };

    const registry = new WorkerRegistry({
      store: mockStore,
      encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    });

    // Send status with normal current time (older than the future lastStateAt)
    const beforeUpdate = Date.now();
    await registry.updateStatus('w_skew', {
      state: 'online',
      lastStateAt: new Date().toISOString()
    });

    // lastHeartbeat MUST be refreshed to Manager's current time despite state rejection
    assert.ok(currentWorker.lastHeartbeat, 'lastHeartbeat must be present');
    const hbTime = new Date(currentWorker.lastHeartbeat).getTime();
    assert.ok(hbTime >= beforeUpdate - 1000, 'lastHeartbeat must be refreshed to Manager current time');

    // Worker must remain reachable
    const view = registry.publicView(currentWorker);
    assert.strictEqual(view.reachable, true, 'Worker must be reachable when lastHeartbeat is refreshed');

    // Test touchHeartbeat
    const touched = await registry.touchHeartbeat('w_skew');
    assert.ok(touched);
    assert.strictEqual(touched.reachable, true);
  }
  console.log('✅ SYNC-16-01: Decouple lastHeartbeat from lastStateAt verified.');

  // =========================================================================
  // 15. SYNC-16-02: Reliable addEvent Fallback with Idempotency & Bounded 100 Array
  // =========================================================================
  console.log('15. Testing SYNC-16-02: Reliable addEvent Fallback...');
  {
    let workerRow = {
      worker_id: 'w_events',
      events: [],
      last_event: null
    };

    const mockClient = {
      rpc: async () => ({ data: null, error: { message: 'function manager_append_worker_event does not exist', code: 'PGRST202' } }),
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

    // 15a. Add unique events
    await workerStore.addEvent('w_events', { id: 'evt_1', type: 'bot_death', message: 'Died in lava' });
    await workerStore.addEvent('w_events', { id: 'evt_2', type: 'kicked', message: 'Flying is not enabled' });
    assert.strictEqual(workerRow.events.length, 2, 'Must have 2 events in array');
    assert.strictEqual(workerRow.last_event.id, 'evt_2');

    // 15b. Deduplicate identical event (same id)
    await workerStore.addEvent('w_events', { id: 'evt_2', type: 'kicked', message: 'Flying is not enabled' });
    assert.strictEqual(workerRow.events.length, 2, 'Duplicate event must NOT be appended');

    // 15c. Bounded 100 elements array
    for (let i = 3; i <= 120; i++) {
      workerRow.events.push({ id: `evt_${i}`, type: 'ping', message: `Ping ${i}` });
    }
    await workerStore.addEvent('w_events', { id: 'evt_121', type: 'ping', message: 'Overflow ping' });
    assert.strictEqual(workerRow.events.length, 100, 'Events array must be capped at 100 elements');
    assert.strictEqual(workerRow.events[workerRow.events.length - 1].id, 'evt_121');
  }
  console.log('✅ SYNC-16-02: Reliable addEvent fallback with idempotency & bounded 100 array verified.');

  console.log('\n🎉 ALL 15 PHASE 2 MANAGER AUDIT FINDINGS (CMD-01..08, API-05..09, SYNC-16-01..02) PASSED 100%!');
}

runTests().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
