'use strict';

const zlib = require('node:zlib');
const express = require('express');
const helmet = require('helmet');

const { PUBLIC_LOGIN_HTML } = require('./views/login-html');
const { HTML: DASHBOARD_HTML } = require('./views/dashboard-html');

const {
  createAuthApi,
  hashSessionToken,
  parseCookies,
  getRequestManagerSessionToken,
  isHttps
} = require('./routes/auth-api');

const { createUserApi } = require('./routes/user-api');
const { createAdminApi } = require('./routes/admin-api');
const { createWorkerApi } = require('./routes/worker-api');
const { timingSafeStringEquals } = require('../utils/secrets');

function createApp({
  store,
  entitlementService,
  link4mService,
  registry,
  broker,
  commandStore = null,
  workerStore,
  fleetOperations,
  adminNotifier,
  discordClient,
  config,
  logger
}) {
  const app = express();
  app.disable('x-powered-by');

  // Shared active sessions map in memory (TTL synced with DB)
  const activeSessions = new Map();

  // Helper to check worker bot secret
  function isBotSecretRequest(req) {
    const incoming = String(req?.headers?.['x-bot-secret'] || req?.headers?.['x-worker-secret'] || '').trim();
    if (!incoming) return false;
    const globalSecret = String(config.botSecretKey || '').trim();
    if (globalSecret && timingSafeStringEquals(incoming, globalSecret)) return true;
    const botId = String(req?.headers?.['x-manager-bot-id'] || req?.body?.workerId || req?.body?.botId || req?.query?.botId || req?.params?.workerId || '').trim();
    if (botId && typeof registry.verifyBotSecretSync === 'function') {
      return registry.verifyBotSecretSync(botId, incoming);
    }
    return false;
  }

  // 1. Lightweight Zero-Dependency Gzip Compression Middleware (saves ~85% outbound bandwidth)
  app.use((req, res, next) => {
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (!acceptEncoding.includes('gzip')) return next();
    const originalSend = res.send;
    res.send = function (body) {
      if (res.headersSent || !body) return originalSend.call(this, body);
      const contentType = String(res.getHeader('Content-Type') || '');
      const isCompressible = contentType.includes('json') ||
                             contentType.includes('html') ||
                             contentType.includes('text') ||
                             contentType.includes('javascript') ||
                             contentType.includes('css');
      if (!isCompressible) return originalSend.call(this, body);
      const buffer = Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      if (buffer.length < 512) return originalSend.call(this, body);
      try {
        const compressed = zlib.gzipSync(buffer, { level: 5 });
        res.setHeader('Content-Encoding', 'gzip');
        res.removeHeader('Content-Length');
        return originalSend.call(this, compressed);
      } catch (_) {
        res.removeHeader('Content-Encoding');
        return originalSend.call(this, body);
      }
    };
    next();
  });

  // 2. Security Headers & Caching
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; img-src 'self' data: https: blob:; media-src 'self' https: data: blob:; connect-src 'self' https:;");

    if (isHttps(req)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    if (req.path.startsWith('/api/') || req.path === '/health' || req.path === '/ready') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  // 3. Body Parsers
  app.use(express.json({ limit: '512kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));

  // 4. CSRF Protection for Browser State-Changing Requests
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (isBotSecretRequest(req)) return next();
      if (req.path === '/api/auth/login' ||
          req.path === '/api/auth/register' ||
          req.path === '/api/auth/logout' ||
          req.path === '/api/auth/verify-bot-access' ||
          req.path === '/api/rewards/link4m/return' ||
          req.path === '/api/rewards/link4m/verify' ||
          req.path.startsWith('/api/worker/') ||
          req.path.startsWith('/api/v1/workers/')) {
        return next();
      }

      const cookies = parseCookies(req);
      const hasSessionCookie = Boolean(cookies.kingmc_mgr_session);
      const origin = req.headers['origin'];
      const host = req.headers['host'];

      if (hasSessionCookie && !origin && !req.headers['referer']) {
        return res.status(403).json({ ok: false, error: 'Yêu cầu từ trình duyệt thiếu header xác thực nguồn (Origin/Referer).' });
      }

      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            return res.status(403).json({ ok: false, error: 'Yêu cầu bị từ chối do vi phạm bảo vệ CSRF (Origin mismatch).' });
          }
        } catch (_) {
          return res.status(403).json({ ok: false, error: 'Origin header không hợp lệ.' });
        }
      }
    }
    next();
  });

  // Helper: Evict local cached sessions for a deleted or disabled user
  function invalidateUserSessions(identifier) {
    const raw = String(identifier || '').trim();
    if (!raw) return 0;
    const lower = raw.toLowerCase();
    const bare = lower.startsWith('usr_') ? lower.slice(4) : lower;
    let removed = 0;
    for (const [hash, cached] of activeSessions.entries()) {
      if (!cached || cached.role === 'admin') continue;
      const sId = String(cached.userId || '').trim().toLowerCase();
      const sUser = String(cached.username || '').trim().toLowerCase();
      const sBare = sId.startsWith('usr_') ? sId.slice(4) : sId;
      if (
        sId === lower ||
        (bare && (sId === `usr_${bare}` || sBare === bare || sUser === bare)) ||
        sUser === lower
      ) {
        activeSessions.delete(hash);
        removed += 1;
      }
    }
    return removed;
  }

  function applyFreshAccessToSession(targetSession, userRec) {
    const freshAssigned = Array.isArray(userRec.workerIds) && userRec.workerIds.length
      ? userRec.workerIds
      : (Array.isArray(userRec.assignedBotIds) ? userRec.assignedBotIds : []);
    targetSession.assignedBotIds = freshAssigned.map(String);
    if (userRec.expiresAt !== undefined) targetSession.expiresAtRental = userRec.expiresAt;
    if (userRec.role) targetSession.role = userRec.role;
    if (userRec.planName) targetSession.planName = userRec.planName;
    targetSession.isPermanent = Boolean(userRec.isPermanent);
    targetSession.allowAccountChange = userRec.allowAccountChange !== false;
    const rawStatus = String(userRec.status || targetSession.status || 'active').toLowerCase();
    const effExpiresAt = userRec.expiresAt || targetSession.expiresAtRental;
    const isTimeExpired = !targetSession.isPermanent && effExpiresAt && Date.parse(effExpiresAt) <= Date.now();
    targetSession.status = rawStatus === 'disabled'
      ? 'disabled'
      : ((rawStatus === 'expired' || isTimeExpired) ? 'expired' : 'active');
  }

  // 5. Dynamic Session Authentication Middleware
  app.use(async (req, _res, next) => {
    req.managerAuthChecked = true;
    req.managerAuthSession = null;

    if (isBotSecretRequest(req)) return next();

    const rawToken = getRequestManagerSessionToken(req);
    if (!rawToken) return next();

    const tokenHash = hashSessionToken(rawToken);
    const cachedSession = activeSessions.get(tokenHash) || null;
    const useDbAuth = typeof store.adapter?.fetchManagerAuthorization === 'function' &&
      (typeof store.adapter.isEnabled !== 'function' || store.adapter.isEnabled());
    const isEnvAdminCached = Boolean(
      cachedSession &&
      cachedSession.role === 'admin' &&
      !String(cachedSession.userId || '').toLowerCase().startsWith('usr_')
    );
    let session = null;

    if (isEnvAdminCached) {
      if (Number(cachedSession.expiresAt) <= Date.now()) {
        activeSessions.delete(tokenHash);
      } else {
        session = cachedSession;
      }
    } else if (useDbAuth) {
      try {
        const authData = await store.adapter.fetchManagerAuthorization(tokenHash);
        const dbSession = authData?.ok ? authData.session : null;
        const dbUser = authData?.ok ? authData.user : null;

        if (dbSession && Number(dbSession.expiresAt) > Date.now()) {
          if (dbSession.role === 'admin') {
            session = dbSession;
            activeSessions.set(tokenHash, session);
          } else if (
            dbUser &&
            String(dbUser.status || '').toLowerCase() !== 'disabled' &&
            (!dbUser.id || !dbSession.userId || String(dbUser.id) === String(dbSession.userId)) &&
            (!dbUser.username || !dbSession.username || String(dbUser.username).toLowerCase() === String(dbSession.username).toLowerCase())
          ) {
            const candidate = { ...dbSession };
            applyFreshAccessToSession(candidate, dbUser);

            if (typeof store.getAccess === 'function') {
              try {
                const userRec = await store.getAccess(candidate.userId, { bypassCache: true });
                const idMismatch = Boolean(
                  userRec &&
                  candidate.userId &&
                  userRec.userId &&
                  String(candidate.userId).startsWith('usr_') &&
                  String(userRec.userId) !== String(candidate.userId)
                );
                if (!userRec || idMismatch || String(userRec.status || '').toLowerCase() === 'disabled') {
                  session = null;
                } else {
                  applyFreshAccessToSession(candidate, userRec);
                  session = candidate;
                }
              } catch (_) {
                session = null;
              }
            } else {
              session = candidate;
            }
          }
        }
      } catch (_) {
        session = null;
      }

      if (session) {
        activeSessions.set(tokenHash, session);
      } else {
        activeSessions.delete(tokenHash);
        if (typeof store.invalidateCache === 'function') store.invalidateCache();
      }
    } else if (cachedSession) {
      if (Number(cachedSession.expiresAt) <= Date.now()) {
        activeSessions.delete(tokenHash);
      } else if (cachedSession.role === 'admin' && !String(cachedSession.userId || '').toLowerCase().startsWith('usr_')) {
        session = cachedSession;
      } else if (typeof store.getAccess === 'function') {
        try {
          const userRec = await store.getAccess(cachedSession.userId, { bypassCache: true });
          const idMismatch = Boolean(
            userRec &&
            cachedSession.userId &&
            userRec.userId &&
            String(cachedSession.userId).startsWith('usr_') &&
            String(userRec.userId) !== String(cachedSession.userId)
          );
          if (!userRec || idMismatch || String(userRec.status || '').toLowerCase() === 'disabled') {
            activeSessions.delete(tokenHash);
            if (typeof store.invalidateCache === 'function') store.invalidateCache();
            session = null;
          } else {
            applyFreshAccessToSession(cachedSession, userRec);
            session = cachedSession;
          }
        } catch (_) {
          activeSessions.delete(tokenHash);
          session = null;
        }
      } else {
        session = cachedSession;
      }
    }

    if (session) {
      req.managerAuthSession = session;
    }
    next();
  });

  // 6. Root SPA Route (Login view if unauthenticated, Dashboard view if authenticated)
  app.get('/', (req, res) => {
    if (req.managerAuthSession) {
      return res.type('html').send(DASHBOARD_HTML);
    }
    return res.type('html').send(PUBLIC_LOGIN_HTML);
  });

  function getDegradedChecks() {
    const link4mHealth = (link4mService && typeof link4mService.health === 'function')
      ? link4mService.health()
      : { ok: true, status: 'not_configured', initialized: false, degraded: false, error: null };
    const effectiveCommandStore = commandStore || broker?.commandStore || null;
    const commandSyncHealth = (effectiveCommandStore && typeof effectiveCommandStore.health === 'function')
      ? effectiveCommandStore.health()
      : { ok: true, status: 'not_configured', degraded: false, rpcVerified: false, retryEnabled: true, missingRpcs: [], error: null };

    const warnings = [];
    if (link4mHealth.degraded) {
      warnings.push(`link4m_degraded:${link4mHealth.error || 'unknown_error'}`);
    }
    if (commandSyncHealth.degraded) {
      const detail = Array.isArray(commandSyncHealth.missingRpcs) && commandSyncHealth.missingRpcs.length > 0
        ? commandSyncHealth.missingRpcs.join(',')
        : (commandSyncHealth.error || 'ATOMIC_STATE_SYNC_RPC_REQUIRED');
      warnings.push(`command_sync_rpc_missing:${detail}`);
    }
    const degraded = Boolean(link4mHealth.degraded || commandSyncHealth.degraded);
    return { link4mHealth, commandSyncHealth, warnings, degraded };
  }

  // 6.1 Liveness Probe (process health, uptime, memory, optional degraded warnings)
  app.get('/health', (_req, res) => {
    const memory = process.memoryUsage();
    const { link4mHealth, commandSyncHealth, warnings, degraded } = getDegradedChecks();
    return res.json({
      ok: true,
      degraded,
      service: 'KingMC AFK Bot Cloud 24/7',
      status: degraded ? 'degraded' : 'healthy',
      checks: {
        link4m: link4mHealth,
        commandSyncRpc: commandSyncHealth
      },
      warnings,
      uptime: Math.floor(process.uptime()),
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024))
      },
      time: new Date().toISOString()
    });
  });

  // 6.2 Readiness Probe (validates Database connectivity and Discord Gateway)
  app.get(['/ready', '/api/ready'], async (_req, res) => {
    let dbOk = true;
    let dbLatencyMs = 0;
    if (store?.adapter && typeof store.adapter.testConnection === 'function') {
      const start = Date.now();
      try {
        const testRes = await store.adapter.testConnection();
        dbOk = Boolean(testRes?.ok);
        dbLatencyMs = Date.now() - start;
      } catch (_) {
        dbOk = false;
      }
    }

    let discordStatus = 'not_configured';
    let discordOk = true;
    if (config?.discordToken) {
      const isDiscordReady = Boolean(discordClient && typeof discordClient.isReady === 'function' && discordClient.isReady());
      discordStatus = isDiscordReady ? 'ready' : 'connecting';
      discordOk = isDiscordReady;
    }

    const { link4mHealth, commandSyncHealth, warnings, degraded } = getDegradedChecks();
    const isReady = dbOk && discordOk;
    const statusCode = isReady ? 200 : 503;
    const readinessStatus = !isReady
      ? 'not_ready'
      : (degraded ? 'degraded' : 'ready');

    return res.status(statusCode).json({
      ok: isReady,
      degraded,
      status: readinessStatus,
      service: 'KingMC AFK Bot Cloud 24/7',
      checks: {
        database: { ok: dbOk, latencyMs: dbLatencyMs },
        discord: { status: discordStatus, ok: discordOk },
        link4m: link4mHealth,
        commandSyncRpc: commandSyncHealth
      },
      warnings,
      time: new Date().toISOString()
    });
  });

  // 7. Mount Sub-APIs
  const authRouter = createAuthApi({
    store,
    entitlementService,
    registry,
    config,
    logger,
    activeSessions
  });
  app.use('/api/auth', authRouter);

  const userRouter = createUserApi({
    store,
    entitlementService,
    link4mService,
    registry,
    broker,
    fleetOperations,
    config,
    logger
  });
  app.use('/api/manager', userRouter);
  app.use('/api/rewards/link4m', userRouter); // Route alias for Link4m
  app.use('/api/public', userRouter); // Route alias for public stats
  app.use('/api/user', userRouter); // Route alias for user discord & settings
  app.use('/api', userRouter); // Route alias for generic API calls

  const adminRouter = createAdminApi({
    store,
    entitlementService,
    registry,
    broker,
    fleetOperations,
    adminNotifier,
    config,
    logger,
    invalidateUserSessions
  });
  app.use('/api/manager', adminRouter);

  const workerRouter = createWorkerApi({
    registry,
    broker,
    workerStore,
    adminNotifier,
    config,
    logger
  });
  app.use('/api/v1/workers/:workerId', workerRouter);
  app.use('/api/worker', workerRouter);

  // 8. 404 Handler
  app.use((_req, res) => {
    return res.status(404).json({ ok: false, error: 'not_found' });
  });

  // 9. Error Handler
  app.use((err, _req, res, _next) => {
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
      return res.status(400).json({ ok: false, error: 'JSON request không hợp lệ.' });
    }
    logger?.error('HTTP Server Error', { error: err.message, stack: err.stack });
    return res.status(500).json({ ok: false, error: 'internal_server_error' });
  });

  return app;
}

module.exports = { createApp };
