'use strict';

const assert = require('node:assert');
const { AccessControl } = require('../src/services/access-control');
const botsCommand = require('../src/discord/commands/bots');
const logsCommand = require('../src/discord/commands/logs');
const {
  getUserBots,
  handlePanelInteraction
} = require('../src/discord/handlers/panel-handler');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');

// ============================================================================
// 1. TEST ACC-11-01: AccessControl isEntitled Null Expiration Handling
// ============================================================================
async function testACC1101IsEntitledNullExpiration() {
  console.log('1. Testing ACC-11-01: AccessControl isEntitled Null Expiration Handling...');

  const mockStore = {
    getAccess: async (id) => null,
    setAccess: async () => true,
    removeAccess: async () => true
  };
  const ac = new AccessControl({ store: mockStore });

  // 1.1 Null / undefined member
  assert.strictEqual(ac.isEntitled(null), false, 'Null member must be unentitled');
  assert.strictEqual(ac.isEntitled(undefined), false, 'Undefined member must be unentitled');

  // 1.2 Disabled status
  assert.strictEqual(
    ac.isEntitled({ status: 'disabled', isPermanent: true, expiresAt: null }),
    false,
    'Disabled member must be unentitled even if isPermanent is true'
  );
  assert.strictEqual(
    ac.isEntitled({ status: 'DISABLED', isPermanent: false, expiresAt: new Date(Date.now() + 100000).toISOString() }),
    false,
    'Case-insensitive disabled status must be unentitled'
  );

  // 1.3 Permanent member
  assert.strictEqual(
    ac.isEntitled({ status: 'active', isPermanent: true, expiresAt: null }),
    true,
    'Permanent active member with null expiresAt must be entitled'
  );
  assert.strictEqual(
    ac.isEntitled({ status: 'active', isPermanent: true, expiresAt: '2020-01-01T00:00:00Z' }),
    true,
    'Permanent active member with past expiresAt must still be entitled'
  );

  // 1.4 Non-permanent with null / undefined / empty expiresAt (THE CRITICAL FIX)
  assert.strictEqual(
    ac.isEntitled({ status: 'active', isPermanent: false, expiresAt: null }),
    false,
    'ACC-11-01: Non-permanent member with null expiresAt MUST be unentitled (return false)'
  );
  assert.strictEqual(
    ac.isEntitled({ status: 'active', isPermanent: false, expiresAt: undefined }),
    false,
    'Non-permanent member with undefined expiresAt MUST be unentitled'
  );
  assert.strictEqual(
    ac.isEntitled({ status: 'active', isPermanent: false, expiresAt: '' }),
    false,
    'Non-permanent member with empty string expiresAt MUST be unentitled'
  );
  assert.strictEqual(
    ac.isEntitled({ status: 'active', expiresAt: null }), // isPermanent omitted (falsy)
    false,
    'Member with omitted isPermanent and null expiresAt MUST be unentitled'
  );

  // 1.5 Non-permanent with past / invalid expiresAt
  assert.strictEqual(
    ac.isEntitled({ status: 'active', isPermanent: false, expiresAt: '2020-01-01T00:00:00.000Z' }),
    false,
    'Member with past expiresAt MUST be unentitled'
  );
  assert.strictEqual(
    ac.isEntitled({ status: 'active', isPermanent: false, expiresAt: 'not-a-valid-date' }),
    false,
    'Member with invalid date string MUST be unentitled'
  );

  // 1.6 Non-permanent with future expiresAt
  const futureIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  assert.strictEqual(
    ac.isEntitled({ status: 'active', isPermanent: false, expiresAt: futureIso }),
    true,
    'Member with future expiresAt MUST be entitled'
  );

  // 1.7 Integration with canUseWorker & workersFor
  const testStore = {
    getAccess: async (userId) => {
      if (userId === 'user_expired') {
        return { userId, status: 'active', isPermanent: false, expiresAt: null, workerIds: ['worker-1'] };
      }
      if (userId === 'user_valid') {
        return { userId, status: 'active', isPermanent: false, expiresAt: futureIso, workerIds: ['worker-1'] };
      }
      return null;
    }
  };
  const acIntegration = new AccessControl({ store: testStore });
  const worker1 = { workerId: 'worker-1' };

  const canExpiredUse = await acIntegration.canUseWorker('user_expired', worker1, 'user');
  assert.strictEqual(canExpiredUse, false, 'Expired member must not be allowed to use worker');

  const canValidUse = await acIntegration.canUseWorker('user_valid', worker1, 'user');
  assert.strictEqual(canValidUse, true, 'Valid entitled member must be allowed to use worker');

  const expiredWorkers = await acIntegration.workersFor('user_expired', [worker1], 'user');
  assert.strictEqual(expiredWorkers.length, 0, 'workersFor must return empty array for expired member');

  const validWorkers = await acIntegration.workersFor('user_valid', [worker1], 'user');
  assert.strictEqual(validWorkers.length, 1, 'workersFor must return assigned worker for entitled member');

  console.log('✅ ACC-11-01: AccessControl isEntitled null expiration handling verified.');
}

