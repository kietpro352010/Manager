'use strict';

const crypto = require('node:crypto');
const AsyncKeyLock = require('./async-key-lock');
const { isLocalOrPrivateHost } = require('./proxy-validation');
const { encryptSecret, decryptSecret, generateWorkerSecret } = require('../utils/secrets');
const { extractChatMessage } = require('../utils/text-format');

function safeDecryptJson(ciphertext, key) {
  if (!ciphertext) return null;
  try {
    const raw = decryptSecret(ciphertext, key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function safeDecryptText(ciphertext, key) {
  if (!ciphertext) return '';
  try {
    return decryptSecret(ciphertext, key) || '';
  } catch (_) {
    return '';
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const ACTIONS = new Set([
  'start', 'stop', 'restart', 'status', 'chat', 'reset', 'set-afk-mode', 'set-proxy',
  'reconnect', 'respawn', 'inventory', 'look', 'toss', 'window_click', 'window_close'
]);

const BOT_SUMMARY_CACHE_MS = 2000;
const MAX_LOGS_PER_BOT = 100;
const SECRET_CACHE_TTL_MS = 60000; // 60s TTL for worker secretCache (WORKER-02)
const ROTATION_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5m grace period for rotated secrets (WKR-02)

const VALID_WORKER_STATES = new Set([
  'online', 'offline', 'error', 'maintenance', 'stopped',
  'connecting', 'authenticating', 'entering', 'kicked', 'afk',
  'waking', 'registered', 'idle', 'running', 'banned',
  'ip_limited', 'disconnected', 'unknown'
]);

// Canonical Worker Status Validator (WORKER-08)
function validateWorkerStatus(rawStatus, source = 'worker') {
  const status = rawStatus && typeof rawStatus === 'object' && !Array.isArray(rawStatus) ? rawStatus : {};

  const asNumber = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : null;
  };

  const asInteger = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    const num = asNumber(value, min, max);
    return num !== null ? Math.round(num) : null;
  };

  const rawState = String(status.state || '').trim().toLowerCase();
  const state = VALID_WORKER_STATES.has(rawState) ? rawState : 'unknown';

  let position = null;
  if (status.position && typeof status.position === 'object' && !Array.isArray(status.position)) {
    const x = asNumber(status.position.x, -30000000, 30000000);
    const y = asNumber(status.position.y, -2048, 2048);
    const z = asNumber(status.position.z, -30000000, 30000000);
    if (x !== null && y !== null && z !== null) {
      position = { x, y, z };
    }
  }

  return {
    state,
    online: Boolean(status.online ?? status.connected),
    username: String(status.username || '').slice(0, 64),
    uptimeSeconds: asInteger(status.uptimeSeconds, 0),
    pingMs: asNumber(status.pingMs, 0, 600000),
    managerLatencyMs: asNumber(status.managerLatencyMs, 0, 600000),
    transport: String(status.transport || '').slice(0, 24),
    reconnectAttempts: asInteger(status.reconnectAttempts, 0, 1000) || 0,
    reconnectCount: asInteger(status.reconnectCount, 0, 10000) || 0,
    afkMode: 'still',
    proxyEnabled: Boolean(status.proxyEnabled),
    lastError: String(status.lastError || '').slice(0, 240),
    lastKickReason: String(status.lastKickReason || '').slice(0, 240),
    restriction: String(status.restriction || '').slice(0, 40) || null,
    maintenanceWindow: Boolean(status.maintenanceWindow),
    maintenanceTimeZone: String(status.maintenanceTimeZone || '').slice(0, 40),
    maintenanceStart: String(status.maintenanceStart || '').slice(0, 5),
    maintenanceEnd: String(status.maintenanceEnd || '').slice(0, 5),
    tps: typeof status.tps === 'number' && Number.isFinite(status.tps) ? Math.max(0, Math.min(20, status.tps)) : null,
    cpuPercent: asNumber(status.cpuPercent, 0, 100),
    rssMb: asNumber(status.rssMb, 0, 65536),
    heapUsedMb: asNumber(status.heapUsedMb, 0, 65536),
    health: asNumber(status.health, 0, 20),
    food: asNumber(status.food, 0, 20),
    totemCount: asInteger(status.totemCount, 0, 1000),
    goldenAppleCount: asInteger(status.goldenAppleCount, 0, 1000),
    position,
    dimension: String(status.dimension || '').slice(0, 40),
    lastStateAt: status.lastStateAt && !Number.isNaN(new Date(status.lastStateAt).getTime())
      ? new Date(status.lastStateAt)
      : null,
    manuallyStopped: status.manuallyStopped !== undefined ? Boolean(status.manuallyStopped) : undefined,
    updatedAt: new Date(),
    source
  };
}

class WorkerRegistry {
  constructor({ store, accessStore, encryptionKey, renderApi, adminNotifier }) {
    this.store = store;
    this.accessStore = accessStore;
    this.encryptionKey = encryptionKey;
    this.renderApi = renderApi;
    this.adminNotifier = adminNotifier;

    // Cache và bộ đếm tuần tự chống race condition (Trụ cột 2.1)
    this.summaryCache = new Map();
    this.summaryRequestSeq = new Map();
    this.summaryLastAppliedSeq = new Map();
    this.botLogsCache = new Map(); // botId -> Array max 100
    this.secretCache = new Map(); // botId -> decrypted secret
    this.statusLock = new AsyncKeyLock();
  }

  pruneStaleMemory() {
    const now = Date.now();
    for (const [botId, entry] of this.summaryCache.entries()) {
      if (now - entry.timestamp > 60000) {
        this.summaryCache.delete(botId);
      }
    }
    for (const [botId, logs] of this.botLogsCache.entries()) {
      if (Array.isArray(logs) && logs.length > MAX_LOGS_PER_BOT) {
        this.botLogsCache.set(botId, logs.slice(-MAX_LOGS_PER_BOT));
      }
    }
    for (const [botId, entry] of this.secretCache.entries()) {
      if (entry?.cachedAt && now - entry.cachedAt > SECRET_CACHE_TTL_MS) {
        this.secretCache.delete(botId);
      }
    }
  }

  async add({ workerId, name, provider, serviceUrl = '', serviceId = '' }) {
    const botNumber = await this.store.nextBotNumber();
    const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
    const defaultId = pad(botNumber);
    const id = String(workerId || '').trim().toLowerCase() || defaultId;
    const label = String(name || `KingMC Bot ${botNumber}`).trim().slice(0, 64);
    const host = String(provider || 'wispbyte').trim().toLowerCase();
    let url = String(serviceUrl || '').trim().replace(/\/+$/, '');
    const renderServiceId = String(serviceId || '').trim();

    if (!ID_PATTERN.test(id)) throw new Error('Worker ID must be 2–40 lowercase letters, numbers, underscores, or hyphens.');
    if (!['render', 'wispbyte'].includes(host)) throw new Error('Provider must be render or wispbyte.');
    if (host === 'render' && !url && !renderServiceId) throw new Error('Render workers need a service URL or Render service ID.');
    if (url && !/^https:\/\//i.test(url) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(url)) {
      throw new Error('Worker URL must use HTTPS.');
    }

    if (host === 'render' && !url && renderServiceId) {
      if (!this.renderApi) throw new Error('Configure Render API key or provide worker HTTPS URL.');
      const service = await this.renderApi.getService(renderServiceId);
      url = String(service.url || '').replace(/\/+$/, '');
      if (!url) throw new Error('The selected Render service has no public HTTPS URL.');
    }

    if (await this.store.get(id)) throw new Error(`Worker ${id} already exists.`);

    const secret = generateWorkerSecret();
    const now = new Date();
    const record = {
      botNumber,
      workerId: id,
      name: label,
      provider: host,
      serviceUrl: url,
      renderServiceId,
      secretCiphertext: encryptSecret(secret, this.encryptionKey),
      enabled: true,
      settings: { afkMode: 'still', proxyCiphertext: null, mcCredentialsCiphertext: null, afkManaged: false, proxyManaged: false },
      status: { state: 'registered', online: false },
      events: [],
      createdAt: now,
      updatedAt: now
    };

    await this.store.create(record);
    this.secretCache.set(id, secret);
    return { worker: this.publicView(record), secret };
  }

  async remove(workerId) {
    const id = String(workerId || '').trim().toLowerCase();
    const existing = await this.store.get(id);
    const removed = await this.store.remove(id);
    if (removed) {
      await this.accessStore?.removeWorkerAssignments?.(id);
      this.summaryCache.delete(id);
      this.botLogsCache.delete(id);
      this.secretCache.delete(id);
      if (existing && Number.isInteger(existing.botNumber)) {
        await this.reindexAfterRemoval(existing.botNumber);
      }
    }
    return removed;
  }

  async reindexAfterRemoval(removedBotNumber) {
    try {
      const allWorkers = await this.store.list();
      const toShift = allWorkers.filter((w) => w.botNumber > removedBotNumber).sort((a, b) => a.botNumber - b.botNumber);
      for (const worker of toShift) {
        await this.store.update(worker.workerId, { botNumber: worker.botNumber - 1 });
      }
    } catch (_) {}
  }

  computeReachable(record) {
    if (!record) return null;
    record.reachable = Boolean(record.lastHeartbeat && Date.now() - new Date(record.lastHeartbeat).getTime() <= 120000);
    return record;
  }

  async find(workerId) {
    const record = await this.store.get(String(workerId || '').trim().toLowerCase());
    return this.computeReachable(record);
  }

  async findByNumber(botNumber) {
    const number = Number(botNumber);
    if (!Number.isInteger(number) || number <= 0) return null;
    const record = await this.store.getByNumber(number);
    return this.computeReachable(record);
  }

  async list() {
    return (await this.store.list()).map((record) => this.publicView(record));
  }

  async credential(workerId) {
    const id = String(workerId || '').trim().toLowerCase();
    const cached = this.secretCache.get(id);
    if (cached) {
      const isExpired = cached.cachedAt && (Date.now() - cached.cachedAt > SECRET_CACHE_TTL_MS);
      if (isExpired) {
        this.secretCache.delete(id);
      } else {
        if (typeof cached === 'object') {
          if (cached.enabled === false) return null;
          return cached.secret;
        }
        return cached;
      }
    }
    const record = await this.find(id);
    if (!record || record.enabled === false) {
      this.secretCache.delete(id);
      return null;
    }
    const secret = safeDecryptText(record.secretCiphertext, this.encryptionKey);
    if (secret) {
      this.secretCache.set(id, {
        secret,
        enabled: Boolean(record.enabled),
        cachedAt: Date.now()
      });
    }
    return secret || null;
  }

  async rotateSecret(workerId) {
    const record = await this.find(workerId);
    if (!record || !record.enabled) {
      throw new Error(`Worker ${workerId} is not registered or is disabled.`);
    }
    const oldSecret = safeDecryptText(record.secretCiphertext, this.encryptionKey);
    const secret = generateWorkerSecret();
    await this.store.update(record.workerId, { secretCiphertext: encryptSecret(secret, this.encryptionKey) });
    this.secretCache.set(record.workerId, {
      secret,
      previousSecret: oldSecret || null,
      graceUntil: Date.now() + ROTATION_GRACE_PERIOD_MS,
      enabled: Boolean(record.enabled),
      cachedAt: Date.now()
    });
    return secret;
  }

  invalidateWorkerSecret(workerId) {
    if (!workerId) {
      this.secretCache.clear();
      return true;
    }
    const id = String(workerId).trim().toLowerCase();
    return this.secretCache.delete(id);
  }

  invalidate(workerId) {
    return this.invalidateWorkerSecret(workerId);
  }

  async resetData(workerId) {
    const record = await this.find(workerId);
    if (!record || !record.enabled) throw new Error(`Worker ${workerId} is not registered or is disabled.`);
    await this.store.resetData(record.workerId);
    this.summaryCache.delete(record.workerId);
    this.botLogsCache.delete(record.workerId);
    this.secretCache.delete(record.workerId);
    return this.publicView(await this.find(record.workerId));
  }

  async authenticate(workerId, presentedSecret) {
    if (!workerId || typeof presentedSecret !== 'string') return false;
    const id = String(workerId).trim().toLowerCase();
    const cached = this.secretCache.get(id);
    const now = Date.now();
    if (cached && typeof cached === 'object') {
      if (cached.enabled === false) return false;
      const isExpired = cached.cachedAt && (now - cached.cachedAt > SECRET_CACHE_TTL_MS);
      if (!isExpired && cached.secret) {
        const left = Buffer.from(cached.secret, 'utf8');
        const right = Buffer.from(presentedSecret, 'utf8');
        if (left.length === right.length && crypto.timingSafeEqual(left, right)) {
          return true;
        }
      }
      if (cached.previousSecret && cached.graceUntil && now < cached.graceUntil) {
        const prevLeft = Buffer.from(cached.previousSecret, 'utf8');
        const right = Buffer.from(presentedSecret, 'utf8');
        if (prevLeft.length === right.length && crypto.timingSafeEqual(prevLeft, right)) {
          return true;
        }
      }
    }
    const expected = await this.credential(id).catch(() => null);
    if (!expected) return false;
    const left = Buffer.from(expected, 'utf8');
    const right = Buffer.from(presentedSecret, 'utf8');
    if (left.length === right.length && crypto.timingSafeEqual(left, right)) {
      return true;
    }
    const freshCached = this.secretCache.get(id);
    if (freshCached?.previousSecret && freshCached?.graceUntil && now < freshCached.graceUntil) {
      const prevLeft = Buffer.from(freshCached.previousSecret, 'utf8');
      if (prevLeft.length === right.length && crypto.timingSafeEqual(prevLeft, right)) {
        return true;
      }
    }
    return false;
  }

  verifyBotSecretSync(workerId, secret) {
    if (!workerId || typeof secret !== 'string') return false;
    const id = String(workerId).trim().toLowerCase();
    const cached = this.secretCache.get(id);
    if (!cached) return false;
    const now = Date.now();
    const isExpired = cached.cachedAt && (now - cached.cachedAt > SECRET_CACHE_TTL_MS);
    if (isExpired) {
      this.secretCache.delete(id);
      return false;
    }
    const expected = typeof cached === 'object' ? cached.secret : cached;
    if (typeof cached === 'object' && cached.enabled === false) return false;
    if (!expected) return false;
    const left = Buffer.from(expected, 'utf8');
    const right = Buffer.from(secret, 'utf8');
    if (left.length === right.length && crypto.timingSafeEqual(left, right)) {
      return true;
    }
    if (cached.previousSecret && cached.graceUntil && now < cached.graceUntil) {
      const prevLeft = Buffer.from(cached.previousSecret, 'utf8');
      if (prevLeft.length === right.length && crypto.timingSafeEqual(prevLeft, right)) {
        return true;
      }
    }
    return false;
  }

  async isBotSecretRequestForBot(presentedSecret, expectedBotId) {
    return this.authenticate(expectedBotId, presentedSecret);
  }

  async verifyBotSecret(workerId, secret) {
    return Boolean(await this.isBotSecretRequestForBot(secret, workerId));
  }

  async updateStatus(workerId, status, source) {
    const id = String(workerId || '').trim().toLowerCase();
    return this.statusLock.run(id, async () => {
      // 1. Kiểm tra worker tồn tại và đang enabled - không tự kích hoạt lại worker đã bị disable (Audit A-13)
      const existing = await this.find(id);
      if (!existing || existing.enabled === false) {
        this.secretCache.delete(id);
        return null;
      }

      // 2. Sequence check chống out-of-order race conditions ghi đè kết quả cũ (Audit A-08)
      const currentSeq = (this.summaryRequestSeq.get(id) || 0) + 1;
      this.summaryRequestSeq.set(id, currentSeq);

      const lastApplied = this.summaryLastAppliedSeq.get(id) || 0;
      if (currentSeq <= lastApplied) {
        return this.publicView(existing);
      }

      const safeStatus = validateWorkerStatus(status, source);

      // Preserve manuallyStopped flag across status reports if not explicitly provided
      if (status.manuallyStopped !== undefined) {
        safeStatus.manuallyStopped = Boolean(status.manuallyStopped);
      } else if (existing.status?.manuallyStopped !== undefined) {
        safeStatus.manuallyStopped = Boolean(existing.status.manuallyStopped);
      }

      const managerNow = new Date();

      // SYNC-16-01: Chống ghi đè trạng thái nếu payload cũ hơn trạng thái đang có (Worker time lastStateAt),
      // nhưng VẪN PHẢI cập nhật lastHeartbeat (Manager time) để tránh clock skew làm worker bị coi là offline/unreachable
      if (safeStatus.lastStateAt && existing.status?.lastStateAt) {
        if (safeStatus.lastStateAt.getTime() < new Date(existing.status.lastStateAt).getTime()) {
          const refreshed = await this.store.update(id, { lastHeartbeat: managerNow });
          return this.publicView(refreshed || { ...existing, lastHeartbeat: managerNow });
        }
      }

      // Bảo tồn cờ enabled của admin, KHÔNG tự ý set enabled: true
      const updated = await this.store.update(id, { status: safeStatus, lastHeartbeat: managerNow });

      this.summaryLastAppliedSeq.set(id, currentSeq);
      this.summaryCache.set(id, { timestamp: Date.now(), data: safeStatus });

      // Kiểm tra và gửi cảnh báo admin
      if (this.adminNotifier && updated && safeStatus.state === 'error') {
        const errText = safeStatus.lastError || '';
        const isGameEvent = /kick|banned|ban\b|ip_limited|quitting|lobby/i.test(errText) || /kick|banned|ban\b|ip_limited/i.test(safeStatus.lastKickReason || '');
        if (!isGameEvent && errText) {
          void this.adminNotifier.sendAlert({
            source: 'Worker System',
            event: 'worker_system_error',
            message: `Tiến trình Worker **${updated.name || id}** (#${updated.botNumber}) gặp lỗi: ${errText}`,
            details: {
              workerId: id,
              botNumber: updated.botNumber,
              botName: updated.name,
              provider: updated.provider,
              error: errText
            },
            level: 'error'
          });
        }
      }

      return updated;
    });
  }

  async touchHeartbeat(workerId) {
    const id = String(workerId || '').trim().toLowerCase();
    const existing = await this.find(id);
    if (!existing || existing.enabled === false) return null;
    const now = new Date();
    const updated = await this.store.update(id, { lastHeartbeat: now });
    return this.publicView(updated || { ...existing, lastHeartbeat: now });
  }

  async addEvent(workerId, event) {
    const id = String(workerId || '').trim().toLowerCase();
    const existing = await this.find(id);
    if (!existing || existing.enabled === false) {
      return null;
    }

    const rawMsg = event?.message || event?.reason || '';
    const cleanMsg = extractChatMessage(rawMsg);
    const safeEvent = {
      type: String(event?.type || 'worker_event').slice(0, 48),
      message: cleanMsg.replace(/[\r\n\t]+/g, ' ').slice(0, 300),
      occurredAt: event?.occurredAt ? new Date(event.occurredAt) : new Date()
    };
    if (Number.isNaN(safeEvent.occurredAt.getTime())) safeEvent.occurredAt = new Date();

    // Lưu vào RAM buffer (tối đa 100 entries)
    const logs = this.botLogsCache.get(id) || [];
    logs.push(safeEvent);
    if (logs.length > MAX_LOGS_PER_BOT) logs.shift();
    this.botLogsCache.set(id, logs);

    await this.store.addEvent(id, safeEvent);

    if (this.adminNotifier && ['crash', 'process_error', 'system_error'].includes(safeEvent.type)) {
      void this.adminNotifier.sendAlert({
        source: 'Worker System',
        event: `worker_${safeEvent.type}`,
        message: `Tiến trình Worker \`${id}\` gặp lỗi: ${safeEvent.message}`,
        details: { workerId: id, eventType: safeEvent.type },
        level: 'error'
      });
    }

    return safeEvent;
  }

  publicView(record) {
    const { secretCiphertext, _id, ...safe } = record;
    const settings = record.settings || {};
    safe.settings = {
      afkMode: 'still',
      proxyEnabled: settings.proxyManaged ? Boolean(settings.proxyCiphertext) : Boolean(record.status?.proxyEnabled),
      credentialsConfigured: Boolean(settings.mcCredentialsCiphertext)
    };
    safe.reachable = Boolean(record.lastHeartbeat && Date.now() - new Date(record.lastHeartbeat).getTime() <= 120000);
    return safe;
  }

  async bootstrap(workerId) {
    const worker = await this.find(workerId);
    if (!worker || !worker.enabled) return null;
    const state = worker.status?.state || 'unknown';
    const restriction = worker.status?.restriction || (['ip_limited', 'banned'].includes(state) ? state : null);
    const settings = worker.settings || {};
    return {
      state,
      restriction,
      restricted: Boolean(restriction),
      settings: {
        afkMode: 'still',
        ...(settings.proxyManaged ? { proxyUrl: settings.proxyCiphertext ? safeDecryptText(settings.proxyCiphertext, this.encryptionKey) : '' } : {})
      },
      credentials: safeDecryptJson(settings.mcCredentialsCiphertext, this.encryptionKey)
    };
  }

  async privateSettings(workerId) {
    const worker = await this.find(workerId);
    if (!worker) return null;
    const settings = worker.settings || {};
    return {
      afkMode: 'still',
      afkManaged: settings.afkManaged === true,
      proxyUrl: settings.proxyCiphertext ? safeDecryptText(settings.proxyCiphertext, this.encryptionKey) : '',
      proxyManaged: settings.proxyManaged === true,
      credentialsConfigured: Boolean(settings.mcCredentialsCiphertext),
      username: safeDecryptJson(settings.mcCredentialsCiphertext, this.encryptionKey)?.username || ''
    };
  }

  async updateCredentials(workerId, { username, password }) {
    const worker = await this.find(workerId);
    if (!worker || !worker.enabled) throw new Error('Worker is not registered or is disabled.');
    const name = String(username || '').trim();
    const suppliedPassword = String(password ?? '');
    if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new Error('Minecraft username must contain 1–64 printable characters.');
    }
    if (suppliedPassword.length > 256 || /[\u0000-\u001f\u007f]/.test(suppliedPassword)) {
      throw new Error('Minecraft password is invalid or too long.');
    }
    const current = worker.settings || {};
    let passwordValue = suppliedPassword;
    if (!passwordValue && current.mcCredentialsCiphertext) {
      passwordValue = safeDecryptJson(current.mcCredentialsCiphertext, this.encryptionKey)?.password || '';
    }
    if (!passwordValue) throw new Error('Enter a Minecraft password before saving this account.');
    const mcCredentialsCiphertext = encryptSecret(JSON.stringify({ username: name, password: passwordValue }), this.encryptionKey);
    await this.store.patchSettings(worker.workerId, { mcCredentialsCiphertext });
    return { username: name, credentialsConfigured: true };
  }

  async updateSettings(workerId, patch = {}) {
    const worker = await this.find(workerId);
    if (!worker || !worker.enabled) throw new Error('Worker is not registered or is disabled.');
    const next = {};
    if (Object.hasOwn(patch, 'alias')) {
      const alias = String(patch.alias || '').trim().slice(0, 64);
      next.alias = alias;
      if (typeof this.store.update === 'function') {
        await this.store.update(worker.workerId, { alias });
      }
    }
    if (Object.hasOwn(patch, 'tags')) {
      const tags = Array.isArray(patch.tags) ? patch.tags.map(t => String(t).slice(0, 32)) : [];
      next.tags = tags;
      if (typeof this.store.update === 'function') {
        await this.store.update(worker.workerId, { tags });
      }
    }
    if (Object.hasOwn(patch, 'afkMode')) {
      next.afkMode = 'still';
      next.afkManaged = true;
    }
    if (Object.hasOwn(patch, 'afkManaged')) next.afkManaged = Boolean(patch.afkManaged);
    if (Object.hasOwn(patch, 'proxyUrl') || Object.hasOwn(patch, 'proxy')) {
      const raw = String(patch.proxyUrl || patch.proxy || '').trim();
      if (raw) {
        let url;
        try {
          url = new URL(raw);
        } catch {
          throw new Error('Proxy must be a valid SOCKS5 URL.');
        }
        let port = Number(url.port);
        let username = '';
        let password = '';
        try {
          username = decodeURIComponent(url.username || '');
          password = decodeURIComponent(url.password || '');
        } catch {
          throw new Error('Proxy credentials are invalid.');
        }
        if (url.protocol !== 'socks5:' || !url.hostname || !Number.isInteger(port) || port < 1 || port > 65535
          || (url.pathname && url.pathname !== '/') || url.search || url.hash
          || username.length > 255 || password.length > 255 || /[\u0000-\u001f\u007f]/.test(username + password)) {
          throw new Error('Proxy must use socks5://host:port with optional username and password.');
        }
        if (isLocalOrPrivateHost(url.hostname)) throw new Error('Proxy cannot target a local or private network address.');
        next.proxyCiphertext = encryptSecret(raw, this.encryptionKey);
      } else {
        next.proxyCiphertext = null;
      }
      next.proxyManaged = true;
    }
    if (Object.hasOwn(patch, 'proxyManaged')) next.proxyManaged = Boolean(patch.proxyManaged);
    const updated = typeof this.store.patchSettings === 'function'
      ? await this.store.patchSettings(worker.workerId, next)
      : await this.store.update(worker.workerId, { settings: { ...(worker.settings || {}), ...next } });
    return {
      afkMode: 'still',
      proxyEnabled: Boolean(updated?.proxyCiphertext || next.proxyCiphertext)
    };
  }

  async setEnabled(workerId, enabled) {
    const id = String(workerId || '').trim().toLowerCase();
    const isEnabled = Boolean(enabled);
    const updated = await this.store.update(id, { enabled: isEnabled });
    if (!isEnabled) {
      this.secretCache.delete(id);
      this.summaryCache.delete(id);
    }
    return updated;
  }

  // Ergonomic helper delegates
  async get(workerId) {
    return this.find(workerId);
  }

  summary(workerId) {
    return this.summaryCache.get(String(workerId)) || null;
  }

  getLogs(workerId) {
    return this.botLogsCache.get(String(workerId)) || [];
  }

  async updateAlias(workerId, alias) {
    return this.updateSettings(workerId, { alias });
  }

  async updateTags(workerId, tags) {
    return this.updateSettings(workerId, { tags });
  }

  async updateProxy(workerId, proxy) {
    return this.updateSettings(workerId, { proxyUrl: proxy });
  }

  async saveConfig(workerId, config) {
    return this.updateSettings(workerId, config);
  }

  getAdminPassword() {
    return this.adminPassword || null;
  }

  setAdminPassword(password) {
    this.adminPassword = password;
  }

  async load() {
    return this.list();
  }

  async save() {
    return true;
  }
}

WorkerRegistry.WorkerRegistry = WorkerRegistry;
WorkerRegistry.ACTIONS = ACTIONS;
WorkerRegistry.validateWorkerStatus = validateWorkerStatus;
WorkerRegistry.VALID_WORKER_STATES = VALID_WORKER_STATES;

module.exports = WorkerRegistry;
module.exports.WorkerRegistry = WorkerRegistry;
module.exports.ACTIONS = ACTIONS;
module.exports.validateWorkerStatus = validateWorkerStatus;
module.exports.VALID_WORKER_STATES = VALID_WORKER_STATES;
