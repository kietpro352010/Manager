'use strict';

const assert = require('node:assert');
const path = require('node:path');

const {
  createMockSupabaseServer,
  createMockSupabaseClient,
  SUPABASE_REQUIRED_TABLES,
  REQUIRED_RPCS
} = require('./mock-supabase');

const MockMinecraftServer = require('./mock-minecraft-server');
const { MockDiscordEngine, MockDiscordClient } = require('./mock-discord');

const { SupabaseAdapter } = require('../../../src/storage/supabase-client');
const { createApp } = require('../../../src/http/app');

// Try requiring mineflayer from worker or manager
let mineflayer;
try {
  mineflayer = require('mineflayer');
} catch (_) {
  try {
    mineflayer = require(path.resolve(__dirname, '../../../../worker/node_modules/mineflayer'));
  } catch (__) {
    mineflayer = require('D:/worker/node_modules/mineflayer');
  }
}

async function runHarnessSelfTest() {
  console.log('================================================================');
  console.log('       KBOT E2E MOCK HARNESS COMPREHENSIVE SELF-TEST            ');
  console.log('================================================================\n');

  const startTime = Date.now();
  let checksPassed = 0;

  // ===========================================================================
  // SECTION 1: Mock Supabase PostgREST & RPC Engine
  // ===========================================================================
  console.log('--- [1/3] Testing Mock Supabase Engine ---');
  {
    // 1.1 In-memory client verification
    const client = createMockSupabaseClient();
    assert.strictEqual(typeof client.from, 'function', 'client.from must be a function');
    assert.strictEqual(typeof client.rpc, 'function', 'client.rpc must be a function');

    // 1.2 Table CRUD operations in-memory
    const testWorker = {
      worker_id: 'worker-test-01',
      bot_number: 1,
      name: 'Worker Node 1',
      enabled: true,
      settings: { mc: { username: 'TestBot' } },
      status: { state: 'idle', online: false },
      created_at: new Date().toISOString()
    };
    const insertRes = await client.from('manager_workers').insert(testWorker);
    assert.strictEqual(insertRes.status, 201, 'Insert must return status 201');
    checksPassed++;

    const queryRes = await client
      .from('manager_workers')
      .select('*')
      .eq('worker_id', 'worker-test-01')
      .single();
    assert.strictEqual(queryRes.status, 200, 'Query single must return status 200');
    assert.strictEqual(queryRes.data.worker_id, 'worker-test-01', 'Retrieved row must match');
    checksPassed++;

    // 1.3 Start Mock Supabase HTTP Server on dynamic port
    const supabaseServer = await createMockSupabaseServer();
    console.log(`  ✓ Mock Supabase HTTP Server started at ${supabaseServer.url}`);

    // 1.4 OpenAPI Spec Verification (Swagger 2.0)
    const specRes = await fetch(`${supabaseServer.url}/rest/v1/`);
    assert.strictEqual(specRes.status, 200, 'GET /rest/v1/ must return HTTP 200');
    const spec = await specRes.json();
    assert.strictEqual(spec.swagger, '2.0', 'Spec must be Swagger 2.0');
    assert.strictEqual(
      Object.keys(spec.definitions).length,
      SUPABASE_REQUIRED_TABLES.length,
      `Spec must contain all ${SUPABASE_REQUIRED_TABLES.length} canonical table definitions`
    );
    for (const table of SUPABASE_REQUIRED_TABLES) {
      assert.ok(spec.definitions[table], `Table definition missing: ${table}`);
      assert.ok(spec.paths[`/${table}`], `Table path missing: /${table}`);
    }
    for (const rpc of REQUIRED_RPCS) {
      assert.ok(spec.paths[`/rpc/${rpc}`], `RPC path missing: /rpc/${rpc}`);
    }
    console.log(`  ✓ Verified OpenAPI spec (${SUPABASE_REQUIRED_TABLES.length} tables, ${REQUIRED_RPCS.length} RPCs)`);
    checksPassed++;

    // 1.5 SupabaseAdapter testConnection()
    const adapter = new SupabaseAdapter({
      url: supabaseServer.url,
      key: supabaseServer.secretKey
    });
    const connCheck = await adapter.testConnection();
    assert.strictEqual(connCheck.ok, true, `testConnection must succeed: ${connCheck.error}`);
    console.log('  ✓ SupabaseAdapter.testConnection() passed with 100% schema & RPC coverage');
    checksPassed++;

    // 1.6 Manager Express App /ready integration probe
    const mockDiscordClient = new MockDiscordClient();
    const managerApp = createApp({
      store: { adapter },
      config: { discordToken: 'test-discord-token' },
      discordClient: mockDiscordClient,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    });

    await new Promise((resolve) => {
      const srv = managerApp.listen(0, async () => {
        const port = srv.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/ready`);
        assert.strictEqual(res.status, 200, 'Manager /ready must return HTTP 200');
        const body = await res.json();
        assert.strictEqual(body.ok, true, 'Manager readiness probe body.ok must be true');
        assert.strictEqual(body.checks.database.ok, true, 'Database check must be ok');
        assert.strictEqual(body.checks.discord.ok, true, 'Discord check must be ok');
        srv.close(() => resolve());
      });
    });
    console.log('  ✓ Manager /ready probe returned HTTP 200 (database & discord ok)');
    checksPassed++;

    // 1.7 Two-Phase Command Reset Sync RPCs
    supabaseServer.seed('manager_workers', [
      {
        worker_id: 'w-alpha',
        bot_number: 1,
        name: 'Alpha Worker',
        enabled: true,
        created_at: new Date().toISOString()
      }
    ]);
    supabaseServer.seed('manager_commands', [
      {
        command_id: 'cmd-sync-01',
        worker_id: 'w-alpha',
        action: 'reset',
        status: 'delivered',
        created_at: new Date().toISOString()
      }
    ]);

    // Step A: Record execution completed
    const recordRes = await fetch(`${supabaseServer.url}/rest/v1/rpc/manager_record_command_execution`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_worker_id: 'w-alpha',
        p_command_id: 'cmd-sync-01',
        p_result: { ok: true, memoryFreedMb: 45 },
        p_lease_owner: 'manager-node-1',
        p_lease_seconds: 30
      })
    });
    const recordJson = await recordRes.json();
    assert.strictEqual(recordJson.ok, true, 'manager_record_command_execution must succeed');
    assert.strictEqual(recordJson.status, 'execution_completed');
    assert.strictEqual(recordJson.fencingToken, 1, 'Initial fencing token must be 1');
    checksPassed++;

    // Step B: Renew lease
    const renewRes = await fetch(`${supabaseServer.url}/rest/v1/rpc/manager_renew_command_sync_lease`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_worker_id: 'w-alpha',
        p_command_id: 'cmd-sync-01',
        p_lease_owner: 'manager-node-1',
        p_lease_seconds: 60,
        p_fencing_token: 1
      })
    });
    const renewJson = await renewRes.json();
    assert.strictEqual(renewJson.ok, true, 'manager_renew_command_sync_lease must succeed');
    assert.strictEqual(renewJson.lost, false);
    checksPassed++;

    // Step C: Verify lease
    const verifyRes = await fetch(`${supabaseServer.url}/rest/v1/rpc/manager_verify_command_sync_lease`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_worker_id: 'w-alpha',
        p_command_id: 'cmd-sync-01',
        p_lease_owner: 'manager-node-1',
        p_fencing_token: 1
      })
    });
    const verifyJson = await verifyRes.json();
    assert.strictEqual(verifyJson.ok, true);
    assert.strictEqual(verifyJson.held, true);
    checksPassed++;

    // Step D: Finalize sync
    const finalRes = await fetch(`${supabaseServer.url}/rest/v1/rpc/manager_finalize_command_sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_worker_id: 'w-alpha',
        p_command_id: 'cmd-sync-01',
        p_lease_owner: 'manager-node-1',
        p_fencing_token: 1
      })
    });
    const finalJson = await finalRes.json();
    assert.strictEqual(finalJson, true, 'manager_finalize_command_sync must return true');
    console.log('  ✓ Two-phase command reset sync & lease fencing verified');
    checksPassed++;

    // 1.8 Free Trial User Registration RPC
    const trialRes = await fetch(`${supabaseServer.url}/rest/v1/rpc/manager_register_trial_user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_username: 'bob_trial',
        p_password: 'SecretPassword123!',
        p_trial_days: 1
      })
    });
    const trialJson = await trialRes.json();
    assert.strictEqual(trialJson.ok, true, 'Free trial registration must succeed');
    assert.strictEqual(trialJson.username, 'bob_trial');
    assert.strictEqual(trialJson.workerId, 'w-alpha', 'Must bind available worker w-alpha');
    console.log('  ✓ Free trial registration RPC verified');
    checksPassed++;

    // 1.9 DEFECT-HARNESS-01: manager_next_bot_number sequence advancement & read_manager_authorization ok:true
    const nextNumRes1 = await fetch(`${supabaseServer.url}/rest/v1/rpc/manager_next_bot_number`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const nextNum1 = await nextNumRes1.json();
    assert.strictEqual(typeof nextNum1, 'number', 'next bot number must be a number');
    assert.ok(nextNum1 >= 2, 'next bot number must advance past existing worker');

    const nextNumRes2 = await fetch(`${supabaseServer.url}/rest/v1/rpc/manager_next_bot_number`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const nextNum2 = await nextNumRes2.json();
    assert.strictEqual(nextNum2, nextNum1 + 1, 'subsequent call must advance sequence state by 1');

    // Create session and verify read_manager_authorization returns ok: true
    const sessionRes = await fetch(`${supabaseServer.url}/rest/v1/rpc/create_manager_user_session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        p_session: {
          user_id: 'usr_test_auth',
          username: 'bob_trial',
          role: 'user',
          token_hash: 'token_hash_harness_test_123',
          expires_at: Date.now() + 3600000
        }
      })
    });
    const sessionJson = await sessionRes.json();
    assert.strictEqual(sessionJson.ok, true, 'create_manager_user_session must succeed');

    const authRes = await fetch(`${supabaseServer.url}/rest/v1/rpc/read_manager_authorization`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ p_token_hash: 'token_hash_harness_test_123' })
    });
    const authJson = await authRes.json();
    assert.strictEqual(authJson.ok, true, 'read_manager_authorization must return ok: true');
    assert.strictEqual(authJson.authorized, true, 'read_manager_authorization must return authorized: true');
    assert.strictEqual(authJson.session.username, 'bob_trial');
    console.log('  ✓ manager_next_bot_number and read_manager_authorization verified');
    checksPassed++;

    await supabaseServer.close();
    console.log('  ✓ Mock Supabase closed cleanly\n');
  }

  // ===========================================================================
  // SECTION 2: Mock Minecraft TCP Server Engine
  // ===========================================================================
  console.log('--- [2/3] Testing Mock Minecraft TCP Server ---');
  {
    const mcServer = new MockMinecraftServer({
      autoAuthPrompt: true,
      autoAuthSuccess: true
    });
    const port = await mcServer.start();
    assert.ok(port > 0, 'Server must bind to dynamic ephemeral port');
    console.log(`  ✓ Mock Minecraft TCP Server listening on port ${port}`);

    const bot = mineflayer.createBot({
      host: '127.0.0.1',
      port,
      username: 'E2ESelfTestBot',
      version: '1.20.1',
      auth: 'offline',
      hideErrors: true
    });

    bot.on('error', () => {});

    let spawned = false;
    let totemPopped = false;
    let authSuccessReceived = false;

    bot.on('spawn', () => {
      spawned = true;
      // Send login command upon spawning
      bot.chat('/login myHarnessPassword456');
    });

    bot.on('message', (json) => {
      const text = json.toString();
      if (text.includes('Đăng nhập thành công')) {
        authSuccessReceived = true;
      }
    });

    bot._client.on('entity_status', (packet) => {
      if (packet.entityStatus === 35) {
        totemPopped = true;
      }
    });

    // Wait up to 3000ms for spawn and login
    const spawnWaitStart = Date.now();
    while ((!spawned || !authSuccessReceived) && Date.now() - spawnWaitStart < 4000) {
      await new Promise((r) => setTimeout(r, 100));
    }

    assert.strictEqual(spawned, true, 'Mineflayer bot must emit "spawn" event via update_health packet');
    assert.strictEqual(authSuccessReceived, true, 'Mineflayer bot must receive Authme login success notice');
    assert.ok(
      mcServer.receivedCommands.some((c) => c.includes('myHarnessPassword456')),
      'Mock server must intercept and record chat_command'
    );
    console.log('  ✓ Protocol 763 Handshake, Login Start, Join Game, and Authme FSM verified');
    checksPassed++;

    // Test Totem Pop Simulation
    const client = Array.from(mcServer.clients)[0];
    assert.ok(client, 'Server must have connected client');
    mcServer.simulateTotemPop(client);

    const totemWaitStart = Date.now();
    while (!totemPopped && Date.now() - totemWaitStart < 2000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.strictEqual(totemPopped, true, 'Bot must detect status 35 totem pop packet');
    console.log('  ✓ Totem pop simulation packet verified');
    checksPassed++;

    // Test graceful kick and server shutdown
    mcServer.kick(client, 'Self-test completed');
    await new Promise((r) => setTimeout(r, 150));
    await mcServer.stop();
    console.log('  ✓ Graceful kick and server shutdown verified\n');
    checksPassed++;
  }

  // ===========================================================================
  // SECTION 3: Mock Discord Interaction Engine
  // ===========================================================================
  console.log('--- [3/3] Testing Mock Discord Interaction Engine ---');
  {
    const mockServices = {
      config: {
        adminUsername: 'admin',
        discordGuildId: '999999999999999999'
      },
      accessStore: {
        getUserByDiscordId: async (dId) => ({
          id: 'usr_carol',
          username: 'carol',
          isPermanent: true,
          status: 'active',
          assigned_bot_ids: ['bot-carol-1']
        })
      },
      registry: {
        list: async () => [
          {
            worker_id: 'bot-carol-1',
            bot_number: 1,
            name: 'Carol Miner',
            status: { state: 'online', online: true, ping: 35, tps: 20 },
            settings: { mc: { username: 'CarolMC' } }
          }
        ],
        get: async () => ({
          worker_id: 'bot-carol-1',
          bot_number: 1,
          name: 'Carol Miner',
          status: { state: 'online', online: true, ping: 35, tps: 20 },
          settings: { mc: { username: 'CarolMC' } }
        })
      }
    };

    const discordEngine = new MockDiscordEngine({
      config: mockServices.config,
      services: mockServices,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    });

    // 3.1 Test /help slash command
    const helpInter = await discordEngine.dispatchSlash('help');
    assert.strictEqual(helpInter.replied || helpInter.deferred, true, 'Help interaction must be acknowledged');
    const helpEmbeds = helpInter.getEmbeds();
    assert.ok(helpEmbeds.length > 0, 'Help command must return embeds');
    const helpTitle = helpEmbeds[0].data?.title || helpEmbeds[0].title;
    assert.ok(helpTitle.includes('HƯỚNG DẪN'), 'Help embed must contain guide title');
    console.log(`  ✓ Slash command /help executed (${helpTitle})`);
    checksPassed++;

    // 3.2 Test /bots slash command with active user
    const botsInter = await discordEngine.dispatchSlash('bots');
    const botsEmbeds = botsInter.getEmbeds();
    assert.ok(botsEmbeds.length > 0, 'Bots command must return embeds');
    const botsTitle = botsEmbeds[0].data?.title || botsEmbeds[0].title;
    assert.ok(botsTitle.includes('DANH SÁCH BOT'), 'Bots embed must render bot list panel');
    const components = botsInter.getComponents();
    assert.ok(components.length > 0, 'Bots panel must contain action buttons');
    const refreshBtn = botsInter.findButton('bots:refresh');
    assert.ok(refreshBtn, 'Bots panel must include refresh button');
    console.log(`  ✓ Slash command /bots rendered panel with ${components.length} components`);
    checksPassed++;

    // 3.3 Test panel button click (bots:refresh)
    const btnInter = await discordEngine.dispatchButton('bots:refresh');
    assert.strictEqual(btnInter.replied || btnInter.deferred, true, 'Button interaction must be acknowledged');
    console.log('  ✓ Panel button interaction (bots:refresh) executed');
    checksPassed++;
  }

  // ===========================================================================
  // Summary & Verification Attestation
  // ===========================================================================
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('================================================================');
  console.log(`🎉 ALL ${checksPassed} HARNESS CHECKS PASSED IN ${totalDuration}s!`);
  console.log('================================================================');
  return { ok: true, checksPassed, durationSec: totalDuration };
}

if (require.main === module) {
  runHarnessSelfTest()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ HARNESS SELF-TEST FAILED:\n', err);
      process.exit(1);
    });
}

module.exports = { runHarnessSelfTest };
