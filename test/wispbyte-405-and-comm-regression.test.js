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

test('8. WorkerRegistry.load() preserves Render empty-URL placeholder & migrated Render URLs while healing Wispbyte poll/panel rows', async () => {
  const secretA = 'a'.repeat(32);
  const secretB = 'b'.repeat(32);
  const secretC = 'c'.repeat(32);
  const secretD = 'd'.repeat(32);
  const env = await startRegressionHarness({
    seedWorkers: [
      {
        worker_id: 'placeholder-render',
        bot_number: 1,
        name: 'Seeded Placeholder Render',
        enabled: true,
        provider: 'render',
        service_url: '',
        render_service_id: '',
        secret: secretA,
        settings: {},
        status: { state: 'offline', online: false },
        events: [],
        created_at: new Date().toISOString()
      },
      {
        worker_id: 'migrated-render-with-old-poll',
        bot_number: 2,
        name: 'Migrated Render',
        enabled: true,
        provider: 'render',
        service_url: 'https://bot-2.onrender.com',
        render_service_id: '',
        secret: secretB,
        settings: {},
        status: { state: 'online', transport: 'wispbyte-poll', source: 'wispbyte-poll' },
        events: [],
        created_at: new Date().toISOString()
      },
      {
        worker_id: 'empty-render-with-poll',
        bot_number: 3,
        name: 'Poll Render No URL',
        enabled: true,
        provider: 'render',
        service_url: '',
        render_service_id: '',
        secret: secretC,
        settings: {},
        status: { state: 'online', transport: 'wispbyte-poll', source: 'wispbyte-poll' },
        events: [],
        created_at: new Date().toISOString()
      },
      {
        worker_id: 'panel-render',
        bot_number: 4,
        name: 'Panel URL Render',
        enabled: true,
        provider: 'render',
        service_url: 'https://panel.wispbyte.com/client/servers/xyz999',
        render_service_id: '',
        secret: secretD,
        settings: {},
        status: { state: 'offline' },
        events: [],
        created_at: new Date().toISOString()
      }
    ]
  });

  try {
    const p1 = await env.registry.find('placeholder-render', { bypassCache: true });
    assert.equal(p1.provider, 'render', 'Seeded Render placeholder without poll telemetry must remain render on load()');

    const p2 = await env.registry.find('migrated-render-with-old-poll', { bypassCache: true });
    assert.equal(p2.provider, 'render', 'Render worker with valid HTTPS serviceUrl must NOT be flipped to wispbyte on load()');
    assert.equal(p2.serviceUrl, 'https://bot-2.onrender.com');

    const p3 = await env.registry.find('empty-render-with-poll', { bypassCache: true });
    assert.equal(p3.provider, 'wispbyte', 'Render worker with empty URL and wispbyte-poll telemetry must heal to wispbyte');

    const p4 = await env.registry.find('panel-render', { bypassCache: true });
    assert.equal(p4.provider, 'wispbyte', 'Render worker with subdomain Wispbyte panel URL must heal to wispbyte');
    assert.equal(p4.serviceUrl, '');
  } finally {
    await env.close();
  }
});

