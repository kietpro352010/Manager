'use strict';

const crypto = require('node:crypto');
const {
  encryptUserPassword,
  decryptUserPassword,
  isStoredCredentialCiphertext,
  isUnsupportedCredentialCiphertext,
  timingSafeStringEquals
} = require('../utils/secrets');

const ACCESS = 'manager_access';
const USERS = 'manager_users';
const ASSIGNMENTS = 'manager_worker_assignments';
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
  attemptId: 'attempt_id', userId: 'user_id', tokenHash: 'token_hash', rewardHours: 'reward_hours', status: 'status',
  createdAt: 'created_at', expiresAt: 'expires_at', providerUrl: 'provider_url', purgeAt: 'purge_at', dailyDate: 'daily_date',
  processingAt: 'processing_at', rewardedAt: 'rewarded_at'
};

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
        this.client.from(AUDIT).delete().lt('created_at', auditCutoff),
        this.client.from(LINK_ATTEMPTS).delete().lt('purge_at', now)
      ]);
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // USER ENTITLEMENT & ACCESS
  // --------------------------------------------------------------------------
  async assignedWorkerIds(userId) {
    // Thử đọc từ manager_worker_assignments trước
    try {
      const { data, error } = await this.client.from(ASSIGNMENTS).select('worker_id').eq('user_id', userId).order('assigned_at');
      if (!error && data) return data.map((row) => row.worker_id);
    } catch (_) {}

    // Fallback: đọc từ manager_users.assigned_bot_ids
    try {
      const { data, error } = await this.client.from(USERS).select('assigned_bot_ids').eq('id', userId).maybeSingle();
      if (!error && data?.assigned_bot_ids) {
        return Array.isArray(data.assigned_bot_ids) ? data.assigned_bot_ids.map(String) : [];
      }
    } catch (_) {}

    return [];
  }

  async replaceAssignments(userId, workerIds, actorId) {
    this.invalidateCache();
    const access = await this.getAccess(userId);
    return this.setAccess(userId, { ...(access || { role: 'user', status: 'active', isPermanent: false }), workerIds }, actorId);
  }

  async getAccess(userId) {
    if (!userId) return null;
    const cached = this.getCached(`access:${userId}`);
    if (cached) return cached;

    // 1. Thử đọc từ manager_access
    try {
      const { data, error } = await this.client.from(ACCESS).select('*').eq('user_id', userId).maybeSingle();
      if (!error && data) {
        const result = { ...mapFrom(data, ACCESS_FIELDS), workerIds: await this.assignedWorkerIds(userId) };
        this.setCached(`access:${userId}`, result);
        return result;
      }
    } catch (_) {}

    // 2. Thử đọc từ manager_users
    try {
      const { data, error } = await this.client.from(USERS).select('*')
        .or(`id.eq.${userId},username.eq.${userId}`)
        .maybeSingle();
      if (!error && data) {
        const assigned = Array.isArray(data.assigned_bot_ids) ? data.assigned_bot_ids.map(String) : [];
        const result = {
          userId: data.id || ('usr_' + data.username),
          username: data.username,
          role: data.role || 'user',
          status: data.status || 'active',
          isPermanent: Boolean(data.is_permanent),
          expiresAt: data.expires_at,
          planName: data.plan_name || 'Gói mặc định',
          note: data.note || '',
          allowAccountChange: data.allow_account_change !== false,
          lockReason: data.lock_reason || '',
          botCount: data.bot_count || 1,
          botAliases: data.bot_aliases || {},
          workerIds: assigned,
          createdAt: data.created_at,
          updatedAt: data.updated_at
        };
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

    // 1. Thử lưu vào manager_users nếu có bảng
    try {
      const cleanUsername = String(fields.username || userId).replace(/^usr_/, '');
      const assigned = [...new Set(workerIds)].map(String);
      const userRow = {
        id: userId,
        username: cleanUsername,
        role: String(fields.role || 'user'),
        status: String(fields.status || 'active'),
        is_permanent: Boolean(fields.isPermanent),
        expires_at: fields.expiresAt || null,
        plan_name: String(fields.planName || 'Gói mặc định'),
        assigned_bot_ids: assigned,
        bot_count: Math.max(1, Number(fields.botCount || assigned.length || 1)),
        allow_account_change: fields.allowAccountChange !== false,
        lock_reason: String(fields.lockReason || ''),
        note: String(fields.note || ''),
        updated_at: new Date().toISOString()
      };
      if (fields.password) {
        userRow.password = encryptUserPassword(fields.password);
      }
      const { data, error } = await this.client.from(USERS).upsert(userRow, { onConflict: 'username' }).select('*').maybeSingle();
      if (!error && data) {
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
    } catch (_) {}

    // 2. Fallback gọi RPC manager_set_user_access
    const { data, error } = await this.client.rpc('manager_set_user_access', {
      p_user_id: userId,
      p_values: mapTo(fields, ACCESS_FIELDS, ['userId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']),
      p_worker_ids: [...new Set(workerIds)].map(String),
      p_actor_id: String(actorId || '')
    });
    if (error) throw error;
    return { ...mapFrom(unwrapRpc(data), ACCESS_FIELDS), workerIds: await this.assignedWorkerIds(userId) };
  }

  async removeAccess(userId) {
    this.invalidateCache();
    try {
      await this.client.from(USERS).delete().or(`id.eq.${userId},username.eq.${userId}`);
    } catch (_) {}
    const { data, error } = await this.client.from(ACCESS).delete().eq('user_id', userId).select('user_id');
    if (error && error.code !== '42P01') throw error;
    return Boolean(data?.length);
  }

  async assignedUser(workerId) {
    const { data, error } = await this.client.from(ASSIGNMENTS).select('worker_id,user_id,assigned_by,assigned_at').eq('worker_id', workerId).maybeSingle();
    if (!error && data) {
      return { workerId: data.worker_id, userId: data.user_id, assignedBy: data.assigned_by, assignedAt: data.assigned_at };
    }

    // Fallback: tìm trong manager_users
    try {
      const { data: users, error: uErr } = await this.client.from(USERS).select('id,username,assigned_bot_ids').contains('assigned_bot_ids', [workerId]).limit(1);
      if (!uErr && users?.[0]) {
        return { workerId, userId: users[0].id || users[0].username, assignedBy: 'system', assignedAt: new Date().toISOString() };
      }
    } catch (_) {}

    return null;
  }

  async removeWorkerAssignments(workerId) {
    try {
      await this.client.from(ASSIGNMENTS).delete().eq('worker_id', workerId);
    } catch (_) {}
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

  async getUser(username) {
    if (!username) return null;
    const cacheKey = `user:${String(username).toLowerCase()}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    let user = null;
    if (this.adapter && typeof this.adapter.fetchUserAuthorization === 'function') {
      const res = await this.adapter.fetchUserAuthorization(null, username);
      if (res.ok && res.user) user = res.user;
    }
    if (!user) {
      user = await this.getAccess(username);
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
  // KEYS & GIFTCODES
  // --------------------------------------------------------------------------
  async createKey(record) {
    this.invalidateCache();
    if (this.adapter && typeof this.adapter.insertKeys === 'function') {
      return await this.adapter.insertKeys([record]);
    }
    const { error } = await this.client.from(KEYS).insert(mapTo(record, KEY_FIELDS));
    if (error) throw error;
  }

  async getKey(code) {
    if (this.adapter && typeof this.adapter.fetchKeys === 'function') {
      const keys = await this.adapter.fetchKeys();
      if (keys) {
        const found = keys.find((k) => String(k.code || k.key || '').toUpperCase() === String(code || '').toUpperCase());
        if (found) return found;
      }
    }
    const { data, error } = await this.client.from(KEYS).select('*')
      .or(`code.eq.${code},key_code.eq.${code},id.eq.${code}`)
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
    return data ? { ...(data.value || {}), updatedAt: data.updated_at } : null;
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
    if (this.adapter && typeof this.adapter.insertAuditLog === 'function') {
      return await this.adapter.insertAuditLog({
        actorUsername: entry.actorId || 'system',
        action: entry.action,
        details: typeof entry.details === 'object' ? JSON.stringify(entry.details) : String(entry.details || ''),
        status: 'SUCCESS'
      });
    }
    const { error } = await this.client.from(AUDIT).insert({
      actor_id: entry.actorId || null, action: String(entry.action || 'unknown').slice(0, 80),
      target: String(entry.target || '').slice(0, 160), details: entry.details || {}, created_at: new Date().toISOString()
    });
    if (error && error.code !== '42P01') throw error;
  }

  async listAudit(limit = 100) {
    if (this.adapter && typeof this.adapter.fetchAuditLogs === 'function') {
      const res = await this.adapter.fetchAuditLogs({ limit });
      if (res && Array.isArray(res.entries)) {
        return res.entries.map((e) => ({
          actorId: e.actor_username,
          action: e.action,
          target: e.target ? JSON.stringify(e.target) : '',
          details: e.details,
          createdAt: e.timestamp
        }));
      }
    }
    const { data, error } = await this.client.from(AUDIT).select('actor_id,action,target,details,created_at').order('created_at', { ascending: false }).limit(limit);
    if (error && error.code !== '42P01') throw error;
    return (data || []).map((row) => ({ actorId: row.actor_id, action: row.action, target: row.target, details: row.details, createdAt: row.created_at }));
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
    const { data, error } = await this.client.from(LINK_ATTEMPTS).select('*').eq('user_id', userId).eq('status', 'pending')
      .gt('expires_at', now.toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return mapFrom(data, LINK_FIELDS);
  }

  async getLinkAttempt(attemptId) {
    const { data, error } = await this.client.from(LINK_ATTEMPTS).select('*').eq('attempt_id', attemptId).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return mapFrom(data, LINK_FIELDS);
  }

  async getLatestLinkAttempt(userId) {
    const { data, error } = await this.client.from(LINK_ATTEMPTS).select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return mapFrom(data, LINK_FIELDS);
  }

  async countLinkRewards(userId, since) {
    const { count, error } = await this.client.from(LINK_ATTEMPTS).select('attempt_id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'rewarded').gte('rewarded_at', new Date(since).toISOString());
    if (error) throw error;
    return count || 0;
  }

  async countLinkAttempts(userId, since) {
    const { count, error } = await this.client.from(LINK_ATTEMPTS).select('attempt_id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('created_at', new Date(since).toISOString());
    if (error) throw error;
    return count || 0;
  }

  async lastLinkReward(userId) {
    const { data, error } = await this.client.from(LINK_ATTEMPTS).select('*').eq('user_id', userId).eq('status', 'rewarded')
      .order('rewarded_at', { ascending: false }).limit(1).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    return mapFrom(data, LINK_FIELDS);
  }

  async createLinkAttempt(record) {
    const { error } = await this.client.from(LINK_ATTEMPTS).insert(mapTo(record, LINK_FIELDS));
    if (error) throw error;
    return record;
  }

  async setLinkAttemptProviderUrl(attemptId, providerUrl) {
    const { data, error } = await this.client.from(LINK_ATTEMPTS).update({ provider_url: providerUrl })
      .eq('attempt_id', attemptId).eq('status', 'pending').select('attempt_id');
    if (error) throw error;
    return Boolean(data?.length);
  }

  async expireLinkAttempt(attemptId) {
    const { error } = await this.client.from(LINK_ATTEMPTS).update({ status: 'expired' })
      .eq('attempt_id', attemptId).eq('status', 'pending');
    if (error) throw error;
  }

  async claimLinkAttempt(attemptId, tokenHash, now = new Date()) {
    const { data, error } = await this.client.rpc('manager_claim_link4m_attempt', {
      p_attempt_id: attemptId, p_token_hash: tokenHash, p_now: now.toISOString()
    });
    if (error) throw error;
    return mapFrom(unwrapRpc(data), LINK_FIELDS);
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
    return mapFrom(unwrapRpc(data), LINK_FIELDS);
  }

  async finishLinkAttempt(attemptId, patch) {
    const { data, error } = await this.client.from(LINK_ATTEMPTS).update(mapTo(patch, LINK_FIELDS))
      .eq('attempt_id', attemptId).eq('status', 'processing').select('*').maybeSingle();
    if (error) throw error;
    return mapFrom(data, LINK_FIELDS);
  }

  async resetLinkAttempt(attemptId) {
    const { error } = await this.client.from(LINK_ATTEMPTS).update({ status: 'pending', processing_at: null })
      .eq('attempt_id', attemptId).eq('status', 'processing');
    if (error) throw error;
  }

  async expireLinkAttempts(userId, now = new Date()) {
    const { error } = await this.client.from(LINK_ATTEMPTS).update({ status: 'expired' })
      .eq('user_id', userId).eq('status', 'pending').lte('expires_at', now.toISOString());
    if (error) throw error;
  }
}

module.exports = SupabaseDashboardStore;
