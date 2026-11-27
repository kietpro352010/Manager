'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { redactStringSecrets } = require('../src/utils/logger');
const { SupabaseAdapter } = require('../src/storage/supabase-client');
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');
const SupabaseDashboardStore = require('../src/storage/supabase-dashboard-store');
const { createWorkerApi } = require('../src/http/routes/worker-api');
const { encryptSecret } = require('../src/utils/secrets');

test('1. Logger fast-path redaction preserves 100% secret scrubbing parity while skipping clean strings', () => {
  // Clean strings return untouched via fast path
  assert.equal(redactStringSecrets('online'), 'online');
  assert.equal(redactStringSecrets('wispbyte-poll'), 'wispbyte-poll');
  assert.equal(redactStringSecrets('24'), '24');

  // All 12 secret patterns still scrub identically
  assert.equal(redactStringSecrets('socks5://user:superSecret123@1.2.3.4:1080'), 'socks5://user:***@1.2.3.4:1080');
  assert.equal(redactStringSecrets('Authorization: Bearer mySecretToken999'), 'Authorization: [REDACTED]');
  assert.equal(redactStringSecrets('Bearer abcdefghijklmnop'), 'Bearer [REDACTED]');
  assert.equal(
    redactStringSecrets('eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlMTIzNDU2'),
    '[REDACTED_JWT]'
  );
  assert.equal(redactStringSecrets('https://example.com/cb?token=abc123xyz&ok=1'), 'https://example.com/cb?token=[REDACTED]&ok=1');
  assert.equal(redactStringSecrets('{"password":"my_mc_pass_123"}'), '{"password":"[REDACTED]"}');
  assert.equal(redactStringSecrets('/login MyMcPass2026'), '/login [REDACTED]');
  assert.equal(redactStringSecrets('/dn MyMcPass2026'), '/dn [REDACTED]');
  assert.equal(
    redactStringSecrets('https://discord.com/api/webhooks/123456789/secretWebhookToken_abc'),
    'https://discord.com/api/webhooks/123456789/[REDACTED]'
  );
});

test('2. SupabaseWorkerStore.addEvent patches _listCache & _itemCache in-place without wiping list cache', async () => {
  let selectListCalls = 0;
  let rpcCalls = 0;
  const mockRows = [
    {
      worker_id: '01',
      bot_number: 1,
      name: 'Bot 01',
      provider: 'wispbyte',
      service_url: '',
      render_service_id: '',
      secret_ciphertext: 'enc',
      enabled: true,
      settings: {},
      status: { state: 'online', online: true },
      last_event: null,
      last_heartbeat: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  const mockClient = {
    from() {
      return {
        select() {
          return {
            order() {
              return {
                async order() {
                  selectListCalls += 1;
                  return { data: mockRows, error: null };
                }
              };
            }
          };
        }
      };
    },
    async rpc(name) {
      assert.equal(name, 'manager_append_worker_event');
      rpcCalls += 1;
      return { data: true, error: null };
    }
  };

  const workerStore = new SupabaseWorkerStore(mockClient, { cacheTtlMs: 30000 });
  const firstList = await workerStore.list();
  assert.equal(firstList.length, 1);
  assert.equal(selectListCalls, 1);

  const evt = { type: 'spawn', message: 'Bot spawned', occurredAt: new Date().toISOString() };
  await workerStore.addEvent('01', evt);
  assert.equal(rpcCalls, 1);

  // Subsequent list() must be served from warm _listCache with updated lastEvent (0 extra DB SELECTs!)
  const secondList = await workerStore.list();
  assert.equal(selectListCalls, 1);
  assert.deepEqual(secondList[0].lastEvent, evt);
});

test('3. SupabaseDashboardStore.setSetting resolves in 1 round-trip via upsert().select().maybeSingle()', async () => {
  let upsertCalls = 0;
  let separateSelectCalls = 0;

  const mockClient = {
    from(table) {
      assert.equal(table, 'manager_settings');
      return {
        upsert(payload) {
          upsertCalls += 1;
          return {
            select() {
              return {
                async maybeSingle() {
                  return {
                    data: { value: payload.value, updated_at: payload.updated_at },
                    error: null
                  };
                }
              };
            }
          };
        },
        select() {
          separateSelectCalls += 1;
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: null, error: null };
                }
              };
            }
          };
        }
      };
    }
  };

  const store = new SupabaseDashboardStore(mockClient);
  const saved = await store.setSetting('bot_display_order', ['02', '01']);
  assert.deepEqual(saved, ['02', '01']);
  assert.equal(upsertCalls, 1);
  assert.equal(separateSelectCalls, 0);

  // Immediate getSetting hits warm cache with 0 DB queries
  const cached = await store.getSetting('bot_display_order');
  assert.deepEqual(cached, ['02', '01']);
  assert.equal(separateSelectCalls, 0);
});

test('4. SupabaseAdapter.ping uses lightweight <200B probe when lastPingOk=true and falls back when unverified', async () => {
  const adapter = new SupabaseAdapter({
    url: 'https://example.supabase.co',
    key: 'sb_secret_test_service_key_1234567890'
  });

  let fullTestCalls = 0;
  let fetchUrls = [];
  adapter.testConnection = async () => {
    fullTestCalls += 1;
    adapter.lastPingOk = true;
    return { ok: true, rpcVerified: true };
  };
  adapter.fetchWithRetry = async (url) => {
    fetchUrls.push(url);
    return {
      ok: true,
      status: 200,
      body: { cancel: async () => {} }
    };
  };

  // First ping when lastPingOk=false runs full testConnection()
  const first = await adapter.ping();
  assert.equal(first.ok, true);
  assert.equal(fullTestCalls, 1);
  assert.equal(fetchUrls.length, 0);

  // Subsequent ping runs lightweight manager_settings?select=key&limit=1 probe
  const second = await adapter.ping();
  assert.equal(second.ok, true);
  assert.equal(second.lightweight, true);
  assert.equal(fullTestCalls, 1);
  assert.equal(fetchUrls.length, 1);
  assert.ok(fetchUrls[0].includes('/rest/v1/manager_settings?select=key&limit=1'));
});

test('5. Worker API POST /events accepts both batch { events: [...] } and single event payloads', async () => {
  const recorded = [];
  const deathAlerts = [];
  const mockRegistry = {
    async authenticate(workerId, secret) {
      return workerId === '15' && secret === 's'.repeat(32);
    },
    async find(workerId) {
      return { workerId, name: 'Bot 15', enabled: true, settings: { alias: 'AFK-15' } };
    },
    async addEvent(workerId, event) {
      recorded.push({ workerId, event });
      return event;
    }
  };
  const mockNotifier = {
    async notifyBotDeath(workerId, label, reason) {
      deathAlerts.push({ workerId, label, reason });
    }
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/workers/:workerId', createWorkerApi({
    registry: mockRegistry,
    broker: {},
    workerStore: {},
    adminNotifier: mockNotifier,
    config: {},
    logger: { warn() {}, error() {}, info() {} }
  }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const port = server.address().port;
    const headers = {
      'content-type': 'application/json',
      'x-worker-secret': 's'.repeat(32)
    };

    // Batch request
    const batchRes = await fetch(`http://127.0.0.1:${port}/api/v1/workers/15/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        events: [
          { type: 'chat', message: '[p1] hello' },
          { type: 'chat', message: '[p2] world' },
          { type: 'bot_death', reason: 'X: 10, Y: 64, Z: -5' }
        ]
      })
    });
    assert.equal(batchRes.status, 200);
    const batchBody = await batchRes.json();
    assert.deepEqual(batchBody, { ok: true, count: 3 });
    assert.equal(recorded.length, 3);
    assert.equal(deathAlerts.length, 1);
    assert.equal(deathAlerts[0].label, 'AFK-15');

    // Legacy single-event request
    const singleRes = await fetch(`http://127.0.0.1:${port}/api/v1/workers/15/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'spawn', message: 'Spawned' })
    });
    assert.equal(singleRes.status, 200);
    assert.deepEqual(await singleRes.json(), { ok: true });
    assert.equal(recorded.length, 4);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('6. Discord registerCommands skips redundant REST.put when command payload SHA-256 hash matches store', async () => {
  const { registerCommands } = require('../src/discord/register-commands');
  let storedHashObj = null;
  const mockStore = {
    async getSetting(key) {
      return key === 'discord_commands_hash' ? storedHashObj : null;
    },
    async setSetting(key, val) {
      if (key === 'discord_commands_hash') storedHashObj = val;
      return val;
    }
  };

  // Seed matching hash using the exact command definitions
  const crypto = require('node:crypto');
  const { loadCommands } = require('../src/discord/command-registry');
  const body = loadCommands().map((c) => c.data.toJSON());
  const clientId = '123456789012345678';
  const guildId = '987654321098765432';
  const expectedHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ clientId, scope: 'single-guild', guildId, body }))
    .digest('hex');
  storedHashObj = { hash: expectedHash };

  // Because hash matches, registerCommands returns immediately without touching Discord REST network!
  const res = await registerCommands({
    token: 'invalid_token_never_called',
    clientId,
    guildId,
    store: mockStore
  });
  assert.equal(res.skippedUnchanged, true);
  assert.equal(res.count, body.length);
  assert.equal(res.scope, 'single-guild');
});

test('7. SQL migration 20261125000000_system_performance_optimization.sql is idempotent, covering-indexed, and non-destructive', () => {
  const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261125000000_system_performance_optimization.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.ok(sql.includes('BEGIN;'));
  assert.ok(sql.includes('COMMIT;'));
  assert.ok(sql.includes('idx_manager_commands_worker_queued_fifo'));
  assert.ok(sql.includes('idx_manager_discord_links_active_covering'));
  assert.ok(sql.includes('INCLUDE (username, manager_user_id)'));
  assert.ok(sql.includes('idx_manager_assignments_user_covering'));
  assert.ok(sql.includes('idx_manager_users_active_expiry'));
  assert.ok(sql.includes('idx_audit_logs_log_type_timestamp'));
  assert.ok(sql.includes('autovacuum_vacuum_scale_factor = 0.05'));
  assert.ok(!/\bDROP\s+(?:TABLE|COLUMN|FUNCTION|INDEX)\b/i.test(sql));
  assert.ok(!/\bTRUNCATE\b/i.test(sql));
});

test('8. encryptSecret helper compatibility sanity check', () => {
  const key = '0123456789abcdef0123456789abcdef';
  const ct = encryptSecret(JSON.stringify({ username: 'KingBot01', password: 'pw' }), key);
  assert.ok(typeof ct === 'string' && ct.length > 16);
});