test('9. Wispbyte -> Render migration resets wispbyte-poll transport, survives partial heartbeat + reboot, and dispatches via HTTP', async () => {
  const workerSecret = 'w'.repeat(32);
  let receivedRenderDispatch = null;

  // Spin up lightweight mock Render worker HTTP endpoint
  const renderWorkerSrv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      receivedRenderDispatch = {
        url: req.url,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: { ok: true, state: 'online', transport: 'render-http' } }));
    });
  });
  await new Promise((resolve) => renderWorkerSrv.listen(0, '127.0.0.1', resolve));
  const renderWorkerUrl = `http://127.0.0.1:${renderWorkerSrv.address().port}`;

  const env = await startRegressionHarness({
    seedWorkers: [{
      worker_id: 'mig-01',
      bot_number: 1,
      name: 'Migrating Bot',
      enabled: true,
      provider: 'wispbyte',
      service_url: '',
      render_service_id: '',
      secret: workerSecret,
      settings: { ecoMode: true, rentable: true },
      status: { state: 'online', online: true, transport: 'wispbyte-poll', source: 'wispbyte-poll' },
      events: [],
      created_at: new Date().toISOString()
    }],
    fetchImpl: global.fetch
  });

  try {
    // Prime summaryCache with stale wispbyte-poll status
    await env.registry.updateStatus('mig-01', { state: 'online', online: true, transport: 'wispbyte-poll' }, 'wispbyte-poll');
    assert.ok(env.registry.summaryCache.has('mig-01'));

    // Admin migrates bot from Wispbyte -> Render via PATCH
    const patchRes = await fetch(`${env.baseUrl}/api/manager/bot/mig-01`, {
      method: 'PATCH',
      headers: env.adminHeaders,
      body: JSON.stringify({ provider: 'render', url: renderWorkerUrl })
    });
    assert.equal(patchRes.status, 200);
    const patchJson = await patchRes.json();
    assert.equal(patchJson.bot.provider, 'render');
    assert.equal(patchJson.bot.url, renderWorkerUrl);

    // summaryCache must be cleared & status transport reset to render-http
    assert.equal(env.registry.summaryCache.has('mig-01'), false);
    const afterPatch = await env.registry.find('mig-01', { bypassCache: true });
    assert.equal(afterPatch.status?.transport, 'render-http');
    assert.equal(afterPatch.status?.source, 'admin-config');
    assert.equal(env.broker._shouldUsePollTransport(afterPatch), false, 'Broker must immediately route via render-http');

    // Partial worker-heartbeat without transport must NOT inherit stale wispbyte-poll or revert provider
    const hbRes = await fetch(`${env.baseUrl}/api/v1/workers/mig-01/heartbeat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': workerSecret,
        'x-manager-bot-id': 'mig-01'
      },
      body: JSON.stringify({ status: { state: 'online', online: true } })
    });
    assert.equal(hbRes.status, 200);
    const afterHb = await env.registry.find('mig-01', { bypassCache: true });
    assert.equal(afterHb.provider, 'render');
    assert.notEqual(afterHb.status?.transport, 'wispbyte-poll');

    // Simulated reboot via registry.load() keeps provider === 'render'
    await env.registry.load();
    const afterReboot = await env.registry.find('mig-01', { bypassCache: true });
    assert.equal(afterReboot.provider, 'render');

    // Dispatching command executes via Render HTTP push
    const dispatchRes = await env.broker.dispatch('mig-01', 'status', {});
    assert.equal(dispatchRes.delivered, true);
    assert.ok(receivedRenderDispatch, 'Command must be dispatched to Render HTTP endpoint');
    assert.equal(receivedRenderDispatch.body.action, 'status');
  } finally {
    await env.close();
    await new Promise((resolve) => {
      renderWorkerSrv.close(resolve);
      renderWorkerSrv.closeAllConnections?.();
    });
  }
});

test('10. Provider PATCH/registry invariants & renderServiceId admin-only visibility', async () => {
  const sec1 = 'p'.repeat(32);
  const sec2 = 'z'.repeat(32);
  const env = await startRegressionHarness({
    seedWorkers: [
      {
        worker_id: 'wisp-no-url',
        bot_number: 1,
        name: 'Wisp Only',
        enabled: true,
        provider: 'wispbyte',
        service_url: '',
        render_service_id: '',
        secret: sec1,
        settings: { ecoMode: true, rentable: true },
        status: { state: 'offline' },
        events: []
      },
      {
        worker_id: 'render-with-srvid',
        bot_number: 2,
        name: 'Render SrvId',
        enabled: true,
        provider: 'render',
        service_url: 'https://bot-srv.onrender.com',
        render_service_id: 'srv-abc123456',
        secret: sec2,
        settings: { ecoMode: true, rentable: true },
        status: { state: 'offline' },
        events: []
      }
    ]
  });

  try {
    // 10a. PATCH { provider: 'render' } without URL & without renderServiceId -> 400
    const badPatch = await fetch(`${env.baseUrl}/api/manager/bot/wisp-no-url`, {
      method: 'PATCH',
      headers: env.adminHeaders,
      body: JSON.stringify({ provider: 'render' })
    });
    assert.equal(badPatch.status, 400);

    // Direct registry.updateSettings({ provider: 'render' }) must also throw
    await assert.rejects(
      () => env.registry.updateSettings('wisp-no-url', { provider: 'render' }),
      /Render workers need a service URL/i
    );

    // 10b. PATCH { provider: 'render', url: 'https://panel.wispbyte.com/client/servers/abc123' } -> forces wispbyte & empty url
    const forcedPanel = await fetch(`${env.baseUrl}/api/manager/bot/wisp-no-url`, {
      method: 'PATCH',
      headers: env.adminHeaders,
      body: JSON.stringify({ provider: 'render', url: 'https://panel.wispbyte.com/client/servers/abc123' })
    });
    assert.equal(forcedPanel.status, 200);
    const forcedPanelJson = await forcedPanel.json();
    assert.equal(forcedPanelJson.bot.provider, 'wispbyte');
    assert.equal(forcedPanelJson.bot.url, '');

    // 10c. Switching Render -> Wispbyte clears stale serviceUrl (even when old Render URL passed or omitted)
    const toWispStaleUrl = await fetch(`${env.baseUrl}/api/manager/bot/render-with-srvid`, {
      method: 'PATCH',
      headers: env.adminHeaders,
      body: JSON.stringify({ provider: 'wispbyte', url: 'https://bot-srv.onrender.com' })
    });
    assert.equal(toWispStaleUrl.status, 200);
    const toWispJson = await toWispStaleUrl.json();
    assert.equal(toWispJson.bot.provider, 'wispbyte');
    assert.equal(toWispJson.bot.url, '', 'Switching to wispbyte must clear stale Render serviceUrl');
    assert.equal(toWispJson.bot.renderServiceId, 'srv-abc123456', 'PATCH response must include renderServiceId');

    // SSRF URL with provider: 'wispbyte' must still be rejected with 400
    const ssrfWisp = await fetch(`${env.baseUrl}/api/manager/bot/wisp-no-url`, {
      method: 'PATCH',
      headers: env.adminHeaders,
      body: JSON.stringify({ provider: 'wispbyte', url: 'http://169.254.169.254/latest/meta-data' })
    });
    assert.equal(ssrfWisp.status, 400);

    // 10d. Admin sees renderServiceId in GET /bots & /snapshot, non-admin does NOT
    const { encryptUserPassword } = require('../src/utils/secrets');
    await env.store.setAccess('usr_nonadmin', {
      id: 'usr_nonadmin',
      username: 'regular_user',
      password: encryptUserPassword('UserPass!99'),
      role: 'user',
      status: 'active',
      isPermanent: true,
      workerIds: ['render-with-srvid']
    }, 'test-seed');
    const userLogin = await fetch(`${env.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'regular_user', password: 'UserPass!99' })
    });
    const userToken = (await userLogin.json()).token;

    const adminBots = await (await fetch(`${env.baseUrl}/api/manager/bots`, { headers: env.adminHeaders })).json();
    const adminBot2 = adminBots.bots.find((b) => b.workerId === 'render-with-srvid');
    assert.equal(adminBot2.renderServiceId, 'srv-abc123456');

    const userBots = await (await fetch(`${env.baseUrl}/api/user/bots`, {
      headers: { Authorization: `Bearer ${userToken}` }
    })).json();
    const userBot2 = userBots.bots.find((b) => b.workerId === 'render-with-srvid');
    assert.equal(userBot2.renderServiceId, undefined, 'Non-admin must NOT see renderServiceId');
    assert.equal(userBot2.serviceId, undefined, 'Non-admin must NOT see serviceId');

    const userSnap = await (await fetch(`${env.baseUrl}/api/user/bot/render-with-srvid/snapshot`, {
      headers: { Authorization: `Bearer ${userToken}` }
    })).json();
    assert.equal(userSnap.bot.renderServiceId, undefined, 'Non-admin snapshot must NOT expose renderServiceId');
  } finally {
    await env.close();
  }
});

