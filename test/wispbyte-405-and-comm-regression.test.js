'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createApp } = require('../src/http/app');
const { createMockSupabaseServer } = require('./e2e/harness/mock-supabase');
const { createSupabaseClient } = require('../src/storage/supabase-client');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const SupabaseCommandStore = require('../src/storage/supabase-command-store');
const { WorkerRegistry } = require('../src/services/worker-registry');
const CommandBroker = require('../src/services/command-broker');
const { AccessControl } = require('../src/services/access-control');
const { encryptSecret, hashAdminPasswordAsync } = require('../src/utils/secrets');

function createCaptureLogger() {
  const logs = { info: [], warn: [], error: [], debug: [] };
  return {
    logs,
    info: (msg, meta) => logs.info.push({ msg, meta }),
    warn: (msg, meta) => logs.warn.push({ msg, meta }),
    error: (msg, meta) => logs.error.push({ msg, meta }),
    debug: (msg, meta) => logs.debug.push({ msg, meta })
  };
}

async function startRegressionHarness({
  seedWorkers = [],
  fetchImpl = null,
  commandResultTimeoutMs = 4000,
  workerPollWaitMs = 2000
} = {}) {
  const supabaseServer = await createMockSupabaseServer();
  const supabaseClient = createSupabaseClient({ url: supabaseServer.url, secretKey: supabaseServer.secretKey });
  const workerStore = new SupabaseWorkerStore(supabaseClient);
  const store = new SupabaseDashboardStore(supabaseClient);
  const commandStore = new SupabaseCommandStore(supabaseClient, { allowUnsafeSingleInstanceFallback: true });
  await workerStore.initialize();
  await store.initialize();
  await commandStore.initialize();

  const encKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const encKey = Buffer.from(encKeyHex, 'hex');

  if (seedWorkers.length > 0) {
    supabaseServer.seed('manager_workers', seedWorkers.map((w) => ({
      ...w,
      secret_ciphertext: w.secret ? encryptSecret(w.secret, encKey) : w.secret_ciphertext
    })));
  }

  const registry = new WorkerRegistry({
    store: workerStore,
    accessStore: store,
    encryptionKey: encKey,
    adminNotifier: null
  });
  await registry.load();

  const adminPassword = 'AdminPass!99';
  registry.setAdminPassword(await hashAdminPasswordAsync(adminPassword));

  const logger = createCaptureLogger();
  const config = {
    adminUsername: 'admin',
    adminPassword,
    sessionSecret: 'test-session-secret-0123456789abcdef',
    encryptionKey: encKey,
    encryptionKeyHex: encKeyHex,
    publicBaseUrl: 'https://manager.example.com',
    workerPollWaitMs,
    commandResultTimeoutMs
  };

  const defaultFetch = async () => ({
    ok: false,
    status: 405,
    text: async () => '<!DOCTYPE html><html><head><title>405 Not Allowed</title></head><body>405 Method Not Allowed</body></html>',
    json: async () => { throw new SyntaxError('Unexpected token <'); }
  });

  const broker = new CommandBroker({
    registry,
    commandStore,
    config,
    logger,
    fetchImpl: fetchImpl || defaultFetch
  });

  const app = createApp({
    store,
    workerStore,
    commandStore,
    registry,
    broker,
    entitlementService: { redeem: async () => ({ ok: true }) },
    accessControl: new AccessControl({ store }),
    config,
    logger
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: adminPassword })
  });
  const loginJson = await loginRes.json();
  assert.equal(loginRes.status, 200, 'Admin login in harness must succeed');
  const adminHeaders = {
    Authorization: `Bearer ${loginJson.token}`,
    'Content-Type': 'application/json'
  };

  return {
    baseUrl,
    encKey,
    logger,
    registry,
    broker,
    workerStore,
    store,
    commandStore,
    adminHeaders,
    async close() {
      broker.stopOutboxProcessor();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
      });
      await supabaseServer.close();
    }
  };
}

