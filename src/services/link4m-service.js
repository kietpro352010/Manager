'use strict';

const crypto = require('node:crypto');
const { safeEqual, decryptSecret } = require('../utils/secrets');
const { DEFAULT_PUBLIC_MANAGER_URL } = require('../config/host-runtime');
const { getMaintenanceState, flushMaintenanceCompensation } = require('../utils/maintenance');

const API_ENDPOINTS = ['https://link4m.co/api-shorten/v2', 'https://link4m.co/api'];
const ATTEMPT_ORIGINS_SETTING_KEY = 'link4m_attempt_origins';
const STORE_SYNC_TTL_MS = 5 * 1000;
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const MIN_SOLVE_MS = 12 * 1000;
const ATTEMPT_TTL_MS = 15 * 60 * 1000;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function vietnamDateString(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function vietnamDayStart(now = new Date()) {
  const value = vietnamDateString(now);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000);
}

function validPublicUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  const requireHttps = process.env.NODE_ENV === 'production' && !process.env.NODE_TEST_CONTEXT;
  const allowedProto = requireHttps ? url.protocol === 'https:' : (url.protocol === 'https:' || url.protocol === 'http:');
  if (!allowedProto || !url.hostname || url.username || url.password || url.search || url.hash) {
    return '';
  }
  return `${url.protocol}//${url.host}`;
}

function validHttpsCustomUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  const requireHttps = process.env.NODE_ENV === 'production' && !process.env.NODE_TEST_CONTEXT;
  const allowedProto = requireHttps ? url.protocol === 'https:' : (url.protocol === 'https:' || url.protocol === 'http:');
  if (!allowedProto || !url.hostname || url.username || url.password) {
    return '';
  }
  return url.toString();
}

class Link4mService {
  constructor({ store, accessControl, userLock, config, logger, fetchImpl = global.fetch }) {
    this.store = store;
    this.accessControl = accessControl;
    this.userLock = userLock;
    const rawConfig = config || {};
    this.encryptionKey = rawConfig.encryptionKey || null;
    this.previousEncryptionKey = rawConfig.previousEncryptionKey || null;
    const resolvedEnabled = rawConfig.enabled !== undefined
      ? Boolean(rawConfig.enabled)
      : rawConfig.link4mRewardEnabled !== undefined
        ? Boolean(rawConfig.link4mRewardEnabled)
        : false;
    const rawMode = String(rawConfig.link4mMode || rawConfig.mode || 'api').trim().toLowerCase();
    this.config = {
      ...rawConfig,
      enabled: resolvedEnabled,
      rewardHours: Number(rawConfig.rewardHours || rawConfig.link4mRewardHours || 12),
      dailyLimit: Number(rawConfig.dailyLimit || rawConfig.link4mDailyLimit || 2),
      link4mMode: ['api', 'custom_url'].includes(rawMode) ? rawMode : 'api',
      link4mUrl: String(rawConfig.link4mUrl || rawConfig.customUrl || '').trim()
    };
    this.logger = logger;
    this.fetch = fetchImpl;
    this.initialized = false;
    this.lastInitError = null;
    this.lastInitAttemptAt = null;
    this._lastStoreSyncAt = 0;
    this._syncInFlight = null;
    this._attemptOrigins = new Map();
  }

  _effectiveFallbackBaseUrl() {
    return validPublicUrl(this.config.publicBaseUrl) || validPublicUrl(DEFAULT_PUBLIC_MANAGER_URL) || DEFAULT_PUBLIC_MANAGER_URL;
  }