test('11. Dashboard editBot/saveEditBot VM tests: Wispbyte panel URL detection, Render validation guard & provider switch', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');

  const elements = new Map();
  const makeEl = (id) => {
    if (!elements.has(id)) {
      const classes = new Set(['hidden']);
      elements.set(id, {
        id,
        value: '',
        textContent: '',
        innerHTML: '',
        placeholder: '',
        checked: false,
        disabled: false,
        style: {},
        dataset: {},
        classList: {
          add: (...c) => c.forEach((x) => classes.add(x)),
          remove: (...c) => c.forEach((x) => classes.delete(x)),
          contains: (x) => classes.has(x)
        },
        setAttribute: () => {},
        getAttribute: () => null,
        removeAttribute: () => {},
        appendChild: () => {},
        addEventListener: () => {}
      });
    }
    return elements.get(id);
  };

  const toasts = [];
  const patchRequests = [];
  const doc = {
    getElementById: (id) => makeEl(id),
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: (tag) => makeEl(`__dyn_${tag}_${Math.random()}`),
    hidden: false
  };
  const win = {
    __INITIAL_USER__: null,
    location: { protocol: 'https:', host: 'mgr.example.com' },
    addEventListener: () => {}
  };
  const ctx = {
    window: win,
    document: doc,
    URL,
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    navigator: { onLine: true, clipboard: { writeText: async () => {} } },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  const scriptSrc = fs.readFileSync(
    path.join(__dirname, '../src/http/views/dashboard/scripts/01-core-and-cards.js'),
    'utf8'
  );
  vm.runInContext(scriptSrc, ctx);

  // Stub UI refresh & requestJson after script loads
  ctx.showToast = (msg, type) => toasts.push({ msg, type });
  ctx.updateTagPills = () => {};
  ctx.filterBots = () => {};
  ctx.refreshHome = async () => {};
  ctx.requestJson = async (url, opts) => {
    patchRequests.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        message: 'Đã cập nhật bot.',
        bot: {
          workerId: 'b1',
          label: 'Bot 1',
          tags: [],
          rentable: true,
          provider: JSON.parse(opts.body).provider || 'wispbyte',
          url: JSON.parse(opts.body).url || '',
          renderServiceId: ''
        }
      }
    };
  };

  // 11a. Consistent Wispbyte panel URL detection
  assert.equal(ctx.isClientWispbyteControlPanelUrl('https://wispbyte.com/client/servers/abc123'), true);
  assert.equal(ctx.isClientWispbyteControlPanelUrl('https://panel.wispbyte.com/dashboard'), true);
  assert.equal(ctx.isClientWispbyteControlPanelUrl('https://other.host/client/servers/srv-1'), true);
  assert.equal(ctx.isClientWispbyteControlPanelUrl('https://bot-1.onrender.com'), false);

  // 11b. Admin editing Render bot without URL & without renderServiceId/serviceId is blocked client-side
  vm.runInContext(`
    currentUser = { role: 'admin', username: 'admin' };
    bots = [
      { workerId: 'b-no-id', id: 'b-no-id', label: 'NoId', provider: 'wispbyte', url: '', renderServiceId: '' },
      { workerId: 'b-has-id', id: 'b-has-id', label: 'HasId', provider: 'render', url: '', renderServiceId: 'srv-123' },
      { workerId: 'b-render', id: 'b-render', label: 'Ren', provider: 'render', url: 'https://bot-1.onrender.com', renderServiceId: '' },
      { workerId: 'b-wisp-stale', id: 'b-wisp-stale', label: 'WispStale', provider: 'wispbyte', url: 'https://stale-bot.onrender.com', renderServiceId: '' }
    ];
  `, ctx);

  ctx.editBot(null, 'b-no-id');
  doc.getElementById('editBotProvider').value = 'render';
  doc.getElementById('editBotUrl').value = '';
  toasts.length = 0;
  await ctx.saveEditBot();
  assert.equal(patchRequests.length, 0, 'Must NOT send PATCH for Render without URL and without renderServiceId');
  assert.ok(toasts.some((t) => /Web URL|Service ID/i.test(t.msg)));

  // 11c. Render bot WITH renderServiceId allows saving empty URL
  ctx.editBot(null, 'b-has-id');
  assert.equal(doc.getElementById('editBotProvider').value, 'render');
  await ctx.saveEditBot();
  assert.equal(patchRequests.length, 1);
  assert.equal(patchRequests[0].body.provider, 'render');

  // 11d. Switching Render -> Wispbyte clears #editBotUrl UX cleanly and sends url: ''
  patchRequests.length = 0;
  ctx.editBot(null, 'b-render');
  assert.equal(doc.getElementById('editBotProvider').value, 'render');
  assert.equal(doc.getElementById('editBotUrl').value, 'https://bot-1.onrender.com');
  doc.getElementById('editBotProvider').value = 'wispbyte';
  ctx.handleEditBotProviderChange();
  assert.equal(doc.getElementById('editBotUrl').value, '', 'Switching provider to wispbyte must clear #editBotUrl');
  // Switching back before saving restores stashed Render URL
  doc.getElementById('editBotProvider').value = 'render';
  ctx.handleEditBotProviderChange();
  assert.equal(doc.getElementById('editBotUrl').value, 'https://bot-1.onrender.com');
  // Switching to wispbyte & saving sends url: ''
  doc.getElementById('editBotProvider').value = 'wispbyte';
  ctx.handleEditBotProviderChange();
  await ctx.saveEditBot();
  assert.equal(patchRequests.length, 1);
  assert.equal(patchRequests[0].body.provider, 'wispbyte');
  assert.equal(patchRequests[0].body.url, '');

  // 11e. Opening editBot on wispbyte bot with stale Render URL displays '' and stashes URL for render toggle
  patchRequests.length = 0;
  ctx.editBot(null, 'b-wisp-stale');
  assert.equal(doc.getElementById('editBotProvider').value, 'wispbyte');
  assert.equal(doc.getElementById('editBotUrl').value, '', 'Wispbyte edit modal must not display stale Render URL');
  doc.getElementById('editBotProvider').value = 'render';
  ctx.handleEditBotProviderChange();
  assert.equal(doc.getElementById('editBotUrl').value, 'https://stale-bot.onrender.com');
});

