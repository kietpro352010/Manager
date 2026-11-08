'use strict';

const TABLE = 'manager_workers';
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
  constructor(client) { this.client = client; }

  async initialize() {
    const { error } = await this.client.from(TABLE).select('worker_id').limit(1);
    if (error) throw new Error(`Supabase worker storage is unavailable: ${error.message}`);
  }

  async close() { /* Supabase client uses managed fetch connections. */ }

  async get(workerId) {
    const { data, error } = await this.client.from(TABLE).select('*').eq('worker_id', workerId).maybeSingle();
    if (error) throw error;
    return fromRow(data);
  }

  async getByNumber(botNumber) {
    const { data, error } = await this.client.from(TABLE).select('*').eq('bot_number', Number(botNumber)).maybeSingle();
    if (error) throw error;
    return fromRow(data);
  }

  async list() {
    const { data, error } = await this.client.from(TABLE).select('*').order('bot_number', { ascending: true }).order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(fromRow);
  }

  async nextBotNumber() {
    const { data, error } = await this.client.rpc('manager_next_bot_number');
    if (error) throw error;
    return Number(data);
  }

  async create(worker) {
    const { error } = await this.client.from(TABLE).insert(toRow(worker));
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
    const { data, error } = await this.client.rpc('manager_patch_worker_settings', {
      p_worker_id: workerId,
      p_patch: patch
    });
    if (error) throw error;
    return data;
  }

  async resetData(workerId) {
    const { data, error } = await this.client.rpc('manager_reset_worker_data', { p_worker_id: workerId });
    if (error) throw error;
    if (data !== true) throw new Error(`Worker ${workerId} could not be reset.`);
  }

  async remove(workerId) {
    const { data, error } = await this.client.from(TABLE).delete().eq('worker_id', workerId).select('worker_id');
    if (error) throw error;
    return Boolean(data?.length);
  }

  async addEvent(workerId, event) {
    const { error } = await this.client.rpc('manager_append_worker_event', { p_worker_id: workerId, p_event: event });
    if (error) throw error;
  }
}

module.exports = SupabaseWorkerStore;