test('9. Wave-2 Singleflight deduplication collapses concurrent cache-miss storms in SupabaseDashboardStore & SupabaseWorkerStore', async () => {
  let settingsHits = 0;
  let discordLinkHits = 0;
  const mockDashboardClient = {
    from(table) {
      if (table === 'manager_settings') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    settingsHits += 1;
                    await new Promise((r) => setTimeout(r, 20));
                    return { data: { value: { enabled: false, message: 'OK' }, updated_at: '2026-11-25T09:00:00Z' }, error: null };
                  }
                };
              }
            };
          }
        };
      }
      if (table === 'manager_discord_links') {
        return {
          select() {
            return {
              or() {
                return {
                  eq() {
                    return {
                      async maybeSingle() {
                        discordLinkHits += 1;
                        await new Promise((r) => setTimeout(r, 20));
                        return { data: { discord_user_id: '777', username: 'admin', status: 'active' }, error: null };
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
      return {
        select() {
          return {
            or() { return { async maybeSingle() { return { data: null, error: null }; } }; },
            eq() { return { async maybeSingle() { return { data: null, error: null }; } }; }
          };
        }
      };
    }
  };

  const dashStore = new SupabaseDashboardStore(mockDashboardClient);
  const [s1, s2, s3, s4, s5] = await Promise.all([
    dashStore.getSetting('system_maintenance'),
    dashStore.getSetting('system_maintenance'),
    dashStore.getSetting('system_maintenance'),
    dashStore.getSetting('system_maintenance'),
    dashStore.getSetting('system_maintenance')
  ]);
  assert.equal(settingsHits, 1, '5 concurrent getSetting cache misses must execute only 1 Supabase query');
  assert.equal(s1.message, 'OK');
  assert.equal(s5.message, 'OK');

  const [u1, u2, u3, u4] = await Promise.all([
    dashStore.getUserByDiscordId('777'),
    dashStore.getUserByDiscordId('777'),
    dashStore.getUserByDiscordId('777'),
    dashStore.getUserByDiscordId('777')
  ]);
  assert.equal(discordLinkHits, 1, '4 concurrent getUserByDiscordId calls must deduplicate into 1 query');
  assert.equal(u1.role, 'admin');
  assert.equal(u4.role, 'admin');

  let workerListHits = 0;
  const mockWorkerClient = {
    from() {
      return {
        select() {
          return {
            order() {
              return {
                async order() {
                  workerListHits += 1;
                  await new Promise((r) => setTimeout(r, 20));
                  return {
                    data: [{ worker_id: '15', bot_number: 15, name: 'Bot 15', provider: 'wispbyte', enabled: true, status: { state: 'afk' } }],
                    error: null
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  const workerStore = new SupabaseWorkerStore(mockWorkerClient, { cacheTtlMs: 30000 });
  const lists = await Promise.all(Array.from({ length: 8 }, () => workerStore.list()));
  assert.equal(workerListHits, 1, '8 concurrent workerStore.list() cache misses must execute only 1 Supabase query');
  assert.equal(lists[0].length, 1);
  assert.equal(lists[7][0].workerId, '15');
});

test('10. Wave-2 Undici global pool lifecycle, dynamic Brotli middleware & SPA preload/CSS minification', async () => {
  const zlib = require('node:zlib');
  const { configureGlobalHttpDispatcher, closeGlobalHttpDispatcher, createGzipMiddleware } = require('../src/utils/http');
  const dashboardAssets = require('../src/http/views/dashboard');

  const agent = configureGlobalHttpDispatcher({ keepAliveTimeout: 15000, connections: 16 });
  assert.ok(agent !== undefined);
  await closeGlobalHttpDispatcher();

  // Verify SHELL_HTML includes LCP preload hints for both CSS and JS while keeping stylesheet/script tags intact
  assert.ok(dashboardAssets.SHELL_HTML.includes(`<link rel="preload" href="${dashboardAssets.CSS_PATH}" as="style">`));
  assert.ok(dashboardAssets.SHELL_HTML.includes(`<link rel="preload" href="${dashboardAssets.JS_PATH}" as="script">`));
  assert.ok(dashboardAssets.SHELL_HTML.includes(`<link rel="stylesheet" href="${dashboardAssets.CSS_PATH}">`));
  assert.ok(dashboardAssets.SHELL_HTML.includes(`<script src="${dashboardAssets.JS_PATH}"></script>`));
  assert.ok(!dashboardAssets.STYLES.includes('/* ===='), 'CSS block comments must be stripped at build time');
  assert.ok(dashboardAssets.STYLES.includes('contain: layout style paint;'), '.bot-card must include CSS containment');

  // Verify dynamic Brotli compression in createGzipMiddleware
  const mw = createGzipMiddleware({ brotliMinLength: 256 });
  let sentBody = null;
  const headers = new Map();
  const req = { method: 'GET', headers: { 'accept-encoding': 'br, gzip' } };
  const res = {
    statusCode: 200,
    headersSent: false,
    getHeader: (k) => headers.get(String(k).toLowerCase()),
    setHeader: (k, v) => headers.set(String(k).toLowerCase(), v),
    removeHeader: (k) => headers.delete(String(k).toLowerCase()),
    vary: (v) => headers.set('vary', v),
    send(payload) {
      sentBody = payload;
      return this;
    }
  };
  mw(req, res, () => {});
  const rawJson = { ok: true, items: Array.from({ length: 30 }, (_, i) => `kbot-brotli-item-${i}`) };
  res.send(rawJson);
  assert.equal(headers.get('content-encoding'), 'br');
  assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(sentBody).toString('utf8')), rawJson);
});

test('11. Wave-2 Discord admin:status uses lightweight adapter.ping(), memoizes guild/roles per interaction, and supports first/last page jump', async () => {
  const { handlePanelInteraction } = require('../src/discord/handlers/panel-handler');
  const { renderAdminBots } = require('../src/discord/panels/renderer');

  // Verify renderAdminBots adds first/last jump buttons cleanly within Discord <=5 buttons/row limit
  const workers = Array.from({ length: 18 }, (_, i) => ({
    workerId: String(i + 1),
    botNumber: i + 1,
    name: `Bot ${i + 1}`,
    provider: 'wispbyte',
    status: { state: 'online', online: true }
  }));
  const multiPageView = renderAdminBots({ workers, page: 1, pageSize: 5 });
  assert.ok(multiPageView.components.every((row) => row.components.length <= 5), 'Every ActionRow must have <= 5 buttons');
  const customIds = multiPageView.components.flatMap((row) => row.components.map((b) => b.data.custom_id));
  assert.ok(customIds.includes('admin:bots:0'), 'Must include jump to first page');
  assert.ok(customIds.includes('admin:bots:3'), 'Must include jump to last page');

  // Verify admin:status calls adapter.ping() instead of adapter.testConnection() and memoizes guild/role lookups
  let pingCalls = 0;
  let testConnCalls = 0;
  let settingCalls = 0;
  let updatedPayload = null;

  const services = {
    config: {},
    accessControl: { adminUserId: 'admin_discord_1' },
    registry: { async list() { return workers.slice(0, 2); } },
    accessStore: {
      adapter: {
        async ping() { pingCalls += 1; return { ok: true }; },
        async testConnection() { testConnCalls += 1; return { ok: true }; }
      },
      async getSetting(key) {
        if (key === 'discord_access') {
          settingCalls += 1;
          return { guildId: 'guild_123', adminRoleId: 'role_admin', userRoleId: 'role_user' };
        }
        return null;
      },
      async getUserByDiscordId() { return null; }
    }
  };

  const interaction = {
    guildId: 'guild_123',
    customId: 'admin:status:refresh',
    user: { id: 'admin_discord_1' },
    member: { roles: ['role_admin'] },
    deferred: false,
    replied: false,
    isModalSubmit: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    async deferUpdate() { this.deferred = true; },
    async editReply(payload) { updatedPayload = payload; return payload; },
    async update(payload) { updatedPayload = payload; return payload; }
  };

  await handlePanelInteraction(interaction, services);
  assert.equal(pingCalls, 1, 'admin:status:refresh must call lightweight adapter.ping()');
  assert.equal(testConnCalls, 0, 'admin:status:refresh must NOT download 250KB OpenAPI via testConnection()');
  assert.ok(settingCalls <= 2, `Expected memoized settings lookups <= 2, got ${settingCalls}`);
  assert.ok(updatedPayload && Array.isArray(updatedPayload.embeds));
});

test('12. Wave-3 Stale-If-Error resilience serves last verified snapshot on transient Supabase 503 while invalidateCache purges immediately', async () => {
  let failNext = false;
  const mockDashClient = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  if (failNext) {
                    const err = new Error('Supabase upstream HTTP 503 Service Unavailable');
                    err.status = 503;
                    throw err;
                  }
                  return { data: { value: { enabled: false, banner: 'Healthy' }, updated_at: '2026-11-25T10:00:00Z' }, error: null };
                }
              };
            }
          };
        }
      };
    }
  };
  const dashStore = new SupabaseDashboardStore(mockDashClient);
  const initial = await dashStore.getSetting('system_maintenance');
  assert.equal(initial.banner, 'Healthy');

  // Force primary TTL expiration while keeping staleUntil valid
  const entry = dashStore.cache.get('setting:system_maintenance');
  entry.expiresAt = Date.now() - 10;

  // Simulate transient Supabase 503 outage -> serves stale-if-error gracefully!
  failNext = true;
  const fallback = await dashStore.getSetting('system_maintenance');
  assert.equal(fallback.banner, 'Healthy', 'Transient 503 must serve stale-if-error snapshot instead of crashing');

  // Explicit cache invalidation MUST purge stale snapshot immediately (fail-closed consistency on mutations)
  dashStore.invalidateCache();
  await assert.rejects(() => dashStore.getSetting('system_maintenance'), /503/);

  // Same for SupabaseWorkerStore.list()
  let workerFail = false;
  const mockWorkerClient = {
    from() {
      return {
        select() {
          return {
            order() {
              return {
                async order() {
                  if (workerFail) {
                    const err = new Error('fetch failed: ETIMEDOUT');
                    throw err;
                  }
                  return {
                    data: [{ worker_id: '21', bot_number: 21, name: 'Bot 21', provider: 'wispbyte', enabled: true, status: { state: 'afk' } }],
                    error: null
                  };
                }
              };
            }
          };
        }
      };
    }
  };
  const wStore = new SupabaseWorkerStore(mockWorkerClient, { cacheTtlMs: 5 });
  const wFirst = await wStore.list();
  assert.equal(wFirst[0].workerId, '21');
  await new Promise((r) => setTimeout(r, 15));
  workerFail = true;
  const wStale = await wStore.list();
  assert.equal(wStale[0].workerId, '21', 'WorkerStore.list must serve stale-if-error during transient ETIMEDOUT');
});

test('13. Wave-3 Manager OWASP hardening (Permissions-Policy, COOP, Proto-Sanitizer, 413 boundary), X-Request-Id, Event-Loop Lag & 503 graceful drain', async () => {
  const { createApp } = require('../src/http/app');
  let errorLogs = 0;
  const app = createApp({
    store: { adapter: { isEnabled: () => false } },
    entitlementService: {},
    link4mService: { health: () => ({ ok: true }) },
    registry: { list: async () => [], verifyBotSecretSync: () => false },
    broker: {},
    commandStore: { health: () => ({ ok: true }) },
    workerStore: {},
    fleetOperations: {},
    adminNotifier: {},
    discordClient: null,
    config: { botSecretKey: 'b'.repeat(32) },
    logger: { info() {}, warn() {}, error() { errorLogs += 1; }, debug() {} }
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const port = server.address().port;

    // 1. Health includes eventLoopLagMs, echoes X-Request-Id, and sets Permissions-Policy + COOP
    const healthRes = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { 'x-request-id': 'mgr_trace_abc12345' }
    });
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.headers.get('x-request-id'), 'mgr_trace_abc12345');
    assert.ok(String(healthRes.headers.get('permissions-policy') || '').includes('camera=()'));
    assert.equal(healthRes.headers.get('cross-origin-opener-policy'), 'same-origin');
    const healthJson = await healthRes.json();
    assert.equal(typeof healthJson.eventLoopLagMs?.mean, 'number');
    assert.equal(typeof healthJson.eventLoopLagMs?.p99, 'number');

    // 2. Oversized >512KB JSON body returns clean 413 with requestId and 0 false 500 error logs
    const hugeBody = JSON.stringify({ pad: 'x'.repeat(540 * 1024) });
    const oversizeRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'mgr_oversize_413' },
      body: hugeBody
    });
    assert.equal(oversizeRes.status, 413);
    const oversizeJson = await oversizeRes.json();
    assert.equal(oversizeJson.requestId, 'mgr_oversize_413');
    assert.equal(errorLogs, 0, '413 client payload limit must not trigger 500 error alert spam');

    // 3. Graceful shutdown flips /ready to 503 shutting_down immediately
    app.setShuttingDown(true);
    const readyRes = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(readyRes.status, 503);
    const readyJson = await readyRes.json();
    assert.equal(readyJson.status, 'shutting_down');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('14. Wave-3 Automated storage hygiene cleans terminal outbox/commands/locks & Dashboard includes WCAG 2.2 AA keyboard + offline UX', async () => {
  const deletedTables = [];
  const mockCleanupClient = {
    from(tbl) {
      deletedTables.push(tbl);
      const chain = {
        delete: () => chain,
        in: () => chain,
        lt: async () => ({ error: null })
      };
      return chain;
    }
  };
  const dashStore = new SupabaseDashboardStore(mockCleanupClient);
  await dashStore.runMaintenanceCleanup();
  assert.ok(deletedTables.includes('manager_outbox_queue'), 'Maintenance cleanup must prune terminal outbox rows');
  assert.ok(deletedTables.includes('manager_commands'), 'Maintenance cleanup must prune terminal worker commands');
  assert.ok(deletedTables.includes('manager_locks'), 'Maintenance cleanup must prune expired distributed locks');

  const dashboardAssets = require('../src/http/views/dashboard');
  assert.ok(dashboardAssets.SHELL_HTML.includes('id="skipToMainLink"'), 'Dashboard must include WCAG skip-to-main link');
  assert.ok(dashboardAssets.SHELL_HTML.includes('id="networkOfflineBanner"'), 'Dashboard must include real-time offline network banner');
  assert.ok(dashboardAssets.SCRIPTS.includes('handleBotCardKeydown'), '.bot-card must support Enter/Space keyboard activation');
  assert.ok(dashboardAssets.SCRIPTS.includes('attachKeyboardAndOfflineResilience'), 'Dashboard must support Escape/Ctrl+K shortcuts and online auto-resync');
});

test('15. Wave-4 Render Service Egress: Idle Command Queue Gate (0 DB hits when idle, 0ms wake on enqueue) & Delta-only lastHeartbeat DB writes', async () => {
  const SupabaseCommandStore = require('../src/storage/supabase-command-store');
  let takeRpcCalls = 0;
  let syncRpcCalls = 0;
  const queuedRows = [];
  const mockCmdClient = {
    async rpc(fnName, params) {
      if (fnName === 'manager_take_worker_command') {
        takeRpcCalls += 1;
        const idx = queuedRows.findIndex((r) => r.worker_id === params.p_worker_id);
        if (idx !== -1) {
          const [row] = queuedRows.splice(idx, 1);
          return { data: row, error: null };
        }
        return { data: null, error: null };
      }
      if (fnName === 'manager_enqueue_worker_command') {
        const row = {
          command_id: params.p_command_id,
          worker_id: params.p_worker_id,
          action: params.p_action,
          payload: params.p_payload,
          status: 'queued',
          created_at: params.p_created_at,
          expires_at: params.p_expires_at
        };
        queuedRows.push(row);
        return { data: row, error: null };
      }
      if (fnName === 'manager_claim_pending_command_syncs') {
        syncRpcCalls += 1;
        return { data: [], error: null };
      }
      if (fnName === 'manager_record_command_execution') {
        return { data: { ok: true, status: 'execution_completed', fencingToken: 1 }, error: null };
      }
      return { data: null, error: null };
    }
  };

  const cmdStore = new SupabaseCommandStore(mockCmdClient);
  assert.equal(await cmdStore.take('15'), null);
  assert.equal(takeRpcCalls, 1, 'First idle take() verifies Supabase queue once');

  // 25 subsequent idle polls must hit 0 Supabase RPCs!
  for (let i = 0; i < 25; i += 1) {
    assert.equal(await cmdStore.take('15'), null);
  }
  assert.equal(takeRpcCalls, 1, 'Idle queue gate must eliminate 100% of repeated empty take() RPC calls');

  // Enqueueing a command immediately opens the gate with 0ms delay
  await cmdStore.enqueue({ workerId: '15', action: 'chat', payload: { message: 'hello' } });
  const delivered = await cmdStore.take('15');
  assert.equal(delivered?.action, 'chat');
  assert.equal(takeRpcCalls, 2, 'Enqueued command must immediately bypass idle gate');

  // Idle state-sync gate
  assert.deepEqual(await cmdStore.claimPendingStateSyncBatch('mgr_1'), []);
  assert.equal(syncRpcCalls, 1);
  assert.deepEqual(await cmdStore.claimPendingStateSyncBatch('mgr_1'), []);
  assert.equal(syncRpcCalls, 1, 'Repeated idle state-sync sweeps must skip Supabase RPC');
  await cmdStore.recordExecutionCompleted('15', 'cmd_1', { ok: true }, { leaseOwner: 'mgr_1' });
  await cmdStore.claimPendingStateSyncBatch('mgr_1');
  assert.equal(syncRpcCalls, 2, 'Recording execution completion must immediately reopen state-sync gate');

  // Delta-only lastHeartbeat DB writes on WorkerRegistry.updateStatus
  const { WorkerRegistry } = require('../src/services/worker-registry');
  const { encryptSecret } = require('../src/utils/secrets');
  const encKey = Buffer.alloc(32, 9);
  const patches = [];
  let storedWorker = {
    workerId: '15',
    botNumber: 15,
    name: 'Bot 15',
    provider: 'wispbyte',
    serviceUrl: '',
    enabled: true,
    secretCiphertext: encryptSecret('s'.repeat(32), encKey),
    settings: {},
    status: { state: 'registered', online: false }
  };
  const mockWorkerStore = {
    async get() { return { ...storedWorker, status: { ...storedWorker.status } }; },
    async update(_id, patch) {
      patches.push(patch);
      storedWorker = { ...storedWorker, ...patch };
      return null;
    }
  };
  const registry = new WorkerRegistry({ store: mockWorkerStore, encryptionKey: encKey });
  const bigInventory = {
    revision: 12,
    items: Array.from({ length: 36 }, (_, idx) => ({ slot: idx, name: 'diamond_block', count: 64 })),
    slots: Object.fromEntries(Array.from({ length: 36 }, (_, idx) => [idx, { name: 'diamond_block', count: 64 }]))
  };
  await registry.updateStatus('15', {
    state: 'afk',
    online: true,
    username: 'BigInvBot',
    health: 20,
    totemCount: 5,
    inventory: bigInventory
  }, 'wispbyte-poll');
  assert.equal(patches.length, 1);
  assert.ok(patches[0].status?.inventory, 'Initial status change persists full status + inventory');

  // Simulate 160s elapsed so periodic DB heartbeat persist fires on unchanged lightweight poll
  registry.lastDbStatusPersistAt.set('15', Date.now() - 160000);
  await registry.updateStatus('15', {
    state: 'afk',
    online: true,
    isLightweight: true,
    digestUnchanged: true,
    uptimeSeconds: 999,
    pingMs: 42
  }, 'wispbyte-poll');
  assert.equal(patches.length, 2);
  assert.equal(patches[1].status, undefined, 'Unchanged periodic heartbeat must NOT re-upload 10KB status+inventory JSONB');
  assert.ok(patches[1].lastHeartbeat instanceof Date, 'Unchanged periodic heartbeat must persist only lastHeartbeat');
  const liveView = await registry.find('15');
  assert.equal(liveView.status.inventory.revision, 12, 'In-memory live telemetry must still retain full 36-slot inventory');
  assert.equal(liveView.status.uptimeSeconds, 999, 'In-memory summaryCache must reflect latest volatile uptime');
});

test('16. Wave-4 Render HTTPS Response Slimming: Stripped Worker headers (<300B wire response) & 0-byte 24h cached /textures 404', async () => {
  const { createApp } = require('../src/http/app');
  const secret = 'w'.repeat(32);
  let authLookups = 0;
  const app = createApp({
    store: {
      adapter: {
        isEnabled: () => true,
        fetchManagerAuthorization: async () => {
          authLookups += 1;
          return { ok: false };
        }
      }
    },
    entitlementService: {},
    link4mService: { health: () => ({ ok: true }) },
    registry: {
      list: async () => [],
      authenticate: async (_id, s) => s === secret,
      verifyBotSecretSync: (_id, s) => s === secret,
      find: async (id) => ({ workerId: id, enabled: true, provider: 'wispbyte', serviceUrl: '', status: { state: 'afk' } }),
      touchHeartbeat: async () => ({ ok: true }),
      touchLiveHeartbeat: () => {},
      getSettingsRevision: () => 3
    },
    broker: {
      poll: async () => null
    },
    commandStore: { health: () => ({ ok: true }) },
    workerStore: {},
    fleetOperations: {},
    adminNotifier: {},
    discordClient: null,
    config: { workerPollWaitMs: 100 },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const port = server.address().port;

    // 1. Worker /poll omits bloated HTML headers (CSP, Permissions-Policy, COOP, ETag) while keeping nosniff & no-store
    const pollRes = await fetch(`http://127.0.0.1:${port}/api/v1/workers/15/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-secret': secret },
      body: JSON.stringify({ waitMs: 50 })
    });
    assert.equal(pollRes.status, 200);
    assert.equal(pollRes.headers.get('content-security-policy'), null, 'Worker /poll must omit 300B HTML Content-Security-Policy');
    assert.equal(pollRes.headers.get('permissions-policy'), null, 'Worker /poll must omit HTML Permissions-Policy');
    assert.equal(pollRes.headers.get('cross-origin-opener-policy'), null, 'Worker /poll must omit HTML COOP');
    assert.equal(pollRes.headers.get('etag'), null, 'Idle Worker /poll must omit useless ETag');
    assert.equal(pollRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(pollRes.headers.get('cache-control'), 'no-store');
    const pollJson = await pollRes.json();
    assert.deepEqual(pollJson, { ok: true, command: null, settingsRevision: 3 });

    // 2. Browser routes still receive full OWASP HTML headers
    const browserRes = await fetch(`http://127.0.0.1:${port}/health`);
    assert.ok(String(browserRes.headers.get('content-security-policy') || '').includes("default-src 'self'"));
    assert.ok(String(browserRes.headers.get('permissions-policy') || '').includes('camera=()'));

    // 3. Missing /textures/item/* returns 0-byte 404 cached for 24h with 0 Supabase session auth lookups
    const missingTex = await fetch(`http://127.0.0.1:${port}/textures/item/nonexistent_deleted_sprite_999.png`, {
      headers: { Cookie: 'kingmc_mgr_session=fake_token_123456' }
    });
    assert.equal(missingTex.status, 404);
    assert.equal((await missingTex.text()).length, 0, 'Missing texture 404 must send 0-byte body');
    assert.ok(String(missingTex.headers.get('cache-control') || '').includes('max-age=86400'), 'Missing texture 404 must cache for 24h');
    assert.equal(authLookups, 0, 'Missing texture 404 must short-circuit before session DB auth');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('17. Wave-6 SSE GET /api/manager/stream: 401 guard, 3/user 429 cap, strict tenant fleet_pulse isolation (incl. 400ms multi-bot coalesce), <100ms broadcasts & revocation/shutdown cleanup', async () => {
  const http = require('node:http');
  const { createApp } = require('../src/http/app');
  const { createMockSupabaseServer } = require('./e2e/harness/mock-supabase');
  const { createSupabaseClient } = require('../src/storage/supabase-client');
  const { WorkerRegistry } = require('../src/services/worker-registry');
  const { AccessControl } = require('../src/services/access-control');
  const { encryptUserPassword, hashAdminPasswordAsync } = require('../src/utils/secrets');

  const supabaseServer = await createMockSupabaseServer();
  const supabaseClient = createSupabaseClient({ url: supabaseServer.url, secretKey: supabaseServer.secretKey });
  const workerStore = new SupabaseWorkerStore(supabaseClient);
  const store = new SupabaseDashboardStore(supabaseClient);
  await workerStore.initialize();
  await store.initialize();

  const encKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const encKey = Buffer.from(encKeyHex, 'hex');
  const sec = encryptSecret('w'.repeat(32), encKey);
  const nowIso = new Date().toISOString();

  supabaseServer.seed('manager_workers', [
    { worker_id: 'bot-a1', bot_number: 1, name: 'Bot UserA 1', enabled: true, provider: 'wispbyte', service_url: '', secret_ciphertext: sec, settings: {}, status: { state: 'online', online: true }, events: [], created_at: nowIso, updated_at: nowIso },
    { worker_id: 'bot-b1', bot_number: 2, name: 'Bot UserB 1', enabled: true, provider: 'wispbyte', service_url: '', secret_ciphertext: sec, settings: {}, status: { state: 'online', online: true }, events: [], created_at: nowIso, updated_at: nowIso },
    { worker_id: 'bot-b2', bot_number: 3, name: 'Bot UserB 2', enabled: true, provider: 'wispbyte', service_url: '', secret_ciphertext: sec, settings: {}, status: { state: 'online', online: true }, events: [], created_at: nowIso, updated_at: nowIso }
  ]);

  const registry = new WorkerRegistry({ store: workerStore, accessStore: store, encryptionKey: encKey });
  await registry.load();
  registry.setAdminPassword(await hashAdminPasswordAsync('AdminSse!99'));

  const futureIso = new Date(Date.now() + 7 * 86400000).toISOString();
  await store.setAccess('user_a', {
    id: 'user_a',
    username: 'usera',
    password: encryptUserPassword('PassA!99'),
    role: 'user',
    workerIds: ['bot-a1'],
    status: 'active',
    isPermanent: false,
    expiresAt: futureIso
  }, 'seed');
  await store.setAccess('user_b', {
    id: 'user_b',
    username: 'userb',
    password: encryptUserPassword('PassB!99'),
    role: 'user',
    workerIds: ['bot-b1', 'bot-b2'],
    status: 'active',
    isPermanent: false,
    expiresAt: futureIso
  }, 'seed');

  const app = createApp({
    store,
    workerStore,
    registry,
    broker: { dispatch: async () => ({ delivered: true, result: { ok: true } }) },
    entitlementService: { redeem: async () => ({ ok: true }) },
    accessControl: new AccessControl({ store }),
    config: {
      adminUsername: 'admin',
      adminPassword: 'AdminSse!99',
      sessionSecret: 'sse-test-secret-0123456789abcdef',
      encryptionKey: encKey,
      encryptionKeyHex: encKeyHex,
      publicBaseUrl: 'http://127.0.0.1'
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const openStreams = [];

  function openSse(port, token, clientIp) {
    return new Promise((resolve, reject) => {
      const events = [];
      let rawBuf = '';
      let closed = false;
      let onCloseResolve = null;
      const closedPromise = new Promise((r) => { onCloseResolve = r; });

      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/manager/stream',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Accept-Encoding': 'br, gzip',
          'X-Forwarded-For': clientIp
        }
      }, (res) => {
        if (res.statusCode !== 200) {
          const errChunks = [];
          res.on('data', (c) => errChunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(errChunks).toString('utf8'), close() {} }));
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          rawBuf += chunk;
          let sepIdx;
          while ((sepIdx = rawBuf.indexOf('\n\n')) !== -1) {
            const block = rawBuf.slice(0, sepIdx);
            rawBuf = rawBuf.slice(sepIdx + 2);
            if (!block || block.startsWith(':')) continue;
            let evName = 'message';
            let evData = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) evName = line.slice(6).trim();
              else if (line.startsWith('data:')) evData += line.slice(5).trim();
            }
            let parsed = evData;
            try { parsed = JSON.parse(evData); } catch (_) {}
            events.push({ event: evName, data: parsed, receivedAt: Date.now() });
            if (evName === 'connected') {
              resolve({
                status: 200,
                headers: res.headers,
                events,
                isClosed: () => closed,
                waitClosed: () => closedPromise,
                close() { try { req.destroy(); } catch (_) {} }
              });
            }
          }
        });
        const markEnd = () => {
          closed = true;
          if (onCloseResolve) onCloseResolve();
        };
        res.on('end', markEnd);
        res.on('close', markEnd);
      });
      req.on('error', (err) => {
        if (!closed) reject(err);
      });
      req.end();
      openStreams.push(req);
    });
  }

  try {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // 17a. Unauthenticated request rejected with 401
    const unauthRes = await fetch(`${baseUrl}/api/manager/stream`);
    assert.equal(unauthRes.status, 401);
    await unauthRes.text();

    const login = async (username, password, ip) => {
      const r = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body: JSON.stringify({ username, password })
      });
      return r.json();
    };
    const authA = await login('usera', 'PassA!99', '10.10.1.1');
    const authB = await login('userb', 'PassB!99', '10.10.2.1');
    const authAdmin = await login('admin', 'AdminSse!99', '10.10.9.1');

    // 17b. Per-user cap (3 allowed, 4th rejected with 429) & uncompressed text/event-stream headers
    const sA1 = await openSse(port, authA.token, '10.10.1.1');
    const sA2 = await openSse(port, authA.token, '10.10.1.2');
    const sA3 = await openSse(port, authA.token, '10.10.1.3');
    assert.equal(sA1.status, 200);
    assert.equal(sA1.headers['content-encoding'], undefined, 'SSE stream must bypass Brotli/Gzip compression');
    assert.ok(String(sA1.headers['content-type']).includes('text/event-stream'));

    const sA4 = await openSse(port, authA.token, '10.10.1.4');
    assert.equal(sA4.status, 429, '4th concurrent SSE stream for same user must return 429');

    sA2.close();
    sA3.close();
    await Promise.all([sA2.waitClosed(), sA3.waitClosed()]);
    await new Promise((r) => setTimeout(r, 30));

    const sB1 = await openSse(port, authB.token, '10.10.2.1');
    const sAdmin = await openSse(port, authAdmin.token, '10.10.9.1');
    assert.equal(sB1.status, 200);
    assert.equal(sAdmin.status, 200);

    // 17c. Strict Tenant Isolation on fleet_pulse (including multi-bot 400ms coalescing!)
    sA1.events.length = 0;
    sB1.events.length = 0;
    sAdmin.events.length = 0;

    // Trigger multi-bot updates ONLY on UserB's bots ('bot-b1' + 'bot-b2') within the same 400ms window
    await registry.addEvent('bot-b1', { type: 'spawn', message: 'UserB bot 1 spawned' });
    await registry.addEvent('bot-b2', { type: 'spawn', message: 'UserB bot 2 spawned' });
    await new Promise((r) => setTimeout(r, 480));

    const pulsesForA = sA1.events.filter((e) => e.event === 'fleet_pulse');
    const pulsesForB = sB1.events.filter((e) => e.event === 'fleet_pulse');
    const pulsesForAdmin = sAdmin.events.filter((e) => e.event === 'fleet_pulse');
    assert.equal(pulsesForA.length, 0, 'User A must NEVER receive fleet_pulse for User B bots (even multi-bot coalesced)');
    assert.equal(pulsesForB.length, 1, 'User B must receive 1 coalesced fleet_pulse for their 2 bots');
    assert.equal(pulsesForB[0].data.workerId, null, 'Multi-bot pulse for User B coalesces to workerId: null');
    assert.equal(pulsesForAdmin.length, 1, 'Admin receives coalesced fleet_pulse');

    // Trigger simultaneous updates across User A ('bot-a1') AND User B ('bot-b1') -> User A only sees 'bot-a1'
    sA1.events.length = 0;
    sB1.events.length = 0;
    await registry.addEvent('bot-a1', { type: 'respawn', message: 'UserA respawn' });
    await registry.addEvent('bot-b1', { type: 'respawn', message: 'UserB respawn' });
    await new Promise((r) => setTimeout(r, 480));
    assert.equal(sA1.events.filter((e) => e.event === 'fleet_pulse')[0]?.data?.workerId, 'bot-a1');
    assert.equal(sB1.events.filter((e) => e.event === 'fleet_pulse')[0]?.data?.workerId, 'bot-b1');

    // 17d. Instant <100ms maintenance & announcement SSE broadcasts
    const adminHeaders = { Authorization: `Bearer ${authAdmin.token}`, 'Content-Type': 'application/json' };
    const tMaintSend = Date.now();
    const maintPost = await fetch(`${baseUrl}/api/admin/maintenance`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ enabled: true, message: 'Bảo trì tức thì SSE' })
    });
    assert.equal(maintPost.status, 200);
    await maintPost.text();
    await new Promise((r) => setTimeout(r, 25));
    const maintEvA = sA1.events.find((e) => e.event === 'maintenance');
    assert.ok(maintEvA, 'SSE client must receive maintenance broadcast');
    assert.equal(maintEvA.data.enabled, true);
    assert.ok(maintEvA.receivedAt - tMaintSend < 100, `Expected maintenance SSE delivery <100ms, got ${maintEvA.receivedAt - tMaintSend}ms`);

    const tAnnSend = Date.now();
    const annPost = await fetch(`${baseUrl}/api/admin/announcement`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ enabled: true, title: 'Thông báo SSE', content: 'Cập nhật mới!', mode: 'always' })
    });
    assert.equal(annPost.status, 200);
    await annPost.text();
    await new Promise((r) => setTimeout(r, 25));
    const annEvB = sB1.events.find((e) => e.event === 'announcement');
    assert.ok(annEvB, 'SSE client must receive announcement broadcast');
    assert.ok(annEvB.receivedAt - tAnnSend < 100, `Expected announcement SSE delivery <100ms, got ${annEvB.receivedAt - tAnnSend}ms`);

    // Diagnostics exposes sseClients & ramHeadroom
    const diagJson = await fetch(`${baseUrl}/api/admin/diagnostics`, { headers: adminHeaders }).then((r) => r.json());
    assert.equal(diagJson.ok, true);
    assert.equal(diagJson.sseClients, 3);
    assert.equal(diagJson.ramHeadroom?.budgetMb, 512);

    // 17e. Session revocation closes target user SSE immediately; graceful shutdown closes all remaining SSE clients
    app.invalidateUserSessions('user_a');
    await sA1.waitClosed();
    assert.equal(sA1.isClosed(), true, 'Revoking User A session must immediately terminate User A SSE stream');
    assert.equal(sB1.isClosed(), false, 'User B SSE stream must remain open when User A is revoked');

    app.setShuttingDown(true);
    await Promise.all([sB1.waitClosed(), sAdmin.waitClosed()]);
    assert.equal(sB1.isClosed(), true);
    assert.equal(sAdmin.isClosed(), true);
  } finally {
    for (const req of openStreams) { try { req.destroy(); } catch (_) {} }
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await supabaseServer.close();
  }
});

