'use strict';

const crypto = require('node:crypto');
const express = require('express');
const {
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
  const sessionDurationMs = (config.sessionTtlDays || 7) * 24 * 60 * 60 * 1000;
  const cookieMaxAge = Math.floor(sessionDurationMs / 1000);

  // In-memory brute-force protection
  const loginAttempts = new Map();
  function checkRateLimit(ip, username) {
    const now = Date.now();
    const key = `${ip}:${String(username).toLowerCase()}`;
    const record = loginAttempts.get(key);
    if (!record || now - record.windowStart > 15 * 60 * 1000) {
      loginAttempts.set(key, { count: 1, windowStart: now });
      return { allowed: true };
    }
    if (record.count >= 10) {
      const waitMinutes = Math.ceil((15 * 60 * 1000 - (now - record.windowStart)) / 60000);
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
      if (now - val.windowStart > 15 * 60 * 1000) loginAttempts.delete(key);
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

      const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
      const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
      const encryptedPass = encryptUserPassword(cleanPassword);

      // Save user record
      const newUser = {
        id: userId,
        userId,
        username: cleanUsername,
        password: encryptedPass,
        role: 'user',
        status: 'active',
        isPermanent: false,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 1 day initial trial
        planName: 'Gói dùng thử',
        workerIds: [],
        assignedBotIds: [],
        note: `Đăng ký từ IP ${clientIp}`,
        createdAt: new Date().toISOString()
      };

      await store.setAccess(userId, newUser, 'system-register');

      // If a giftcode/key was provided, redeem it
      if (providedKey) {
        try {
          await entitlementService.redeem(userId, providedKey, 'user');
        } catch (keyErr) {
          logger.warn('Key redemption on register failed', { error: keyErr.message, username: cleanUsername });
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
        assignedBotIds: newUser.assignedBotIds,
        createdAt: Date.now(),
        expiresAt,
        status: 'active',
        isPermanent: newUser.isPermanent,
        planName: newUser.planName,
        allowAccountChange: true
      };

      activeSessions.set(tokenHash, session);
      if (store.adapter?.createManagerUserSession) {
        await store.adapter.createManagerUserSession(session, 1).catch(() => false);
      }

      await store.addAudit({
        action: 'AUTH_REGISTER',
        targetId: userId,
        actorId: cleanUsername,
        details: { ip: clientIp, username: cleanUsername }
      });

      res.setHeader('Set-Cookie', serializeCookie('kingmc_mgr_session', token, { maxAge: cookieMaxAge, secure: isHttps(req) }));
      return res.status(201).json({
        ok: true,
        token,
        user: {
          id: userId,
          username: cleanUsername,
          role: 'user',
          assignedBotIds: newUser.assignedBotIds,
          isPermanent: newUser.isPermanent,
          expiresAt: newUser.expiresAt
        },
        message: 'Đăng ký tài khoản thành công!'
      });
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
      const clientIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1').split(',')[0].trim();

      const rateCheck = checkRateLimit(clientIp, cleanUsername);
      if (!rateCheck.allowed) {
        return res.status(429).json({ ok: false, error: rateCheck.error });
      }

      // A. Check Admin Login
      const adminUsername = String(config.adminUsername || 'admin').trim();
      if (cleanUsername.toLowerCase() === adminUsername.toLowerCase()) {
        const storedAdminPass = registry.getAdminPassword() || config.adminPassword || 'admin123';
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
          if (store.adapter?.createManagerUserSession) {
            await store.adapter.createManagerUserSession(session, 1).catch(() => false);
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
      const user = await store.getUser(cleanUsername);
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

      // Redeem key if provided
      if (providedKey) {
        try {
          await entitlementService.redeem(userId, providedKey, 'user');
        } catch (keyErr) {
          logger.warn('Key redeem during login failed', { error: keyErr.message, user: cleanUsername });
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
      if (store.adapter?.createManagerUserSession) {
        await store.adapter.createManagerUserSession(session, 1).catch(() => false);
      }

      await store.addAudit({
        action: 'AUTH_USER_LOGIN',
        targetId: userId,
        actorId: cleanUsername,
        details: { ip: clientIp, isExpired, isPermanent }
      });

      res.setHeader('Set-Cookie', serializeCookie('kingmc_mgr_session', token, { maxAge: cookieMaxAge, secure: isHttps(req) }));
      return res.json({
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
      });
    } catch (error) {
      logger.error('Login error', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Đăng nhập thất bại: ' + error.message });
    }
  });

  // 3. LOGOUT
  router.post('/logout', async (req, res) => {
    try {
      const token = getRequestManagerSessionToken(req);
      if (token) {
        const tokenHash = hashSessionToken(token);
        activeSessions.delete(tokenHash);
        if (store.adapter?.deleteSession) {
          await store.adapter.deleteSession(tokenHash).catch(() => false);
        }
      }
      res.setHeader('Set-Cookie', clearCookieHeader('kingmc_mgr_session', isHttps(req)));
      return res.json({ ok: true, message: 'Đăng xuất thành công.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
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
        return res.json({ ok: true, message: 'Đổi mật khẩu Quản trị viên thành công.' });
      }

      const user = await store.getUser(session.username);
      if (!user || !verifyUserPassword(currentPassword, user.password)) {
        return res.status(401).json({ ok: false, error: 'Mật khẩu hiện tại không chính xác.' });
      }

      const encrypted = encryptUserPassword(newPassword);
      user.password = encrypted;
      await store.setAccess(session.userId, { password: encrypted }, 'user-change-password');

      return res.json({ ok: true, message: 'Đổi mật khẩu thành công.' });
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

      const isAuthed = (globalSecret && timingSafeStringEquals(incomingSecret, globalSecret)) ||
                       registry.verifyBotSecret(botId, incomingSecret);

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
