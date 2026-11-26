'use strict';

const crypto = require('node:crypto');
const express = require('express');
const {
  hashPassword,
  encryptUserPassword,
  decryptUserPassword,
  verifyUserPassword,
  verifyAdminPassword,
  verifyAdminPasswordAsync,
  hashAdminPassword,
  hashAdminPasswordAsync,
  timingSafeStringEquals,
  isStoredCredentialCiphertext
} = require('../../utils/secrets');

const {
  generateCaptcha,
  verifyCaptchaToken,
  resolveClientIp,
  isTrustedProxyRequest
} = require('../../services/captcha');
const { getMaintenanceState } = require('../../utils/maintenance');

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
  const bearerMatch = authHeader.match(/^\s*Bearer\s+(.+)$/i);
  if (bearerMatch) return bearerMatch[1].trim();
  return String(parseCookies(req).kingmc_mgr_session || '').trim();
}

function getAllRequestTokens(req) {
  const tokens = new Set();
  const authHeader = String(req?.headers?.authorization || '');
  const bearerMatch = authHeader.match(/^\s*Bearer\s+(.+)$/i);
  if (bearerMatch) {
    const bearer = bearerMatch[1].trim();
    if (bearer) tokens.add(bearer);
  }
  const cookieToken = String(parseCookies(req).kingmc_mgr_session || '').trim();
  if (cookieToken) tokens.add(cookieToken);
  return Array.from(tokens);
}

