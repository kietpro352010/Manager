'use strict';

const AsyncKeyLock = require('../services/async-key-lock');
const { encryptUserPassword, isStoredCredentialCiphertext } = require('../utils/secrets');

const TABLE = 'manager_workers';
const REGISTRY_TABLE = 'bot_registry';
const SETTINGS_TABLE = 'bot_settings';

function isRpcUnavailableError(error) {
  if (!error) return false;
  const msg = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('function does not exist') ||
    msg.includes('does not exist') ||
    msg.includes('not found') ||
    msg.includes('not implemented') ||
    msg.includes('schema cache')
  );
}

const WORKER_LIST_COLUMNS = [
  'worker_id', 'bot_number', 'name', 'provider', 'service_url', 'render_service_id',
  'secret_ciphertext', 'enabled', 'settings', 'status', 'last_event',
  'last_heartbeat', 'created_at', 'updated_at'
].join(',');

const FIELDS = {
  workerId: 'worker_id', botNumber: 'bot_number', name: 'name', provider: 'provider',
  serviceUrl: 'service_url', renderServiceId: 'render_service_id', secretCiphertext: 'secret_ciphertext',
  enabled: 'enabled', settings: 'settings', status: 'status', events: 'events',
  lastEvent: 'last_event', lastHeartbeat: 'last_heartbeat', createdAt: 'created_at', updatedAt: 'updated_at'
};

function fromRow(row) {
  if (!row) return null;
  const out = {};
  for (const [key, column] of Object.entries(FIELDS)) out[key] = row[column];
  if (out.botNumber !== null && out.botNumber !== undefined) out.botNumber = Number(out.botNumber);
  return out;
}

function toRow(record, { omit = [] } = {}) {
  const out = {};
  for (const [key, column] of Object.entries(FIELDS)) {
    if (!omit.includes(key) && record[key] !== undefined) out[column] = record[key];
  }
  return out;
}

const WORKER_STALE_IF_ERROR_MS = 5 * 60 * 1000;

function isTransientWorkerStoreError(err) {
  if (!err) return false;
  const status = Number(err.status || err.statusCode || 0);
  if ([408, 429, 500, 502, 503, 504, 520, 521, 522, 524].includes(status)) return true;
  const msg = String(err.message || err.code || '');
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|timeout|aborted|HTTP 5\d\d|HTTP 429/i.test(msg);
}

class SupabaseWorkerStore {
  constructor(client, { cacheTtlMs = 30000 } = {}) {
    this.client = client;
    this.adapter = client.adapter || null;
    this.sequenceLock = new AsyncKeyLock();
    this._settingsLock = new AsyncKeyLock();
    this.lastAllocatedBotNumber = 0;
    const parsedTtl = Number(cacheTtlMs);
    this.cacheTtlMs = Number.isFinite(parsedTtl) && parsedTtl >= 0 ? parsedTtl : 30000;
    this._cacheGen = 0;
    this._listCache = null;
    this._listInFlight = null;
    this._itemCache = new Map();
    this._numberCache = new Map();
  }

  invalidateCache(workerId = null) {
    this._cacheGen += 1;
    this._listCache = null;
    this._listInFlight = null;
    if (workerId) {
      const id = String(workerId);
      const prev = this._itemCache.get(id);
      this._itemCache.delete(id);
      if (prev?.data?.botNumber !== undefined && prev?.data?.botNumber !== null) {
        this._numberCache.delete(Number(prev.data.botNumber));
      } else {
        this._numberCache.clear();
      }
    } else {
      this._itemCache.clear();
      this._numberCache.clear();
    }
  }

  _cloneWorker(worker) {
    if (!worker) return null;
    return {
      ...worker,
      ...(worker.settings && typeof worker.settings === 'object' ? { settings: { ...worker.settings } } : {}),
      ...(worker.status && typeof worker.status === 'object' ? { status: { ...worker.status } } : {}),
      ...(Array.isArray(worker.events) ? { events: worker.events.slice() } : {})
    };
  }