  async _syncConfigFromStore({ bypassCache = false } = {}) {
    if (!this.store || typeof this.store.getSetting !== 'function') return;
    const stored = await this.store.getSetting('link4m_runtime', { bypassCache });
    const systemStored = await Promise.resolve(this.store.getSetting('system_settings', { bypassCache })).catch(() => null);
    const mgrStored = await Promise.resolve(this.store.getSetting('manager_runtime', { bypassCache })).catch(() => null);

    const sysModeRaw = String(systemStored?.link4mMode ?? stored?.mode ?? this.config.link4mMode ?? 'api').trim().toLowerCase();
    const resolvedMode = ['api', 'custom_url'].includes(sysModeRaw) ? sysModeRaw : 'api';
    const resolvedCustomUrl = String(systemStored?.link4mUrl ?? stored?.customUrl ?? this.config.link4mUrl ?? '').trim();

    if (stored) {
      this.config.enabled = stored.enabled === true;
      this.config.rewardHours = Number(stored.rewardHours) || this.config.rewardHours || 12;
      this.config.dailyLimit = Number(stored.dailyLimit) || this.config.dailyLimit || 2;
      this.config.link4mMode = resolvedMode;
      this.config.link4mUrl = resolvedCustomUrl;
    } else {
      const defaults = {
        enabled: systemStored?.link4mRewardEnabled !== undefined ? Boolean(systemStored.link4mRewardEnabled) : (this.config.enabled === true),
        rewardHours: Number(systemStored?.link4mRewardHours || this.config.rewardHours || 12),
        dailyLimit: Number(systemStored?.link4mDailyLimit || this.config.dailyLimit || 2),
        mode: resolvedMode,
        customUrl: resolvedCustomUrl
      };
      this.config.enabled = defaults.enabled;
      this.config.rewardHours = defaults.rewardHours;
      this.config.dailyLimit = defaults.dailyLimit;
      this.config.link4mMode = defaults.mode;
      this.config.link4mUrl = defaults.customUrl;
      await this.store.setSetting('link4m_runtime', defaults);
    }

    let mgrSecrets = null;
    if (mgrStored?.secretsCiphertext) {
      const mgrRes = this._tryDecryptValue(mgrStored.secretsCiphertext);
      if (mgrRes.ok && mgrRes.value) {
        try { mgrSecrets = JSON.parse(mgrRes.value); } catch (_) { mgrSecrets = null; }
      }
    }

    const sysApiRes = systemStored?.link4mApiTokenCiphertext ? this._tryDecryptValue(systemStored.link4mApiTokenCiphertext) : { ok: false, value: null };
    const sysSecRes = systemStored?.link4mSecretKeyCiphertext ? this._tryDecryptValue(systemStored.link4mSecretKeyCiphertext) : { ok: false, value: null };
    const sysClearedApi = systemStored && typeof systemStored === 'object' && systemStored.hasLink4mApiToken === false && !systemStored.link4mApiTokenCiphertext;
    const sysClearedSec = systemStored && typeof systemStored === 'object' && systemStored.hasLink4mSecretKey === false && !systemStored.link4mSecretKeyCiphertext;

    if (sysApiRes.ok && String(sysApiRes.value || '').trim()) {
      this.config.link4mApiToken = String(sysApiRes.value).trim();
    } else if (mgrSecrets?.link4mApiToken && String(mgrSecrets.link4mApiToken).trim()) {
      this.config.link4mApiToken = String(mgrSecrets.link4mApiToken).trim();
    } else if (sysClearedApi) {
      this.config.link4mApiToken = '';
      delete this.config.apiToken;
    }

    if (sysSecRes.ok && String(sysSecRes.value || '').trim()) {
      this.config.link4mSecretKey = String(sysSecRes.value).trim();
    } else if (mgrSecrets?.link4mSecretKey && String(mgrSecrets.link4mSecretKey).trim()) {
      this.config.link4mSecretKey = String(mgrSecrets.link4mSecretKey).trim();
    } else if (sysClearedSec) {
      this.config.link4mSecretKey = '';
      delete this.config.secretKey;
    }

    const persistedPublicUrl = String(systemStored?.publicBaseUrl || mgrStored?.publicBaseUrl || '').trim();
    if (persistedPublicUrl) {
      this.config.publicBaseUrl = persistedPublicUrl;
    }
    this._lastStoreSyncAt = Date.now();
  }

  async _refreshFromStoreIfStale() {
    if (!this.initialized || !this.store || typeof this.store.getSetting !== 'function') return;
    if ((Date.now() - this._lastStoreSyncAt) < STORE_SYNC_TTL_MS) return;
    if (this._syncInFlight) return this._syncInFlight;
    this._syncInFlight = this._syncConfigFromStore({ bypassCache: true })
      .catch(() => {})
      .finally(() => { this._syncInFlight = null; });
    return this._syncInFlight;
  }

  async _saveAttemptOrigin(attemptId, origin) {
    const id = String(attemptId || '').trim();
    const cleanOrigin = validPublicUrl(origin);
    if (!id || !cleanOrigin) return;
    this._attemptOrigins.set(id, cleanOrigin);
    while (this._attemptOrigins.size > 100) {
      const oldest = this._attemptOrigins.keys().next().value;
      if (oldest === undefined) break;
      this._attemptOrigins.delete(oldest);
    }
    if (this.store && typeof this.store.getSetting === 'function' && typeof this.store.setSetting === 'function') {
      try {
        const existing = await Promise.resolve(this.store.getSetting(ATTEMPT_ORIGINS_SETTING_KEY, { bypassCache: true })).catch(() => null);
        const now = Date.now();
        const entries = {};
        if (existing && typeof existing.entries === 'object' && existing.entries) {
          for (const [k, rec] of Object.entries(existing.entries)) {
            if (!rec || !rec.origin) continue;
            if (rec.expiresAt && Number(rec.expiresAt) <= now) continue;
            entries[k] = rec;
          }
        }
        entries[id] = { origin: cleanOrigin, expiresAt: now + ATTEMPT_TTL_MS + 60000 };
        const keys = Object.keys(entries);
        if (keys.length > 100) {
          for (const dropKey of keys.slice(0, keys.length - 100)) delete entries[dropKey];
        }
        await Promise.resolve(this.store.setSetting(ATTEMPT_ORIGINS_SETTING_KEY, { entries, updatedAt: new Date(now).toISOString() })).catch(() => {});
      } catch (_) {}
    }
  }