test('18. Wave-6 Additive WorkerRegistry.addEvent (1..1000 & mod-10 DB sync), setSetting in-place cache + cloneSettingValue & CommandStore 250ms peek dedup + 0ms invalidation', async () => {
  const crypto = require('node:crypto');
  const { WorkerRegistry } = require('../src/services/worker-registry');
  const SupabaseCommandStore = require('../src/storage/supabase-command-store');

  // 18a. WorkerRegistry.addEvent additive repeatCount (1..1000) & DB persistence on 1st + multiples-of-10 crossings
  let dbEventWrites = 0;
  const workerRec = {
    workerId: '18',
    botNumber: 18,
    name: 'Bot 18',
    enabled: true,
    provider: 'wispbyte',
    settings: {},
    status: { state: 'online', online: true },
    events: []
  };
  const registry = new WorkerRegistry({
    store: {
      get: async () => workerRec,
      update: async (_id, patch) => Object.assign(workerRec, patch),
      addEvent: async (_id, ev) => {
        dbEventWrites += 1;
        workerRec.events.push({ ...ev });
      }
    },
    encryptionKey: crypto.randomBytes(32)
  });

  const t0 = Date.parse('2026-11-27T16:10:00.000Z');
  const ev1 = await registry.addEvent('18', {
    type: 'connection_error',
    message: 'Minecraft connection error (ETIMEDOUT)',
    occurredAt: new Date(t0).toISOString(),
    repeatCount: 1
  });
  assert.equal(ev1.repeatCount ?? 1, 1);
  assert.equal(dbEventWrites, 1, '1st occurrence persists to DB');

  const ev2 = await registry.addEvent('18', {
    type: 'connection_error',
    message: 'Minecraft connection error (ETIMEDOUT)',
    occurredAt: new Date(t0 + 8000).toISOString(),
    repeatCount: 5
  });
  assert.equal(ev2.repeatCount, 6);
  assert.equal(dbEventWrites, 1, '1 -> 6 stays within decade 0, skipping redundant DB write');

  const ev3 = await registry.addEvent('18', {
    type: 'connection_error',
    message: 'Minecraft connection error (ETIMEDOUT)',
    occurredAt: new Date(t0 + 16000).toISOString(),
    repeatCount: 6
  });
  assert.equal(ev3.repeatCount, 12);
  assert.equal(new Date(ev3.firstOccurredAt).toISOString(), new Date(t0).toISOString(), 'firstOccurredAt must remain anchored at t0');
  assert.equal(dbEventWrites, 2, 'Crossing multiple-of-10 boundary (6 -> 12) must persist to DB');

  const ev4 = await registry.addEvent('18', {
    type: 'connection_error',
    message: 'Minecraft connection error (ETIMEDOUT)',
    occurredAt: new Date(t0 + 20000).toISOString(),
    repeatCount: 9999
  });
  assert.equal(ev4.repeatCount, 1000, 'repeatCount must clamp strictly at 1000');

  // 18b. SupabaseDashboardStore.setSetting updates setting cache in-place without wiping access:all, and deep-clones values
  const mockDashClient = {
    from(tbl) {
      assert.equal(tbl, 'manager_settings');
      return {
        upsert(payload) {
          return {
            select() {
              return {
                async maybeSingle() {
                  return { data: { value: payload.value, updated_at: payload.updated_at }, error: null };
                }
              };
            }
          };
        }
      };
    }
  };
  const dashStore = new SupabaseDashboardStore(mockDashClient);
  dashStore.setCached('access:all', [{ userId: 'u_keep', status: 'active' }], 30000);
  dashStore.setCached('user:u_keep', { userId: 'u_keep' }, 30000);

  const savedUrls = await dashStore.setSetting('active_manager_urls', { urls: ['https://web1.onrender.com', 'https://web2.onrender.com'] });
  assert.equal(dashStore.getCachedEntry('access:all').hit, true, 'setSetting must NOT wipe access:all cache');
  assert.equal(dashStore.getCachedEntry('user:u_keep').hit, true, 'setSetting must NOT wipe user:* cache');

  // Mutate caller's returned object -> internal cache must remain uncorrupted
  savedUrls.urls.push('https://attacker-mutated.example');
  const readBack = await dashStore.getSetting('active_manager_urls');
  assert.deepEqual(readBack.urls, ['https://web1.onrender.com', 'https://web2.onrender.com'], 'cloneSettingValue must isolate cached objects from caller mutation');

  // 18c. SupabaseCommandStore.peekQueuedWorkerIds 250ms dedup (order-insensitive + subset) & 0ms invalidation on enqueue/take/clearWorker
  let peekDbHits = 0;
  let queuedIds = ['01'];
  const mockCmdClient = {
    from(tbl) {
      if (tbl === 'manager_commands') {
        const q = {
          select: () => q,
          in: () => q,
          eq: () => q,
          gt: () => q,
          delete: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }),
          limit: async () => {
            peekDbHits += 1;
            await new Promise((r) => setTimeout(r, 15));
            return { data: queuedIds.map((id) => ({ worker_id: id })), error: null };
          }
        };
        return q;
      }
      return {};
    },
    async rpc(fnName, params) {
      if (fnName === 'manager_enqueue_worker_command') {
        queuedIds.push(params.p_worker_id);
        return { data: { command_id: params.p_command_id, worker_id: params.p_worker_id, action: params.p_action, status: 'queued' }, error: null };
      }
      if (fnName === 'manager_take_worker_command') {
        const w = params.p_worker_id;
        queuedIds = queuedIds.filter((id) => id !== w);
        return { data: { command_id: 'cmd_1', worker_id: w, action: 'status' }, error: null };
      }
      return { data: null, error: null };
    }
  };
  const cmdStore = new SupabaseCommandStore(mockCmdClient);
  const [p1, p2, p3] = await Promise.all([
    cmdStore.peekQueuedWorkerIds(['01', '02']),
    cmdStore.peekQueuedWorkerIds(['02', '01']),
    cmdStore.peekQueuedWorkerIds(['01'])
  ]);
  assert.equal(peekDbHits, 1, 'Concurrent reordered & subset peekQueuedWorkerIds calls must share 1 query');
  assert.deepEqual(p1, ['01']);
  assert.deepEqual(p2, ['01']);
  assert.deepEqual(p3, ['01']);

  // Cached hit within 250ms
  assert.deepEqual(await cmdStore.peekQueuedWorkerIds(['02']), []);
  assert.equal(peekDbHits, 1, 'Subset check within 250ms TTL must hit micro-cache');

  // enqueue() invalidates 0ms
  await cmdStore.enqueue({ workerId: '02', action: 'chat', payload: { message: 'hi' } });
  const afterEnqueue = await cmdStore.peekQueuedWorkerIds(['01', '02']);
  assert.equal(peekDbHits, 2, 'enqueue() must invalidate peek cache in 0ms');
  assert.deepEqual(afterEnqueue.sort(), ['01', '02']);

  // take() invalidates 0ms
  await cmdStore.take('01');
  const afterTake = await cmdStore.peekQueuedWorkerIds(['01', '02']);
  assert.equal(peekDbHits, 3, 'take() must invalidate peek cache in 0ms');
  assert.deepEqual(afterTake, ['02']);

  // clearWorker() invalidates 0ms
  queuedIds = [];
  await cmdStore.clearWorker('02');
  const afterClear = await cmdStore.peekQueuedWorkerIds(['01', '02']);
  assert.equal(peekDbHits, 4, 'clearWorker() must invalidate peek cache in 0ms');
  assert.deepEqual(afterClear, []);
});