  _applyPatchToCaches(workerId, patch, updatedAtIso, mapped = null) {
    this._cacheGen += 1;
    const id = String(workerId || '');
    const now = Date.now();
    const buildUpdated = (entry) => {
      if (!entry) return null;
      if (mapped) return this._cloneWorker(mapped);
      const next = { ...entry, ...patch, updatedAt: updatedAtIso };
      if (patch.settings && typeof patch.settings === 'object') next.settings = patch.settings;
      if (patch.status && typeof patch.status === 'object') next.status = patch.status;
      return next;
    };

    const cachedHit = this._itemCache.get(id);
    const existingItem = cachedHit?.data || mapped;
    const prevNumber = existingItem?.botNumber;
    if (mapped) {
      if (prevNumber !== undefined && prevNumber !== null && prevNumber !== mapped.botNumber) {
        this._numberCache.delete(Number(prevNumber));
      }
      this._cacheWorker(mapped);
    } else if (existingItem && this.cacheTtlMs > 0) {
      const nextItem = buildUpdated(existingItem);
      if (prevNumber !== undefined && prevNumber !== null && nextItem.botNumber !== prevNumber) {
        this._numberCache.delete(Number(prevNumber));
      }
      this._cacheWorker(nextItem);
    } else {
      this._itemCache.delete(id);
      this._numberCache.clear();
    }

    if (this._listCache && now < this._listCache.expiresAt && Array.isArray(this._listCache.data)) {
      const idx = this._listCache.data.findIndex((w) => String(w?.workerId || '') === id);
      if (idx !== -1) {
        const listEntry = buildUpdated(this._listCache.data[idx]);
        this._listCache.data[idx] = listEntry;
        if (listEntry && !mapped && this.cacheTtlMs > 0) {
          this._cacheWorker(listEntry);
        }
      } else {
        this._listCache = null;
      }
    } else {
      this._listCache = null;
    }
  }

  _cacheWorker(worker) {
    if (!worker || !worker.workerId || this.cacheTtlMs <= 0) return;
    const expiresAt = Date.now() + this.cacheTtlMs;
    if (this._itemCache.size > 500) this._itemCache.clear();
    this._itemCache.set(String(worker.workerId), { data: worker, expiresAt });
    if (worker.botNumber !== null && worker.botNumber !== undefined && Number.isFinite(Number(worker.botNumber))) {
      if (this._numberCache.size > 500) this._numberCache.clear();
      this._numberCache.set(Number(worker.botNumber), { data: worker, expiresAt });
    }
  }

  async initialize() {
    try {
      const { error } = await this.client.from(TABLE).select('worker_id').limit(1);
      if (error && error.code !== 'PGRST116') {
        console.warn(`[WORKER_STORE] Table ${TABLE} check notice: ${error.message}`);
      }
    } catch (_) {}
  }

  async close() {
    // Managed fetch connection pooling in Node.js
  }

  async get(workerId, { includeEvents = false, bypassCache = false } = {}) {
    const id = String(workerId || '');
    if (!includeEvents && !bypassCache && this.cacheTtlMs > 0) {
      const hit = this._itemCache.get(id);
      if (hit && Date.now() < hit.expiresAt) {
        return this._cloneWorker(hit.data);
      }
      if (hit) this._itemCache.delete(id);
    }
    const gen = this._cacheGen;
    const columns = includeEvents ? '*' : WORKER_LIST_COLUMNS;
    const { data, error } = await this.client.from(TABLE).select(columns).eq('worker_id', workerId).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    const mapped = fromRow(data);
    if (!includeEvents && mapped && gen === this._cacheGen) this._cacheWorker(mapped);
    return this._cloneWorker(mapped);
  }

  async getByNumber(botNumber, { bypassCache = false } = {}) {
    const num = Number(botNumber);
    if (!bypassCache && this.cacheTtlMs > 0 && Number.isFinite(num)) {
      const hit = this._numberCache.get(num);
      if (hit && Date.now() < hit.expiresAt) {
        return this._cloneWorker(hit.data);
      }
      if (hit) this._numberCache.delete(num);
    }
    const gen = this._cacheGen;
    const { data, error } = await this.client.from(TABLE).select(WORKER_LIST_COLUMNS).eq('bot_number', num).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    const mapped = fromRow(data);
    if (mapped && gen === this._cacheGen) this._cacheWorker(mapped);
    return this._cloneWorker(mapped);
  }

