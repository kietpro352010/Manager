'use strict';

const crypto = require('node:crypto');
const AsyncKeyLock = require('../services/async-key-lock');
const {
  hashPassword,
  encryptUserPassword,
  decryptUserPassword,
  isStoredCredentialCiphertext,
  isUnsupportedCredentialCiphertext,
  timingSafeStringEquals
} = require('../utils/secrets');

const ACCESS = 'manager_access';
const USERS = 'manager_users';
const ASSIGNMENTS = 'manager_assignments';
const KEYS = 'manager_keys';
const AUDIT = 'manager_audit';
const AUDIT_LOGS = 'audit_logs';
const SETTINGS = 'manager_settings';
const LINK_ATTEMPTS = 'manager_link4m_attempts';
const OUTBOX = 'manager_outbox_queue';
const PENDING_ALLOCATIONS = 'manager_pending_allocations';
const BACKUPS = 'manager_backups';

const ACCESS_FIELDS = {
  userId: 'user_id', role: 'role', status: 'status', isPermanent: 'is_permanent', expiresAt: 'expires_at',
  planName: 'plan_name', note: 'note', username: 'username', createdAt: 'created_at', updatedAt: 'updated_at',
  createdBy: 'created_by', updatedBy: 'updated_by'
};

const KEY_FIELDS = {
  keyId: 'key_id', codeHash: 'code_hash', codeSuffix: 'code_suffix', status: 'status', days: 'days',
  isPermanent: 'is_permanent', botCount: 'bot_count', workerIds: 'worker_ids', planName: 'plan_name',
  maxUses: 'max_uses', usedCount: 'used_count', usedUsers: 'used_users', expiresAt: 'expires_at',
  createdBy: 'created_by', createdAt: 'created_at', lastUsedAt: 'last_used_at', lastUsedBy: 'last_used_by',
  id: 'id', code: 'code', key: 'key'
};

const LINK_FIELDS = {
  attemptId: 'attempt_id', userId: 'user_id', username: 'username', tokenHash: 'token_hash',
  rewardHours: 'reward_hours', status: 'status', createdAt: 'created_at', expiresAt: 'expires_at',
  providerUrl: 'provider_url', providerShortUrl: 'provider_short_url', purgeAt: 'purge_at',
  dailyDate: 'daily_date', vietnamDate: 'vietnam_date', processingAt: 'processing_at',
  verifiedAt: 'verified_at', rewardedAt: 'rewarded_at', completedAt: 'completed_at', updatedAt: 'updated_at'
};

function toIso(value) {
  if (!value) return value === null ? null : undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.missingRpc === true) return true;
  const code = String(error.code || '').toUpperCase();
  const msg = String(error.message || '').toLowerCase();
  const details = String(error.details || error.responseText || '').toLowerCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the function') ||
    msg.includes('unknown rpc') ||
    msg.includes('not implemented') ||
    details.includes('pgrst202') ||
    details.includes('could not find the function')
  );
}

function isMissingSchemaError(error) {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const msg = String(error.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    (msg.includes('relation') && msg.includes('does not exist')) ||
    (msg.includes('column') && msg.includes('does not exist')) ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache')
  );
}

function mapLinkFrom(row) {
  if (!row) return null;
  return {
    attemptId: row.attempt_id,
    userId: row.user_id || row.username || '',
    username: row.username || row.user_id || '',
    tokenHash: row.token_hash,
    rewardHours: row.reward_hours,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    providerUrl: row.provider_url || row.provider_short_url || '',
    providerShortUrl: row.provider_short_url || row.provider_url || '',
    purgeAt: row.purge_at ?? null,
    dailyDate: row.daily_date || row.vietnam_date || '',
    vietnamDate: row.vietnam_date || row.daily_date || '',
    processingAt: row.processing_at ?? null,
    verifiedAt: row.verified_at ?? null,
    rewardedAt: row.rewarded_at || row.completed_at || null,
    completedAt: row.completed_at || row.rewarded_at || null,
    updatedAt: row.updated_at ?? null
  };
}

function applyLinkUserFilter(query, userId) {
  const clean = String(userId || '').trim();
  const lower = clean.toLowerCase();
  const bare = lower.replace(/^usr_/, '');
  const filters = [`user_id.eq.${clean}`];
  if (lower && lower !== clean) filters.push(`user_id.eq.${lower}`);
  if (lower) filters.push(`username.eq.${lower}`);
  if (bare && bare !== lower) filters.push(`username.eq.${bare}`);
  if (typeof query?.or === 'function' && filters.length > 1) {
    return query.or(filters.join(','));
  }
  return query.eq('user_id', clean);
}

function mapFrom(row, fields) {
  if (!row) return null;
  const out = {};
  for (const [key, column] of Object.entries(fields)) out[key] = row[column];
  return out;
}

function mapTo(record, fields, omit = []) {
  const out = {};
  for (const [key, column] of Object.entries(fields)) {
    if (!omit.includes(key) && record[key] !== undefined) out[column] = record[key];
  }
  return out;
}

function unwrapRpc(data) {
  return Array.isArray(data) ? (data[0] || null) : data;
}

class SupabaseDashboardStore {
  constructor(client) {
    this.client = client;
    this.adapter = client.adapter || null;
    this.cache = new Map();
    this._fallbackLock = new AsyncKeyLock();
  }

