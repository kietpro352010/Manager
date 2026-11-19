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
  timingSafeStringEquals,
  isStoredCredentialCiphertext
} = require('../../utils/secrets');

const {
  generateCaptcha,
  verifyCaptchaToken,
  resolveClientIp
} = require('../../services/captcha');

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
      loginAttempts.set(key, { count: 0, windowStart: now });
      return { allowed: true };
    }
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
      const waitMinutes = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStart)) / 60000);
      return { allowed: false, error: `Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau ${waitMinutes} phút.` };
    }
    return { allowed: true };
  }

  function resetRateLimit(ip, username) {
    const key = `${ip}:${String(username).toLowerCase()}`;
    loginAttempts.delete(key);
  }

  function recordFailedAttempt(ip, username) {
    const key = `${ip}:${String(username).toLowerCase()}`;
    const now = Date.now();
    const record = loginAttempts.get(key);
    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      loginAttempts.set(key, { count: 1, windowStart: now });
    } else {
      record.count++;
    }
  }

  // Periodic cleanup of rate limiter map
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of loginAttempts.entries()) {
      if (now - val.windowStart > RATE_LIMIT_WINDOW_MS) loginAttempts.delete(key);
    }
  }, 5 * 60 * 1000).unref();

  // 0. CAPTCHA
  router.get('/captcha', (_req, res) => {
    try {
      const captchaSecret = String(config.captchaSecret || config.sessionSecret || '').trim() || undefined;
      const captcha = generateCaptcha(captchaSecret);
      return res.json(captcha);
    } catch (err) {
      logger?.error?.('Failed to generate captcha', { error: err.message });
      return res.status(500).json({ ok: false, error: 'Không thể tạo mã xác thực Captcha.' });
    }
  });

  // 1. REGISTER
  router.post('/register', async (req, res) => {
    try {
      const {
        username,
        password,
        confirmPassword,
        key: rawKey,
        licenseKey: rawLicenseKey,
        captchaToken,
        captchaAnswer,
        deviceFingerprint: rawFingerprint
      } = req.body || {};
      const cleanUsername = String(username || '').trim();
      const cleanPassword = String(password || '');
      const cleanConfirm = String(confirmPassword || '');
      const providedKey = String(rawKey || rawLicenseKey || '').trim();
      const deviceFingerprint = String(rawFingerprint || '').trim();
      if (deviceFingerprint.length > 256) {
        return res.status(400).json({ ok: false, error: 'Thông tin thiết bị không hợp lệ.' });
      }

      // Validate Captcha
      const cleanCaptchaToken = String(captchaToken || '').trim();
      const cleanCaptchaAnswer = String(captchaAnswer || '').trim();
      const isCaptchaEnforced = config?.captchaRequired === true;

      if (cleanCaptchaToken || cleanCaptchaAnswer || isCaptchaEnforced) {
        if (!cleanCaptchaToken || !cleanCaptchaAnswer) {
          return res.status(400).json({ ok: false, error: 'Vui lòng nhập kết quả mã xác thực Captcha.' });
        }
        const captchaSecret = String(config.captchaSecret || config.sessionSecret || '').trim() || undefined;
        const captchaRes = verifyCaptchaToken(cleanCaptchaToken, cleanCaptchaAnswer, captchaSecret);
        if (!captchaRes.valid) {
          return res.status(400).json({ ok: false, error: captchaRes.error || 'Mã xác thực Captcha không chính xác hoặc đã hết hạn.' });
        }
      }

      if (!/^[a-zA-Z0-9_]{3,32}$/.test(cleanUsername)) {
        return res.status(400).json({ ok: false, error: 'Tên đăng nhập phải từ 3 đến 32 ký tự, chỉ gồm chữ, số và dấu gạch dưới.' });
      }
      if (cleanPassword.length < 6) {
        return res.status(400).json({ ok: false, error: 'Mật khẩu phải có ít nhất 6 ký tự.' });
      }
      if (cleanPassword.length > 256) {
        return res.status(400).json({ ok: false, error: 'Mật khẩu không được dài quá 256 ký tự.' });
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

      const clientIp = resolveClientIp(req);

      // Check Multi-Account Limits & Whitelist Exemptions
      let isExempt = false;
      if (req.managerAuthSession?.role === 'admin') {
        isExempt = true;
      }
      if (!isExempt && typeof store.isIpWhitelisted === 'function') {
        isExempt = await store.isIpWhitelisted(clientIp).catch(() => false);
      }
      if (!isExempt && typeof store.isRecentAdminIp === 'function') {
        isExempt = await store.isRecentAdminIp(clientIp).catch(() => false);
      }
      if (!isExempt && providedKey && typeof store.getKey === 'function') {
        try {
          const keyRow = await store.getKey(providedKey);
          if (keyRow) {
            const statusLower = String(keyRow.status || 'unused').toLowerCase();
            const maxUses = Number(keyRow.maxUses ?? keyRow.max_uses ?? 1);
            const usedCount = Number(keyRow.usedCount ?? keyRow.used_count ?? 0);
            const isExhausted = maxUses > 0 && usedCount >= maxUses;
            const isExpired = Boolean(keyRow.expiresAt && Date.parse(keyRow.expiresAt) <= Date.now());
            if ((statusLower === 'active' || statusLower === 'unused' || !keyRow.status) && !isExhausted && !isExpired) {
              isExempt = true;
            }
          }
        } catch (_) {}
      }

      if (!isExempt) {
        // Enforce max 2 accounts per IP
        if (typeof store.countUsersByIp === 'function') {
          const ipCount = await store.countUsersByIp(clientIp);
          if (ipCount >= 2) {
            logger?.warn?.('MULTI_ACCOUNT_BLOCKED_BY_IP', { ip: clientIp, username: cleanUsername });
            return res.status(403).json({
              ok: false,
              error: 'Địa chỉ IP này đã đạt giới hạn tối đa 2 tài khoản. Vui lòng liên hệ Quản trị viên để được hỗ trợ.'
            });
          }
        }

        // Enforce max 2 accounts per device fingerprint
        if (deviceFingerprint && deviceFingerprint !== 'dfp_unknown' && typeof store.countUsersByFingerprint === 'function') {
          const fpCount = await store.countUsersByFingerprint(deviceFingerprint);
          if (fpCount >= 2) {
            logger?.warn?.('MULTI_ACCOUNT_BLOCKED_BY_FINGERPRINT', { fingerprint: deviceFingerprint, ip: clientIp, username: cleanUsername });
            return res.status(403).json({
              ok: false,
              error: 'Thiết bị này đã đạt giới hạn tối đa 2 tài khoản. Vui lòng liên hệ Quản trị viên để được hỗ trợ.'
            });
          }
        }
      }

      const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
      const hashedPassword = encryptUserPassword(cleanPassword);

      // Check trial configuration from store / config
      let isTrialEnabled = config?.trialGiftEnabled !== undefined ? Boolean(config.trialGiftEnabled) : true;
      let trialDays = Number(config?.trialDays || 1);
      try {
        if (typeof store.getSetting === 'function') {
          const sys = await store.getSetting('system_settings').catch(() => null);
          if (sys && sys.trialGiftEnabled !== undefined) {
            isTrialEnabled = Boolean(sys.trialGiftEnabled);
          }
          if (sys && sys.trialDays !== undefined) {
            trialDays = Number(sys.trialDays) || trialDays;
          }
        }
      } catch (_) {}

      // Register user:
      let registered = null;
      let registeredWorkerIds = [];
      const shouldAttemptTrial = isTrialEnabled && !providedKey;

      if (shouldAttemptTrial && typeof store.registerTrialUser !== 'function') {
        return res.status(503).json({
          ok: false,
          error: 'trial_allocation_unavailable',
          message: 'Hệ thống chưa sẵn sàng cấp bot dùng thử. Vui lòng thử lại sau hoặc liên hệ Quản trị viên.'
        });
      }

      if (shouldAttemptTrial) {
        try {
          registered = await store.registerTrialUser({
            userId,
            username: cleanUsername,
            password: hashedPassword,
            trialDays,
            planName: 'FREE TRIAL',
            registrationIp: clientIp,
            deviceFingerprint,
            registrationUserAgent: String(req.headers['user-agent'] || '').slice(0, 512)
          });
        } catch (regErr) {
          if (regErr.message && regErr.message.includes('NO_WORKERS_AVAILABLE')) {
            logger?.warn?.('trial_registration_no_workers', { username: cleanUsername });
            return res.status(409).json({
              ok: false,
              error: 'trial_bot_unavailable',
              message: 'Hiện chưa có bot trống để cấp dùng thử. Vui lòng thử lại sau hoặc liên hệ Quản trị viên.'
            });
          } else if (regErr.message && regErr.message.includes('đã có người sử dụng')) {
            return res.status(409).json({ ok: false, error: 'Tên đăng nhập này đã có người sử dụng.' });
          } else {
            throw regErr;
          }
        }

        const returnedWorkerIds = [
          ...(Array.isArray(registered?.workerIds) ? registered.workerIds : []),
          ...(Array.isArray(registered?.assignedBotIds) ? registered.assignedBotIds : []),
          ...(registered?.workerId ? [registered.workerId] : [])
        ].map((id) => String(id || '').trim()).filter(Boolean);
        registeredWorkerIds = [...new Set(returnedWorkerIds)].slice(0, 1);

        if (!registered || registered.ok === false || registeredWorkerIds.length !== 1) {
          logger?.error?.('trial_registration_missing_worker', { username: cleanUsername });
          return res.status(503).json({
            ok: false,
            error: 'trial_bot_assignment_failed',
            message: 'Tài khoản dùng thử chưa thể được gán bot. Vui lòng thử lại sau hoặc liên hệ Quản trị viên.'
          });
        }
      }

      if (!registered) {
        if (shouldAttemptTrial) {
          return res.status(503).json({
            ok: false,
            error: 'trial_registration_failed',
            message: 'Không thể hoàn tất đăng ký dùng thử. Vui lòng thử lại sau.'
          });
        }
        // Create user without bot (unassigned, 0 bots)
        const newUser = {
          id: userId,
          userId,
          username: cleanUsername,
          password: hashedPassword,
          role: 'user',
          status: 'active',
          isPermanent: false,
          isTrial: false,
          expiresAt: null,
          planName: 'Chưa kích hoạt',
          workerIds: [],
          assignedBotIds: [],
          botCount: 0,
          note: 'Đăng ký tài khoản Web',
          registrationIp: clientIp,
          deviceFingerprint,
          registrationUserAgent: String(req.headers['user-agent'] || '').slice(0, 512),
          createdAt: new Date().toISOString()
        };
        await store.setAccess(userId, newUser, 'system-register');
        registered = { ok: true, userId, username: cleanUsername, planName: 'Chưa kích hoạt', workerId: null };
      } else {
        // Ensure registration IP and fingerprint are saved
        try {
          await store.setAccess(userId, {
            username: cleanUsername,
            password: hashedPassword,
            role: 'user',
            status: 'active',
            isPermanent: false,
            isTrial: shouldAttemptTrial,
            trialBotId: shouldAttemptTrial ? registeredWorkerIds[0] : undefined,
            botCount: shouldAttemptTrial ? 1 : undefined,
            workerIds: shouldAttemptTrial ? registeredWorkerIds : [],
            expiresAt: registered.expiresAt || null,
            planName: registered.planName || 'FREE TRIAL',
            registrationIp: clientIp,
            deviceFingerprint,
            registrationUserAgent: req.headers['user-agent']
          }, 'system-register');
        } catch (_) {}
      }

      let assignedBotIds = registeredWorkerIds.length
        ? registeredWorkerIds
        : (registered?.workerId ? [String(registered.workerId)] : []);
      let planName = registered?.planName || 'FREE TRIAL';
      let isPermanent = false;
      let rentalExpiresAt = registered?.expiresAt || registered?.user?.expiresAt || null;

      // If a giftcode/key was provided, redeem it
      let keyRedeemed = false;
      let keyError = null;
      if (providedKey) {
        try {
          await entitlementService.redeem(userId, providedKey, 'user');
          keyRedeemed = true;
          const refreshed = await store.getUser(cleanUsername, { bypassCache: true });
          if (refreshed) {
            assignedBotIds = refreshed.assignedBotIds || refreshed.workerIds || assignedBotIds;
            planName = refreshed.planName || planName;
            isPermanent = Boolean(refreshed.isPermanent);
            rentalExpiresAt = refreshed.expiresAt || null;
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
        expiresAtRental: rentalExpiresAt,
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

      if (typeof store.addAudit === 'function') {
        await store.addAudit({
          action: 'AUTH_REGISTER',
          targetId: userId,
          actorId: cleanUsername,
          actorRole: 'user',
          actorIp: clientIp,
          details: { ip: clientIp, username: cleanUsername, deviceFingerprint }
        }).catch(() => {});
      }

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
          planName,
          expiresAt: rentalExpiresAt,
          sessionExpiresAt: session.expiresAt
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
      return res.status(500).json({ ok: false, error: 'Đăng ký thất bại. Vui lòng thử lại sau.' });
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

      if (!cleanUsername || cleanUsername.length > 32 || !cleanPassword || cleanPassword.length > 256) {
        return res.status(400).json({ ok: false, error: 'Tên đăng nhập hoặc mật khẩu không hợp lệ.' });
      }

      const rateCheck = checkRateLimit(clientIp, cleanUsername);
      if (!rateCheck.allowed) {
        return res.status(429).json({ ok: false, error: rateCheck.error });
      }

      // A. Check Admin Login
      const adminUsername = String(config.adminUsername || 'admin').trim();
      if (cleanUsername.toLowerCase() === adminUsername.toLowerCase()) {
        const cachedAdminPass = registry.getAdminPassword();
        const storedAdminPass = cachedAdminPass || config.adminPassword;
        if (!storedAdminPass) {
          return res.status(400).json({
            ok: false,
            error: 'Mật khẩu khởi tạo Quản trị viên chưa được thiết lập. Vui lòng đặt ADMIN_PASSWORD hoặc dùng lệnh Discord /admin password.'
          });
        }
        if (!verifyAdminPassword(cleanPassword, storedAdminPass)) {
          recordFailedAttempt(clientIp, cleanUsername);
          return res.status(401).json({ ok: false, error: 'Tên đăng nhập hoặc mật khẩu quản trị viên không chính xác.' });
        }
        if (!cachedAdminPass && config.adminPassword && typeof store?.setSetting === 'function') {
          const passwordHash = hashAdminPassword(cleanPassword);
          await store.setSetting('admin_credentials', { passwordHash, updatedAt: new Date().toISOString() });
          registry.setAdminPassword(passwordHash);
        }
        if (true) {
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
            actorRole: 'admin',
            actorIp: clientIp,
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
        recordFailedAttempt(clientIp, cleanUsername);
        return res.status(401).json({ ok: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
      }

      const passMatch = verifyUserPassword(cleanPassword, user.password);
      if (!passMatch) {
        recordFailedAttempt(clientIp, cleanUsername);
        return res.status(401).json({ ok: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
      }

      resetRateLimit(clientIp, cleanUsername);

      if (user.status === 'disabled') {
        return res.status(403).json({ ok: false, error: 'Tài khoản của bạn đã bị vô hiệu hóa hoặc khóa bởi Quản trị viên.' });
      }

      const userId = String(user.id || user.userId || cleanUsername);

      // Auto-migrate legacy scrypt/plaintext user passwords to reversible AES-256-GCM on successful login
      const storedRawPassword = String(user._rawEncryptedPassword || user.password || '');
      if (!isStoredCredentialCiphertext(storedRawPassword)) {
        try {
          const migratedCipher = encryptUserPassword(cleanPassword);
          await store.setAccess(userId, { username: user.username, password: migratedCipher }, 'auth-migrate-aes');
          user.password = migratedCipher;
          if (typeof store.invalidateCache === 'function') store.invalidateCache();
          logger.info?.('User password auto-migrated to reversible AES-256-GCM', { userId, username: cleanUsername });
        } catch (migErr) {
          logger.warn?.('Password auto-migration to AES failed', { userId, error: migErr.message });
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
      const rawAssigned = Array.isArray(updatedAccess?.workerIds)
        ? updatedAccess.workerIds
        : (Array.isArray(user.assignedBotIds) ? user.assignedBotIds : []);
      const assignedIds = rawAssigned.map((id) => String(id).trim()).filter(Boolean);

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

      if (typeof store.invalidateUserCache === 'function') {
        store.invalidateUserCache(userId, cleanUsername);
      }

      await store.addAudit({
        action: 'AUTH_USER_LOGIN',
        targetId: userId,
        actorId: cleanUsername,
        actorRole: 'user',
        actorIp: clientIp,
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
      return res.status(500).json({ ok: false, error: 'Đăng nhập thất bại. Vui lòng thử lại sau.' });
    }
  });

  // 3. LOGOUT
  router.post('/logout', async (req, res) => {
    try {
      const token = getRequestManagerSessionToken(req);
      const correlationId = req.headers?.['x-correlation-id'] || req.headers?.['x-request-id'] || `corr_${crypto.randomUUID().slice(0, 8)}`;
      if (token) {
        const tokenHash = hashSessionToken(token);
        const prevSess = activeSessions.get(tokenHash) || req.managerAuthSession || null;
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
        if (prevSess && typeof store.invalidateUserCache === 'function') {
          store.invalidateUserCache(prevSess.userId, prevSess.username);
        }
      }
      res.setHeader('Set-Cookie', clearCookieHeader('kingmc_mgr_session', isHttps(req)));
      return res.json({ ok: true, message: 'Đăng xuất thành công.' });
    } catch (error) {
      logger.error('Logout failed', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Đăng xuất thất bại. Vui lòng thử lại sau.' });
    }
  });

  // 3.5. PUBLIC LOGIN CONFIG
  router.get('/login-config', async (_req, res) => {
    let persisted = null;
    try {
      if (typeof store.getSetting === 'function') {
        persisted = await store.getSetting('system_settings').catch(() => null);
      }
    } catch (_) {}
    const trialGiftEnabled = persisted?.trialGiftEnabled !== undefined
      ? Boolean(persisted.trialGiftEnabled)
      : Boolean(config?.trialGiftEnabled ?? false);
    const trialDays = Number(persisted?.trialDays || config?.trialDays || 1);
    return res.json({
      ok: true,
      trialGiftEnabled,
      trialDays
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
        isPermanent: Boolean(session.isPermanent),
        expiresAt: session.role === 'admin' ? null : (session.expiresAtRental ?? null),
        sessionExpiresAt: session.expiresAt,
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
      if (String(currentPassword).length > 256 || String(newPassword).length > 256) {
        return res.status(400).json({ ok: false, error: 'Mật khẩu không được dài quá 256 ký tự.' });
      }

      if (session.role === 'admin') {
        const storedAdminPass = registry.getAdminPassword() || config.adminPassword;
        if (!verifyAdminPassword(currentPassword, storedAdminPass)) {
          return res.status(401).json({ ok: false, error: 'Mật khẩu hiện tại của Quản trị viên không chính xác.' });
        }
        const hashed = hashAdminPassword(newPassword);
        if (typeof store.setSetting === 'function') {
          await store.setSetting('admin_credentials', { passwordHash: hashed, updatedAt: new Date().toISOString() });
        }
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

      const hashedPassword = encryptUserPassword(newPassword);
      user.password = hashedPassword;
      await store.setAccess(session.userId, { username: user.username, password: hashedPassword }, 'user-change-password');

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
      logger.error('Password change failed', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Không thể đổi mật khẩu lúc này. Vui lòng thử lại sau.' });
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
      logger?.error?.('Worker access verification failed', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Không thể xác minh Worker lúc này.' });
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