  async _getAttemptOrigin(attemptId) {
    const id = String(attemptId || '').trim();
    if (!id) return '';
    const cached = this._attemptOrigins.get(id);
    if (cached) return cached;
    if (this.store && typeof this.store.getSetting === 'function') {
      try {
        const existing = await Promise.resolve(this.store.getSetting(ATTEMPT_ORIGINS_SETTING_KEY, { bypassCache: true })).catch(() => null);
        const remoteOrigin = validPublicUrl(existing?.entries?.[id]?.origin);
        if (remoteOrigin) {
          this._attemptOrigins.set(id, remoteOrigin);
          return remoteOrigin;
        }
      } catch (_) {}
    }
    return '';
  }

  _tryDecryptValue(ciphertext) {
    if (!ciphertext || !this.encryptionKey) return { ok: false, value: null };
    try {
      const decrypted = decryptSecret(ciphertext, this.encryptionKey, this.previousEncryptionKey);
      return { ok: true, value: decrypted };
    } catch (_) {
      return { ok: false, value: null };
    }
  }

  setRuntimeCredentials(credUpdate = {}) {
    if (!credUpdate || typeof credUpdate !== 'object') return this.publicConfig();
    const next = { ...this.config };
    if (Object.hasOwn(credUpdate, 'publicBaseUrl')) {
      next.publicBaseUrl = String(credUpdate.publicBaseUrl || '').trim();
    }
    if (Object.hasOwn(credUpdate, 'link4mApiToken')) {
      const tok = String(credUpdate.link4mApiToken || '').trim();
      next.link4mApiToken = tok;
      if (Object.hasOwn(next, 'apiToken') && !tok) delete next.apiToken;
    } else if (Object.hasOwn(credUpdate, 'apiToken')) {
      next.link4mApiToken = String(credUpdate.apiToken || '').trim();
    }
    if (Object.hasOwn(credUpdate, 'link4mSecretKey')) {
      const sec = String(credUpdate.link4mSecretKey || '').trim();
      next.link4mSecretKey = sec;
      if (Object.hasOwn(next, 'secretKey') && !sec) delete next.secretKey;
    } else if (Object.hasOwn(credUpdate, 'secretKey')) {
      next.link4mSecretKey = String(credUpdate.secretKey || '').trim();
    }
    if (Object.hasOwn(credUpdate, 'link4mMode') || Object.hasOwn(credUpdate, 'mode')) {
      const modeRaw = String(credUpdate.link4mMode ?? credUpdate.mode ?? 'api').trim().toLowerCase();
      next.link4mMode = ['api', 'custom_url'].includes(modeRaw) ? modeRaw : 'api';
    }
    if (Object.hasOwn(credUpdate, 'link4mUrl') || Object.hasOwn(credUpdate, 'customUrl')) {
      next.link4mUrl = String(credUpdate.link4mUrl ?? credUpdate.customUrl ?? '').trim();
    }
    this.config = next;
    return this.publicConfig();
  }

  async initialize() {
    this.lastInitAttemptAt = new Date().toISOString();
    try {
      await this._syncConfigFromStore({ bypassCache: true });
      this.initialized = true;
      this.lastInitError = null;
    } catch (error) {
      this.initialized = false;
      this.lastInitError = error?.message || String(error);
      this.logger?.error?.('link4m_initialize_error', { error: this.lastInitError });
      throw error;
    }
  }

  health() {
    const hasError = Boolean(this.lastInitError);
    return {
      ok: !hasError,
      status: hasError ? 'degraded' : (this.initialized ? 'healthy' : 'uninitialized'),
      initialized: this.initialized,
      degraded: hasError,
      error: this.lastInitError,
      lastAttemptAt: this.lastInitAttemptAt
    };
  }

