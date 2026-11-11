'use strict';

const crypto = require('node:crypto');
const AsyncKeyLock = require('../services/async-key-lock');

const TABLE = 'manager_commands';
const COALESCEABLE_ACTIONS = new Set(['status', 'set-afk-mode', 'set-proxy']);
const EXECUTION_COMPLETED_STATUS = 'execution_completed';
const STATE_SYNC_PENDING_STATUS = 'state_sync_pending';
const STATE_SYNC_FAILED_STATUS = 'state_sync_failed';
const ACTIVE_SYNC_STATUSES = [EXECUTION_COMPLETED_STATUS, STATE_SYNC_PENDING_STATUS];
const CLEARABLE_STATUSES = ['queued', 'delivered', 'completed', 'failed', 'expired'];
const REQUIRED_STATE_SYNC_RPCS = [
  'manager_record_command_execution',
  'manager_renew_command_sync_lease',
  'manager_verify_command_sync_lease',
  'manager_mark_command_sync_pending',
  'manager_finalize_command_sync',
  'manager_claim_pending_command_syncs'
];

function createAtomicRpcRequiredError(rpcName, missingRpcs = [], detail = '') {
  const missingList = Array.isArray(missingRpcs) && missingRpcs.length > 0
    ? missingRpcs
    : (rpcName ? [rpcName] : REQUIRED_STATE_SYNC_RPCS);
  const err = new Error(
    `Atomic Postgres RPC(s) required before enabling two-phase RESET sync/retry: ${missingList.join(', ')}` +
    (detail ? ` (${detail})` : '')
  );
  err.code = 'ATOMIC_STATE_SYNC_RPC_REQUIRED';
  err.missingRpcs = [...missingList];
  return err;
}

function computeLeaseMs(leaseSeconds, leaseMs = null, defaultMs = 60000) {
  if (leaseMs !== null && leaseMs !== undefined && Number.isFinite(Number(leaseMs))) {
    return Math.max(50, Number(leaseMs));
  }
  const sec = Number(leaseSeconds);
  if (Number.isFinite(sec) && sec > 0) {
    return Math.max(50, sec * 1000);
  }
  return Math.max(50, defaultMs);
}

function computeRpcLeaseSeconds(leaseMsValue) {
  return Math.max(1, Math.min(3600, Math.ceil(Math.max(50, Number(leaseMsValue) || 60000) / 1000)));
}

function isRpcUnavailableError(error) {
  const msg = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();
  return code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('does not exist') ||
    msg.includes('not found');
}

function cloneObj(value) {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? { ...value } : {};
}

function attachStateSync(result, syncState) {
  const base = cloneObj(result);
  base._stateSync = cloneObj(syncState);
  return base;
}

function stripStateSync(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result ?? {};
  const copy = { ...result };
  delete copy._stateSync;
  return copy;
}

