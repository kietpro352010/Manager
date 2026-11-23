'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const SUPABASE_REQUIRED_TABLES = Object.freeze([
  'manager_users', 'manager_keys', 'bot_registry', 'manager_sessions', 'bot_settings',
  'audit_logs', 'bot_chat_logs', 'bot_event_logs', 'bot_position_state', 'bot_position_logs',
  'manager_backups', 'manager_locks', 'manager_key_usage_transactions', 'bot_log_clear_cutoffs',
  'manager_user_state', 'manager_users_write_transactions', 'manager_session_revocations',
  'manager_link4m_attempts', 'manager_outbox_queue', 'manager_pending_allocations',
  'manager_migration_entitlement_undo', 'manager_workers', 'manager_commands',
  'manager_assignments', 'manager_discord_links', 'manager_settings', 'manager_ip_whitelist'
]);

const REQUIRED_RPCS = Object.freeze([
  'record_bot_position_change', 'consume_manager_key_usage',
  'acquire_manager_lock', 'release_manager_lock', 'renew_manager_lock', 'verify_manager_lock_fencing',
  'read_manager_users_snapshot', 'save_manager_users_snapshot',
  'insert_manager_users_if_absent', 'redeem_manager_key_and_save_users',
  'read_manager_session', 'read_manager_authorization', 'create_manager_user_session',
  'revoke_manager_session', 'revoke_manager_user_sessions',
  'claim_manager_link4m_reward', 'start_manager_link4m_attempt',
  'patch_manager_registry', 'set_bot_log_clear_cutoff',
  'rollback_manager_link4m_attempt', 'update_manager_link4m_sync_status',
  'set_manager_link4m_short_url', 'claim_manager_outbox_batch', 'claim_manager_pending_allocations',
  'prune_manager_historical_data',
  'manager_next_bot_number', 'manager_patch_worker_settings', 'manager_reset_worker_data',
  'manager_append_worker_event', 'manager_enqueue_worker_command', 'manager_take_worker_command',
  'manager_complete_worker_command', 'manager_expire_worker_command',
  'manager_record_command_execution', 'manager_renew_command_sync_lease',
  'manager_verify_command_sync_lease', 'manager_mark_command_sync_pending',
  'manager_finalize_command_sync', 'manager_claim_pending_command_syncs',
  'manager_set_user_access', 'manager_delete_user_access', 'manager_redeem_code_with_access',
  'manager_claim_link4m_attempt', 'manager_complete_link4m_reward',
  'manager_register_trial_user', 'manager_link_discord_account', 'manager_unlink_discord_account'
]);

const PRIMARY_KEYS = Object.freeze({
  manager_users: 'username',
  manager_keys: 'id',
  bot_registry: 'id',
  manager_sessions: 'token_hash',
  bot_settings: 'bot_id',
  audit_logs: 'id',
  bot_chat_logs: 'id',
  bot_event_logs: 'id',
  bot_position_state: 'bot_id',
  bot_position_logs: 'id',
  manager_backups: 'name',
  manager_locks: 'lock_key',
  manager_key_usage_transactions: 'transaction_id',
  bot_log_clear_cutoffs: 'bot_id',
  manager_user_state: 'singleton',
  manager_users_write_transactions: 'transaction_id',
  manager_session_revocations: 'token_hash',
  manager_link4m_attempts: 'attempt_id',
  manager_outbox_queue: 'id',
  manager_pending_allocations: 'id',
  manager_migration_entitlement_undo: 'migration_id',
  manager_workers: 'worker_id',
  manager_commands: 'command_id',
  manager_assignments: 'worker_id',
  manager_discord_links: 'discord_user_id',
  manager_settings: 'key',
  manager_schema_migrations: 'version',
  manager_ip_whitelist: 'ip'
});

function getParam(params, ...aliases) {
  if (!params || typeof params !== 'object') return undefined;
  for (const a of aliases) {
    if (params[a] !== undefined) return params[a];
  }
  return undefined;
}

class MockDatabase {
  constructor() {
    this.tables = new Map();
    this.sequences = new Map([['manager_bot_number_seq', 0]]);
    this.initDefaultTables();
  }

  initDefaultTables() {
    for (const table of SUPABASE_REQUIRED_TABLES) {
      this.tables.set(table, new Map());
    }
    this.tables.set('manager_schema_migrations', new Map());

    // Singleton defaults
    this.tables.get('bot_registry').set('default', {
      id: 'default',
      data: { systemSettings: {}, webhook: {}, pendingResets: {} },
      updated_at: new Date().toISOString()
    });

    this.tables.get('manager_user_state').set(true, {
      singleton: true,
      revision: 1,
      updated_at: new Date().toISOString()
    });
  }

  getPrimaryKey(table, row) {
    const pkCol = PRIMARY_KEYS[table] || 'id';
    let val = row[pkCol];
    if (val === undefined || val === null || val === '') {
      if (table === 'manager_users' && row.id) return String(row.id);
      if (table === 'manager_keys' && (row.code || row.key_code)) return String(row.code || row.key_code);
      if (table === 'manager_ip_whitelist' && row.ip) return String(row.ip);
      val = crypto.randomUUID ? crypto.randomUUID() : `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      row[pkCol] = val;
    }
    return String(val);
  }

  nextSequence(name = 'manager_bot_number_seq') {
    const current = this.sequences.get(name) || 0;
    const next = current + 1;
    this.sequences.set(name, next);
    return next;
  }

  reset() {
    this.tables.clear();
    this.sequences.set('manager_bot_number_seq', 0);
    this.initDefaultTables();
  }

  seed(table, rows) {
    let tMap = this.tables.get(table);
    if (!tMap) {
      tMap = new Map();
      this.tables.set(table, tMap);
    }
    const arr = Array.isArray(rows) ? rows : [rows];
    for (const r of arr) {
      const copy = JSON.parse(JSON.stringify(r));
      const pk = this.getPrimaryKey(table, copy);
      tMap.set(pk, copy);
    }
  }

  getAllRows(table) {
    const tMap = this.tables.get(table);
    if (!tMap) return [];
    return Array.from(tMap.values()).map((r) => JSON.parse(JSON.stringify(r)));
  }

  deleteRow(table, pk) {
    const tMap = this.tables.get(table);
    if (!tMap) return false;
    return tMap.delete(String(pk));
  }

  setRow(table, row) {
    let tMap = this.tables.get(table);
    if (!tMap) {
      tMap = new Map();
      this.tables.set(table, tMap);
    }
    const copy = JSON.parse(JSON.stringify(row));
    const pk = this.getPrimaryKey(table, copy);
    tMap.set(pk, copy);
    return copy;
  }
}

class QueryEngine {
  static filterRows(rows, queryParams = {}) {
    let result = rows.map((r) => ({ ...r }));

    for (const [key, rawVal] of Object.entries(queryParams)) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue;

      if (key === 'or') {
        const inner = String(rawVal).replace(/^\(|\)$/g, '');
        const clauses = QueryEngine.splitTopLevelClauses(inner);
        result = result.filter((row) =>
          clauses.some((clause) => QueryEngine.evaluateOrClause(row, clause))
        );
        continue;
      }

      const valStr = String(rawVal);
      const dotIdx = valStr.indexOf('.');
      if (dotIdx === -1) {
        result = result.filter((row) => String(row[key] ?? '') === valStr);
        continue;
      }

      const op = valStr.substring(0, dotIdx);
      const val = decodeURIComponent(valStr.substring(dotIdx + 1));
      result = result.filter((row) => QueryEngine.matchCondition(row[key], op, val));
    }

    // Sorting
    if (queryParams.order) {
      const orderFields = String(queryParams.order).split(',').map((o) => o.trim());
      result.sort((a, b) => {
        for (const orderClause of orderFields) {
          const parts = orderClause.split('.');
          const col = parts[0];
          const dir = parts[1] || 'asc';
          const vA = a[col];
          const vB = b[col];
          if (vA === vB) continue;
          if (vA === null || vA === undefined) return 1;
          if (vB === null || vB === undefined) return -1;
          const cmp = typeof vA === 'number' && typeof vB === 'number'
            ? vA - vB
            : String(vA).localeCompare(String(vB));
          return dir.toLowerCase() === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
    }

    // Offset
    const offset = parseInt(queryParams.offset, 10) || 0;
    if (offset > 0) {
      result = result.slice(offset);
    }

    // Limit
    if (queryParams.limit !== undefined && queryParams.limit !== null) {
      const limit = parseInt(queryParams.limit, 10);
      if (!Number.isNaN(limit)) {
        result = result.slice(0, Math.max(0, limit));
      }
    }

    // Select projection
    if (queryParams.select && queryParams.select !== '*') {
      const rawCols = String(queryParams.select)
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f && !f.includes('('));
      result = result.map((row) => {
        const projected = {};
        for (const col of rawCols) {
          projected[col] = row[col] !== undefined ? row[col] : null;
        }
        return projected;
      });
    }

    return result;
  }

  static splitTopLevelClauses(str) {
    const clauses = [];
    let current = '';
    let inQuotes = false;
    let parenDepth = 0;

    for (let i = 0; i < str.length; i += 1) {
      const ch = str[i];
      if (inQuotes) {
        current += ch;
        if (ch === '\\' && i + 1 < str.length) {
          current += str[i + 1];
          i += 1;
        } else if (ch === '"') {
          if (str[i + 1] === '"') {
            current += str[i + 1];
            i += 1;
          } else {
            inQuotes = false;
          }
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        current += ch;
      } else if (ch === '(') {
        parenDepth += 1;
        current += ch;
      } else if (ch === ')') {
        if (parenDepth > 0) parenDepth -= 1;
        current += ch;
      } else if (ch === ',' && parenDepth === 0) {
        const trimmed = current.trim();
        if (trimmed) clauses.push(trimmed);
        current = '';
      } else {
        current += ch;
      }
    }

    const tail = current.trim();
    if (tail) clauses.push(tail);
    return clauses;
  }

  static unquotePostgrestValue(raw) {
    let val = String(raw ?? '');
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/""/g, '"').replace(/\\(["\\])/g, '$1');
    }
    try {
      return decodeURIComponent(val);
    } catch (_) {
      return val;
    }
  }

  static evaluateOrClause(row, clause) {
    const trimmed = String(clause || '').trim();
    if (!trimmed) return false;
    if (/^and\s*\(/i.test(trimmed) && trimmed.endsWith(')')) {
      const inner = trimmed.slice(trimmed.indexOf('(') + 1, -1);
      const subClauses = QueryEngine.splitTopLevelClauses(inner);
      return subClauses.every((sub) => QueryEngine.evaluateOrClause(row, sub));
    }
    if (/^or\s*\(/i.test(trimmed) && trimmed.endsWith(')')) {
      const inner = trimmed.slice(trimmed.indexOf('(') + 1, -1);
      const subClauses = QueryEngine.splitTopLevelClauses(inner);
      return subClauses.some((sub) => QueryEngine.evaluateOrClause(row, sub));
    }
    const dot1 = trimmed.indexOf('.');
    if (dot1 === -1) return false;
    const dot2 = trimmed.indexOf('.', dot1 + 1);
    if (dot2 === -1) return false;
    const cCol = trimmed.slice(0, dot1).trim();
    const cOp = trimmed.slice(dot1 + 1, dot2).trim();
    const rawVal = trimmed.slice(dot2 + 1).trim();
    const cVal = cOp === 'in' ? (() => {
      try { return decodeURIComponent(rawVal); } catch (_) { return rawVal; }
    })() : QueryEngine.unquotePostgrestValue(rawVal);
    return QueryEngine.matchCondition(row[cCol], cOp, cVal);
  }

  static matchCondition(rowVal, op, targetVal) {
    if (op === 'not') {
      const subDot = targetVal.indexOf('.');
      if (subDot !== -1) {
        const subOp = targetVal.substring(0, subDot);
        const subVal = targetVal.substring(subDot + 1);
        return !QueryEngine.matchCondition(rowVal, subOp, subVal);
      }
      return String(rowVal ?? '') !== String(targetVal);
    }

    if (op === 'eq') return String(rowVal ?? '') === String(targetVal);
    if (op === 'neq') return String(rowVal ?? '') !== String(targetVal);
    if (op === 'is') {
      if (targetVal === 'null') return rowVal === null || rowVal === undefined;
      return String(rowVal) === targetVal;
    }

    if (op === 'in') {
      const clean = targetVal.replace(/^\(|\)$/g, '');
      const set = clean.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
      return set.includes(String(rowVal ?? ''));
    }

    if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
      const rNum = Number(rowVal);
      const tNum = Number(targetVal);
      if (!Number.isNaN(rNum) && !Number.isNaN(tNum)) {
        if (op === 'gt') return rNum > tNum;
        if (op === 'gte') return rNum >= tNum;
        if (op === 'lt') return rNum < tNum;
        if (op === 'lte') return rNum <= tNum;
      }
      const rDate = Date.parse(rowVal);
      const tDate = Date.parse(targetVal);
      if (!Number.isNaN(rDate) && !Number.isNaN(tDate)) {
        if (op === 'gt') return rDate > tDate;
        if (op === 'gte') return rDate >= tDate;
        if (op === 'lt') return rDate < tDate;
        if (op === 'lte') return rDate <= tDate;
      }
      const rStr = String(rowVal ?? '');
      const tStr = String(targetVal ?? '');
      if (op === 'gt') return rStr > tStr;
      if (op === 'gte') return rStr >= tStr;
      if (op === 'lt') return rStr < tStr;
      if (op === 'lte') return rStr <= tStr;
    }

    if (op === 'like' || op === 'ilike') {
      const pat = targetVal.replace(/^[%\*]|[%\*]$/g, '');
      const rStr = String(rowVal ?? '');
      if (op === 'ilike') {
        return rStr.toLowerCase().includes(pat.toLowerCase());
      }
      return rStr.includes(pat);
    }

    return true;
  }

  static toCsv(rows) {
    if (!rows || rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(
        headers.map((h) => {
          const val = row[h] === null || row[h] === undefined ? '' : String(row[h]);
          return val.includes(',') || val.includes('"') || val.includes('\n')
            ? `"${val.replace(/"/g, '""')}"`
            : val;
        }).join(',')
      );
    }
    return lines.join('\n');
  }
}