test('19. Wave-6 Discord formatBotLocationVi, /bots & detail infra-hiding + MC setup guidance, and /check Dual-Web Sync display', async () => {
  const {
    formatBotLocationVi,
    renderBotsList,
    renderBotDetail,
    renderStatusMonitorPanel
  } = require('../src/discord/panels/renderer');
  const { collectSystemStatus } = require('../src/discord/status-monitor');

  assert.equal(formatBotLocationVi({ status: { state: 'authenticating', locationState: 'login' } }), 'Khu đăng nhập');
  assert.equal(formatBotLocationVi({ status: { state: 'entering', locationState: 'lobby' } }), 'Sảnh chờ');
  assert.equal(formatBotLocationVi({ status: { state: 'afk', online: true, locationState: 'afk', dimension: 'minecraft:the_nether' } }), 'Khu AFK · Địa ngục');
  assert.equal(formatBotLocationVi({ status: { state: 'online', online: true, locationState: 'game', dimension: 'the_end' } }), 'Khu AFK · The End');
  assert.equal(formatBotLocationVi({ status: { state: 'online', online: true, locationState: 'game', dimension: 'minecraft:overworld' } }), 'Khu sinh tồn / AFK');

  const regularUser = { id: 'u1', username: 'player1', role: 'user', status: 'active', isPermanent: true };
  const unconfiguredBot = {
    workerId: '07',
    botNumber: 7,
    name: 'Bot 07',
    provider: 'wispbyte-secret-node',
    serverHost: 'internal-proxy.kingmc.local',
    status: { state: 'offline', online: false, username: '' },
    settings: { account: { username: '' } }
  };
  const onlineNetherBot = {
    workerId: '08',
    botNumber: 8,
    name: 'Bot 08',
    provider: 'render-internal',
    status: { state: 'afk', online: true, username: 'NetherAFK', locationState: 'afk', dimension: 'the_nether', pingMs: 42, tps: 19.9 }
  };

  const listPanel = renderBotsList({ user: regularUser, workers: [unconfiguredBot, onlineNetherBot], page: 0 });
  const listDesc = listPanel.embeds[0].data.description;
  assert.ok(listDesc.includes('Khu AFK · Địa ngục'), '/bots must show humanized Vietnamese location');
  assert.ok(listDesc.includes('Web Dashboard'), 'Unconfigured bot must guide user to Web Dashboard');
  assert.ok(!listDesc.includes('wispbyte-secret-node') && !listDesc.includes('internal-proxy.kingmc.local'), 'Must hide internal provider/serverHost from regular user');

  const detailPanel = renderBotDetail({ user: regularUser, worker: unconfiguredBot });
  const detailDesc = detailPanel.embeds[0].data.description;
  assert.ok(detailDesc.includes('Web Dashboard'));
  assert.ok(!detailDesc.includes('wispbyte-secret-node') && !detailDesc.includes('internal-proxy.kingmc.local'));

  const maintStartedIso = new Date(Date.now() - 25 * 60 * 1000).toISOString();
  const statusData = await collectSystemStatus({
    registry: { list: async () => [onlineNetherBot] },
    accessStore: {
      adapter: { ping: async () => ({ ok: true }) },
      listAccess: async () => [regularUser],
      getSetting: async (k) => (k === 'system_maintenance'
        ? { enabled: true, message: 'Bảo trì cụm', startedAt: maintStartedIso, lastCompensatedAt: maintStartedIso }
        : null)
    },
    managerRuntimeSettings: {
      getActiveManagerUrls: () => ['https://mgr-primary.onrender.com', 'https://mgr-secondary.onrender.com']
    },
    discordClient: { isReady: () => true, ws: { ping: 38 } },
    config: { publicBaseUrl: 'https://mgr-primary.onrender.com' }
  });
  assert.equal(statusData.activeWebNodes, 2);

  const checkPanel = renderStatusMonitorPanel(statusData);
  const serverField = checkPanel.embeds[0].data.fields.find((f) => f.name.includes('Máy chủ Manager'));
  assert.ok(serverField, 'Expected server status field in /check embed');
  assert.ok(serverField.value.length <= 1024, 'Discord embed field value must stay <= 1024 chars');
  assert.ok(serverField.value.includes('Dual-Web Sync: 2 node'));
  assert.ok(serverField.value.includes('Bảo trì: Đang bật (tạm dừng trừ giờ 25m)'));
});