  publicConfig({ requestOrigin = '' } = {}) {
    const degraded = Boolean(this.lastInitError);
    const mode = this.config.link4mMode === 'custom_url' ? 'custom_url' : 'api';
    const hasApiToken = Boolean(this.config.link4mApiToken || this.config.apiToken);
    const hasSecretKey = Boolean(this.config.link4mSecretKey || this.config.secretKey);
    const customUrl = String(this.config.link4mUrl || '').trim();
    const customUrlConfigured = Boolean(validHttpsCustomUrl(customUrl));
    const callbackBaseUrl = validPublicUrl(requestOrigin) || this._effectiveFallbackBaseUrl();
    return {
      enabled: this.config.enabled === true && !degraded,
      configuredEnabled: this.config.enabled === true,
      rewardHours: Number(this.config.rewardHours || 12),
      dailyLimit: Number(this.config.dailyLimit || 2),
      mode,
      customUrl,
      hasApiToken,
      hasSecretKey,
      providerConfigured: mode === 'custom_url' ? customUrlConfigured : hasApiToken,
      webhookConfigured: hasSecretKey,
      callbackConfigured: mode === 'custom_url' ? true : Boolean(callbackBaseUrl),
      callbackBaseUrl,
      initialized: this.initialized,
      degraded,
      initError: this.lastInitError
    };
  }

  async configure({ enabled, rewardHours, dailyLimit, mode, customUrl }) {
    const nextModeRaw = mode !== undefined ? mode : (this.config.link4mMode || 'api');
    const nextMode = String(nextModeRaw || 'api').trim().toLowerCase() === 'custom_url' ? 'custom_url' : 'api';
    const nextCustomUrl = customUrl !== undefined ? String(customUrl || '').trim() : String(this.config.link4mUrl || '').trim();
    const next = {
      enabled: Boolean(enabled),
      rewardHours: Number(rewardHours),
      dailyLimit: Number(dailyLimit),
      mode: nextMode,
      customUrl: nextCustomUrl
    };
    if (!Number.isInteger(next.rewardHours) || next.rewardHours < 1 || next.rewardHours > 48) {
      throw new Error('Reward hours must be 1–48.');
    }
    if (!Number.isInteger(next.dailyLimit) || next.dailyLimit < 1 || next.dailyLimit > 10) {
      throw new Error('Daily limit must be 1–10.');
    }
    await this.store.setSetting('link4m_runtime', next);
    this.config = {
      ...this.config,
      enabled: next.enabled,
      rewardHours: next.rewardHours,
      dailyLimit: next.dailyLimit,
      link4mMode: next.mode,
      link4mUrl: next.customUrl
    };
    this.initialized = true;
    this.lastInitError = null;
    this._lastStoreSyncAt = Date.now();
    return this.publicConfig();
  }

  async status(userId, opts = {}) {
    await this._refreshFromStoreIfStale();
    const member = await this.accessControl.memberFor(userId);
    const config = this.publicConfig({ requestOrigin: opts?.requestOrigin || opts?.returnOrigin || '' });
    if (!member || member.role !== 'user' || member.status === 'disabled') {
      return { ok: true, ...config, eligible: false, reason: 'Link4M is available to user accounts only.' };
    }
    if (this.lastInitError) {
      return {
        ok: true,
        ...config,
        eligible: false,
        degraded: true,
        error: this.lastInitError,
        reason: 'Tính năng Link4M hiện đang gặp sự cố khởi tạo cấu hình.'
      };
    }
    const isPermanent = member.isPermanent === true;
    const now = new Date();
    const usedToday = await this.store.countLinkRewards(userId, vietnamDayStart(now));
    const last = await this.store.lastLinkReward(userId);
    const cooldownRemainingMs = last?.rewardedAt
      ? Math.max(0, COOLDOWN_MS - (now.getTime() - new Date(last.rewardedAt).getTime()))
      : 0;
    const attempt = await this.store.getLatestLinkAttempt(userId);
    return {
      ok: true,
      ...config,
      eligible: config.enabled && config.providerConfigured && config.callbackConfigured && usedToday < config.dailyLimit && cooldownRemainingMs === 0,
      isPermanent,
      supportMode: isPermanent,
      usedToday,
      todayCount: usedToday,
      remainingToday: Math.max(0, config.dailyLimit - usedToday),
      remainingAttempts: Math.max(0, config.dailyLimit - usedToday),
      cooldownRemainingMs,
      latestAttempt: attempt ? { status: attempt.status, expiresAt: attempt.expiresAt, rewardedAt: attempt.rewardedAt || null } : null,
      accessActive: this.accessControl.isEntitled(member)
    };
  }

  // Backward-compatible alias
  async getDailyQuotaStatus(userId, opts = {}) {
    return this.status(userId, opts);
  }

  async startAttempt(userId, clientIp, opts = {}) {
    const run = () => this.startAttemptLocked(String(userId), clientIp, opts);
    return this.userLock ? this.userLock.run(userId, run) : run();
  }