test('12. Live migration resists straggler /poll, future lastStateAt clock skew, and allows clean Render -> Wispbyte rollback', async () => {
  const sec = 'm'.repeat(32);
  let renderHttpCount = 0;
  const renderSrv = http.createServer((req, res) => {
    renderHttpCount += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: { ok: true, state: 'online', transport: 'render-http' } }));
  });
  await new Promise((resolve) => renderSrv.listen(0, '127.0.0.1', resolve));
  const renderUrl = `http://127.0.0.1:${renderSrv.address().port}`;

  const env = await startRegressionHarness({
    seedWorkers: [{
      worker_id: 'mig-live',
      bot_number: 1,
      name: 'Live Mig Bot',
      enabled: true,
      provider: 'wispbyte',
      service_url: '',
      render_service_id: '',
      secret: sec,
      settings: { ecoMode: true, rentable: true },
      status: {
        state: 'online',
        online: true,
        transport: 'wispbyte-poll',
        source: 'wispbyte-poll',
        lastStateAt: new Date(Date.now() + 600000).toISOString()
      },
      events: [],
      created_at: new Date().toISOString()
    }],
    fetchImpl: global.fetch,
    workerPollWaitMs: 3000
  });

  try {
    // Active Wispbyte poller holds /poll open
    const activePollPromise = fetch(`${env.baseUrl}/api/v1/workers/mig-live/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': sec },
      body: JSON.stringify({ status: { state: 'online', transport: 'wispbyte-poll' }, waitMs: 3000 })
    });
    for (let i = 0; i < 40 && !env.broker.hasActivePoller('mig-live'); i++) {
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(env.broker.hasActivePoller('mig-live'), true);

    // Admin migrates to Render via PATCH -> must immediately wake active poller
    const patchRes = await fetch(`${env.baseUrl}/api/manager/bot/mig-live`, {
      method: 'PATCH',
      headers: env.adminHeaders,
      body: JSON.stringify({ provider: 'render', url: renderUrl })
    });
    assert.equal(patchRes.status, 200);
    assert.equal(env.broker.hasActivePoller('mig-live'), false, 'PATCH to render must immediately wake existing poller waiter');
    const firstPollRes = await activePollPromise;
    assert.equal(firstPollRes.status, 200);

    // Straggler /poll from retiring Wispbyte must be rejected with 409 and NOT corrupt DB
    const stragglerPoll = await fetch(`${env.baseUrl}/api/v1/workers/mig-live/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': sec },
      body: JSON.stringify({ status: { state: 'online', transport: 'wispbyte-poll' }, waitMs: 100 })
    });
    assert.equal(stragglerPoll.status, 409);
    assert.equal(env.broker.hasActivePoller('mig-live'), false);

    // Direct updateStatus/touchHeartbeat poll calls must NOT flip provider back to wispbyte when Render URL is valid
    await env.registry.updateStatus('mig-live', { state: 'online', transport: 'wispbyte-poll' }, 'wispbyte-poll');
    await env.registry.touchHeartbeat('mig-live', { fromPoll: true });
    const afterStragglers = await env.registry.find('mig-live', { bypassCache: true });
    assert.equal(afterStragglers.provider, 'render');
    assert.equal(afterStragglers.serviceUrl, renderUrl);
    assert.equal(afterStragglers.status?.transport, 'render-http');

    // Render heartbeat with current timestamp succeeds despite old Wispbyte +10m future lastStateAt
    const hbRes = await fetch(`${env.baseUrl}/api/v1/workers/mig-live/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': sec },
      body: JSON.stringify({
        status: {
          state: 'online',
          online: true,
          transport: 'render-http',
          username: 'RenderUser',
          lastStateAt: new Date().toISOString()
        }
      })
    });
    assert.equal(hbRes.status, 200);
    const afterHb = await env.registry.find('mig-live', { bypassCache: true });
    assert.equal(afterHb.status?.username, 'RenderUser', 'New Render heartbeat must not be dropped by old Wispbyte clock skew');

    // Command dispatches via Render HTTP immediately
    const disp = await env.broker.dispatch('mig-live', 'status', {});
    assert.equal(disp.delivered, true);
    assert.equal(renderHttpCount, 1);

    // Rollback Render -> Wispbyte resets transport and allows /poll again
    const rollbackRes = await fetch(`${env.baseUrl}/api/manager/bot/mig-live`, {
      method: 'PATCH',
      headers: env.adminHeaders,
      body: JSON.stringify({ provider: 'wispbyte' })
    });
    assert.equal(rollbackRes.status, 200);
    const afterRollback = await env.registry.find('mig-live', { bypassCache: true });
    assert.equal(afterRollback.provider, 'wispbyte');
    assert.equal(afterRollback.serviceUrl, '');
    assert.equal(afterRollback.status?.transport, 'wispbyte-poll');

    const wispPollAfterRollback = await fetch(`${env.baseUrl}/api/v1/workers/mig-live/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': sec },
      body: JSON.stringify({ status: { state: 'online', transport: 'wispbyte-poll' }, waitMs: 50 })
    });
    assert.equal(wispPollAfterRollback.status, 200);
  } finally {
    await env.close();
    await new Promise((resolve) => {
      renderSrv.close(resolve);
      renderSrv.closeAllConnections?.();
    });
  }
});