class RpcRegistry {
  static async execute(db, rpcName, params = {}) {
    const fn = RpcRegistry.handlers[rpcName];
    if (!fn) {
      throw new Error(`function public.${rpcName}() does not exist`);
    }
    return await fn(db, params);
  }
}

RpcRegistry.handlers = {
  // Category 1: Two-Phase Command Reset Sync (6 RPCs)
  manager_record_command_execution: async (db, params) => {
    const workerId = getParam(params, 'p_worker_id', 'worker_id', 'workerId');
    const commandId = getParam(params, 'p_command_id', 'command_id', 'commandId');
    const result = getParam(params, 'p_result', 'result') || {};
    const leaseOwner = getParam(params, 'p_lease_owner', 'lease_owner', 'leaseOwner');
    const leaseSeconds = Number(getParam(params, 'p_lease_seconds', 'lease_seconds', 'leaseSeconds') || 60);

    const commandsMap = db.tables.get('manager_commands');
    let row = commandsMap ? commandsMap.get(String(commandId)) : null;
    if (!row || row.worker_id !== workerId) {
      return { ok: false, reason: 'not_found' };
    }

    if (row.status === 'completed') {
      return { ok: true, alreadyCompleted: true, status: 'completed', command: row };
    }
    if (row.status === 'state_sync_failed') {
      return { ok: false, reason: 'state_sync_failed', status: 'state_sync_failed' };
    }

    const now = new Date();
    const safeSecs = Math.max(1, Math.min(3600, leaseSeconds));
    const leaseUntil = new Date(now.getTime() + safeSecs * 1000).toISOString();
    const existingSync = (row.result && row.result._stateSync) || {};
    const existingToken = Number(existingSync.fencingToken || 0);

    const prevLeaseUntilDate = existingSync.leaseUntil ? new Date(existingSync.leaseUntil) : null;
    if (
      ['execution_completed', 'state_sync_pending'].includes(row.status) &&
      existingSync.leaseOwner &&
      prevLeaseUntilDate &&
      prevLeaseUntilDate > now &&
      leaseOwner &&
      existingSync.leaseOwner !== leaseOwner
    ) {
      return {
        ok: false,
        reason: 'state_sync_in_progress',
        status: row.status,
        fencingToken: existingToken
      };
    }

    const nextToken = leaseOwner ? Math.max(existingToken, 0) + 1 : Math.max(existingToken, 0);
    const incomingSync = (result && result._stateSync) || {};
    const mergedSync = {
      ...existingSync,
      ...incomingSync,
      pending: true,
      executionCompleted: true,
      attempts: existingSync.attempts || incomingSync.attempts || 0,
      leaseOwner: leaseOwner || null,
      leaseUntil: leaseOwner ? leaseUntil : null,
      fencingToken: nextToken,
      updatedAt: now.toISOString()
    };

    row.status = 'execution_completed';
    row.result = { ...(result || {}), _stateSync: mergedSync };
    row.completed_at = null;
    commandsMap.set(String(commandId), row);

    return {
      ok: true,
      alreadyCompleted: false,
      status: 'execution_completed',
      fencingToken: nextToken,
      leaseUntil: leaseOwner ? leaseUntil : null,
      command: row
    };
  },

  manager_renew_command_sync_lease: async (db, params) => {
    const workerId = getParam(params, 'p_worker_id', 'worker_id', 'workerId');
    const commandId = getParam(params, 'p_command_id', 'command_id', 'commandId');
    const leaseOwner = getParam(params, 'p_lease_owner', 'lease_owner', 'leaseOwner');
    const leaseSeconds = Number(getParam(params, 'p_lease_seconds', 'lease_seconds', 'leaseSeconds') || 60);
    const fencingToken = getParam(params, 'p_fencing_token', 'fencing_token', 'fencingToken');

    if (!leaseOwner || !String(leaseOwner).trim()) {
      return { ok: false, lost: true, reason: 'invalid_lease_owner' };
    }

    const commandsMap = db.tables.get('manager_commands');
    let row = commandsMap ? commandsMap.get(String(commandId)) : null;
    if (!row || row.worker_id !== workerId) {
      return { ok: false, lost: true, reason: 'not_found' };
    }

    if (!['execution_completed', 'state_sync_pending'].includes(row.status)) {
      return { ok: false, lost: true, reason: 'invalid_status', status: row.status };
    }

    const now = new Date();
    const sync = (row.result && row.result._stateSync) || {};
    const currentOwner = sync.leaseOwner || null;
    const currentToken = Number(sync.fencingToken || 0);
    const currentLeaseUntil = sync.leaseUntil ? new Date(sync.leaseUntil) : null;

    if (currentOwner !== leaseOwner) {
      return { ok: false, lost: true, reason: 'lease_owner_mismatch', currentOwner, currentFencingToken: currentToken };
    }

    if (fencingToken !== undefined && fencingToken !== null && Number(fencingToken) !== currentToken) {
      return { ok: false, lost: true, reason: 'fencing_token_mismatch', currentOwner, currentFencingToken: currentToken };
    }

    if (!currentLeaseUntil || currentLeaseUntil <= now) {
      return { ok: false, lost: true, reason: 'lease_expired', currentOwner, currentFencingToken: currentToken };
    }

    const safeSecs = Math.max(1, Math.min(3600, leaseSeconds));
    const newLease = new Date(now.getTime() + safeSecs * 1000).toISOString();

    sync.leaseUntil = newLease;
    sync.updatedAt = now.toISOString();
    row.result._stateSync = sync;
    commandsMap.set(String(commandId), row);

    return {
      ok: true,
      lost: false,
      leaseOwner: currentOwner,
      leaseUntil: newLease,
      fencingToken: currentToken
    };
  },

  manager_verify_command_sync_lease: async (db, params) => {
    const workerId = getParam(params, 'p_worker_id', 'worker_id', 'workerId');
    const commandId = getParam(params, 'p_command_id', 'command_id', 'commandId');
    const leaseOwner = getParam(params, 'p_lease_owner', 'lease_owner', 'leaseOwner');
    const fencingToken = getParam(params, 'p_fencing_token', 'fencing_token', 'fencingToken');

    if (!leaseOwner || !String(leaseOwner).trim()) {
      return { ok: false, held: false, reason: 'invalid_lease_owner' };
    }

    const commandsMap = db.tables.get('manager_commands');
    let row = commandsMap ? commandsMap.get(String(commandId)) : null;
    if (!row || row.worker_id !== workerId) {
      return { ok: false, held: false, reason: 'not_found' };
    }

    if (!['execution_completed', 'state_sync_pending'].includes(row.status)) {
      return { ok: false, held: false, reason: 'invalid_status', status: row.status };
    }

    const now = new Date();
    const sync = (row.result && row.result._stateSync) || {};
    const currentOwner = sync.leaseOwner || null;
    const currentToken = Number(sync.fencingToken || 0);
    const currentLeaseUntil = sync.leaseUntil ? new Date(sync.leaseUntil) : null;

    if (currentOwner !== leaseOwner) {
      return { ok: false, held: false, reason: 'lease_owner_mismatch', currentOwner, currentFencingToken: currentToken };
    }
    if (fencingToken !== undefined && fencingToken !== null && Number(fencingToken) !== currentToken) {
      return { ok: false, held: false, reason: 'fencing_token_mismatch', currentOwner, currentFencingToken: currentToken };
    }
    if (!currentLeaseUntil || currentLeaseUntil <= now) {
      return { ok: false, held: false, reason: 'lease_expired', currentOwner, currentFencingToken: currentToken };
    }

    return {
      ok: true,
      held: true,
      leaseOwner: currentOwner,
      leaseUntil: sync.leaseUntil,
      fencingToken: currentToken
    };
  },

  manager_mark_command_sync_pending: async (db, params) => {
    const workerId = getParam(params, 'p_worker_id', 'worker_id', 'workerId');
    const commandId = getParam(params, 'p_command_id', 'command_id', 'commandId');
    const syncState = getParam(params, 'p_sync_state', 'sync_state', 'syncState') || {};
    const terminalFailed = Boolean(getParam(params, 'p_terminal_failed', 'terminal_failed', 'terminalFailed'));
    const leaseOwner = getParam(params, 'p_lease_owner', 'lease_owner', 'leaseOwner');
    const fencingToken = getParam(params, 'p_fencing_token', 'fencing_token', 'fencingToken');

    const commandsMap = db.tables.get('manager_commands');
    let row = commandsMap ? commandsMap.get(String(commandId)) : null;
    if (!row || row.worker_id !== workerId) return false;

    if (!['queued', 'delivered', 'execution_completed', 'state_sync_pending'].includes(row.status)) {
      return false;
    }

    const sync = (row.result && row.result._stateSync) || {};
    const currentOwner = sync.leaseOwner || null;
    const currentToken = Number(sync.fencingToken || 0);

    if (leaseOwner && currentOwner && currentOwner !== leaseOwner) return false;
    if (fencingToken !== undefined && fencingToken !== null && currentToken > 0 && Number(fencingToken) !== currentToken) {
      return false;
    }

    row.status = terminalFailed ? 'state_sync_failed' : 'state_sync_pending';
    row.result = {
      ...(row.result || {}),
      _stateSync: {
        ...sync,
        ...syncState,
        pending: !terminalFailed,
        updatedAt: new Date().toISOString()
      }
    };
    commandsMap.set(String(commandId), row);
    return true;
  },

  manager_finalize_command_sync: async (db, params) => {
    const workerId = getParam(params, 'p_worker_id', 'worker_id', 'workerId');
    const commandId = getParam(params, 'p_command_id', 'command_id', 'commandId');
    const result = getParam(params, 'p_result', 'result');
    const leaseOwner = getParam(params, 'p_lease_owner', 'lease_owner', 'leaseOwner');
    const fencingToken = getParam(params, 'p_fencing_token', 'fencing_token', 'fencingToken');

    const commandsMap = db.tables.get('manager_commands');
    let row = commandsMap ? commandsMap.get(String(commandId)) : null;
    if (!row || row.worker_id !== workerId) return false;

    if (row.status === 'completed') return true;
    if (!['queued', 'delivered', 'execution_completed', 'state_sync_pending'].includes(row.status)) {
      return false;
    }

    const currentOwner = row.result?._stateSync?.leaseOwner || null;
    const currentToken = Number(row.result?._stateSync?.fencingToken || 0);

    if (leaseOwner && currentOwner && currentOwner !== leaseOwner) return false;
    if (fencingToken !== undefined && fencingToken !== null && currentToken > 0 && Number(fencingToken) !== currentToken) {
      return false;
    }

    const finalResult = { ...(result || row.result || {}) };
    delete finalResult._stateSync;

    row.status = 'completed';
    row.result = finalResult;
    row.completed_at = new Date().toISOString();
    commandsMap.set(String(commandId), row);
    return true;
  },

  manager_claim_pending_command_syncs: async (db, params) => {
    const leaseOwner = getParam(params, 'p_lease_owner', 'lease_owner', 'leaseOwner');
    const limit = Math.max(1, Math.min(100, Number(getParam(params, 'p_limit', 'limit') || 10)));
    const leaseSeconds = Math.max(1, Math.min(3600, Number(getParam(params, 'p_lease_seconds', 'lease_seconds') || 60)));

    if (!leaseOwner || !String(leaseOwner).trim()) return [];

    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
    const commandsMap = db.tables.get('manager_commands');
    const rows = Array.from(commandsMap.values());

    const claimed = [];
    for (const r of rows) {
      if (claimed.length >= limit) break;
      if (!['state_sync_pending', 'execution_completed'].includes(r.status)) continue;

      const sync = r.result?._stateSync || {};
      const nextRetryAt = sync.nextRetryAt ? new Date(sync.nextRetryAt) : null;
      const curLeaseUntil = sync.leaseUntil ? new Date(sync.leaseUntil) : null;

      if (nextRetryAt && nextRetryAt > now) continue;
      if (curLeaseUntil && curLeaseUntil > now && sync.leaseOwner && sync.leaseOwner !== leaseOwner) continue;

      const nextToken = Number(sync.fencingToken || 0) + 1;
      r.status = 'state_sync_pending';
      r.result = {
        ...(r.result || {}),
        _stateSync: {
          ...sync,
          pending: true,
          leaseOwner,
          leaseUntil,
          fencingToken: nextToken,
          attempts: Number(sync.attempts || 0) + 1,
          updatedAt: now.toISOString()
        }
      };
      commandsMap.set(String(r.command_id), r);
      claimed.push(r);
    }
    return claimed;
  },

  // Category 2: Command Queue RPCs (4 RPCs)
  manager_enqueue_worker_command: async (db, params) => {
    const commandId = getParam(params, 'p_command_id', 'command_id') || crypto.randomUUID();
    const workerId = getParam(params, 'p_worker_id', 'worker_id');
    const action = getParam(params, 'p_action', 'action');
    const payload = getParam(params, 'p_payload', 'payload') || {};
    const createdAt = getParam(params, 'p_created_at', 'created_at') || new Date().toISOString();
    const expiresAt = getParam(params, 'p_expires_at', 'expires_at') || null;
    const allowCoalesce = Boolean(getParam(params, 'p_allow_coalesce', 'allow_coalesce'));

    const commandsMap = db.tables.get('manager_commands');

    if (allowCoalesce) {
      for (const cmd of commandsMap.values()) {
        if (cmd.worker_id === workerId && cmd.action === action && cmd.status === 'queued') {
          cmd.payload = payload;
          cmd.created_at = createdAt;
          cmd.expires_at = expiresAt;
          commandsMap.set(String(cmd.command_id), cmd);
          return [cmd];
        }
      }
    }

    const newCmd = {
      command_id: String(commandId),
      worker_id: String(workerId),
      action: String(action),
      payload,
      status: 'queued',
      result: null,
      created_at: createdAt,
      expires_at: expiresAt,
      delivered_at: null,
      completed_at: null
    };
    commandsMap.set(newCmd.command_id, newCmd);
    return [newCmd];
  },

  manager_take_worker_command: async (db, params) => {
    const workerId = getParam(params, 'p_worker_id', 'worker_id');
    const commandsMap = db.tables.get('manager_commands');
    const now = new Date();

    const candidates = Array.from(commandsMap.values()).filter(
      (c) => c.worker_id === workerId && c.status === 'queued'
    );
    candidates.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    for (const cmd of candidates) {
      if (cmd.expires_at && new Date(cmd.expires_at) <= now) {
        cmd.status = 'expired';
        commandsMap.set(String(cmd.command_id), cmd);
        continue;
      }
      cmd.status = 'delivered';
      cmd.delivered_at = now.toISOString();
      commandsMap.set(String(cmd.command_id), cmd);
      return [cmd];
    }
    return [];
  },

  manager_complete_worker_command: async (db, params) => {
    const workerId = getParam(params, 'p_worker_id', 'worker_id');
    const commandId = getParam(params, 'p_command_id', 'command_id');
    const result = getParam(params, 'p_result', 'result') || {};

    const commandsMap = db.tables.get('manager_commands');
    let row = commandsMap.get(String(commandId));
    if (!row || row.worker_id !== workerId) return false;

    row.status = result.ok === false ? 'failed' : 'completed';
    row.result = result;
    row.completed_at = new Date().toISOString();
    commandsMap.set(String(commandId), row);
    return true;
  },

  manager_expire_worker_command: async (db, params) => {
    const commandId = getParam(params, 'p_command_id', 'command_id');
    const commandsMap = db.tables.get('manager_commands');
    let row = commandsMap.get(String(commandId));
    if (!row) return false;
    if (['queued', 'delivered'].includes(row.status)) {
      row.status = 'expired';
      commandsMap.set(String(commandId), row);
      return true;
    }
    return false;
  },

  // Category 3: Worker Fleet Management (5 RPCs)
  manager_next_bot_number: async (db) => {
    const workersMap = db.tables.get('manager_workers');
    let maxNum = 0;
    for (const w of workersMap.values()) {
      const num = Number(w.bot_number);
      if (!Number.isNaN(num) && num > maxNum) maxNum = num;
    }
    const currentSeq = db.sequences.get('manager_bot_number_seq') || 0;
    const nextVal = Math.max(maxNum, currentSeq) + 1;
    db.sequences.set('manager_bot_number_seq', nextVal);
    return nextVal;
  },

  manager_patch_worker_settings: async (db, params) => {
    const workerId = getParam(params, 'p_worker_id', 'worker_id');
    const patch = getParam(params, 'p_patch', 'patch') || {};
    const workersMap = db.tables.get('manager_workers');
    let row = workersMap.get(String(workerId));
    if (!row) return {};

    const existingSettings = row.settings || {};
    row.settings = { ...existingSettings, ...patch };
    row.updated_at = new Date().toISOString();
    workersMap.set(String(workerId), row);
    return row.settings;
  },

  manager_reset_worker_data: async (db, params) => {
    const workerId = getParam(params, 'p_worker_id', 'worker_id');
    const workersMap = db.tables.get('manager_workers');
    let row = workersMap.get(String(workerId));
    if (!row) return false;

    row.settings = {};
    row.status = { state: 'offline', online: false };
    row.events = [];
    row.last_event = null;
    row.updated_at = new Date().toISOString();
    workersMap.set(String(workerId), row);
    return true;
  },

  manager_append_worker_event: async (db, params) => {
    const workerId = getParam(params, 'p_worker_id', 'worker_id');
    const event = getParam(params, 'p_event', 'event') || {};
    const workersMap = db.tables.get('manager_workers');
    let row = workersMap.get(String(workerId));
    if (!row) return false;

    row.last_event = event;
    const evArr = row.events && Array.isArray(row.events) ? [...row.events] : [];
    evArr.unshift(event);
    row.events = evArr.slice(0, 100);
    row.updated_at = new Date().toISOString();
    workersMap.set(String(workerId), row);
    return true;
  },

  patch_manager_registry: async (db, params) => {
    const patch = getParam(params, 'p_patch', 'patch') || {};
    const resetPatch = getParam(params, 'p_pending_reset_patch', 'pending_reset_patch');
    const resetDeletes = getParam(params, 'p_pending_reset_deletes', 'pending_reset_deletes');

    const regMap = db.tables.get('bot_registry');
    let reg = regMap.get('default') || {
      id: 'default',
      data: { systemSettings: {}, webhook: {}, pendingResets: {} },
      updated_at: new Date().toISOString()
    };

    const data = reg.data || {};
    const pendingResets = data.pendingResets || {};

    if (resetPatch && typeof resetPatch === 'object') {
      Object.assign(pendingResets, resetPatch);
    }
    if (Array.isArray(resetDeletes)) {
      for (const k of resetDeletes) {
        delete pendingResets[k];
      }
    }

    reg.data = {
      ...data,
      ...patch,
      pendingResets
    };
    reg.updated_at = new Date().toISOString();
    regMap.set('default', reg);
    return reg.data;
  },

  // Category 4: Telemetry & Position (1 RPC)
  record_bot_position_change: async (db, params) => {
    const id = getParam(params, 'p_id', 'id') || crypto.randomUUID();
    const botId = getParam(params, 'p_bot_id', 'bot_id');
    const changedAt = getParam(params, 'p_changed_at', 'changed_at') || new Date().toISOString();
    const toPos = getParam(params, 'p_to_position', 'to_position') || {};
    const toDim = getParam(params, 'p_to_dimension', 'to_dimension') || 'overworld';
    const locState = getParam(params, 'p_location_state', 'location_state') || 'idle';
    const reason = getParam(params, 'p_reason', 'reason') || '';
    const eventKey = getParam(params, 'p_event_key', 'event_key');
    const minDistance = Number(getParam(params, 'p_min_distance', 'min_distance') || 0);

    const posLogs = db.tables.get('bot_position_logs');
    if (eventKey) {
      for (const log of posLogs.values()) {
        if (log.event_key === eventKey) {
          return { ok: true, recorded: false, duplicate: true };
        }
      }
    }

    const stateMap = db.tables.get('bot_position_state');
    const prevState = stateMap.get(String(botId)) || {};
    const fromPos = prevState.position || null;

    let dist = 999;
    if (fromPos && fromPos.x !== undefined && toPos.x !== undefined) {
      dist = Math.hypot(toPos.x - fromPos.x, toPos.y - fromPos.y, toPos.z - fromPos.z);
    }

    const dimChanged = prevState.dimension && prevState.dimension !== toDim;
    const stateChanged = prevState.location_state && prevState.location_state !== locState;

    if (dist >= minDistance || dimChanged || stateChanged || !fromPos) {
      posLogs.set(String(id), {
        id: String(id),
        bot_id: String(botId),
        changed_at: changedAt,
        from_position: fromPos,
        to_position: toPos,
        from_dimension: prevState.dimension || toDim,
        to_dimension: toDim,
        location_state: locState,
        reason,
        event_key: eventKey || null
      });

      stateMap.set(String(botId), {
        bot_id: String(botId),
        position: toPos,
        dimension: toDim,
        location_state: locState,
        last_event_key: eventKey || null,
        updated_at: changedAt
      });
      return { ok: true, recorded: true };
    }

    return { ok: true, recorded: false };
  },

  // Category 5: Registration, Licensing & Access (6 RPCs)
  manager_register_trial_user: async (db, params) => {
    const rawUser = String(getParam(params, 'p_username', 'username') || '').trim().toLowerCase();
    let userId = getParam(params, 'p_user_id', 'user_id');
    const password = getParam(params, 'p_password', 'password');
    const trialDays = Math.max(1, Number(getParam(params, 'p_trial_days', 'trial_days') || 1));
    const planName = getParam(params, 'p_plan_name', 'plan_name') || 'FREE TRIAL';
    const registrationIp = getParam(params, 'p_registration_ip', 'registration_ip') || null;
    const deviceFingerprint = getParam(params, 'p_device_fingerprint', 'device_fingerprint') || null;
    const registrationUserAgent = getParam(params, 'p_registration_user_agent', 'registration_user_agent') || null;

    if (!rawUser) {
      throw new Error('Tên đăng nhập không hợp lệ.');
    }
    if (!userId || !String(userId).trim()) {
      userId = `usr_${rawUser}`;
    }

    const usersMap = db.tables.get('manager_users');
    for (const u of usersMap.values()) {
      if (String(u.username).toLowerCase() === rawUser || String(u.id) === userId) {
        throw new Error('Tên đăng nhập này đã có người sử dụng.');
      }
    }

    const workersMap = db.tables.get('manager_workers');
    const assignmentsMap = db.tables.get('manager_assignments');

    let availableWorker = null;
    const sortedWorkers = Array.from(workersMap.values()).sort((a, b) => Number(a.bot_number) - Number(b.bot_number));

    for (const w of sortedWorkers) {
      if (!w.enabled) continue;
      if (assignmentsMap.has(String(w.worker_id))) continue;
      let alreadyAssigned = false;
      for (const u of usersMap.values()) {
        const assigned = Array.isArray(u.assigned_bot_ids) ? u.assigned_bot_ids : [];
        if (assigned.includes(w.worker_id)) {
          alreadyAssigned = true;
          break;
        }
      }
      if (!alreadyAssigned) {
        availableWorker = w;
        break;
      }
    }

    if (!availableWorker) {
      throw new Error('NO_WORKERS_AVAILABLE: Hiện tại hệ thống không còn Bot rảnh để cấp dùng thử. Vui lòng liên hệ Quản trị viên.');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000).toISOString();
    const newUser = {
      id: userId,
      username: rawUser,
      password: password || '',
      role: 'user',
      status: 'active',
      is_permanent: false,
      is_trial: true,
      trial_bot_id: availableWorker.worker_id,
      expires_at: expiresAt,
      plan_name: planName,
      assigned_bot_ids: [availableWorker.worker_id],
      bot_count: 1,
      note: 'Đăng ký mới (Free Trial 1 Bot)',
      allow_account_change: true,
      lock_reason: '',
      registration_ip: registrationIp,
      device_fingerprint: deviceFingerprint,
      registration_user_agent: registrationUserAgent,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };
    usersMap.set(rawUser, newUser);

    assignmentsMap.set(String(availableWorker.worker_id), {
      worker_id: availableWorker.worker_id,
      user_id: userId,
      assigned_by: 'system:trial',
      assigned_at: now.toISOString()
    });

    return {
      ok: true,
      userId,
      username: rawUser,
      workerId: availableWorker.worker_id,
      botNumber: availableWorker.bot_number,
      expiresAt,
      planName
    };
  },

  manager_set_user_access: async (db, params) => {
    const rawUserId = String(getParam(params, 'p_user_id', 'user_id') || '').trim();
    const values = getParam(params, 'p_values', 'values') || {};
    const workerIds = getParam(params, 'p_worker_ids', 'worker_ids') || [];
    const actorId = getParam(params, 'p_actor_id', 'actor_id') || 'system';

    const cleanUser = rawUserId.toLowerCase();
    const hintUser = String(values.username || '').trim().toLowerCase();
    const usersMap = db.tables.get('manager_users');
    const assignmentsMap = db.tables.get('manager_assignments');

    let existingUser = null;
    for (const u of usersMap.values()) {
      if (u.id === rawUserId || String(u.username).toLowerCase() === cleanUser || (hintUser && String(u.username).toLowerCase() === hintUser)) {
        existingUser = u;
        break;
      }
    }

    const now = new Date().toISOString();
    const targetUsername = existingUser ? existingUser.username : (hintUser || (cleanUser.startsWith('usr_') ? cleanUser.slice(4) : cleanUser));
    const targetId = existingUser ? existingUser.id : (values.id || (cleanUser.startsWith('usr_') ? cleanUser : `usr_${targetUsername}`));

    let userRecord;
    if (existingUser) {
      userRecord = {
        ...existingUser,
        role: values.role !== undefined ? values.role : existingUser.role,
        status: values.status !== undefined ? values.status : existingUser.status,
        is_permanent: values.is_permanent !== undefined ? Boolean(values.is_permanent) : existingUser.is_permanent,
        expires_at: values.expires_at !== undefined ? values.expires_at : existingUser.expires_at,
        plan_name: values.plan_name !== undefined ? values.plan_name : existingUser.plan_name,
        bot_aliases: values.bot_aliases !== undefined ? values.bot_aliases : existingUser.bot_aliases,
        allow_account_change: values.allow_account_change !== undefined ? Boolean(values.allow_account_change) : existingUser.allow_account_change,
        lock_reason: values.lock_reason !== undefined ? values.lock_reason : existingUser.lock_reason,
        note: values.note !== undefined ? values.note : existingUser.note,
        bot_count: Math.max(Number(values.bot_count || existingUser.bot_count || 1), workerIds.length),
        assigned_bot_ids: workerIds,
        registration_ip: values.registration_ip !== undefined ? values.registration_ip : existingUser.registration_ip,
        device_fingerprint: values.device_fingerprint !== undefined ? values.device_fingerprint : existingUser.device_fingerprint,
        registration_user_agent: values.registration_user_agent !== undefined ? values.registration_user_agent : existingUser.registration_user_agent,
        updated_at: now
      };
    } else {
      userRecord = {
        id: targetId,
        username: targetUsername,
        role: values.role || 'user',
        status: values.status || 'active',
        is_permanent: Boolean(values.is_permanent),
        expires_at: values.expires_at || null,
        plan_name: values.plan_name || 'Gói mặc định',
        bot_aliases: values.bot_aliases || {},
        allow_account_change: values.allow_account_change !== undefined ? Boolean(values.allow_account_change) : true,
        lock_reason: values.lock_reason || '',
        note: values.note || '',
        bot_count: Math.max(Number(values.bot_count || 1), workerIds.length),
        assigned_bot_ids: workerIds,
        registration_ip: values.registration_ip || null,
        device_fingerprint: values.device_fingerprint || null,
        registration_user_agent: values.registration_user_agent || null,
        created_at: now,
        updated_at: now
      };
    }
    usersMap.set(String(targetUsername), userRecord);

    // Sync assignments
    for (const [wId, a] of assignmentsMap.entries()) {
      if (a.user_id === targetId && !workerIds.includes(wId)) {
        assignmentsMap.delete(wId);
      }
    }
    for (const wId of workerIds) {
      assignmentsMap.set(String(wId), {
        worker_id: String(wId),
        user_id: targetId,
        assigned_by: actorId,
        assigned_at: now
      });
    }

    return [userRecord];
  },

  manager_delete_user_access: async (db, params) => {
    const rawUserId = String(getParam(params, 'p_user_id', 'user_id') || '').trim();
    const usersMap = db.tables.get('manager_users');
    const assignmentsMap = db.tables.get('manager_assignments');
    const discordMap = db.tables.get('manager_discord_links');
    const sessionsMap = db.tables.get('manager_sessions');
    const revMap = db.tables.get('manager_session_revocations');

    let foundUser = null;
    for (const [username, u] of usersMap.entries()) {
      if (u.id === rawUserId || String(u.username).toLowerCase() === rawUserId.toLowerCase()) {
        foundUser = u;
        usersMap.delete(username);
        break;
      }
    }

    if (foundUser) {
      for (const [wId, a] of assignmentsMap.entries()) {
        if (a.user_id === foundUser.id) assignmentsMap.delete(wId);
      }
      for (const [dId, l] of discordMap.entries()) {
        if (l.manager_user_id === foundUser.id || l.username === foundUser.username) {
          discordMap.delete(dId);
        }
      }
      for (const [tHash, s] of sessionsMap.entries()) {
        if (s.user_id === foundUser.id || s.username === foundUser.username) {
          sessionsMap.delete(tHash);
          revMap.set(tHash, { token_hash: tHash, revoked_at: new Date().toISOString() });
        }
      }
    }
    return { ok: true, deleted: Boolean(foundUser) };
  },

  manager_redeem_code_with_access: async (db, params) => {
    const codeHash = getParam(params, 'p_code_hash', 'code_hash');
    const userId = getParam(params, 'p_user_id', 'user_id');
    const accessValues = getParam(params, 'p_access_values', 'access_values') || {};
    const workerIds = getParam(params, 'p_worker_ids', 'worker_ids') || [];
    const actorId = getParam(params, 'p_actor_id', 'actor_id') || 'system:redeem';

    const keysMap = db.tables.get('manager_keys');
    let keyRow = null;

    for (const k of keysMap.values()) {
      if (
        k.id === codeHash ||
        k.code === codeHash ||
        k.key_code === codeHash ||
        k.code_hash === codeHash
      ) {
        keyRow = k;
        break;
      }
    }

    if (!keyRow) {
      throw new Error('Mã kích hoạt không tồn tại.');
    }
    if (keyRow.is_active === false) {
      throw new Error('Mã kích hoạt đã bị khóa.');
    }
    const maxUses = Number(keyRow.max_uses ?? 1);
    const usedCount = Number(keyRow.used_count ?? 0);
    if (usedCount >= maxUses) {
      throw new Error('Mã kích hoạt đã hết lượt sử dụng.');
    }

    const now = new Date();
    if (keyRow.expires_at && new Date(keyRow.expires_at) < now) {
      throw new Error('Mã kích hoạt đã hết hạn sử dụng.');
    }

    const usedBy = Array.isArray(keyRow.used_by) ? [...keyRow.used_by] : [];
    usedBy.push(userId);
    keyRow.used_by = usedBy;
    keyRow.used_count = usedCount + 1;
    keyRow.used_at = now.toISOString();
    keysMap.set(String(keyRow.id || keyRow.code), keyRow);

    await RpcRegistry.handlers.manager_set_user_access(db, {
      p_user_id: userId,
      p_values: accessValues,
      p_worker_ids: workerIds,
      p_actor_id: actorId
    });

    return [keyRow];
  },

  manager_link_discord_account: async (db, params) => {
    const discordId = getParam(params, 'p_discord_user_id', 'discord_user_id');
    const managerUserId = getParam(params, 'p_manager_user_id', 'manager_user_id');
    const username = getParam(params, 'p_username', 'username');

    const discordMap = db.tables.get('manager_discord_links');
    const now = new Date().toISOString();

    const linkRow = {
      discord_user_id: String(discordId),
      manager_user_id: String(managerUserId),
      username: String(username),
      linked_at: now,
      last_verified_at: now,
      status: 'active',
      revoked_at: null
    };
    discordMap.set(String(discordId), linkRow);

    const usersMap = db.tables.get('manager_users');
    for (const u of usersMap.values()) {
      if (u.id === managerUserId || String(u.username).toLowerCase() === String(username).toLowerCase()) {
        u.discord_user_id = String(discordId);
        usersMap.set(String(u.username), u);
      }
    }
    return { ok: true, linked: true };
  },

  manager_unlink_discord_account: async (db, params) => {
    const id = getParam(params, 'p_identifier', 'identifier');
    const discordMap = db.tables.get('manager_discord_links');
    const usersMap = db.tables.get('manager_users');

    let unlinked = false;
    for (const [dId, l] of discordMap.entries()) {
      if (dId === id || l.manager_user_id === id || l.username === id) {
        discordMap.delete(dId);
        unlinked = true;
      }
    }
    for (const u of usersMap.values()) {
      if (u.discord_user_id === id || u.id === id || u.username === id) {
        u.discord_user_id = null;
        usersMap.set(String(u.username), u);
      }
    }
    return { ok: true, unlinked };
  },

  read_manager_users_snapshot: async (db, params) => {
    const expectedRevision = getParam(params, 'p_expected_revision', 'expected_revision');
    const stateMap = db.tables.get('manager_user_state');
    const state = stateMap.get(true) || { singleton: true, revision: 1 };
    const usersMap = db.tables.get('manager_users');
    const users = Array.from(usersMap.values());
    return {
      revision: state.revision,
      users,
      match: expectedRevision !== undefined ? Number(expectedRevision) === Number(state.revision) : true
    };
  },

  save_manager_users_snapshot: async (db, params) => {
    const expectedRev = Number(getParam(params, 'p_expected_revision', 'expected_revision'));
    const users = getParam(params, 'p_users', 'users') || [];
    const stateMap = db.tables.get('manager_user_state');
    const state = stateMap.get(true) || { singleton: true, revision: 1 };

    if (expectedRev !== undefined && Number(state.revision) !== expectedRev) {
      return { ok: false, conflict: true, currentRevision: state.revision };
    }

    const usersMap = db.tables.get('manager_users');
    usersMap.clear();
    for (const u of users) {
      usersMap.set(String(u.username), u);
    }

    state.revision = Number(state.revision) + 1;
    state.updated_at = new Date().toISOString();
    stateMap.set(true, state);
    return { ok: true, revision: state.revision };
  },

  insert_manager_users_if_absent: async (db, params) => {
    const users = getParam(params, 'p_users', 'users') || [];
    const usersMap = db.tables.get('manager_users');
    const inserted = [];
    for (const u of users) {
      if (!usersMap.has(String(u.username))) {
        usersMap.set(String(u.username), u);
        inserted.push(u);
      }
    }
    return inserted;
  },

  redeem_manager_key_and_save_users: async (db, params) => {
    return RpcRegistry.handlers.manager_redeem_code_with_access(db, params);
  },

  // Category 6: Link4M Rewards (7 RPCs)
  start_manager_link4m_attempt: async (db, params) => {
    const attemptId = getParam(params, 'p_attempt_id', 'attempt_id') || crypto.randomUUID();
    const tokenHash = getParam(params, 'p_token_hash', 'token_hash');
    const username = getParam(params, 'p_username', 'username');
    const vnDate = getParam(params, 'p_vietnam_date', 'vietnam_date') || new Date().toISOString().slice(0, 10);
    const dailyLimit = Number(getParam(params, 'p_daily_limit', 'daily_limit') || 3);
    const rewardHours = Number(getParam(params, 'p_reward_hours', 'reward_hours') || 24);
    const ip = getParam(params, 'p_ip_address', 'ip_address') || '127.0.0.1';
    const ref = getParam(params, 'p_provider_reference', 'provider_reference') || '';

    const attemptsMap = db.tables.get('manager_link4m_attempts');
    let countToday = 0;
    for (const a of attemptsMap.values()) {
      if (a.username === username && a.vietnam_date === vnDate && a.status === 'rewarded') {
        countToday++;
      }
    }
    if (countToday >= dailyLimit) {
      return { ok: false, reason: 'daily_limit_exceeded' };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const attemptRow = {
      attempt_id: String(attemptId),
      username,
      token_hash: tokenHash,
      status: 'pending',
      vietnam_date: vnDate,
      created_at: now.toISOString(),
      expires_at: expiresAt,
      verified_at: null,
      rewarded_at: null,
      reward_hours: rewardHours,
      short_url: null,
      sync_status: 'none',
      ip_address: ip,
      provider_reference: ref,
      updated_at: now.toISOString()
    };
    attemptsMap.set(String(attemptId), attemptRow);
    return { ok: true, attempt_id: attemptId };
  },

  manager_claim_link4m_attempt: async (db, params) => {
    const attemptId = getParam(params, 'p_attempt_id', 'attempt_id');
    const attemptsMap = db.tables.get('manager_link4m_attempts');
    let row = attemptsMap.get(String(attemptId));
    if (!row || row.status !== 'pending') return [];
    row.status = 'processing';
    row.updated_at = new Date().toISOString();
    attemptsMap.set(String(attemptId), row);
    return [row];
  },

  manager_complete_link4m_reward: async (db, params) => {
    const attemptId = getParam(params, 'p_attempt_id', 'attempt_id');
    const userId = getParam(params, 'p_user_id', 'user_id');
    const accessValues = getParam(params, 'p_access_values', 'access_values') || {};

    const attemptsMap = db.tables.get('manager_link4m_attempts');
    let row = attemptsMap.get(String(attemptId));
    if (!row) return [];

    row.status = 'rewarded';
    row.rewarded_at = new Date().toISOString();
    row.updated_at = new Date().toISOString();
    attemptsMap.set(String(attemptId), row);

    if (userId) {
      await RpcRegistry.handlers.manager_set_user_access(db, {
        p_user_id: userId,
        p_values: accessValues
      });
    }
    return [row];
  },

  claim_manager_link4m_reward: async (db, params) => {
    const username = String(getParam(params, 'p_username', 'username') || '').trim().toLowerCase();
    const attemptId = String(getParam(params, 'p_attempt_id', 'attempt_id') || '');
    const usersMap = db.tables.get('manager_users');
    let userRow = null;
    if (usersMap) {
      for (const u of usersMap.values()) {
        if (String(u.username || '').trim().toLowerCase() === username || String(u.id || '') === username) {
          userRow = u;
          break;
        }
      }
    }
    if (userRow?.is_permanent === true) {
      const attemptsMap = db.tables.get('manager_link4m_attempts');
      const row = attemptsMap?.get(attemptId);
      if (row) {
        row.status = 'rewarded';
        row.rewarded_at = new Date().toISOString();
        row.updated_at = new Date().toISOString();
        attemptsMap.set(attemptId, row);
      }
      return { ok: true, permanent: true, expiresAt: null, message: 'Tài khoản của bạn là VIP Vĩnh viễn!' };
    }
    return RpcRegistry.handlers.manager_complete_link4m_reward(db, params);
  },

  rollback_manager_link4m_attempt: async (db, params) => {
    const attemptId = getParam(params, 'p_attempt_id', 'attempt_id');
    const attemptsMap = db.tables.get('manager_link4m_attempts');
    let row = attemptsMap.get(String(attemptId));
    if (!row) return false;
    row.status = 'expired';
    row.updated_at = new Date().toISOString();
    attemptsMap.set(String(attemptId), row);
    return true;
  },

  set_manager_link4m_short_url: async (db, params) => {
    const attemptId = getParam(params, 'p_attempt_id', 'attempt_id');
    const shortUrl = getParam(params, 'p_short_url', 'short_url');
    const attemptsMap = db.tables.get('manager_link4m_attempts');
    let row = attemptsMap.get(String(attemptId));
    if (!row) return false;
    row.short_url = shortUrl;
    row.updated_at = new Date().toISOString();
    attemptsMap.set(String(attemptId), row);
    return true;
  },

  update_manager_link4m_sync_status: async (db, params) => {
    const attemptId = getParam(params, 'p_attempt_id', 'attempt_id');
    const status = getParam(params, 'p_sync_status', 'sync_status');
    const attemptsMap = db.tables.get('manager_link4m_attempts');
    let row = attemptsMap.get(String(attemptId));
    if (!row) return false;
    row.sync_status = status;
    row.updated_at = new Date().toISOString();
    attemptsMap.set(String(attemptId), row);
    return true;
  },

  // Category 7: Sessions, Revocations & Locks (9 RPCs)
  create_manager_user_session: async (db, params) => {
    const session = getParam(params, 'p_session', 'session') || {};
    const tokenHash = session.token_hash || crypto.randomUUID();
    const sessionsMap = db.tables.get('manager_sessions');

    const row = {
      token_hash: tokenHash,
      user_id: session.user_id || `usr_${session.username}`,
      username: session.username || 'user',
      role: session.role || 'user',
      assigned_bot_ids: session.assigned_bot_ids || [],
      expires_at: session.expires_at || Date.now() + 24 * 60 * 60 * 1000,
      plan_name: session.plan_name || 'Standard',
      allow_account_change: session.allow_account_change !== undefined ? session.allow_account_change : true,
      status: session.status || 'active',
      updated_at: new Date().toISOString()
    };
    sessionsMap.set(tokenHash, row);
    return { ok: true, token_hash: tokenHash };
  },

  read_manager_session: async (db, params) => {
    const tokenHash = getParam(params, 'p_token_hash', 'token_hash');
    const revMap = db.tables.get('manager_session_revocations');
    if (revMap.has(String(tokenHash))) return null;

    const sessionsMap = db.tables.get('manager_sessions');
    const row = sessionsMap.get(String(tokenHash));
    if (!row) return null;

    if (row.expires_at && Number(row.expires_at) < Date.now()) {
      return null;
    }
    return row;
  },

  read_manager_authorization: async (db, params) => {
    const session = await RpcRegistry.handlers.read_manager_session(db, params);
    if (!session) return { ok: false, authorized: false };

    const usersMap = db.tables.get('manager_users');
    let userRow = null;
    for (const u of usersMap.values()) {
      if (u.id === session.user_id || String(u.username).toLowerCase() === String(session.username).toLowerCase()) {
        userRow = u;
        break;
      }
    }

    if (userRow && userRow.status === 'disabled') {
      return { ok: false, authorized: false, reason: 'user_disabled' };
    }
    return { ok: true, authorized: true, role: session?.role || (userRow?.role || 'user'), session, user: userRow };
  },

  revoke_manager_session: async (db, params) => {
    const tokenHash = getParam(params, 'p_token_hash', 'token_hash');
    const sessionsMap = db.tables.get('manager_sessions');
    const revMap = db.tables.get('manager_session_revocations');
    sessionsMap.delete(String(tokenHash));
    revMap.set(String(tokenHash), { token_hash: String(tokenHash), revoked_at: new Date().toISOString() });
    return true;
  },

  revoke_manager_user_sessions: async (db, params) => {
    const userId = getParam(params, 'p_user_id', 'user_id');
    const sessionsMap = db.tables.get('manager_sessions');
    const revMap = db.tables.get('manager_session_revocations');

    let revokedCount = 0;
    for (const [tHash, s] of sessionsMap.entries()) {
      if (s.user_id === userId || s.username === userId) {
        if (s.role !== 'admin') {
          sessionsMap.delete(tHash);
          revMap.set(tHash, { token_hash: tHash, revoked_at: new Date().toISOString() });
          revokedCount++;
        }
      }
    }
    return { ok: true, revokedCount };
  },

  acquire_manager_lock: async (db, params) => {
    const lockKey = getParam(params, 'p_lock_key', 'lock_key');
    const ownerId = getParam(params, 'p_owner_id', 'owner_id');
    const leaseSeconds = Math.max(1, Number(getParam(params, 'p_lease_seconds', 'lease_seconds') || 30));

    const locksMap = db.tables.get('manager_locks');
    const now = new Date();
    let row = locksMap.get(String(lockKey));

    if (row && row.owner_id && row.owner_id !== ownerId) {
      const leaseUntil = row.lease_until ? new Date(row.lease_until) : null;
      if (leaseUntil && leaseUntil > now) {
        return { ok: false, acquired: false, reason: 'locked', currentOwner: row.owner_id };
      }
    }

    const nextToken = Number(row?.fencing_token || 0) + 1;
    const newLease = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
    const newRow = {
      lock_key: String(lockKey),
      owner_id: String(ownerId),
      lease_until: newLease,
      fencing_token: nextToken,
      updated_at: now.toISOString()
    };
    locksMap.set(String(lockKey), newRow);
    return { ok: true, acquired: true, fencing_token: nextToken, leaseUntil: newLease };
  },

  release_manager_lock: async (db, params) => {
    const lockKey = getParam(params, 'p_lock_key', 'lock_key');
    const ownerId = getParam(params, 'p_owner_id', 'owner_id');
    const locksMap = db.tables.get('manager_locks');
    let row = locksMap.get(String(lockKey));
    if (!row) return true;
    if (row.owner_id === ownerId) {
      locksMap.delete(String(lockKey));
      return true;
    }
    return false;
  },

  renew_manager_lock: async (db, params) => {
    const lockKey = getParam(params, 'p_lock_key', 'lock_key');
    const ownerId = getParam(params, 'p_owner_id', 'owner_id');
    const leaseSeconds = Math.max(1, Number(getParam(params, 'p_lease_seconds', 'lease_seconds') || 30));
    const locksMap = db.tables.get('manager_locks');
    let row = locksMap.get(String(lockKey));
    if (!row || row.owner_id !== ownerId) return false;

    const now = new Date();
    const curLease = row.lease_until ? new Date(row.lease_until) : null;
    if (curLease && curLease <= now) return false;

    row.lease_until = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
    row.updated_at = now.toISOString();
    locksMap.set(String(lockKey), row);
    return true;
  },

  verify_manager_lock_fencing: async (db, params) => {
    const lockKey = getParam(params, 'p_lock_key', 'lock_key');
    const ownerId = getParam(params, 'p_owner_id', 'owner_id');
    const fencingToken = getParam(params, 'p_fencing_token', 'fencing_token');
    const locksMap = db.tables.get('manager_locks');
    let row = locksMap.get(String(lockKey));
    if (!row || row.owner_id !== ownerId) return false;
    if (fencingToken !== undefined && Number(fencingToken) !== Number(row.fencing_token)) return false;
    const now = new Date();
    const curLease = row.lease_until ? new Date(row.lease_until) : null;
    return Boolean(curLease && curLease > now);
  },

  // Category 8: Outbox & Allocations (2 RPCs)
  claim_manager_outbox_batch: async (db, params) => {
    const workerId = getParam(params, 'p_worker_id', 'worker_id');
    const limit = Math.max(1, Math.min(100, Number(getParam(params, 'p_limit', 'limit') || 10)));
    const leaseSeconds = Math.max(1, Number(getParam(params, 'p_lease_seconds', 'lease_seconds') || 60));

    const outboxMap = db.tables.get('manager_outbox_queue');
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();

    const claimed = [];
    for (const item of outboxMap.values()) {
      if (claimed.length >= limit) break;
      if (item.status === 'pending') {
        item.status = 'processing';
        item.lease_owner = workerId;
        item.lease_until = leaseUntil;
        item.attempts = Number(item.attempts || 0) + 1;
        item.updated_at = now.toISOString();
        outboxMap.set(String(item.id), item);
        claimed.push(item);
      }
    }
    return claimed;
  },

  claim_manager_pending_allocations: async (db, params) => {
    const workerId = getParam(params, 'p_worker_id', 'worker_id');
    const limit = Math.max(1, Math.min(100, Number(getParam(params, 'p_limit', 'limit') || 10)));
    const leaseSeconds = Math.max(1, Number(getParam(params, 'p_lease_seconds', 'lease_seconds') || 60));

    const allocMap = db.tables.get('manager_pending_allocations');
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();

    const claimed = [];
    for (const item of allocMap.values()) {
      if (claimed.length >= limit) break;
      if (['pending_retry', 'processing'].includes(item.status)) {
        item.status = 'processing';
        item.lease_owner = workerId;
        item.lease_until = leaseUntil;
        item.attempts = Number(item.attempts || 0) + 1;
        item.updated_at = now.toISOString();
        allocMap.set(String(item.id), item);
        claimed.push(item);
      }
    }
    return claimed;
  },

  // Category 9: Maintenance & Logs (3 RPCs)
  consume_manager_key_usage: async (db, params) => {
    const code = getParam(params, 'p_code', 'code');
    const username = getParam(params, 'p_username', 'username');
    const txId = getParam(params, 'p_transaction_id', 'transaction_id') || crypto.randomUUID();

    const txMap = db.tables.get('manager_key_usage_transactions');
    if (txMap.has(String(txId))) {
      return { ok: true, duplicate: true };
    }
    txMap.set(String(txId), {
      transaction_id: String(txId),
      key_id: String(code),
      username: String(username),
      usage_snapshot: { timestamp: new Date().toISOString() },
      created_at: new Date().toISOString()
    });
    return { ok: true };
  },

  set_bot_log_clear_cutoff: async (db, params) => {
    const botId = getParam(params, 'p_bot_id', 'bot_id');
    const kind = getParam(params, 'p_kind', 'kind') || 'all';
    const cutoff = getParam(params, 'p_cutoff', 'cutoff') || new Date().toISOString();

    const cutoffsMap = db.tables.get('bot_log_clear_cutoffs');
    let row = cutoffsMap.get(String(botId)) || { bot_id: String(botId) };
    if (kind === 'event' || kind === 'all') row.event_cutoff = cutoff;
    if (kind === 'chat' || kind === 'all') row.chat_cutoff = cutoff;
    row.updated_at = new Date().toISOString();
    cutoffsMap.set(String(botId), row);
    return { ok: true, botId, cutoff };
  },

  prune_manager_historical_data: async () => {
    return { ok: true, pruned: true };
  }
};

function generateOpenApiSpec() {
  const definitions = {};
  const paths = {};

  for (const table of SUPABASE_REQUIRED_TABLES) {
    definitions[table] = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        created_at: { type: 'string', format: 'date-time' }
      }
    };
    paths[`/${table}`] = {
      get: { description: `Query ${table}` },
      post: { description: `Insert into ${table}` },
      patch: { description: `Update ${table}` },
      delete: { description: `Delete from ${table}` }
    };
  }

  for (const rpc of REQUIRED_RPCS) {
    paths[`/rpc/${rpc}`] = {
      post: { description: `Execute RPC ${rpc}` }
    };
  }

  return {
    swagger: '2.0',
    info: {
      title: 'PostgREST API',
      version: '11.2.0'
    },
    definitions,
    paths
  };
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) return done({});
      try {
        done(JSON.parse(raw));
      } catch (_) {
        done({});
      }
    });
    req.on('error', () => done({}));
    req.on('close', () => done({}));
  });
}

