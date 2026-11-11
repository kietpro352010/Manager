'use strict';

const crypto = require('node:crypto');
const { safeEqual } = require('../utils/secrets');

const API_ENDPOINTS = ['https://link4m.co/api-shorten/v2', 'https://link4m.co/api'];
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
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname || url.username || url.password || url.search || url.hash) {
    return '';
  }
  return `${url.protocol}//${url.host}`;
}

class Link4mService {
  constructor({ store, accessControl, userLock, config, logger, fetchImpl = global.fetch }) {
    this.store = store;
    this.accessControl = accessControl;
    this.userLock = userLock;
    const rawConfig = config || {};
    const resolvedEnabled = rawConfig.enabled !== undefined
      ? Boolean(rawConfig.enabled)
      : rawConfig.link4mRewardEnabled !== undefined
        ? Boolean(rawConfig.link4mRewardEnabled)
        : false;
    this.config = {
      ...rawConfig,
      enabled: resolvedEnabled,
      rewardHours: Number(rawConfig.rewardHours || rawConfig.link4mRewardHours || 12),
      dailyLimit: Number(rawConfig.dailyLimit || rawConfig.link4mDailyLimit || 2)
    };
    this.logger = logger;
    this.fetch = fetchImpl;
  }

  async initialize() {
    const stored = await this.store.getSetting('link4m_runtime');
    if (stored) {
      this.config.enabled = stored.enabled === true;
      this.config.rewardHours = Number(stored.rewardHours) || this.config.rewardHours || 12;
      this.config.dailyLimit = Number(stored.dailyLimit) || this.config.dailyLimit || 2;
      return;
    }
    const defaults = {
      enabled: this.config.enabled === true,
      rewardHours: Number(this.config.rewardHours || 12),
      dailyLimit: Number(this.config.dailyLimit || 2)
    };
    this.config.enabled = defaults.enabled;
    this.config.rewardHours = defaults.rewardHours;
    this.config.dailyLimit = defaults.dailyLimit;
    await this.store.setSetting('link4m_runtime', defaults);
  }

  publicConfig() {
    return {
      enabled: this.config.enabled === true,
      rewardHours: Number(this.config.rewardHours || 12),
      dailyLimit: Number(this.config.dailyLimit || 2),
      providerConfigured: Boolean(this.config.link4mApiToken || this.config.apiToken),
      webhookConfigured: Boolean(this.config.link4mSecretKey || this.config.secretKey),
      callbackConfigured: Boolean(validPublicUrl(this.config.publicBaseUrl))
    };
  }

  async configure({ enabled, rewardHours, dailyLimit }) {
    const next = {
      enabled: Boolean(enabled),
      rewardHours: Number(rewardHours),
      dailyLimit: Number(dailyLimit)
    };
    if (!Number.isInteger(next.rewardHours) || next.rewardHours < 1 || next.rewardHours > 48) {
      throw new Error('Reward hours must be 1–48.');
    }
    if (!Number.isInteger(next.dailyLimit) || next.dailyLimit < 1 || next.dailyLimit > 10) {
      throw new Error('Daily limit must be 1–10.');
    }
    await this.store.setSetting('link4m_runtime', next);
    this.config = { ...this.config, ...next };
    return this.publicConfig();
  }