  // Backward-compatible alias
  async createLinkAttempt(userId, clientIp, opts = {}) {
    const res = await this.startAttempt(userId, clientIp, opts);
    return { ok: true, ...res, redirectUrl: res.redirectUrl || res.providerUrl || '' };
  }

  async startAttemptLocked(userId, clientIp, opts = {}) {
    await this._refreshFromStoreIfStale();
    const member = await this.accessControl.memberFor(userId, { bypassCache: true });
    if (!member || member.status === 'disabled') {
      throw new Error('Tài khoản đã bị khóa, không thể vượt link.');
    }
    const isPermanent = member.isPermanent === true;
    if (this.lastInitError) {
      throw new Error(`Tính năng Link4M hiện đang gặp sự cố khởi tạo: ${this.lastInitError}`);
    }
    if (this.config.enabled === false) {
      throw new Error('Tính năng nhận thưởng Link4M hiện đang bảo trì.');
    }
    const mode = this.config.link4mMode === 'custom_url' ? 'custom_url' : 'api';
    const fixedUrl = mode === 'custom_url' ? validHttpsCustomUrl(this.config.link4mUrl) : '';
    const apiToken = this.config.link4mApiToken || this.config.apiToken;
    const requestedOrigin = validPublicUrl(opts?.returnOrigin || opts?.requestOrigin);
    const baseUrl = requestedOrigin || this._effectiveFallbackBaseUrl();
    if (mode === 'custom_url') {
      if (!fixedUrl) {
        throw new Error('Chưa cấu hình đường dẫn Link4M cố định hợp lệ (HTTPS).');
      }
    } else {
      if (!apiToken) {
        throw new Error('Chưa cấu hình API Key Link4M trên hệ thống.');
      }
      if (!baseUrl) {
        throw new Error('Chưa cấu hình Public URL của Manager.');
      }
    }

    const now = new Date();
    const todayStart = vietnamDayStart(now);
    const usedToday = await this.store.countLinkRewards(userId, todayStart);
    const dailyLimit = Number(this.config.dailyLimit || 2);
    if (usedToday >= dailyLimit) {
      throw new Error(`Bạn đã đạt giới hạn ${dailyLimit} lượt vượt link nhận thưởng hôm nay.`);
    }

    const last = await this.store.lastLinkReward(userId);
    if (last?.rewardedAt && now.getTime() - new Date(last.rewardedAt).getTime() < COOLDOWN_MS) {
      const minutes = Math.ceil((COOLDOWN_MS - (now.getTime() - new Date(last.rewardedAt).getTime())) / 60000);
      throw new Error(`Thời gian chờ giữa 2 lần nhận thưởng là 2 tiếng. Vui lòng thử lại sau ${minutes} phút.`);
    }

    const active = await this.store.findActiveLinkAttempt(userId, now);
    if (active?.providerUrl) {
      const activeOrigin = await this._getAttemptOrigin(active.attemptId);
      const originMatches = !activeOrigin || activeOrigin === baseUrl;
      const customMatches = mode !== 'custom_url'
        || (!fixedUrl.includes('{return_url}') && !fixedUrl.includes('{origin}') && active.providerUrl === fixedUrl)
        || originMatches;
      if (originMatches && customMatches) {
        return {
          attemptId: active.attemptId,
          providerUrl: active.providerUrl,
          expiresAt: active.expiresAt,
          rewardHours: isPermanent ? 0 : active.rewardHours,
          isPermanent,
          supportMode: isPermanent,
          callbackBaseUrl: baseUrl,
          reused: true
        };
      }
    }
    if (active) await this.store.expireLinkAttempt(active.attemptId);
    await this.store.expireLinkAttempts(userId, now);

    const attemptId = `l4m_${crypto.randomBytes(12).toString('hex')}`;
    const nonce = crypto.randomBytes(24).toString('base64url');
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ATTEMPT_TTL_MS);

    const rewardHours = Number(this.config.rewardHours || 12);
    const vnDate = vietnamDateString(now);

    await this.store.createLinkAttempt({
      attemptId,
      userId,
      username: member.username || userId,
      tokenHash: sha256(nonce),
      rewardHours,
      status: 'pending',
      createdAt,
      expiresAt,
      providerUrl: '',
      purgeAt: new Date(createdAt.getTime() + 180 * 24 * 60 * 60 * 1000),
      dailyDate: vnDate
    });

    const returnUrl = new URL('/api/rewards/link4m/return', baseUrl);
    returnUrl.searchParams.set('attempt', attemptId);
    returnUrl.searchParams.set('token', nonce);