/**
 * Creates an HTTP server simulating Supabase PostgREST & RPC endpoints.
 */
function createMockSupabaseServer({ port = 0, initialData = {} } = {}) {
  const db = new MockDatabase();
  for (const [table, rows] of Object.entries(initialData)) {
    db.seed(table, rows);
  }

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;
    const searchParams = Object.fromEntries(parsedUrl.searchParams.entries());

    // CORS Headers
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers', '*');
    if (req.method === 'OPTIONS') {
      res.statusCode = 200;
      return res.end();
    }

    // 1. OpenAPI Spec Endpoint (Swagger 2.0)
    if (pathname === '/rest/v1' || pathname === '/rest/v1/') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(generateOpenApiSpec()));
    }

    // 2. RPC Handler: POST /rest/v1/rpc/:name
    if (pathname.startsWith('/rest/v1/rpc/')) {
      const rpcName = pathname.substring('/rest/v1/rpc/'.length).replace(/\/+$/, '');
      const body = await readJsonBody(req);
      try {
        const result = await RpcRegistry.execute(db, rpcName, body);
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify(result));
      } catch (err) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ code: 'P0001', message: err.message }));
      }
    }

    // 3. PostgREST Table CRUD: /rest/v1/:table
    const tableMatch = pathname.match(/^\/rest\/v1\/([a-zA-Z0-9_]+)/);
    if (tableMatch) {
      const table = tableMatch[1];
      const tableMap = db.tables.get(table);
      if (!tableMap) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        return res.end(
          JSON.stringify({ code: '42P01', message: `relation "public.${table}" does not exist` })
        );
      }

      if (req.method === 'GET') {
        const allRows = db.getAllRows(table);
        const filtered = QueryEngine.filterRows(allRows, searchParams);

        if (req.headers['accept'] === 'text/csv') {
          res.setHeader('content-type', 'text/csv');
          return res.end(QueryEngine.toCsv(filtered));
        }

        res.setHeader('content-type', 'application/json');
        if (req.headers['prefer']?.includes('count=exact')) {
          res.setHeader('content-range', `0-${Math.max(0, filtered.length - 1)}/${filtered.length}`);
        }
        if (req.headers['accept']?.includes('vnd.pgrst.object+json')) {
          if (filtered.length === 0) {
            res.statusCode = 406;
            return res.end(
              JSON.stringify({
                code: 'PGRST116',
                message: 'JSON object requested, multiple (or no) rows returned'
              })
            );
          }
          return res.end(JSON.stringify(filtered[0]));
        }
        return res.end(JSON.stringify(filtered));
      }

      if (req.method === 'POST') {
        const payload = await readJsonBody(req);
        const isArray = Array.isArray(payload);
        const rowsToInsert = isArray ? payload : [payload];
        const inserted = [];

        for (const r of rowsToInsert) {
          const rowCopy = { ...r };
          const pk = db.getPrimaryKey(table, rowCopy);
          tableMap.set(pk, rowCopy);
          inserted.push(rowCopy);
        }

        res.statusCode = 201;
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify(isArray ? inserted : inserted[0]));
      }

      if (req.method === 'PATCH') {
        const patch = await readJsonBody(req);
        const allRows = db.getAllRows(table);
        const targets = QueryEngine.filterRows(allRows, searchParams);
        const updated = [];

        for (const t of targets) {
          const pk = db.getPrimaryKey(table, t);
          const current = tableMap.get(pk) || t;
          const merged = { ...current, ...patch };
          tableMap.set(pk, merged);
          updated.push(merged);
        }

        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify(updated));
      }

      if (req.method === 'DELETE') {
        const allRows = db.getAllRows(table);
        const targets = QueryEngine.filterRows(allRows, searchParams);
        const deleted = [];

        for (const t of targets) {
          const pk = db.getPrimaryKey(table, t);
          tableMap.delete(pk);
          deleted.push(t);
        }

        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify(deleted));
      }
    }

    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const assignedPort = server.address().port;
      const url = `http://127.0.0.1:${assignedPort}`;
      resolve({
        server,
        port: assignedPort,
        url,
        secretKey: 'sb_secret_test_mock_supabase_key_service_role',
        db,
        close: () =>
          new Promise((cb) => {
            server.closeIdleConnections?.();
            server.close(cb);
            server.closeAllConnections?.();
          }),
        reset: () => db.reset(),
        seed: (tbl, data) => db.seed(tbl, data)
      });
    });
  });
}

