'use strict';

const crypto = require('node:crypto');

const TABLE = 'manager_commands';

function fromRow(row) {
  if (!row) return null;
  return {
    commandId: row.command_id || row.id,
    workerId: row.worker_id,
    action: row.action || row.task_type,
    payload: row.payload || {},
    status: row.status,
    result: row.result,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    deliveredAt: row.delivered_at,
    completedAt: row.completed_at
  };
}

function unwrap(data) {
  return Array.isArray(data) ? (data[0] || null) : data;
}

class SupabaseCommandStore {
  constructor(client) {
    this.client = client;
    this.adapter = client.adapter || null;
  }

  async initialize() {
    try {
      const { error: checkError } = await this.client.from(TABLE).select('command_id').limit(0);
      if (checkError && checkError.code !== 'PGRST116') {
        console.warn(`[COMMAND_STORE] Table ${TABLE} notice: ${checkError.message}`);
      }
    } catch (_) {}

    // Dọn dẹp lệnh cũ hết hạn và rác > 300s
    try {
      const now = new Date().toISOString();
      const cutoff300s = new Date(Date.now() - 300 * 1000).toISOString();
      const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      await Promise.allSettled([
        this.client.from(TABLE).update({ status: 'expired' }).in('status', ['queued', 'delivered']).lte('expires_at', now),
        this.client.from(TABLE).delete().in('status', ['completed', 'failed', 'expired']).lt('created_at', cutoff300s),
        this.client.from(TABLE).delete().lt('created_at', cutoff30d)
      ]);
    } catch (_) {}
  }

  async enqueue(command) {
    const workerIdStr = String(command.workerId);
    const actionStr = String(command.action);
    const commandId = command.commandId || ('cmd_' + crypto.randomUUID());
    const createdAt = command.createdAt || new Date().toISOString();
    const expiresAt = command.expiresAt || new Date(Date.now() + 60000).toISOString();

    // 0. Command coalescing: nếu đã có lệnh cùng worker_id và action đang queued, cập nhật payload
    try {
      const { data: existing } = await this.client.from(TABLE)
        .select('*')
        .eq('worker_id', workerIdStr)
        .eq('action', actionStr)
        .eq('status', 'queued')
        .gt('expires_at', new Date().toISOString())
        .limit(1)
        .maybeSingle();

      if (existing) {
        const { data: updated, error: updErr } = await this.client.from(TABLE)
          .update({
            payload: command.payload || {},
            expires_at: expiresAt,
            created_at: new Date().toISOString()
          })
          .eq('command_id', existing.command_id)
          .select('*')
          .maybeSingle();
        if (!updErr && updated) return fromRow(updated);
      }
    } catch (_) {}

    // 1. Thử gọi RPC manager_enqueue_worker_command
    try {
      const { data, error } = await this.client.rpc('manager_enqueue_worker_command', {
        p_command_id: commandId,
        p_worker_id: workerIdStr,
        p_action: actionStr,
        p_payload: command.payload || {},
        p_created_at: createdAt,
        p_expires_at: expiresAt
      });
      if (!error && data) return fromRow(unwrap(data));
    } catch (_) {}

    // 2. Fallback: insert trực tiếp vào manager_commands
    const row = {
      command_id: commandId,
      worker_id: workerIdStr,
      action: actionStr,
      payload: command.payload || {},
      status: 'queued',
      created_at: createdAt,
      expires_at: expiresAt
    };
    const { data: inserted, error: insErr } = await this.client.from(TABLE).insert(row).select('*').maybeSingle();
    if (insErr && insErr.code !== '42P01') throw insErr;
    if (inserted) return fromRow(inserted);

    // 3. Fallback: lưu vào manager_outbox_queue nếu manager_commands chưa có
    if (this.adapter && typeof this.adapter.saveOutboxItem === 'function') {
      await this.adapter.saveOutboxItem({
        id: commandId,
        taskType: command.action,
        payload: { workerId: command.workerId, ...command.payload },
        status: 'pending'
      });
    }

    return fromRow(row);
  }

  async take(workerId) {
    // 1. Thử gọi RPC manager_take_worker_command
    try {
      const { data, error } = await this.client.rpc('manager_take_worker_command', { p_worker_id: String(workerId) });
      if (!error && data) return fromRow(unwrap(data));
    } catch (_) {}

    // 2. Fallback: đọc trực tiếp lệnh queued đầu tiên
    try {
      const now = new Date().toISOString();
      const { data, error } = await this.client.from(TABLE)
        .select('*')
        .eq('worker_id', String(workerId))
        .eq('status', 'queued')
        .gt('expires_at', now)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        await this.client.from(TABLE).update({ status: 'delivered', delivered_at: now }).eq('command_id', data.command_id);
        return fromRow({ ...data, status: 'delivered', delivered_at: now });
      }
    } catch (_) {}

    return null;
  }

  async complete(workerId, commandId, result) {
    try {
      const { data, error } = await this.client.rpc('manager_complete_worker_command', {
        p_worker_id: String(workerId),
        p_command_id: String(commandId),
        p_result: result ?? null
      });
      if (!error && data === true) return true;
    } catch (_) {}

    // Fallback: update status completed
    try {
      const { error } = await this.client.from(TABLE).update({
        status: 'completed',
        result: result ?? {},
        completed_at: new Date().toISOString()
      }).eq('command_id', String(commandId));
      if (!error) return true;
    } catch (_) {}

    return false;
  }

  async expire(commandId) {
    try {
      const { error } = await this.client.rpc('manager_expire_worker_command', { p_command_id: String(commandId) });
      if (!error) return;
    } catch (_) {}

    try {
      await this.client.from(TABLE).update({ status: 'expired' }).eq('command_id', String(commandId));
    } catch (_) {}
  }

  async get(commandId) {
    try {
      const { data, error } = await this.client.from(TABLE).select('*').eq('command_id', String(commandId)).maybeSingle();
      if (!error && data) return fromRow(data);
    } catch (_) {}
    return null;
  }
}

module.exports = SupabaseCommandStore;