  async status(userId) {
    const member = await this.accessControl.memberFor(userId);
    const config = this.publicConfig();
    if (!member || member.role !== 'user' || member.status === 'disabled') {
      return { ok: true, ...config, eligible: false, reason: 'Link4M is available to user accounts only.' };
    }
    if (member.isPermanent) {
      return { ok: true, ...config, eligible: false, reason: 'Tài khoản vĩnh viễn không cần vượt link.' };
    }
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
      usedToday,
      remainingToday: Math.max(0, config.dailyLimit - usedToday),
      cooldownRemainingMs,
      latestAttempt: attempt ? { status: attempt.status, expiresAt: attempt.expiresAt, rewardedAt: attempt.rewardedAt || null } : null,
      accessActive: this.accessControl.isEntitled(member)
    };
  }

  // Backward-compatible alias
  async getDailyQuotaStatus(userId) {
    return this.status(userId);
  }

  async startAttempt(userId, clientIp) {
    const run = () => this.startAttemptLocked(String(userId), clientIp);
    return this.userLock ? this.userLock.run(userId, run) : run();
  }

  // Backward-compatible alias
  async createLinkAttempt(userId, clientIp) {
    const res = await this.startAttempt(userId, clientIp);
    return { ok: true, ...res };
  }

  async startAttemptLocked(userId, clientIp) {
    const member = await this.accessControl.memberFor(userId);
    if (!member || member.status === 'disabled') {
      throw new Error('Tài khoản đã bị khóa, không thể vượt link.');
    }
    if (member.isPermanent) {
      throw new Error('Tài khoản vĩnh viễn không cần vượt link.');
    }
    if (this.config.enabled === false) {
      throw new Error('Tính năng nhận thưởng Link4M hiện đang bảo trì.');
    }
    const apiToken = this.config.link4mApiToken || this.config.apiToken;
    if (!apiToken) {
      throw new Error('Chưa cấu hình API Key Link4M trên hệ thống.');
    }
    const baseUrl = validPublicUrl(this.config.publicBaseUrl);
    if (!baseUrl) {
      throw new Error('Chưa cấu hình Public URL của Manager.');
    }

    const now = new Date();
    const active = await this.store.findActiveLinkAttempt(userId, now);
    if (active?.providerUrl) {
      return {
        attemptId: active.attemptId,
        providerUrl: active.providerUrl,
        expiresAt: active.expiresAt,
        rewardHours: active.rewardHours,
        reused: true
      };
    }
    if (active) await this.store.expireLinkAttempt(active.attemptId);
    await this.store.expireLinkAttempts(userId, now);

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

    const attemptId = `l4m_${crypto.randomBytes(12).toString('hex')}`;
    const nonce = crypto.randomBytes(24).toString('base64url');
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ATTEMPT_TTL_MS);
    const returnUrl = new URL('/api/rewards/link4m/return', baseUrl);
    returnUrl.searchParams.set('attempt', attemptId);
    returnUrl.searchParams.set('token', nonce);

    const rewardHours = Number(this.config.rewardHours || 12);
    const vnDate = vietnamDateString(now);

    await this.store.createLinkAttempt({
      attemptId,
      userId,
      tokenHash: sha256(nonce),
      rewardHours,
      status: 'pending',
      createdAt,
      expiresAt,
      providerUrl: '',
      purgeAt: new Date(createdAt.getTime() + 180 * 24 * 60 * 60 * 1000),
      dailyDate: vnDate
    });

    let providerUrl;
    try {
      providerUrl = await this.createShortLink(returnUrl.toString(), apiToken);
      const saved = await this.store.setLinkAttemptProviderUrl(attemptId, providerUrl);
      if (!saved) throw new Error('Phiên vượt link đã hết hạn trước khi lưu link rút gọn.');
    } catch (error) {
      await this.store.expireLinkAttempt(attemptId).catch(() => {});
      throw error;
    }

    return { attemptId, providerUrl, expiresAt, rewardHours, reused: false };
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
      return { replayed: true, rewardHours: attempt.rewardHours };
    }
    if (Date.now() - new Date(attempt.createdAt).getTime() < MIN_SOLVE_MS) {
      throw new Error('Thời gian vượt link quá nhanh. Vui lòng hoàn thành lại liên kết.');
    }
    return this.completeVerifiedAttempt(attempt, attempt.tokenHash);
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
    if (attempt.status === 'rewarded') return { replayed: true, rewardHours: attempt.rewardHours };
    if (Date.now() - new Date(attempt.createdAt).getTime() < MIN_SOLVE_MS) {
      throw new Error('Hoàn thành vượt link quá nhanh.');
    }
    return this.completeVerifiedAttempt(attempt, attempt.tokenHash);
  }

  async completeVerifiedAttempt(attempt, tokenHash) {
    const run = async () => {
      const member = await this.accessControl.memberFor(attempt.userId);
      if (!member || member.status === 'disabled' || member.isPermanent) {
        throw new Error('Tài khoản không đủ điều kiện nhận thưởng.');
      }

      // Thử gọi RPC claim_manager_link4m_reward nguyên tử
      if (this.store.adapter && typeof this.store.adapter.claimLink4mReward === 'function') {
        const rpcRes = await this.store.adapter.claimLink4mReward(
          attempt.attemptId,
          tokenHash,
          member.username || attempt.userId,
          attempt.rewardHours || 12
        );
        if (rpcRes && rpcRes.ok) {
          return { replayed: false, rewardHours: rpcRes.rewardHours || attempt.rewardHours, expiresAt: rpcRes.expiresAt };
        }
      }

      const claimed = await this.store.claimLinkAttempt(attempt.attemptId, tokenHash);
      if (!claimed) {
        const latest = await this.store.getLinkAttempt(attempt.attemptId);
        if (latest?.status === 'rewarded') return { replayed: true, rewardHours: latest.rewardHours };
        if (latest?.status === 'processing') return { processing: true };
        throw new Error('Phiên nhận thưởng đã hết hạn hoặc được nhận rồi.');
      }

      try {
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
          note: member.note || '',
          username: member.username || attempt.userId
        }, `link4m:${attempt.attemptId}`);

        if (!completed) throw new Error('Không thể hoàn tất cộng thời gian thuê.');

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
