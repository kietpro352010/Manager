'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');

const { PUBLIC_LOGIN_HTML } = require('./views/login-html');
const {
  SHELL_HTML: DASHBOARD_SHELL_HTML,
  STYLES: DASHBOARD_STYLES,
  SCRIPTS: DASHBOARD_SCRIPTS,
  CSS_PATH: DASHBOARD_CSS_PATH,
  JS_PATH: DASHBOARD_JS_PATH
} = require('./views/dashboard-html');

function prepareCompressedView(content, contentType = 'text/html; charset=utf-8') {
  const raw = Buffer.from(String(content || ''), 'utf8');
  const gzip = zlib.gzipSync(raw, { level: 9 });
  const brotli = typeof zlib.brotliCompressSync === 'function'
    ? zlib.brotliCompressSync(raw, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT
        }
      })
    : null;
  const etag = `W/"${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16)}"`;
  return { raw, gzip, brotli, etag, contentType };
}

const PRECOMPRESSED_DASHBOARD = prepareCompressedView(DASHBOARD_SHELL_HTML, 'text/html; charset=utf-8');
const PRECOMPRESSED_DASHBOARD_CSS = prepareCompressedView(DASHBOARD_STYLES, 'text/css; charset=utf-8');
const PRECOMPRESSED_DASHBOARD_JS = prepareCompressedView(DASHBOARD_SCRIPTS, 'application/javascript; charset=utf-8');
const PRECOMPRESSED_LOGIN = prepareCompressedView(PUBLIC_LOGIN_HTML, 'text/html; charset=utf-8');

function negotiateEncoding(req) {
  const acceptEncoding = String(req?.headers?.['accept-encoding'] || '');
  let wildcardQuality = null;
  let brQuality = null;
  let gzipQuality = null;
  for (const entry of acceptEncoding.split(',')) {
    const [name, ...params] = entry.trim().toLowerCase().split(';');
    const qParam = params.find((param) => /^\s*q\s*=/.test(param));
    const quality = qParam ? Number(qParam.split('=')[1]) : 1;
    if (!Number.isFinite(quality) || quality < 0 || quality > 1) continue;
    if (name === 'br') brQuality = quality;
    else if (name === 'gzip') gzipQuality = quality;
    else if (name === '*') wildcardQuality = quality;
  }
  const brAllowed = brQuality !== null ? brQuality > 0 : (wildcardQuality !== null && wildcardQuality > 0);
  const gzipAllowed = gzipQuality !== null ? gzipQuality > 0 : (wildcardQuality !== null && wildcardQuality > 0);
  if (brAllowed && typeof zlib.brotliCompress === 'function') {
    if (brQuality === null || gzipQuality === null || brQuality >= gzipQuality) {
      return 'br';
    }
  }
  if (gzipAllowed) return 'gzip';
  return null;
}

