'use strict';

const crypto = require('node:crypto');
const { safeEqual } = require('../utils/secrets');

const API_ENDPOINTS = ['https://link4m.co/api-shorten/v2', 'https://link4m.co/api'];
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const MIN_SOLVE_MS = 12 * 1000;
const ATTEMPT_TTL_MS = 15 * 60 * 1000;

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

function vietnamDayStart(now = new Date()) {
  const value = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000);
}

function validPublicUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { return ''; }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) return '';
  return `${url.protocol}//${url.host}`;
}

class Link4mService {
  constructor({ store, accessControl, userLock, config, logger, fetchImpl = global.fetch }) {
    this.store = store;
    this.accessControl = accessControl;
    this.userLock = userLock;
    this.config = { ...config };
    this.logger = logger;
    this.fetch = fetchImpl;
  }

  async initialize() {
    const stored = await this.store.getSetting('link4m_runtime');
    if (stored) {
      this.config.enabled = stored.enabled === true;
      this.config.rewardHours = Number(stored.rewardHours) || this.config.rewardHours;
      this.config.dailyLimit = Number(stored.dailyLimit) || this.config.dailyLimit;
      return;
    }
    await this.store.setSetting('link4m_runtime', {
      enabled: this.config.enabled === true,
      rewardHours: this.config.rewardHours,
      dailyLimit: this.config.dailyLimit
    });
  }

  publicConfig() {
    return {
      enabled: this.config.enabled === true,
      rewardHours: this.config.rewardHours,
      dailyLimit: this.config.dailyLimit,
      providerConfigured: Boolean(this.config.apiToken),
      webhookConfigured: Boolean(this.config.secretKey),
      callbackConfigured: Boolean(validPublicUrl(this.config.publicBaseUrl))
    };
  }

  async configure({ enabled, rewardHours, dailyLimit }) {
    const next = {
      enabled: Boolean(enabled),
      rewardHours: Number(rewardHours),
      dailyLimit: Number(dailyLimit)
    };
    if (!Number.isInteger(next.rewardHours) || next.rewardHours < 1 || next.rewardHours > 48) throw new Error('Reward hours must be 1–48.');
    if (!Number.isInteger(next.dailyLimit) || next.dailyLimit < 1 || next.dailyLimit > 10) throw new Error('Daily limit must be 1–10.');
    await this.store.setSetting('link4m_runtime', next);
    this.config = { ...this.config, ...next };
    return this.publicConfig();
  }

  async status(userId) {
    const member = await this.accessControl.memberFor(userId);
    const config = this.publicConfig();
    if (!member || member.role !== 'user' || member.status === 'disabled') {
      return { ...config, eligible: false, reason: 'Link4M is available to user accounts only.' };
    }
    if (member.isPermanent) return { ...config, eligible: false, reason: 'Permanent access does not need Link4M.' };
    const now = new Date();
    const usedToday = await this.store.countLinkRewards(userId, vietnamDayStart(now));
    const last = await this.store.lastLinkReward(userId);
    const cooldownRemainingMs = last?.rewardedAt
      ? Math.max(0, COOLDOWN_MS - (now.getTime() - new Date(last.rewardedAt).getTime())) : 0;
    const attempt = await this.store.getLatestLinkAttempt(userId);
    return {
      ...config, eligible: config.enabled && config.providerConfigured && config.callbackConfigured && usedToday < config.dailyLimit && cooldownRemainingMs === 0,
      usedToday, remainingToday: Math.max(0, config.dailyLimit - usedToday), cooldownRemainingMs,
      latestAttempt: attempt ? { status: attempt.status, expiresAt: attempt.expiresAt, rewardedAt: attempt.rewardedAt || null } : null,
      accessActive: this.accessControl.isEntitled(member)
    };
  }

  async startAttempt(userId) {
    const run = () => this.startAttemptLocked(String(userId));
    return this.userLock ? this.userLock.run(userId, run) : run();
  }

