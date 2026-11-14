'use strict';

const crypto = require('node:crypto');
const express = require('express');
const {
  hashPassword,
  encryptUserPassword,
  decryptUserPassword,
  verifyUserPassword,
  verifyAdminPassword,
  hashAdminPassword,
  timingSafeStringEquals
} = require('../../utils/secrets');

function hashSessionToken(token) {
  if (!token || typeof token !== 'string') return '';
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers?.cookie;
  if (!rc) return list;
  for (const cookie of rc.split(';')) {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    const rawValue = parts.join('=');
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch (_) {}
    if (key) list[key] = value;
  }
  return list;
}

function getRequestManagerSessionToken(req) {
  const authHeader = String(req?.headers?.authorization || '');
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return String(parseCookies(req).kingmc_mgr_session || '').trim();
}

function isHttps(req) {
  return !!(req.secure || req.headers['x-forwarded-proto'] === 'https');
}

function serializeCookie(name, value, options = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
  if (options.secure) cookie += `; Secure`;
  return cookie;
}

function clearCookieHeader(name, secure = false) {
  let cookie = `${name}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0`;
  if (secure) cookie += `; Secure`;
  return cookie;
}

function createAuthApi({ store, entitlementService, registry, config, logger, activeSessions }) {
  const router = express.Router();
  const sessionDurationMs = (Number.isSafeInteger(Number(config?.webSessionTtlHours)) && Number(config.webSessionTtlHours) > 0)
    ? Number(config.webSessionTtlHours) * 3600 * 1000
    : (Number.isSafeInteger(Number(config?.sessionTtlDays)) && Number(config.sessionTtlDays) > 0
      ? Number(config.sessionTtlDays) * 24 * 3600 * 1000
      : 24 * 3600 * 1000);
  const cookieMaxAge = Math.floor(sessionDurationMs / 1000);

  // In-memory brute-force protection
  const MAX_RATE_LIMIT_ENTRIES = (config && Number.isSafeInteger(Number(config.maxRateLimitEntries)) && Number(config.maxRateLimitEntries) > 0)
    ? Number(config.maxRateLimitEntries)
    : 5000;
  const RATE_LIMIT_WINDOW_MS = (config && Number.isSafeInteger(Number(config.loginWindowMs)) && Number(config.loginWindowMs) > 0)
    ? Number(config.loginWindowMs)
    : (15 * 60 * 1000);
  const MAX_LOGIN_ATTEMPTS = (config && Number.isSafeInteger(Number(config.maxLoginAttempts)) && Number(config.maxLoginAttempts) > 0)
    ? Number(config.maxLoginAttempts)
    : 10;
  const loginAttempts = new Map();

  function checkRateLimit(ip, username) {
    const now = Date.now();
    const key = `${ip}:${String(username).toLowerCase()}`;
    const record = loginAttempts.get(key);
    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      if (loginAttempts.size >= MAX_RATE_LIMIT_ENTRIES) {
        // a) purge expired entries
        for (const [k, v] of loginAttempts.entries()) {
          if (now - v.windowStart > RATE_LIMIT_WINDOW_MS) loginAttempts.delete(k);
        }
        // b) if still at capacity, evict oldest entry (FIFO via loginAttempts.keys().next().value)
        if (loginAttempts.size >= MAX_RATE_LIMIT_ENTRIES) {
          const oldestKey = loginAttempts.keys().next().value;
          if (oldestKey) loginAttempts.delete(oldestKey);
        }
      }
      loginAttempts.set(key, { count: 1, windowStart: now });
      return { allowed: true };
    }
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
      const waitMinutes = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStart)) / 60000);
      return { allowed: false, error: `Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau ${waitMinutes} phút.` };
    }
    record.count++;
    return { allowed: true };
  }

  function resetRateLimit(ip, username) {
    const key = `${ip}:${String(username).toLowerCase()}`;
    loginAttempts.delete(key);
  }

  // Periodic cleanup of rate limiter map
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of loginAttempts.entries()) {
      if (now - val.windowStart > RATE_LIMIT_WINDOW_MS) loginAttempts.delete(key);
    }
  }, 5 * 60 * 1000).unref();

  // 1. REGISTER
  router.post('/register', async (req, res) => {
    try {
      const { username, password, confirmPassword, key: rawKey } = req.body || {};
      const cleanUsername = String(username || '').trim();
      const cleanPassword = String(password || '');
      const cleanConfirm = String(confirmPassword || '');
      const providedKey = String(rawKey || '').trim();

      if (!/^[a-zA-Z0-9_]{3,32}$/.test(cleanUsername)) {
        return res.status(400).json({ ok: false, error: 'Tên đăng nhập phải từ 3 đến 32 ký tự, chỉ gồm chữ, số và dấu gạch dưới.' });
      }
      if (cleanPassword.length < 6) {
        return res.status(400).json({ ok: false, error: 'Mật khẩu phải có ít nhất 6 ký tự.' });
      }
      if (cleanPassword !== cleanConfirm) {
        return res.status(400).json({ ok: false, error: 'Mật khẩu xác nhận không khớp.' });
      }

      if (cleanUsername.toLowerCase() === 'admin' || cleanUsername.toLowerCase() === String(config.adminUsername || '').toLowerCase()) {
        return res.status(400).json({ ok: false, error: 'Tên tài khoản này được bảo lưu cho Quản trị viên.' });
      }

      const existing = await store.getUser(cleanUsername);
      if (existing) {
        return res.status(409).json({ ok: false, error: 'Tên đăng nhập này đã có người sử dụng.' });
      }

      const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
      const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
      const hashedPassword = hashPassword(cleanPassword);

      // Register user with atomic Free Trial allocation
      let registered;
      try {
        if (typeof store.registerTrialUser === 'function') {
          registered = await store.registerTrialUser({
            userId,
            username: cleanUsername,
            password: hashedPassword,
            trialDays: config.trialDays || 1,
            planName: 'FREE TRIAL'
          });
        } else {
          const newUser = {
            id: userId,
            userId,
            username: cleanUsername,
            password: hashedPassword,
            role: 'user',
            status: 'active',
            isPermanent: false,
            isTrial: true,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            planName: 'FREE TRIAL',
            workerIds: [],
            assignedBotIds: [],
            note: 'Đăng ký tài khoản Web',
            createdAt: new Date().toISOString()
          };
          await store.setAccess(userId, newUser, 'system-register');
          registered = { ok: true, userId, username: cleanUsername, planName: 'FREE TRIAL', workerId: null };
        }
      } catch (regErr) {
        if (regErr.message && regErr.message.includes('NO_WORKERS_AVAILABLE')) {
          return res.status(503).json({
            ok: false,
            error: 'Hiện tại hệ thống không còn Bot rảnh để cấp dùng thử. Vui lòng liên hệ Quản trị viên hoặc thử lại sau.'
          });
        }
        if (regErr.message && regErr.message.includes('đã có người sử dụng')) {
          return res.status(409).json({ ok: false, error: 'Tên đăng nhập này đã có người sử dụng.' });
        }
        throw regErr;
      }

      let assignedBotIds = registered?.workerId ? [registered.workerId] : [];
      let planName = registered?.planName || 'FREE TRIAL';
      let isPermanent = false;

      // If a giftcode/key was provided, redeem it
      let keyRedeemed = false;
      let keyError = null;
      if (providedKey) {
        try {
          await entitlementService.redeem(userId, providedKey, 'user');
          keyRedeemed = true;
          const refreshed = await store.getUser(cleanUsername);
          if (refreshed) {
            assignedBotIds = refreshed.assignedBotIds || refreshed.workerIds || assignedBotIds;
            planName = refreshed.planName || planName;
            isPermanent = Boolean(refreshed.isPermanent);
          }
        } catch (keyErr) {
          keyRedeemed = false;
          keyError = keyErr.message || 'Mã quà tặng không hợp lệ hoặc đã hết lượt.';
          logger.warn('Key redemption on register failed', { error: keyError, username: cleanUsername });
        }
      }

      // Generate session
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(token);
      const expiresAt = Date.now() + sessionDurationMs;

      const session = {
        tokenHash,
        userId,
        username: cleanUsername,
        role: 'user',
        assignedBotIds,
        createdAt: Date.now(),
        expiresAt,
        status: 'active',
        isPermanent,
        planName,
        allowAccountChange: true
      };

      activeSessions.set(tokenHash, session);
      const dbAdapterEnabled = typeof store.adapter?.isEnabled !== 'function' || store.adapter.isEnabled();
      if (typeof store.adapter?.createManagerUserSession === 'function' && dbAdapterEnabled) {
        try {
          const persistRes = await store.adapter.createManagerUserSession(session, 1);
          if (!persistRes || (typeof persistRes === 'object' && persistRes.ok === false)) {
            activeSessions.delete(tokenHash);
            return res.status(503).json({
              ok: false,
              error: 'database_unavailable',
              message: 'Lưu trữ phiên đăng nhập thất bại. Vui lòng thử lại sau.'
            });
          }
        } catch (dbErr) {
          activeSessions.delete(tokenHash);
          logger.error('Failed to persist session to DB on register', { error: dbErr.message, username: cleanUsername });
          return res.status(503).json({
            ok: false,
            error: 'database_unavailable',
            message: 'Dịch vụ lưu trữ session tạm thời không khả dụng. Vui lòng thử lại sau.'
          });
        }
      }

      await store.addAudit({
        action: 'AUTH_REGISTER',
        targetId: userId,
        actorId: cleanUsername,
        details: { ip: clientIp, username: cleanUsername }
      });

      res.setHeader('Set-Cookie', serializeCookie('kingmc_mgr_session', token, { maxAge: cookieMaxAge, secure: isHttps(req) }));
      const responsePayload = {
        ok: true,
        token,
        user: {
          id: userId,
          username: cleanUsername,
          role: 'user',
          assignedBotIds,
          isPermanent,
          expiresAt: session.expiresAt
        },
        message: (providedKey && !keyRedeemed)
          ? `Đăng ký tài khoản thành công, nhưng kích hoạt mã quà tặng thất bại: ${keyError}`
          : 'Đăng ký tài khoản thành công!'
      };
      if (providedKey) {
        responsePayload.keyRedeemed = keyRedeemed;
        if (!keyRedeemed) {
          responsePayload.keyError = keyError;
        }
      }
      return res.status(201).json(responsePayload);
    } catch (error) {
      logger.error('Registration failed', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Đăng ký thất bại: ' + error.message });
    }
  });

  // 2. LOGIN
  router.post('/login', async (req, res) => {
    try {
      const { username, password, key: rawKey } = req.body || {};
      const cleanUsername = String(username || '').trim();
      const cleanPassword = String(password || '');
      const providedKey = String(rawKey || '').trim();
      const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';

      const rateCheck = checkRateLimit(clientIp, cleanUsername);
      if (!rateCheck.allowed) {
        return res.status(429).json({ ok: false, error: rateCheck.error });
      }

      // A. Check Admin Login
      const adminUsername = String(config.adminUsername || 'admin').trim();
      if (cleanUsername.toLowerCase() === adminUsername.toLowerCase()) {
        const storedAdminPass = registry.getAdminPassword() || config.adminPassword;
        if (!storedAdminPass) {
          return res.status(403).json({ ok: false, error: 'Tài khoản Quản trị viên chưa được cấu hình mật khẩu hệ thống (ADMIN_PASSWORD).' });
        }
        const isMatch = verifyAdminPassword(cleanPassword, storedAdminPass);
        if (isMatch) {
          resetRateLimit(clientIp, cleanUsername);
          const token = crypto.randomBytes(32).toString('hex');
          const tokenHash = hashSessionToken(token);
          const expiresAt = Date.now() + sessionDurationMs;
          const session = {
            tokenHash,
            userId: 'admin',
            username: 'admin',
            role: 'admin',
            assignedBotIds: null,
            createdAt: Date.now(),
            expiresAt,
            status: 'active',
            isPermanent: true,
            planName: 'Enterprise Admin',
            allowAccountChange: true
          };

          activeSessions.set(tokenHash, session);
          const dbAdapterEnabled = typeof store.adapter?.isEnabled !== 'function' || store.adapter.isEnabled();
          if (typeof store.adapter?.createManagerUserSession === 'function' && dbAdapterEnabled) {
            try {
              const persistRes = await store.adapter.createManagerUserSession(session, 1);
              if (!persistRes || (typeof persistRes === 'object' && persistRes.ok === false)) {
                activeSessions.delete(tokenHash);
                return res.status(503).json({
                  ok: false,
                  error: 'database_unavailable',
                  message: 'Lưu trữ phiên đăng nhập quản trị thất bại. Vui lòng thử lại sau.'
                });
              }
            } catch (dbErr) {
              activeSessions.delete(tokenHash);
              logger.error('Failed to persist admin session to DB on login', { error: dbErr.message });
              return res.status(503).json({
                ok: false,
                error: 'database_unavailable',
                message: 'Dịch vụ lưu trữ session tạm thời không khả dụng. Vui lòng thử lại sau.'
              });
            }
          }

          await store.addAudit({
            action: 'AUTH_ADMIN_LOGIN',
            targetId: 'admin',
            actorId: 'admin',
            details: { ip: clientIp }
          });

          res.setHeader('Set-Cookie', serializeCookie('kingmc_mgr_session', token, { maxAge: cookieMaxAge, secure: isHttps(req) }));
          return res.json({
            ok: true,
            token,
            user: {
              username: 'admin',
              role: 'admin',
              assignedBotIds: null
            },
            message: 'Đăng nhập thành công với quyền Quản trị viên (ADMIN)!'
          });
        }
      }

      // B. Check Regular User Login
      const user = await store.getUser(cleanUsername, { bypassCache: true });
      if (!user) {
        return res.status(401).json({ ok: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
      }

      const passMatch = verifyUserPassword(cleanPassword, user.password);
      if (!passMatch) {
        return res.status(401).json({ ok: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
      }

      resetRateLimit(clientIp, cleanUsername);

      if (user.status === 'disabled') {
        return res.status(403).json({ ok: false, error: 'Tài khoản của bạn đã bị vô hiệu hóa hoặc khóa bởi Quản trị viên.' });
      }

      const userId = String(user.id || user.userId || cleanUsername);

      // AUTH-01: Auto-migrate legacy AES passwords to scrypt on successful login
      if (!String(user.password || '').startsWith('scrypt$')) {
        try {
          const migratedHash = hashPassword(cleanPassword);
          await store.setAccess(userId, { ...user, password: migratedHash }, 'auth-migrate-scrypt');
          user.password = migratedHash;
          if (typeof store.invalidateCache === 'function') store.invalidateCache();
          logger.info?.('User password auto-migrated to scrypt', { userId, username: cleanUsername });
        } catch (migErr) {
          logger.warn?.('Password auto-migration to scrypt failed', { userId, error: migErr.message });
        }
      }

      // Redeem key if provided
      let keyRedeemed = false;
      let keyError = null;
      if (providedKey) {
        try {
          await entitlementService.redeem(userId, providedKey, 'user');
          keyRedeemed = true;
        } catch (keyErr) {
          keyRedeemed = false;
          keyError = keyErr.message || 'Mã quà tặng không hợp lệ hoặc đã hết lượt.';
          logger.warn('Key redeem during login failed', { error: keyError, user: cleanUsername });
        }
      }

      // Refresh user details after key redemption
      const updatedAccess = await store.getAccess(userId);
      const assignedIds = Array.isArray(updatedAccess?.workerIds)
        ? updatedAccess.workerIds.map(Number).filter(n => Number.isFinite(n))
        : (Array.isArray(user.assignedBotIds) ? user.assignedBotIds.map(Number) : []);

      const isPermanent = Boolean(updatedAccess?.isPermanent ?? user.isPermanent);
      const expiresAtDate = updatedAccess?.expiresAt || user.expiresAt;
      const isExpired = !isPermanent && expiresAtDate && Date.parse(expiresAtDate) <= Date.now();

      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(token);
      const expiresAt = Date.now() + sessionDurationMs;

      const session = {
        tokenHash,
        userId,
        username: cleanUsername,
        role: 'user',
        assignedBotIds: assignedIds,
        createdAt: Date.now(),
        expiresAt,
        status: isExpired ? 'expired' : 'active',
        isPermanent,
        planName: updatedAccess?.planName || user.planName || 'Gói thường',
        expiresAtRental: expiresAtDate,
        allowAccountChange: user.allowAccountChange !== false
      };

      activeSessions.set(tokenHash, session);
      const dbAdapterEnabled = typeof store.adapter?.isEnabled !== 'function' || store.adapter.isEnabled();
      if (typeof store.adapter?.createManagerUserSession === 'function' && dbAdapterEnabled) {
        try {
          const persistRes = await store.adapter.createManagerUserSession(session, 1);
          if (!persistRes || (typeof persistRes === 'object' && persistRes.ok === false)) {
            activeSessions.delete(tokenHash);
            return res.status(503).json({
              ok: false,
              error: 'database_unavailable',
              message: 'Lưu trữ phiên đăng nhập thất bại. Vui lòng thử lại sau.'
            });
          }
        } catch (dbErr) {
          activeSessions.delete(tokenHash);
          logger.error('Failed to persist session to DB on login', { error: dbErr.message, username: cleanUsername });
          return res.status(503).json({
            ok: false,
            error: 'database_unavailable',
            message: 'Dịch vụ lưu trữ session tạm thời không khả dụng. Vui lòng thử lại sau.'
          });
        }
      }

      if (typeof store.invalidateCache === 'function') store.invalidateCache();

      await store.addAudit({
        action: 'AUTH_USER_LOGIN',
        targetId: userId,
        actorId: cleanUsername,
        details: { ip: clientIp, isExpired, isPermanent }
      });

      res.setHeader('Set-Cookie', serializeCookie('kingmc_mgr_session', token, { maxAge: cookieMaxAge, secure: isHttps(req) }));
      const responsePayload = {
        ok: true,
        token,
        user: {
          id: userId,
          username: cleanUsername,
          role: 'user',
          assignedBotIds: assignedIds,
          isPermanent,
          expiresAt: expiresAtDate,
          status: session.status,
          planName: session.planName
        },
        message: 'Đăng nhập thành công!'
      };
      if (providedKey) {
        responsePayload.keyRedeemed = keyRedeemed;
        if (!keyRedeemed) {
          responsePayload.keyError = keyError;
        }
      }
      return res.json(responsePayload);
    } catch (error) {
      logger.error('Login error', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Đăng nhập thất bại: ' + error.message });
    }
  });

  // 3. LOGOUT
  router.post('/logout', async (req, res) => {
    try {
      const token = getRequestManagerSessionToken(req);
      const correlationId = req.headers?.['x-correlation-id'] || req.headers?.['x-request-id'] || `corr_${crypto.randomUUID().slice(0, 8)}`;
      if (token) {
        const tokenHash = hashSessionToken(token);
        activeSessions.delete(tokenHash);
        if (typeof store.adapter?.deleteSession === 'function') {
          try {
            const deleted = await store.adapter.deleteSession(tokenHash);
            if (!deleted) {
              logger.warn('Failed to revoke session from database on logout', { correlationId, tokenHash });
            }
          } catch (dbErr) {
            logger.warn('Failed to revoke session from database on logout', { correlationId, tokenHash, error: dbErr.message });
          }
        }
        if (typeof store.invalidateCache === 'function') store.invalidateCache();
      }
      res.setHeader('Set-Cookie', clearCookieHeader('kingmc_mgr_session', isHttps(req)));
      return res.json({ ok: true, message: 'Đăng xuất thành công.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 3.5. PUBLIC LOGIN CONFIG
  router.get('/login-config', (_req, res) => {
    return res.json({
      ok: true,
      trialGiftEnabled: Boolean(config?.trialGiftEnabled ?? false),
      trialDays: Number(config?.trialDays || 1)
    });
  });

  // 4. ME / SESSION CHECK
  router.get('/me', (req, res) => {
    const session = req.managerAuthSession;
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Chưa đăng nhập.' });
    }
    return res.json({
      ok: true,
      user: {
        id: session.userId,
        username: session.username,
        role: session.role,
        assignedBotIds: session.assignedBotIds,
        isPermanent: session.isPermanent,
        expiresAt: session.expiresAtRental || session.expiresAt,
        status: session.status,
        planName: session.planName,
        allowAccountChange: session.allowAccountChange
      }
    });
  });

  // 5. CHANGE PASSWORD
  router.post('/change-password', async (req, res) => {
    try {
      const session = req.managerAuthSession;
      if (!session) return res.status(401).json({ ok: false, error: 'Chưa đăng nhập.' });

      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ ok: false, error: 'Vui lòng cung cấp mật khẩu cũ và mới.' });
      }
      if (String(newPassword).length < 6) {
        return res.status(400).json({ ok: false, error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
      }

      if (session.role === 'admin') {
        const storedAdminPass = registry.getAdminPassword() || config.adminPassword;
        if (!verifyAdminPassword(currentPassword, storedAdminPass)) {
          return res.status(401).json({ ok: false, error: 'Mật khẩu hiện tại của Quản trị viên không chính xác.' });
        }
        const hashed = hashAdminPassword(newPassword);
        registry.setAdminPassword(hashed);
        await registry.save();

        if (typeof store.adapter?.revokeUserSessions === 'function') {
          await store.adapter.revokeUserSessions('admin').catch(() => null);
        }
        for (const [hash, s] of activeSessions.entries()) {
          if (s && s.role === 'admin') activeSessions.delete(hash);
        }
        if (typeof store.invalidateCache === 'function') store.invalidateCache();
        res.setHeader('Set-Cookie', clearCookieHeader('kingmc_mgr_session', isHttps(req)));
        return res.json({ ok: true, message: 'Đổi mật khẩu Quản trị viên thành công. Vui lòng đăng nhập lại.' });
      }

      const user = await store.getUser(session.username);
      if (!user || !verifyUserPassword(currentPassword, user.password)) {
        return res.status(401).json({ ok: false, error: 'Mật khẩu hiện tại không chính xác.' });
      }

      const hashedPassword = hashPassword(newPassword);
      user.password = hashedPassword;
      await store.setAccess(session.userId, { ...user, password: hashedPassword }, 'user-change-password');

      if (typeof store.adapter?.revokeUserSessions === 'function') {
        await store.adapter.revokeUserSessions(session.userId || session.username).catch(() => null);
      }
      for (const [hash, s] of activeSessions.entries()) {
        if (s && (s.userId === session.userId || s.username === session.username)) {
          activeSessions.delete(hash);
        }
      }
      if (typeof store.invalidateCache === 'function') store.invalidateCache();
      res.setHeader('Set-Cookie', clearCookieHeader('kingmc_mgr_session', isHttps(req)));

      return res.json({ ok: true, message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 6. VERIFY BOT ACCESS (Internal/Worker query)
  router.post('/verify-bot-access', async (req, res) => {
    try {
      const { botId } = req.body || {};
      const incomingSecret = req.headers['x-bot-secret'] || '';
      const globalSecret = config.botSecretKey || '';

      const isGlobalAuthed = Boolean(globalSecret && timingSafeStringEquals(incomingSecret, globalSecret));
      let isAuthed = isGlobalAuthed;

      if (isGlobalAuthed) {
        logger?.warn('GLOBAL_BOT_SECRET_USED', {
          action: 'verify-bot-access',
          botId,
          ip: req.ip
        });
        if (typeof store.addAudit === 'function') {
          await store.addAudit({
            action: 'GLOBAL_BOT_SECRET_USED',
            targetId: String(botId || 'unknown'),
            actorId: 'system:global_secret',
            details: { ip: req.ip, endpoint: '/verify-bot-access' }
          }).catch(() => null);
        }
      } else {
        isAuthed = Boolean(await registry.verifyBotSecret(botId, incomingSecret));
      }

      if (!isAuthed) {
        return res.status(401).json({ ok: false, error: 'unauthorized_worker_secret' });
      }

      const assigned = await store.assignedUser(String(botId));
      return res.json({
        ok: true,
        botId,
        assignedUser: assigned || null
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router._loginAttempts = loginAttempts;
  router._checkRateLimit = checkRateLimit;

  return router;
}

module.exports = {
  createAuthApi,
  hashSessionToken,
  parseCookies,
  getRequestManagerSessionToken,
  isHttps,
  serializeCookie,
  clearCookieHeader
};
