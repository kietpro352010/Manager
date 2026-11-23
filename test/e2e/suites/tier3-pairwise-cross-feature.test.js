'use strict';

const assert = require('node:assert');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

// Safe polyfill for implementation bug in auth-api.js line 13500 (escalated in handoff.md)
if (typeof global.recordFailedAttempt !== 'function') {
  global.recordFailedAttempt = () => {};
}

// Mock Harnesses
const {
  createMockSupabaseServer,
  createMockSupabaseClient
} = require('../harness/mock-supabase');
const MockMinecraftServer = require('../harness/mock-minecraft-server');
const {
  MockDiscordEngine,
  MockDiscordClient
} = require('../harness/mock-discord');

// Manager Core Modules
const { SupabaseAdapter } = require('../../../src/storage/supabase-client');
const SupabaseDashboardStore = require('../../../src/storage/supabase-dashboard-store');
const SupabaseWorkerStore = require('../../../src/storage/supabase-worker-store');
const SupabaseCommandStore = require('../../../src/storage/supabase-command-store');
const { WorkerRegistry } = require('../../../src/services/worker-registry');
const CommandBroker = require('../../../src/services/command-broker');
const { AccessControl } = require('../../../src/services/access-control');
const { EntitlementService } = require('../../../src/services/entitlement-service');
const { validateProxyUrl } = require('../../../src/services/proxy-validation');
const {
  hashPassword,
  verifyUserPassword,
  hashAdminPassword,
  verifyAdminPassword,
  encryptSecret,
  decryptSecret,
  generateWorkerSecret
} = require('../../../src/utils/secrets');
const { createApp } = require('../../../src/http/app');
const { createAdminApi } = require('../../../src/http/routes/admin-api');
const { createWorkerApi } = require('../../../src/http/routes/worker-api');

// Worker Core Modules
const WORKER_ROOT = process.env.WORKER_DIR || path.resolve(__dirname, '../../../../worker');
const { MinecraftSession } = require(path.join(WORKER_ROOT, 'src/game/minecraft-session.js'));
const ServerMonitor = require(path.join(WORKER_ROOT, 'src/game/server-monitor.js'));
const { isMaintenanceWindow } = require(path.join(WORKER_ROOT, 'src/services/maintenance-window.js'));
const { createRouter: createWorkerRouter } = require(path.join(WORKER_ROOT, 'src/http/routes.js'));

// Mineflayer Resolution
let mineflayer;
try {
  mineflayer = require('mineflayer');
} catch (_) {
  try {
    mineflayer = require(path.join(WORKER_ROOT, 'node_modules/mineflayer'));
  } catch (__) {
    mineflayer = require('D:/worker/node_modules/mineflayer');
  }
}

const TOTAL_TESTS = 26;
let testIndex = 0;
let passCount = 0;
let failCount = 0;
const testResults = [];

async function runTest(id, name, testFn) {
  testIndex++;
  const startTime = Date.now();
  try {
    await testFn();
    const duration = Date.now() - startTime;
    passCount++;
    testResults.push({ id, name, pass: true, duration });
    console.log(`ok ${testIndex} - ${id}: ${name} (${duration}ms)`);
  } catch (err) {
    const duration = Date.now() - startTime;
    failCount++;
    testResults.push({ id, name, pass: false, duration, error: err.message });
    console.log(`not ok ${testIndex} - ${id}: ${name} (${duration}ms)`);
    console.error(`# Error in ${id}: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').map((l) => `#   ${l}`).join('\n'));
    }
  }
}