  async list({ bypassCache = false } = {}) {
    if (!bypassCache && this.cacheTtlMs > 0 && this._listCache && Date.now() < this._listCache.expiresAt) {
      return this._listCache.data.map((w) => this._cloneWorker(w));
    }
    if (!bypassCache && this._listInFlight) {
      const shared = await this._listInFlight;
      return shared.map((w) => this._cloneWorker(w));
    }
    const fetchList = async () => {
      const gen = this._cacheGen;
      const { data, error } = await this.client.from(TABLE).select(WORKER_LIST_COLUMNS).order('bot_number', { ascending: true }).order('created_at', { ascending: true });
      if (error && error.code !== 'PGRST116') throw error;
      const mapped = (data || []).map(fromRow);
      if (this.cacheTtlMs > 0 && gen === this._cacheGen) {
        const expiresAt = Date.now() + this.cacheTtlMs;
        this._listCache = { data: mapped, expiresAt, staleUntil: expiresAt + WORKER_STALE_IF_ERROR_MS };
        this._itemCache.clear();
        this._numberCache.clear();
        for (const w of mapped) this._cacheWorker(w);
      }
      return mapped;
    };
    if (bypassCache) {
      const mapped = await fetchList();
      return mapped.map((w) => this._cloneWorker(w));
    }
    const promise = fetchList()
      .catch((err) => {
        if (isTransientWorkerStoreError(err) && this._listCache && Date.now() < (this._listCache.staleUntil || 0)) {
          return this._listCache.data;
        }
        throw err;
      })
      .finally(() => {
        if (this._listInFlight === promise) {
          this._listInFlight = null;
        }
      });
    this._listInFlight = promise;
    const mapped = await promise;
    return mapped.map((w) => this._cloneWorker(w));
  }

  async nextBotNumber() {
    return this.sequenceLock.run('next_bot_number', async () => {
      let rpcError = null;
      try {
        const { data, error } = await this.client.rpc('manager_next_bot_number');
        if (!error && data !== null && data !== undefined) {
          const num = Number(data);
          if (Number.isInteger(num) && num > 0) {
            this.lastAllocatedBotNumber = Math.max(this.lastAllocatedBotNumber, num);
            return num;
          }
        }
        rpcError = error;
      } catch (err) {
        rpcError = err;
      }

      if (rpcError && !isRpcUnavailableError(rpcError)) {
        throw rpcError;
      }

      // Fallback: tính max bot_number + 1
      const workers = await this.list({ bypassCache: true });
      const numbers = workers.map((w) => Number(w.botNumber || 0)).filter((n) => Number.isInteger(n) && n > 0);
      const dbMax = numbers.length > 0 ? Math.max(...numbers) : 0;
      const nextNum = Math.max(dbMax, this.lastAllocatedBotNumber) + 1;
      this.lastAllocatedBotNumber = nextNum;
      return nextNum;
    });
  }

  async create(worker) {
    const row = toRow(worker);
    const { error } = await this.client.from(TABLE).insert(row);
    if (error) throw error;
    this.invalidateCache();
    return worker;
  }

  async update(workerId, patch, { returning = true } = {}) {
    const updatedAtIso = new Date().toISOString();
    const query = this.client.from(TABLE).update({ ...toRow(patch), updated_at: updatedAtIso })
      .eq('worker_id', workerId);
    if (!returning) {
      const { error } = await query;
      if (error) throw error;
      this._applyPatchToCaches(workerId, patch, updatedAtIso, null);
      return null;
    }
    const { data, error } = await query.select(WORKER_LIST_COLUMNS).maybeSingle();
    if (error) throw error;
    const mapped = fromRow(data);
    if (mapped) {
      this._applyPatchToCaches(workerId, patch, updatedAtIso, mapped);
    } else {
      this.invalidateCache(workerId);
    }
    return this._cloneWorker(mapped);
  }