test('13. batch-import handles renderServiceId and clears stale URL when provider is wispbyte', async () => {
  const env = await startRegressionHarness();
  try {
    const res = await fetch(`${env.baseUrl}/api/manager/bots/batch-import`, {
      method: 'POST',
      headers: env.adminHeaders,
      body: JSON.stringify({
        bots: [
          { label: 'WispWithUrl', provider: 'wispbyte', url: 'http://127.0.0.1:45101' },
          { label: 'RenderById', provider: 'render', url: 'http://127.0.0.1:45102', renderServiceId: 'srv-xyz999' },
          { label: 'WispSsrf', provider: 'wispbyte', url: 'http://169.254.169.254/latest/meta-data' }
        ]
      })
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.addedCount, 2);
    assert.equal(json.skippedCount, 1);
    const wisp = json.bots.find((b) => b.name === 'WispWithUrl');
    const ren = json.bots.find((b) => b.name === 'RenderById');
    assert.equal(wisp.provider, 'wispbyte');
    assert.equal(wisp.serviceUrl, '');
    assert.equal(ren.provider, 'render');
    assert.equal(ren.renderServiceId, 'srv-xyz999');
  } finally {
    await env.close();
  }
});

test('14. Offline Wispbyte worker can be marked stopped (with manuallyStopped bootstrap flag) and exports exact Wispbyte ENV', async () => {
  const secret23 = 'z'.repeat(32);
  const env = await startRegressionHarness({
    seedWorkers: [{
      worker_id: '23',
      bot_number: 23,
      name: 'Wispbyte Bot 23',
      enabled: true,
      provider: 'wispbyte',
      service_url: '',
      render_service_id: '',
      secret: secret23,
      settings: { ecoMode: true, rentable: true },
      status: { state: 'online', online: true, username: 'Bot23Offline' },
      events: [],
      last_heartbeat: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }]
  });

  try {
    // 1. Non-stop actions still return 503 WORKER_UNAVAILABLE with helpful diagnostic message
    const startRes = await fetch(`${env.baseUrl}/api/user/bot/23/start`, {
      method: 'POST',
      headers: env.adminHeaders,
      body: JSON.stringify({})
    });
    assert.equal(startRes.status, 503);
    const startJson = await startRes.json();
    assert.equal(startJson.ok, false);
    assert.equal(startJson.code, 'WORKER_UNAVAILABLE');
    assert.match(startJson.error, /MANAGER_URL|Wispbyte/i);

    // 2. Stop action on unavailable Wispbyte worker marks stopped + manuallyStopped=true without faking reachable=true
    const stopRes = await fetch(`${env.baseUrl}/api/user/bot/23/stop`, {
      method: 'POST',
      headers: env.adminHeaders,
      body: JSON.stringify({})
    });
    assert.equal(stopRes.status, 200);
    const stopJson = await stopRes.json();
    assert.equal(stopJson.ok, true);
    assert.equal(stopJson.offlineStopped, true);
    assert.equal(stopJson.bot.status.state, 'stopped');
    assert.equal(stopJson.bot.status.online, false);
    assert.equal(stopJson.bot.status.manuallyStopped, true);
    assert.equal(stopJson.bot.reachable, false);
    assert.equal(stopJson.bot.lastHeartbeat, null);

    // Dashboard bots list reflects stopped state & manuallyStopped=true while staying reachable=false
    const botsRes = await fetch(`${env.baseUrl}/api/user/bots`, { headers: env.adminHeaders });
    assert.equal(botsRes.status, 200);
    const botsJson = await botsRes.json();
    const bot23 = botsJson.bots.find((b) => String(b.workerId || b.id) === '23');
    assert.ok(bot23);
    assert.equal(bot23.state, 'stopped');
    assert.equal(bot23.online, false);
    assert.equal(bot23.available, false);
    assert.equal(bot23.manuallyStopped, true);
    assert.equal(bot23.lastSeen, null);

    // 3. Bootstrap endpoint exposes manuallyStopped=true so container won't auto-connect when restarted
    const bootRes = await fetch(`${env.baseUrl}/api/v1/workers/23/bootstrap`, {
      headers: { 'x-worker-secret': secret23 }
    });
    assert.equal(bootRes.status, 200);
    const bootJson = await bootRes.json();
    assert.equal(bootJson.manuallyStopped, true);
    assert.equal(bootJson.state, 'stopped');

    // 4. Unauthenticated ENV fetch is blocked; Admin ENV fetch returns ready-to-paste Wispbyte variables
    const unauthEnv = await fetch(`${env.baseUrl}/api/manager/bot/23/env`);
    assert.equal(unauthEnv.status, 401);

    const envRes = await fetch(`${env.baseUrl}/api/manager/bot/23/env`, {
      headers: env.adminHeaders
    });
    assert.equal(envRes.status, 200);
    const envJson = await envRes.json();
    assert.equal(envJson.ok, true);
    assert.equal(envJson.provider, 'wispbyte');
    assert.equal(envJson.transport, 'wispbyte-poll');
    assert.equal(envJson.secretAvailable, true);
    assert.deepEqual(envJson.vars, {
      MANAGER_URL: 'https://manager.example.com',
      WORKER_TRANSPORT: 'wispbyte-poll',
      WORKER_ID_1: '23',
      WORKER_SECRET_1: secret23,
      NODE_OPTIONS: '--max-old-space-size=384'
    });
    assert.ok(envJson.envText.includes(`WORKER_SECRET_1=${secret23}`));
    assert.ok(envJson.envText.includes('WORKER_TRANSPORT=wispbyte-poll'));
  } finally {
    await env.close();
  }
});

test('15. Active poller reachability, idle poll single-take, in-place _listCache, clock-skew recovery, and UI unreachable vs STOPPED classification', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');

  const secret24 = 'k'.repeat(32);
  const oldStateAt = new Date(Date.now() + 600000).toISOString(); // Future-skewed worker clock
  const env = await startRegressionHarness({
    workerPollWaitMs: 120,
    seedWorkers: [{
      worker_id: '24',
      bot_number: 24,
      name: 'Wispbyte Bot 24',
      enabled: true,
      provider: 'wispbyte',
      service_url: '',
      render_service_id: '',
      secret: secret24,
      settings: { ecoMode: true, rentable: true },
      status: { state: 'stopped', online: false, manuallyStopped: true, lastStateAt: oldStateAt },
      events: [],
      last_heartbeat: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }]
  });

  try {
    // 15a. Before any check-in, worker 24 is unreachable; once /poll is open (waiting), worker 24 is reachable=true & available=true!
    let listBefore = await env.registry.list();
    assert.equal(listBefore.find((w) => w.workerId === '24')?.reachable, false);

    // Count idle commandStore.take() invocations during a timed-out poll
    let takeCount = 0;
    const origTake = env.commandStore.take.bind(env.commandStore);
    env.commandStore.take = async (...args) => {
      takeCount += 1;
      return origTake(...args);
    };

    let pollPromise;
    try {
      pollPromise = fetch(`${env.baseUrl}/api/v1/workers/24/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-worker-secret': secret24 },
        body: JSON.stringify({ status: { state: 'stopped', online: false, manuallyStopped: true, isLightweight: true }, waitMs: 180 })
      });

      // Wait briefly until poll enters broker.pollWaiters
      const deadline = Date.now() + 1000;
      while (!env.broker.hasActivePoller('24') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(env.broker.hasActivePoller('24'), true, 'Broker must register active poller while waiting');

      // Wipe liveHeartbeats and DB last_heartbeat to simulate stale DB + active poller only
      env.registry.liveHeartbeats.delete('24');
      await env.workerStore.update('24', { lastHeartbeat: null }, { returning: false });
      const activeList = await env.registry.list();
      assert.equal(activeList.find((w) => w.workerId === '24')?.reachable, true, 'Active poller must keep worker reachable=true even when DB heartbeat is null');

      const pollRes = await pollPromise;
      assert.equal(pollRes.status, 200);
      const pollJson = await pollRes.json();
      assert.equal(pollJson.command, null);
      assert.equal(takeCount, 1, 'Idle timed-out /poll must call commandStore.take() only ONCE, not twice');
      assert.ok(env.registry.liveHeartbeats.has('24'), 'Completed /poll must refresh liveHeartbeat for inter-poll gap');
    } finally {
      env.commandStore.take = origTake;
      if (pollPromise) await pollPromise.catch(() => {});
    }

    // 15b. In-place _listCache patching on store.update(..., { returning: false }) avoids redundant full list() queries
    const cachedPrime = await env.registry.list();
    assert.ok(cachedPrime.length >= 1);
    let listSelects = 0;
    const origFrom = env.workerStore.client.from.bind(env.workerStore.client);
    env.workerStore.client.from = (tbl) => {
      const builder = origFrom(tbl);
      if (tbl === 'manager_workers') {
        const origSelect = builder.select.bind(builder);
        builder.select = (...sArgs) => {
          listSelects += 1;
          return origSelect(...sArgs);
        };
      }
      return builder;
    };
    try {
      await env.workerStore.update('24', { status: { state: 'stopped', online: false, manuallyStopped: true } }, { returning: false });
      const cachedAfterUpdate = await env.registry.list();
      assert.equal(listSelects, 0, 'store.update(..., { returning: false }) must update _listCache in-place without forcing full DB SELECT');
      assert.equal(cachedAfterUpdate.find((w) => w.workerId === '24')?.status?.state, 'stopped');

      env.workerStore.invalidateCache('24');
      await env.registry.list();
      assert.equal(listSelects, 1, 'Explicit invalidateCache() must still bypass and trigger a fresh SELECT');
    } finally {
      env.workerStore.client.from = origFrom;
    }

    // 15c. Worker with clock skew behind previous offline-stop status still recovers back to online
    env.registry.lastDbStatusPersistAt.clear();
    await env.registry.updateStatus('24', { state: 'online', online: true, lastStateAt: oldStateAt }, 'wispbyte-poll');
    await env.registry.markOfflineStopped('24', { source: 'user-offline-stop' });
    const earlierWorkerClock = new Date(Date.now() - 30000).toISOString();
    await env.registry.updateStatus('24', { state: 'online', online: true, manuallyStopped: false, lastStateAt: earlierWorkerClock }, 'wispbyte-poll');
    const recovered = await env.registry.find('24');
    assert.equal(recovered.status?.state, 'online', 'Worker reporting online after manager offline-stop must not be dropped by SYNC-16-01');
    assert.equal(recovered.status?.manuallyStopped, false);

    // 15d. Dashboard UI separates STOPPED (available=false, manuallyStopped=true) from kpiUnreachable & status-unreachable
    const elements = new Map();
    const makeEl = (id) => {
      if (!elements.has(id)) {
        const classes = new Set();
        elements.set(id, {
          id,
          value: '',
          textContent: '',
          innerHTML: '',
          style: {},
          dataset: {},
          children: [],
          classList: {
            add: (...c) => c.forEach((x) => classes.add(x)),
            remove: (...c) => c.forEach((x) => classes.delete(x)),
            toggle: (x, force) => { if (force) classes.add(x); else classes.delete(x); },
            contains: (x) => classes.has(x)
          },
          querySelectorAll: () => [],
          setAttribute: () => {},
          getAttribute: () => null,
          removeAttribute: () => {},
          appendChild: () => {},
          addEventListener: () => {}
        });
      }
      return elements.get(id);
    };
    const doc = {
      getElementById: (id) => makeEl(id),
      querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: (tag) => makeEl(`__dyn_${tag}_${Math.random()}`),
      hidden: false
    };
    const win = {
      __INITIAL_USER__: null,
      location: { protocol: 'https:', host: 'mgr.example.com' },
      addEventListener: () => {}
    };
    const ctx = {
      window: win,
      document: doc,
      URL,
      localStorage: { getItem: () => null, setItem: () => {} },
      sessionStorage: { getItem: () => null, setItem: () => {} },
      navigator: { onLine: true, clipboard: { writeText: async () => {} } },
      setTimeout,
      clearTimeout,
      setInterval: () => ({ unref() {} }),
      clearInterval: () => {},
      console
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/http/views/dashboard/scripts/01-core-and-cards.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/http/views/dashboard/scripts/04-fleet-and-admin-modals.js'), 'utf8'), ctx);

    vm.runInContext(`
      currentUser = { role: 'admin', username: 'admin' };
      bots = [
        { id: 'w-stop', workerId: 'w-stop', botNumber: 1, label: 'StoppedBot', status: 'stopped', available: false, manuallyStopped: true, provider: 'wispbyte' },
        { id: 'w-dead', workerId: 'w-dead', botNumber: 2, label: 'DeadBot', status: 'offline', available: false, manuallyStopped: false, provider: 'wispbyte', lastError: 'Worker offline' },
        { id: 'w-live', workerId: 'w-live', botNumber: 3, label: 'LiveBot', status: 'online', online: true, available: true, manuallyStopped: false, provider: 'wispbyte' }
      ];
      updateTagPills = () => {};
      renderHome = () => {};
      updateKpis();
    `, ctx);

    assert.equal(doc.getElementById('kpiTotal').textContent, '3');
    assert.equal(doc.getElementById('kpiOnline').textContent, '1');
    assert.equal(doc.getElementById('kpiOffline').textContent, '1', 'Manually stopped offline bot must count in kpiOffline');
    assert.equal(doc.getElementById('kpiUnreachable').textContent, '1', 'Manually stopped bot must NOT inflate kpiUnreachable');

    const stoppedCardHtml = ctx.botCardHtml({ id: 'w-stop', workerId: 'w-stop', botNumber: 1, label: 'StoppedBot', status: 'stopped', available: false, manuallyStopped: true });
    assert.ok(stoppedCardHtml.includes('status-offline'), 'STOPPED card must use status-offline styling, not status-unreachable');
    assert.ok(!stoppedCardHtml.includes('status-unreachable'));
    assert.ok(stoppedCardHtml.includes('STOPPED'));

    const deadCardHtml = ctx.botCardHtml({ id: 'w-dead', workerId: 'w-dead', botNumber: 2, label: 'DeadBot', status: 'offline', available: false, manuallyStopped: false, lastError: 'Worker offline' });
    assert.ok(deadCardHtml.includes('status-unreachable'));

    // Tab filter verification: unreachable filter includes only DeadBot, offline filter includes StoppedBot
    vm.runInContext(`
      window.__lastFilteredIds = [];
      reconcileBotCards = (list) => { window.__lastFilteredIds = list.map((x) => x.id); };
    `, ctx);
    ctx.setStatusFilter('unreachable');
    assert.deepEqual(Array.from(win.__lastFilteredIds), ['w-dead']);
    ctx.setStatusFilter('offline');
    assert.deepEqual(Array.from(win.__lastFilteredIds), ['w-stop']);
  } finally {
    await env.close();
  }
});