    let providerUrl;
    try {
      if (mode === 'custom_url') {
        providerUrl = fixedUrl
          .replace(/\{return_url\}/g, encodeURIComponent(returnUrl.toString()))
          .replace(/\{origin\}/g, encodeURIComponent(baseUrl));
      } else {
        providerUrl = await this.createShortLink(returnUrl.toString(), apiToken);
      }
      const saved = await this.store.setLinkAttemptProviderUrl(attemptId, providerUrl);
      if (!saved) throw new Error('Phiên vượt link đã hết hạn trước khi lưu link rút gọn.');
      await this._saveAttemptOrigin(attemptId, baseUrl);
    } catch (error) {
      await this.store.expireLinkAttempt(attemptId).catch(() => {});
      throw error;
    }

    return {
      attemptId,
      providerUrl,
      returnUrl: returnUrl.toString(),
      callbackBaseUrl: baseUrl,
      expiresAt,
      rewardHours: isPermanent ? 0 : rewardHours,
      isPermanent,
      supportMode: isPermanent,
      reused: false
    };
  }

  async createShortLink(returnUrl, apiToken) {
    let lastError = null;
    for (const endpoint of API_ENDPOINTS) {
      try {
        const requestUrl = new URL(endpoint);
        requestUrl.searchParams.set('api', apiToken);
        requestUrl.searchParams.set('url', returnUrl);
        const response = await this.fetch(requestUrl, { signal: AbortSignal.timeout(8000), redirect: 'error' });
        if (!response.ok) {
          await response.body?.cancel?.().catch(() => {});
          lastError = new Error(`provider_http_${response.status}`);
          continue;
        }
        const text = await response.text();
        let result;
        try {
          result = JSON.parse(text);
        } catch {
          result = { url: text.trim() };
        }
        const target = String(result?.shortenedUrl || result?.shortUrl || result?.url || '').trim();
        let parsed;
        try {
          parsed = new URL(target);
        } catch {
          parsed = null;
        }
        if (parsed?.protocol === 'https:' && parsed.hostname) return parsed.toString();
        lastError = new Error('provider_invalid_response');
      } catch (error) {
        lastError = error;
      }
    }
    this.logger?.warn('link4m_create_failed', { name: lastError?.name || 'Error', message: lastError?.message });
    throw new Error('Không thể tạo liên kết Link4M. Vui lòng kiểm tra lại API Key Link4M.');
  }

  async completeReturn(attemptId, nonce) {
    const attempt = await this.store.getLinkAttempt(attemptId);
    if (!attempt) throw new Error('Phiên vượt link không tồn tại hoặc đã hết hạn.');
    const suppliedHash = sha256(nonce);
    if (!safeEqual(suppliedHash, attempt.tokenHash)) {
      throw new Error('Mã token xác minh vượt link không hợp lệ.');
    }
    if (attempt.status === 'rewarded' || attempt.status === 'completed') {
      const member = await this.accessControl.memberFor(attempt.userId).catch(() => null);
      const isPermanent = Boolean(member?.isPermanent === true || Number(attempt.rewardHours) === 0);
      return isPermanent
        ? { replayed: true, isRewarded: true, permanent: true, supportAdmin: true, rewardHours: 0, addedHours: 0 }
        : { replayed: true, isRewarded: true, rewardHours: attempt.rewardHours };
    }
    if (attempt.expiresAt && Date.parse(attempt.expiresAt) <= Date.now()) {
      throw new Error('Phiên vượt link đã hết hạn. Vui lòng tạo liên kết mới.');
    }
    if (Date.now() - new Date(attempt.createdAt).getTime() < MIN_SOLVE_MS) {
      throw new Error('Thời gian vượt link quá nhanh. Vui lòng hoàn thành lại liên kết.');
    }
    const res = await this.completeVerifiedAttempt(attempt, attempt.tokenHash);
    return { ...res, isRewarded: !res?.processing };
  }

  // Unified claim verification method called by Web API
  async verifyAndClaimReward(token, attemptId) {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) throw new Error('Thiếu token xác minh vượt link.');

    let targetAttemptId = String(attemptId || '').trim();
    if (!targetAttemptId) {
      const hash = sha256(cleanToken);
      const found = await this.store.getLinkAttemptByTokenHash?.(hash);
      if (found?.attemptId) {
        targetAttemptId = found.attemptId;
      } else {
        const direct = await this.store.getLinkAttempt?.(cleanToken);
        if (direct?.attemptId) targetAttemptId = direct.attemptId;
      }
    }

    if (!targetAttemptId) {
      throw new Error('Phiên vượt link không tồn tại hoặc đã hết hạn.');
    }

    const res = await this.completeReturn(targetAttemptId, cleanToken);
    return { ok: true, ...res };
  }

  async completeWebhook(req) {
    const secretKey = this.config.link4mSecretKey || this.config.secretKey;
    if (!secretKey) throw new Error('Chưa cấu hình Webhook Secret Key.');
    const attemptId = String(req.query?.attempt || req.query?.attempt_id || req.body?.attemptId || req.body?.attempt_id || req.body?.attempt || '').trim();
    const bearer = String(req.get?.('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const secret = bearer || req.get?.('x-link4m-secret') || req.get?.('x-webhook-secret') || req.query?.secret || req.body?.secret || '';
    if (!safeEqual(secret, secretKey)) {
      throw new Error('Xác thực Webhook Link4M thất bại.');
    }
    const attempt = await this.store.getLinkAttempt(attemptId);
    if (!attempt) throw new Error('Phiên vượt link không tồn tại.');
    const token = String(req.query?.token || req.body?.token || '').trim();
    const signature = String(req.get?.('x-link4m-signature') || req.query?.signature || req.body?.signature || '').trim();
    const validToken = token && safeEqual(sha256(token), attempt.tokenHash);
    const expectedSignature = crypto.createHmac('sha256', secretKey).update(attemptId).digest('hex');
    if (!validToken && (!signature || !safeEqual(signature, expectedSignature))) {
      throw new Error('Chữ ký hoàn thành Link4M không hợp lệ.');
    }
    if (attempt.status === 'rewarded' || attempt.status === 'completed') {
      const member = await this.accessControl.memberFor(attempt.userId).catch(() => null);
      const isPermanent = Boolean(member?.isPermanent === true || Number(attempt.rewardHours) === 0);
      return isPermanent
        ? { replayed: true, isRewarded: true, permanent: true, supportAdmin: true, rewardHours: 0, addedHours: 0 }
        : { replayed: true, isRewarded: true, rewardHours: attempt.rewardHours };
    }
    if (attempt.expiresAt && Date.parse(attempt.expiresAt) <= Date.now()) {
      throw new Error('Phiên vượt link đã hết hạn.');
    }
    if (Date.now() - new Date(attempt.createdAt).getTime() < MIN_SOLVE_MS) {
      throw new Error('Hoàn thành vượt link quá nhanh.');
    }
    const res = await this.completeVerifiedAttempt(attempt, attempt.tokenHash);
    return { ...res, isRewarded: !res?.processing };
  }

  async completeVerifiedAttempt(attempt, tokenHash) {
    const run = async () => {
      let member = await this.accessControl.memberFor(attempt.userId, { bypassCache: true });
      if (!member || member.status === 'disabled') {
        throw new Error('Tài khoản không đủ điều kiện nhận thưởng.');
      }
      const isPermanent = member.isPermanent === true;
      if (!isPermanent) {
        const maint = await getMaintenanceState(this.store);
        const checkNow = Date.now();
        const currentExp = member.expiresAt ? Date.parse(member.expiresAt) : NaN;
        if (maint?.enabled && (!Number.isFinite(currentExp) || currentExp <= checkNow)) {
          const graceHours = Number(this.config?.botExpirationGraceHours);
          const graceMs = Number.isFinite(graceHours) && graceHours >= 0 ? graceHours * 3600 * 1000 : 6 * 3600 * 1000;
          await flushMaintenanceCompensation(this.store, {
            toMs: checkNow,
            gracePeriodMs: graceMs,
            turnOff: false,
            actor: 'system:link4m_checkpoint',
            logger: this.logger
          });
          const refreshedMember = await this.accessControl.memberFor(attempt.userId, { bypassCache: true });
          if (refreshedMember) member = refreshedMember;
          if (member.status === 'disabled') {
            throw new Error('Tài khoản không đủ điều kiện nhận thưởng.');
          }
        }
      }

      // Thử gọi RPC claim_manager_link4m_reward nguyên tử
      if (this.store.adapter && typeof this.store.adapter.claimLink4mReward === 'function') {
        const rpcRes = await this.store.adapter.claimLink4mReward(
          attempt.attemptId,
          tokenHash,
          member.username || attempt.userId,
          attempt.rewardHours || 12
        );
        if (rpcRes) {
          if (rpcRes.ok) {
            if (typeof this.store.invalidateUserCache === 'function') {
              this.store.invalidateUserCache(attempt.userId, member.username);
            } else if (typeof this.store.invalidateCache === 'function') {
              this.store.invalidateCache();
            }
            if (rpcRes.permanent || isPermanent) {
              return {
                replayed: Boolean(rpcRes.replayed),
                permanent: true,
                supportAdmin: true,
                rewardHours: 0,
                addedHours: 0,
                expiresAt: null,
                message: 'Cảm ơn bạn đã vượt link ủng hộ Admin! (Tài khoản VIP Vĩnh Viễn không cộng thêm thời gian.)'
              };
            }
            return {
              replayed: Boolean(rpcRes.replayed),
              rewardHours: rpcRes.addedHours || rpcRes.rewardHours || attempt.rewardHours || 12,
              expiresAt: rpcRes.expiresAt
            };
          }
          throw new Error(rpcRes.message || rpcRes.error || 'Xác nhận vượt link thất bại.');
        }
      }

      let claimed = await this.store.claimLinkAttempt(attempt.attemptId, tokenHash);
      if (!claimed) {
        const latest = await this.store.getLinkAttempt(attempt.attemptId);
        if (latest?.status === 'rewarded') {
          return isPermanent
            ? { replayed: true, permanent: true, supportAdmin: true, rewardHours: 0, addedHours: 0 }
            : { replayed: true, rewardHours: latest.rewardHours };
        }
        if (latest?.status === 'processing') {
          const procTs = Date.parse(latest.processingAt || latest.updatedAt || '');
          if (Number.isFinite(procTs) && (Date.now() - procTs) > 60_000 && typeof this.store.resetLinkAttempt === 'function') {
            await this.store.resetLinkAttempt(attempt.attemptId).catch(() => {});
            claimed = await this.store.claimLinkAttempt(attempt.attemptId, tokenHash);
          }
          if (!claimed) return { processing: true };
        } else {
          throw new Error('Phiên nhận thưởng đã hết hạn hoặc được nhận rồi.');
        }
      }

      try {
        if (isPermanent) {
          const completed = await this.store.completeLink4mReward(attempt.attemptId, attempt.userId, {
            role: 'user',
            status: 'active',
            workerIds: member.workerIds || [],
            isPermanent: true,
            expiresAt: member.expiresAt || null,
            planName: member.planName || 'VIP Vĩnh Viễn',
            allowAccountChange: member.allowAccountChange !== false,
            botCount: member.botCount,
            note: member.note || '',
            username: member.username || attempt.userId
          }, `link4m-support:${attempt.attemptId}`);

          if (!completed) throw new Error('Không thể ghi nhận lượt vượt link ủng hộ Admin.');

          if (typeof this.store.invalidateUserCache === 'function') {
            this.store.invalidateUserCache(attempt.userId, member.username);
          } else if (typeof this.store.invalidateCache === 'function') {
            this.store.invalidateCache();
          }

          if (typeof this.store.addAudit === 'function') {
            await this.store.addAudit({
              actorId: attempt.userId,
              action: 'link4m.support_admin',
              target: attempt.attemptId,
              details: { supportAdmin: true, rewardHours: 0 }
            }).catch(() => {});
          }

          return {
            replayed: false,
            permanent: true,
            supportAdmin: true,
            rewardHours: 0,
            addedHours: 0,
            expiresAt: null,
            message: 'Cảm ơn bạn đã vượt link ủng hộ Admin! (Tài khoản VIP Vĩnh Viễn không cộng thêm thời gian.)'
          };
        }

        const now = Date.now();
        const currentExpiry = member.expiresAt ? Date.parse(member.expiresAt) : NaN;
        const base = Number.isFinite(currentExpiry) && currentExpiry > now ? currentExpiry : now;
        const addedHours = Math.max(1, Number(claimed.rewardHours) || 12);
        const expiresAt = new Date(base + addedHours * 3600000).toISOString();

        const completed = await this.store.completeLink4mReward(attempt.attemptId, attempt.userId, {
          role: 'user',
          status: 'active',
          workerIds: member.workerIds || [],
          isPermanent: false,
          expiresAt,
          planName: member.planName || 'Standard',
          allowAccountChange: member.allowAccountChange !== false,
          botCount: member.botCount,
          note: member.note || '',
          username: member.username || attempt.userId
        }, `link4m:${attempt.attemptId}`);

        if (!completed) throw new Error('Không thể hoàn tất cộng thời gian thuê.');

        if (typeof this.store.invalidateUserCache === 'function') {
          this.store.invalidateUserCache(attempt.userId, member.username);
        } else if (typeof this.store.invalidateCache === 'function') {
          this.store.invalidateCache();
        }

        if (typeof this.store.addAudit === 'function') {
          await this.store.addAudit({
            actorId: attempt.userId,
            action: 'link4m.reward',
            target: attempt.attemptId,
            details: { rewardHours: addedHours, expiresAt }
          }).catch(() => {});
        }

        return { replayed: false, rewardHours: addedHours, expiresAt };
      } catch (error) {
        if (typeof this.store.resetLinkAttempt === 'function') {
          await this.store.resetLinkAttempt(attempt.attemptId).catch(() => {});
        }
        throw error;
      }
    };

    return this.userLock ? this.userLock.run(attempt.userId, run) : run();
  }
}

module.exports = { Link4mService, vietnamDayStart, vietnamDateString, validPublicUrl };