  async patchSettings(workerId, patch) {
    return this._settingsLock.run(String(workerId), async () => {
      let rpcError = null;
      try {
        const { data, error } = await this.client.rpc('manager_patch_worker_settings', {
          p_worker_id: workerId,
          p_patch: patch
        });
        if (!error) {
          this.invalidateCache(workerId);
          return data;
        }
        rpcError = error;
      } catch (err) {
        rpcError = err;
      }

      if (rpcError && !isRpcUnavailableError(rpcError)) {
        throw rpcError;
      }

      // Fallback: đọc trực tiếp và update JSON settings
      const current = await this.get(workerId, { bypassCache: true });
      if (!current) throw new Error(`Worker ${workerId} không tồn tại.`);
      const merged = { ...(current.settings || {}), ...patch };
      await this.update(workerId, { settings: merged });
      return merged;
    });
  }

  async resetData(workerId) {
    let rpcError = null;
    try {
      const { data, error } = await this.client.rpc('manager_reset_worker_data', { p_worker_id: workerId });
      if (!error) {
        if (data === true) {
          this.invalidateCache(workerId);
          return;
        }
        throw new Error(`Worker ${workerId} could not be reset or does not exist.`);
      }
      rpcError = error;
    } catch (err) {
      if (err.message && err.message.includes('could not be reset')) {
        throw err;
      }
      rpcError = err;
    }

    if (rpcError && !isRpcUnavailableError(rpcError)) {
      throw rpcError;
    }

    // Fallback: reset settings về rỗng (verify worker exists to match RPC semantics)
    const updated = await this.update(workerId, {
      settings: {},
      status: { state: 'offline', online: false },
      events: [],
      lastEvent: null
    });
    if (!updated) {
      throw new Error(`Worker ${workerId} could not be reset or does not exist.`);
    }
  }

  async remove(workerId) {
    const { data, error } = await this.client.from(TABLE).delete().eq('worker_id', workerId).select('worker_id');
    if (error) throw error;
    this.invalidateCache();
    return Boolean(data?.length);
  }

  async addEvent(workerId, event) {
    let rpcError = null;
    try {
      const { error } = await this.client.rpc('manager_append_worker_event', { p_worker_id: workerId, p_event: event });
      if (!error) {
        this._applyPatchToCaches(workerId, { lastEvent: event }, new Date().toISOString(), null);
        return;
      }
      rpcError = error;
    } catch (err) {
      rpcError = err;
    }

    if (rpcError && !isRpcUnavailableError(rpcError)) {
      throw rpcError;
    }

    // SYNC-16-02: Fallback đáng tin cậy khi RPC manager_append_worker_event chưa khả dụng:
    // Đọc worker hiện tại, kiểm tra idempotency key/nội dung để tránh duplicate,
    // duy trì mảng events bounded 100 phần tử (tương đồng logic SQL) và cập nhật lastEvent
    const current = await this.get(workerId, { includeEvents: true, bypassCache: true });
    if (!current) throw new Error(`Worker ${workerId} không tồn tại.`);

    const eventId = String(event?.id || event?.eventId || '').trim() ||
      `${event?.type || 'event'}_${new Date(event?.occurredAt || Date.now()).getTime()}_${Math.random().toString(36).slice(2, 8)}`;
    const safeEvent = { ...(event || {}), id: eventId };

    const existingEvents = Array.isArray(current.events) ? current.events : [];
    const isDuplicate = existingEvents.some((e) =>
      (safeEvent.id && e.id === safeEvent.id) ||
      (Boolean(safeEvent.message) && Boolean(safeEvent.occurredAt) &&
       e.type === safeEvent.type && e.message === safeEvent.message && String(e.occurredAt) === String(safeEvent.occurredAt))
    );

    const updatedEvents = isDuplicate ? existingEvents : [...existingEvents, safeEvent].slice(-100);

    await this.update(workerId, {
      lastEvent: safeEvent,
      events: updatedEvents
    });
  }