// ============================================================================
// 2. TEST ACC-11-02: Discord Panel /bots and /logs isEntitled Checks
// ============================================================================
async function testACC1102DiscordBotsAndLogsEntitlementChecks() {
  console.log('2. Testing ACC-11-02: Discord Panel /bots and /logs isEntitled Checks...');

  const now = Date.now();
  const futureIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const pastIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const mockUsers = {
    '111111111111111111': {
      userId: 'usr_unlinked',
      linked: false
    },
    '222222222222222222': {
      userId: 'usr_expired_null',
      username: 'expired_null_user',
      role: 'user',
      status: 'active',
      isPermanent: false,
      expiresAt: null,
      assignedBotIds: ['worker-1']
    },
    '333333333333333333': {
      userId: 'usr_expired_past',
      username: 'expired_past_user',
      role: 'user',
      status: 'active',
      isPermanent: false,
      expiresAt: pastIso,
      assignedBotIds: ['worker-1']
    },
    '444444444444444444': {
      userId: 'usr_active',
      username: 'active_user',
      role: 'user',
      status: 'active',
      isPermanent: false,
      expiresAt: futureIso,
      assignedBotIds: ['worker-1']
    },
    '555555555555555555': {
      userId: 'admin',
      username: 'admin_user',
      role: 'admin',
      status: 'active',
      isPermanent: true,
      assignedBotIds: null
    }
  };

  const mockWorkers = [
    { workerId: 'worker-1', botNumber: 1, name: 'Miner Bot 1', status: { online: true } },
    { workerId: 'worker-2', botNumber: 2, name: 'Farmer Bot 2', status: { online: false } }
  ];

  let logsRetrieved = false;
  const mockServices = {
    accessStore: {
      getUserByDiscordId: async (dId) => {
        const u = mockUsers[dId];
        return u && u.linked !== false ? u : null;
      }
    },
    accessControl: new AccessControl({ store: {} }),
    registry: {
      list: async () => mockWorkers,
      find: async (id) => mockWorkers.find((w) => w.workerId === id),
      getLogs: (id) => {
        logsRetrieved = true;
        return ['[12:00:00] Bot initialized successfully'];
      }
    }
  };

  function createInteraction(discordUserId, options = {}) {
    return {
      user: { id: discordUserId },
      guild: { ownerId: '999999999999999999' },
      memberPermissions: { has: () => false },
      options: {
        getString: (name) => options[name] || null
      }
    };
  }

  // 2.1 /bots with unlinked user
  const unlinkedRes = await botsCommand.execute(createInteraction('111111111111111111'), mockServices);
  assert.ok(unlinkedRes.embeds?.[0]?.data?.title?.includes('CHƯA ĐĂNG NHẬP'), '/bots must reject unlinked user');

  // 2.2 /bots with expired user (null expiresAt) -> ACC-11-02
  const expiredNullRes = await botsCommand.execute(createInteraction('222222222222222222'), mockServices);
  assert.ok(
    expiredNullRes.embeds?.[0]?.data?.title?.includes('HẾT HẠN HOẶC BỊ KHÓA'),
    '/bots must show access denied/expired embed for user with null expiresAt'
  );
  assert.strictEqual(expiredNullRes.components, undefined, 'Expired /bots response must not include component action rows');

  // 2.3 /bots with expired user (past date)
  const expiredPastRes = await botsCommand.execute(createInteraction('333333333333333333'), mockServices);
  assert.ok(
    expiredPastRes.embeds?.[0]?.data?.title?.includes('HẾT HẠN HOẶC BỊ KHÓA'),
    '/bots must show access denied/expired embed for user with past expiresAt'
  );

  // 2.4 /bots with active entitled user
  const activeRes = await botsCommand.execute(createInteraction('444444444444444444'), mockServices);
  assert.ok(activeRes.embeds?.[0]?.data?.title?.includes('DANH SÁCH BOT'), '/bots must display bot list for active user');

  // 2.5 /bots with admin
  const adminRes = await botsCommand.execute(createInteraction('555555555555555555'), mockServices);
  assert.ok(adminRes.embeds?.[0]?.data?.title?.includes('DANH SÁCH BOT'), '/bots must display bot list for admin');

  // 2.6 /logs with unlinked user
  logsRetrieved = false;
  const unlinkedLogsRes = await logsCommand.execute(createInteraction('111111111111111111'), mockServices);
  assert.ok(unlinkedLogsRes.embeds?.[0]?.data?.title?.includes('CHƯA ĐĂNG NHẬP'), '/logs must reject unlinked user');
  assert.strictEqual(logsRetrieved, false, 'registry.getLogs must not be called for unlinked user');

  // 2.7 /logs with expired user -> ACC-11-02
  logsRetrieved = false;
  const expiredLogsRes = await logsCommand.execute(createInteraction('222222222222222222'), mockServices);
  assert.ok(
    expiredLogsRes.embeds?.[0]?.data?.title?.includes('HẾT HẠN HOẶC BỊ KHÓA'),
    '/logs must show access denied/expired embed for expired user'
  );
  assert.strictEqual(logsRetrieved, false, 'registry.getLogs must NOT be called for expired user');

  // 2.8 /logs with active user
  logsRetrieved = false;
  const activeLogsRes = await logsCommand.execute(createInteraction('444444444444444444'), mockServices);
  assert.ok(activeLogsRes.embeds?.[0]?.data?.title?.includes('NHẬT KÝ'), '/logs must show logs for entitled user');
  assert.strictEqual(logsRetrieved, true, 'registry.getLogs must be called for entitled user');

  // 2.9 getUserBots in panel-handler returns empty array for expired user
  const expiredBots = await getUserBots(mockUsers['222222222222222222'], mockServices);
  assert.strictEqual(expiredBots.length, 0, 'getUserBots must return empty array for expired user');

  const entitledBots = await getUserBots(mockUsers['444444444444444444'], mockServices);
  assert.strictEqual(entitledBots.length, 1, 'getUserBots must return assigned bots for entitled user');

  // 2.10 handlePanelInteraction button click by expired user returns expired embed
  let updatedPayload = null;
  const buttonInteraction = {
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    customId: 'bots:refresh',
    user: { id: '222222222222222222' },
    guild: { ownerId: '999999999999999999' },
    memberPermissions: { has: () => false },
    deferred: true,
    replied: false,
    editReply: async (payload) => {
      updatedPayload = payload;
      return payload;
    },
    update: async (payload) => {
      updatedPayload = payload;
      return payload;
    }
  };

  await handlePanelInteraction(buttonInteraction, mockServices);
  assert.ok(updatedPayload, 'Expired button interaction must receive update');
  assert.ok(
    updatedPayload.embeds?.[0]?.data?.title?.includes('HẾT HẠN HOẶC BỊ KHÓA'),
    'Expired button interaction must render expired embed'
  );

  console.log('✅ ACC-11-02: Discord Panel /bots and /logs isEntitled checks verified.');
}

