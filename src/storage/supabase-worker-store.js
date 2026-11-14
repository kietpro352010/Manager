'use strict';

const AsyncKeyLock = require('../services/async-key-lock');

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

class SupabaseWorkerStore {
  constructor(client) {
    this.client = client;
    this.adapter = client.adapter || null;
    this.sequenceLock = new AsyncKeyLock();
    this.lastAllocatedBotNumber = 0;
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

  async get(workerId) {
    const { data, error } = await this.client.from(TABLE).select('*').eq('worker_id', workerId).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return fromRow(data);
  }

  async getByNumber(botNumber) {
    const { data, error } = await this.client.from(TABLE).select('*').eq('bot_number', Number(botNumber)).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return fromRow(data);
  }

  async list() {
    const { data, error } = await this.client.from(TABLE).select('*').order('bot_number', { ascending: true }).order('created_at', { ascending: true });
    if (error && error.code !== 'PGRST116') throw error;
    return (data || []).map(fromRow);
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
      const workers = await this.list();
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
    return worker;
  }

  async update(workerId, patch) {
    const { data, error } = await this.client.from(TABLE).update({ ...toRow(patch), updated_at: new Date().toISOString() })
      .eq('worker_id', workerId).select('*').maybeSingle();
    if (error) throw error;
    return fromRow(data);
  }

  async patchSettings(workerId, patch) {
    let rpcError = null;
    try {
      const { data, error } = await this.client.rpc('manager_patch_worker_settings', {
        p_worker_id: workerId,
        p_patch: patch
      });
      if (!error) return data;
      rpcError = error;
    } catch (err) {
      rpcError = err;
    }

    if (rpcError && !isRpcUnavailableError(rpcError)) {
      throw rpcError;
    }

    // Fallback: đọc trực tiếp và update JSON settings
    const current = await this.get(workerId);
    if (!current) throw new Error(`Worker ${workerId} không tồn tại.`);
    const merged = { ...(current.settings || {}), ...patch };
    await this.update(workerId, { settings: merged });
    return merged;
  }

  async resetData(workerId) {
    let rpcError = null;
    try {
      const { data, error } = await this.client.rpc('manager_reset_worker_data', { p_worker_id: workerId });
      if (!error) {
        if (data === true) return;
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

    // Fallback: reset settings về rỗng
    await this.update(workerId, {
      settings: {},
      status: { state: 'offline', online: false },
      events: [],
      lastEvent: null
    });
  }

  async remove(workerId) {
    const { data, error } = await this.client.from(TABLE).delete().eq('worker_id', workerId).select('worker_id');
    if (error) throw error;
    return Boolean(data?.length);
  }

  async addEvent(workerId, event) {
    let rpcError = null;
    try {
      const { error } = await this.client.rpc('manager_append_worker_event', { p_worker_id: workerId, p_event: event });
      if (!error) return;
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
    const current = await this.get(workerId);
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
  // IN-GAME TELEMETRY & POSITION TRACKING (V11.8 Enterprise)
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
  // DIFFERENTIAL REGISTRY PATCHING (V11.8 Enterprise)
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
    const row = {
      bot_id: String(botId),
      settings: payload.settings || {},
      proxy: payload.proxy || {},
      schedules: payload.schedules || [],
      auto_chat: payload.autoChat || [],
      updated_at: new Date().toISOString()
    };
    if (payload.username) row.username = payload.username;
    if (payload.password) row.password = payload.password;
    const { error } = await this.client.from(SETTINGS_TABLE).upsert(row, { onConflict: 'bot_id' });
    if (error) throw error;
  }
}

SupabaseWorkerStore.isRpcUnavailableError = isRpcUnavailableError;

module.exports = SupabaseWorkerStore;