test('1. Exact 405 bug repro: Wispbyte worker misregistered as render with wispbyte.com URL routes stop via poll and self-heals', async () => {
  const secret23 = 's'.repeat(32);
  let renderFetchCalled = false;
  const env = await startRegressionHarness({
    seedWorkers: [{
      worker_id: '23',
      bot_number: 23,
      name: 'KingMC Bot 23',
      enabled: true,
      provider: 'render',
      service_url: 'https://wispbyte.com/client/servers/42fefa91',
      render_service_id: '',
      secret: secret23,
      settings: { ecoMode: true, rentable: true },
      status: { state: 'online', online: true },
      events: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }],
    fetchImpl: async () => {
      renderFetchCalled = true;
      return {
        ok: false,
        status: 405,
        text: async () => '<html><body>405 Not Allowed</body></html>',
        json: async () => { throw new SyntaxError('Unexpected token <'); }
      };
    }
  });

  try {
    // Worker #23 establishes active long-poll with transport: 'wispbyte-poll'
    const abortCtrl = new AbortController();
    const pollPromise = fetch(`${env.baseUrl}/api/v1/workers/23/poll`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': secret23,
        'x-manager-bot-id': '23'
      },
      body: JSON.stringify({
        status: {
          state: 'online',
          online: true,
          transport: 'wispbyte-poll',
          username: 'TestBot23'
        },
        waitMs: 3000
      }),
      signal: abortCtrl.signal
    });

    // Wait briefly until poll waiter is active in broker
    for (let i = 0; i < 30 && !env.broker.hasActivePoller('23'); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(env.broker.hasActivePoller('23'), true, 'Worker 23 poll waiter must be active');

    // Admin/user triggers POST /api/manager/bot/23/stop while worker is polling
    const stopRequestPromise = fetch(`${env.baseUrl}/api/manager/bot/23/stop`, {
      method: 'POST',
      headers: env.adminHeaders,
      body: JSON.stringify({})
    });

    // Worker receives the stop command from poll response
    const pollRes = await pollPromise;
    assert.equal(pollRes.status, 200);
    const pollJson = await pollRes.json();
    assert.equal(pollJson.ok, true);
    assert.equal(pollJson.command?.action, 'stop', 'CommandBroker must deliver stop via poll instead of POSTing to wispbyte.com');
    assert.equal(renderFetchCalled, false, 'dispatchRender must NOT be called for Wispbyte poller');

    // Worker submits command execution result
    const resultRes = await fetch(`${env.baseUrl}/api/v1/workers/23/result`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': secret23,
        'x-manager-bot-id': '23'
      },
      body: JSON.stringify({
        commandId: pollJson.command.commandId,
        action: 'stop',
        result: { ok: true, state: 'stopped', online: false, manuallyStopped: true }
      })
    });
    assert.equal(resultRes.status, 200);

    const stopRes = await stopRequestPromise;
    assert.equal(stopRes.status, 200, 'POST /api/manager/bot/23/stop must succeed with HTTP 200');
    const stopJson = await stopRes.json();
    assert.equal(stopJson.ok, true);

    // Registry & DB must self-heal provider -> 'wispbyte' and clear panel serviceUrl
    const healed = await env.registry.find('23', { bypassCache: true });
    assert.equal(healed.provider, 'wispbyte', 'Worker provider must auto-heal to wispbyte');
    assert.equal(healed.serviceUrl, '', 'Wispbyte control panel URL must be cleared');
    assert.equal(healed.status?.transport, 'wispbyte-poll', 'Worker transport must remain wispbyte-poll');
    assert.equal(
      env.logger.logs.error.some((e) => e.msg === 'Bot action failed'),
      false,
      'Bot action failed error alert must NOT be logged'
    );
  } finally {
    await env.close();
  }
});

