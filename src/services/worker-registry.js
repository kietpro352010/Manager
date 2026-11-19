'use strict';

const crypto = require('node:crypto');
const AsyncKeyLock = require('./async-key-lock');
const { isLocalOrPrivateHost, validateProxyUrl } = require('./proxy-validation');
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

  const sanitizeItemEntry = (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const out = {};
    if (item.id !== undefined) out.id = item.id;
    const slotNum = asInteger(item.slot, 0, 100);
    if (slotNum !== null) out.slot = slotNum;
    if (item.name !== undefined) out.name = String(item.name || '').slice(0, 64);
    if (item.displayName !== undefined) out.displayName = String(item.displayName || '').slice(0, 128);
    if (item.count !== undefined) out.count = asInteger(item.count, 0, 6400) ?? 1;
    return out;
  };

  let sanitizedInventory;
  if (status.inventory === null) {
    sanitizedInventory = null;
  } else if (status.inventory && typeof status.inventory === 'object' && !Array.isArray(status.inventory)) {
    const rawInv = status.inventory;
    const items = Array.isArray(rawInv.items)
      ? rawInv.items.slice(0, 54).map(sanitizeItemEntry).filter(Boolean)
      : [];
    const slots = {};
    if (rawInv.slots && typeof rawInv.slots === 'object' && !Array.isArray(rawInv.slots)) {
      let slotCount = 0;
      for (const [k, v] of Object.entries(rawInv.slots)) {
        if (slotCount >= 60) break;
        const cleanItem = sanitizeItemEntry(v);
        if (cleanItem) {
          slots[String(k).slice(0, 8)] = cleanItem;
          slotCount += 1;
        }
      }
    }
    sanitizedInventory = {
      slots,
      items,
      revision: asInteger(rawInv.revision, 0) ?? 0
    };
    if (rawInv.armor && typeof rawInv.armor === 'object' && !Array.isArray(rawInv.armor)) {
      sanitizedInventory.armor = {
        head: sanitizeItemEntry(rawInv.armor.head),
        torso: sanitizeItemEntry(rawInv.armor.torso),
        legs: sanitizeItemEntry(rawInv.armor.legs),
        feet: sanitizeItemEntry(rawInv.armor.feet)
      };
    }
    if (rawInv.offhand !== undefined) sanitizedInventory.offhand = rawInv.offhand ? String(rawInv.offhand).slice(0, 64) : null;
    const selHotbar = asInteger(rawInv.selectedHotbar, 0, 8);
    if (selHotbar !== null) sanitizedInventory.selectedHotbar = selHotbar;
    for (const metricKey of ['health', 'food', 'totemCount', 'goldenAppleCount', 'foodCount']) {
      if (rawInv[metricKey] !== undefined) {
        const val = asInteger(rawInv[metricKey], 0, 6400);
        if (val !== null) sanitizedInventory[metricKey] = val;
      }
    }
  }

  let sanitizedWindow;
  if (status.currentWindow === null) {
    sanitizedWindow = null;
  } else if (status.currentWindow && typeof status.currentWindow === 'object' && !Array.isArray(status.currentWindow)) {
    const rawWin = status.currentWindow;
    sanitizedWindow = {
      ...(rawWin.id !== undefined && rawWin.id !== null ? { id: asInteger(rawWin.id, 0, 1000000) ?? String(rawWin.id).slice(0, 32) } : {}),
      title: String(rawWin.title || '').slice(0, 160),
      type: String(rawWin.type || '').slice(0, 64),
      revision: asInteger(rawWin.revision, 0) ?? 0,
      ...(rawWin.totalSlots !== undefined && rawWin.totalSlots !== null ? { totalSlots: asInteger(rawWin.totalSlots, 0, 256) ?? 0 } : {}),
      slots: Array.isArray(rawWin.slots)
        ? rawWin.slots.slice(0, 90).map(sanitizeItemEntry)
        : []
    };
  }

  const normalized = {
    state,
    online: Boolean(status.online ?? status.connected),
    username: String(status.username || '').slice(0, 64),
    connectedAt: status.connectedAt && !Number.isNaN(new Date(status.connectedAt).getTime())
      ? new Date(status.connectedAt).toISOString()
      : null,
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
  if (sanitizedInventory !== undefined) normalized.inventory = sanitizedInventory;
  if (sanitizedWindow !== undefined) normalized.currentWindow = sanitizedWindow;
  return normalized;
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
    this.workerSettingsRev = new Map(); // botId -> integer settings revision counter
    this.botLogRev = new Map(); // botId -> integer log revision counter
    this.botChatLogRev = new Map(); // botId -> integer chat log revision counter
    this.statusLock = new AsyncKeyLock();
  }

  getLogRevisions(workerId) {
    const id = String(workerId || '').trim().toLowerCase();
    return {
      logRevision: this.botLogRev.get(id) || 0,
      chatLogRevision: this.botChatLogRev.get(id) || 0
    };
  }

  bumpSettingsRevision(workerId) {
    const id = String(workerId || '').trim().toLowerCase();
    if (!id) return 1;
    const next = (this.workerSettingsRev.get(id) || 1) + 1;
    this.workerSettingsRev.set(id, next);
    return next;
  }

  getSettingsRevision(workerId) {
    const id = String(workerId || '').trim().toLowerCase();
    return this.workerSettingsRev.get(id) || 1;
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
      const withinGrace = Boolean(entry?.graceUntil && now < entry.graceUntil);
      if (!withinGrace && entry?.cachedAt && now - entry.cachedAt > SECRET_CACHE_TTL_MS) {
        this.secretCache.delete(botId);
      }
    }
    if (this.summaryRequestSeq.size > 500) {
      for (const botId of this.summaryRequestSeq.keys()) {
        if (!this.summaryCache.has(botId) && !this.liveHeartbeats.has(botId)) {
          this.summaryRequestSeq.delete(botId);
          this.summaryLastAppliedSeq.delete(botId);
        }
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
      this.summaryRequestSeq.delete(id);
      this.summaryLastAppliedSeq.delete(id);
      this.botLogsCache.delete(id);
      this.botLogRev.delete(id);
      this.botChatLogRev.delete(id);
      this.secretCache.delete(id);
      this.liveHeartbeats.delete(id);
      this.lastDbStatusPersistAt.delete(id);
      this.lastDbStatusFingerprint.delete(id);
      this.workerStateRev.delete(id);
      this.workerSettingsRev.delete(id);
      // Do NOT shift remaining workers' botNumber on deletion (botNumber is a stable identity
      // backed by manager_bot_number_seq; shifting it causes cross-tenant IDOR & UNIQUE collisions).
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
    this.bumpSettingsRevision(record.workerId);
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
          const lastPersistAt = this.lastDbStatusPersistAt.get(id) || 0;
          if (Date.now() - lastPersistAt >= 60000) {
            const refreshed = await this.store.update(id, { lastHeartbeat: managerNow }, { returning: false });
            this.lastDbStatusPersistAt.set(id, Date.now());
            return this.publicView(refreshed || { ...existing, lastHeartbeat: managerNow });
          }
          return this.publicView({ ...existing, lastHeartbeat: managerNow });
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
        safeStatus.totemCount ?? 0,
        safeStatus.inventory?.revision ?? '',
        safeStatus.currentWindow
          ? `${safeStatus.currentWindow.title || ''}:${Array.isArray(safeStatus.currentWindow.slots) ? safeStatus.currentWindow.slots.length : 0}:${safeStatus.currentWindow.revision ?? 0}`
          : (safeStatus.currentWindow === null ? 'closed' : '')
      ].join('|');

      const prevFingerprint = this.lastDbStatusFingerprint.get(id);
      if (prevFingerprint !== fingerprint) {
        this.bumpRevision(id);
      }

      const isHeartbeatSource = source === 'worker-heartbeat' || source === 'wispbyte-poll';
      const isLightweight = Boolean(status?.isLightweight === true || status?.digestUnchanged === true);
      const lastPersistAt = this.lastDbStatusPersistAt.get(id) || 0;
      const canCoalesceDbWrite = isHeartbeatSource && isLightweight && prevFingerprint === fingerprint && (Date.now() - lastPersistAt < 90000);

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
    this.botLogRev.set(id, (this.botLogRev.get(id) || 0) + 1);
    if (safeEvent.type === 'chat' || safeEvent.type === 'message') {
      this.botChatLogRev.set(id, (this.botChatLogRev.get(id) || 0) + 1);
    }
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
      credentialsConfigured: Boolean(settings.mcCredentialsCiphertext),
      ecoMode: settings.ecoMode !== false,
      autoTotem: settings.autoTotem !== false,
      antiHungry: settings.antiHungry !== false,
      autoReconnect: settings.autoReconnect !== false,
      antiAfkKick: settings.antiAfkKick !== false,
      userNotifyEnabled: settings.userNotifyEnabled !== false,
      notifyOnAfkKick: settings.notifyOnAfkKick !== false,
      notifyOnAfkRecover: settings.notifyOnAfkRecover !== false,
      notifyOnReconnectExhausted: settings.notifyOnReconnectExhausted !== false,
      spawnCommands: settings.spawnCommands || '',
      autoChatSchedules: Array.isArray(settings.autoChatSchedules) ? settings.autoChatSchedules : [],
      botSchedules: Array.isArray(settings.botSchedules) ? settings.botSchedules : []
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
      settingsRevision: this.getSettingsRevision(worker.workerId),
      settings: {
        afkMode: 'still',
        ecoMode: settings.ecoMode !== false,
        autoTotem: settings.autoTotem !== false,
        antiHungry: settings.antiHungry !== false,
        autoReconnect: settings.autoReconnect !== false,
        antiAfkKick: settings.antiAfkKick !== false,
        spawnCommands: String(settings.spawnCommands || ''),
        autoChatSchedules: Array.isArray(settings.autoChatSchedules) ? settings.autoChatSchedules : [],
        botSchedules: Array.isArray(settings.botSchedules) ? settings.botSchedules : [],
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
    this.bumpSettingsRevision(worker.workerId);
    return { username: name, credentialsConfigured: true };
  }

  async updateSettings(workerId, rawPatch = {}) {
    const worker = await this.find(workerId);
    if (!worker) throw new Error('Worker is not registered.');
    const nested = (rawPatch && typeof rawPatch.settings === 'object' && !Array.isArray(rawPatch.settings))
      ? rawPatch.settings
      : {};
    const patch = { ...nested, ...(rawPatch || {}) };
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

    // Core bot gameplay/automation & notification settings (F-08)
    for (const boolKey of ['ecoMode', 'autoTotem', 'antiHungry', 'autoReconnect', 'antiAfkKick', 'userNotifyEnabled', 'notifyOnAfkKick', 'notifyOnAfkRecover', 'notifyOnReconnectExhausted']) {
      if (Object.hasOwn(patch, boolKey) && patch[boolKey] !== undefined) {
        next[boolKey] = Boolean(patch[boolKey]);
      }
    }
    if (Object.hasOwn(patch, 'spawnCommands') && patch.spawnCommands !== undefined) {
      next.spawnCommands = String(patch.spawnCommands || '').slice(0, 1000);
    }
    if (Object.hasOwn(patch, 'autoChatSchedules')) {
      if (!Array.isArray(patch.autoChatSchedules)) {
        throw new Error('autoChatSchedules must be an array.');
      }
      next.autoChatSchedules = patch.autoChatSchedules.slice(0, 20).map((item) => {
        const s = item && typeof item === 'object' ? item : {};
        const rawMessages = Array.isArray(s.messages)
          ? s.messages.map((m) => String(m || '').trim().slice(0, 256)).filter(Boolean)
          : (s.message || s.text ? [String(s.message || s.text).trim().slice(0, 256)].filter(Boolean) : []);
        const rawTimes = Array.isArray(s.times)
          ? s.times.map((t) => String(t || '').trim().slice(0, 16)).filter(Boolean)
          : (s.time ? [String(s.time).trim().slice(0, 16)].filter(Boolean) : []);
        return {
          id: String(s.id || crypto.randomUUID().slice(0, 8)).slice(0, 48),
          enabled: s.enabled !== false,
          mode: s.mode === 'fixed' ? 'fixed' : 'interval',
          messages: rawMessages.slice(0, 20),
          message: rawMessages[0] || '',
          times: rawTimes.slice(0, 24),
          time: rawTimes[0] || '',
          intervalSeconds: Math.max(10, Math.min(604800, Number(s.intervalSeconds ?? s.intervalSec ?? s.interval ?? 3600) || 3600)),
          messageDelaySeconds: Math.max(0, Math.min(3600, Number(s.messageDelaySeconds ?? 2) || 0))
        };
      }).filter((item) => item.messages.length > 0);
    }
    if (Object.hasOwn(patch, 'botSchedules')) {
      if (!Array.isArray(patch.botSchedules)) {
        throw new Error('botSchedules must be an array.');
      }
      next.botSchedules = patch.botSchedules.slice(0, 20).map((item) => {
        const s = item && typeof item === 'object' ? item : {};
        if (Array.isArray(s.items)) {
          const mode = s.mode === 'cycle' ? 'cycle' : 'fixed';
          return {
            id: String(s.id || crypto.randomUUID().slice(0, 8)).slice(0, 48),
            enabled: s.enabled !== false,
            mode,
            items: s.items.slice(0, 30).map((sub, idx) => {
              const it = sub && typeof sub === 'object' ? sub : {};
              const act = ['start', 'stop', 'command'].includes(String(it.action || '').toLowerCase())
                ? String(it.action).toLowerCase()
                : 'stop';
              const out = {
                id: String(it.id || `${idx + 1}`).slice(0, 48),
                action: act
              };
              if (mode === 'fixed') {
                out.time = String(it.time || '04:30').trim().slice(0, 16);
              } else {
                out.afterMinutes = Math.max(1, Math.min(43200, Number(it.afterMinutes) || 120));
              }
              if (act === 'command') {
                out.command = String(it.command || '').trim().slice(0, 256);
              }
              return out;
            })
          };
        }
        const act = String(s.action || 'start').trim().toLowerCase();
        return {
          id: String(s.id || crypto.randomUUID().slice(0, 8)).slice(0, 48),
          enabled: s.enabled !== false,
          action: ['start', 'stop', 'restart', 'reconnect', 'chat', 'command'].includes(act) ? act : 'start',
          time: String(s.time || '00:00').trim().slice(0, 16),
          days: Array.isArray(s.days) ? s.days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [0, 1, 2, 3, 4, 5, 6],
          command: s.command ? String(s.command).trim().slice(0, 256) : '',
          message: s.message ? String(s.message).trim().slice(0, 256) : ''
        };
      });
    }

    if (Object.hasOwn(patch, 'proxyUrl') || Object.hasOwn(patch, 'proxy')) {
      const rawVal = Object.hasOwn(patch, 'proxyUrl') ? patch.proxyUrl : patch.proxy;
      const raw = (rawVal === null || rawVal === undefined) ? '' : String(rawVal).trim();
      if (raw) {
        let url;
        try {
          url = new URL(raw);
        } catch {
          throw new Error('Proxy must be a valid SOCKS5 URL.');
        }
        const port = Number(url.port);
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
        await validateProxyUrl(raw);
        next.proxyCiphertext = encryptSecret(raw, this.encryptionKey);
      } else {
        next.proxyCiphertext = null;
      }
      next.proxyManaged = true;
    }
    if (Object.hasOwn(patch, 'proxyManaged')) next.proxyManaged = Boolean(patch.proxyManaged);
    if (Object.hasOwn(patch, 'serverHost') && patch.serverHost) {
      next.serverHost = String(patch.serverHost).trim().slice(0, 128);
    }
    if (Object.hasOwn(patch, 'serverPort') && patch.serverPort) {
      const serverPort = Number(patch.serverPort);
      if (Number.isInteger(serverPort) && serverPort > 0 && serverPort <= 65535) {
        next.serverPort = serverPort;
      }
    }
    if (Object.hasOwn(patch, 'version') && patch.version) {
      next.version = String(patch.version).trim().slice(0, 32);
    }
    if (Object.hasOwn(patch, 'username') && patch.username) {
      next.username = String(patch.username).trim().slice(0, 64);
    }
    if (Object.keys(recordPatch).length > 0) {
      await this.store.update(worker.workerId, recordPatch);
    }
    const updated = Object.keys(next).length > 0
      ? (typeof this.store.patchSettings === 'function'
          ? await this.store.patchSettings(worker.workerId, next)
          : await this.store.update(worker.workerId, { settings: { ...(worker.settings || {}), ...next } }))
      : worker.settings;
    if (Object.keys(next).length > 0 || Object.keys(recordPatch).length > 0) {
      this.bumpRevision(worker.workerId);
      const workerFacingKeys = [
        'ecoMode', 'autoTotem', 'antiHungry', 'autoReconnect', 'antiAfkKick',
        'spawnCommands', 'autoChatSchedules', 'botSchedules',
        'proxyCiphertext', 'proxyManaged', 'afkMode', 'afkManaged',
        'serverHost', 'serverPort', 'version', 'username'
      ];
      if (workerFacingKeys.some((k) => Object.hasOwn(next, k))) {
        this.bumpSettingsRevision(worker.workerId);
      }
    }
    return {
      afkMode: 'still',
      proxyEnabled: Boolean(updated?.proxyCiphertext || next.proxyCiphertext),
      alias: next.alias ?? worker.alias ?? worker.name,
      tags: next.tags ?? worker.tags ?? [],
      rentable: next.rentable ?? worker.rentable !== false,
      serviceUrl: recordPatch.serviceUrl ?? worker.serviceUrl,
      ecoMode: (next.ecoMode ?? worker.settings?.ecoMode) !== false,
      autoTotem: (next.autoTotem ?? worker.settings?.autoTotem) !== false,
      antiHungry: (next.antiHungry ?? worker.settings?.antiHungry) !== false,
      autoReconnect: (next.autoReconnect ?? worker.settings?.autoReconnect) !== false,
      antiAfkKick: (next.antiAfkKick ?? worker.settings?.antiAfkKick) !== false,
      userNotifyEnabled: (next.userNotifyEnabled ?? worker.settings?.userNotifyEnabled) !== false,
      notifyOnAfkKick: (next.notifyOnAfkKick ?? worker.settings?.notifyOnAfkKick) !== false,
      notifyOnAfkRecover: (next.notifyOnAfkRecover ?? worker.settings?.notifyOnAfkRecover) !== false,
      notifyOnReconnectExhausted: (next.notifyOnReconnectExhausted ?? worker.settings?.notifyOnReconnectExhausted) !== false,
      spawnCommands: next.spawnCommands ?? worker.settings?.spawnCommands ?? '',
      autoChatSchedules: next.autoChatSchedules ?? worker.settings?.autoChatSchedules ?? [],
      botSchedules: next.botSchedules ?? worker.settings?.botSchedules ?? []
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

  async saveConfig(workerId, config = {}) {
    const existing = await this.find(workerId);
    if (!existing) {
      const added = await this.add({
        workerId,
        name: config.name || config.alias,
        provider: config.provider || 'wispbyte',
        serviceUrl: config.serviceUrl || config.url || '',
        serviceId: config.renderServiceId || config.serviceId || ''
      });
      if (config.settings || config.tags || config.alias || config.rentable !== undefined) {
        await this.updateSettings(added.worker.workerId, config);
      }
      return added.worker;
    }
    return this.updateSettings(workerId, config);
  }

  getAdminPassword() {
    return this.adminPassword || null;
  }

  setAdminPassword(password) {
    this.adminPassword = password;
  }

  async load() {
    if (typeof this.store?.invalidateCache === 'function') {
      this.store.invalidateCache();
    }
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