function isHttps(req, publicBaseUrl = '') {
  if (req?.secure === true || req?.socket?.encrypted === true) return true;
  if (typeof isTrustedProxyRequest === 'function' && isTrustedProxyRequest(req)) {
    const xfProtoRaw = String(req?.headers?.['x-forwarded-proto'] || '').trim();
    if (xfProtoRaw) {
      const parts = xfProtoRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const lastProto = parts[parts.length - 1];
      if (lastProto === 'https') return true;
      if (lastProto === 'http') return false;
    }
    const cfVisitor = String(req?.headers?.['cf-visitor'] || '').trim();
    if (cfVisitor.includes('"https"')) return true;
  }
  const base = String(publicBaseUrl || '').trim().toLowerCase();
  if (base.startsWith('https://')) return true;
  return false;
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
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
    const orig = router[method].bind(router);
    router[method] = (path, ...handlers) => orig(
      path,
      ...handlers.map((fn) => (typeof fn === 'function' && fn.length < 4
        ? (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
        : fn))
    );
  }
  const sessionDurationMs = (Number.isSafeInteger(Number(config?.webSessionTtlHours)) && Number(config.webSessionTtlHours) > 0)
    ? Number(config.webSessionTtlHours) * 3600 * 1000
    : (Number.isSafeInteger(Number(config?.sessionTtlDays)) && Number(config.sessionTtlDays) > 0
      ? Number(config.sessionTtlDays) * 24 * 3600 * 1000
      : 24 * 3600 * 1000);
  const cookieMaxAge = Math.floor(sessionDurationMs / 1000);
  const gracePeriodMs = Number.isFinite(config?.botExpirationGraceHours)
    ? config.botExpirationGraceHours * 3600 * 1000
    : (entitlementService?.gracePeriodMs !== undefined
        ? entitlementService.gracePeriodMs
        : (Number(config?.gracePeriodMs) > 0
            ? Number(config.gracePeriodMs)
            : (process.env.BOT_EXPIRATION_GRACE_HOURS !== undefined && !Number.isNaN(Number(process.env.BOT_EXPIRATION_GRACE_HOURS))
                ? Number(process.env.BOT_EXPIRATION_GRACE_HOURS) * 3600 * 1000
                : 6 * 60 * 60 * 1000)));

  function cacheSession(tokenHash, session) {
    if (!activeSessions || typeof activeSessions.set !== 'function') return;
    if (activeSessions.size >= 500 && !activeSessions.has(tokenHash)) {
      const now = Date.now();
      for (const [k, s] of activeSessions.entries()) {
        if (!s || (s.expiresAt && s.expiresAt <= now)) activeSessions.delete(k);
      }
      while (activeSessions.size >= 500) {
        const oldest = activeSessions.keys().next().value;
        if (oldest === undefined) break;
        activeSessions.delete(oldest);
      }
    }
    activeSessions.set(tokenHash, session);
  }

  // In-memory brute-force protection with progressive lockout tiers
  const DEFAULT_LOCKOUT_SCHEDULE_SEC = [15, 30, 45, 60, 120, 300, 3600];
  const LOCKOUT_SCHEDULE_SEC = (
    Array.isArray(config?.loginLockoutScheduleSec) &&
    config.loginLockoutScheduleSec.length > 0 &&
    config.loginLockoutScheduleSec.every((n) => Number.isFinite(Number(n)) && Number(n) > 0)
  )
    ? config.loginLockoutScheduleSec.map((n) => Number(n))
    : DEFAULT_LOCKOUT_SCHEDULE_SEC;

  const MAX_RATE_LIMIT_ENTRIES = (config && Number.isSafeInteger(Number(config.maxRateLimitEntries)) && Number(config.maxRateLimitEntries) > 0)
    ? Number(config.maxRateLimitEntries)
    : 5000;
  const RATE_LIMIT_WINDOW_MS = (config && Number.isSafeInteger(Number(config.loginWindowMs)) && Number(config.loginWindowMs) > 0)
    ? Number(config.loginWindowMs)
    : (15 * 60 * 1000);
  const MAX_LOGIN_ATTEMPTS = (config && Number.isSafeInteger(Number(config.maxLoginAttempts)) && Number(config.maxLoginAttempts) > 0)
    ? Number(config.maxLoginAttempts)
    : 5;
  const MAX_IP_LOGIN_ATTEMPTS = Math.max(MAX_LOGIN_ATTEMPTS * 20, 100);
  const loginAttempts = new Map();
  const ipLoginAttempts = new Map();
  const globalUserFailures = new Map();
  const captchaRateLimits = new Map();
  const registerRateLimits = new Map();

  function formatLockoutDurationVi(seconds) {
    const total = Math.max(1, Math.ceil(Number(seconds) || 0));
    if (total >= 3600) {
      const hours = Math.floor(total / 3600);
      const remMins = Math.floor((total % 3600) / 60);
      return remMins > 0 ? `${hours} giờ ${remMins} phút` : `${hours} giờ`;
    }
    if (total >= 60) {
      const mins = Math.floor(total / 60);
      const remSecs = total % 60;
      return remSecs > 0 ? `${mins} phút ${remSecs} giây` : `${mins} phút`;
    }
    return `${total} giây`;
  }

  function isRecordIdleExpired(rec, now = Date.now(), windowMs = RATE_LIMIT_WINDOW_MS) {
    if (!rec) return true;
    if (rec.lockedUntil && rec.lockedUntil > now) return false;
    const idleBase = Math.max(rec.windowStart || 0, rec.lockedUntil || 0);
    return (now - idleBase) > windowMs;
  }

  function evictBoundedMap(map, windowMs, now = Date.now()) {
    if (map.size < MAX_RATE_LIMIT_ENTRIES) return;
    for (const [k, v] of map.entries()) {
      if (isRecordIdleExpired(v, now, windowMs)) map.delete(k);
    }
    while (map.size >= MAX_RATE_LIMIT_ENTRIES) {
      const oldestKey = map.keys().next().value;
      if (oldestKey === undefined) break;
      map.delete(oldestKey);
    }
  }

  function resolveRouterCaptchaSecret() {
    const explicit = String(config?.captchaSecret || '').trim();
    if (explicit) return explicit;
    const sessSecret = String(config?.sessionSecret || '').trim();
    if (sessSecret) {
      return crypto.createHash('sha256').update(`${sessSecret}:kbot_captcha_v1`).digest('hex');
    }
    return undefined;
  }

  function checkCaptchaRateLimit(ip) {
    const ipKey = String(ip || 'unknown');
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxReq = 60;
    const rec = captchaRateLimits.get(ipKey);
    if (!rec || now - rec.windowStart > windowMs) {
      evictBoundedMap(captchaRateLimits, windowMs, now);
      captchaRateLimits.set(ipKey, { count: 1, windowStart: now });
      return { allowed: true };
    }
    if (rec.count >= maxReq) {
      return { allowed: false, error: 'Quá nhiều yêu cầu tạo mã xác thực từ địa chỉ IP này. Vui lòng thử lại sau ít phút.' };
    }
    rec.count++;
    return { allowed: true };
  }

  function checkRegisterRateLimit(ip) {
    const ipKey = String(ip || 'unknown');
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const maxReq = 20;
    const rec = registerRateLimits.get(ipKey);
    if (!rec || now - rec.windowStart > windowMs) {
      evictBoundedMap(registerRateLimits, windowMs, now);
      registerRateLimits.set(ipKey, { count: 1, windowStart: now });
      return { allowed: true };
    }
    if (rec.count >= maxReq) {
      const waitMinutes = Math.ceil((windowMs - (now - rec.windowStart)) / 60000);
      return { allowed: false, error: `Quá nhiều lần đăng ký tài khoản từ địa chỉ IP này. Vui lòng thử lại sau ${waitMinutes} phút.` };
    }
    rec.count++;
    return { allowed: true };
  }

  function checkRateLimit(ip, username) {
    const now = Date.now();
    const ipKey = String(ip || 'unknown');
    const ipRecord = ipLoginAttempts.get(ipKey);
    if (ipRecord && now - ipRecord.windowStart <= RATE_LIMIT_WINDOW_MS && ipRecord.count >= MAX_IP_LOGIN_ATTEMPTS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - ipRecord.windowStart)) / 1000));
      return {
        allowed: false,
        retryAfterSeconds,
        lockoutTier: LOCKOUT_SCHEDULE_SEC.length,
        error: `Quá nhiều lần đăng nhập sai từ địa chỉ IP này. Vui lòng thử lại sau ${formatLockoutDurationVi(retryAfterSeconds)}.`
      };
    }

    const uKey = String(username || '').toLowerCase();
    const uRecord = globalUserFailures.get(uKey);
    if (uRecord) {
      if (uRecord.lockedUntil && uRecord.lockedUntil > now) {
        const retryAfterSeconds = Math.max(1, Math.ceil((uRecord.lockedUntil - now) / 1000));
        return {
          allowed: false,
          retryAfterSeconds,
          lockoutTier: uRecord.tier,
          error: `Quá nhiều lần đăng nhập sai cho tài khoản '${username}'. Vui lòng thử lại sau ${formatLockoutDurationVi(retryAfterSeconds)}.`
        };
      }
      if (isRecordIdleExpired(uRecord, now, RATE_LIMIT_WINDOW_MS)) {
        globalUserFailures.delete(uKey);
      }
    }

    const key = `${ipKey}:${uKey}`;
    const record = loginAttempts.get(key);
    if (!record || isRecordIdleExpired(record, now, RATE_LIMIT_WINDOW_MS)) {
      evictBoundedMap(loginAttempts, RATE_LIMIT_WINDOW_MS, now);
      loginAttempts.set(key, { failedInBatch: 0, tier: 0, lockedUntil: 0, windowStart: now });
      return { allowed: true };
    }
    if (record.lockedUntil && record.lockedUntil > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.lockedUntil - now) / 1000));
      return {
        allowed: false,
        retryAfterSeconds,
        lockoutTier: record.tier,
        error: `Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau ${formatLockoutDurationVi(retryAfterSeconds)}.`
      };
    }
    return { allowed: true };
  }

  function resetRateLimit(ip, username) {
    const key = `${ip}:${String(username).toLowerCase()}`;
    loginAttempts.delete(key);
    globalUserFailures.delete(String(username).toLowerCase());
  }

  function applyProgressiveFailure(map, key, now) {
    let rec = map.get(key);
    if (!rec || isRecordIdleExpired(rec, now, RATE_LIMIT_WINDOW_MS)) {
      evictBoundedMap(map, RATE_LIMIT_WINDOW_MS, now);
      rec = { failedInBatch: 0, tier: 0, lockedUntil: 0, windowStart: now };
      map.set(key, rec);
    }
    rec.failedInBatch += 1;
    rec.windowStart = now;
    if (rec.failedInBatch >= MAX_LOGIN_ATTEMPTS) {
      const scheduleIdx = Math.min(rec.tier, LOCKOUT_SCHEDULE_SEC.length - 1);
      const durationSec = LOCKOUT_SCHEDULE_SEC[scheduleIdx];
      rec.lockedUntil = now + (durationSec * 1000);
      rec.tier = Math.min(rec.tier + 1, LOCKOUT_SCHEDULE_SEC.length - 1);
      rec.failedInBatch = 0;
      return {
        locked: true,
        retryAfterSeconds: durationSec,
        lockoutTier: scheduleIdx + 1,
        remainingAttempts: 0
      };
    }
    return {
      locked: false,
      retryAfterSeconds: 0,
      lockoutTier: rec.tier,
      remainingAttempts: Math.max(0, MAX_LOGIN_ATTEMPTS - rec.failedInBatch)
    };
  }

  function recordFailedAttempt(ip, username) {
    const ipKey = String(ip || 'unknown');
    const uKey = String(username || '').toLowerCase();
    const key = `${ipKey}:${uKey}`;
    const now = Date.now();
    const keyOutcome = applyProgressiveFailure(loginAttempts, key, now);
    const userOutcome = applyProgressiveFailure(globalUserFailures, uKey, now);

    const ipRec = ipLoginAttempts.get(ipKey);
    if (!ipRec || now - ipRec.windowStart > RATE_LIMIT_WINDOW_MS) {
      evictBoundedMap(ipLoginAttempts, RATE_LIMIT_WINDOW_MS, now);
      ipLoginAttempts.set(ipKey, { count: 1, windowStart: now });
    } else {
      ipRec.count++;
    }

    if (userOutcome.locked && (!keyOutcome.locked || userOutcome.retryAfterSeconds > keyOutcome.retryAfterSeconds)) {
      return userOutcome;
    }
    return keyOutcome;
  }

  // Periodic cleanup of rate limiter map
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of loginAttempts.entries()) {
      if (isRecordIdleExpired(val, now, RATE_LIMIT_WINDOW_MS)) loginAttempts.delete(key);
    }
    for (const [key, val] of ipLoginAttempts.entries()) {
      if (now - val.windowStart > RATE_LIMIT_WINDOW_MS) ipLoginAttempts.delete(key);
    }
    for (const [key, val] of globalUserFailures.entries()) {
      if (isRecordIdleExpired(val, now, RATE_LIMIT_WINDOW_MS)) globalUserFailures.delete(key);
    }
    for (const [key, val] of captchaRateLimits.entries()) {
      if (now - val.windowStart > 60 * 1000) captchaRateLimits.delete(key);
    }
    for (const [key, val] of registerRateLimits.entries()) {
      if (now - val.windowStart > 15 * 60 * 1000) registerRateLimits.delete(key);
    }
  }, 5 * 60 * 1000).unref();

  // 0. CAPTCHA
  router.get('/captcha', (req, res) => {
    try {
      const clientIp = req.clientIp || resolveClientIp(req);
      const rateCheck = checkCaptchaRateLimit(clientIp);
      if (!rateCheck.allowed) {
        return res.status(429).json({ ok: false, error: rateCheck.error });
      }
      const captchaSecret = resolveRouterCaptchaSecret();
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
      const clientIp = req.clientIp || resolveClientIp(req);
      const regRate = checkRegisterRateLimit(clientIp);
      if (!regRate.allowed) {
        return res.status(429).json({ ok: false, error: regRate.error });
      }

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
        const captchaSecret = resolveRouterCaptchaSecret();
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

      if (
        cleanUsername.toLowerCase() === 'admin' ||
        cleanUsername.toLowerCase() === String(config.adminUsername || '').toLowerCase() ||
        /^usr_/i.test(cleanUsername) ||
        /^\d{17,20}$/.test(cleanUsername)
      ) {
        return res.status(400).json({ ok: false, error: 'Tên tài khoản này được bảo lưu hoặc không hợp lệ (không được bắt đầu bằng usr_ hoặc trùng định dạng Discord ID).' });
      }

      const existing = await store.getUser(cleanUsername);
      if (existing) {
        return res.status(409).json({ ok: false, error: 'Tên đăng nhập này đã có người sử dụng.' });
      }

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
            expiresAt: registered.expiresAt || registered.user?.expiresAt || null,
            planName: registered.planName || 'FREE TRIAL',
            registrationIp: clientIp,
            deviceFingerprint,
            registrationUserAgent: String(req.headers['user-agent'] || '').slice(0, 512)
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

      cacheSession(tokenHash, session);
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

      res.setHeader('Set-Cookie', serializeCookie('kingmc_mgr_session', token, { maxAge: cookieMaxAge, secure: isHttps(req, config?.publicBaseUrl) }));
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
      const clientIp = req.clientIp || resolveClientIp(req);

      if (!cleanUsername || cleanUsername.length > 32 || !cleanPassword || cleanPassword.length > 256) {
        return res.status(400).json({ ok: false, error: 'Tên đăng nhập hoặc mật khẩu không hợp lệ.' });
      }

      if (!/^[a-zA-Z0-9_]{3,32}$/.test(cleanUsername)) {
        return res.status(400).json({ ok: false, error: 'Tên đăng nhập không hợp lệ.' });
      }

      function sendFailedLoginResponse(resObj, failState, baseErrorMsg) {
        if (failState?.locked) {
          const retrySec = Math.max(1, Number(failState.retryAfterSeconds) || 15);
          resObj.setHeader('Retry-After', String(retrySec));
          return resObj.status(429).json({
            ok: false,
            error: `Quá nhiều lần đăng nhập sai (${MAX_LOGIN_ATTEMPTS}/${MAX_LOGIN_ATTEMPTS}). Đăng nhập tạm dừng trong ${formatLockoutDurationVi(retrySec)}.`,
            retryAfterSeconds: retrySec,
            lockoutTier: failState.lockoutTier || 1,
            remainingAttempts: 0
          });
        }
        const rem = Number.isFinite(failState?.remainingAttempts) ? failState.remainingAttempts : 0;
        return resObj.status(401).json({
          ok: false,
          error: `${baseErrorMsg} (Còn ${rem} lần thử).`,
          remainingAttempts: rem
        });
      }

      const rateCheck = checkRateLimit(clientIp, cleanUsername);
      if (!rateCheck.allowed) {
        const retrySec = Math.max(1, Number(rateCheck.retryAfterSeconds) || 15);
        res.setHeader('Retry-After', String(retrySec));
        return res.status(429).json({
          ok: false,
          error: rateCheck.error,
          retryAfterSeconds: retrySec,
          lockoutTier: rateCheck.lockoutTier || 1,
          remainingAttempts: 0
        });
      }

      // A. Check Admin Login
      const adminUsername = String(config.adminUsername || 'admin').trim();
      if (cleanUsername.toLowerCase() === adminUsername.toLowerCase()) {
        let cachedAdminPass = registry.getAdminPassword();
        if (typeof store?.getSetting === 'function') {
          try {
            const remoteCreds = await store.getSetting('admin_credentials', { bypassCache: true });
            if (remoteCreds?.passwordHash && typeof remoteCreds.passwordHash === 'string') {
              cachedAdminPass = remoteCreds.passwordHash;
              if (typeof registry.setAdminPassword === 'function') {
                registry.setAdminPassword(cachedAdminPass);
              }
            }
          } catch (_) {}
        }
        let isMatch = false;
        let matchedFromEnv = false;

        if (cachedAdminPass) {
          if (await verifyAdminPasswordAsync(cleanPassword, cachedAdminPass)) {
            isMatch = true;
          }
        } else if (config.adminPassword && await verifyAdminPasswordAsync(cleanPassword, config.adminPassword)) {
          isMatch = true;
          matchedFromEnv = true;
        }

        if (!cachedAdminPass && !config.adminPassword) {
          return res.status(400).json({
            ok: false,
            error: 'Mật khẩu khởi tạo Quản trị viên chưa được thiết lập. Vui lòng đặt ADMIN_PASSWORD hoặc dùng lệnh Discord /admin password.'
          });
        }
        if (!isMatch) {
          const failState = recordFailedAttempt(clientIp, cleanUsername);
          return sendFailedLoginResponse(res, failState, 'Tên đăng nhập hoặc mật khẩu quản trị viên không chính xác.');
        }
        if (matchedFromEnv && !cachedAdminPass && typeof store?.setSetting === 'function') {
          const passwordHash = await hashAdminPasswordAsync(cleanPassword);
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

          cacheSession(tokenHash, session);
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

          const maintenance = await getMaintenanceState(store);
          res.setHeader('Set-Cookie', serializeCookie('kingmc_mgr_session', token, { maxAge: cookieMaxAge, secure: isHttps(req, config?.publicBaseUrl) }));
          return res.json({
            ok: true,
            token,
            user: {
              username: 'admin',
              role: 'admin',
              assignedBotIds: null
            },
            maintenance,
            message: 'Đăng nhập thành công với quyền Quản trị viên (ADMIN)!'
          });
        }
      }

      // B. Check Regular User Login
      const user = await store.getUser(cleanUsername, { bypassCache: true });
      if (!user) {
        const failState = recordFailedAttempt(clientIp, cleanUsername);
        return sendFailedLoginResponse(res, failState, 'Tên đăng nhập hoặc mật khẩu không chính xác.');
      }

      const passMatch = verifyUserPassword(cleanPassword, user.password || user._rawEncryptedPassword);
      if (!passMatch) {
        const failState = recordFailedAttempt(clientIp, cleanUsername);
        return sendFailedLoginResponse(res, failState, 'Tên đăng nhập hoặc mật khẩu không chính xác.');
      }

      resetRateLimit(clientIp, cleanUsername);

      if (String(user.status || '').toLowerCase() === 'disabled') {
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
      const expMs = expiresAtDate ? Date.parse(expiresAtDate) : NaN;
      const nowMs = Date.now();
      const isExpired = !isPermanent && Number.isFinite(expMs) && expMs <= nowMs;
      const inGracePeriod = Boolean(isExpired && (nowMs - expMs) <= gracePeriodMs);

      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(token);
      const expiresAt = nowMs + sessionDurationMs;

      const session = {
        tokenHash,
        userId,
        username: cleanUsername,
        role: 'user',
        assignedBotIds: assignedIds,
        createdAt: nowMs,
        expiresAt,
        status: isExpired ? (inGracePeriod ? 'grace_period' : 'expired') : 'active',
        inGracePeriod,
        gracePeriodMs,
        isPermanent,
        planName: updatedAccess?.planName || user.planName || 'Gói thường',
        expiresAtRental: expiresAtDate,
        allowAccountChange: user.allowAccountChange !== false
      };

      cacheSession(tokenHash, session);
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

      if (typeof store.recordUserLogin === 'function') {
        store.recordUserLogin(userId, clientIp).catch(() => {});
      } else if (typeof store.setAccess === 'function') {
        store.setAccess(userId, { lastLoginIp: clientIp, lastLoginAt: new Date().toISOString() }, 'system-login').catch(() => {});
      }

      await store.addAudit({
        action: 'AUTH_USER_LOGIN',
        targetId: userId,
        actorId: cleanUsername,
        actorRole: 'user',
        actorIp: clientIp,
        details: { ip: clientIp, isExpired, isPermanent }
      });

      const maintenance = await getMaintenanceState(store);
      res.setHeader('Set-Cookie', serializeCookie('kingmc_mgr_session', token, { maxAge: cookieMaxAge, secure: isHttps(req, config?.publicBaseUrl) }));
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
        maintenance,
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
      const tokens = getAllRequestTokens(req);
      const correlationId = req.headers?.['x-correlation-id'] || req.headers?.['x-request-id'] || `corr_${crypto.randomUUID().slice(0, 8)}`;
      for (const token of tokens) {
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
      res.setHeader('Set-Cookie', clearCookieHeader('kingmc_mgr_session', isHttps(req, config?.publicBaseUrl)));
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
      : Boolean(config?.trialGiftEnabled ?? true);
    const trialDays = Number(persisted?.trialDays || config?.trialDays || 1);
    return res.json({
      ok: true,
      trialGiftEnabled,
      trialDays
    });
  });

  // 4. ME / SESSION CHECK
  router.get('/me', async (req, res) => {
    const session = req.managerAuthSession;
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Chưa đăng nhập.' });
    }
    const maintenance = await getMaintenanceState(store);
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
      },
      maintenance
    });
  });

  async function revokeAllSessionsAfterPasswordChange(targetId, username, isAdmin) {
    const dbAdapterEnabled = typeof store.adapter?.isEnabled !== 'function' || store.adapter.isEnabled();
    let dbRevokeOk = true;
    if (dbAdapterEnabled && typeof store.adapter?.revokeUserSessions === 'function') {
      try {
        const revokeRes = await store.adapter.revokeUserSessions(targetId);
        if (revokeRes === false || revokeRes?.ok === false) {
          dbRevokeOk = false;
          logger?.error?.('Failed to revoke sessions from DB on password change', {
            targetId,
            error: revokeRes?.error || 'revoke_returned_false'
          });
        }
      } catch (revokeErr) {
        dbRevokeOk = false;
        logger?.error?.('Failed to revoke sessions from DB on password change', {
          targetId,
          error: revokeErr?.message
        });
      }
    }
    const targetIdLower = String(targetId || '').trim().toLowerCase();
    const targetUserLower = String(username || '').trim().toLowerCase();
    for (const [hash, s] of activeSessions.entries()) {
      if (!s) continue;
      if (isAdmin) {
        if (s.role === 'admin') activeSessions.delete(hash);
        continue;
      }
      const sIdLower = String(s.userId || '').trim().toLowerCase();
      const sUserLower = String(s.username || '').trim().toLowerCase();
      if ((targetIdLower && sIdLower === targetIdLower) || (targetUserLower && sUserLower === targetUserLower)) {
        activeSessions.delete(hash);
      }
    }
    if (typeof store.invalidateCache === 'function') store.invalidateCache();
    return dbRevokeOk;
  }

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
        let cachedAdminPass = registry.getAdminPassword();
        if (typeof store?.getSetting === 'function') {
          try {
            const remoteCreds = await store.getSetting('admin_credentials', { bypassCache: true });
            if (remoteCreds?.passwordHash && typeof remoteCreds.passwordHash === 'string') {
              cachedAdminPass = remoteCreds.passwordHash;
              if (typeof registry.setAdminPassword === 'function') {
                registry.setAdminPassword(cachedAdminPass);
              }
            }
          } catch (_) {}
        }
        const isMatch = cachedAdminPass
          ? await verifyAdminPasswordAsync(currentPassword, cachedAdminPass)
          : Boolean(config.adminPassword && await verifyAdminPasswordAsync(currentPassword, config.adminPassword));
        if (!isMatch) {
          return res.status(401).json({ ok: false, error: 'Mật khẩu hiện tại của Quản trị viên không chính xác.' });
        }
        const hashed = await hashAdminPasswordAsync(newPassword);
        if (typeof store.setSetting === 'function') {
          await store.setSetting('admin_credentials', { passwordHash: hashed, updatedAt: new Date().toISOString() });
        }
        registry.setAdminPassword(hashed);
        await registry.save?.();

        const dbRevokeOk = await revokeAllSessionsAfterPasswordChange('admin', 'admin', true);
        res.setHeader('Set-Cookie', clearCookieHeader('kingmc_mgr_session', isHttps(req, config?.publicBaseUrl)));
        if (!dbRevokeOk) {
          return res.status(503).json({
            ok: false,
            error: 'session_revocation_failed',
            message: 'Mật khẩu Quản trị viên đã thay đổi nhưng thu hồi phiên cũ trong cơ sở dữ liệu thất bại. Vui lòng đăng nhập lại.'
          });
        }
        return res.json({ ok: true, message: 'Đổi mật khẩu Quản trị viên thành công. Vui lòng đăng nhập lại.' });
      }

      const user = await store.getUser(session.username, { bypassCache: true });
      if (!user || !verifyUserPassword(currentPassword, user.password || user._rawEncryptedPassword)) {
        return res.status(401).json({ ok: false, error: 'Mật khẩu hiện tại không chính xác.' });
      }

      const hashedPassword = encryptUserPassword(newPassword);
      user.password = hashedPassword;
      await store.setAccess(session.userId, { username: user.username, password: hashedPassword }, 'user-change-password');

      const dbRevokeOk = await revokeAllSessionsAfterPasswordChange(session.userId || session.username, session.username, false);
      res.setHeader('Set-Cookie', clearCookieHeader('kingmc_mgr_session', isHttps(req, config?.publicBaseUrl)));
      if (!dbRevokeOk) {
        return res.status(503).json({
          ok: false,
          error: 'session_revocation_failed',
          message: 'Mật khẩu đã thay đổi nhưng thu hồi phiên cũ trong cơ sở dữ liệu thất bại. Vui lòng đăng nhập lại.'
        });
      }

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
      const clientIp = req.clientIp || resolveClientIp(req);
      const incomingSecret = req.headers['x-bot-secret'] || '';
      const globalSecret = config.botSecretKey || '';

      const isGlobalAuthed = Boolean(globalSecret && timingSafeStringEquals(incomingSecret, globalSecret));
      let isAuthed = isGlobalAuthed;
      const resolvedBotId = String(botId || req.headers['x-manager-bot-id'] || '').trim().toLowerCase();

      if (isGlobalAuthed) {
        logger?.warn('GLOBAL_BOT_SECRET_USED', {
          action: 'verify-bot-access',
          botId: resolvedBotId,
          ip: clientIp
        });
        if (typeof store.addAudit === 'function') {
          await store.addAudit({
            action: 'GLOBAL_BOT_SECRET_USED',
            targetId: String(resolvedBotId || 'unknown'),
            actorId: 'system:global_secret',
            details: { ip: clientIp, endpoint: '/verify-bot-access' }
          }).catch(() => null);
        }
      } else {
        isAuthed = Boolean(resolvedBotId && await registry.verifyBotSecret(resolvedBotId, incomingSecret));
      }

      if (!isAuthed) {
        return res.status(401).json({ ok: false, error: 'unauthorized_worker_secret' });
      }

      const assigned = await store.assignedUser(String(resolvedBotId));
      return res.json({
        ok: true,
        botId: resolvedBotId,
        assignedUser: assigned || null
      });
    } catch (error) {
      logger?.error?.('Worker access verification failed', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Không thể xác minh Worker lúc này.' });
    }
  });

  router._loginAttempts = loginAttempts;
  router._checkRateLimit = checkRateLimit;
  router._globalUserFailures = globalUserFailures;
  router._recordFailedAttempt = recordFailedAttempt;

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