// ============================================================================
// 3. TEST ACC-11-03: Worker Removal Assignments & User Array Cleanup
// ============================================================================
async function testACC1103WorkerRemovalAssignmentsAndUserArrayCleanup() {
  console.log('3. Testing ACC-11-03: Worker Removal Assignments & User Array Cleanup...');

  // Mock DB tables in memory
  let assignmentsTable = [
    { worker_id: 'bot-target', user_id: 'usr_alice', assigned_by: 'admin', assigned_at: '2026-01-01T00:00:00Z' },
    { worker_id: 'bot-keep-1', user_id: 'usr_alice', assigned_by: 'admin', assigned_at: '2026-01-01T00:00:00Z' },
    { worker_id: 'bot-target', user_id: 'usr_bob', assigned_by: 'admin', assigned_at: '2026-01-01T00:00:00Z' },
    { worker_id: 'bot-keep-2', user_id: 'usr_charlie', assigned_by: 'admin', assigned_at: '2026-01-01T00:00:00Z' }
  ];

  let usersTable = [
    { id: 'usr_alice', username: 'alice', assigned_bot_ids: ['bot-target', 'bot-keep-1'] },
    { id: 'usr_bob', username: 'bob', assigned_bot_ids: ['bot-target'] },
    { id: 'usr_charlie', username: 'charlie', assigned_bot_ids: ['bot-keep-2'] }
  ];

  let shouldFailAssignmentDelete = false;
  let shouldFailUserUpdate = false;

  const mockClient = {
    from: (tableName) => {
      if (tableName === 'manager_assignments') {
        return {
          delete: () => ({
            eq: async (col, val) => {
              if (shouldFailAssignmentDelete) {
                return { error: new Error('Simulated Database I/O Failure deleting assignment') };
              }
              if (col === 'worker_id') {
                const target = String(val).toLowerCase();
                assignmentsTable = assignmentsTable.filter((r) => String(r.worker_id).toLowerCase() !== target);
              }
              return { error: null };
            }
          }),
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: async () => {
                const row = assignmentsTable.find((r) => r[col] === val);
                return { data: row || null, error: null };
              }
            })
          })
        };
      }

      if (tableName === 'manager_users') {
        return {
          select: (cols) => ({
            contains: (col, arr) => {
              const target = String(arr[0]).toLowerCase();
              const matched = usersTable.filter((u) => {
                const ids = Array.isArray(u.assigned_bot_ids) ? u.assigned_bot_ids.map(String) : [];
                return ids.map((id) => id.toLowerCase()).includes(target);
              });
              return Promise.resolve({ data: matched, error: null });
            }
          }),
          update: (fields) => ({
            eq: async (col, val) => {
              if (shouldFailUserUpdate) {
                return { error: new Error('Simulated DB network failure updating user') };
              }
              const user = usersTable.find((u) => u[col] === val);
              if (user) {
                Object.assign(user, fields);
              }
              return { error: null };
            }
          })
        };
      }

      throw new Error(`Unexpected table: ${tableName}`);
    }
  };

  const store = new SupabaseDashboardStore(mockClient);

  // 3.1 Normal worker removal: cleans up ASSIGNMENTS and USERS.assigned_bot_ids
  await store.removeWorkerAssignments('bot-target');

  // Verify ASSIGNMENTS table cleanup
  const remainingAssignments = assignmentsTable.filter((r) => r.worker_id === 'bot-target');
  assert.strictEqual(remainingAssignments.length, 0, 'ASSIGNMENTS table must have zero rows for removed worker');
  assert.strictEqual(assignmentsTable.length, 2, 'Unrelated assignments must be preserved');

  // Verify USERS table assigned_bot_ids cleanup
  const alice = usersTable.find((u) => u.id === 'usr_alice');
  assert.deepStrictEqual(alice.assigned_bot_ids, ['bot-keep-1'], 'Alice must only have bot-keep-1 remaining');

  const bob = usersTable.find((u) => u.id === 'usr_bob');
  assert.deepStrictEqual(bob.assigned_bot_ids, [], 'Bob must now have empty assigned_bot_ids');

  const charlie = usersTable.find((u) => u.id === 'usr_charlie');
  assert.deepStrictEqual(charlie.assigned_bot_ids, ['bot-keep-2'], 'Charlie must remain untouched');

  // 3.2 Error propagation: elimination of empty catch blocks
  shouldFailAssignmentDelete = true;
  await assert.rejects(
    async () => {
      await store.removeWorkerAssignments('bot-keep-1');
    },
    /Simulated Database I\/O Failure/,
    'ACC-11-03: Unexpected assignment deletion failure must throw instead of being swallowed in empty catch'
  );
  shouldFailAssignmentDelete = false;

  shouldFailUserUpdate = true;
  // Re-add bot-keep-1 to bob for test
  bob.assigned_bot_ids = ['bot-keep-1'];
  await assert.rejects(
    async () => {
      await store.removeWorkerAssignments('bot-keep-1');
    },
    /Simulated DB network failure/,
    'ACC-11-03: Unexpected user update failure must throw instead of being swallowed in empty catch'
  );
  shouldFailUserUpdate = false;

  console.log('✅ ACC-11-03: Worker removal assignments and user array cleanup verified.');
}