  // --------------------------------------------------------------------------
  // IN-GAME TELEMETRY & POSITION TRACKING (V12.1 Enterprise)
  // --------------------------------------------------------------------------
  async recordPositionChange(telemetry) {
    if (this.adapter && typeof this.adapter.recordBotPositionChange === 'function') {
      return await this.adapter.recordBotPositionChange(telemetry);
    }
    const { data, error } = await this.client.rpc('record_bot_position_change', {
      p_id: telemetry.id || null,
      p_bot_id: String(telemetry.botId),
      p_changed_at: telemetry.changedAt || new Date().toISOString(),
      p_to_position: telemetry.position || {},
      p_to_dimension: telemetry.dimension || 'unknown',
      p_location_state: telemetry.locationState || 'Unknown',
      p_reason: telemetry.reason || 'MOVE',
      p_event_key: telemetry.eventKey,
      p_min_distance: telemetry.minDistance || 5.0
    });
    if (error) throw error;
    return data;
  }

  // --------------------------------------------------------------------------
  // DIFFERENTIAL REGISTRY PATCHING (V12.1 Enterprise)
  // --------------------------------------------------------------------------
  async patchRegistry(patch = {}, pendingResets = {}, pendingResetDeletes = []) {
    if (this.adapter && typeof this.adapter.patchManagerRegistry === 'function') {
      return await this.adapter.patchManagerRegistry(patch, pendingResets, pendingResetDeletes);
    }
    const { data, error } = await this.client.rpc('patch_manager_registry', {
      p_patch: patch,
      p_pending_reset_patch: pendingResets,
      p_pending_reset_deletes: pendingResetDeletes
    });
    if (error) throw error;
    return data;
  }

  async getRegistry() {
    if (this.adapter && typeof this.adapter.fetchRegistry === 'function') {
      return await this.adapter.fetchRegistry();
    }
    const { data, error } = await this.client.from(REGISTRY_TABLE).select('*').eq('id', 'default').maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return data?.data || null;
  }

  async getBotSettings(botId) {
    if (this.adapter && typeof this.adapter.fetchBotSettings === 'function') {
      return await this.adapter.fetchBotSettings(botId);
    }
    const { data, error } = await this.client.from(SETTINGS_TABLE).select('*').eq('bot_id', String(botId)).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  async saveBotSettings(botId, payload = {}) {
    if (this.adapter && typeof this.adapter.saveBotSettings === 'function') {
      return await this.adapter.saveBotSettings(botId, payload);
    }
    const protectCredential = (raw, label) => {
      const val = String(raw ?? '');
      if (!val || val === '********') return '';
      if (isStoredCredentialCiphertext(val)) return val;
      const encrypted = encryptUserPassword(val);
      if (!encrypted) throw new Error(`Không tạo được ciphertext cho ${label}.`);
      return encrypted;
    };
    const settingsObj = payload.settings && typeof payload.settings === 'object' ? { ...payload.settings } : {};
    const proxyObj = payload.proxy && typeof payload.proxy === 'object' ? { ...payload.proxy } : {};
    if (Object.prototype.hasOwnProperty.call(proxyObj, 'password')) {
      proxyObj.password = protectCredential(proxyObj.password, 'password Proxy');
    }
    if (settingsObj.proxy && typeof settingsObj.proxy === 'object' && Object.prototype.hasOwnProperty.call(settingsObj.proxy, 'password')) {
      settingsObj.proxy = { ...settingsObj.proxy, password: protectCredential(settingsObj.proxy.password, 'password Proxy') };
    }
    const row = {
      bot_id: String(botId),
      settings: settingsObj,
      proxy: proxyObj,
      schedules: payload.schedules || [],
      auto_chat: payload.autoChat || [],
      updated_at: new Date().toISOString()
    };
    if (payload.username) row.username = payload.username;
    if (payload.password) row.password = protectCredential(payload.password, 'password bot');
    const { error } = await this.client.from(SETTINGS_TABLE).upsert(row, { onConflict: 'bot_id' });
    if (error) throw error;
  }
}

SupabaseWorkerStore.isRpcUnavailableError = isRpcUnavailableError;

module.exports = SupabaseWorkerStore;