/**
 * Creates an in-memory client emulator matching `@supabase/supabase-js` API.
 */
function createMockSupabaseClient({ initialData = {}, db = null } = {}) {
  const database = db || new MockDatabase();
  for (const [tbl, rows] of Object.entries(initialData)) {
    database.seed(tbl, rows);
  }

  class MockQueryBuilder {
    constructor(tableName) {
      this.tableName = tableName;
      this.queryParams = {};
      this.opType = 'select';
      this.payload = null;
      this.isSingle = false;
      this.isMaybeSingle = false;
      this.wantCount = null;
      this.headOnly = false;
    }

    select(columns = '*', options = {}) {
      if (this.opType === 'select') {
        this.queryParams.select = columns;
      }
      if (options.count) this.wantCount = options.count;
      if (options.head) this.headOnly = true;
      return this;
    }

    insert(values, _options = {}) {
      this.opType = 'insert';
      this.payload = values;
      return this;
    }

    upsert(values, _options = {}) {
      this.opType = 'upsert';
      this.payload = values;
      return this;
    }

    update(values, _options = {}) {
      this.opType = 'update';
      this.payload = values;
      return this;
    }

    delete(_options = {}) {
      this.opType = 'delete';
      return this;
    }

    eq(column, value) {
      this.queryParams[column] = `eq.${value}`;
      return this;
    }

    neq(column, value) {
      this.queryParams[column] = `neq.${value}`;
      return this;
    }

    gt(column, value) {
      this.queryParams[column] = `gt.${value}`;
      return this;
    }

    gte(column, value) {
      this.queryParams[column] = `gte.${value}`;
      return this;
    }

    lt(column, value) {
      this.queryParams[column] = `lt.${value}`;
      return this;
    }

    lte(column, value) {
      this.queryParams[column] = `lte.${value}`;
      return this;
    }

    in(column, values) {
      const arr = Array.isArray(values) ? values : [values];
      this.queryParams[column] = `in.(${arr.join(',')})`;
      return this;
    }

    is(column, value) {
      this.queryParams[column] = `is.${value}`;
      return this;
    }

    like(column, pattern) {
      this.queryParams[column] = `like.${pattern}`;
      return this;
    }

    ilike(column, pattern) {
      this.queryParams[column] = `ilike.${pattern}`;
      return this;
    }

    or(filterString) {
      this.queryParams.or = filterString;
      return this;
    }

    not(column, operator, value) {
      this.queryParams[column] = `not.${operator}.${value}`;
      return this;
    }

    order(column, options = {}) {
      const dir = options.ascending === false ? 'desc' : 'asc';
      this.queryParams.order = `${column}.${dir}`;
      return this;
    }

    limit(n) {
      this.queryParams.limit = n;
      return this;
    }

    range(from, to) {
      this.queryParams.offset = from;
      this.queryParams.limit = to - from + 1;
      return this;
    }

    single() {
      this.isSingle = true;
      return this;
    }

    maybeSingle() {
      this.isMaybeSingle = true;
      return this;
    }

    async execute() {
      const tableMap = database.tables.get(this.tableName);
      if (!tableMap) {
        return {
          data: null,
          error: { code: '42P01', message: `Table ${this.tableName} not found` },
          count: null,
          status: 404,
          statusText: 'Not Found'
        };
      }

      if (this.opType === 'insert' || this.opType === 'upsert') {
        const isArr = Array.isArray(this.payload);
        const rows = isArr ? this.payload : [this.payload];
        const inserted = [];
        for (const r of rows) {
          const rowCopy = { ...r };
          const pk = database.getPrimaryKey(this.tableName, rowCopy);
          tableMap.set(pk, rowCopy);
          inserted.push(rowCopy);
        }
        const data = this.isSingle ? inserted[0] : isArr ? inserted : inserted[0];
        return { data, error: null, count: inserted.length, status: 201, statusText: 'Created' };
      }

      if (this.opType === 'update') {
        const allRows = database.getAllRows(this.tableName);
        const targets = QueryEngine.filterRows(allRows, this.queryParams);
        const updated = [];
        for (const t of targets) {
          const pk = database.getPrimaryKey(this.tableName, t);
          const current = tableMap.get(pk) || t;
          const merged = { ...current, ...this.payload };
          tableMap.set(pk, merged);
          updated.push(merged);
        }
        const data = this.isSingle ? updated[0] : updated;
        return { data, error: null, count: updated.length, status: 200, statusText: 'OK' };
      }

      if (this.opType === 'delete') {
        const allRows = database.getAllRows(this.tableName);
        const targets = QueryEngine.filterRows(allRows, this.queryParams);
        const deleted = [];
        for (const t of targets) {
          const pk = database.getPrimaryKey(this.tableName, t);
          tableMap.delete(pk);
          deleted.push(t);
        }
        return { data: deleted, error: null, count: deleted.length, status: 200, statusText: 'OK' };
      }

      // SELECT
      const allRows = database.getAllRows(this.tableName);
      const totalCount = allRows.length;
      let filtered = QueryEngine.filterRows(allRows, this.queryParams);
      const matchedCount = filtered.length;

      if (this.headOnly) {
        return { data: null, error: null, count: matchedCount, status: 200, statusText: 'OK' };
      }

      if (this.isSingle) {
        if (filtered.length === 0) {
          return {
            data: null,
            error: { code: 'PGRST116', message: 'Row not found' },
            count: 0,
            status: 406,
            statusText: 'Not Acceptable'
          };
        }
        return { data: filtered[0], error: null, count: 1, status: 200, statusText: 'OK' };
      }

      if (this.isMaybeSingle) {
        return {
          data: filtered.length > 0 ? filtered[0] : null,
          error: null,
          count: filtered.length,
          status: 200,
          statusText: 'OK'
        };
      }

      return {
        data: filtered,
        error: null,
        count: this.wantCount ? matchedCount : null,
        status: 200,
        statusText: 'OK'
      };
    }

    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    }
  }

  const client = {
    db: database,
    from(tableName) {
      return new MockQueryBuilder(tableName);
    },
    async rpc(name, params = {}) {
      try {
        const data = await RpcRegistry.execute(database, name, params);
        return { data, error: null };
      } catch (err) {
        return { data: null, error: { message: err.message, code: 'P0001' } };
      }
    },
    adapter: {
      testConnection: async () => ({ ok: true, message: 'Mock Supabase Connected' }),
      isEnabled: () => true
    }
  };

  return client;
}

module.exports = {
  createMockSupabaseServer,
  createMockSupabaseClient,
  MockDatabase,
  QueryEngine,
  RpcRegistry,
  SUPABASE_REQUIRED_TABLES,
  REQUIRED_RPCS,
  generateOpenApiSpec
};