  getCached(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  setCached(key, data, ttlMs = 2500) {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  invalidateCache() {
    this.cache.clear();
  }

  async initialize() {
    // 1. Kiểm tra kết nối nhanh qua OpenAPI spec / adapter nếu có
    if (this.adapter && typeof this.adapter.testConnection === 'function') {
      try {
        const testRes = await this.adapter.testConnection();
        if (testRes.ok) {
          return;
        }
      } catch (_) {}
    }

    // 2. Fallback kiểm tra các bảng cơ bản
    const candidateTables = [USERS, KEYS, SETTINGS, LINK_ATTEMPTS, OUTBOX, PENDING_ALLOCATIONS];
    for (const table of candidateTables) {
      try {
        const { error } = await this.client.from(table).select('*').limit(0);
        if (error && error.code !== 'PGRST116') {
          // Bảng có thể chưa tạo nếu dùng migration cũ
        }
      } catch (_) {}
    }

    // 3. Dọn dẹp bản ghi cũ nếu bảng tồn tại
    try {
      const now = new Date().toISOString();
      const auditCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
      await Promise.allSettled([
        this.client.from(AUDIT_LOGS).delete().lt('timestamp', auditCutoff),
        this.client.from(LINK_ATTEMPTS).delete().lt('purge_at', now)
      ]);
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // USER ENTITLEMENT & ACCESS
  // --------------------------------------------------------------------------
  async resolveUserRow(userId) {
    const clean = String(userId || '').trim();
    if (!clean) return null;
    const lower = clean.toLowerCase();
    const bare = lower.startsWith('usr_') ? lower.slice(4) : lower;
    try {
      const q = this.client.from(USERS).select('*');
      if (typeof q.or === 'function') {
        const filters = [`id.eq.${clean}`, `username.eq.${lower}`];
        if (bare && bare !== lower) filters.push(`username.eq.${bare}`);
        const { data, error } = await q.or(filters.join(',')).maybeSingle();
        if (!error && data) return data;
      }
    } catch (_) {}

    const lookups = [['id', clean], ['username', lower]];
    if (bare && bare !== lower) lookups.push(['username', bare]);
    for (const [col, val] of lookups) {
      try {
        const { data, error } = await this.client.from(USERS).select('*').eq(col, val).maybeSingle();
        if (!error && data) return data;
      } catch (_) {}
    }
    return null;
  }

  async assignedWorkerIds(userId) {
    const clean = String(userId || '').trim();
    if (!clean) return [];
    const lower = clean.toLowerCase();
    const bare = lower.startsWith('usr_') ? lower.slice(4) : lower;
    const userRow = await this.resolveUserRow(clean);
    const candidates = [...new Set([clean, userRow?.id, userRow?.username, lower, bare].filter(Boolean))];

    try {
      const q = this.client.from(ASSIGNMENTS).select('worker_id');
      if (candidates.length > 1 && typeof q.in === 'function') {
        const { data, error } = await q.in('user_id', candidates).order('assigned_at');
        if (!error && Array.isArray(data) && data.length > 0) {
          return [...new Set(data.map((row) => String(row.worker_id)))];
        }
      } else {
        for (const candidate of candidates) {
          const { data, error } = await this.client.from(ASSIGNMENTS).select('worker_id').eq('user_id', candidate).order('assigned_at');
          if (!error && Array.isArray(data) && data.length > 0) {
            return [...new Set(data.map((row) => String(row.worker_id)))];
          }
        }
      }
    } catch (_) {}

    if (Array.isArray(userRow?.assigned_bot_ids)) {
      return userRow.assigned_bot_ids.map(String);
    }

    return [];
  }

  async replaceAssignments(userId, workerIds, actorId) {
    this.invalidateCache();
    const access = await this.getAccess(userId);
    return this.setAccess(userId, { ...(access || { role: 'user', status: 'active', isPermanent: false }), workerIds }, actorId);
  }

  async getAccess(userId, { bypassCache = false } = {}) {
    if (!userId) return null;
    if (!bypassCache) {
      const cached = this.getCached(`access:${userId}`);
      if (cached) return cached;
    }

    // 1. Thử đọc từ manager_users (id hoặc username)
    const userData = await this.resolveUserRow(userId);
    if (userData) {
      const rawAssigned = Array.isArray(userData.assigned_bot_ids) ? userData.assigned_bot_ids.map(String) : [];
      const assigned = rawAssigned.length > 0 ? rawAssigned : await this.assignedWorkerIds(userData.id || userId);
      const result = {
        userId: userData.id || ('usr_' + userData.username),
        username: userData.username,
        role: userData.role || 'user',
        status: userData.status || 'active',
        isPermanent: Boolean(userData.is_permanent),
        expiresAt: userData.expires_at,
        planName: userData.plan_name || 'Gói mặc định',
        note: userData.note || '',
        allowAccountChange: userData.allow_account_change !== false,
        lockReason: userData.lock_reason || '',
        botCount: userData.bot_count || 1,
        botAliases: userData.bot_aliases || {},
        workerIds: assigned,
        createdAt: userData.created_at,
        updatedAt: userData.updated_at
      };
      this.setCached(`access:${userId}`, result);
      return result;
    }

    // 2. Fallback đọc từ manager_access
    try {
      const { data, error } = await this.client.from(ACCESS).select('*').eq('user_id', userId).maybeSingle();
      if (!error && data) {
        const result = { ...mapFrom(data, ACCESS_FIELDS), workerIds: await this.assignedWorkerIds(userId) };
        this.setCached(`access:${userId}`, result);
        return result;
      }
    } catch (_) {}

    return null;
  }

  async listAccess() {
    const cached = this.getCached('access:all');
    if (cached) return cached;

    // 1. Thử đọc từ manager_users
    try {
      const { data: users, error } = await this.client.from(USERS).select('*').order('created_at', { ascending: false });
      if (!error && Array.isArray(users) && users.length > 0) {
        const result = users.map((u) => ({
          userId: u.id || ('usr_' + u.username),
          username: u.username,
          role: u.role || 'user',
          status: u.status || 'active',
          isPermanent: Boolean(u.is_permanent),
          expiresAt: u.expires_at,
          planName: u.plan_name || 'Gói mặc định',
          note: u.note || '',
          allowAccountChange: u.allow_account_change !== false,
          lockReason: u.lock_reason || '',
          botCount: u.bot_count || 1,
          botAliases: u.bot_aliases || {},
          workerIds: Array.isArray(u.assigned_bot_ids) ? u.assigned_bot_ids.map(String) : [],
          createdAt: u.created_at,
          updatedAt: u.updated_at
        }));
        this.setCached('access:all', result);
        return result;
      }
    } catch (_) {}

    // 2. Fallback đọc từ manager_access
    try {
      const [{ data: users, error: usersError }, { data: assignments, error: assignmentsError }] = await Promise.all([
        this.client.from(ACCESS).select('*').order('updated_at', { ascending: false }),
        this.client.from(ASSIGNMENTS).select('user_id,worker_id').order('assigned_at')
      ]);
      if (usersError) throw usersError;
      const grouped = new Map();
      for (const row of assignments || []) grouped.set(row.user_id, [...(grouped.get(row.user_id) || []), row.worker_id]);
      const result = (users || []).map((row) => ({ ...mapFrom(row, ACCESS_FIELDS), workerIds: grouped.get(row.user_id) || [] }));
      this.setCached('access:all', result);
      return result;
    } catch (_) {
      return [];
    }
  }

  async setAccess(userId, values, actorId) {
    this.invalidateCache();
    const { workerIds = [], ...fields } = values;
    let directUsersErr = null;

    // 1. Thử lưu vào manager_users nếu có bảng
    try {
      let existingUser = null;
      try {
        existingUser = (await this.resolveUserRow(userId)) || (fields.username ? await this.resolveUserRow(fields.username) : null);
      } catch (_) {}

      const cleanUsername = fields.username
        ? String(fields.username).trim().toLowerCase()
        : (existingUser?.username || String(userId).trim().toLowerCase().replace(/^usr_/, ''));
      const assigned = (workerIds && workerIds.length > 0)
        ? [...new Set(workerIds)].map(String)
        : (Array.isArray(existingUser?.assigned_bot_ids) ? existingUser.assigned_bot_ids.map(String) : []);
      const userRow = {
        id: existingUser?.id || userId,
        username: cleanUsername,
        role: String(fields.role || existingUser?.role || 'user'),
        status: String(fields.status || existingUser?.status || 'active'),
        is_permanent: fields.isPermanent !== undefined ? Boolean(fields.isPermanent) : Boolean(existingUser?.is_permanent),
        expires_at: fields.expiresAt !== undefined ? (fields.expiresAt || null) : (existingUser?.expires_at || null),
        plan_name: String(fields.planName || existingUser?.plan_name || 'Gói mặc định'),
        assigned_bot_ids: assigned,
        bot_count: Math.max(1, Number(fields.botCount || existingUser?.bot_count || assigned.length || 1)),
        allow_account_change: fields.allowAccountChange !== undefined ? (fields.allowAccountChange !== false) : (existingUser?.allow_account_change !== false),
        lock_reason: String(fields.lockReason !== undefined ? fields.lockReason : (existingUser?.lock_reason || '')),
        note: String(fields.note !== undefined ? fields.note : (existingUser?.note || '')),
        updated_at: new Date().toISOString()
      };
      if (fields.isTrial !== undefined || existingUser?.is_trial !== undefined) {
        userRow.is_trial = fields.isTrial !== undefined ? Boolean(fields.isTrial) : Boolean(existingUser?.is_trial);
      }
      if (fields.trialBotId !== undefined || existingUser?.trial_bot_id !== undefined) {
        userRow.trial_bot_id = fields.trialBotId !== undefined ? (fields.trialBotId || null) : (existingUser?.trial_bot_id || null);
      }
      if (fields.password) {
        const p = String(fields.password);
        userRow.password = (p.startsWith('scrypt$') || isStoredCredentialCiphertext(p))
          ? p
          : hashPassword(p);
      } else if (existingUser?.password) {
        userRow.password = existingUser.password;
      }
      const { data, error } = await this.client.from(USERS).upsert(userRow, { onConflict: 'username' }).select('*').maybeSingle();
      if (!error && data) {
        if (String(userRow.status).toLowerCase() === 'disabled' && typeof this.adapter?.revokeUserSessions === 'function') {
          await this.adapter.revokeUserSessions(userId).catch(() => false);
        }
        this.invalidateCache();
        return {
          userId: data.id || ('usr_' + data.username),
          username: data.username,
          role: data.role,
          status: data.status,
          isPermanent: Boolean(data.is_permanent),
          expiresAt: data.expires_at,
          planName: data.plan_name,
          workerIds: assigned,
          updatedAt: data.updated_at
        };
      }
      directUsersErr = error || null;
    } catch (err) {
      directUsersErr = err;
    }

    if (typeof this.client?.rpc !== 'function') {
      if (directUsersErr) throw directUsersErr;
      throw new Error('Không thể lưu quyền truy cập người dùng.');
    }

    // 2. Fallback gọi RPC manager_set_user_access
    const { data, error } = await this.client.rpc('manager_set_user_access', {
      p_user_id: userId,
      p_values: mapTo(fields, ACCESS_FIELDS, ['userId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']),
      p_worker_ids: [...new Set(workerIds)].map(String),
      p_actor_id: String(actorId || '')
    });
    if (error) throw error;
    this.invalidateCache();
    const rpcRow = unwrapRpc(data);
    return {
      ...(rpcRow ? mapFrom(rpcRow, ACCESS_FIELDS) : {}),
      userId: rpcRow?.id || rpcRow?.user_id || userId,
      username: rpcRow?.username || fields.username || String(userId).replace(/^usr_/, ''),
      workerIds: await this.assignedWorkerIds(rpcRow?.id || userId)
    };
  }

  async removeAccess(userId) {
    this.invalidateCache();
    const clean = String(userId || '').trim();
    if (!clean) return false;

    try {
      if (typeof this.client?.rpc === 'function') {
        const { data, error } = await this.client.rpc('manager_delete_user_access', { p_user_id: clean });
        if (!error) {
          const res = unwrapRpc(data);
          return Boolean(res?.deleted ?? res === true);
        }
        if (!isMissingRpcError(error) && !isMissingSchemaError(error)) {
          throw error;
        }
      }

      const lower = clean.toLowerCase();
      const bare = lower.startsWith('usr_') ? lower.slice(4) : lower;
      const candidates = [...new Set([clean, lower, bare, bare ? `usr_${bare}` : ''].filter(Boolean))];
      let deletedAny = false;

      // 1. Delete assignments FIRST and fail-closed on any non-missing-schema error so we never leave orphaned assignments
      const assignQ = this.client.from(ASSIGNMENTS).delete();
      const assignRes = (candidates.length > 1 && typeof assignQ.in === 'function')
        ? await assignQ.in('user_id', candidates)
        : await assignQ.eq('user_id', clean);
      if (assignRes?.error && !isMissingSchemaError(assignRes.error)) {
        throw assignRes.error;
      }

      // 2. Clean up Discord links & active sessions before removing user record
      try {
        const linkQ = this.client.from('manager_discord_links').delete();
        const linkRes = (candidates.length > 1 && typeof linkQ.in === 'function')
          ? await linkQ.in('manager_user_id', candidates)
          : await linkQ.eq('manager_user_id', clean);
        if (linkRes?.error && !isMissingSchemaError(linkRes.error) && String(linkRes.error.code || '') !== '42501') {
          throw linkRes.error;
        }
      } catch (err) {
        if (!isMissingSchemaError(err) && String(err?.code || '') !== '42501') throw err;
      }

      if (typeof this.adapter?.revokeUserSessions === 'function') {
        try {
          await this.adapter.revokeUserSessions(clean);
        } catch (err) {
          if (!isMissingRpcError(err) && !isMissingSchemaError(err)) throw err;
        }
      }

      try {
        const sessQ = this.client.from('manager_sessions').delete();
        const sessRes = (candidates.length > 1 && typeof sessQ.in === 'function')
          ? await sessQ.in('user_id', candidates)
          : await sessQ.eq('user_id', clean);
        if (sessRes?.error && !isMissingSchemaError(sessRes.error) && String(sessRes.error.code || '') !== '42501') {
          throw sessRes.error;
        }
      } catch (err) {
        if (!isMissingSchemaError(err) && String(err?.code || '') !== '42501') throw err;
      }

      try {
        const userQ = this.client.from(USERS).delete();
        const userRes = typeof userQ.or === 'function'
          ? await userQ.or(`id.eq.${clean},username.eq.${lower},username.eq.${bare}`).select('username')
          : await userQ.eq('id', clean).select('username');
        if (userRes?.error && !isMissingSchemaError(userRes.error) && String(userRes.error.code || '') !== '42501') {
          throw userRes.error;
        }
        if (userRes?.data?.length) deletedAny = true;
      } catch (err) {
        if (!isMissingSchemaError(err) && String(err?.code || '') !== '42501') throw err;
      }

      try {
        const { data, error } = await this.client.from(ACCESS).delete().eq('user_id', clean).select('user_id');
        if (error && !isMissingSchemaError(error) && String(error.code || '') !== '42501') throw error;
        return deletedAny || Boolean(data?.length);
      } catch (err) {
        if (!isMissingSchemaError(err) && String(err?.code || '') !== '42501') throw err;
        return deletedAny;
      }
    } finally {
      this.invalidateCache();
    }
  }

  async assignedUser(workerId) {
    const cleanId = String(workerId || '').trim().toLowerCase();
    const { data, error } = await this.client.from(ASSIGNMENTS).select('worker_id,user_id,assigned_by,assigned_at').eq('worker_id', cleanId).maybeSingle();
    if (!error && data) {
      return { workerId: data.worker_id, userId: data.user_id, assignedBy: data.assigned_by, assignedAt: data.assigned_at };
    }

    // Fallback: tìm trong manager_users
    try {
      const { data: users, error: uErr } = await this.client.from(USERS).select('id,username,assigned_bot_ids').contains('assigned_bot_ids', [cleanId]).limit(1);
      if (!uErr && users?.[0]) {
        return { workerId: cleanId, userId: users[0].id || users[0].username, assignedBy: 'system', assignedAt: new Date().toISOString() };
      }
      if (uErr && !isMissingSchemaError(uErr) && String(uErr?.code || '') !== '42501') {
        this.logger?.warn?.('assignedUser_fallback_query_error', { workerId: cleanId, error: uErr.message || uErr });
      }
    } catch (err) {
      if (!isMissingSchemaError(err) && String(err?.code || '') !== '42501') {
        this.logger?.warn?.('assignedUser_fallback_exception', { workerId: cleanId, error: err.message });
      }
    }

    return null;
  }

  async removeWorkerAssignments(workerId) {
    if (!workerId) return;
    const targetId = String(workerId).trim().toLowerCase();
    this.invalidateCache();

    // 1. Delete from manager_assignments (ASSIGNMENTS table)
    try {
      const assignRes = await this.client.from(ASSIGNMENTS).delete().eq('worker_id', targetId);
      if (assignRes?.error && !isMissingSchemaError(assignRes.error) && String(assignRes.error?.code || '') !== '42501') {
        throw assignRes.error instanceof Error ? assignRes.error : new Error(assignRes.error.message || 'Lỗi khi xóa phân bổ bot.');
      }
    } catch (err) {
      if (!isMissingSchemaError(err) && String(err?.code || '') !== '42501') {
        throw err instanceof Error ? err : new Error(err.message || 'Lỗi khi xóa phân bổ bot.');
      }
    }

    // 2. Synchronously clean up assigned_bot_ids from manager_users
    try {
      let usersToUpdate = [];
      let usedFallback = false;

      try {
        const { data: users, error: findErr } = await this.client
          .from(USERS)
          .select('id, username, assigned_bot_ids')
          .contains('assigned_bot_ids', [targetId]);
        if (!findErr && Array.isArray(users)) {
          usersToUpdate = users;
        } else if (findErr) {
          if (!isMissingSchemaError(findErr)) {
            usedFallback = true;
          }
        }
      } catch (findErr) {
        if (!isMissingSchemaError(findErr)) {
          usedFallback = true;
        }
      }

      if (usedFallback || (!usersToUpdate.length && typeof this.client.from(USERS).select === 'function')) {
        try {
          const { data: allUsers, error: allErr } = await this.client
            .from(USERS)
            .select('id, username, assigned_bot_ids');
          if (!allErr && Array.isArray(allUsers)) {
            usersToUpdate = allUsers.filter((u) => {
              const ids = Array.isArray(u.assigned_bot_ids)
                ? u.assigned_bot_ids.map((x) => String(x).toLowerCase())
                : (typeof u.assigned_bot_ids === 'string' ? JSON.parse(u.assigned_bot_ids || '[]').map((x) => String(x).toLowerCase()) : []);
              return ids.includes(targetId);
            });
          } else if (allErr && !isMissingSchemaError(allErr) && String(allErr?.code || '') !== '42501') {
            throw allErr;
          }
        } catch (scanErr) {
          if (!isMissingSchemaError(scanErr) && String(scanErr?.code || '') !== '42501') {
            throw scanErr;
          }
        }
      }

      for (const u of usersToUpdate) {
        const rawIds = Array.isArray(u.assigned_bot_ids)
          ? u.assigned_bot_ids
          : (typeof u.assigned_bot_ids === 'string' ? JSON.parse(u.assigned_bot_ids || '[]') : []);
        const filtered = rawIds.filter((id) => String(id).trim().toLowerCase() !== targetId);
        if (filtered.length !== rawIds.length) {
          const updateRes = await this.client
            .from(USERS)
            .update({ assigned_bot_ids: filtered, updated_at: new Date().toISOString() })
            .eq('id', u.id);
          if (updateRes?.error && !isMissingSchemaError(updateRes.error) && String(updateRes.error?.code || '') !== '42501') {
            throw updateRes.error instanceof Error ? updateRes.error : new Error(updateRes.error.message || 'Lỗi cập nhật assigned_bot_ids.');
          }
        }
      }
    } catch (err) {
      if (!isMissingSchemaError(err) && String(err?.code || '') !== '42501') {
        throw err instanceof Error ? err : new Error(err.message || 'Lỗi khi đồng bộ danh sách bot người dùng.');
      }
    }
  }

  // --------------------------------------------------------------------------
  // USER SNAPSHOT & ADVANCED USER MANAGEMENT
  // --------------------------------------------------------------------------
  async fetchUsersSnapshot() {
    if (this.adapter && typeof this.adapter.fetchUsersSnapshot === 'function') {
      return await this.adapter.fetchUsersSnapshot();
    }
    return null;
  }

  async saveUsersSnapshot(users, expectedRevision, options = {}) {
    this.invalidateCache();
    if (this.adapter && typeof this.adapter.saveUsersSnapshot === 'function') {
      return await this.adapter.saveUsersSnapshot(users, expectedRevision, options);
    }
    return { ok: false, error: 'Adapter not initialized.' };
  }

  async getUser(username, { bypassCache = false } = {}) {
    if (!username) return null;
    const cacheKey = `user:${String(username).toLowerCase()}`;
    if (!bypassCache) {
      const cached = this.getCached(cacheKey);
      if (cached) return cached;
    }

    let user = null;
    if (this.adapter && typeof this.adapter.fetchUserAuthorization === 'function') {
      const res = await this.adapter.fetchUserAuthorization(null, username);
      if (res.ok && res.user) user = res.user;
    }
    if (!user) {
      user = await this.getAccess(username, { bypassCache });
    }
    if (user) {
      this.setCached(cacheKey, user);
    }
    return user;
  }

  async listUsers() {
    if (this.adapter && typeof this.adapter.fetchUsers === 'function') {
      const users = await this.adapter.fetchUsers();
      if (users) return users;
    }
    return await this.listAccess();
  }

  // --------------------------------------------------------------------------
  // DISCORD ACCOUNT LINKING (P0 / Dual-Engine Synchronization)
  // --------------------------------------------------------------------------
  async registerTrialUser({ userId, username, password, trialDays = 1, planName = 'FREE TRIAL' }) {
    this.invalidateCache();
    const cleanUsername = String(username || '').toLowerCase().trim();
    if (!cleanUsername) {
      throw new Error('Tên đăng nhập không hợp lệ.');
    }
    const safePassword = password
      ? ((String(password).startsWith('scrypt$') || isStoredCredentialCiphertext(password)) ? password : hashPassword(password))
      : '';

    // 1. Try Supabase RPC (fail closed on DB/business errors; fallback only if RPC is absent)
    if (typeof this.client?.rpc === 'function') {
      try {
        const { data, error } = await this.client.rpc('manager_register_trial_user', {
          p_user_id: userId,
          p_username: cleanUsername,
          p_password: safePassword,
          p_trial_days: trialDays,
          p_plan_name: planName
        });
        if (!error && data?.ok) return unwrapRpc(data);
        if (error) {
          if (error.message && error.message.includes('NO_WORKERS_AVAILABLE')) {
            throw new Error('NO_WORKERS_AVAILABLE: Hiện tại hệ thống không còn Bot rảnh để cấp dùng thử.');
          }
          if (error.message && error.message.includes('Tên đăng nhập này đã có người sử dụng')) {
            throw new Error('Tên đăng nhập này đã có người sử dụng.');
          }
          if (!isMissingRpcError(error)) {
            throw error instanceof Error ? error : new Error(error.message || 'Đăng ký dùng thử thất bại.');
          }
        } else {
          throw new Error(data?.message || data?.error || 'Đăng ký dùng thử thất bại.');
        }
      } catch (rpcErr) {
        if (rpcErr?.message?.includes('NO_WORKERS_AVAILABLE')) {
          throw new Error('NO_WORKERS_AVAILABLE: Hiện tại hệ thống không còn Bot rảnh để cấp dùng thử.');
        }
        if (rpcErr?.message?.includes('Tên đăng nhập này đã có người sử dụng')) {
          throw new Error('Tên đăng nhập này đã có người sử dụng.');
        }
        if (!isMissingRpcError(rpcErr)) {
          throw rpcErr;
        }
      }
    }

    // 2. Fallback: Serialized local allocation with atomic cleanup on 23505/insert failure
    return this._fallbackLock.run('trial:alloc', async () => {
      const existing = await this.getUser(cleanUsername);
      if (existing) {
        throw new Error('Tên đăng nhập này đã có người sử dụng.');
      }

      let candidateWorkers = [];
      try {
        const { data: workers, error: workersErr } = await this.client
          .from('manager_workers')
          .select('worker_id, bot_number, enabled')
          .order('bot_number');
        if (workersErr && !isMissingSchemaError(workersErr)) {
          throw workersErr instanceof Error ? workersErr : new Error(workersErr.message || 'Lỗi đọc danh sách Bot.');
        }
        if (Array.isArray(workers) && workers.length > 0) {
          candidateWorkers = workers.map((w) => ({
            workerId: String(w.worker_id),
            botNumber: w.bot_number || 1,
            enabled: Boolean(w.enabled)
          }));
        }
      } catch (err) {
        if (!isMissingSchemaError(err) && (!this.workerStore || typeof this.workerStore.list !== 'function')) {
          throw err;
        }
      }

      if (candidateWorkers.length === 0 && this.workerStore && typeof this.workerStore.list === 'function') {
        const workers = await this.workerStore.list();
        candidateWorkers = (workers || []).map((w) => ({
          workerId: String(w.workerId),
          botNumber: w.botNumber || 1,
          enabled: Boolean(w.enabled)
        }));
      }

      const excludedWorkers = new Set();
      let lastConflictError = null;

      while (true) {
        let freeWorkerId = null;
        let botNumber = 1;

        for (const w of candidateWorkers) {
          if (!w.enabled || excludedWorkers.has(w.workerId)) continue;
          const assigned = await this.assignedUser(w.workerId);
          if (!assigned) {
            freeWorkerId = w.workerId;
            botNumber = w.botNumber || 1;
            break;
          }
        }

        if (!freeWorkerId) {
          if (lastConflictError) {
            throw new Error('NO_WORKERS_AVAILABLE: Hiện tại hệ thống không còn Bot rảnh để cấp dùng thử.');
          }
          throw new Error('NO_WORKERS_AVAILABLE: Hiện tại hệ thống không còn Bot rảnh để cấp dùng thử.');
        }

        const expiresAt = new Date(Date.now() + Math.max(1, trialDays) * 24 * 60 * 60 * 1000).toISOString();
        const assignedUserId = userId || `usr_${cleanUsername}`;
        const newUser = {
          id: assignedUserId,
          userId: assignedUserId,
          username: cleanUsername,
          password: safePassword,
          role: 'user',
          status: 'active',
          isPermanent: false,
          isTrial: true,
          trialBotId: freeWorkerId,
          expiresAt,
          planName,
          workerIds: [freeWorkerId],
          assignedBotIds: [freeWorkerId],
          botCount: 1,
          note: 'Đăng ký mới (Free Trial 1 Bot)',
          createdAt: new Date().toISOString()
        };

        await this.setAccess(assignedUserId, newUser, 'system:trial');

        let assignErr = null;
        try {
          const assignRes = await this.client.from(ASSIGNMENTS).insert({
            worker_id: freeWorkerId,
            user_id: assignedUserId,
            assigned_by: 'system:trial',
            assigned_at: new Date().toISOString()
          });
          assignErr = assignRes?.error || null;
        } catch (err) {
          assignErr = err;
        }

        if (assignErr) {
          await this.removeAccess(assignedUserId).catch(() => {});
          if (String(assignErr.code || '') === '23505') {
            excludedWorkers.add(freeWorkerId);
            lastConflictError = assignErr;
            continue;
          }
          throw assignErr instanceof Error ? assignErr : new Error(assignErr.message || 'Không thể gán Bot dùng thử.');
        }

        const verified = await this.assignedUser(freeWorkerId);
        if (verified && verified.userId && verified.userId !== assignedUserId && verified.userId !== cleanUsername) {
          await this.removeAccess(assignedUserId).catch(() => {});
          excludedWorkers.add(freeWorkerId);
          lastConflictError = new Error('Worker assignment conflict detected.');
          continue;
        }

        return {
          ok: true,
          userId: assignedUserId,
          username: cleanUsername,
          workerId: freeWorkerId,
          botNumber,
          expiresAt,
          planName
        };
      }
    });
  }

  async _querySingleOptional(table, column, value) {
    try {
      const res = await this.client.from(table).select('*').eq(column, value).maybeSingle();
      if (res?.error) {
        if (isMissingSchemaError(res.error)) return null;
        throw res.error instanceof Error ? res.error : new Error(res.error.message || `Lỗi truy vấn bảng ${table}.`);
      }
      return res?.data || null;
    } catch (err) {
      if (isMissingSchemaError(err)) return null;
      throw err;
    }
  }

  async _checkDiscordLinkConflicts(dId, mId, cleanUser) {
    const isSameAccount = (row) => {
      if (!row) return false;
      const rowUser = String(row.username || '').trim().toLowerCase();
      const rowId = String(row.manager_user_id || row.id || '').trim();
      return (rowUser && rowUser === cleanUser) || (rowId && rowId === mId);
    };

    const byDiscordInLinks = await this._querySingleOptional('manager_discord_links', 'discord_user_id', dId);
    if (byDiscordInLinks && byDiscordInLinks.status !== 'revoked' && !isSameAccount(byDiscordInLinks)) {
      throw new Error('Tài khoản Discord này đã được liên kết với một tài khoản Web khác.');
    }

    const byManagerInLinks = await this._querySingleOptional('manager_discord_links', 'manager_user_id', mId);
    if (byManagerInLinks && byManagerInLinks.status !== 'revoked' && byManagerInLinks.discord_user_id && String(byManagerInLinks.discord_user_id) !== dId) {
      throw new Error('Tài khoản Web này đã được liên kết với một tài khoản Discord khác.');
    }

    const byUsernameInLinks = await this._querySingleOptional('manager_discord_links', 'username', cleanUser);
    if (byUsernameInLinks && byUsernameInLinks.status !== 'revoked' && byUsernameInLinks.discord_user_id && String(byUsernameInLinks.discord_user_id) !== dId) {
      throw new Error('Tài khoản Web này đã được liên kết với một tài khoản Discord khác.');
    }

    const byDiscordInUsers = await this._querySingleOptional(USERS, 'discord_user_id', dId);
    if (byDiscordInUsers && !isSameAccount(byDiscordInUsers)) {
      throw new Error('Tài khoản Discord này đã được liên kết với một tài khoản Web khác.');
    }

    const byUsernameInUsers = await this._querySingleOptional(USERS, 'username', cleanUser);
    if (byUsernameInUsers && byUsernameInUsers.discord_user_id && String(byUsernameInUsers.discord_user_id) !== dId) {
      throw new Error('Tài khoản Web này đã được liên kết với một tài khoản Discord khác.');
    }
  }

  async linkDiscord(discordUserId, username, managerUserId = '') {
    this.invalidateCache();
    const dId = String(discordUserId || '').trim();
    const cleanUser = String(username || '').trim().toLowerCase();
    const mId = String(managerUserId || `usr_${cleanUser}`).trim();
    if (!dId || !cleanUser) {
      throw new Error('Thiếu thông tin Discord ID hoặc tài khoản Web để liên kết.');
    }

    // 1. Try Supabase RPC (fail closed on conflicts/real errors; fallback ONLY on missing RPC)
    if (typeof this.client?.rpc === 'function') {
      try {
        const { data, error } = await this.client.rpc('manager_link_discord_account', {
          p_discord_user_id: dId,
          p_manager_user_id: mId,
          p_username: cleanUser
        });
        if (!error && data?.ok) return unwrapRpc(data);
        if (error) {
          if (!isMissingRpcError(error)) {
            throw error instanceof Error ? error : new Error(error.message || 'Không thể liên kết tài khoản Discord.');
          }
        } else {
          throw new Error(data?.message || data?.error || 'Không thể liên kết tài khoản Discord.');
        }
      } catch (rpcErr) {
        if (!isMissingRpcError(rpcErr)) throw rpcErr;
      }
    }

    // 2. Fallback: Verify 1:1 conflicts before writing
    await this._checkDiscordLinkConflicts(dId, mId, cleanUser);

    // 3. Direct table + settings writes (ignore ONLY missing-schema errors; throw if zero writes persisted)
    const nowIso = new Date().toISOString();
    let persistedWrites = 0;

    try {
      const res = await this.client.from('manager_discord_links').upsert({
        discord_user_id: dId,
        manager_user_id: mId,
        username: cleanUser,
        linked_at: nowIso,
        last_verified_at: nowIso,
        status: 'active',
        revoked_at: null
      }, { onConflict: 'discord_user_id' });
      const err = res?.error || null;
      if (err) {
        if (!isMissingSchemaError(err)) throw err instanceof Error ? err : new Error(err.message || 'Lỗi lưu manager_discord_links.');
      } else {
        persistedWrites++;
      }
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }

    try {
      const res = await this.client.from(USERS)
        .update({ discord_user_id: dId, updated_at: nowIso })
        .eq('username', cleanUser);
      const err = res?.error || null;
      if (err) {
        if (!isMissingSchemaError(err)) throw err instanceof Error ? err : new Error(err.message || 'Lỗi cập nhật manager_users.');
      } else {
        persistedWrites++;
      }
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }

    try {
      await this.setSetting(`discord_link:${dId}`, { username: cleanUser, linkedAt: nowIso });
      persistedWrites++;
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }

    if (persistedWrites === 0) {
      throw new Error('Không thể lưu liên kết Discord vào cơ sở dữ liệu.');
    }

    return { ok: true, discordUserId: dId, username: cleanUser };
  }

  async unlinkDiscord(identifier) {
    if (!identifier) return false;
    const id = String(identifier).trim();
    this.invalidateCache();

    // 1. Try Supabase RPC (fail closed on real errors; fallback ONLY on missing RPC)
    if (typeof this.client?.rpc === 'function') {
      try {
        const { data, error } = await this.client.rpc('manager_unlink_discord_account', {
          p_identifier: id
        });
        if (!error && data?.ok) return true;
        if (error) {
          if (!isMissingRpcError(error)) {
            throw error instanceof Error ? error : new Error(error.message || 'Không thể hủy liên kết Discord.');
          }
        } else {
          throw new Error(data?.message || data?.error || 'Không thể hủy liên kết Discord.');
        }
      } catch (rpcErr) {
        if (!isMissingRpcError(rpcErr)) throw rpcErr;
      }
    }

    // 2. Direct table + settings cleanup (ignore ONLY missing-schema errors; throw if zero ops succeeded)
    const nowIso = new Date().toISOString();
    const ops = [
      () => this.client.from('manager_discord_links').delete().eq('discord_user_id', id),
      () => this.client.from('manager_discord_links').delete().eq('username', id.toLowerCase()),
      () => this.client.from(USERS).update({ discord_user_id: null, updated_at: nowIso }).eq('discord_user_id', id),
      () => this.client.from(USERS).update({ discord_user_id: null, updated_at: nowIso }).eq('username', id.toLowerCase()),
      () => this.client.from(SETTINGS).delete().eq('key', `discord_link:${id}`)
    ];
    let completedOps = 0;

    for (const op of ops) {
      try {
        const res = await op();
        const err = res?.error || null;
        if (err) {
          if (!isMissingSchemaError(err)) {
            throw err instanceof Error ? err : new Error(err.message || 'Không thể hủy liên kết Discord.');
          }
        } else {
          completedOps++;
        }
      } catch (err) {
        if (!isMissingSchemaError(err)) throw err;
      }
    }

    if (completedOps === 0) {
      throw new Error('Không thể hủy liên kết Discord khỏi cơ sở dữ liệu.');
    }

    return true;
  }

  async getDiscordLink(identifier) {
    if (!identifier) return null;
    const id = String(identifier).trim();

    // 1. Check manager_discord_links table
    try {
      const { data, error } = await this.client.from('manager_discord_links')
        .select('*')
        .or(`discord_user_id.eq.${id},manager_user_id.eq.${id},username.eq.${id.toLowerCase()}`)
        .eq('status', 'active')
        .maybeSingle();
      if (!error && data) return data;
    } catch (_) {}

    // 2. Check manager_users.discord_user_id
    try {
      const { data, error } = await this.client.from(USERS)
        .select('discord_user_id, username, id, updated_at')
        .or(`discord_user_id.eq.${id},username.eq.${id.toLowerCase()},id.eq.${id}`)
        .maybeSingle();
      if (!error && data?.discord_user_id) {
        return {
          discord_user_id: data.discord_user_id,
          manager_user_id: data.id || data.username,
          username: data.username,
          linked_at: data.updated_at || new Date().toISOString(),
          status: 'active'
        };
      }
    } catch (_) {}

    // 3. Check manager_settings
    try {
      const setting = await this.getSetting(`discord_link:${id}`);
      if (setting && setting.username) {
        return {
          discord_user_id: id,
          manager_user_id: setting.username,
          username: setting.username,
          linked_at: setting.linkedAt || new Date().toISOString(),
          status: 'active'
        };
      }
    } catch (_) {}

    return null;
  }

  async getUserByDiscordId(discordUserId) {
    if (!discordUserId) return null;
    const dId = String(discordUserId).trim();
    const cached = this.getCached(`discord_user:${dId}`);
    if (cached) return cached;

    // 1. Check manager_discord_links table
    try {
      const link = await this.getDiscordLink(dId);
      if (link && link.username) {
        const user = await this.getUser(link.username);
        if (user) {
          this.setCached(`discord_user:${dId}`, user, 5000);
          return user;
        }
        if (String(link.username).toLowerCase() === 'admin') {
          const adminUser = {
            id: 'admin',
            userId: 'admin',
            username: 'admin',
            role: 'admin',
            status: 'active',
            isPermanent: true,
            assignedBotIds: null,
            discordUserId: dId
          };
          this.setCached(`discord_user:${dId}`, adminUser, 5000);
          return adminUser;
        }
      }
    } catch (_) {}

    // 2. Fallback to manager_users.discord_user_id
    try {
      const { data, error } = await this.client.from(USERS)
        .select('*')
        .eq('discord_user_id', dId)
        .maybeSingle();
      if (!error && data) {
        const assignedIds = Array.isArray(data.assigned_bot_ids)
          ? data.assigned_bot_ids
          : (typeof data.assigned_bot_ids === 'string' ? JSON.parse(data.assigned_bot_ids || '[]') : []);
        const user = {
          ...data,
          userId: data.id || data.username,
          assignedBotIds: assignedIds
        };
        this.setCached(`discord_user:${dId}`, user, 5000);
        return user;
      }
    } catch (_) {}

    // 3. Fallback to manager_settings
    try {
      const setting = await this.getSetting(`discord_link:${dId}`);
      if (setting && setting.username) {
        const user = await this.getUser(setting.username);
        if (user) {
          this.setCached(`discord_user:${dId}`, user, 5000);
          return user;
        }
        if (String(setting.username).toLowerCase() === 'admin') {
          const adminUser = {
            id: 'admin',
            userId: 'admin',
            username: 'admin',
            role: 'admin',
            status: 'active',
            isPermanent: true,
            assignedBotIds: null,
            discordUserId: dId
          };
          this.setCached(`discord_user:${dId}`, adminUser, 5000);
          return adminUser;
        }
      }
    } catch (_) {}

    return null;
  }

    // --------------------------------------------------------------------------
  // KEYS & GIFTCODES
  // --------------------------------------------------------------------------
  async createKey(record) {
    this.invalidateCache();
    const row = mapTo(record, KEY_FIELDS);
    if (!row.id && row.key_id) row.id = row.key_id;
    if (!row.key_id && row.id) row.key_id = row.id;
    if (this.adapter && typeof this.adapter.insertKeys === 'function') {
      return await this.adapter.insertKeys([{
        ...(record || {}),
        id: record?.id || row.id,
        keyId: record?.keyId || row.key_id
      }]);
    }
    const { error } = await this.client.from(KEYS).insert(row);
    if (error) throw error;
  }

  async getKey(code) {
    if (this.adapter && typeof this.adapter.fetchKeys === 'function') {
      const keys = await this.adapter.fetchKeys();
      if (keys) {
        const found = keys.find((k) => String(k.codeHash || k.code_hash || '').toLowerCase() === String(code || '').toLowerCase() || String(k.code || k.key || k.keyCode || '').toUpperCase() === String(code || '').toUpperCase() || String(k.id || k.keyId || '') === String(code || ''));
        if (found) return found;
      }
    }
    const { data, error } = await this.client.from(KEYS).select('*')
      .or(`code_hash.eq.${code},code.eq.${code},key_code.eq.${code},id.eq.${code}`)
      .maybeSingle();
    if (error) throw error;
    return mapFrom(data, KEY_FIELDS);
  }

  async listKeys(limit = 100) {
    if (this.adapter && typeof this.adapter.fetchKeys === 'function') {
      const keys = await this.adapter.fetchKeys();
      if (keys) return keys.slice(0, limit);
    }
    const { data, error } = await this.client.from(KEYS).select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map((row) => mapFrom(row, KEY_FIELDS));
  }

  async deleteKey(keyId) {
    this.invalidateCache();
    if (this.adapter && typeof this.adapter.deleteKey === 'function') {
      return await this.adapter.deleteKey(keyId);
    }
    const { data, error } = await this.client.from(KEYS).delete().or(`id.eq.${keyId},key_id.eq.${keyId},code.eq.${keyId}`).select('*');
    if (error) throw error;
    return Boolean(data?.length);
  }

  async redeemKeyAtomic(code, username, transactionId = crypto.randomUUID()) {
    this.invalidateCache();
    if (this.adapter && typeof this.adapter.consumeKeyUsageAtomic === 'function') {
      return await this.adapter.consumeKeyUsageAtomic(code, username, transactionId);
    }
    const { data, error } = await this.client.rpc('consume_manager_key_usage', {
      p_code: code, p_username: username, p_transaction_id: transactionId
    });
    if (error) throw error;
    return unwrapRpc(data);
  }

  async redeemKeyWithAccess(codeHash, userId, values, actorId) {
    this.invalidateCache();
    const { workerIds = [], ...accessValues } = values;
    const { data, error } = await this.client.rpc('manager_redeem_code_with_access', {
      p_code_hash: codeHash,
      p_user_id: userId,
      p_access_values: mapTo(accessValues, ACCESS_FIELDS, ['userId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']),
      p_worker_ids: [...new Set(workerIds)].map(String),
      p_actor_id: String(actorId || '')
    });
    if (error?.code === '23505') throw new Error('One or more selected workers were assigned to another user at the same time. Retry the code redemption.');
    if (error) throw error;
    return mapFrom(unwrapRpc(data), KEY_FIELDS);
  }

  // --------------------------------------------------------------------------
  // SETTINGS & RUNTIME
  // --------------------------------------------------------------------------
  async getSetting(key) {
    const { data, error } = await this.client.from(SETTINGS).select('value,updated_at').eq('key', key).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    if (Array.isArray(data.value)) return data.value;
    if (data.value && typeof data.value === 'object') return { ...data.value, updatedAt: data.updated_at };
    return data.value ?? null;
  }

  async setSetting(key, value) {
    const { error } = await this.client.from(SETTINGS).upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return this.getSetting(key);
  }

  // --------------------------------------------------------------------------
  // OUTBOX QUEUE & PENDING ALLOCATIONS
  // --------------------------------------------------------------------------
  async enqueueOutbox(item) {
    if (this.adapter && typeof this.adapter.saveOutboxItem === 'function') {
      return await this.adapter.saveOutboxItem(item);
    }
    const { data, error } = await this.client.from(OUTBOX).insert({
      id: item.id || crypto.randomUUID(),
      task_type: item.taskType || item.type,
      payload: item.payload || {},
      status: 'pending',
      next_retry_at: item.nextRetryAt || new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).select('*').single();
    if (error) throw error;
    return data;
  }

  async claimOutboxBatch(workerId, limit = 10, leaseSeconds = 60) {
    if (this.adapter && typeof this.adapter.claimOutboxBatch === 'function') {
      return await this.adapter.claimOutboxBatch(workerId, limit, leaseSeconds);
    }
    const { data, error } = await this.client.rpc('claim_manager_outbox_batch', {
      p_worker_id: workerId, p_limit: limit, p_lease_seconds: leaseSeconds
    });
    if (error) throw error;
    return data || [];
  }

  async completeOutbox(id, workerId) {
    if (this.adapter && typeof this.adapter.completeOutboxItem === 'function') {
      return await this.adapter.completeOutboxItem(id, workerId);
    }
    const { error } = await this.client.from(OUTBOX).update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }

  async failOutbox(id, workerId, errorCode) {
    if (this.adapter && typeof this.adapter.failOutboxItem === 'function') {
      return await this.adapter.failOutboxItem(id, workerId, errorCode);
    }
    const { error } = await this.client.from(OUTBOX).update({ status: 'failed', error_code: errorCode, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }

  async claimPendingAllocations(workerId, limit = 5, leaseSeconds = 60) {
    if (this.adapter && typeof this.adapter.claimPendingAllocations === 'function') {
      return await this.adapter.claimPendingAllocations(workerId, limit, leaseSeconds);
    }
    const { data, error } = await this.client.rpc('claim_manager_pending_allocations', {
      p_worker_id: workerId, p_limit: limit, p_lease_seconds: leaseSeconds
    });
    if (error) throw error;
    return data || [];
  }

  async completePendingAllocation(id, finalStatus = 'completed', workerId = null) {
    if (this.adapter && typeof this.adapter.completePendingAllocation === 'function') {
      return await this.adapter.completePendingAllocation(id, finalStatus, workerId);
    }
    const { error } = await this.client.from(PENDING_ALLOCATIONS).update({ status: finalStatus, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  }

  // --------------------------------------------------------------------------
  // AUDIT LOGS
  // --------------------------------------------------------------------------
  async addAudit(entry) {
    const auditId = String(entry.id || ('audit_' + crypto.randomUUID()));
    if (this.adapter && typeof this.adapter.insertAuditLog === 'function') {
      return await this.adapter.insertAuditLog({
        id: auditId,
        actor: { username: entry.actorId || 'system', role: entry.actorRole || 'system', ip: entry.actorIp || '127.0.0.1' },
        action: entry.action,
        actionLabel: entry.actionLabel || entry.action,
        target: typeof entry.target === 'object' ? (entry.target || {}) : { raw: String(entry.target || '') },
        details: typeof entry.details === 'object' ? JSON.stringify(entry.details) : String(entry.details || ''),
        status: entry.status || 'SUCCESS',
        timestamp: new Date().toISOString()
      });
    }
    const nowIso = new Date().toISOString();
    const { error } = await this.client.from(AUDIT_LOGS).insert({
      id: auditId,
      log_type: 'SYSTEM',
      category: 'SYSTEM',
      actor_username: entry.actorId || 'system',
      action: String(entry.action || 'unknown').slice(0, 80),
      action_label: String(entry.action || 'unknown').slice(0, 80),
      target: typeof entry.target === 'object' ? (entry.target || {}) : { raw: String(entry.target || '').slice(0, 160) },
      details: typeof entry.details === 'object' ? JSON.stringify(entry.details) : String(entry.details || ''),
      status: 'SUCCESS',
      timestamp: nowIso
    });
    if (error && error.code !== '42P01') throw error;
  }

  async listAudit(limit = 100) {
    if (this.adapter && typeof this.adapter.fetchAuditLogs === 'function') {
      const res = await this.adapter.fetchAuditLogs({ limit });
      const rows = Array.isArray(res?.logs) ? res.logs : (Array.isArray(res?.entries) ? res.entries : null);
      if (rows) {
        return rows.map((e) => ({
          id: e.id || null,
          actorId: e.actor?.username || e.actor_username || 'system',
          action: e.action,
          target: typeof e.target === 'string' ? e.target : JSON.stringify(e.target || ''),
          details: e.details,
          createdAt: e.timestamp || e.created_at
        }));
      }
    }
    const { data, error } = await this.client.from(AUDIT_LOGS).select('id,actor_username,action,target,details,timestamp').order('timestamp', { ascending: false }).limit(limit);
    if (error && error.code !== '42P01') throw error;
    return (data || []).map((row) => ({
      id: row.id || null,
      actorId: row.actor_username ?? row.actor_id,
      action: row.action,
      target: typeof row.target === 'string' ? row.target : JSON.stringify(row.target || ''),
      details: row.details,
      createdAt: row.timestamp ?? row.created_at
    }));
  }

  async clearAuditLogs() {
    if (this.adapter && typeof this.adapter.clearAuditLogs === 'function') {
      const ok = await this.adapter.clearAuditLogs();
      if (ok) return true;
    }
    const { error } = await this.client.from(AUDIT_LOGS).delete().neq('id', '');
    if (error && error.code !== '42P01') throw error;
    return true;
  }

  // --------------------------------------------------------------------------
  // BACKUPS
  // --------------------------------------------------------------------------
  async fetchBackups() {
    if (this.adapter && typeof this.adapter.fetchBackups === 'function') {
      return await this.adapter.fetchBackups();
    }
    const { data, error } = await this.client.from(BACKUPS).select('name,created_at,size_bytes').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async fetchBackupPayload(name) {
    if (this.adapter && typeof this.adapter.fetchBackupPayload === 'function') {
      return await this.adapter.fetchBackupPayload(name);
    }
    const { data, error } = await this.client.from(BACKUPS).select('payload').eq('name', name).maybeSingle();
    if (error) throw error;
    return data?.payload || null;
  }

  async saveBackup(name, payload) {
    if (this.adapter && typeof this.adapter.saveBackup === 'function') {
      return await this.adapter.saveBackup(name, payload);
    }
    const jsonStr = JSON.stringify(payload || {});
    const { error } = await this.client.from(BACKUPS).upsert({
      name,
      payload: payload || {},
      size_bytes: Buffer.byteLength(jsonStr, 'utf8'),
      created_at: new Date().toISOString()
    }, { onConflict: 'name' });
    if (error) throw error;
  }

  async deleteBackup(name) {
    if (this.adapter && typeof this.adapter.deleteBackup === 'function') {
      return await this.adapter.deleteBackup(name);
    }
    const { error } = await this.client.from(BACKUPS).delete().eq('name', name);
    if (error) throw error;
  }

  // --------------------------------------------------------------------------
  // LINK4M ATTEMPTS (Full Backward & Forward Compatibility)
  // --------------------------------------------------------------------------
  async findActiveLinkAttempt(userId, now = new Date()) {
    const query = applyLinkUserFilter(this.client.from(LINK_ATTEMPTS).select('*'), userId);
    const { data, error } = await query.eq('status', 'pending')
      .gt('expires_at', now.toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return mapLinkFrom(data);
  }

  async getLinkAttempt(attemptId) {
    const { data, error } = await this.client.from(LINK_ATTEMPTS).select('*').eq('attempt_id', attemptId).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return mapLinkFrom(data);
  }

  async getLinkAttemptByTokenHash(tokenHash) {
    const { data, error } = await this.client.from(LINK_ATTEMPTS).select('*')
      .eq('token_hash', String(tokenHash || '').trim())
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return mapLinkFrom(data);
  }

  async getLatestLinkAttempt(userId) {
    const query = applyLinkUserFilter(this.client.from(LINK_ATTEMPTS).select('*'), userId);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return mapLinkFrom(data);
  }

  async countLinkRewards(userId, since) {
    const query = applyLinkUserFilter(this.client.from(LINK_ATTEMPTS).select('attempt_id', { count: 'exact', head: true }), userId);
    const { count, error } = await query.eq('status', 'rewarded').gte('rewarded_at', new Date(since).toISOString());
    if (error) throw error;
    return count || 0;
  }

  async countLinkAttempts(userId, since) {
    const query = applyLinkUserFilter(this.client.from(LINK_ATTEMPTS).select('attempt_id', { count: 'exact', head: true }), userId);
    const { count, error } = await query.gte('created_at', new Date(since).toISOString());
    if (error) throw error;
    return count || 0;
  }

  async lastLinkReward(userId) {
    const query = applyLinkUserFilter(this.client.from(LINK_ATTEMPTS).select('*'), userId);
    const { data, error } = await query.eq('status', 'rewarded')
      .order('rewarded_at', { ascending: false }).limit(1).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return mapLinkFrom(data);
  }

  async createLinkAttempt(record) {
    const nowIso = new Date().toISOString();
    const userIdVal = String(record.userId || record.username || '').trim();
    const usernameVal = String(record.username || userIdVal).trim().toLowerCase();
    const providerUrlVal = String(record.providerUrl || record.providerShortUrl || '');
    const dailyDateVal = String(record.dailyDate || record.vietnamDate || '');
    const payload = {
      ...mapTo(record, LINK_FIELDS),
      attempt_id: record.attemptId,
      user_id: userIdVal,
      username: usernameVal,
      provider_url: providerUrlVal,
      provider_short_url: providerUrlVal,
      daily_date: dailyDateVal,
      vietnam_date: dailyDateVal,
      created_at: toIso(record.createdAt) || nowIso,
      expires_at: toIso(record.expiresAt),
      purge_at: toIso(record.purgeAt) || null,
      updated_at: nowIso
    };
    const { error } = await this.client.from(LINK_ATTEMPTS).insert(payload);
    if (error) throw error;
    return record;
  }

  async setLinkAttemptProviderUrl(attemptId, providerUrl) {
    const cleanUrl = String(providerUrl || '');
    const { data, error } = await this.client.from(LINK_ATTEMPTS).update({
      provider_url: cleanUrl,
      provider_short_url: cleanUrl,
      updated_at: new Date().toISOString()
    }).eq('attempt_id', attemptId).eq('status', 'pending').select('attempt_id');
    if (error) throw error;
    return Boolean(data?.length);
  }

  async expireLinkAttempt(attemptId) {
    const { error } = await this.client.from(LINK_ATTEMPTS).update({
      status: 'expired',
      updated_at: new Date().toISOString()
    }).eq('attempt_id', attemptId).eq('status', 'pending');
    if (error) throw error;
  }

  async claimLinkAttempt(attemptId, tokenHash, now = new Date()) {
    const { data, error } = await this.client.rpc('manager_claim_link4m_attempt', {
      p_attempt_id: attemptId, p_token_hash: tokenHash, p_now: now.toISOString()
    });
    if (error) throw error;
    return mapLinkFrom(unwrapRpc(data));
  }

  async completeLink4mReward(attemptId, userId, values, actorId) {
    const { workerIds = [], ...accessValues } = values;
    const { data, error } = await this.client.rpc('manager_complete_link4m_reward', {
      p_attempt_id: attemptId,
      p_user_id: userId,
      p_access_values: mapTo(accessValues, ACCESS_FIELDS, ['userId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']),
      p_worker_ids: [...new Set(workerIds)].map(String),
      p_actor_id: String(actorId || '')
    });
    if (error?.code === '23505') throw new Error('Worker assignments changed while the Link4M reward was processing.');
    if (error) throw error;
    return mapLinkFrom(unwrapRpc(data));
  }

  async finishLinkAttempt(attemptId, patch) {
    const payload = {
      ...mapTo(patch, LINK_FIELDS),
      updated_at: new Date().toISOString()
    };
    const { data, error } = await this.client.from(LINK_ATTEMPTS).update(payload)
      .eq('attempt_id', attemptId).eq('status', 'processing').select('*').maybeSingle();
    if (error) throw error;
    return mapLinkFrom(data);
  }

  async resetLinkAttempt(attemptId) {
    const { error } = await this.client.from(LINK_ATTEMPTS).update({
      status: 'pending',
      processing_at: null,
      updated_at: new Date().toISOString()
    }).eq('attempt_id', attemptId).eq('status', 'processing');
    if (error) throw error;
  }

  async expireLinkAttempts(userId, now = new Date()) {
    const query = applyLinkUserFilter(
      this.client.from(LINK_ATTEMPTS).update({ status: 'expired', updated_at: new Date().toISOString() }),
      userId
    );
    const { error } = await query.eq('status', 'pending').lte('expires_at', now.toISOString());
    if (error) throw error;
  }
}

module.exports = SupabaseDashboardStore;