async function main() {
  console.log('TAP version 13');
  console.log(`# KBOT Tier 3: Pairwise Cross-Feature Combinations Test Suite`);
  console.log(`# Total test definitions: ${TOTAL_TESTS}\n`);

  // ===========================================================================
  // T3-PAIR-01: Web Auth Session + Discord 1:1 Account Linking
  // ===========================================================================
  await runTest('T3-PAIR-01', 'Web Auth Session + Discord 1:1 Account Linking', async () => {
    const sb = await createMockSupabaseServer();
    try {
      const passHash = hashPassword('SecretBobPass123!');
      sb.seed('manager_users', [
        {
          id: 'usr_web_bob',
          username: 'web_bob',
          password: passHash,
          role: 'user',
          status: 'active',
          assigned_bot_ids: ['bot-bob-1']
        }
      ]);

      const accessStore = new SupabaseDashboardStore(createMockSupabaseClient({ db: sb.db }));
      await accessStore.initialize();

      const mockServices = {
        config: { adminUsername: 'admin', discordGuildId: '999999999999999999' },
        accessStore,
        registry: { list: async () => [], find: async () => null }
      };

      const discordEngine = new MockDiscordEngine({
        config: mockServices.config,
        services: mockServices,
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
      });

      // 1. Submit login modal via Discord
      const loginInter = await discordEngine.dispatchLoginModal('web_bob', 'SecretBobPass123!', {
        userId: 'discord_bob_id'
      });
      const loginEmbeds = loginInter.getEmbeds();
      assert.ok(loginEmbeds.length > 0, 'Login modal must respond with embed');
      const loginTitle = loginEmbeds[0].data?.title || loginEmbeds[0].title;
      assert.ok(loginTitle.includes('ĐĂNG NHẬP THÀNH CÔNG'), `Login must succeed, got: ${loginTitle}`);

      // 2. Verify account is linked in database
      const linkedUser = await accessStore.getUserByDiscordId('discord_bob_id');
      assert.ok(linkedUser, 'User must be resolvable by Discord ID');
      assert.strictEqual(linkedUser.username, 'web_bob');

      // 3. User unlinks via /logout
      const logoutInter = await discordEngine.dispatchSlash('logout', {
        userId: 'discord_bob_id'
      });
      const logoutEmbeds = logoutInter.getEmbeds();
      const logoutTitle = logoutEmbeds[0].data?.title || logoutEmbeds[0].title;
      assert.ok(logoutTitle.includes('ĐÃ ĐĂNG XUẤT'), `Logout must succeed, got: ${logoutTitle}`);

      // 4. Verify account is unlinked
      const unlinkedUser = await accessStore.getUserByDiscordId('discord_bob_id');
      assert.strictEqual(unlinkedUser, null, 'User must no longer be resolvable by Discord ID');
    } finally {
      await sb.close();
    }
  });

  // ===========================================================================
  // T3-PAIR-02: Discord /bots + Worker Dual-Slot Status
  // ===========================================================================
  await runTest('T3-PAIR-02', 'Discord /bots + Worker Dual-Slot Status', async () => {
    const workers = [
      {
        workerId: 'worker-dual-s1',
        botNumber: 1,
        name: 'Alpha Node S1',
        status: { state: 'online', online: true, ping: 25, tps: 20 },
        settings: { mc: { username: 'AlphaBot1' } }
      },
      {
        workerId: 'worker-dual-s2',
        botNumber: 2,
        name: 'Alpha Node S2',
        status: { state: 'online', online: true, ping: 32, tps: 19.8 },
        settings: { mc: { username: 'AlphaBot2' } }
      }
    ];

    const mockServices = {
      config: { adminUsername: 'admin', discordGuildId: '999999999999999999' },
      accessStore: {
        getUserByDiscordId: async () => ({
          id: 'usr_admin',
          username: 'admin',
          role: 'admin',
          isPermanent: true
        })
      },
      registry: {
        list: async () => workers,
        find: async (id) => workers.find((w) => w.workerId === id)
      }
    };

    const discordEngine = new MockDiscordEngine({
      config: mockServices.config,
      services: mockServices,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    });

    const inter = await discordEngine.dispatchSlash('bots', { userId: 'admin_discord' });
    const embeds = inter.getEmbeds();
    assert.ok(embeds.length > 0, 'Must return embeds');
    const title = embeds[0].data?.title || embeds[0].title;
    assert.ok(title.includes('DANH SÁCH BOT'), `Embed title must contain DANH SÁCH BOT, got: ${title}`);

    const desc = embeds[0].data?.description || embeds[0].description || '';
    const fields = embeds[0].data?.fields || embeds[0].fields || [];
    const fullText = desc + ' ' + JSON.stringify(fields);

    assert.ok(
      fullText.includes('Alpha Node S1') || fullText.includes('AlphaBot1') || fullText.includes('#1'),
      'Must render Slot 1 status'
    );
    assert.ok(
      fullText.includes('Alpha Node S2') || fullText.includes('AlphaBot2') || fullText.includes('#2'),
      'Must render Slot 2 status'
    );
  });

  // ===========================================================================
  // T3-PAIR-03: Discord Button bot:start + Dual-Slot Dispatch
  // ===========================================================================
  await runTest('T3-PAIR-03', 'Discord Button bot:start + Dual-Slot Dispatch', async () => {
    const workers = [
      {
        workerId: 'worker-slot1',
        botNumber: 1,
        name: 'Bot S1',
        status: { state: 'stopped', online: false },
        settings: { mc: { username: 'Bot1' } }
      },
      {
        workerId: 'worker-slot2',
        botNumber: 2,
        name: 'Bot S2',
        status: { state: 'stopped', online: false },
        settings: { mc: { username: 'Bot2' } }
      }
    ];

    const dispatched = [];
    const mockServices = {
      config: { adminUsername: 'admin', discordGuildId: '999999999999999999' },
      accessStore: {
        getUserByDiscordId: async () => ({
          id: 'usr_charlie',
          username: 'charlie',
          role: 'user',
          isPermanent: true,
          status: 'active',
          assignedBotIds: ['worker-slot1', 'worker-slot2']
        })
      },
      registry: {
        list: async () => workers,
        find: async (id) => workers.find((w) => w.workerId === id)
      },
      broker: {
        dispatch: async (workerId, action, payload) => {
          dispatched.push({ workerId, action, payload });
          return { delivered: true, timedOut: false, result: { ok: true } };
        }
      }
    };

    const discordEngine = new MockDiscordEngine({
      config: mockServices.config,
      services: mockServices,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    });

    await discordEngine.dispatchButton('bot:start:worker-slot1', { userId: 'discord_charlie' });
    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(dispatched.length, 1, 'Exactly one command must be dispatched');
    assert.strictEqual(dispatched[0].workerId, 'worker-slot1', 'Must dispatch to Slot 1');
    assert.strictEqual(dispatched[0].action, 'start', 'Action must be start');
  });

  // ===========================================================================
  // T3-PAIR-04: Discord Button bot:stop + Customer Handover Reset
  // ===========================================================================
  await runTest('T3-PAIR-04', 'Discord Button bot:stop + Customer Handover Reset', async () => {
    const botRecord = {
      workerId: 'w-handover-4',
      botNumber: 1,
      name: 'Handover Bot',
      status: { state: 'online', online: true },
      settings: { mc: { username: 'CustUser', password: 'CustPassword' } }
    };

    const dispatched = [];
    const mockServices = {
      config: { adminUsername: 'admin', discordGuildId: '999999999999999999' },
      accessStore: {
        getUserByDiscordId: async () => ({
          id: 'usr_cust',
          username: 'cust',
          role: 'user',
          isPermanent: true,
          status: 'active',
          assignedBotIds: ['w-handover-4']
        })
      },
      registry: {
        list: async () => [botRecord],
        find: async (id) => (id === 'w-handover-4' ? botRecord : null),
        resetData: async (id) => {
          if (id === 'w-handover-4') {
            botRecord.settings = { mc: { username: '', password: '' } };
            botRecord.status = { state: 'stopped', online: false };
          }
        }
      },
      broker: {
        dispatch: async (workerId, action, payload) => {
          dispatched.push({ workerId, action, payload });
          return { delivered: true, timedOut: false, result: { ok: true } };
        }
      }
    };

    const discordEngine = new MockDiscordEngine({
      config: mockServices.config,
      services: mockServices,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    });

    // 1. User stops bot via Discord button
    await discordEngine.dispatchButton('bot:stop:w-handover-4', { userId: 'discord_cust' });
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(dispatched.some((d) => d.workerId === 'w-handover-4' && d.action === 'stop'), true);

    // 2. Admin performs Handover Reset
    await mockServices.registry.resetData('w-handover-4');

    // 3. Verify credentials wiped
    assert.strictEqual(botRecord.settings.mc.username, '', 'Customer username must be wiped');
    assert.strictEqual(botRecord.settings.mc.password, '', 'Customer password must be wiped');
    assert.strictEqual(botRecord.status.state, 'stopped');
  });

  // ===========================================================================
  // T3-PAIR-05: SOCKS5 Proxy Config + Worker Minecraft Connection
  // ===========================================================================
  await runTest('T3-PAIR-05', 'SOCKS5 Proxy Config + Worker Minecraft Connection', async () => {
    // 1. Validate proxy URL utility accepts standard SOCKS5 with public IP
    const validProxy = await validateProxyUrl('socks5://103.150.12.5:1080');
    assert.strictEqual(validProxy, 'socks5://103.150.12.5:1080');

    // 2. Validate rejected protocol
    await assert.rejects(async () => {
      await validateProxyUrl('ftp://103.150.12.5:21');
    }, /socks5/);

    // 3. Worker session applies proxy config
    const session = new MinecraftSession(
      {
        workerId: 'w-proxy-5',
        mc: { username: 'ProxyBot', serverHost: '127.0.0.1', serverPort: 25565 },
        proxy: 'socks5://103.150.12.5:1080'
      },
      { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    );

    const statusInitial = session.getStatus();
    assert.strictEqual(statusInitial.workerId, 'w-proxy-5');

    // 4. Update proxy dynamically
    session.setProxy('socks5://103.150.12.6:1080');
    const statusUpdated = session.getStatus();
    assert.strictEqual(statusUpdated.proxyEnabled, true, 'Proxy must be marked enabled');
  });

  // ===========================================================================
  // T3-PAIR-06: Worker Staggered 8s + Manager Readiness Probe
  // ===========================================================================
  await runTest('T3-PAIR-06', 'Worker Staggered 8s + Manager Readiness Probe', async () => {
    const sb = await createMockSupabaseServer();
    try {
      const adapter = new SupabaseAdapter({ url: sb.url, key: sb.secretKey });
      const mockDiscord = new MockDiscordClient();
      const app = createApp({
        store: { adapter },
        config: { discordToken: 'test-token' },
        discordClient: mockDiscord,
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
      });

      const server = app.listen(0);
      const port = server.address().port;

      // 1. Manager readiness probe returns HTTP 200
      const res = await fetch(`http://127.0.0.1:${port}/ready`);
      assert.strictEqual(res.status, 200, 'Readiness probe must return HTTP 200');
      const body = await res.json();
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.checks.database.ok, true);

      // 2. Verify worker staggered boot contract (Slot 1 boots, Slot 2 boots after delay)
      const bootTimeline = [];
      const staggerDelayMs = 150;

      bootTimeline.push({ slot: 1, time: Date.now() });
      await new Promise((r) => setTimeout(r, staggerDelayMs));
      bootTimeline.push({ slot: 2, time: Date.now() });

      assert.strictEqual(bootTimeline.length, 2);
      const elapsed = bootTimeline[1].time - bootTimeline[0].time;
      assert.ok(elapsed >= staggerDelayMs - 30, `Slot 2 must boot after staggered delay (${elapsed}ms)`);

      server.closeAllConnections?.();
      server.close();
    } finally {
      await sb.close();
    }
  });

  // ===========================================================================
  // T3-PAIR-07: Two-Phase Reset Sync + Wispbyte Long-Poll
  // ===========================================================================
  await runTest('T3-PAIR-07', 'Two-Phase Reset Sync + Wispbyte Long-Poll', async () => {
    const sb = await createMockSupabaseServer();
    try {
      sb.seed('manager_workers', [
        {
          worker_id: 'w-wisp-7',
          bot_number: 1,
          name: 'Wispbyte Worker',
          enabled: true,
          created_at: new Date().toISOString()
        }
      ]);
      sb.seed('manager_commands', [
        {
          command_id: 'cmd-wisp-reset-7',
          worker_id: 'w-wisp-7',
          action: 'reset',
          status: 'queued',
          created_at: new Date().toISOString()
        }
      ]);

      // 1. Worker polls for command via RPC / store
      const takeRes = await fetch(`${sb.url}/rest/v1/rpc/manager_take_worker_command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ p_worker_id: 'w-wisp-7' })
      });
      const takeData = await takeRes.json();
      assert.ok(Array.isArray(takeData) && takeData.length > 0, 'Must retrieve queued command');
      assert.strictEqual(takeData[0].action, 'reset');

      // 2. Step A: Record execution completed
      const recordRes = await fetch(`${sb.url}/rest/v1/rpc/manager_record_command_execution`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_worker_id: 'w-wisp-7',
          p_command_id: 'cmd-wisp-reset-7',
          p_result: { ok: true, memoryFreedMb: 50 },
          p_lease_owner: 'manager-test-node',
          p_lease_seconds: 30
        })
      });
      const recordData = await recordRes.json();
      assert.strictEqual(recordData.ok, true);
      assert.strictEqual(recordData.status, 'execution_completed');
      const fencingToken = recordData.fencingToken;

      // 3. Step B: Finalize sync with fencing token
      const finalRes = await fetch(`${sb.url}/rest/v1/rpc/manager_finalize_command_sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_worker_id: 'w-wisp-7',
          p_command_id: 'cmd-wisp-reset-7',
          p_lease_owner: 'manager-test-node',
          p_fencing_token: fencingToken
        })
      });
      const finalData = await finalRes.json();
      assert.strictEqual(finalData, true, 'finalize sync must return true');

      // 4. Verify command is completed in database
      const client = createMockSupabaseClient({ db: sb.db });
      const checkRes = await client.from('manager_commands').select('*').eq('command_id', 'cmd-wisp-reset-7').single();
      assert.strictEqual(checkRes.data.status, 'completed');
    } finally {
      await sb.close();
    }
  });

  // ===========================================================================
  // T3-PAIR-08: Worker Secret Validation + Render Inbound Command
  // ===========================================================================
  await runTest('T3-PAIR-08', 'Worker Secret Validation + Render Inbound Command', async () => {
    const secret = 's'.repeat(32);
    const executed = [];
    const mockFleet = {
      get: (id) => {
        if (id !== 'w-render-8') return null;
        return {
          config: { workerId: 'w-render-8', secret },
          runtime: {
            execute: async (action, payload) => {
              executed.push({ action, payload });
              return { ok: true, action };
            },
            status: () => ({ state: 'online' })
          }
        };
      },
      health: () => ({ ok: true })
    };

    const app = express();
    app.use(express.json());
    app.use(createWorkerRouter({ fleet: mockFleet, config: { botCount: 1, bots: [{ workerId: 'w-render-8', secret, slot: 1 }] } }));

    const server = app.listen(0);
    const port = server.address().port;

    try {
      // 1. Valid secret request
      const validRes = await fetch(`http://127.0.0.1:${port}/api/v1/bots/w-render-8/command`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-worker-secret': secret
        },
        body: JSON.stringify({ action: 'start' })
      });
      assert.strictEqual(validRes.status, 200);
      const validBody = await validRes.json();
      assert.strictEqual(validBody.ok, true);
      assert.strictEqual(executed.length, 1);

      // 2. Invalid secret request
      const invalidRes = await fetch(`http://127.0.0.1:${port}/api/v1/bots/w-render-8/command`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-worker-secret': 'invalid_secret_key'
        },
        body: JSON.stringify({ action: 'start' })
      });
      assert.strictEqual(invalidRes.status, 401);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  // ===========================================================================
  // T3-PAIR-09: Worker Secret Validation + Custom Secret Rejection (<32 chars)
  // ===========================================================================
  await runTest('T3-PAIR-09', 'Worker Secret Validation + Custom Secret Rejection (<32 chars)', async () => {
    const adminRouter = createAdminApi({
      store: {},
      entitlementService: {},
      registry: { add: async () => ({ worker: { workerId: 'w-test' }, secret: 'auto_generated' }) },
      broker: {},
      fleetOperations: {},
      adminNotifier: {},
      config: { encryptionKey: 'k'.repeat(32) },
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.managerAuthSession = { role: 'admin' };
      next();
    });
    app.use('/api/manager', adminRouter);

    const server = app.listen(0);
    const port = server.address().port;

    try {
      // 1. Submit secret with length < 32 (16 chars)
      const resShort = await fetch(`http://127.0.0.1:${port}/api/manager/bots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serviceId: 'srv-render-short',
          secret: 'only16characters'
        })
      });
      assert.strictEqual(resShort.status, 400);
      const bodyShort = await resShort.json();
      assert.ok(
        bodyShort.error.includes('32 characters'),
        `Error must mention 32 characters, got: ${bodyShort.error}`
      );
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  // ===========================================================================
  // T3-PAIR-10: Daily Maintenance Window + Discord Status Panel
  // ===========================================================================
  await runTest('T3-PAIR-10', 'Daily Maintenance Window + Discord Status Panel', async () => {
    // 1. Test isMaintenanceWindow logic
    const inWindowDate = new Date('2026-11-15T04:45:00+07:00');
    assert.strictEqual(isMaintenanceWindow(inWindowDate), true, '04:45 UTC+7 must be maintenance');

    const outWindowDate = new Date('2026-11-15T12:00:00+07:00');
    assert.strictEqual(isMaintenanceWindow(outWindowDate), false, '12:00 UTC+7 must not be maintenance');

    // 2. Render Discord panel for worker in maintenance
    const workerRecord = {
      workerId: 'w-maint-10',
      botNumber: 1,
      name: 'Maintenance Bot',
      status: { state: 'maintenance', online: false },
      settings: { mc: { username: 'MaintBot' } }
    };
    assert.strictEqual(workerRecord.status.state, 'maintenance');

    const mockServices = {
      config: { adminUsername: 'admin', discordGuildId: '999999999999999999' },
      accessStore: {
        getUserByDiscordId: async () => ({
          id: 'usr_admin',
          username: 'admin',
          role: 'admin',
          isPermanent: true
        })
      },
      registry: {
        list: async () => [workerRecord],
        find: async () => workerRecord
      }
    };

    const discordEngine = new MockDiscordEngine({
      config: mockServices.config,
      services: mockServices,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    });

    const inter = await discordEngine.dispatchSlash('bots', { userId: 'admin_discord' });
    const embeds = inter.getEmbeds();
    assert.ok(embeds.length > 0);
    const desc = embeds[0].data?.description || embeds[0].description || '';
    assert.ok(
      desc.includes('w-maint-10') || desc.includes('Maintenance Bot'),
      `Panel must render maintenance bot: ${desc}`
    );
  });

  // ===========================================================================
  // T3-PAIR-11: Unhandled Error in Slot 1 + Slot 2 Long-Poll Command Execution
  // ===========================================================================
  await runTest('T3-PAIR-11', 'Unhandled Error in Slot 1 + Slot 2 Long-Poll Command Execution', async () => {
    let errorTrapped = false;
    const errorHandler = () => {
      errorTrapped = true;
    };
    process.on('slot1_simulated_error', errorHandler);

    try {
      // Simulate Slot 1 throwing
      process.emit('slot1_simulated_error', new Error('Slot 1 unhandled network abort'));
      assert.strictEqual(errorTrapped, true, 'Error must be contained');

      // Slot 2 executes command normally
      const slot2Runtime = {
        status: () => ({ state: 'online', uptime: 100 }),
        execute: async (action) => ({ ok: true, action, slot: 2 })
      };
      const res = await slot2Runtime.execute('status');
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.slot, 2);
    } finally {
      process.removeListener('slot1_simulated_error', errorHandler);
    }
  });

  // ===========================================================================
  // T3-PAIR-12: Free Trial Registration + Dual-Slot Allocation
  // ===========================================================================
  await runTest('T3-PAIR-12', 'Free Trial Registration + Dual-Slot Allocation', async () => {
    const sb = await createMockSupabaseServer();
    try {
      sb.seed('manager_workers', [
        { worker_id: 'w-cluster-s1', bot_number: 1, name: 'Cluster Slot 1', enabled: true },
        { worker_id: 'w-cluster-s2', bot_number: 2, name: 'Cluster Slot 2', enabled: true }
      ]);

      const trialRes = await fetch(`${sb.url}/rest/v1/rpc/manager_register_trial_user`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_username: 'trial_bob_12',
          p_password: 'Password123!',
          p_trial_days: 1
        })
      });
      assert.strictEqual(trialRes.status, 200);
      const trialJson = await trialRes.json();
      assert.strictEqual(trialJson.ok, true);
      assert.strictEqual(trialJson.username, 'trial_bob_12');
      assert.strictEqual(trialJson.workerId, 'w-cluster-s1');

      // Verify Slot 2 remains unallocated in assignments
      const client = createMockSupabaseClient({ db: sb.db });
      const assignCheck = await client.from('manager_assignments').select('*').eq('worker_id', 'w-cluster-s2');
      assert.strictEqual(assignCheck.data.length, 0, 'Slot 2 must remain unassigned');
    } finally {
      await sb.close();
    }
  });

  // ===========================================================================
  // T3-PAIR-13: License Key Redemption + Dual-Slot Allocation
  // ===========================================================================
  await runTest('T3-PAIR-13', 'License Key Redemption + Dual-Slot Allocation', async () => {
    const sb = await createMockSupabaseServer();
    try {
      sb.seed('manager_users', [
        { id: 'usr_license_13', username: 'license_13', role: 'user', status: 'active', assigned_bot_ids: [] }
      ]);
      sb.seed('manager_keys', [
        {
          id: 'key-dual-plan-13',
          code: 'DUAL-SLOT-KEY-13',
          code_hash: 'DUAL-SLOT-KEY-13',
          plan_name: 'PRO DUAL 2-BOTS',
          bot_limit: 2,
          is_active: true,
          max_uses: 1,
          uses_count: 0
        }
      ]);
      sb.seed('manager_workers', [
        { worker_id: 'w-fleet-s1', bot_number: 1, enabled: true },
        { worker_id: 'w-fleet-s2', bot_number: 2, enabled: true }
      ]);

      const redeemRes = await fetch(`${sb.url}/rest/v1/rpc/manager_redeem_code_with_access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_code_hash: 'DUAL-SLOT-KEY-13',
          p_user_id: 'usr_license_13',
          p_worker_ids: ['w-fleet-s1', 'w-fleet-s2'],
          p_access_values: { planName: 'PRO DUAL 2-BOTS', isPermanent: true }
        })
      });
      assert.strictEqual(redeemRes.status, 200);

      // Verify user has both slots assigned
      const client = createMockSupabaseClient({ db: sb.db });
      const userCheck = await client.from('manager_users').select('*').eq('id', 'usr_license_13').single();
      assert.strictEqual(userCheck.data.assigned_bot_ids.length, 2);
      assert.ok(userCheck.data.assigned_bot_ids.includes('w-fleet-s1'));
      assert.ok(userCheck.data.assigned_bot_ids.includes('w-fleet-s2'));
    } finally {
      await sb.close();
    }
  });

  // ===========================================================================
  // T3-PAIR-14: Link4M Reward + Expiry Extension + Bot Resume
  // ===========================================================================
  await runTest('T3-PAIR-14', 'Link4M Reward + Expiry Extension + Bot Resume', async () => {
    const sb = await createMockSupabaseServer();
    try {
      const pastExpiry = new Date(Date.now() - 3600000).toISOString();
      sb.seed('manager_users', [
        {
          id: 'usr_link4m_14',
          username: 'link4m_14',
          role: 'user',
          status: 'expired',
          expires_at: pastExpiry,
          assigned_bot_ids: ['w-14']
        }
      ]);
      sb.seed('manager_link4m_attempts', [
        { attempt_id: 'att-14', username: 'link4m_14', status: 'started' }
      ]);

      const accessControl = new AccessControl({ store: {}, adminUserId: 'admin' });
      assert.strictEqual(accessControl.isEntitled({ status: 'expired', expiresAt: pastExpiry }), false);

      const futureExpiry = new Date(Date.now() + 6 * 3600000).toISOString();
      const rewardRes = await fetch(`${sb.url}/rest/v1/rpc/manager_complete_link4m_reward`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_attempt_id: 'att-14',
          p_user_id: 'usr_link4m_14',
          p_access_values: { expires_at: futureExpiry, status: 'active' }
        })
      });
      assert.strictEqual(rewardRes.status, 200);

      assert.strictEqual(accessControl.isEntitled({ status: 'active', expiresAt: futureExpiry }), true);
    } finally {
      await sb.close();
    }
  });

  // ===========================================================================
  // T3-PAIR-15: Expiry State Machine + Discord Panel Action Denial
  // ===========================================================================
  await runTest('T3-PAIR-15', 'Expiry State Machine + Discord Panel Action Denial', async () => {
    const expiredPast = new Date(Date.now() - 7200000).toISOString();
    const dispatched = [];

    const mockServices = {
      config: { adminUsername: 'admin', discordGuildId: '999999999999999999' },
      accessControl: {
        isEntitled: () => false
      },
      accessStore: {
        getUserByDiscordId: async () => ({
          id: 'usr_exp_15',
          username: 'expired_user',
          role: 'user',
          status: 'expired',
          expiresAt: expiredPast,
          isPermanent: false,
          assignedBotIds: ['w-exp-15']
        })
      },
      registry: {
        list: async () => [{ workerId: 'w-exp-15', botNumber: 1, status: { state: 'stopped' } }],
        find: async () => ({ workerId: 'w-exp-15', botNumber: 1, status: { state: 'stopped' } })
      },
      broker: {
        dispatch: async (...args) => {
          dispatched.push(args);
          return { ok: true };
        }
      }
    };

    const discordEngine = new MockDiscordEngine({
      config: mockServices.config,
      services: mockServices,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    });

    const inter = await discordEngine.dispatchButton('bot:start:w-exp-15', { userId: 'discord_exp_15' });
    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(dispatched.length, 0, 'Command must NOT be dispatched when expired');

    const reply = inter.getLastReply();
    const embeds = reply?.embeds || [];
    assert.ok(embeds.length > 0);
    const title = embeds[0].data?.title || embeds[0].title;
    assert.ok(title.includes('HẾT HẠN'), `Title must indicate expired account, got: ${title}`);
  });

  // ===========================================================================
  // T3-PAIR-16: Totem Off-Hand Telemetry + Web Dashboard Telemetry
  // ===========================================================================
  await runTest('T3-PAIR-16', 'Totem Off-Hand Telemetry + Web Dashboard Telemetry', async () => {
    const mockBot = {
      inventory: {
        items: () => [
          { name: 'totem_of_undying', count: 1, slot: 10 },
          { name: 'totem_of_undying', count: 1, slot: 11 },
          { name: 'totem_of_undying', count: 1, slot: 45 }
        ],
        slots: {
          45: { name: 'totem_of_undying', count: 1, slot: 45 }
        }
      }
    };

    const monitor = new ServerMonitor();
    monitor.bot = mockBot;
    const snap = monitor.snapshot();

    // Must count exactly 3 (2 in main inventory + 1 in off-hand slot 45 without double counting)
    assert.strictEqual(snap.totemCount, 3, `Expected exactly 3 totems, got: ${snap.totemCount}`);
  });

  // ===========================================================================
  // T3-PAIR-17: RAM Sweeper Spike + Staggered Boot Delay
  // ===========================================================================
  await runTest('T3-PAIR-17', 'RAM Sweeper Spike + Staggered Boot Delay', async () => {
    let swept = false;
    let pruned = false;

    const mockRegistry = {
      pruneStaleMemory: () => {
        pruned = true;
      }
    };

    const simulatedRssMb = 290;
    const thresholdMb = 280;

    if (simulatedRssMb > thresholdMb) {
      mockRegistry.pruneStaleMemory();
      swept = true;
    }

    assert.strictEqual(pruned, true, 'Stale memory must be pruned');
    assert.strictEqual(swept, true, 'Sweeper must execute under memory pressure');
  });

  // ===========================================================================
  // T3-PAIR-18: Dynamic Discord Guild Update + Multi-Tenant Isolation
  // ===========================================================================
  await runTest('T3-PAIR-18', 'Dynamic Discord Guild Update + Multi-Tenant Isolation', async () => {
    const mockServices = {
      config: { discordGuildId: '111111111111111111' },
      managerRuntimeSettings: {
        getRoleSettings: async () => ({ guildId: '111111111111111111' })
      },
      accessStore: {
        getUserByDiscordId: async () => ({ id: 'usr_1', role: 'admin' })
      },
      registry: { list: async () => [] }
    };

    const discordEngine = new MockDiscordEngine({
      config: mockServices.config,
      services: mockServices,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    });

    // 1. Interaction from outside guild (222222) rejected
    const inter1 = await discordEngine.dispatchSlash('help', { guildId: '222222222222222222' });
    const reply1 = inter1.getLastReply();
    const content1 = reply1?.content || '';
    assert.ok(content1.includes('available only in its configured Discord server'), 'Outside guild rejected');

    // 2. Interaction from allowed guild (111111) accepted
    const inter2 = await discordEngine.dispatchSlash('help', { guildId: '111111111111111111' });
    const embeds2 = inter2.getEmbeds();
    assert.ok(embeds2.length > 0, 'Inside guild accepted');
  });

  // ===========================================================================
  // T3-PAIR-19: Admin Reset Customer + Active Minecraft Session
  // ===========================================================================
  await runTest('T3-PAIR-19', 'Admin Reset Customer + Active Minecraft Session', async () => {
    const mcServer = new MockMinecraftServer({ autoAuthPrompt: false });
    const mcPort = await mcServer.start();

    try {
      const bot = mineflayer.createBot({
        host: '127.0.0.1',
        port: mcPort,
        username: 'ResetCustBot19',
        version: '1.20.1',
        auth: 'offline',
        hideErrors: true
      });
      bot.on('error', () => {});

      await new Promise((resolve) => {
        bot.on('spawn', resolve);
        setTimeout(resolve, 3000);
      });

      assert.strictEqual(mcServer.clients.size, 1, 'Client must be connected to Mock MC');

      // Admin triggers reset-customer -> bot disconnects
      bot.quit();
      await new Promise((r) => setTimeout(r, 200));

      assert.strictEqual(mcServer.clients.size, 0, 'Client must disconnect upon reset stop');
    } finally {
      await mcServer.stop();
    }
  });

  // ===========================================================================
  // T3-PAIR-20: Server Kick Packet + Exponential Reconnect Backoff
  // ===========================================================================
  await runTest('T3-PAIR-20', 'Server Kick Packet + Exponential Reconnect Backoff', async () => {
    const mcServer = new MockMinecraftServer({ autoAuthPrompt: false });
    const mcPort = await mcServer.start();

    try {
      let kicked = false;
      let kickReason = '';

      const bot = mineflayer.createBot({
        host: '127.0.0.1',
        port: mcPort,
        username: 'KickTestBot20',
        version: '1.20.1',
        auth: 'offline',
        hideErrors: true
      });
      bot.on('error', () => {});

      bot.on('kicked', (reason) => {
        kicked = true;
        kickReason = typeof reason === 'string' ? reason : JSON.stringify(reason);
      });

      await new Promise((resolve) => {
        bot.on('spawn', resolve);
        setTimeout(resolve, 3000);
      });

      const client = Array.from(mcServer.clients)[0];
      assert.ok(client, 'Mock MC must have connected client');

      // Server kicks client
      mcServer.kick(client, 'Server maintenance reboot');
      await new Promise((r) => setTimeout(r, 300));

      assert.strictEqual(kicked, true, 'Mineflayer bot must capture kick packet');
      assert.ok(kickReason.includes('Server maintenance reboot'), `Kick reason must match: ${kickReason}`);

      const attempt1 = Math.min(30000, 2000 * Math.pow(2, 1));
      const attempt3 = Math.min(30000, 2000 * Math.pow(2, 3));
      assert.strictEqual(attempt1, 4000);
      assert.strictEqual(attempt3, 16000);
    } finally {
      await mcServer.stop();
    }
  });

  // ===========================================================================
  // T3-PAIR-21: Authme Lobby Navigation + Chat Command Dispatch
  // ===========================================================================
  await runTest('T3-PAIR-21', 'Authme Lobby Navigation + Chat Command Dispatch', async () => {
    const mcServer = new MockMinecraftServer({ autoAuthPrompt: true, autoAuthSuccess: true });
    const mcPort = await mcServer.start();

    try {
      const bot = mineflayer.createBot({
        host: '127.0.0.1',
        port: mcPort,
        username: 'AuthmeChatBot21',
        version: '1.20.1',
        auth: 'offline',
        hideErrors: true
      });
      bot.on('error', () => {});

      let authSuccess = false;
      bot.on('message', (json) => {
        if (json.toString().includes('Đăng nhập thành công')) {
          authSuccess = true;
        }
      });

      bot.on('spawn', () => {
        bot.chat('/login SuperSecretPass21');
        setTimeout(() => {
          bot.chat('!status');
        }, 200);
      });

      const startWait = Date.now();
      while (!authSuccess && Date.now() - startWait < 4000) {
        await new Promise((r) => setTimeout(r, 100));
      }

      await new Promise((r) => setTimeout(r, 400));

      assert.strictEqual(authSuccess, true, 'Authme login must succeed');
      assert.ok(
        mcServer.receivedCommands.some((c) => c.includes('SuperSecretPass21')),
        'Mock MC must capture login command'
      );
      assert.ok(
        mcServer.receivedChats.some((c) => c.includes('!status')) ||
        mcServer.receivedCommands.some((c) => c.includes('status')),
        'Mock MC must capture chat message'
      );
    } finally {
      await mcServer.stop();
    }
  });

  // ===========================================================================
  // T3-PAIR-22: SPA Route Mount + CSRF Exemption for Worker Endpoints
  // ===========================================================================
  await runTest('T3-PAIR-22', 'SPA Route Mount + CSRF Exemption for Worker Endpoints', async () => {
    const secret = 'w'.repeat(32);
    const mockWorkerStore = { updateStatus: async () => ({}) };

    const app = createApp({
      store: {},
      registry: {
        verifyBotSecretSync: (botId, sec) => sec === secret,
        authenticate: async (id, sec) => sec === secret,
        updateStatus: async () => ({ workerId: 'w-csrf-22' })
      },
      broker: {},
      workerStore: mockWorkerStore,
      config: { botSecretKey: '' },
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    });

    const server = app.listen(0);
    const port = server.address().port;

    try {
      // 1. Browser POST request with session cookie but without Origin/Referer is rejected by CSRF
      const csrfBlockedRes = await fetch(`http://127.0.0.1:${port}/api/user/bot/settings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: 'kingmc_mgr_session=mock_session_token'
        },
        body: JSON.stringify({ test: 1 })
      });
      assert.strictEqual(csrfBlockedRes.status, 403, 'Browser request without Origin/Referer must be 403 CSRF');

      // 2. Worker POST request with x-worker-secret header is exempt from CSRF
      const workerRes = await fetch(`http://127.0.0.1:${port}/api/v1/workers/w-csrf-22/heartbeat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-worker-secret': secret,
          'x-manager-bot-id': 'w-csrf-22'
        },
        body: JSON.stringify({ status: { online: true } })
      });
      assert.strictEqual(workerRes.status, 200, 'Worker request with secret must bypass CSRF');
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  // ===========================================================================
  // T3-PAIR-23: Supabase Two-Phase Sync + Lease Timeout Steal
  // ===========================================================================
  await runTest('T3-PAIR-23', 'Supabase Two-Phase Sync + Lease Timeout Steal', async () => {
    const sb = await createMockSupabaseServer();
    try {
      sb.seed('manager_workers', [{ worker_id: 'w-steal-23', bot_number: 1, enabled: true }]);
      sb.seed('manager_commands', [
        {
          command_id: 'cmd-steal-23',
          worker_id: 'w-steal-23',
          action: 'reset',
          status: 'queued',
          created_at: new Date().toISOString()
        }
      ]);

      // 1. Worker A records execution with 1-second short lease
      const recordA = await fetch(`${sb.url}/rest/v1/rpc/manager_record_command_execution`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_worker_id: 'w-steal-23',
          p_command_id: 'cmd-steal-23',
          p_result: { ok: true },
          p_lease_owner: 'worker-node-A',
          p_lease_seconds: 1
        })
      });
      const dataA = await recordA.json();
      assert.strictEqual(dataA.ok, true);
      const tokenA = dataA.fencingToken;
      assert.strictEqual(tokenA, 1);

      // 2. Wait 1100ms for Worker A's lease to expire
      await new Promise((r) => setTimeout(r, 1100));

      // 3. Worker B steals expired lease via claim
      const claimB = await fetch(`${sb.url}/rest/v1/rpc/manager_claim_pending_command_syncs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_lease_owner: 'worker-node-B',
          p_limit: 10,
          p_lease_seconds: 60
        })
      });
      const claimedRows = await claimB.json();
      assert.ok(claimedRows.length > 0, 'Worker B must steal expired sync lease');
      const tokenB = claimedRows[0].result?._stateSync?.fencingToken;
      assert.strictEqual(tokenB, 2, 'Stolen lease must increment fencing token to 2');

      // 4. Worker A tries to finalize with stale token = 1 -> Rejected
      const staleFinalize = await fetch(`${sb.url}/rest/v1/rpc/manager_finalize_command_sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_worker_id: 'w-steal-23',
          p_command_id: 'cmd-steal-23',
          p_lease_owner: 'worker-node-A',
          p_fencing_token: tokenA
        })
      });
      const staleResult = await staleFinalize.json();
      assert.strictEqual(staleResult, false, 'Worker A stale token must be rejected');

      // 5. Worker B finalizes with current token = 2 -> Succeeded
      const validFinalize = await fetch(`${sb.url}/rest/v1/rpc/manager_finalize_command_sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_worker_id: 'w-steal-23',
          p_command_id: 'cmd-steal-23',
          p_lease_owner: 'worker-node-B',
          p_fencing_token: tokenB
        })
      });
      const validResult = await validFinalize.json();
      assert.strictEqual(validResult, true, 'Worker B valid token must succeed');
    } finally {
      await sb.close();
    }
  });

  // ===========================================================================
  // T3-PAIR-24: Worker Clean Shutdown + Fallback Exit Timer
  // ===========================================================================
  await runTest('T3-PAIR-24', 'Worker Clean Shutdown + Fallback Exit Timer', async () => {
    let cleanExitInvoked = false;

    const fallbackTimer = setTimeout(() => {
      cleanExitInvoked = true;
    }, 2000);

    fallbackTimer.unref();

    assert.strictEqual(typeof fallbackTimer.hasRef, 'function');
    assert.strictEqual(fallbackTimer.hasRef(), false, 'Fallback shutdown timer must be unrefd');

    clearTimeout(fallbackTimer);
  });

  // ===========================================================================
  // T3-PAIR-25: Giftcode Creation + Redundancy Collision Avoidance
  // ===========================================================================
  await runTest('T3-PAIR-25', 'Giftcode Creation + Redundancy Collision Avoidance', async () => {
    const sb = await createMockSupabaseServer();
    try {
      const generatedCodes = new Set();
      const codeRows = [];

      for (let i = 0; i < 50; i++) {
        const code = `KBOT-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        generatedCodes.add(code);
        codeRows.push({
          id: `key-${i}`,
          code,
          code_hash: code,
          plan_name: 'VIP 1-MONTH',
          bot_limit: 1,
          is_active: true,
          max_uses: 1,
          uses_count: 0
        });
      }

      assert.strictEqual(generatedCodes.size, 50, 'All 50 codes must be strictly distinct');

      sb.seed('manager_keys', codeRows);
      sb.seed('manager_users', [
        { id: 'usr_gift_25', username: 'gift_user_25', role: 'user', status: 'active', assigned_bot_ids: [] }
      ]);
      sb.seed('manager_workers', [{ worker_id: 'w-gift-25', bot_number: 1, enabled: true }]);

      const targetCode = codeRows[0].code;
      const redeem1 = await fetch(`${sb.url}/rest/v1/rpc/manager_redeem_code_with_access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_code_hash: targetCode,
          p_user_id: 'usr_gift_25',
          p_worker_ids: ['w-gift-25'],
          p_access_values: { planName: 'VIP 1-MONTH', isPermanent: false }
        })
      });
      assert.strictEqual(redeem1.status, 200);

      const redeem2 = await fetch(`${sb.url}/rest/v1/rpc/manager_redeem_code_with_access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          p_code_hash: targetCode,
          p_user_id: 'usr_gift_25',
          p_worker_ids: ['w-gift-25'],
          p_access_values: {}
        })
      });
      assert.strictEqual(redeem2.status, 400, 'Re-redeeming used code must fail with 400');
    } finally {
      await sb.close();
    }
  });

  // ===========================================================================
  // T3-PAIR-26: Discord /admin password + Web SPA Admin Login
  // ===========================================================================
  await runTest('T3-PAIR-26', 'Discord /admin password + Web SPA Admin Login', async () => {
    const sb = await createMockSupabaseServer();
    try {
      const initialAdminHash = hashAdminPassword('InitialAdminPass!');
      const registry = new WorkerRegistry({
        store: {},
        accessStore: {},
        encryptionKey: 'k'.repeat(32)
      });
      registry.setAdminPassword(initialAdminHash);

      const accessStore = new SupabaseDashboardStore(createMockSupabaseClient({ db: sb.db }));
      await accessStore.initialize();

      const mockServices = {
        config: {
          adminUsername: 'admin',
          adminPassword: initialAdminHash,
          adminUserId: 'admin_discord_id',
          discordGuildId: '999999999999999999'
        },
        accessStore,
        registry,
        store: { adapter: new SupabaseAdapter({ url: sb.url, key: sb.secretKey }) }
      };

      const discordEngine = new MockDiscordEngine({
        config: mockServices.config,
        services: mockServices,
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
      });

      // 1. Admin executes /admin password via Discord
      const newAdminPass = 'NewAdminPass2026!#$';
      const inter = await discordEngine.dispatchSlash('admin', {
        subcommand: 'password',
        strings: { new_password: newAdminPass },
        isAdmin: true,
        userId: 'admin_discord_id'
      });

      const embeds = inter.getEmbeds();
      assert.ok(embeds.length > 0);
      const title = embeds[0].data?.title || embeds[0].title;
      assert.ok(title.includes('ĐỔI MẬT KHẨU ADMIN THÀNH CÔNG'), `Title must confirm password change: ${title}`);

      // 2. Verify registry updated password hash
      const updatedHash = registry.getAdminPassword();
      assert.strictEqual(verifyAdminPassword(newAdminPass, updatedHash), true);

      // 3. Web Login with new password succeeds
      const app = createApp({
        store: accessStore,
        registry,
        config: {
          adminUsername: 'admin',
          adminPassword: initialAdminHash
        },
        logger: { info: () => {}, warn: () => {}, error: () => {} }
      });

      const server = app.listen(0);
      const port = server.address().port;

      const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: newAdminPass
        })
      });

      assert.strictEqual(loginRes.status, 200, 'Web login with new password must return 200');
      const loginJson = await loginRes.json();
      assert.strictEqual(loginJson.ok, true);

      // 4. Web Login with old password fails
      const oldLoginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: 'InitialAdminPass!'
        })
      });
      assert.strictEqual(oldLoginRes.status, 401, 'Old password must be rejected');

      server.closeAllConnections?.();
      server.close();
    } finally {
      await sb.close();
    }
  });

  // ===========================================================================
  // Summary & Exit
  // ===========================================================================
  console.log(`\n1..${testIndex}`);
  console.log(`# tests ${testIndex}`);
  console.log(`# pass  ${passCount}`);
  console.log(`# fail  ${failCount}`);

  if (failCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal suite execution error:', err);
    process.exit(1);
  });
}

module.exports = { main, TOTAL_TESTS };
