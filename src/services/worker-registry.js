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
    locationState: String(status.locationState || '').slice(0, 32) || 'unknown',
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
    this.liveHeartbeats = new Map(); // botId -> Date (live RAM heartbeat timestamp)
    this.lastDbStatusPersistAt = new Map(); // botId -> ms (coalesce redundant DB status writes)
    this.lastDbStatusFingerprint = new Map(); // botId -> string (state signature)
    this.workerStateRev = new Map(); // botId -> integer revision counter
    this.statusLock = new AsyncKeyLock();
  }

  bumpRevision(workerId) {
    const id = String(workerId || '').trim().toLowerCase();
    const next = (this.workerStateRev.get(id) || 0) + 1;
    this.workerStateRev.set(id, next);
    return next;
  }

  getSnapshotRevision(worker, { inventory = null, logs = null } = {}) {
    if (!worker) return '0';
    const id = String(worker.workerId || '').trim().toLowerCase();
    const status = worker.status || {};
    const settings = worker.settings || {};
    const invRev = inventory?.revision ?? status.inventory?.revision ?? 0;
    const logList = Array.isArray(logs) ? logs : this.getLogs(id);
    const lastLog = logList.length ? logList[logList.length - 1] : null;
    const keyParts = [
      this.workerStateRev.get(id) || 0,
      Boolean(worker.enabled),
      Boolean(worker.reachable),
      status.state || '',
      Boolean(status.online),
      status.username || '',
      status.locationState || '',
      status.dimension || '',
      status.health ?? '',
      status.food ?? '',
      status.totemCount ?? 0,
      status.goldenAppleCount ?? 0,
      status.reconnectAttempts ?? 0,
      Boolean(status.manuallyStopped),
      status.lastError || '',
      status.lastKickReason || '',
      status.restriction || '',
      status.position ? `${Math.round(status.position.x)},${Math.round(status.position.y ?? 0)},${Math.round(status.position.z)}` : '',
      status.currentWindow ? `${status.currentWindow.title || ''}:${Array.isArray(status.currentWindow.slots) ? status.currentWindow.slots.length : 0}` : '',
      invRev,
      logList.length,
      lastLog ? String(lastLog.occurredAt || '') : '',
      settings.alias || '',
      settings.mcCredentialsCiphertext ? settings.mcCredentialsCiphertext.slice(-16) : '',
      settings.proxyCiphertext ? settings.proxyCiphertext.slice(-16) : '',
      settings.spawnCommands || '',
      JSON.stringify(settings.autoChatSchedules || []),
      JSON.stringify(settings.botSchedules || [])
    ].join('|');
    return crypto.createHash('sha1').update(keyParts).digest('hex').slice(0, 16);
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

  async add({ workerId, name, provider, serviceUrl = '', serviceId = '', secret: customSecret }) {
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

    if (customSecret !== undefined && customSecret !== null) {
      const trimmedSecret = typeof customSecret === 'string' ? customSecret.trim() : String(customSecret).trim();
      if (typeof customSecret !== 'string' || trimmedSecret.length < 32) {
        throw new Error('Worker secret must be at least 32 characters');
      }
    }

    const secret = (customSecret !== undefined && customSecret !== null) ? String(customSecret).trim() : generateWorkerSecret();
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
    this.secretCache.set(id, { secret, enabled: true, cachedAt: Date.now() });
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
      this.liveHeartbeats.delete(id);
      this.lastDbStatusPersistAt.delete(id);
      this.lastDbStatusFingerprint.delete(id);
      this.workerStateRev.delete(id);
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

  applyLiveTelemetry(record) {
    if (!record) return null;
    const id = String(record.workerId || '').trim().toLowerCase();
    const merged = { ...record };
    const dbRowUpdated = merged.updatedAt ? new Date(merged.updatedAt).getTime() : 0;
    const liveHeartbeat = this.liveHeartbeats.get(id);
    if (liveHeartbeat) {
      const dbHb = merged.lastHeartbeat ? new Date(merged.lastHeartbeat).getTime() : 0;
      if (liveHeartbeat.getTime() > dbHb) {
        merged.lastHeartbeat = liveHeartbeat;
      }
    }
    const cachedSummary = this.summaryCache.get(id);
    if (cachedSummary?.data) {
      const cacheUpdated = cachedSummary.data.updatedAt ? new Date(cachedSummary.data.updatedAt).getTime() : cachedSummary.timestamp;
      const dbStatusUpdated = merged.status?.updatedAt ? new Date(merged.status.updatedAt).getTime() : 0;
      const looksExternallyReset = Boolean(
        merged.status &&
        merged.status.state === 'offline' &&
        !merged.status.updatedAt &&
        dbRowUpdated > cacheUpdated + 50
      );
      if (!looksExternallyReset && cacheUpdated >= dbStatusUpdated) {
        merged.status = { ...(merged.status || {}), ...cachedSummary.data };
      }
    }
    return this.computeReachable(merged);
  }

  async find(workerId) {
    const record = await this.store.get(String(workerId || '').trim().toLowerCase());
    return this.applyLiveTelemetry(record);
  }

  async findByNumber(botNumber) {
    const number = Number(botNumber);
    if (!Number.isInteger(number) || number <= 0) return null;
    const record = await this.store.getByNumber(number);
    return this.applyLiveTelemetry(record);
  }

  async list() {
    return (await this.store.list()).map((record) => this.publicView(this.applyLiveTelemetry(record)));
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

  async setSecret(workerId, secret) {
    const record = await this.find(workerId);
    if (!record || !record.enabled) {
      throw new Error(`Worker ${workerId} is not registered or is disabled.`);
    }
    if (secret === undefined || secret === null || typeof secret !== 'string' || secret.trim().length < 32) {
      throw new Error('Worker secret must be at least 32 characters');
    }
    const trimmed = secret.trim();
    await this.store.update(record.workerId, { secretCiphertext: encryptSecret(trimmed, this.encryptionKey) });
    this.secretCache.set(record.workerId, {
      secret: trimmed,
      enabled: Boolean(record.enabled),
      cachedAt: Date.now()
    });
    return trimmed;
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
    this.liveHeartbeats.delete(record.workerId);
    this.lastDbStatusPersistAt.delete(record.workerId);
    this.lastDbStatusFingerprint.delete(record.workerId);
    this.bumpRevision(record.workerId);
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
      if (safeStatus.state === 'unknown' && existing.status?.state && !status?.state) {
        safeStatus.state = existing.status.state;
      }

      // Preserve manuallyStopped flag across status reports if not explicitly provided
      if (status.manuallyStopped !== undefined) {
        safeStatus.manuallyStopped = Boolean(status.manuallyStopped);
      } else if (existing.status?.manuallyStopped !== undefined) {
        safeStatus.manuallyStopped = Boolean(existing.status.manuallyStopped);
      }

      // Preserve rich telemetry if incoming report is lightweight/partial
      if (status?.isLightweight === true && existing.status) {
        if (safeStatus.inventory === undefined && existing.status.inventory !== undefined) {
          safeStatus.inventory = existing.status.inventory;
        }
        if (safeStatus.currentWindow === undefined && existing.status.currentWindow !== undefined) {
          safeStatus.currentWindow = existing.status.currentWindow;
        }
        if (!safeStatus.position && existing.status.position) {
          safeStatus.position = existing.status.position;
        }
      }

      const managerNow = new Date();

      // SYNC-16-01: Chống ghi đè trạng thái nếu payload cũ hơn trạng thái đang có (Worker time lastStateAt),
      // nhưng VẪN PHẢI cập nhật lastHeartbeat (Manager time) để tránh clock skew làm worker bị coi là offline/unreachable
      if (safeStatus.lastStateAt && existing.status?.lastStateAt) {
        if (safeStatus.lastStateAt.getTime() < new Date(existing.status.lastStateAt).getTime()) {
          this.liveHeartbeats.set(id, managerNow);
          const refreshed = await this.store.update(id, { lastHeartbeat: managerNow });
          return this.publicView(refreshed || { ...existing, lastHeartbeat: managerNow });
        }
      }

      this.summaryLastAppliedSeq.set(id, currentSeq);
      this.summaryCache.set(id, { timestamp: Date.now(), data: safeStatus });
      this.liveHeartbeats.set(id, managerNow);

      const fingerprint = [
        safeStatus.state,
        Boolean(safeStatus.online),
        safeStatus.username || '',
        safeStatus.lastError || '',
        safeStatus.lastKickReason || '',
        safeStatus.restriction || '',
        Boolean(safeStatus.manuallyStopped),
        safeStatus.locationState || '',
        Boolean(safeStatus.maintenanceWindow),
        Boolean(safeStatus.proxyEnabled),
        safeStatus.reconnectAttempts || 0,
        safeStatus.health ?? '',
        safeStatus.totemCount ?? 0
      ].join('|');

      const prevFingerprint = this.lastDbStatusFingerprint.get(id);
      if (prevFingerprint !== fingerprint) {
        this.bumpRevision(id);
      }

      const isHeartbeatSource = source === 'worker-heartbeat' || source === 'wispbyte-poll';
      const isLightweight = Boolean(status?.isLightweight === true || status?.digestUnchanged === true);
      const lastPersistAt = this.lastDbStatusPersistAt.get(id) || 0;
      const canCoalesceDbWrite = isHeartbeatSource && isLightweight && prevFingerprint === fingerprint && (Date.now() - lastPersistAt < 60000);

      if (canCoalesceDbWrite) {
        return { ...existing, status: safeStatus, lastHeartbeat: managerNow };
      }

      // Bảo tồn cờ enabled của admin, KHÔNG tự ý set enabled: true
      const rawUpdated = await this.store.update(id, { status: safeStatus, lastHeartbeat: managerNow }, { returning: false });
      const updated = rawUpdated || { ...existing, status: safeStatus, lastHeartbeat: managerNow, updatedAt: managerNow };
      this.lastDbStatusFingerprint.set(id, fingerprint);
      this.lastDbStatusPersistAt.set(id, Date.now());

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
    this.bumpRevision(id);

    // High-frequency ephemeral chat messages stay in RAM buffer to protect Supabase storage & Log Ingestion
    if (safeEvent.type !== 'chat' && safeEvent.type !== 'message') {
      await this.store.addEvent(id, safeEvent);
    }

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
    safe.alias = String(settings.alias || record.alias || record.name || '');
    safe.tags = Array.isArray(settings.tags)
      ? [...new Set(settings.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))]
      : (Array.isArray(record.tags) ? record.tags : []);
    safe.rentable = settings.rentable === undefined
      ? record.rentable !== false
      : settings.rentable !== false;
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
    const creds = safeDecryptJson(settings.mcCredentialsCiphertext, this.encryptionKey);
    return {
      afkMode: 'still',
      afkManaged: settings.afkManaged === true,
      proxyUrl: settings.proxyCiphertext ? safeDecryptText(settings.proxyCiphertext, this.encryptionKey) : '',
      proxyManaged: settings.proxyManaged === true,
      credentialsConfigured: Boolean(settings.mcCredentialsCiphertext),
      username: creds?.username || '',
      password: creds?.password || ''
    };
  }

  async updateCredentials(workerId, { username, password }) {
    const worker = await this.find(workerId);
    if (!worker || !worker.enabled) throw new Error('Worker is not registered or is disabled.');
    const name = String(username || '').trim();
    const hasSuppliedPassword = password !== undefined && password !== null && String(password) !== '';
    if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new Error('Minecraft username must contain 1–64 printable characters.');
    }
    const current = worker.settings || {};
    let passwordValue = hasSuppliedPassword ? String(password) : '';
    if (!hasSuppliedPassword && current.mcCredentialsCiphertext) {
      passwordValue = safeDecryptJson(current.mcCredentialsCiphertext, this.encryptionKey)?.password || '';
    }
    const mcCredentialsCiphertext = encryptSecret(JSON.stringify({ username: name, password: passwordValue }), this.encryptionKey);
    await this.store.patchSettings(worker.workerId, { mcCredentialsCiphertext });
    this.bumpRevision(worker.workerId);
    return { username: name, credentialsConfigured: true };
  }

  async updateSettings(workerId, patch = {}) {
    const worker = await this.find(workerId);
    if (!worker) throw new Error('Worker is not registered.');
    const next = {};
    const recordPatch = {};
    if (Object.hasOwn(patch, 'alias')) {
      const alias = String(patch.alias || '').trim().slice(0, 64);
      next.alias = alias;
    }
    if (Object.hasOwn(patch, 'tags')) {
      const tags = Array.isArray(patch.tags)
        ? [...new Set(patch.tags.map((tag) => String(tag || '').trim().toLowerCase().replace(/^#/, '').slice(0, 32)).filter(Boolean))].slice(0, 20)
        : [];
      next.tags = tags;
    }
    if (Object.hasOwn(patch, 'rentable')) next.rentable = patch.rentable !== false;
    if (Object.hasOwn(patch, 'serviceUrl')) {
      const serviceUrl = String(patch.serviceUrl || '').trim().replace(/\/+$/, '');
      if (serviceUrl && !/^https:\/\//i.test(serviceUrl) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(serviceUrl)) {
        throw new Error('Worker URL must use HTTPS.');
      }
      if (!serviceUrl && worker.provider === 'render' && !worker.renderServiceId) {
        throw new Error('Render workers need a service URL or Render service ID.');
      }
      recordPatch.serviceUrl = serviceUrl;
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
    if (Object.hasOwn(patch, 'serverHost') && patch.serverHost) {
      const serverHost = String(patch.serverHost).trim();
      next.serverHost = serverHost;
      if (typeof this.store.update === 'function') {
        await this.store.update(worker.workerId, { serverHost });
      }
    }
    if (Object.hasOwn(patch, 'serverPort') && patch.serverPort) {
      const serverPort = Number(patch.serverPort);
      if (Number.isInteger(serverPort) && serverPort > 0 && serverPort <= 65535) {
        next.serverPort = serverPort;
        if (typeof this.store.update === 'function') {
          await this.store.update(worker.workerId, { serverPort });
        }
      }
    }
    if (Object.hasOwn(patch, 'version') && patch.version) {
      const version = String(patch.version).trim();
      next.version = version;
      if (typeof this.store.update === 'function') {
        await this.store.update(worker.workerId, { version });
      }
    }
    if (Object.hasOwn(patch, 'username') && patch.username) {
      const username = String(patch.username).trim();
      next.username = username;
      if (typeof this.store.update === 'function') {
        await this.store.update(worker.workerId, { username });
      }
    }
    if (Object.keys(recordPatch).length > 0) {
      await this.store.update(worker.workerId, recordPatch);
    }
    const updated = Object.keys(next).length > 0
      ? (typeof this.store.patchSettings === 'function'
          ? await this.store.patchSettings(worker.workerId, next)
          : await this.store.update(worker.workerId, { settings: { ...(worker.settings || {}), ...next } }))
      : worker.settings;
    return {
      afkMode: 'still',
      proxyEnabled: Boolean(updated?.proxyCiphertext || next.proxyCiphertext),
      alias: next.alias ?? worker.alias ?? worker.name,
      tags: next.tags ?? worker.tags ?? [],
      rentable: next.rentable ?? worker.rentable !== false,
      serviceUrl: recordPatch.serviceUrl ?? worker.serviceUrl
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
