'use strict';

const TABLE = 'manager_commands';

function fromRow(row) {
  if (!row) return null;
  return {
    commandId: row.command_id,
    workerId: row.worker_id,
    action: row.action,
    payload: row.payload || {},
    status: row.status,
    result: row.result,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    deliveredAt: row.delivered_at,
    completedAt: row.completed_at
  };
}

function unwrap(data) { return Array.isArray(data) ? (data[0] || null) : data; }

class SupabaseCommandStore {
  constructor(client) { this.client = client; }

  async initialize() {
    const { error: checkError } = await this.client.from(TABLE).select('command_id').limit(0);
    if (checkError) throw new Error(`Supabase command storage is unavailable: ${checkError.message}`);
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [{ error: expiryError }, { error: cleanupError }] = await Promise.all([
      this.client.from(TABLE).update({ status: 'expired' }).in('status', ['queued', 'delivered']).lte('expires_at', now),
      this.client.from(TABLE).delete().in('status', ['completed', 'failed', 'expired']).lt('created_at', cutoff)
    ]);
    if (expiryError) throw expiryError;
    if (cleanupError) throw cleanupError;
  }

  async enqueue(command) {
    const { data, error } = await this.client.rpc('manager_enqueue_worker_command', {
      p_command_id: command.commandId,
      p_worker_id: command.workerId,
      p_action: command.action,
      p_payload: command.payload || {},
      p_created_at: command.createdAt,
      p_expires_at: command.expiresAt
    });
    if (error) throw error;
    return fromRow(unwrap(data));
  }

  async take(workerId) {
    const { data, error } = await this.client.rpc('manager_take_worker_command', { p_worker_id: workerId });
    if (error) throw error;
    return fromRow(unwrap(data));
  }

  async complete(workerId, commandId, result) {
    const { data, error } = await this.client.rpc('manager_complete_worker_command', {
      p_worker_id: workerId, p_command_id: commandId, p_result: result ?? null
    });
    if (error) throw error;
    return data === true;
  }

  async expire(commandId) {
    const { error } = await this.client.rpc('manager_expire_worker_command', { p_command_id: commandId });
    if (error) throw error;
  }
}

module.exports = SupabaseCommandStore;