  async startAttemptLocked(userId) {
    const member = await this.accessControl.memberFor(userId);
    if (!member || member.role !== 'user' || member.status === 'disabled') throw new Error('Link4M requires an enabled user access record.');
    if (member.isPermanent) throw new Error('Permanent users do not need Link4M.');
    if (!this.config.enabled) throw new Error('Link4M reward is currently disabled by an admin.');
    if (!this.config.apiToken) throw new Error('Link4M API key is not configured on the manager host.');
    const baseUrl = validPublicUrl(this.config.publicBaseUrl);
    if (!baseUrl) throw new Error('Configure the public manager HTTPS URL with /setup or the host environment before using Link4M.');

    const now = new Date();
    const active = await this.store.findActiveLinkAttempt(userId, now);
    if (active?.providerUrl) return { attemptId: active.attemptId, providerUrl: active.providerUrl, expiresAt: active.expiresAt, rewardHours: active.rewardHours, reused: true };
    if (active) await this.store.expireLinkAttempt(active.attemptId);
    await this.store.expireLinkAttempts(userId, now);
    const recentStarts = await this.store.countLinkAttempts(userId, new Date(now.getTime() - 5 * 60 * 1000));
    if (recentStarts >= 6) throw new Error('Too many Link4M requests. Wait a few minutes and try again.');

    const todayStart = vietnamDayStart(now);
    const usedToday = await this.store.countLinkRewards(userId, todayStart);
    if (usedToday >= this.config.dailyLimit) throw new Error('You reached today’s Link4M reward limit.');
    const last = await this.store.lastLinkReward(userId);
    if (last?.rewardedAt && now.getTime() - new Date(last.rewardedAt).getTime() < COOLDOWN_MS) {
      const minutes = Math.ceil((COOLDOWN_MS - (now.getTime() - new Date(last.rewardedAt).getTime())) / 60000);
      throw new Error(`Link4M cooldown: try again in about ${minutes} minute(s).`);
    }

    const attemptId = `l4m_${crypto.randomBytes(12).toString('hex')}`;
    const nonce = crypto.randomBytes(24).toString('base64url');
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ATTEMPT_TTL_MS);
    const returnUrl = new URL('/api/rewards/link4m/return', baseUrl);
    returnUrl.searchParams.set('attempt', attemptId);
    returnUrl.searchParams.set('token', nonce);
    await this.store.createLinkAttempt({
      attemptId, userId, tokenHash: sha256(nonce), rewardHours: this.config.rewardHours,
      status: 'pending', createdAt, expiresAt, providerUrl: '', purgeAt: new Date(createdAt.getTime() + 180 * 24 * 60 * 60 * 1000),
      dailyDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now)
    });
    let providerUrl;
    try {
      providerUrl = await this.createShortLink(returnUrl.toString());
      const saved = await this.store.setLinkAttemptProviderUrl(attemptId, providerUrl);
      if (!saved) throw new Error('Link4M attempt expired before the provider URL was saved.');
    } catch (error) {
      await this.store.expireLinkAttempt(attemptId).catch(() => {});
      throw error;
    }
    return { attemptId, providerUrl, expiresAt, rewardHours: this.config.rewardHours, reused: false };
  }

  async createShortLink(returnUrl) {
    let lastError = null;
    for (const endpoint of API_ENDPOINTS) {
      try {
        const requestUrl = new URL(endpoint);
        requestUrl.searchParams.set('api', this.config.apiToken);
        requestUrl.searchParams.set('url', returnUrl);
        const response = await this.fetch(requestUrl, { signal: AbortSignal.timeout(8000), redirect: 'error' });
        if (!response.ok) { lastError = new Error(`provider_http_${response.status}`); continue; }
        const text = await response.text();
        let result;
        try { result = JSON.parse(text); }
        catch { result = { url: text.trim() }; }
        const target = String(result?.shortenedUrl || result?.shortUrl || result?.url || '').trim();
        let parsed;
        try { parsed = new URL(target); } catch { parsed = null; }
        if (parsed?.protocol === 'https:' && parsed.hostname) return parsed.toString();
        lastError = new Error('provider_invalid_response');
      } catch (error) { lastError = error; }
    }
    this.logger?.warn('link4m_create_failed', { name: lastError?.name || 'Error' });
    throw new Error('Could not create a Link4M URL. Check the Link4M API key and try again.');
  }

  async completeReturn(attemptId, nonce) {
    const attempt = await this.store.getLinkAttempt(attemptId);
    if (!attempt) throw new Error('Link4M attempt not found.');
    const suppliedHash = sha256(nonce);
    if (!safeEqual(suppliedHash, attempt.tokenHash)) throw new Error('Link4M completion token is invalid.');
    if (attempt.status === 'rewarded') return { replayed: true, rewardHours: attempt.rewardHours };
    if (Date.now() - new Date(attempt.createdAt).getTime() < MIN_SOLVE_MS) throw new Error('Link4M completion arrived too quickly. Try the provider link again.');
    return this.completeVerifiedAttempt(attempt, attempt.tokenHash);
  }

  async completeWebhook(req) {
    if (!this.config.secretKey) throw new Error('Link4M webhook secret is not configured.');
    const attemptId = String(req.query?.attempt || req.query?.attempt_id || req.body?.attemptId || req.body?.attempt_id || req.body?.attempt || '').trim();
    const bearer = String(req.get?.('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const secret = bearer || req.get?.('x-link4m-secret') || req.get?.('x-webhook-secret') || req.query?.secret || req.body?.secret || '';
    if (!safeEqual(secret, this.config.secretKey)) throw new Error('Link4M webhook authentication failed.');
    const attempt = await this.store.getLinkAttempt(attemptId);
    if (!attempt) throw new Error('Link4M attempt not found.');
    const token = String(req.query?.token || req.body?.token || '').trim();
    const signature = String(req.get?.('x-link4m-signature') || req.query?.signature || req.body?.signature || '').trim();
    const validToken = token && safeEqual(sha256(token), attempt.tokenHash);
    const expectedSignature = crypto.createHmac('sha256', this.config.secretKey).update(attemptId).digest('hex');
    if (!validToken && (!signature || !safeEqual(signature, expectedSignature))) throw new Error('Link4M webhook completion proof is invalid.');
    if (attempt.status === 'rewarded') return { replayed: true, rewardHours: attempt.rewardHours };
    if (Date.now() - new Date(attempt.createdAt).getTime() < MIN_SOLVE_MS) throw new Error('Link4M completion arrived too quickly.');
    return this.completeVerifiedAttempt(attempt, attempt.tokenHash);
  }

  async completeVerifiedAttempt(attempt, tokenHash) {
    const run = async () => {
      const member = await this.accessControl.memberFor(attempt.userId);
      if (!member || member.role !== 'user' || member.status === 'disabled' || member.isPermanent) throw new Error('This account is not eligible for Link4M reward.');
      const claimed = await this.store.claimLinkAttempt(attempt.attemptId, tokenHash);
      if (!claimed) {
        const latest = await this.store.getLinkAttempt(attempt.attemptId);
        if (latest?.status === 'rewarded') return { replayed: true, rewardHours: latest.rewardHours };
        if (latest?.status === 'processing') return { processing: true };
        throw new Error('Link4M attempt is expired or already used.');
      }
      try {
        const now = Date.now();
        const currentExpiry = member.expiresAt ? Date.parse(member.expiresAt) : NaN;
        const base = Number.isFinite(currentExpiry) && currentExpiry > now ? currentExpiry : now;
        const expiresAt = new Date(base + Math.max(1, Number(claimed.rewardHours) || 1) * 3600000).toISOString();
        const completed = await this.store.completeLink4mReward(attempt.attemptId, attempt.userId, {
          role: 'user', status: 'active', workerIds: member.workerIds || [], isPermanent: false,
          expiresAt, planName: member.planName || 'Standard', note: member.note || '', username: member.username || ''
        }, `link4m:${attempt.attemptId}`);
        if (!completed) throw new Error('Link4M attempt could not be finalized.');
        await this.store.addAudit({ actorId: attempt.userId, action: 'link4m.reward', target: attempt.attemptId, details: { rewardHours: claimed.rewardHours } })
          .catch((error) => this.logger?.warn('link4m_reward_audit_write_failed', { name: error.name || 'Error' }));
        return { replayed: false, rewardHours: claimed.rewardHours, expiresAt };
      } catch (error) {
        await this.store.resetLinkAttempt(attempt.attemptId).catch(() => {});
        throw error;
      }
    };
    return this.userLock ? this.userLock.run(attempt.userId, run) : run();
  }
}

module.exports = { Link4mService, vietnamDayStart, validPublicUrl };
