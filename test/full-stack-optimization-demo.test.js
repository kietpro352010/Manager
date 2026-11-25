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