test('20. Wave-6 Web UI Command Palette (#commandPaletteModal XSS/RBAC), EventSource SSE lifecycle in node:vm & [T7-14] <=2000 line budget', async () => {
  const vm = require('node:vm');
  const dashboardParts = require('../src/http/views/dashboard');
  const { HTML: DASHBOARD_HTML } = require('../src/http/views/dashboard-html');

  // 20a. Verify [T7-14] balanced module budget (40 <= lines <= 2000) & unique DOM IDs including #commandPaletteModal
  const baseDir = path.resolve(__dirname, '../src/http/views/dashboard');
  const allModules = [
    ...dashboardParts.STYLE_FILES.map((f) => path.join(baseDir, f)),
    ...dashboardParts.PARTIAL_FILES.map((f) => path.join(baseDir, f)),
    ...dashboardParts.SCRIPT_FILES.map((f) => path.join(baseDir, f))
  ];
  for (const file of allModules) {
    const lineCount = fs.readFileSync(file, 'utf8').split('\n').length;
    assert.ok(lineCount >= 40 && lineCount <= 2000, `Module ${path.basename(file)} exceeded [T7-14] line budget: ${lineCount}`);
  }
  assert.ok(DASHBOARD_HTML.includes('id="btnOpenCommandPalette"'));
  assert.ok(DASHBOARD_HTML.includes('id="commandPaletteModal"'));
  assert.ok(DASHBOARD_HTML.includes('aria-modal="true"'));

  const allIds = [...dashboardParts.BODY.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const seenIds = new Set();
  for (const id of allIds) {
    assert.equal(seenIds.has(id), false, `Duplicate DOM ID detected: ${id}`);
    seenIds.add(id);
  }

  // 20b. Execute all 7 Dashboard scripts in node:vm with MockEventSource to verify SSE lifecycle + Command Palette RBAC/XSS
  function makeClassList(initial = []) {
    const s = new Set(initial);
    return {
      add: (...c) => c.forEach((x) => s.add(x)),
      remove: (...c) => c.forEach((x) => s.delete(x)),
      contains: (x) => s.has(x),
      toggle: (x, force) => {
        const next = force === undefined ? !s.has(x) : Boolean(force);
        if (next) s.add(x); else s.delete(x);
        return next;
      }
    };
  }

  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) {
      const initHidden = id.endsWith('Modal') || id.endsWith('Banner') || id.endsWith('Dropdown') ? ['hidden'] : [];
      els.set(id, {
        id,
        tagName: 'DIV',
        value: '',
        textContent: '',
        innerHTML: '',
        title: '',
        disabled: false,
        style: {},
        dataset: {},
        classList: makeClassList(initHidden),
        attributes: new Map(),
        setAttribute(k, v) { this.attributes.set(k, String(v)); },
        getAttribute(k) { return this.attributes.get(k) || null; },
        hasAttribute(k) { return this.attributes.has(k); },
        removeAttribute(k) { this.attributes.delete(k); },
        appendChild() {},
        insertBefore() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        removeEventListener() {},
        focus() {},
        select() {},
        scrollIntoView() {},
        getContext() { return null; },
        getBoundingClientRect() { return { left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 }; }
      });
    }
    return els.get(id);
  };

  const docListeners = new Map();
  const esInstances = [];
  class MockEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.closed = false;
      this.listeners = new Map();
      esInstances.push(this);
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    emit(type, dataObj) {
      const payload = { data: typeof dataObj === 'string' ? dataObj : JSON.stringify(dataObj) };
      for (const fn of (this.listeners.get(type) || [])) fn(payload);
    }
    triggerOpen() {
      this.readyState = 1;
      if (typeof this.onopen === 'function') this.onopen();
      this.emit('connected', { ok: true, ts: Date.now() });
    }
    close() {
      this.readyState = 2;
      this.closed = true;
    }
  }

  const scheduledTimers = [];
  const sandbox = {
    console,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    JSON,
    Promise,
    Error,
    Intl,
    URLSearchParams,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    EventSource: MockEventSource,
    setTimeout: (fn, ms) => {
      const rec = { fn, ms, cleared: false };
      scheduledTimers.push(rec);
      return rec;
    },
    clearTimeout: (rec) => { if (rec) rec.cleared = true; },
    setInterval: () => ({}),
    clearInterval: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"ok":true}', json: async () => ({ ok: true }) }),
    navigator: { onLine: true, clipboard: { writeText: async () => {} } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { origin: 'http://127.0.0.1', pathname: '/', search: '', hash: '' },
    history: { replaceState() {}, pushState() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    document: {
      hidden: false,
      activeElement: getEl('btnOpenCommandPalette'),
      documentElement: { setAttribute() {}, getAttribute() { return 'deep-galaxy'; }, style: {}, classList: makeClassList() },
      body: { classList: makeClassList(), style: {}, appendChild() {}, prepend() {} },
      getElementById: (id) => getEl(id),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => getEl('dyn_' + Math.random()),
      addEventListener: (ev, fn) => {
        if (!docListeners.has(ev)) docListeners.set(ev, []);
        docListeners.get(ev).push(fn);
      }
    },
    addEventListener: () => {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dashboardParts.SCRIPTS, sandbox, { filename: 'dashboard-all-7.js' });

  let openedBotId = null;
  let refreshHomeCalls = 0;
  vm.runInContext(
    `currentUser = { id: 'u1', username: 'user1', role: 'user', status: 'active', isPermanent: true };
     bots = [{
       id: 'bot-xss-1',
       workerId: 'bot-xss-1',
       botNumber: 1,
       displayIndex: 1,
       label: '<img src=x onerror=alert(1)>Farm01',
       username: '<script>evil()</script>',
       status: 'afk',
       available: true,
       tags: ['<b>vip</b>']
     }];`,
    sandbox
  );
  sandbox.openBot = (wid) => { openedBotId = wid; };
  vm.runInContext(`openBot = window.openBot; refreshHome = async function() { window.__rh = (window.__rh || 0) + 1; };`, sandbox);

  // SSE connects to /api/manager/stream, updates live indicator to SSE, handles maintenance & fleet_pulse, and closes on tab hide
  sandbox.connectManagerSseStream();
  assert.equal(esInstances.length, 1);
  assert.equal(esInstances[0].url, '/api/manager/stream');
  esInstances[0].triggerOpen();
  assert.equal(getEl('homeSyncStatusPill').className, 'live-sync-pill is-sse');
  assert.ok(getEl('homeSyncStatusText').textContent.includes('Trực tiếp (SSE)'), 'Open SSE stream must display ⚡ Trực tiếp (SSE)');

  esInstances[0].emit('maintenance', { enabled: true, message: 'Bảo trì qua SSE' });
  assert.equal(sandbox.getSystemMaintenanceInfo().enabled, true);
  assert.equal(sandbox.getSystemMaintenanceInfo().message, 'Bảo trì qua SSE');

  esInstances[0].emit('fleet_pulse', { rev: 9, workerId: 'bot-xss-1', reason: 'status' });
  const pulseTimer = scheduledTimers.find((t) => !t.cleared && t.ms === 250);
  assert.ok(pulseTimer, 'fleet_pulse must schedule 250ms debounced flush');
  await pulseTimer.fn();
  refreshHomeCalls = vm.runInContext('window.__rh || 0', sandbox);
  assert.equal(refreshHomeCalls, 1, 'Debounced fleet_pulse must trigger refreshHome()');

  sandbox.document.hidden = true;
  for (const fn of (docListeners.get('visibilitychange') || [])) fn();
  assert.equal(esInstances[0].closed, true, 'Hiding tab must close EventSource immediately');
  sandbox.document.hidden = false;

  // Command Palette RBAC & XSS protection
  sandbox.openCommandPalette('');
  const userPaletteHtml = getEl('commandPaletteList').innerHTML;
  assert.equal(getEl('commandPaletteModal').classList.contains('hidden'), false);
  assert.ok(!userPaletteHtml.includes('<img src=x'), 'Bot label XSS payload must be HTML-escaped');
  assert.ok(!userPaletteHtml.includes('<script>evil'), 'MC username XSS payload must be HTML-escaped');
  assert.ok(userPaletteHtml.includes('&lt;img src=x onerror=alert(1)&gt;Farm01'));
  assert.ok(!userPaletteHtml.includes('Quản lý Người dùng'), 'Regular user must NOT see admin-only commands in Command Palette');
  assert.ok(!userPaletteHtml.includes('Bật / Tắt Chế độ Bảo trì'), 'Regular user must NOT see admin maintenance toggle in Command Palette');

  // Selecting item 0 jumps to bot-xss-1 and closes modal
  sandbox.executeCommandPaletteItem(0);
  assert.equal(openedBotId, 'bot-xss-1');
  assert.equal(getEl('commandPaletteModal').classList.contains('hidden'), true);

  // Admin role sees admin commands & empty-search query is escaped
  vm.runInContext(`currentUser.role = 'admin';`, sandbox);
  sandbox.openCommandPalette('');
  const adminPaletteHtml = getEl('commandPaletteList').innerHTML;
  assert.ok(adminPaletteHtml.includes('Quản lý Người dùng'), 'Admin must see Quản lý Người dùng command');
  assert.ok(adminPaletteHtml.includes('Bật / Tắt Chế độ Bảo trì'), 'Admin must see Bật / Tắt Chế độ Bảo trì command');

  sandbox.onCommandPaletteInput('<svg onload=alert(9)>no_match_xyz');
  const emptyHtml = getEl('commandPaletteList').innerHTML;
  assert.ok(!emptyHtml.includes('<svg onload='), 'Empty-state query echo must escape HTML');
  assert.ok(emptyHtml.includes('&lt;svg onload=alert(9)&gt;'));
  sandbox.closeCommandPalette();
});