function parseIsoTime(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

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
  constructor(client, options = {}) {
    this.client = client;
    this.adapter = client?.adapter || null;
    this.coalesceLock = new AsyncKeyLock();
    this.allowUnsafeSingleInstanceFallback = Boolean(options?.allowUnsafeSingleInstanceFallback);
    this.stateSyncRpcState = {
      ok: true,
      checked: false,
      rpcVerified: false,
      missingRpcs: [],
      error: null,
      message: null,
      probeError: null,
      updatedAt: null
    };
  }

  markRpcVerified(rpcName) {
    const missing = (this.stateSyncRpcState.missingRpcs || []).filter((r) => r !== rpcName);
    this.stateSyncRpcState = {
      ...this.stateSyncRpcState,
      ok: missing.length === 0,
      checked: true,
      missingRpcs: missing,
      error: missing.length > 0 ? 'ATOMIC_STATE_SYNC_RPC_REQUIRED' : null,
      message: missing.length > 0 ? `Missing atomic state-sync RPC(s): ${missing.join(', ')}` : null,
      updatedAt: new Date().toISOString()
    };
  }

  markRpcMissing(rpcName, detail = '') {
    const missing = Array.from(new Set([...(this.stateSyncRpcState.missingRpcs || []), rpcName].filter(Boolean)));
    const message = `Missing atomic Postgres RPC(s): ${missing.join(', ')}` + (detail ? ` (${detail})` : '');
    this.stateSyncRpcState = {
      ok: false,
      checked: true,
      rpcVerified: true,
      missingRpcs: missing,
      error: 'ATOMIC_STATE_SYNC_RPC_REQUIRED',
      message,
      probeError: null,
      updatedAt: new Date().toISOString()
    };
  }

  assertFallbackAllowed(rpcName, detail = '') {
    this.markRpcMissing(rpcName, detail);
    if (!this.allowUnsafeSingleInstanceFallback) {
      throw createAtomicRpcRequiredError(rpcName, this.stateSyncRpcState.missingRpcs, detail);
    }
  }

  async probeStateSyncRpcs() {
    if (!this.adapter || typeof this.adapter.isEnabled !== 'function' || !this.adapter.isEnabled() || typeof this.adapter.fetchWithRetry !== 'function') {
      return this.health();
    }

    try {
      const specRes = await this.adapter.fetchWithRetry(`${this.adapter.url}/rest/v1/`, {
        headers: typeof this.adapter.getHeaders === 'function' ? this.adapter.getHeaders() : {}
      }, { timeoutMs: 8000, maxRetries: 1 });
      if (!specRes || !specRes.ok) {
        this.stateSyncRpcState = {
          ...this.stateSyncRpcState,
          checked: true,
          rpcVerified: false,
          probeError: specRes ? `HTTP ${specRes.status}` : 'spec_fetch_failed',
          updatedAt: new Date().toISOString()
        };
        return this.health();
      }
      const spec = await specRes.json().catch(() => null);
      const paths = (spec && spec.paths && typeof spec.paths === 'object') ? Object.keys(spec.paths) : null;
      if (!paths) {
        this.stateSyncRpcState = {
          ...this.stateSyncRpcState,
          checked: true,
          rpcVerified: false,
          probeError: 'invalid_openapi_spec',
          updatedAt: new Date().toISOString()
        };
        return this.health();
      }
      const pathSet = new Set(paths.map((p) => String(p).replace(/\/+$/, '')));
      const missing = REQUIRED_STATE_SYNC_RPCS.filter((rpcName) => !pathSet.has(`/rpc/${rpcName}`));
      this.stateSyncRpcState = {
        ok: missing.length === 0,
        checked: true,
        rpcVerified: true,
        missingRpcs: missing,
        error: missing.length > 0 ? 'ATOMIC_STATE_SYNC_RPC_REQUIRED' : null,
        message: missing.length > 0 ? `Missing atomic Postgres RPC(s): ${missing.join(', ')}` : null,
        probeError: null,
        updatedAt: new Date().toISOString()
      };
    } catch (err) {
      this.stateSyncRpcState = {
        ...this.stateSyncRpcState,
        checked: true,
        rpcVerified: false,
        probeError: err?.message || String(err),
        updatedAt: new Date().toISOString()
      };
    }

    return this.health();
  }

  health() {
    const missingRpcs = [...(this.stateSyncRpcState.missingRpcs || [])];
    const degraded = Boolean(missingRpcs.length > 0 && !this.allowUnsafeSingleInstanceFallback);
    return {
      ok: !degraded,
      degraded,
      status: degraded ? 'degraded' : (this.stateSyncRpcState.checked ? 'ready' : 'unknown'),
      checked: Boolean(this.stateSyncRpcState.checked),
      rpcVerified: Boolean(this.stateSyncRpcState.rpcVerified),
      retryEnabled: !degraded,
      allowUnsafeSingleInstanceFallback: this.allowUnsafeSingleInstanceFallback,
      missingRpcs,
      error: degraded ? (this.stateSyncRpcState.error || 'ATOMIC_STATE_SYNC_RPC_REQUIRED') : null,
      message: degraded ? this.stateSyncRpcState.message : null,
      probeError: this.stateSyncRpcState.probeError || null
    };
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

    await this.probeStateSyncRpcs();
    if (this.stateSyncRpcState.missingRpcs.length > 0 && !this.allowUnsafeSingleInstanceFallback) {
      console.error(
        `[COMMAND_STORE] Degraded: ${this.stateSyncRpcState.message}. ` +
        'Two-phase RESET background retry is disabled until the Postgres migration is applied.'
      );
    }
  }

  async enqueue(command) {
    const workerIdStr = String(command.workerId);
    const actionStr = String(command.action);
    const commandId = command.commandId || ('cmd_' + crypto.randomUUID());
    const createdAt = command.createdAt || new Date().toISOString();
    const expiresAt = command.expiresAt || new Date(Date.now() + 60000).toISOString();
    const allowCoalesce = COALESCEABLE_ACTIONS.has(actionStr);

    // 1. Thử gọi RPC manager_enqueue_worker_command: thực thi atomic advisory lock & transaction trong PostgreSQL
    try {
      const { data, error } = await this.client.rpc('manager_enqueue_worker_command', {
        p_command_id: commandId,
        p_worker_id: workerIdStr,
        p_action: actionStr,
        p_payload: command.payload || {},
        p_created_at: createdAt,
        p_expires_at: expiresAt,
        p_allow_coalesce: allowCoalesce
      });
      if (!error && data) {
        const row = unwrap(data);
        if (row) return fromRow(row);
      }
    } catch (_) {}

    // 2. Fallback cho coalesceable action khi RPC chưa triển khai:
    // Sử dụng AsyncKeyLock để đảm bảo tính nguyên tử tuyệt đối trong tiến trình Node.js
    if (allowCoalesce) {
      return await this.coalesceLock.run(`${workerIdStr}:${actionStr}`, async () => {
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
        return fromRow(row);
      });
    }

    // 3. Fallback cho non-coalesceable actions (chat, toss, window_click, v.v.): insert trực tiếp bản ghi riêng biệt
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

    // 4. Fallback: lưu vào manager_outbox_queue nếu manager_commands chưa có
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
        const { data: updated, error: updErr } = await this.client.from(TABLE)
          .update({ status: 'delivered', delivered_at: now })
          .eq('command_id', data.command_id)
          .eq('status', 'queued')
          .select('*')
          .maybeSingle();
        if (!updErr && updated) {
          return fromRow(updated);
        }
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
      const { data, error } = await this.client.from(TABLE).update({
        status: 'completed',
        result: result ?? {},
        completed_at: new Date().toISOString()
      })
      .eq('command_id', String(commandId))
      .eq('worker_id', String(workerId))
      .in('status', ['delivered', 'queued'])
      .select('command_id')
      .maybeSingle();

      if (!error && data) return true;
    } catch (_) {}

    return false;
  }

  async recordExecutionCompleted(workerId, commandId, result, {
    leaseOwner = null,
    leaseSeconds = 60,
    leaseMs = null,
    candidateStatus = null,
    statusSource = 'manager-command-poll',
    pendingSteps = null
  } = {}) {
    const wid = String(workerId);
    const cid = String(commandId);
    const nowIso = new Date().toISOString();
    const effectiveLeaseMs = computeLeaseMs(leaseSeconds, leaseMs, 60000);
    const rpcLeaseSec = computeRpcLeaseSeconds(effectiveLeaseMs);
    const leaseUntil = leaseOwner ? new Date(Date.now() + effectiveLeaseMs).toISOString() : null;
    const incomingSync = {
      pending: true,
      executionCompleted: true,
      candidateStatus: candidateStatus || null,
      statusSource: statusSource || 'manager-command-poll',
      pendingSteps: Array.isArray(pendingSteps) ? [...pendingSteps] : null,
      leaseOwner,
      leaseUntil,
      nextRetryAt: nowIso,
      updatedAt: nowIso
    };
    const rpcResultPayload = attachStateSync(stripStateSync(result), incomingSync);

    try {
      const { data, error } = await this.client.rpc('manager_record_command_execution', {
        p_worker_id: wid,
        p_command_id: cid,
        p_result: rpcResultPayload,
        p_lease_owner: leaseOwner,
        p_lease_seconds: rpcLeaseSec
      });
      if (!error && data && typeof data === 'object') {
        this.markRpcVerified('manager_record_command_execution');
        if (data.ok === false) {
          return {
            ok: false,
            error: data.reason === 'state_sync_in_progress' ? 'STATE_SYNC_IN_PROGRESS' : null,
            reason: data.reason || 'not_found',
            status: data.status || null,
            fencingToken: data.fencingToken ?? null
          };
        }
        const cmd = data.command ? fromRow(data.command) : null;
        return {
          ok: true,
          alreadyCompleted: Boolean(data.alreadyCompleted),
          status: data.status || EXECUTION_COMPLETED_STATUS,
          fencingToken: data.fencingToken ?? cmd?.result?._stateSync?.fencingToken ?? null,
          leaseUntil: data.leaseUntil || cmd?.result?._stateSync?.leaseUntil || leaseUntil,
          command: cmd
        };
      }
      if (error && !isRpcUnavailableError(error)) {
        throw new Error(error.message || 'manager_record_command_execution failed');
      }
      if (error) {
        this.assertFallbackAllowed('manager_record_command_execution', error.message);
      }
    } catch (rpcErr) {
      if (!isRpcUnavailableError(rpcErr)) throw rpcErr;
      this.assertFallbackAllowed('manager_record_command_execution', rpcErr.message);
    }

    const { data: existing, error: selErr } = await this.client.from(TABLE)
      .select('*')
      .eq('command_id', cid)
      .eq('worker_id', wid)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message || 'recordExecutionCompleted lookup failed');
    if (!existing) return { ok: false, reason: 'not_found' };
    if (existing.status === 'completed') {
      return { ok: true, alreadyCompleted: true, status: 'completed', command: fromRow(existing) };
    }
    if (existing.status === STATE_SYNC_FAILED_STATUS) {
      return { ok: false, reason: 'state_sync_failed', status: STATE_SYNC_FAILED_STATUS };
    }
    if (!['delivered', 'queued', EXECUTION_COMPLETED_STATUS, STATE_SYNC_PENDING_STATUS].includes(existing.status)) {
      return { ok: false, reason: 'invalid_status', status: existing.status };
    }

    const existingSync = cloneObj(existing.result?._stateSync);
    const existingLeaseUntilMs = parseIsoTime(existingSync.leaseUntil);
    if (
      ACTIVE_SYNC_STATUSES.includes(existing.status) &&
      existingSync.leaseOwner &&
      existingLeaseUntilMs !== null &&
      existingLeaseUntilMs > Date.now() &&
      (!leaseOwner || existingSync.leaseOwner !== leaseOwner)
    ) {
      return {
        ok: false,
        error: 'STATE_SYNC_IN_PROGRESS',
        status: existing.status,
        fencingToken: Number(existingSync.fencingToken || 0)
      };
    }

    const prevToken = Number(existingSync.fencingToken || 0);
    const nextToken = leaseOwner ? prevToken + 1 : prevToken;
    const mergedSync = {
      ...existingSync,
      ...incomingSync,
      fencingToken: nextToken,
      attempts: Number(existingSync.attempts || 0)
    };
    const mergedPayload = attachStateSync(
      stripStateSync(result !== null && result !== undefined ? result : existing.result),
      mergedSync
    );

    const { data: updated, error: updErr } = await this.client.from(TABLE)
      .update({
        status: EXECUTION_COMPLETED_STATUS,
        result: mergedPayload,
        completed_at: null
      })
      .eq('command_id', cid)
      .eq('worker_id', wid)
      .in('status', ['delivered', 'queued', EXECUTION_COMPLETED_STATUS, STATE_SYNC_PENDING_STATUS])
      .select('*')
      .maybeSingle();
    if (updErr) throw new Error(updErr.message || 'recordExecutionCompleted update failed');

    return {
      ok: Boolean(updated),
      alreadyCompleted: false,
      status: updated ? EXECUTION_COMPLETED_STATUS : null,
      fencingToken: updated ? nextToken : null,
      leaseUntil: updated ? leaseUntil : null,
      command: updated ? fromRow(updated) : null
    };
  }

  async renewStateSyncLease(workerId, commandId, leaseOwner, leaseSeconds = 60, {
    leaseMs = null,
    fencingToken = null
  } = {}) {
    const wid = String(workerId);
    const cid = String(commandId);
    const cleanOwner = String(leaseOwner || '').trim();
    if (!cleanOwner) {
      return { ok: false, lost: true, reason: 'invalid_lease_owner' };
    }
    const effectiveLeaseMs = computeLeaseMs(leaseSeconds, leaseMs, 60000);
    const rpcLeaseSec = computeRpcLeaseSeconds(effectiveLeaseMs);

    try {
      const { data, error } = await this.client.rpc('manager_renew_command_sync_lease', {
        p_worker_id: wid,
        p_command_id: cid,
        p_lease_owner: cleanOwner,
        p_lease_seconds: rpcLeaseSec,
        p_fencing_token: fencingToken ?? null
      });
      if (!error && data && typeof data === 'object') {
        this.markRpcVerified('manager_renew_command_sync_lease');
        return {
          ok: Boolean(data.ok),
          lost: Boolean(data.lost),
          reason: data.reason || null,
          leaseOwner: data.leaseOwner || null,
          leaseUntil: data.leaseUntil || null,
          fencingToken: data.fencingToken ?? null,
          currentOwner: data.currentOwner || null,
          currentFencingToken: data.currentFencingToken ?? null
        };
      }
      if (error && !isRpcUnavailableError(error)) {
        throw new Error(error.message || 'manager_renew_command_sync_lease failed');
      }
      if (error) {
        this.assertFallbackAllowed('manager_renew_command_sync_lease', error.message);
      }
    } catch (rpcErr) {
      if (!isRpcUnavailableError(rpcErr)) throw rpcErr;
      this.assertFallbackAllowed('manager_renew_command_sync_lease', rpcErr.message);
    }

    const { data: existing, error: selErr } = await this.client.from(TABLE)
      .select('*')
      .eq('command_id', cid)
      .eq('worker_id', wid)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message || 'renewStateSyncLease lookup failed');
    if (!existing) return { ok: false, lost: true, reason: 'not_found' };
    if (!ACTIVE_SYNC_STATUSES.includes(existing.status)) {
      return { ok: false, lost: true, reason: 'invalid_status', status: existing.status };
    }

    const existingSync = cloneObj(existing.result?._stateSync);
    const currentOwner = existingSync.leaseOwner || null;
    const currentToken = Number(existingSync.fencingToken || 0);
    const existingLeaseUntilMs = parseIsoTime(existingSync.leaseUntil);

    if (currentOwner !== cleanOwner) {
      return { ok: false, lost: true, reason: 'lease_owner_mismatch', currentOwner, currentFencingToken: currentToken };
    }
    if (fencingToken !== null && fencingToken !== undefined && currentToken !== Number(fencingToken)) {
      return { ok: false, lost: true, reason: 'fencing_token_mismatch', currentOwner, currentFencingToken: currentToken };
    }
    if (existingLeaseUntilMs === null || existingLeaseUntilMs <= Date.now()) {
      return { ok: false, lost: true, reason: 'lease_expired', currentOwner, currentFencingToken: currentToken };
    }

    const nextLeaseUntil = new Date(Date.now() + effectiveLeaseMs).toISOString();
    const updatedPayload = attachStateSync(stripStateSync(existing.result), {
      ...existingSync,
      leaseUntil: nextLeaseUntil,
      updatedAt: new Date().toISOString()
    });

    const { data: updated, error: updErr } = await this.client.from(TABLE)
      .update({ result: updatedPayload })
      .eq('command_id', cid)
      .eq('worker_id', wid)
      .eq('status', existing.status)
      .select('command_id')
      .maybeSingle();
    if (updErr) throw new Error(updErr.message || 'renewStateSyncLease update failed');
    if (!updated) return { ok: false, lost: true, reason: 'concurrent_update' };

    return {
      ok: true,
      lost: false,
      leaseOwner: cleanOwner,
      leaseUntil: nextLeaseUntil,
      fencingToken: currentToken
    };
  }

  async verifyStateSyncLease(workerId, commandId, leaseOwner, { fencingToken = null } = {}) {
    const wid = String(workerId);
    const cid = String(commandId);
    const cleanOwner = String(leaseOwner || '').trim();
    if (!cleanOwner) {
      return { ok: false, held: false, reason: 'invalid_lease_owner' };
    }

    try {
      const { data, error } = await this.client.rpc('manager_verify_command_sync_lease', {
        p_worker_id: wid,
        p_command_id: cid,
        p_lease_owner: cleanOwner,
        p_fencing_token: fencingToken ?? null
      });
      if (!error && data && typeof data === 'object') {
        this.markRpcVerified('manager_verify_command_sync_lease');
        return {
          ok: Boolean(data.ok),
          held: Boolean(data.held),
          reason: data.reason || null,
          leaseOwner: data.leaseOwner || null,
          leaseUntil: data.leaseUntil || null,
          fencingToken: data.fencingToken ?? null,
          currentOwner: data.currentOwner || null,
          currentFencingToken: data.currentFencingToken ?? null
        };
      }
      if (error && !isRpcUnavailableError(error)) {
        throw new Error(error.message || 'manager_verify_command_sync_lease failed');
      }
      if (error) {
        this.assertFallbackAllowed('manager_verify_command_sync_lease', error.message);
      }
    } catch (rpcErr) {
      if (!isRpcUnavailableError(rpcErr)) throw rpcErr;
      this.assertFallbackAllowed('manager_verify_command_sync_lease', rpcErr.message);
    }

    const { data: existing, error: selErr } = await this.client.from(TABLE)
      .select('*')
      .eq('command_id', cid)
      .eq('worker_id', wid)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message || 'verifyStateSyncLease lookup failed');
    if (!existing) return { ok: false, held: false, reason: 'not_found' };
    if (!ACTIVE_SYNC_STATUSES.includes(existing.status)) {
      return { ok: false, held: false, reason: 'invalid_status', status: existing.status };
    }

    const existingSync = cloneObj(existing.result?._stateSync);
    const currentOwner = existingSync.leaseOwner || null;
    const currentToken = Number(existingSync.fencingToken || 0);
    const existingLeaseUntilMs = parseIsoTime(existingSync.leaseUntil);

    if (currentOwner !== cleanOwner) {
      return { ok: false, held: false, reason: 'lease_owner_mismatch', currentOwner, currentFencingToken: currentToken };
    }
    if (fencingToken !== null && fencingToken !== undefined && currentToken !== Number(fencingToken)) {
      return { ok: false, held: false, reason: 'fencing_token_mismatch', currentOwner, currentFencingToken: currentToken };
    }
    if (existingLeaseUntilMs === null || existingLeaseUntilMs <= Date.now()) {
      return { ok: false, held: false, reason: 'lease_expired', currentOwner, currentFencingToken: currentToken };
    }

    return {
      ok: true,
      held: true,
      leaseOwner: currentOwner,
      leaseUntil: existingSync.leaseUntil,
      fencingToken: currentToken
    };
  }

  async markStateSyncPending(workerId, commandId, {
    result = null,
    syncState = {},
    terminalFailed = false,
    leaseOwner = null,
    fencingToken = null
  } = {}) {
    const wid = String(workerId);
    const cid = String(commandId);
    const safeSyncState = cloneObj(syncState);

    try {
      const { data, error } = await this.client.rpc('manager_mark_command_sync_pending', {
        p_worker_id: wid,
        p_command_id: cid,
        p_sync_state: safeSyncState,
        p_terminal_failed: Boolean(terminalFailed),
        p_lease_owner: leaseOwner ?? null,
        p_fencing_token: fencingToken ?? null
      });
      if (!error) {
        this.markRpcVerified('manager_mark_command_sync_pending');
        return Boolean(data);
      }
      if (!isRpcUnavailableError(error)) {
        throw new Error(error.message || 'manager_mark_command_sync_pending failed');
      }
      this.assertFallbackAllowed('manager_mark_command_sync_pending', error.message);
    } catch (rpcErr) {
      if (!isRpcUnavailableError(rpcErr)) throw rpcErr;
      this.assertFallbackAllowed('manager_mark_command_sync_pending', rpcErr.message);
    }

    const { data: existing, error: selErr } = await this.client.from(TABLE)
      .select('*')
      .eq('command_id', cid)
      .eq('worker_id', wid)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message || 'markStateSyncPending lookup failed');
    if (!existing) return false;
    if (!['queued', 'delivered', EXECUTION_COMPLETED_STATUS, STATE_SYNC_PENDING_STATUS].includes(existing.status)) {
      return false;
    }

    const existingSync = cloneObj(existing.result?._stateSync);
    const existingOwner = existingSync.leaseOwner || null;
    const existingToken = Number(existingSync.fencingToken || 0);
    if (leaseOwner && existingOwner && existingOwner !== leaseOwner) {
      return false;
    }
    if (fencingToken !== null && fencingToken !== undefined && existingToken > 0 && existingToken !== Number(fencingToken)) {
      return false;
    }

    const mergedSyncState = {
      ...safeSyncState,
      fencingToken: Math.max(existingToken, Number(safeSyncState.fencingToken || 0), Number(fencingToken || 0))
    };
    const mergedPayload = attachStateSync(
      stripStateSync(result !== null && result !== undefined ? result : existing.result),
      mergedSyncState
    );
    const nextStatus = terminalFailed ? STATE_SYNC_FAILED_STATUS : STATE_SYNC_PENDING_STATUS;
    const { data: updated, error: updErr } = await this.client.from(TABLE)
      .update({
        status: nextStatus,
        result: mergedPayload,
        completed_at: null
      })
      .eq('command_id', cid)
      .eq('worker_id', wid)
      .in('status', ['queued', 'delivered', EXECUTION_COMPLETED_STATUS, STATE_SYNC_PENDING_STATUS])
      .select('*')
      .maybeSingle();
    if (updErr) throw new Error(updErr.message || 'markStateSyncPending update failed');
    return Boolean(updated);
  }

  async finalizeCompleted(workerId, commandId, result = null, { leaseOwner = null, fencingToken = null } = {}) {
    const wid = String(workerId);
    const cid = String(commandId);
    const cleanParamResult = (result !== null && result !== undefined) ? stripStateSync(result) : null;

    try {
      const { data, error } = await this.client.rpc('manager_finalize_command_sync', {
        p_worker_id: wid,
        p_command_id: cid,
        p_result: cleanParamResult,
        p_lease_owner: leaseOwner ?? null,
        p_fencing_token: fencingToken ?? null
      });
      if (!error) {
        this.markRpcVerified('manager_finalize_command_sync');
        return Boolean(data);
      }
      if (!isRpcUnavailableError(error)) {
        throw new Error(error.message || 'manager_finalize_command_sync failed');
      }
      this.assertFallbackAllowed('manager_finalize_command_sync', error.message);
    } catch (rpcErr) {
      if (!isRpcUnavailableError(rpcErr)) throw rpcErr;
      this.assertFallbackAllowed('manager_finalize_command_sync', rpcErr.message);
    }

    const { data: existing, error: selErr } = await this.client.from(TABLE)
      .select('*')
      .eq('command_id', cid)
      .eq('worker_id', wid)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message || 'finalizeCompleted lookup failed');
    if (!existing) return false;
    if (existing.status === 'completed') return true;
    if (!['queued', 'delivered', EXECUTION_COMPLETED_STATUS, STATE_SYNC_PENDING_STATUS].includes(existing.status)) {
      return false;
    }

    const existingSync = cloneObj(existing.result?._stateSync);
    const existingToken = Number(existingSync.fencingToken || 0);
    if (leaseOwner && existingSync.leaseOwner && existingSync.leaseOwner !== leaseOwner) {
      return false;
    }
    if (fencingToken !== null && fencingToken !== undefined && existingToken > 0 && existingToken !== Number(fencingToken)) {
      return false;
    }

    const finalResult = stripStateSync(result !== null && result !== undefined ? result : existing.result);
    const { data: updated, error: updErr } = await this.client.from(TABLE)
      .update({
        status: 'completed',
        result: finalResult,
        completed_at: new Date().toISOString()
      })
      .eq('command_id', cid)
      .eq('worker_id', wid)
      .in('status', ['queued', 'delivered', EXECUTION_COMPLETED_STATUS, STATE_SYNC_PENDING_STATUS])
      .select('command_id')
      .maybeSingle();
    if (updErr) throw new Error(updErr.message || 'finalizeCompleted update failed');
    return Boolean(updated);
  }

  async claimPendingStateSyncBatch(leaseOwner, limit = 10, leaseSeconds = 60, { leaseMs = null } = {}) {
    const cleanOwner = String(leaseOwner || `mgr_${process.pid}`);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10));
    const effectiveLeaseMs = computeLeaseMs(leaseSeconds, leaseMs, 60000);
    const rpcLeaseSec = computeRpcLeaseSeconds(effectiveLeaseMs);

    try {
      const { data, error } = await this.client.rpc('manager_claim_pending_command_syncs', {
        p_lease_owner: cleanOwner,
        p_limit: safeLimit,
        p_lease_seconds: rpcLeaseSec
      });
      if (!error && Array.isArray(data)) {
        this.markRpcVerified('manager_claim_pending_command_syncs');
        return data.map(fromRow);
      }
      if (error && !isRpcUnavailableError(error)) {
        throw new Error(error.message || 'manager_claim_pending_command_syncs failed');
      }
      if (error) {
        this.assertFallbackAllowed('manager_claim_pending_command_syncs', error.message);
      }
    } catch (rpcErr) {
      if (!isRpcUnavailableError(rpcErr)) throw rpcErr;
      this.assertFallbackAllowed('manager_claim_pending_command_syncs', rpcErr.message);
    }

    // Only reachable when allowUnsafeSingleInstanceFallback === true (explicitly opted in for tests).
    const { data: candidates, error: selErr } = await this.client.from(TABLE)
      .select('*')
      .in('status', ACTIVE_SYNC_STATUSES)
      .order('created_at', { ascending: true })
      .limit(Math.max(safeLimit * 3, 20));
    if (selErr) throw new Error(selErr.message || 'claimPendingStateSyncBatch select failed');
    if (!Array.isArray(candidates) || candidates.length === 0) return [];

    const nowMs = Date.now();
    const newLeaseUntil = new Date(nowMs + effectiveLeaseMs).toISOString();
    const claimed = [];

    for (const row of candidates) {
      if (claimed.length >= safeLimit) break;
      const syncMeta = cloneObj(row.result?._stateSync);
      const nextRetryMs = parseIsoTime(syncMeta.nextRetryAt);
      const leaseUntilMs = parseIsoTime(syncMeta.leaseUntil);
      if (nextRetryMs !== null && nextRetryMs > nowMs) continue;
      if (leaseUntilMs !== null && leaseUntilMs > nowMs) continue;

      const nextToken = Number(syncMeta.fencingToken || 0) + 1;
      const updatedPayload = attachStateSync(stripStateSync(row.result), {
        ...syncMeta,
        pending: true,
        leaseOwner: cleanOwner,
        leaseUntil: newLeaseUntil,
        fencingToken: nextToken,
        updatedAt: new Date(nowMs).toISOString()
      });
      const { data: updated, error: updErr } = await this.client.from(TABLE)
        .update({
          status: STATE_SYNC_PENDING_STATUS,
          result: updatedPayload
        })
        .eq('command_id', row.command_id)
        .eq('status', row.status)
        .select('*')
        .maybeSingle();
      if (!updErr && updated) {
        claimed.push(fromRow(updated));
      }
    }

    return claimed;
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

  async clearWorker(workerId, { excludeCommandIds = [] } = {}) {
    const wid = String(workerId);
    const excluded = (Array.isArray(excludeCommandIds) ? excludeCommandIds : [excludeCommandIds])
      .map((id) => String(id || '').trim())
      .filter(Boolean);

    let query = this.client
      .from(TABLE)
      .delete()
      .eq('worker_id', wid)
      .in('status', CLEARABLE_STATUSES);

    if (excluded.length > 0 && typeof query.not === 'function') {
      const formatted = excluded.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',');
      query = query.not('command_id', 'in', `(${formatted})`);
    }

    const res = await query;
    if (res && res.error) {
      const err = new Error(res.error.message || 'clearWorker failed');
      err.code = res.error.code;
      throw err;
    }
  }
}

module.exports = SupabaseCommandStore;