test('2. CommandBroker.dispatchRender handles non-JSON upstream responses (405, 404, 503, 200 HTML) cleanly', async () => {
  const secret1 = 'r'.repeat(32);
  let nextMockResponse = { status: 405, ok: false, bodyText: '<html>405 Not Allowed</html>' };

  const broker = new CommandBroker({
    registry: {
      find: async () => ({
        workerId: 'r1',
        provider: 'render',
        serviceUrl: 'https://bot-r1.onrender.com',
        enabled: true
      }),
      credential: async () => secret1,
      updateStatus: async () => ({})
    },
    commandStore: {},
    config: { commandResultTimeoutMs: 5000 },
    logger: createCaptureLogger(),
    fetchImpl: async () => ({
      ok: nextMockResponse.ok,
      status: nextMockResponse.status,
      text: async () => nextMockResponse.bodyText,
      json: async () => { throw new SyntaxError('Unexpected token <'); }
    })
  });

  // 2a. HTTP 405 HTML -> INVALID_WORKER_URL (status 422), NOT opaque "Remote server returned invalid JSON (405)."
  nextMockResponse = { status: 405, ok: false, bodyText: '<!DOCTYPE html><html><body>405 Method Not Allowed</body></html>' };
  await assert.rejects(
    () => broker.dispatchRender({ workerId: 'r1', provider: 'render', serviceUrl: 'https://bot-r1.onrender.com' }, { commandId: 'c1', action: 'stop', payload: {} }),
    (err) => {
      assert.notEqual(err.message, 'Remote server returned invalid JSON (405).');
      assert.equal(err.code, 'INVALID_WORKER_URL');
      assert.equal(err.status, 422);
      assert.match(err.message, /405/);
      return true;
    }
  );

  // 2b. HTTP 404 HTML -> WORKER_NOT_FOUND (status 502)
  nextMockResponse = { status: 404, ok: false, bodyText: '<html>Not Found</html>' };
  await assert.rejects(
    () => broker.dispatchRender({ workerId: 'r1', provider: 'render', serviceUrl: 'https://bot-r1.onrender.com' }, { commandId: 'c2', action: 'stop', payload: {} }),
    (err) => err.code === 'WORKER_NOT_FOUND' && err.status === 502 && /404/.test(err.message)
  );

  // 2c. HTTP 503 HTML -> WORKER_UNAVAILABLE (status 503)
  nextMockResponse = { status: 503, ok: false, bodyText: '<html>Service Unavailable / Render sleeping</html>' };
  await assert.rejects(
    () => broker.dispatchRender({ workerId: 'r1', provider: 'render', serviceUrl: 'https://bot-r1.onrender.com' }, { commandId: 'c3', action: 'stop', payload: {} }),
    (err) => err.code === 'WORKER_UNAVAILABLE' && err.status === 503 && /503/.test(err.message)
  );

  // 2d. HTTP 200 HTML -> INVALID_WORKER_URL (status 502)
  nextMockResponse = { status: 200, ok: true, bodyText: '<!DOCTYPE html><html><body>Welcome</body></html>' };
  await assert.rejects(
    () => broker.dispatchRender({ workerId: 'r1', provider: 'render', serviceUrl: 'https://bot-r1.onrender.com' }, { commandId: 'c4', action: 'stop', payload: {} }),
    (err) => err.code === 'INVALID_WORKER_URL' && err.status === 502 && /HTML|JSON/i.test(err.message)
  );
});

