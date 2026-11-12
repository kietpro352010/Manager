'use strict';

const TABLE = 'manager_workers';
const REGISTRY_TABLE = 'bot_registry';
const SETTINGS_TABLE = 'bot_settings';

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
    try {
      const { data, error } = await this.client.rpc('manager_next_bot_number');
      if (!error && data !== null && data !== undefined) return Number(data);
    } catch (_) {}

    // Fallback: tính max bot_number + 1
    const workers = await this.list();
    const numbers = workers.map((w) => Number(w.botNumber || 0)).filter((n) => Number.isInteger(n) && n > 0);
    return (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
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
    try {
      const { data, error } = await this.client.rpc('manager_patch_worker_settings', {
        p_worker_id: workerId,
        p_patch: patch
      });
      if (!error) return data;
    } catch (_) {}

    // Fallback: đọc trực tiếp và update JSON settings
    const current = await this.get(workerId);
    if (!current) throw new Error(`Worker ${workerId} không tồn tại.`);
    const merged = { ...(current.settings || {}), ...patch };
    await this.update(workerId, { settings: merged });
    return merged;
  }

  async resetData(workerId) {
    try {
      const { data, error } = await this.client.rpc('manager_reset_worker_data', { p_worker_id: workerId });
      if (!error && data === true) return;
    } catch (_) {}

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
    try {
      const { error } = await this.client.rpc('manager_append_worker_event', { p_worker_id: workerId, p_event: event });
      if (!error) return;
    } catch (_) {}

    // Fallback: cập nhật last_event trên worker row
    await this.update(workerId, { lastEvent: event });
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

module.exports = SupabaseWorkerStore;