function sendPrecompressed(req, res, asset, { varyHeader = 'Accept-Encoding', cacheControl = 'private, no-cache' } = {}) {
  res.setHeader('Vary', varyHeader);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('ETag', asset.etag);
  const ifNoneMatch = String(req.headers['if-none-match'] || '');
  if (ifNoneMatch && ifNoneMatch.split(',').some((tag) => tag.trim().replace(/-(?:gzip|br)(?="?$)/, '') === asset.etag)) {
    return res.status(304).end();
  }
  res.setHeader('Content-Type', asset.contentType);
  if (req.method === 'HEAD') {
    return res.end();
  }
  const enc = negotiateEncoding(req);
  if (enc === 'br' && asset.brotli) {
    res.setHeader('Content-Encoding', 'br');
    res.setHeader('Content-Length', String(asset.brotli.length));
    return res.end(asset.brotli);
  }
  if (enc === 'gzip' && asset.gzip) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', String(asset.gzip.length));
    return res.end(asset.gzip);
  }
  res.setHeader('Content-Length', String(asset.raw.length));
  return res.end(asset.raw);
}

const {
  createAuthApi,
  hashSessionToken,
  parseCookies,
  getRequestManagerSessionToken,
  isHttps
} = require('./routes/auth-api');
const { resolveClientIp, isTrustedProxyRequest } = require('../services/captcha');

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
  app.set('trust proxy', 1);

  app.use((req, _res, next) => {
    req.clientIp = resolveClientIp(req);
    next();
  });

  // Shared active sessions map in memory (TTL synced with DB)
  const activeSessions = new Map();

  function pruneExpiredSessions(maxEntries = 500) {
    if (activeSessions.size <= maxEntries) return;
    const now = Date.now();
    for (const [key, entry] of activeSessions.entries()) {
      if (!entry || (entry.expiresAt && Number(entry.expiresAt) <= now)) {
        activeSessions.delete(key);
      }
    }
    while (activeSessions.size > maxEntries) {
      const oldestKey = activeSessions.keys().next().value;
      if (oldestKey === undefined) break;
      activeSessions.delete(oldestKey);
    }
  }

  function cacheSession(tokenHash, sessionData) {
    pruneExpiredSessions();
    activeSessions.set(tokenHash, sessionData);
  }

  function safeScalar(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val);
    return '';
  }

  // Helper to check worker bot secret
  function isBotSecretRequest(req) {
    const incoming = safeScalar(req?.headers?.['x-bot-secret'] || req?.headers?.['x-worker-secret']).trim();
    if (!incoming) return false;

    const path = safeScalar(req?.originalUrl || req?.path);
    const isWorkerRoute = path.startsWith('/api/worker') ||
                          path.startsWith('/api/v1/workers') ||
                          path.startsWith('/api/auth/verify-bot-access');

    const globalSecret = String(config.botSecretKey || '').trim();
    if (globalSecret && timingSafeStringEquals(incoming, globalSecret)) {
      const clientIp = req.clientIp || resolveClientIp(req);
      if (!isWorkerRoute) {
        logger?.warn?.('GLOBAL_BOT_SECRET_BLOCKED', { path, ip: clientIp });
        return false;
      }
      logger?.warn?.('GLOBAL_BOT_SECRET_USED', { path, ip: clientIp });
      return true;
    }

    const botId = safeScalar(
      req?.headers?.['x-manager-bot-id'] ??
      req?.body?.workerId ??
      req?.body?.botId ??
      req?.query?.botId ??
      req?.params?.workerId
    ).trim();
    if (botId && typeof registry.verifyBotSecretSync === 'function') {
      return registry.verifyBotSecretSync(botId, incoming);
    }
    return false;
  }

  // 1. Lightweight Zero-Dependency Brotli/Gzip Compression Middleware (saves ~85-90% outbound bandwidth)
  app.use((req, res, next) => {
    const preferredEncoding = negotiateEncoding(req);
    const originalSend = res.send;
    res.send = function (body) {
      if (res.headersSent || !body || req.method === 'HEAD' || [204, 304].includes(res.statusCode)) {
        return originalSend.call(this, body);
      }
      let contentType = String(res.getHeader('Content-Type') || '').toLowerCase();
      if (!contentType && typeof body === 'string') {
        contentType = 'text/html; charset=utf-8';
        res.setHeader('Content-Type', contentType);
      }
      const isCompressible = contentType.includes('json') ||
                             contentType.includes('html') ||
                             contentType.includes('text') ||
                             contentType.includes('javascript') ||
                             contentType.includes('css');
      if (!isCompressible) return originalSend.call(this, body);
      res.vary('Accept-Encoding');
      if (!preferredEncoding || res.getHeader('Content-Encoding')) return originalSend.call(this, body);
      let buffer;
      try {
        buffer = Buffer.isBuffer(body)
          ? body
          : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      } catch (_) {
        return originalSend.call(this, body);
      }
      if (buffer.length < 512) return originalSend.call(this, body);
      if (preferredEncoding === 'br' && typeof zlib.brotliCompress === 'function') {
        zlib.brotliCompress(buffer, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT
          }
        }, (error, compressed) => {
          if (res.headersSent || res.destroyed) return;
          if (error) return originalSend.call(res, body);
          res.setHeader('Content-Encoding', 'br');
          res.removeHeader('Content-Length');
          originalSend.call(res, compressed);
        });
        return this;
      }
      zlib.gzip(buffer, { level: 5 }, (error, compressed) => {
        if (res.headersSent || res.destroyed) return;
        if (error) return originalSend.call(res, body);
        res.setHeader('Content-Encoding', 'gzip');
        res.removeHeader('Content-Length');
        originalSend.call(res, compressed);
      });
      return this;
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
    res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; img-src 'self' data: https: blob:; media-src 'self' https: data: blob:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self';");

    if (isHttps(req, config?.publicBaseUrl)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    if (req.path.startsWith('/api/') || req.path === '/health' || req.path === '/ready') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  // 2.5 Static GUI Textures Route (mounted BEFORE session auth so 32x32 PNGs never trigger DB queries!)
  const texturesCandidates = [
    process.env.TEXTURES_DIR,
    path.resolve(__dirname, '../../public/textures'),
    path.resolve(process.cwd(), 'public/textures')
  ].filter(Boolean);

  const texturesPath = texturesCandidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch (_) {
      return false;
    }
  });

  if (texturesPath) {
    app.use(
      '/textures',
      express.static(texturesPath, {
        maxAge: 2592000000,
        setHeaders: (res) => {
          res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
        }
      })
    );
  }

  // 2.6 Content-Hashed Static Dashboard CSS/JS Assets (BW-01: immutable 1-year cache, 0 DB hits, Brotli+Gzip)
  app.get(DASHBOARD_CSS_PATH, (req, res) => {
    return sendPrecompressed(req, res, PRECOMPRESSED_DASHBOARD_CSS, {
      varyHeader: 'Accept-Encoding',
      cacheControl: 'public, max-age=31536000, immutable'
    });
  });

  app.get(DASHBOARD_JS_PATH, (req, res) => {
    return sendPrecompressed(req, res, PRECOMPRESSED_DASHBOARD_JS, {
      varyHeader: 'Accept-Encoding',
      cacheControl: 'public, max-age=31536000, immutable'
    });
  });

  // 3. Body Parsers
  app.use(express.json({ limit: '512kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));

  // 4. CSRF Protection for Browser State-Changing Requests
  function resolveExpectedOrigin(req) {
    const rawHost = String(req.headers['host'] || '').trim();
    if (!rawHost) return '';
    let scheme = 'http';
    if (req.secure === true || req.socket?.encrypted === true) {
      scheme = 'https';
    } else if (isTrustedProxyRequest(req)) {
      const xfProtoRaw = String(req.headers['x-forwarded-proto'] || '').trim();
      const parts = xfProtoRaw ? xfProtoRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
      const lastProto = parts[parts.length - 1] || '';
      if (lastProto === 'https') {
        scheme = 'https';
      } else if (lastProto === 'http') {
        scheme = 'http';
      } else {
        const cfVisitor = String(req.headers['cf-visitor'] || '');
        if (cfVisitor.includes('"https"')) scheme = 'https';
      }
    }
    if (scheme === 'http' && config?.publicBaseUrl) {
      try {
        const pub = new URL(config.publicBaseUrl);
        if (pub.protocol === 'https:' && pub.host.toLowerCase() === rawHost.toLowerCase()) {
          scheme = 'https';
        }
      } catch (_) {}
    }
    try {
      const u = new URL(`${scheme}://${rawHost}`);
      if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) return '';
      return u.origin;
    } catch (_) {
      return '';
    }
  }

  function verifyCsrfOriginOrReferer(req, res, origin, referer, host) {
    const expectedOrigin = resolveExpectedOrigin(req);
    if (!host || !expectedOrigin) {
      res.status(403).json({ ok: false, error: 'Thiếu Host header hợp lệ để xác thực nguồn yêu cầu.' });
      return false;
    }
    if (origin) {
      try {
        if (new URL(origin).origin !== expectedOrigin) {
          res.status(403).json({ ok: false, error: 'Yêu cầu bị từ chối do vi phạm bảo vệ CSRF (Origin mismatch).' });
          return false;
        }
      } catch (_) {
        res.status(403).json({ ok: false, error: 'Origin header không hợp lệ.' });
        return false;
      }
    } else if (referer) {
      try {
        if (new URL(referer).origin !== expectedOrigin) {
          res.status(403).json({ ok: false, error: 'Yêu cầu bị từ chối do vi phạm bảo vệ CSRF (Referer mismatch).' });
          return false;
        }
      } catch (_) {
        res.status(403).json({ ok: false, error: 'Referer header không hợp lệ.' });
        return false;
      }
    }
    return true;
  }

  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (isBotSecretRequest(req)) return next();

      if (
        req.path === '/api/auth/register' ||
        req.path === '/api/auth/verify-bot-access' ||
        req.path === '/api/rewards/link4m/return' ||
        req.path === '/api/rewards/link4m/verify'
      ) {
        return next();
      }

      const cookies = parseCookies(req);
      const hasSessionCookie = Boolean(cookies.kingmc_mgr_session);
      const origin = req.headers['origin'];
      const referer = req.headers['referer'];
      const host = String(req.headers['host'] || '').trim();
      const secFetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();

      if (req.path === '/api/auth/logout' && !hasSessionCookie) {
        return next();
      }

      if (req.path === '/api/auth/login') {
        if (secFetchSite === 'cross-site') {
          return res.status(403).json({ ok: false, error: 'Yêu cầu bị từ chối do vi phạm bảo vệ CSRF (cross-site).' });
        }
        if ((origin || referer) && !verifyCsrfOriginOrReferer(req, res, origin, referer, host)) {
          return;
        }
        return next();
      }

      if (!hasSessionCookie && (req.path.startsWith('/api/worker/') || req.path.startsWith('/api/v1/workers/'))) {
        const authHeader = String(req.headers['authorization'] || '');
        const hasBearer = /^Bearer\s+\S+/i.test(authHeader);
        if (isBotSecretRequest(req) || hasBearer) {
          return next();
        }
      }

      if (hasSessionCookie && !host) {
        return res.status(403).json({ ok: false, error: 'Thiếu Host header để xác thực nguồn yêu cầu.' });
      }

      if (hasSessionCookie && secFetchSite === 'cross-site') {
        return res.status(403).json({ ok: false, error: 'Yêu cầu bị từ chối do vi phạm bảo vệ CSRF (cross-site).' });
      }

      if (hasSessionCookie && !origin && !referer) {
        return res.status(403).json({ ok: false, error: 'Yêu cầu từ trình duyệt thiếu header xác thực nguồn (Origin/Referer).' });
      }

      if ((origin || referer) && !verifyCsrfOriginOrReferer(req, res, origin, referer, host)) {
        return;
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

  const gracePeriodMs = Number.isFinite(config?.botExpirationGraceHours)
    ? config.botExpirationGraceHours * 3600 * 1000
    : (entitlementService?.gracePeriodMs !== undefined
        ? entitlementService.gracePeriodMs
        : (process.env.BOT_EXPIRATION_GRACE_HOURS !== undefined && !Number.isNaN(Number(process.env.BOT_EXPIRATION_GRACE_HOURS))
            ? Number(process.env.BOT_EXPIRATION_GRACE_HOURS) * 3600 * 1000
            : 6 * 60 * 60 * 1000));

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
    const expiryTime = effExpiresAt ? Date.parse(effExpiresAt) : null;
    const isPastExpires = !targetSession.isPermanent && Number.isFinite(expiryTime) && expiryTime <= Date.now();

    if (rawStatus === 'disabled') {
      targetSession.status = 'disabled';
      targetSession.inGracePeriod = false;
    } else if (isPastExpires) {
      if (Date.now() <= expiryTime + gracePeriodMs) {
        targetSession.status = 'grace_period';
        targetSession.inGracePeriod = true;
      } else {
        targetSession.status = 'expired';
        targetSession.inGracePeriod = false;
      }
    } else if (rawStatus === 'expired') {
      targetSession.status = 'expired';
      targetSession.inGracePeriod = false;
    } else if (rawStatus === 'grace_period') {
      targetSession.status = 'grace_period';
      targetSession.inGracePeriod = true;
    } else {
      targetSession.status = 'active';
      targetSession.inGracePeriod = false;
    }
  }

  const READ_POLL_AUTH_CACHE_TTL_MS = Math.max(0, Number(config?.sessionAuthCacheTtlMs ?? 15000) || 0);
  function isCacheablePollRead(req) {
    if (req.method !== 'GET' || READ_POLL_AUTH_CACHE_TTL_MS <= 0) return false;
    const p = String(req.path || '');
    return /^\/api\/(?:manager|user)\/(?:bots|announcement|bot\/[^/]+\/(?:snapshot|logs|chat-logs))$/.test(p);
  }

  // 5. Dynamic Session Authentication Middleware
  app.use((req, _res, next) => {
    Promise.resolve((async () => {
    req.managerAuthChecked = true;
    req.managerAuthSession = null;

    if (isBotSecretRequest(req) ||
        req.path.startsWith('/api/worker/') ||
        req.path.startsWith('/api/v1/workers/') ||
        req.path === '/health' ||
        req.path === '/ready' ||
        req.path === '/api/ready') {
      return next();
    }

    const rawToken = getRequestManagerSessionToken(req);
    if (!rawToken) return next();

    const tokenHash = hashSessionToken(rawToken);
    const cachedSession = activeSessions.get(tokenHash) || null;
    const useDbAuth = typeof store.adapter?.fetchManagerAuthorization === 'function' &&
      (typeof store.adapter.isEnabled !== 'function' || store.adapter.isEnabled());
    const isEnvAdminCached = Boolean(
      cachedSession &&
      cachedSession.role === 'admin' &&
      !String(cachedSession.userId || '').toLowerCase().startsWith('usr_') &&
      (!useDbAuth || (isCacheablePollRead(req) && cachedSession._authVerifiedAt && Date.now() - cachedSession._authVerifiedAt < READ_POLL_AUTH_CACHE_TTL_MS))
    );
    let session = null;

    if (isEnvAdminCached) {
      if (Number(cachedSession.expiresAt) <= Date.now()) {
        activeSessions.delete(tokenHash);
      } else {
        session = cachedSession;
      }
    } else if (
      cachedSession &&
      isCacheablePollRead(req) &&
      Number(cachedSession.expiresAt) > Date.now() &&
      cachedSession._authVerifiedAt &&
      (Date.now() - cachedSession._authVerifiedAt < READ_POLL_AUTH_CACHE_TTL_MS)
    ) {
      session = cachedSession;
    } else if (useDbAuth) {
      try {
        const authData = await store.adapter.fetchManagerAuthorization(tokenHash);
        const dbSession = authData?.ok ? authData.session : null;
        const dbUser = authData?.ok ? authData.user : null;

        if (dbSession && Number(dbSession.expiresAt) > Date.now()) {
          if (dbSession.role === 'admin') {
            session = { ...dbSession, _authVerifiedAt: Date.now() };
            cacheSession(tokenHash, session);
          } else if (
            dbUser &&
            String(dbUser.status || '').toLowerCase() !== 'disabled' &&
            (!dbUser.id || !dbSession.userId || String(dbUser.id) === String(dbSession.userId)) &&
            (!dbUser.username || !dbSession.username || String(dbUser.username).toLowerCase() === String(dbSession.username).toLowerCase())
          ) {
            // read_manager_authorization already returned the authoritative fresh DB user row;
            // no redundant store.getAccess(bypassCache: true) query needed!
            const candidate = { ...dbSession, _authVerifiedAt: Date.now() };
            applyFreshAccessToSession(candidate, dbUser);
            session = candidate;
          }
        }
      } catch (_) {
        session = null;
      }

      if (session) {
        cacheSession(tokenHash, session);
      } else {
        activeSessions.delete(tokenHash);
        if (cachedSession && typeof store.invalidateUserCache === 'function') {
          store.invalidateUserCache(cachedSession.userId, cachedSession.username);
        }
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
            if (typeof store.invalidateUserCache === 'function') {
              store.invalidateUserCache(cachedSession.userId, cachedSession.username);
            }
            session = null;
          } else {
            applyFreshAccessToSession(cachedSession, userRec);
            cachedSession._authVerifiedAt = Date.now();
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
    })()).catch(next);
  });

  // 6. Root SPA Route (Login view if unauthenticated, Dashboard shell if authenticated)
  app.get('/', (req, res) => {
    const view = req.managerAuthSession ? PRECOMPRESSED_DASHBOARD : PRECOMPRESSED_LOGIN;
    return sendPrecompressed(req, res, view, {
      varyHeader: 'Accept-Encoding, Cookie',
      cacheControl: 'private, no-cache'
    });
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

  // 6.2 Readiness Probe (validates Database connectivity and Discord Gateway; DB probe cached 10s)
  let readyDbCache = null;
  app.get(['/ready', '/api/ready'], async (_req, res) => {
    let dbOk = true;
    let dbLatencyMs = 0;
    if (store?.adapter && typeof store.adapter.testConnection === 'function') {
      const now = Date.now();
      if (readyDbCache && (now - readyDbCache.checkedAt < 10000)) {
        dbOk = readyDbCache.ok;
        dbLatencyMs = readyDbCache.latencyMs;
      } else {
        const start = Date.now();
        try {
          const testRes = await store.adapter.testConnection();
          dbOk = Boolean(testRes?.ok);
          dbLatencyMs = Date.now() - start;
        } catch (_) {
          dbOk = false;
        }
        readyDbCache = { ok: dbOk, latencyMs: dbLatencyMs, checkedAt: Date.now() };
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
  app._authRouter = authRouter;
  app.use('/api/auth', authRouter);

  const userRouter = createUserApi({
    store,
    entitlementService,
    link4mService,
    registry,
    broker,
    fleetOperations,
    config,
    logger,
    invalidateUserSessions
  });
  app.use('/api/manager', userRouter);
  app.use('/api/rewards/link4m', userRouter);
  app.use('/api/public', userRouter);
  app.use('/api/user', userRouter);
  app.use('/api', userRouter);

  function invalidateAdminSessions(excludeTokenHash = null) {
    let removed = 0;
    for (const [hash, cached] of activeSessions.entries()) {
      if (cached && cached.role === 'admin' && (!excludeTokenHash || hash !== excludeTokenHash)) {
        activeSessions.delete(hash);
        removed += 1;
      }
    }
    return removed;
  }

  const adminRouter = createAdminApi({
    store,
    entitlementService,
    link4mService,
    registry,
    broker,
    fleetOperations,
    adminNotifier,
    config,
    logger,
    invalidateUserSessions,
    invalidateAdminSessions
  });
  app.use('/api/admin', adminRouter);
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
    if (err instanceof TypeError && /Cannot convert object to primitive value/i.test(err.message || '')) {
      return res.status(400).json({ ok: false, error: 'Tham số yêu cầu không hợp lệ.' });
    }
    logger?.error('HTTP Server Error', { error: err?.message, stack: err?.stack });
    return res.status(500).json({ ok: false, error: 'internal_server_error' });
  });

  app.invalidateAdminSessions = invalidateAdminSessions;
  app.invalidateUserSessions = invalidateUserSessions;

  return app;
}

module.exports = { createApp };
