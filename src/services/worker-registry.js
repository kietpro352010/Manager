'use strict';

const crypto = require('node:crypto');
const { isLocalOrPrivateHost } = require('./proxy-validation');
const { encryptSecret, decryptSecret, generateWorkerSecret } = require('../utils/secrets');
const { extractChatMessage } = require('../utils/text-format');

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const ACTIONS = new Set([
  'start', 'stop', 'restart', 'status', 'chat', 'reset', 'set-afk-mode', 'set-proxy'
]);

const BOT_SUMMARY_CACHE_MS = 2000;
const MAX_LOGS_PER_BOT = 100;

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
    if (this.secretCache.has(id)) return this.secretCache.get(id);
    const record = await this.find(id);
    if (!record || !record.enabled) return null;
    const secret = decryptSecret(record.secretCiphertext, this.encryptionKey);
    if (secret) this.secretCache.set(id, secret);
    return secret;
  }

  async rotateSecret(workerId) {
    const record = await this.find(workerId);
    if (!record) throw new Error(`Worker ${workerId} is not registered.`);
    const secret = generateWorkerSecret();
    await this.store.update(record.workerId, { secretCiphertext: encryptSecret(secret, this.encryptionKey) });
    this.secretCache.set(record.workerId, secret);
    return secret;
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
    const expected = await this.credential(workerId).catch(() => null);
    if (!expected || typeof presentedSecret !== 'string') return false;
    const left = Buffer.from(expected, 'utf8');
    const right = Buffer.from(presentedSecret, 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  verifyBotSecretSync(workerId, secret) {
    if (!workerId || typeof secret !== 'string') return false;
    const expected = this.secretCache.get(String(workerId).trim().toLowerCase());
    if (!expected) return false;
    const left = Buffer.from(expected, 'utf8');
    const right = Buffer.from(secret, 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  async isBotSecretRequestForBot(presentedSecret, expectedBotId) {
    return this.authenticate(expectedBotId, presentedSecret);
  }

  async updateStatus(workerId, status, source) {
    const id = String(workerId || '').trim().toLowerCase();

    // Sequence check chống ghi đè kết quả cũ
    const currentSeq = (this.summaryRequestSeq.get(id) || 0) + 1;
    this.summaryRequestSeq.set(id, currentSeq);

    const asNumber = (value, max = Number.MAX_SAFE_INTEGER) =>
      value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
        ? Math.max(0, Math.min(max, Number(value)))
        : null;

    const safeStatus = {
      state: String(status?.state || 'unknown').slice(0, 40),
      online: Boolean(status?.online ?? status?.connected),
      username: String(status?.username || '').slice(0, 64),
      uptimeSeconds: Number.isFinite(Number(status?.uptimeSeconds)) ? Math.max(0, Number(status.uptimeSeconds)) : null,
      pingMs: asNumber(status?.pingMs, 600000),
      managerLatencyMs: asNumber(status?.managerLatencyMs, 600000),
      transport: String(status?.transport || '').slice(0, 24),
      reconnectAttempts: Number.isFinite(Number(status?.reconnectAttempts)) ? Math.max(0, Number(status.reconnectAttempts)) : 0,
      reconnectCount: Number.isFinite(Number(status?.reconnectCount)) ? Math.max(0, Number(status.reconnectCount)) : 0,
      afkMode: 'still',
      proxyEnabled: Boolean(status?.proxyEnabled),
      lastError: String(status?.lastError || '').slice(0, 240),
      lastKickReason: String(status?.lastKickReason || '').slice(0, 240),
      restriction: String(status?.restriction || '').slice(0, 40) || null,
      maintenanceWindow: Boolean(status?.maintenanceWindow),
      maintenanceTimeZone: String(status?.maintenanceTimeZone || '').slice(0, 40),
      maintenanceStart: String(status?.maintenanceStart || '').slice(0, 5),
      maintenanceEnd: String(status?.maintenanceEnd || '').slice(0, 5),
      tps: typeof status?.tps === 'number' && Number.isFinite(status.tps) ? Math.max(0, Math.min(20, status.tps)) : null,
      cpuPercent: asNumber(status?.cpuPercent, 100),
      rssMb: asNumber(status?.rssMb, 65536),
      heapUsedMb: asNumber(status?.heapUsedMb, 65536),
      health: asNumber(status?.health, 20),
      food: asNumber(status?.food, 20),
      totemCount: asNumber(status?.totemCount, 1000),
      goldenAppleCount: asNumber(status?.goldenAppleCount, 1000),
      position: status?.position && ['x', 'y', 'z'].every((axis) => Number.isFinite(Number(status.position[axis])))
        ? { x: Number(status.position.x), y: Number(status.position.y), z: Number(status.position.z) }
        : null,
      dimension: String(status?.dimension || '').slice(0, 40),
      lastStateAt: status?.lastStateAt ? new Date(status.lastStateAt) : null,
      updatedAt: new Date(),
      source
    };

    const updated = await this.store.update(id, { status: safeStatus, lastHeartbeat: new Date(), enabled: true });

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
  }

  async addEvent(workerId, event) {
    const id = String(workerId || '').trim().toLowerCase();
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
        ...(settings.proxyManaged ? { proxyUrl: settings.proxyCiphertext ? decryptSecret(settings.proxyCiphertext, this.encryptionKey) : '' } : {})
      },
      credentials: settings.mcCredentialsCiphertext
        ? JSON.parse(decryptSecret(settings.mcCredentialsCiphertext, this.encryptionKey))
        : null
    };
  }

  async privateSettings(workerId) {
    const worker = await this.find(workerId);
    if (!worker) return null;
    const settings = worker.settings || {};
    return {
      afkMode: 'still',
      afkManaged: settings.afkManaged === true,
      proxyUrl: settings.proxyCiphertext ? decryptSecret(settings.proxyCiphertext, this.encryptionKey) : '',
      proxyManaged: settings.proxyManaged === true,
      credentialsConfigured: Boolean(settings.mcCredentialsCiphertext),
      username: settings.mcCredentialsCiphertext
        ? JSON.parse(decryptSecret(settings.mcCredentialsCiphertext, this.encryptionKey)).username
        : ''
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
      passwordValue = JSON.parse(decryptSecret(current.mcCredentialsCiphertext, this.encryptionKey)).password;
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
    if (Object.hasOwn(patch, 'afkMode')) {
      next.afkMode = 'still';
      next.afkManaged = true;
    }
    if (Object.hasOwn(patch, 'afkManaged')) next.afkManaged = Boolean(patch.afkManaged);
    if (Object.hasOwn(patch, 'proxyUrl')) {
      const raw = String(patch.proxyUrl || '').trim();
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
    const updated = await this.store.patchSettings(worker.workerId, next);
    return {
      afkMode: 'still',
      proxyEnabled: Boolean(updated.proxyCiphertext)
    };
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
    return this.updateSettings(workerId, { proxy });
  }

  async saveConfig(workerId, config) {
    return this.updateSettings(workerId, config);
  }

  verifyBotSecret(workerId, secret) {
    return this.isBotSecretRequestForBot(secret, workerId);
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

module.exports = { WorkerRegistry, ACTIONS };