test('3. Admin bot registration & PATCH handle Wispbyte panel URLs, Dual-Slot Wispbyte, and provider switching', async () => {
  const env = await startRegressionHarness();
  try {
    // 3a. Pasting Wispbyte panel URL must create 2 Wispbyte pull workers with empty serviceUrl and wispbyte envConfig
    const panelRes = await fetch(`${env.baseUrl}/api/manager/bots`, {
      method: 'POST',
      headers: env.adminHeaders,
      body: JSON.stringify({
        urls: ['https://wispbyte.com/client/servers/42fefa91'],
        label: 'WispNode'
      })
    });
    assert.equal(panelRes.status, 201);
    const panelJson = await panelRes.json();
    assert.equal(panelJson.ok, true);
    assert.equal(panelJson.bots.length, 2, 'Wispbyte panel URL must auto-create 2 dual-slot bots');
    for (const bot of panelJson.bots) {
      assert.equal(bot.provider, 'wispbyte');
      assert.equal(bot.serviceUrl, '');
    }
    assert.match(panelJson.envConfig, /WORKER_TRANSPORT=wispbyte-poll/);
    assert.match(panelJson.envConfig, /WORKER_BOT_COUNT=2/);

    // 3b. Adding Wispbyte bots without URLs with explicit slots: 2, count: 1
    const manualDualRes = await fetch(`${env.baseUrl}/api/manager/bots`, {
      method: 'POST',
      headers: env.adminHeaders,
      body: JSON.stringify({
        provider: 'wispbyte',
        slots: 2,
        count: 1,
        label: 'PureWisp'
      })
    });
    assert.equal(manualDualRes.status, 201);
    const manualDualJson = await manualDualRes.json();
    assert.equal(manualDualJson.bots.length, 2);
    assert.equal(manualDualJson.bots[0].provider, 'wispbyte');
    assert.match(manualDualJson.envConfig, /WORKER_TRANSPORT=wispbyte-poll/);
    assert.match(manualDualJson.envConfig, /WORKER_ID_2=/);

    // 3c. Backward compatibility: omitting urls & slots still creates 1 bot
    const singleRes = await fetch(`${env.baseUrl}/api/manager/bots`, {
      method: 'POST',
      headers: env.adminHeaders,
      body: JSON.stringify({ name: 'Single Legacy Bot' })
    });
    assert.equal(singleRes.status, 201);
    const singleJson = await singleRes.json();
    assert.equal(singleJson.bots.length, 1);

    // 3d. PATCH /api/manager/bot/:id auto-converts Wispbyte control panel URL to wispbyte provider with empty url
    const firstId = panelJson.bots[0].workerId;
    const panelPatchRes = await fetch(`${env.baseUrl}/api/manager/bot/${firstId}`, {
      method: 'PATCH',
      headers: env.adminHeaders,
      body: JSON.stringify({ url: 'https://wispbyte.com/client/servers/42fefa91', label: 'Updated Wisp' })
    });
    assert.equal(panelPatchRes.status, 200);
    const panelPatchJson = await panelPatchRes.json();
    assert.equal(panelPatchJson.bot.provider, 'wispbyte');
    assert.equal(panelPatchJson.bot.url, '');
    assert.equal(panelPatchJson.bot.label, 'Updated Wisp');

    // 3e. PATCH /api/manager/bot/:id clearing URL on misclassified Render bot switches provider to 'wispbyte'
    const renderSeedSecret = 'q'.repeat(32);
    const seededRender = await env.registry.add({
      workerId: 'legacy-misconfigured',
      name: 'Misconfigured Bot',
      provider: 'render',
      serviceUrl: 'https://example.onrender.com',
      secret: renderSeedSecret
    });
    assert.equal(seededRender.worker.provider, 'render');

    const clearUrlPatchRes = await fetch(`${env.baseUrl}/api/manager/bot/legacy-misconfigured`, {
      method: 'PATCH',
      headers: env.adminHeaders,
      body: JSON.stringify({ url: '' })
    });
    assert.equal(clearUrlPatchRes.status, 200);
    const clearUrlJson = await clearUrlPatchRes.json();
    assert.equal(clearUrlJson.ok, true);
    assert.equal(clearUrlJson.bot.provider, 'wispbyte');
    assert.equal(clearUrlJson.bot.url, '');
  } finally {
    await env.close();
  }
});

test('4. touchHeartbeat uses statusLock + 90s coalescing + returning:false on fromPoll', async () => {
  const secret = 'k'.repeat(32);
  const env = await startRegressionHarness({
    seedWorkers: [{
      worker_id: 'hb-1',
      bot_number: 1,
      name: 'HB Bot',
      enabled: true,
      provider: 'wispbyte',
      service_url: '',
      render_service_id: '',
      secret,
      settings: { ecoMode: true, rentable: true },
      status: { state: 'online' },
      events: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }]
  });

  try {
    const updateCalls = [];
    const origUpdate = env.registry.store.update.bind(env.registry.store);
    env.registry.store.update = async (id, patch, opts) => {
      updateCalls.push({ id, patch, opts });
      return origUpdate(id, patch, opts);
    };

    const r1 = await env.registry.touchHeartbeat('hb-1', { fromPoll: true });
    assert.ok(r1);
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].opts?.returning, false);

    // Second fromPoll within 90s must coalesce (0 extra DB writes)
    const r2 = await env.registry.touchHeartbeat('hb-1', { fromPoll: true });
    assert.ok(r2);
    assert.equal(updateCalls.length, 1);
  } finally {
    await env.close();
  }
});

test('5. invalidateCache/setSetting clear maintenance & announcement caches; botCount=0 preserved', async () => {
  const env = await startRegressionHarness();
  const { getMaintenanceState, setMaintenanceState } = require('../src/utils/maintenance');

  try {
    await setMaintenanceState(env.store, { enabled: true, message: 'Maint v1' }, 'admin');
    env.store.cachedAnnouncement = { enabled: true, content: 'Announce v1' };
    env.store.cachedAnnouncementAt = Date.now();

    await env.store.setSetting('system_maintenance', { enabled: false, message: 'Maint v2' });
    assert.equal(env.store.cachedMaintenance, undefined);
    const loadedMaint = await getMaintenanceState(env.store);
    assert.equal(loadedMaint.enabled, false);

    env.store.invalidateCache();
    assert.equal(env.store.cachedMaintenance, undefined);
    assert.equal(env.store.cachedAnnouncement, undefined);

    const saved = await env.store.setAccess('usr_zero_slot', {
      username: 'zero_slot_user',
      role: 'user',
      status: 'active',
      botCount: 0,
      assignedBotIds: []
    }, 'admin');
    assert.equal(saved.botCount, 0, 'setAccess must preserve explicit botCount: 0');
  } finally {
    await env.close();
  }
});