// ============================================================================
// 4. TEST ACC-11-04: AccessControl grant() Worker Existence Validation
// ============================================================================
async function testACC1104GrantWorkerExistenceValidation() {
  console.log('4. Testing ACC-11-04: AccessControl grant() Worker Existence Validation in WorkerRegistry...');

  let savedAccess = null;
  const mockStore = {
    setAccess: async (userId, fields, actorId) => {
      savedAccess = { userId, ...fields, actorId };
      return savedAccess;
    },
    getAccess: async (userId) => savedAccess
  };

  const knownWorkers = [
    { workerId: 'bot-alpha', name: 'Alpha Bot' },
    { workerId: 'bot-beta', name: 'Beta Bot' }
  ];

  const mockRegistry = {
    list: async () => knownWorkers,
    find: async (id) => knownWorkers.find((w) => w.workerId === id)
  };

  // 4.1 Dependency Injection via constructor
  const acWithRegistry = new AccessControl({ store: mockStore, registry: mockRegistry });
  assert.strictEqual(acWithRegistry.registry, mockRegistry, 'AccessControl constructor must accept registry');

  // 4.2 Non-existent worker ID must throw Error
  savedAccess = null;
  await assert.rejects(
    async () => {
      await acWithRegistry.grant(
        'admin_actor',
        '123456789012345678',
        { workerIds: ['bot-alpha', 'bot-ghost'] },
        'admin'
      );
    },
    /Target worker "bot-ghost" does not exist in WorkerRegistry/,
    'ACC-11-04: grant() must throw when target worker does not exist in WorkerRegistry'
  );
  assert.strictEqual(savedAccess, null, 'No access record must be created if worker does not exist');

  // 4.3 Valid worker IDs must succeed
  await acWithRegistry.grant(
    'admin_actor',
    '123456789012345678',
    { workerIds: ['bot-alpha', 'bot-beta'] },
    'admin'
  );
  assert.ok(savedAccess, 'Access record must be saved for valid workers');
  assert.deepStrictEqual(savedAccess.workerIds, ['bot-alpha', 'bot-beta']);

  // 4.4 Empty workerIds must succeed
  savedAccess = null;
  await acWithRegistry.grant(
    'admin_actor',
    '123456789012345678',
    { workerIds: [] },
    'admin'
  );
  assert.ok(savedAccess, 'Access record with empty workerIds must succeed');
  assert.deepStrictEqual(savedAccess.workerIds, []);

  // 4.5 Dependency Injection via setRegistry()
  const acDynamic = new AccessControl({ store: mockStore });
  assert.strictEqual(acDynamic.registry, null);
  acDynamic.setRegistry(mockRegistry);
  assert.strictEqual(acDynamic.registry, mockRegistry, 'setRegistry() must update registry instance');

  await assert.rejects(
    async () => {
      await acDynamic.grant(
        'admin_actor',
        '123456789012345678',
        { workerIds: ['bot-unknown'] },
        'admin'
      );
    },
    /Target worker "bot-unknown" does not exist in WorkerRegistry/,
    'grant() must use registry configured via setRegistry()'
  );

  // 4.6 Dependency Injection via options.registry override
  const acNoRegistry = new AccessControl({ store: mockStore });
  await assert.rejects(
    async () => {
      await acNoRegistry.grant(
        'admin_actor',
        '123456789012345678',
        { workerIds: ['bot-unknown'], registry: mockRegistry },
        'admin'
      );
    },
    /Target worker "bot-unknown" does not exist in WorkerRegistry/,
    'grant() must use registry passed in options.registry'
  );

  // 4.7 Non-admin caller check preserved
  await assert.rejects(
    async () => {
      await acWithRegistry.grant(
        'user_actor',
        '123456789012345678',
        { workerIds: ['bot-alpha'] },
        'user'
      );
    },
    /Only admins can manage users/,
    'grant() must reject non-admin actorRole'
  );

  console.log('✅ ACC-11-04: AccessControl grant() worker existence validation verified.');
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function runAllGate3M2Tests() {
  console.log('===============================================================');
  console.log('--- GATE 3 MILESTONE 2: ACCESS CONTROL & ASSIGNMENT TESTS ---');
  console.log('===============================================================');

  await testACC1101IsEntitledNullExpiration();
  await testACC1102DiscordBotsAndLogsEntitlementChecks();
  await testACC1103WorkerRemovalAssignmentsAndUserArrayCleanup();
  await testACC1104GrantWorkerExistenceValidation();

  console.log('===============================================================');
  console.log('🎉 ALL GATE 3 MILESTONE 2 (ACC-11-01 to ACC-11-04) TESTS PASSED 100%!');
  console.log('===============================================================');
}

runAllGate3M2Tests().catch((err) => {
  console.error('❌ GATE 3 MILESTONE 2 TESTS FAILED:', err);
  process.exit(1);
});