test('21. Wave-7 AFK online classification, lossless SSE ?lastRev=/Last-Event-ID, maintenance partial checkpoint + tenant privacy, WorkerStore single-flight, Offhand UI & Discord grace/0-totem', async () => {
  const http = require('node:http');
  const zlib = require('node:zlib');
  const vm = require('node:vm');
  const crypto = require('node:crypto');
  const { createApp } = require('../src/http/app');
  const { createMockSupabaseServer } = require('./e2e/harness/mock-supabase');
  const { createSupabaseClient } = require('../src/storage/supabase-client');
  const { WorkerRegistry } = require('../src/services/worker-registry');
  const { AccessControl } = require('../src/services/access-control');
  const { encryptUserPassword, hashAdminPasswordAsync } = require('../src/utils/secrets');
  const {
    flushMaintenanceCompensation,
    normalizeMaintenanceState,
    sanitizeMaintenanceForSession
  } = require('../src/utils/maintenance');
  const { formatAccountPlanBadge, renderBotsList } = require('../src/discord/panels/renderer');
  const dashboardParts = require('../src/http/views/dashboard');

  // 21a. HTTP + SSE + AFK online classification + Brotli JSON compression + maintenance tenant-privacy stripping
  const supabaseServer = await createMockSupabaseServer();
  const supabaseClient = createSupabaseClient({ url: supabaseServer.url, secretKey: supabaseServer.secretKey });
  const workerStore = new SupabaseWorkerStore(supabaseClient);
  const store = new SupabaseDashboardStore(supabaseClient);
  await workerStore.initialize();
  await store.initialize();

  const encKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const encKey = Buffer.from(encKeyHex, 'hex');
  const sec = encryptSecret('w'.repeat(32), encKey);
  const nowIso = new Date().toISOString();
  const connectedAfkIso = new Date(Date.now() - 120000).toISOString();

  const seedWorkers = [];
  const longTags = ['afk', 'vip', 'nether', 'kingmc', 'tier-alpha'];
  for (let i = 1; i <= 8; i += 1) {
    seedWorkers.push({
      worker_id: `w7-${i}`,
      bot_number: i,
      name: `Wave7 Bot ${i} Extra Label For Brotli Payload`,
      enabled: true,
      provider: 'wispbyte',
      service_url: '',
      secret_ciphertext: sec,
      settings: { tags: longTags },
      status: {
        state: i % 2 === 0 ? 'afk_locked' : 'afk',
        online: true,
        username: `Wave7Mc_${i}`,
        connectedAt: connectedAfkIso,
        uptimeSeconds: 120
      },
      events: [],
      created_at: nowIso,
      updated_at: nowIso
    });
  }
  supabaseServer.seed('manager_workers', seedWorkers);

  const registry = new WorkerRegistry({ store: workerStore, accessStore: store, encryptionKey: encKey });
  await registry.load();
  registry.setAdminPassword(await hashAdminPasswordAsync('AdminW7!99'));
  registry.snapshotRevision = 5;

  const futureIso = new Date(Date.now() + 7 * 86400000).toISOString();
  await store.setAccess('user_w7', {
    id: 'user_w7',
    username: 'userw7',
    password: encryptUserPassword('PassW7!99'),
    role: 'user',
    workerIds: seedWorkers.map((w) => w.worker_id),
    status: 'active',
    isPermanent: false,
    expiresAt: futureIso
  }, 'seed');

  const sensitiveMaint = normalizeMaintenanceState({
    enabled: true,
    message: 'Bảo trì Wave-7',
    startedAt: nowIso,
    lastCompensatedAt: nowIso,
    compensatedUsers: 4,
    partialAnchorIso: nowIso,
    partialCompensatedIds: ['usr_secret_a', 'usr_secret_b'],
    updatedAt: nowIso,
    updatedBy: 'superadmin_internal'
  });
  await store.setSetting('system_maintenance', sensitiveMaint);
  store.cachedMaintenance = sensitiveMaint;
  store.cachedMaintenanceAt = Date.now();

  let displayOrderReads = 0;
  const origGetSetting = store.getSetting.bind(store);
  store.getSetting = async (key, opts) => {
    if (key === 'bot_display_order') displayOrderReads += 1;
    return origGetSetting(key, opts);
  };

  const app = createApp({
    store,
    workerStore,
    registry,
    broker: { dispatch: async () => ({ delivered: true, result: { ok: true } }) },
    entitlementService: { redeem: async () => ({ ok: true }) },
    accessControl: new AccessControl({ store }),
    config: {
      adminUsername: 'admin',
      adminPassword: 'AdminW7!99',
      sessionSecret: 'wave7-test-secret-0123456789abcdef',
      encryptionKey: encKey,
      encryptionKeyHex: encKeyHex,
      publicBaseUrl: 'http://127.0.0.1'
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const openReqs = [];
  try {
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const doLogin = async (username, password, ip) => {
      const r = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body: JSON.stringify({ username, password })
      });
      return r.json();
    };

    const userLogin = await doLogin('userw7', 'PassW7!99', '10.77.1.1');
    const adminLogin = await doLogin('admin', 'AdminW7!99', '10.77.1.2');
    assert.ok(userLogin.token && adminLogin.token);
    assert.equal(userLogin.maintenance.partialCompensatedIds, undefined, 'Non-admin /login must strip partialCompensatedIds');
    assert.equal(userLogin.maintenance.partialAnchorIso, undefined, 'Non-admin /login must strip partialAnchorIso');
    assert.equal(userLogin.maintenance.updatedBy, undefined, 'Non-admin /login must strip updatedBy');
    assert.deepEqual(adminLogin.maintenance.partialCompensatedIds, ['usr_secret_a', 'usr_secret_b'], 'Admin /login keeps full maintenance state');

    // Non-admin GET /api/auth/me strips sensitive maintenance fields
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${userLogin.token}`, 'X-Forwarded-For': '10.77.1.1' }
    });
    const meJson = await meRes.json();
    assert.equal(meJson.maintenance.partialCompensatedIds, undefined);
    assert.equal(meJson.maintenance.compensatedUsers, undefined);
    assert.equal(meJson.maintenance.updatedBy, undefined);

    // Non-admin GET /api/manager/bots -> 0 bot_display_order reads, AFK/AFK_LOCKED online:true, br compression, sanitized maintenance
    displayOrderReads = 0;
    const rawBotsResp = await new Promise((resolve, reject) => {
      http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/manager/bots',
          headers: {
            Authorization: `Bearer ${userLogin.token}`,
            'Accept-Encoding': 'br',
            'X-Forwarded-For': '10.77.1.1'
          }
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        }
      ).on('error', reject);
    });
    assert.equal(rawBotsResp.status, 200);
    assert.equal(displayOrderReads, 0, 'Non-admin /bots must NOT query bot_display_order');
    assert.equal(rawBotsResp.headers['content-encoding'], 'br', 'Large /bots JSON >= 1024B must compress with Brotli');
    const botsJson = JSON.parse(zlib.brotliDecompressSync(rawBotsResp.body).toString('utf8'));
    assert.equal(botsJson.bots.length, 8);
    for (const b of botsJson.bots) {
      assert.equal(b.online, true, `Bot ${b.workerId} in state=${b.status} must report online:true`);
      assert.equal(b.available, true);
      assert.equal(b.connectedAt, connectedAfkIso);
    }
    assert.equal(botsJson.maintenance.partialCompensatedIds, undefined);
    assert.equal(botsJson.maintenance.updatedBy, undefined);

    // Lossless SSE ?lastRev= & Last-Event-ID + stripped maintenance
    const readConnectedSse = (pathWithQuery, headers = {}) => new Promise((resolve, reject) => {
      let buf = '';
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: pathWithQuery,
        method: 'GET',
        headers: { Authorization: `Bearer ${userLogin.token}`, 'X-Forwarded-For': '10.77.1.1', ...headers }
      }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buf += chunk;
          if (buf.includes('\n\n')) {
            const firstBlock = buf.split('\n\n')[0];
            try { req.destroy(); } catch (_) {}
            resolve({ status: res.statusCode, firstBlock });
          }
        });
      });
      req.on('error', (err) => {
        if (!buf.includes('\n\n')) reject(err);
      });
      req.end();
      openReqs.push(req);
    });

    const sseMissed = await readConnectedSse('/api/manager/stream?lastRev=1');
    assert.equal(sseMissed.status, 200);
    assert.ok(sseMissed.firstBlock.includes('id: 5'), 'SSE connected event must emit id: <rev>');
    const missedData = JSON.parse(sseMissed.firstBlock.split('\n').find((l) => l.startsWith('data:')).slice(5));
    assert.equal(missedData.rev, 5);
    assert.equal(missedData.missed, true);
    assert.equal(missedData.maintenance.partialCompensatedIds, undefined);
    assert.equal(missedData.maintenance.updatedBy, undefined);

    const sseSynced = await readConnectedSse('/api/manager/stream', { 'Last-Event-ID': '5' });
    const syncedData = JSON.parse(sseSynced.firstBlock.split('\n').find((l) => l.startsWith('data:')).slice(5));
    assert.equal(syncedData.missed, false);

    assert.equal(sanitizeMaintenanceForSession(sensitiveMaint, { role: 'admin' }).compensatedUsers, 4);
  } finally {
    for (const r of openReqs) { try { r.destroy(); } catch (_) {} }
    app.setShuttingDown(true);
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await supabaseServer.close();
  }

  // 21b. flushMaintenanceCompensation mid-batch checkpoint & retry without double-compensation
  const anchorTime = Date.parse('2026-11-27T10:00:00.000Z');
  const endTime = anchorTime + 30 * 60000;
  let maintDoc = normalizeMaintenanceState({
    enabled: true,
    message: 'Bảo trì checkpoint test',
    startedAt: new Date(anchorTime).toISOString(),
    lastCompensatedAt: new Date(anchorTime).toISOString()
  });
  const usersDb = new Map([
    ['u1', { userId: 'u1', username: 'u1', status: 'active', isPermanent: false, expiresAt: new Date(anchorTime + 3600000).toISOString() }],
    ['u2', { userId: 'u2', username: 'u2', status: 'active', isPermanent: false, expiresAt: new Date(anchorTime + 7200000).toISOString() }]
  ]);
  let failUserU2Once = true;
  const setAccessCalls = new Map([['u1', 0], ['u2', 0]]);
  const checkpointStore = {
    invalidateCache() {},
    async getSetting(k) { return k === 'system_maintenance' ? { ...maintDoc } : null; },
    async setSetting(k, val) { if (k === 'system_maintenance') maintDoc = { ...val }; return val; },
    async listAccess() { return [...usersDb.values()].map((u) => ({ ...u })); },
    async setAccess(id, rec) {
      if (id === 'u2' && failUserU2Once) {
        failUserU2Once = false;
        throw new Error('503 temporary upstream error');
      }
      setAccessCalls.set(id, (setAccessCalls.get(id) || 0) + 1);
      usersDb.set(id, { ...rec });
    }
  };
  await assert.rejects(
    () => flushMaintenanceCompensation(checkpointStore, { toMs: endTime, turnOff: true, actor: 'admin' }),
    /503 temporary/
  );
  assert.deepEqual(maintDoc.partialCompensatedIds, ['u1']);
  assert.equal(maintDoc.partialAnchorIso, new Date(anchorTime).toISOString());
  const finalMaint = await flushMaintenanceCompensation(checkpointStore, { toMs: endTime, turnOff: true, actor: 'admin' });
  assert.equal(setAccessCalls.get('u1'), 1, 'u1 already checkpointed must NOT be double-compensated on retry');
  assert.equal(setAccessCalls.get('u2'), 1, 'u2 must be compensated on retry');
  assert.equal(finalMaint.enabled, false);
  assert.equal(finalMaint.compensatedUsers, 2);
  assert.deepEqual(finalMaint.partialCompensatedIds, []);
  assert.equal(finalMaint.partialAnchorIso, null);

  // 21c. SupabaseWorkerStore.get() & getByNumber() single-flight + clone isolation + stale-if-error + fail-closed 42501
  let itemSelects = 0;
  let numSelects = 0;
  let forceErrMode = null;
  const singleRow = {
    worker_id: 'w9',
    bot_number: 9,
    name: 'SingleFlight 9',
    provider: 'wispbyte',
    service_url: '',
    render_service_id: '',
    secret_ciphertext: 'enc',
    enabled: true,
    settings: { nested: { flag: true } },
    status: { state: 'afk', online: true },
    last_event: null,
    last_heartbeat: nowIso,
    created_at: nowIso,
    updated_at: nowIso
  };
  const sfClient = {
    from() {
      return {
        select() {
          return {
            eq(col) {
              return {
                async maybeSingle() {
                  await new Promise((r) => setTimeout(r, 15));
                  if (forceErrMode === '503') {
                    const e = new Error('503 Service Unavailable');
                    e.status = 503;
                    throw e;
                  }
                  if (forceErrMode === '42501') {
                    const e = new Error('permission denied');
                    e.code = '42501';
                    throw e;
                  }
                  if (col === 'worker_id') itemSelects += 1;
                  if (col === 'bot_number') numSelects += 1;
                  return { data: singleRow, error: null };
                }
              };
            }
          };
        }
      };
    }
  };
  const sfStore = new SupabaseWorkerStore(sfClient, { cacheTtlMs: 25 });
  const [g1, g2, g3] = await Promise.all([sfStore.get('w9'), sfStore.get('w9'), sfStore.get('w9')]);
  assert.equal(itemSelects, 1, 'Concurrent get() calls must coalesce into 1 query');
  g1.status.state = 'mutated_caller';
  assert.equal(g2.status.state, 'afk', 'Returned clones must be isolated across callers');
  assert.equal(g3.botNumber, 9);

  sfStore.invalidateCache();
  const [n1, n2] = await Promise.all([sfStore.getByNumber(9), sfStore.getByNumber(9)]);
  assert.equal(numSelects, 1, 'Concurrent getByNumber() calls must coalesce into 1 query');
  assert.equal(n1.workerId, 'w9');
  assert.equal(n2.workerId, 'w9');

  await new Promise((r) => setTimeout(r, 35)); // expire TTL while within staleUntil
  forceErrMode = '503';
  const staleRes = await sfStore.get('w9');
  assert.equal(staleRes.workerId, 'w9', 'Transient 503 must serve bounded stale-if-error entry');
  forceErrMode = '42501';
  await assert.rejects(() => sfStore.get('w9'), /permission denied/);

  // 21d. Web UI Offhand object display + Empty filter recovery + [T7-14]
  const baseDir = path.resolve(__dirname, '../src/http/views/dashboard');
  const allModules = [
    ...dashboardParts.STYLE_FILES.map((f) => path.join(baseDir, f)),
    ...dashboardParts.PARTIAL_FILES.map((f) => path.join(baseDir, f)),
    ...dashboardParts.SCRIPT_FILES.map((f) => path.join(baseDir, f))
  ];
  for (const file of allModules) {
    const lineCount = fs.readFileSync(file, 'utf8').split('\n').length;
    assert.ok(lineCount >= 40 && lineCount <= 1950, `Module ${path.basename(file)} exceeded Wave-7 1950 line budget: ${lineCount}`);
  }
  const allDomIds = [...dashboardParts.BODY.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(allDomIds).size, allDomIds.length, 'Dashboard HTML must have 0 duplicate DOM IDs');

  const uiEls = new Map();
  const makeCls = () => {
    const s = new Set();
    return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (x) => s.has(x), toggle: (x, f) => (f === undefined ? (s.has(x) ? (s.delete(x), false) : (s.add(x), true)) : (f ? (s.add(x), true) : (s.delete(x), false))) };
  };
  const getUiEl = (id) => {
    if (!uiEls.has(id)) {
      const el = {
        id,
        value: '',
        textContent: '',
        _html: '',
        style: {},
        dataset: {},
        children: [],
        parent: null,
        classList: makeCls(),
        get innerHTML() {
          if (this.children.length > 0 && !this._html) {
            return this.children.map((c) => c._rawHtml || c.innerHTML || '').join('');
          }
          return this._html;
        },
        set innerHTML(val) {
          this._html = String(val || '');
          this.children = [];
          const trimmed = this._html.trim();
          if (trimmed) {
            const child = getUiEl(`child_${id}_${Math.random().toString(36).slice(2, 7)}`);
            child.parent = this;
            child._rawHtml = trimmed;
            child._html = trimmed;
            const clsMatch = trimmed.match(/class="([^"]+)"/i);
            if (clsMatch) clsMatch[1].split(/\s+/).filter(Boolean).forEach((c) => child.classList.add(c));
            const bidMatch = trimmed.match(/data-bot-id="([^"]+)"/i);
            if (bidMatch) child.dataset.botId = bidMatch[1];
            this.children.push(child);
          }
        },
        get firstElementChild() { return this.children[0] || null; },
        remove() {
          if (this.parent) {
            this.parent.children = this.parent.children.filter((c) => c !== this);
            this.parent._html = this.parent.children.map((c) => c._rawHtml || c.innerHTML || '').join('');
            this.parent = null;
          }
        },
        setAttribute(k, v) { if (k === 'data-bot-id') this.dataset.botId = String(v); },
        getAttribute(k) { return k === 'data-bot-id' ? (this.dataset.botId || null) : null; },
        removeAttribute() {},
        appendChild(c) { c.parent = this; this.children.push(c); this._html = ''; },
        insertBefore(c, ref) {
          c.parent = this;
          this.children = this.children.filter((x) => x !== c);
          const idx = ref ? this.children.indexOf(ref) : -1;
          if (idx >= 0) this.children.splice(idx, 0, c);
          else this.children.push(c);
          this._html = this.children.map((x) => x._rawHtml || x.innerHTML || '').join('');
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        getContext() { return null; }
      };
      uiEls.set(id, el);
    }
    return uiEls.get(id);
  };
  const uiSandbox = {
    console, Math, Date, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Promise, Error, Intl, URLSearchParams,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    setTimeout: () => ({}), clearTimeout: () => {}, setInterval: () => ({}), clearInterval: () => {},
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    navigator: { onLine: true },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { origin: 'http://127.0.0.1', pathname: '/', search: '', hash: '' },
    history: { replaceState() {}, pushState() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: {
      hidden: false,
      documentElement: { setAttribute() {}, getAttribute: () => 'deep-galaxy', style: {}, classList: makeCls() },
      body: { classList: makeCls(), style: {}, appendChild() {}, prepend() {} },
      getElementById: getUiEl,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => getUiEl(`dyn_${tag}_${crypto.randomBytes(2).toString('hex')}`),
      addEventListener() {}
    },
    addEventListener() {}
  };
  uiSandbox.window = uiSandbox;
  uiSandbox.globalThis = uiSandbox;
  vm.createContext(uiSandbox);
  vm.runInContext(dashboardParts.SCRIPTS, uiSandbox, { filename: 'dashboard-wave7.js' });
  vm.runInContext(`
    currentUser = { id: 'u7', username: 'u7', role: 'user', status: 'active', isPermanent: true };
    bots = [{ id: 'b1', workerId: 'b1', botNumber: 1, name: 'Bot 01', label: 'Bot 01', username: 'Hero', status: 'afk', online: true, available: true, tags: [] }];
    detailBot = bots[0];
    detailInventory = {
      health: 20,
      food: 20,
      goldenAppleCount: 3,
      totemCount: 2,
      foodCount: 16,
      revision: 4,
      armor: {},
      offhand: { name: 'totem_of_undying', count: 1 },
      slots: { '45': { name: 'totem_of_undying', count: 1 } }
    };
  `, uiSandbox);
  uiSandbox.renderDetailInventory();
  const offhandLabel = getUiEl('detailOffhand').textContent;
  assert.ok(offhandLabel && !offhandLabel.includes('[object Object]'), `Offhand label must not show [object Object], got: ${offhandLabel}`);

  getUiEl('searchInput').value = '__no_such_bot_wave7__';
  uiSandbox.filterBots();
  assert.ok(getUiEl('botGrid').innerHTML.includes('Xóa bộ lọc (1 bot)'), 'Empty search filter must render 1-click recovery button');
  uiSandbox.resetFleetFilters();
  assert.equal(getUiEl('searchInput').value, '');
  assert.ok(!getUiEl('botGrid').innerHTML.includes('empty-filter-state'), 'resetFleetFilters() must restore bot cards');

  // 21e. Discord grace badge + 0 Totem survival warning + <1m uptime
  const graceBadge = formatAccountPlanBadge({ role: 'user', status: 'grace_period', inGracePeriod: true });
  assert.equal(graceBadge, '⏳ `Ân hạn · Gia hạn ngay`');
  const zeroTotemPanel = renderBotsList({
    user: { id: 'u7', username: 'u7', role: 'user', status: 'grace_period', inGracePeriod: true },
    workers: [{
      workerId: 'w7',
      botNumber: 7,
      name: 'RiskBot',
      status: { state: 'afk', online: true, username: 'RiskUser', totemCount: 0, health: 18, pingMs: 35, tps: 19.8 }
    }],
    page: 0
  });
  const panelDesc = zeroTotemPanel.embeds[0].data.description;
  assert.ok(panelDesc.includes('⏳ `Ân hạn · Gia hạn ngay`'));
  assert.ok(panelDesc.includes('🛡️ `0 Totem`'));
});