test('6. batch-import auto-converts Wispbyte panel URLs & 4xx worker rejection logs warn (not error)', async () => {
  const secret = 'm'.repeat(32);
  const env = await startRegressionHarness({
    seedWorkers: [{
      worker_id: 'w4xx',
      bot_number: 1,
      name: 'Warn Test Bot',
      enabled: true,
      provider: 'wispbyte',
      service_url: '',
      render_service_id: '',
      secret,
      settings: { ecoMode: true, rentable: true },
      status: { state: 'stopped' },
      events: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }]
  });

  try {
    const batchRes = await fetch(`${env.baseUrl}/api/manager/bots/batch-import`, {
      method: 'POST',
      headers: env.adminHeaders,
      body: JSON.stringify({
        bots: [{ label: 'BatchWisp', url: 'https://wispbyte.com/client/servers/deadbeef' }]
      })
    });
    assert.equal(batchRes.status, 200);
    const batchJson = await batchRes.json();
    assert.equal(batchJson.bots.length, 1);
    assert.equal(batchJson.bots[0].provider, 'wispbyte');
    assert.equal(batchJson.bots[0].serviceUrl, '');

    const origDispatch = env.broker.dispatch.bind(env.broker);
    env.broker.dispatch = async () => ({
      delivered: true,
      result: { ok: false, error: 'CREDENTIALS_MISSING', status: 422, detail: 'Missing MC account' }
    });
    const beforeErrCount = env.logger.logs.error.length;
    const beforeWarnCount = env.logger.logs.warn.length;
    const actRes = await fetch(`${env.baseUrl}/api/manager/bot/w4xx/start`, {
      method: 'POST',
      headers: env.adminHeaders,
      body: JSON.stringify({})
    });
    env.broker.dispatch = origDispatch;
    assert.equal(actRes.status, 422);
    assert.equal(env.logger.logs.error.length, beforeErrCount, '422 rejection must NOT emit error log');
    assert.equal(env.logger.logs.warn.length, beforeWarnCount + 1, '422 rejection must emit warn log');
  } finally {
    await env.close();
  }
});

test('7. Discord logs:refresh renders renderBotLogs & Dashboard UI/CDN contracts hold', async () => {
  const { renderBotLogs } = require('../src/discord/panels/renderer');
  const { handlePanelInteraction } = require('../src/discord/handlers/panel-handler');
  const DASHBOARD = require('../src/http/views/dashboard');

  const logView = renderBotLogs({
    user: { role: 'admin' },
    worker: { workerId: 'b_log', botNumber: 1, name: 'LogBot' },
    logs: [{ time: new Date().toISOString(), type: 'info', message: 'Connected ok' }]
  });
  const btnIds = logView.components.flatMap((row) => row.components.map((c) => c.data.custom_id));
  assert.ok(btnIds.includes('logs:refresh:b_log'), 'renderBotLogs must wire logs:refresh:<id>');

  let updatedPanel = null;
  await handlePanelInteraction({
    guildId: 'g1',
    user: { id: 'adm1' },
    guild: { id: 'g1', ownerId: 'adm1' },
    customId: 'logs:refresh:b_log',
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferred: false,
    replied: false,
    deferUpdate: async function () { this.deferred = true; },
    editReply: async (p) => { updatedPanel = p; },
    update: async (p) => { updatedPanel = p; }
  }, {
    config: { discordGuildId: 'g1', adminUserId: 'adm1' },
    accessStore: { getUserByDiscordId: async () => ({ id: 'adm', username: 'admin', role: 'admin', status: 'active' }) },
    registry: { find: async () => ({ workerId: 'b_log', botNumber: 1, name: 'LogBot' }) },
    store: { get: async () => ({ events: [{ time: new Date().toISOString(), type: 'info', message: 'Panel log line' }] }) }
  });
  assert.ok(updatedPanel?.embeds?.[0]?.data?.description?.includes('Panel log line'));

  assert.match(DASHBOARD.HTML, /id="editBotProvider"/);
  assert.match(DASHBOARD.HTML, /stage === 'cdn'/);
});
