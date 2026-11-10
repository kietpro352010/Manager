'use strict';

const assert = require('node:assert');
const http = require('node:http');
const { ACTIONS } = require('../src/services/worker-registry');
const AsyncKeyLock = require('../src/services/async-key-lock');
const schema = require('../src/storage/schema-sql');
const { encryptSecret, decryptSecret } = require('../src/utils/secrets');
const SupabaseCommandStore = require('../src/storage/supabase-command-store');
const { createApp } = require('../src/http/app');

async function runTests() {
  console.log('--- [MANAGER INTEGRATION TESTS] ---');

  // 1. Actions unification check
  console.log('1. Checking Unified Actions Set...');
  const expectedActions = [
    'start', 'stop', 'restart', 'reconnect', 'status', 'chat', 'reset', 'set-afk-mode', 'set-proxy',
    'respawn', 'inventory', 'look', 'toss', 'window_click', 'window_close'
  ];
  for (const act of expectedActions) {
    assert.strictEqual(ACTIONS.has(act), true, `Action ${act} must be in ACTIONS set`);
  }
  assert.strictEqual(ACTIONS.size, 15, 'ACTIONS must have exactly 15 unified actions');
  console.log('✅ 1. Unified Actions Set: 15 actions verified.');

  // 2. Encryption and Decryption Roundtrip
  console.log('2. Checking Secret Encryption Roundtrip...');
  const key = Buffer.alloc(32, 7);
  const plainText = JSON.stringify({ username: 'PlayerOne', password: 'SecretPassword123' });
  const cipher = encryptSecret(plainText, key);
  assert.notStrictEqual(cipher, plainText);
  const decrypted = decryptSecret(cipher, key);
  assert.strictEqual(decrypted, plainText);
  console.log('✅ 2. Secret Encryption: AES-256-GCM roundtrip verified.');

  // 3. AsyncKeyLock Isolation & Serialization
  console.log('3. Checking AsyncKeyLock Critical Section...');
  const lock = new AsyncKeyLock();
  const executionOrder = [];
  await Promise.all([
    lock.run('bot_1', async () => {
      await new Promise(r => setTimeout(r, 40));
      executionOrder.push(1);
    }),
    lock.run('bot_1', async () => {
      executionOrder.push(2);
    })
  ]);
  assert.deepStrictEqual(executionOrder, [1, 2], 'Lock must serialize executions for the same key');
  console.log('✅ 3. AsyncKeyLock: Sequential serialization verified.');

  // 4. Schema SQL definitions & Atomic Numbering check
  console.log('4. Checking Schema SQL, Atomic Numbering & Advisory Locks...');
  const sql = typeof schema === 'string' ? schema : schema.SCHEMA_SQL;
  const requiredRpcs = [
    'manager_next_bot_number',
    'manager_set_user_access',
    'manager_redeem_code_with_access',
    'manager_claim_link4m_attempt',
    'manager_complete_link4m_reward',
    'manager_bot_number_seq'
  ];
  for (const rpc of requiredRpcs) {
    assert.ok(sql.includes(rpc), `Schema SQL must include ${rpc}`);
  }

  // Ensure manager_next_bot_number is defined EXACTLY ONCE (no overriding duplicate)
  const firstDef = sql.indexOf('CREATE OR REPLACE FUNCTION public.manager_next_bot_number()');
  const lastDef = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.manager_next_bot_number()');
  assert.strictEqual(firstDef, lastDef, 'manager_next_bot_number must be defined only ONCE in schema SQL');
  assert.ok(sql.includes('EXIT WHEN NOT EXISTS'), 'manager_next_bot_number must use atomic loop with NOT EXISTS check');
  assert.ok(sql.includes('manager_workers_bot_number_unique'), 'Schema must define UNIQUE constraint on bot_number');
  assert.ok(sql.includes('pg_advisory_xact_lock'), 'Schema must use transaction advisory lock for atomic command coalescing');
  console.log('✅ 4. Schema SQL: Atomic sequence, unique constraint & single definition verified.');

  // 5. Command Coalescing Atomic & Selectivity Check
  console.log('5. Checking Command Coalescing Atomic RPC & Fallback Concurrency...');
  const table = [];
  const rpcCalls = [];
  const mockClient = {
    rpc: async (fnName, params) => {
      rpcCalls.push({ fnName, params });
      return { data: null, error: { message: 'not implemented' } };
    },
    from: (_tbl) => {
      let filters = {};
      return {
        select: () => ({
          eq: (f, v) => {
            filters[f] = v;
            return {
              eq: (f2, v2) => {
                filters[f2] = v2;
                return {
                  eq: (f3, v3) => {
                    filters[f3] = v3;
                    return {
                      gt: () => ({
                        limit: () => ({
                          maybeSingle: async () => {
                            await new Promise(r => setTimeout(r, 10));
                            const found = table.find(r => r.worker_id === filters.worker_id && r.action === filters.action && r.status === filters.status);
                            return { data: found ? { ...found } : null, error: null };
                          }
                        })
                      })
                    };
                  }
                };
              }
            };
          }
        }),
        update: (updates) => ({
          eq: (field, val) => ({
            select: () => ({
              maybeSingle: async () => {
                await new Promise(r => setTimeout(r, 10));
                const item = table.find(r => r[field] === val);
                if (item) Object.assign(item, updates);
                return { data: item ? { ...item } : null, error: null };
              }
            })
          })
        }),
        insert: (row) => ({
          select: () => ({
            maybeSingle: async () => {
              await new Promise(r => setTimeout(r, 10));
              table.push({ ...row });
              return { data: { ...row }, error: null };
            }
          })
        })
      };
    }
  };

  const commandStore = new SupabaseCommandStore(mockClient);

  // 5a. Discrete actions concurrently (chat): must NEVER coalesce
  const [chat1, chat2] = await Promise.all([
    commandStore.enqueue({ workerId: 'w1', action: 'chat', payload: { message: 'msg1' } }),
    commandStore.enqueue({ workerId: 'w1', action: 'chat', payload: { message: 'msg2' } })
  ]);
  assert.notStrictEqual(chat1.commandId, chat2.commandId, 'Discrete actions must NOT coalesce');
  assert.strictEqual(table.filter(r => r.action === 'chat').length, 2, 'Must have 2 distinct chat records');

  // Verify RPC was passed p_allow_coalesce: false for chat
  const chatRpc = rpcCalls.find(c => c.params.p_action === 'chat');
  assert.strictEqual(chatRpc.params.p_allow_coalesce, false, 'Chat RPC must have p_allow_coalesce: false');

  // 5b. Idempotent state actions concurrently (status): MUST coalesce atomically into 1 record
  const [st1, st2] = await Promise.all([
    commandStore.enqueue({ workerId: 'w1', action: 'status', payload: {} }),
    commandStore.enqueue({ workerId: 'w1', action: 'status', payload: {} })
  ]);
  assert.strictEqual(st1.commandId, st2.commandId, 'Idempotent actions MUST coalesce to same commandId');
  assert.strictEqual(table.filter(r => r.action === 'status').length, 1, 'Must have 1 status record');

  // Verify RPC was passed p_allow_coalesce: true for status
  const statusRpc = rpcCalls.find(c => c.params.p_action === 'status');
  assert.strictEqual(statusRpc.params.p_allow_coalesce, true, 'Status RPC must have p_allow_coalesce: true');
  console.log('✅ 5. Command Coalescing: Atomic RPC parameter & concurrent fallback serialization verified.');

  // 6. Readiness Probe HTTP 503 vs 200 Verification
  console.log('6. Checking Readiness Probe (Discord + Database dependencies)...');
  const store = { adapter: { testConnection: async () => ({ ok: true }) } };

  // 6a. Discord configured but not ready -> 503
  const appUnready = createApp({
    store,
    registry: { store: {} },
    config: { discordToken: 'test_token' },
    discordClient: { isReady: () => false }
  });
  const server1 = http.createServer(appUnready);
  await new Promise(r => server1.listen(0, r));
  const res1 = await fetch(`http://127.0.0.1:${server1.address().port}/ready`);
  assert.strictEqual(res1.status, 503, 'Readiness must return 503 if Discord client is not ready');
  server1.close();

  // 6b. Discord configured and ready -> 200
  const appReady = createApp({
    store,
    registry: { store: {} },
    config: { discordToken: 'test_token' },
    discordClient: { isReady: () => true }
  });
  const server2 = http.createServer(appReady);
  await new Promise(r => server2.listen(0, r));
  const res2 = await fetch(`http://127.0.0.1:${server2.address().port}/ready`);
  assert.strictEqual(res2.status, 200, 'Readiness must return 200 when DB and Discord are ready');
  server2.close();

  // 6c. Discord not configured (web-only mode) -> 200
  const appNoDiscord = createApp({
    store,
    registry: { store: {} },
    config: { discordToken: '' },
    discordClient: null
  });
  const server3 = http.createServer(appNoDiscord);
  await new Promise(r => server3.listen(0, r));
  const res3 = await fetch(`http://127.0.0.1:${server3.address().port}/ready`);
  assert.strictEqual(res3.status, 200, 'Readiness must return 200 when Discord is not configured and DB is ok');
  server3.close();

  console.log('✅ 6. Readiness Probe: Strict 503/200 gating validated.');

  // 7. Discord Simplified Commands Check
  console.log('7. Checking Discord Simplified Commands...');
  const { loadCommands } = require('../src/discord/command-registry');
  const commands = loadCommands();
  const registeredNames = commands.map(c => c.data.name).sort();
  assert.deepStrictEqual(
    registeredNames,
    ['admin', 'bots', 'help', 'login', 'logout', 'logs'],
    'Discord commands must strictly contain only: admin, bots, help, login, logout, logs'
  );

  const bannedCommands = ['status', 'info', 'start', 'stop', 'restart', 'ping', 'uptime', 'reconnect', 'panel', 'bot', 'render', 'wispbyte', 'user', 'setup', 'system'];
  for (const banned of bannedCommands) {
    assert.strictEqual(registeredNames.includes(banned), false, `Banned standalone command /${banned} must NOT be registered`);
  }
  console.log('✅ 7. Discord Commands: Strictly 6 allowed commands, all legacy individual commands removed.');

  // 8. Discord Full Bot ID & Panel Rendering Verification
  console.log('8. Checking Discord Panel Rendering & Full Bot ID...');
  const { renderBotsList, renderBotDetail, renderBotLogs } = require('../src/discord/panels/renderer');
  const mockUser = { username: 'testuser', assignedBotIds: ['bot-test-10001'] };
  const mockOnlineWorker = {
    workerId: 'bot-test-10001',
    botNumber: 1,
    name: 'King Bot Alpha',
    provider: 'wispbyte',
    status: {
      online: true,
      state: 'online',
      username: 'MinecraftHero',
      pingMs: 42,
      uptimeSeconds: 7200,
      reconnectCount: 3
    }
  };

  // 8a. Bots list rendering
  const listResult = renderBotsList({ user: mockUser, workers: [mockOnlineWorker] });
  const listDesc = listResult.embeds[0].data.description;
  assert.ok(listDesc.includes('bot-test-10001'), 'List must display exact full Bot ID');
  assert.ok(listDesc.includes('MinecraftHero'), 'List must display Minecraft username');
  assert.ok(listDesc.includes('ONLINE'), 'List must display ONLINE status');

  // 8b. Bot detail rendering
  const detailResult = renderBotDetail({
    user: mockUser,
    worker: mockOnlineWorker,
    logs: [{ time: new Date().toISOString(), type: 'info', message: 'Connected to KingMC server' }]
  });
  const detailDesc = detailResult.embeds[0].data.description;
  assert.ok(detailDesc.includes('bot-test-10001'), 'Detail must display exact full Bot ID');
  assert.ok(detailDesc.includes('MinecraftHero'), 'Detail must display Minecraft username');
  assert.ok(detailDesc.includes('42 ms'), 'Detail must display Ping');
  assert.ok(detailDesc.includes('02h 00m'), 'Detail must display Uptime');
  assert.ok(detailDesc.includes('3'), 'Detail must display Reconnects count');

  // 8c. Control buttons states for online bot
  const controlRow = detailResult.components[0];
  const startBtn = controlRow.components.find(b => b.data.custom_id.startsWith('bot:start:'));
  const stopBtn = controlRow.components.find(b => b.data.custom_id.startsWith('bot:stop:'));
  const restartBtn = controlRow.components.find(b => b.data.custom_id.startsWith('bot:restart:'));
  assert.strictEqual(startBtn.data.disabled, true, 'START button must be disabled when bot is ONLINE');
  assert.strictEqual(stopBtn.data.disabled, false, 'STOP button must be enabled when bot is ONLINE');
  assert.strictEqual(restartBtn.data.disabled, false, 'RESTART button must be enabled when bot is ONLINE');

  // 8d. Control buttons states for offline bot
  const mockOfflineWorker = { ...mockOnlineWorker, status: { online: false, state: 'offline' } };
  const offlineDetail = renderBotDetail({ user: mockUser, worker: mockOfflineWorker });
  const offlineRow = offlineDetail.components[0];
  const offlineStart = offlineRow.components.find(b => b.data.custom_id.startsWith('bot:start:'));
  const offlineStop = offlineRow.components.find(b => b.data.custom_id.startsWith('bot:stop:'));
  assert.strictEqual(offlineStart.data.disabled, false, 'START button must be enabled when bot is OFFLINE');
  assert.strictEqual(offlineStop.data.disabled, true, 'STOP button must be disabled when bot is OFFLINE');

  // 8e. Logs panel rendering
  const logsResult = renderBotLogs({
    user: mockUser,
    worker: mockOnlineWorker,
    logs: [{ time: new Date().toISOString(), type: 'info', message: 'Secret password=SecretPass should be masked' }]
  });
  const logsDesc = logsResult.embeds[0].data.description;
  assert.ok(logsDesc.includes('bot-test-10001'), 'Logs must display exact full Bot ID');
  assert.ok(!logsDesc.includes('SecretPass'), 'Logs must sanitize sensitive secrets');
  console.log('✅ 8. Discord Panels: Full Bot ID, performance metrics & button state gating verified.');

  // 9. Discord Data Isolation & Cross-Tenant Ownership Security
  console.log('9. Checking Discord Data Isolation & Ownership Authorization Guard...');
  const { checkBotOwnership } = require('../src/discord/handlers/panel-handler');
  const userAlice = { username: 'alice', role: 'user', assignedBotIds: ['bot-01'] };
  const userBob = { username: 'bob', role: 'user', assignedBotIds: ['bot-02'] };
  const adminAccount = { username: 'admin', role: 'admin', assignedBotIds: null };

  assert.strictEqual(checkBotOwnership(userAlice, 'bot-01'), true, 'Alice must own bot-01');
  assert.strictEqual(checkBotOwnership(userAlice, 'bot-02'), false, 'Alice must NOT access Bob bot-02');
  assert.strictEqual(checkBotOwnership(userBob, 'bot-01'), false, 'Bob must NOT access Alice bot-01');
  assert.strictEqual(checkBotOwnership(userBob, 'bot-02'), true, 'Bob must own bot-02');
  assert.strictEqual(checkBotOwnership(adminAccount, 'bot-01'), true, 'Admin can manage bot-01');
  assert.strictEqual(checkBotOwnership(adminAccount, 'bot-02'), true, 'Admin can manage bot-02');
  console.log('✅ 9. Discord Data Isolation: Strict multi-tenant authorization confirmed.');

  // 10. Discord Account Linking Storage
  console.log('10. Checking Discord Account Linking Store...');
  const mockDbUsers = [
    { id: 'usr_1', username: 'alice', discord_user_id: null, assigned_bot_ids: ['bot-01'] }
  ];
  const mockDashboardClient = {
    from: (_tbl) => ({
      update: (fields) => ({
        eq: (col, val) => {
          const u = mockDbUsers.find(x => x[col] === val || x.username === val);
          if (u) Object.assign(u, fields);
          return {
            select: () => ({
              maybeSingle: async () => ({ data: u || null, error: null })
            }),
            then: (resolve) => resolve({ data: u || null, error: null })
          };
        }
      }),
      select: () => ({
        eq: (col, val) => ({
          maybeSingle: async () => {
            const u = mockDbUsers.find(x => x[col] === val);
            return { data: u ? { ...u } : null, error: null };
          }
        })
      }),
      delete: () => ({
        eq: () => Promise.resolve({ error: null })
      })
    })
  };
  const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
  const dashStore = new SupabaseDashboardStore(mockDashboardClient);

  // Link discord user
  await dashStore.linkDiscord('123456789012345678', 'alice');
  const linked = await dashStore.getUserByDiscordId('123456789012345678');
  assert.ok(linked, 'Linked user must be found');
  assert.strictEqual(linked.username, 'alice', 'Linked username must match');
  assert.deepStrictEqual(linked.assignedBotIds, ['bot-01'], 'Assigned bot IDs must be populated');

  // Unlink discord user
  await dashStore.unlinkDiscord('123456789012345678');
  const afterUnlink = await dashStore.getUserByDiscordId('123456789012345678');
  assert.strictEqual(afterUnlink, null, 'Unlinked user must not be found');
  console.log('✅ 10. Discord Account Linking: Link and unlink roundtrip verified.');

  console.log('🎉 ALL MANAGER INTEGRATION TESTS PASSED 100%!');
}

runTests().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
