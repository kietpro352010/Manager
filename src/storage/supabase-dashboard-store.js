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
const SESSIONS = 'manager_sessions';

const USER_ACCESS_COLUMNS = [
  'id', 'username', 'role', 'status', 'is_permanent', 'expires_at',
  'plan_name', 'note', 'allow_account_change', 'lock_reason',
  'bot_count', 'bot_aliases', 'assigned_bot_ids', 'created_at', 'updated_at'
].join(',');

const USER_LIST_ACCESS_COLUMNS = [
  'id', 'username', 'role', 'status', 'is_permanent', 'expires_at',
  'plan_name', 'note', 'allow_account_change', 'lock_reason',
  'bot_count', 'bot_aliases', 'assigned_bot_ids',
  'registration_ip', 'device_fingerprint', 'discord_user_id',
  'last_login_ip', 'last_login_at',
  'created_at', 'updated_at'
].join(',');

const ACCESS_FIELDS = {
  userId: 'user_id', role: 'role', status: 'status', isPermanent: 'is_permanent', expiresAt: 'expires_at',
  planName: 'plan_name', note: 'note', username: 'username', createdAt: 'created_at', updatedAt: 'updated_at',
  createdBy: 'created_by', updatedBy: 'updated_by',
  allowAccountChange: 'allow_account_change', lockReason: 'lock_reason',
  botAliases: 'bot_aliases', botCount: 'bot_count',
  registrationIp: 'registration_ip', deviceFingerprint: 'device_fingerprint', registrationUserAgent: 'registration_user_agent',
  discordUserId: 'discord_user_id',
  lastLoginIp: 'last_login_ip', lastLoginAt: 'last_login_at', isTrial: 'is_trial', trialBotId: 'trial_bot_id'
};

const KEY_FIELDS = {
  keyId: 'key_id', codeHash: 'code_hash', codeSuffix: 'code_suffix', status: 'status', days: 'days',
  isPermanent: 'is_permanent', botCount: 'bot_count', workerIds: 'worker_ids', botIds: 'bot_ids',
  allowAccountChange: 'allow_account_change', note: 'note', planName: 'plan_name',
  durationDays: 'duration_days', durationMs: 'duration_ms',
  maxUses: 'max_uses', usedCount: 'used_count', usedUsers: 'used_users', expiresAt: 'expires_at',
  createdBy: 'created_by', createdAt: 'created_at', lastUsedAt: 'last_used_at', lastUsedBy: 'last_used_by',
  id: 'id', code: 'code', key: 'key', used: 'used', usedBy: 'used_by', usedAt: 'used_at'
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

function quotePostgrestValue(val) {
  const s = String(val ?? '').replace(/[\u0000-\u001f\u007f]/g, '');
  if (/^[a-zA-Z0-9_:-]+$/.test(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function applyLinkUserFilter(query, userId) {
  const clean = String(userId || '').trim();
  const lower = clean.toLowerCase();
  const bare = lower.replace(/^usr_/, '');
  const filters = [`user_id.eq.${quotePostgrestValue(clean)}`];
  if (lower && lower !== clean) filters.push(`user_id.eq.${quotePostgrestValue(lower)}`);
  if (lower) filters.push(`username.eq.${quotePostgrestValue(lower)}`);
  if (bare && bare !== lower) filters.push(`username.eq.${quotePostgrestValue(bare)}`);
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

  getCachedEntry(key) {
    const entry = this.cache.get(key);
    if (!entry) return { hit: false, data: null };
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return { hit: false, data: null };
    }
    return { hit: true, data: entry.data };
  }

  getCached(key) {
    const entry = this.getCachedEntry(key);
    return entry.hit ? entry.data : null;
  }

  setCached(key, data, ttlMs = 15000) {
    if (this.cache.size >= 1000 && !this.cache.has(key)) {
      const now = Date.now();
      for (const [k, v] of this.cache.entries()) {
        if (!v || now > v.expiresAt) this.cache.delete(k);
      }
      while (this.cache.size >= 1000) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  invalidateUserCache(userId, username = '') {
    this.cache.delete('access:all');
    const cleanId = String(userId || '').trim();
    const cleanIdLower = cleanId.toLowerCase();
    const cleanUser = String(username || '').trim().toLowerCase();
    if (cleanId) {
      this.cache.delete(`access:${cleanId}`);
      this.cache.delete(`access:${cleanIdLower}`);
      this.cache.delete(`user:${cleanIdLower}`);
    }
    if (cleanUser) {
      this.cache.delete(`access:${cleanUser}`);
      this.cache.delete(`access:usr_${cleanUser}`);
      this.cache.delete(`user:${cleanUser}`);
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith('discord_user:') || (cleanIdLower && key.toLowerCase() === `access:${cleanIdLower}`)) {
        this.cache.delete(key);
      }
    }
  }

  invalidateCache() {
    this.cache.clear();
    this.cachedMaintenance = undefined;
    this.cachedMaintenanceAt = 0;
    this.cachedAnnouncement = undefined;
    this.cachedAnnouncementAt = 0;
  }

  async runMaintenanceCleanup() {
    if (!this.client || typeof this.client.from !== 'function') return;
    try {
      const now = new Date().toISOString();
      const nowMs = Date.now();
      const auditCutoff = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
      const posCutoff = new Date(nowMs - 14 * 24 * 60 * 60 * 1000).toISOString();
      await Promise.allSettled([
        this.client.from(AUDIT_LOGS).delete().lt('timestamp', auditCutoff),
        this.client.from('bot_position_logs').delete().lt('changed_at', posCutoff),
        this.client.from(LINK_ATTEMPTS).delete().lt('purge_at', now),
        this.client.from(SESSIONS).delete().lt('expires_at', nowMs)
      ]);
    } catch (_) {}
  }

  async initialize() {
    // 1. Kiểm tra kết nối nhanh qua OpenAPI spec / adapter nếu có
    let adapterConnected = false;
    if (this.adapter && typeof this.adapter.testConnection === 'function') {
      try {
        const testRes = await this.adapter.testConnection();
        if (testRes?.ok) {
          adapterConnected = true;
        }
      } catch (_) {}
    }

    if (!adapterConnected) {
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
    }

    // 3. Luôn dọn dẹp bản ghi cũ nếu bảng tồn tại (giảm DB size & Log Ingestion)
    await this.runMaintenanceCleanup();
  }

  // --------------------------------------------------------------------------
  // USER ENTITLEMENT & ACCESS
  // --------------------------------------------------------------------------
  async resolveUserRow(userId, columns = '*') {
    const clean = String(userId || '').trim();
    if (!clean) return null;
    const lower = clean.toLowerCase();
    const bare = lower.startsWith('usr_') ? lower.slice(4) : lower;
    try {
      const q = this.client.from(USERS).select(columns);
      if (typeof q.or === 'function') {
        const filters = [`id.eq.${quotePostgrestValue(clean)}`, `username.eq.${quotePostgrestValue(lower)}`];
        if (bare && bare !== lower) filters.push(`username.eq.${quotePostgrestValue(bare)}`);
        const { data, error } = await q.or(filters.join(',')).maybeSingle();
        if (!error && data) return data;
      }
    } catch (_) {}

    const lookups = [['id', clean], ['username', lower]];
    if (bare && bare !== lower) lookups.push(['username', bare]);
    for (const [col, val] of lookups) {
      try {
        const { data, error } = await this.client.from(USERS).select(columns).eq(col, val).maybeSingle();
        if (!error && data) return data;
      } catch (_) {}
    }
    return null;
  }

  async assignedWorkerIds(userId, knownUserRow = null) {
    const clean = String(userId || '').trim();
    if (!clean) return [];
    const lower = clean.toLowerCase();
    const bare = lower.startsWith('usr_') ? lower.slice(4) : lower;
    const userRow = knownUserRow || await this.resolveUserRow(clean, 'id,username,assigned_bot_ids');
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
    const normCacheKey = `access:${String(userId).trim().toLowerCase()}`;
    if (!bypassCache) {
      const cached = this.getCached(normCacheKey);
      if (cached) return cached;
    }

    // 1. Thử đọc từ manager_users (id hoặc username)
    const userData = await this.resolveUserRow(userId, USER_ACCESS_COLUMNS);
    if (userData) {
      const hasAssignedArray = Array.isArray(userData.assigned_bot_ids);
      const rawAssigned = hasAssignedArray ? userData.assigned_bot_ids.map(String) : [];
      const assigned = hasAssignedArray ? rawAssigned : await this.assignedWorkerIds(userData.id || userId, userData);
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
        botCount: (userData.bot_count !== undefined && userData.bot_count !== null) ? Number(userData.bot_count) : 1,
        botAliases: userData.bot_aliases || {},
        workerIds: assigned,
        createdAt: userData.created_at,
        updatedAt: userData.updated_at
      };
      this.setCached(normCacheKey, result);
      return result;
    }

    // 2. Fallback đọc từ manager_access
    try {
      const { data, error } = await this.client.from(ACCESS).select('*').eq('user_id', userId).maybeSingle();
      if (!error && data) {
        const result = { ...mapFrom(data, ACCESS_FIELDS), workerIds: await this.assignedWorkerIds(userId) };
        this.setCached(normCacheKey, result);
        return result;
      }
    } catch (_) {}

    return null;
  }

  async listAccess() {
    const cached = this.getCached('access:all');
    if (cached) return cached;

    // Batch fetch active Discord links to guarantee 100% parity across tables
    const discordLinkMap = new Map();
    try {
      const { data: links } = await this.client.from('manager_discord_links')
        .select('discord_user_id, username, manager_user_id')
        .eq('status', 'active');
      if (Array.isArray(links)) {
        for (const l of links) {
          if (l.discord_user_id) {
            if (l.username) discordLinkMap.set(String(l.username).trim().toLowerCase(), String(l.discord_user_id).trim());
            if (l.manager_user_id) discordLinkMap.set(String(l.manager_user_id).trim(), String(l.discord_user_id).trim());
          }
        }
      }
    } catch (_) {}

    const fetchPaged = async (cols) => {
      const firstQ = this.client.from(USERS).select(cols).order('created_at', { ascending: false });
      if (typeof firstQ.range !== 'function') {
        return await firstQ;
      }
      const rows = [];
      for (let page = 0; page < 50; page += 1) {
        const from = page * 1000;
        const to = from + 999;
        const q = this.client.from(USERS).select(cols).order('created_at', { ascending: false }).range(from, to);
        const { data, error } = await q;
        if (error) return { data: null, error };
        if (Array.isArray(data) && data.length > 0) rows.push(...data);
        if (!Array.isArray(data) || data.length < 1000) break;
      }
      return { data: rows, error: null };
    };

    // 1. Đọc từ manager_users (fail-closed on non-missing-table errors)
    let { data: users, error } = await fetchPaged(USER_LIST_ACCESS_COLUMNS);
    if (error && isMissingSchemaError(error)) {
      const fallbackCols = USER_LIST_ACCESS_COLUMNS.split(',').filter(c => !['last_login_ip', 'last_login_at'].includes(c.trim())).join(',');
      const fallbackRes = await fetchPaged(fallbackCols);
      if (!fallbackRes.error && Array.isArray(fallbackRes.data)) {
        users = fallbackRes.data;
        error = null;
      } else {
        error = fallbackRes.error || error;
      }
    }
    if (error && !isMissingSchemaError(error)) {
      throw error instanceof Error ? error : new Error(error.message || 'Lỗi tải danh sách người dùng từ Supabase.');
    }
    if (!error && Array.isArray(users) && users.length > 0) {
      const result = users.map((u) => {
        const uNameLower = String(u.username || '').trim().toLowerCase();
        const uId = String(u.id || '').trim();
        const dId = String(u.discord_user_id || discordLinkMap.get(uNameLower) || discordLinkMap.get(uId) || '').trim();
        return {
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
          botCount: (u.bot_count !== undefined && u.bot_count !== null) ? Number(u.bot_count) : 1,
          botAliases: u.bot_aliases || {},
          registrationIp: u.registration_ip || '',
          deviceFingerprint: u.device_fingerprint || '',
          discordUserId: dId,
          lastLoginIp: u.last_login_ip || '',
          lastLoginAt: u.last_login_at || null,
          workerIds: Array.isArray(u.assigned_bot_ids) ? u.assigned_bot_ids.map(String) : [],
          createdAt: u.created_at,
          updatedAt: u.updated_at
        };
      });
      this.setCached('access:all', result);
      return result;
    }

    // 2. Fallback đọc từ manager_access khi manager_users chưa tồn tại hoặc trống
    const [{ data: legacyUsers, error: usersError }, { data: assignments, error: assignmentsError }] = await Promise.all([
      this.client.from(ACCESS).select('*').order('updated_at', { ascending: false }),
      this.client.from(ASSIGNMENTS).select('user_id,worker_id').order('assigned_at')
    ]);
    if (usersError) {
      if (isMissingSchemaError(usersError)) {
        return Array.isArray(users) ? [] : [];
      }
      throw usersError instanceof Error ? usersError : new Error(usersError.message || 'Lỗi tải manager_access.');
    }
    if (assignmentsError && !isMissingSchemaError(assignmentsError)) {
      throw assignmentsError instanceof Error ? assignmentsError : new Error(assignmentsError.message || 'Lỗi tải manager_assignments.');
    }
    const grouped = new Map();
    for (const row of assignments || []) grouped.set(row.user_id, [...(grouped.get(row.user_id) || []), row.worker_id]);
    const result = (legacyUsers || []).map((row) => {
      const mapped = mapFrom(row, ACCESS_FIELDS);
      const uNameLower = String(mapped.username || '').trim().toLowerCase();
      const uId = String(mapped.userId || '').trim();
      const dId = String(mapped.discordUserId || discordLinkMap.get(uNameLower) || discordLinkMap.get(uId) || '').trim();
      return {
        ...mapped,
        discordUserId: dId,
        workerIds: grouped.get(row.user_id) || []
      };
    });
    this.setCached('access:all', result);
    return result;
  }

  async setAccess(userId, values, actorId) {
    this.invalidateCache();
    const normalizeWorkerIds = (ids) => [...new Set((Array.isArray(ids) ? ids : [])
      .map((id) => String(id).trim().toLowerCase())
      .filter(Boolean))];
    const hasAssignmentInput = Object.prototype.hasOwnProperty.call(values || {}, 'workerIds')
      || Object.prototype.hasOwnProperty.call(values || {}, 'assignedBotIds');
    const rawWorkerIds = Object.prototype.hasOwnProperty.call(values || {}, 'workerIds')
      ? values.workerIds
      : values?.assignedBotIds;
    const workerIds = hasAssignmentInput ? normalizeWorkerIds(rawWorkerIds) : [];
    const fields = { ...(values || {}) };
    delete fields.workerIds;
    delete fields.assignedBotIds;
    let assignedForSync = workerIds;
    let directUsersErr = null;
    let existingUser = null;
    let assignmentSyncAttempted = false;

    // 1. Thử lưu vào manager_users nếu có bảng
    try {
      try {
        existingUser = (await this.resolveUserRow(userId)) || (fields.username ? await this.resolveUserRow(fields.username) : null);
      } catch (_) {}

      const cleanUsername = fields.username
        ? String(fields.username).trim().toLowerCase()
        : (existingUser?.username || String(userId).trim().toLowerCase().replace(/^usr_/, ''));
      if (existingUser?.id && String(existingUser.username || '').toLowerCase() !== cleanUsername) {
        const usernameCollision = await this.resolveUserRow(cleanUsername);
        if (usernameCollision && String(usernameCollision.id) !== String(existingUser.id)) {
          throw new Error('Tên đăng nhập này đã có người sử dụng.');
        }
      }
      const assigned = hasAssignmentInput
        ? workerIds
        : normalizeWorkerIds(existingUser?.assigned_bot_ids);
      assignedForSync = assigned;
      const explicitBotCount = fields.botCount !== undefined && fields.botCount !== null && Number.isFinite(Number(fields.botCount))
        ? Math.trunc(Number(fields.botCount))
        : null;
      const existingBotCount = existingUser?.bot_count !== undefined && existingUser?.bot_count !== null && Number.isFinite(Number(existingUser.bot_count))
        ? Math.trunc(Number(existingUser.bot_count))
        : null;
      const resolvedBotCount = explicitBotCount !== null
        ? Math.max(assigned.length, explicitBotCount)
        : (existingBotCount !== null
            ? Math.max(assigned.length, existingBotCount)
            : Math.max(1, assigned.length));
      const userRow = {
        id: existingUser?.id || userId,
        username: cleanUsername,
        role: String(fields.role || existingUser?.role || 'user'),
        status: String(fields.status || existingUser?.status || 'active'),
        is_permanent: fields.isPermanent !== undefined ? Boolean(fields.isPermanent) : Boolean(existingUser?.is_permanent),
        expires_at: fields.expiresAt !== undefined ? (fields.expiresAt || null) : (existingUser?.expires_at || null),
        plan_name: String(fields.planName || existingUser?.plan_name || 'Gói mặc định'),
        assigned_bot_ids: assigned,
        bot_count: resolvedBotCount,
        bot_aliases: (fields.botAliases && typeof fields.botAliases === 'object')
          ? fields.botAliases
          : ((existingUser?.bot_aliases && typeof existingUser.bot_aliases === 'object') ? existingUser.bot_aliases : {}),
        allow_account_change: fields.allowAccountChange !== undefined ? (fields.allowAccountChange !== false) : (existingUser?.allow_account_change !== false),
        lock_reason: String(fields.lockReason !== undefined ? fields.lockReason : (existingUser?.lock_reason || '')),
        note: String(fields.note !== undefined ? fields.note : (existingUser?.note || '')),
        updated_at: new Date().toISOString()
      };
      if (fields.registrationIp !== undefined || existingUser?.registration_ip !== undefined) {
        userRow.registration_ip = fields.registrationIp !== undefined ? (fields.registrationIp || null) : (existingUser?.registration_ip || null);
      }
      if (fields.deviceFingerprint !== undefined || existingUser?.device_fingerprint !== undefined) {
        userRow.device_fingerprint = fields.deviceFingerprint !== undefined ? (fields.deviceFingerprint || null) : (existingUser?.device_fingerprint || null);
      }
      if (fields.registrationUserAgent !== undefined || existingUser?.registration_user_agent !== undefined) {
        userRow.registration_user_agent = fields.registrationUserAgent !== undefined ? (fields.registrationUserAgent || null) : (existingUser?.registration_user_agent || null);
      }
      if (fields.lastLoginIp !== undefined || fields.last_login_ip !== undefined || existingUser?.last_login_ip !== undefined) {
        userRow.last_login_ip = (fields.lastLoginIp || fields.last_login_ip || existingUser?.last_login_ip || null);
      }
      if (fields.lastLoginAt !== undefined || fields.last_login_at !== undefined || existingUser?.last_login_at !== undefined) {
        userRow.last_login_at = (fields.lastLoginAt || fields.last_login_at || existingUser?.last_login_at || null);
      }
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
          : encryptUserPassword(p);
      } else if (existingUser?.password) {
        userRow.password = existingUser.password;
      }
      const directOnlyFields = [
        'password', 'isTrial', 'trialBotId', 'registrationIp',
        'deviceFingerprint', 'registrationUserAgent', 'botCount',
        'lastLoginIp', 'lastLoginAt'
      ];
      const requiresDirectWrite = directOnlyFields.some((field) => fields[field] !== undefined)
        || Boolean(fields.username && existingUser?.username
          && String(fields.username).trim().toLowerCase() !== String(existingUser.username).toLowerCase());

      if (hasAssignmentInput) {
        if (typeof this.client?.rpc !== 'function') {
          throw new Error('Không thể đồng bộ bot được gán: RPC manager_set_user_access chưa khả dụng.');
        }
        assignmentSyncAttempted = true;
        const { data: rpcData, error: assignmentError } = await this.client.rpc('manager_set_user_access', {
          p_user_id: userRow.id || userId,
          p_values: mapTo(fields, ACCESS_FIELDS, ['userId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']),
          p_worker_ids: assigned,
          p_actor_id: String(actorId || '')
        });
        if (assignmentError) throw assignmentError;

        if (!requiresDirectWrite) {
          if (String(userRow.status).toLowerCase() === 'disabled' && typeof this.adapter?.revokeUserSessions === 'function') {
            await this.adapter.revokeUserSessions(userId).catch(() => false);
          }
          this.invalidateCache();
          const rpcRow = unwrapRpc(rpcData);
          return {
            userId: rpcRow?.id || rpcRow?.user_id || userRow.id || userId,
            username: rpcRow?.username || userRow.username,
            role: rpcRow?.role || userRow.role,
            status: rpcRow?.status || userRow.status,
            isPermanent: rpcRow?.is_permanent !== undefined ? Boolean(rpcRow.is_permanent) : Boolean(userRow.is_permanent),
            expiresAt: rpcRow?.expires_at !== undefined ? rpcRow.expires_at : userRow.expires_at,
            planName: rpcRow?.plan_name || userRow.plan_name,
            allowAccountChange: rpcRow?.allow_account_change !== undefined ? (rpcRow.allow_account_change !== false) : userRow.allow_account_change,
            lockReason: rpcRow?.lock_reason !== undefined ? String(rpcRow.lock_reason || '') : userRow.lock_reason,
            botAliases: (rpcRow?.bot_aliases && typeof rpcRow.bot_aliases === 'object') ? rpcRow.bot_aliases : userRow.bot_aliases,
            botCount: rpcRow?.bot_count !== undefined ? Number(rpcRow.bot_count) : userRow.bot_count,
            workerIds: assigned,
            updatedAt: rpcRow?.updated_at || userRow.updated_at
          };
        }
      }
      let userWrite = this.client.from(USERS);
      if (existingUser?.id && String(existingUser.username || '').toLowerCase() !== cleanUsername) {
        const renamedRow = { ...userRow };
        delete renamedRow.id;
        userWrite = userWrite.update(renamedRow).eq('id', existingUser.id);
      } else {
        userWrite = userWrite.upsert(userRow, { onConflict: 'username' });
      }
      const { data, error } = await userWrite.select('*').maybeSingle();
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
          allowAccountChange: data.allow_account_change !== undefined ? (data.allow_account_change !== false) : userRow.allow_account_change,
          lockReason: data.lock_reason !== undefined ? String(data.lock_reason || '') : userRow.lock_reason,
          botAliases: (data.bot_aliases && typeof data.bot_aliases === 'object') ? data.bot_aliases : userRow.bot_aliases,
          botCount: (data.bot_count !== undefined && data.bot_count !== null) ? Number(data.bot_count) : userRow.bot_count,
          workerIds: assigned,
          updatedAt: data.updated_at
        };
      }
      directUsersErr = error || null;
    } catch (err) {
      directUsersErr = err;
    }

    const directOnlyFields = [
      'password', 'isTrial', 'trialBotId', 'registrationIp',
      'deviceFingerprint', 'registrationUserAgent', 'botCount',
      'lastLoginIp', 'lastLoginAt'
    ];
    const requiresDirectWrite = directOnlyFields.some((field) => fields[field] !== undefined)
      || Boolean(fields.username && existingUser?.username
        && String(fields.username).trim().toLowerCase() !== String(existingUser.username).toLowerCase());
    if (assignmentSyncAttempted || requiresDirectWrite) {
      throw directUsersErr || new Error('Không thể lưu đầy đủ thông tin người dùng.');
    }

    if (typeof this.client?.rpc !== 'function') {
      if (directUsersErr) throw directUsersErr;
      throw new Error('Không thể lưu quyền truy cập người dùng.');
    }

    if (!hasAssignmentInput) {
      try {
        const existing = await this.resolveUserRow(userId);
        if (Array.isArray(existing?.assigned_bot_ids)) assignedForSync = normalizeWorkerIds(existing.assigned_bot_ids);
        else assignedForSync = normalizeWorkerIds(await this.assignedWorkerIds(userId));
      } catch (_) {
        assignedForSync = normalizeWorkerIds(await this.assignedWorkerIds(userId).catch(() => []));
      }
    }

    // 2. Fallback gọi RPC manager_set_user_access
    const { data, error } = await this.client.rpc('manager_set_user_access', {
      p_user_id: userId,
      p_values: mapTo(fields, ACCESS_FIELDS, ['userId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']),
      p_worker_ids: assignedForSync,
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
        if (linkRes?.error && !isMissingSchemaError(linkRes.error)) {
          throw linkRes.error;
        }
      } catch (err) {
        if (!isMissingSchemaError(err)) throw err;
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
        if (sessRes?.error && !isMissingSchemaError(sessRes.error)) {
          throw sessRes.error;
        }
      } catch (err) {
        if (!isMissingSchemaError(err)) throw err;
      }

      try {
        const userQ = this.client.from(USERS).delete();
        const userRes = typeof userQ.or === 'function'
          ? await userQ.or(`id.eq.${quotePostgrestValue(clean)},username.eq.${quotePostgrestValue(lower)},username.eq.${quotePostgrestValue(bare)}`).select('username')
          : await userQ.eq('id', clean).select('username');
        if (userRes?.error && !isMissingSchemaError(userRes.error)) {
          throw userRes.error;
        }
        if (userRes?.data?.length) deletedAny = true;
      } catch (err) {
        if (!isMissingSchemaError(err)) throw err;
      }

      try {
        const { data, error } = await this.client.from(ACCESS).delete().eq('user_id', clean).select('user_id');
        if (error && !isMissingSchemaError(error)) throw error;
        return deletedAny || Boolean(data?.length);
      } catch (err) {
        if (!isMissingSchemaError(err)) throw err;
        return deletedAny;
      }
    } finally {
      this.invalidateCache();
    }
  }

  async countUsersByIp(ip) {
    const cleanIp = String(ip || '').trim();
    if (!cleanIp) return 0;
    try {
      if (this.client) {
        const { count, error } = await this.client
          .from(USERS)
          .select('*', { count: 'exact', head: true })
          .eq('registration_ip', cleanIp);
        if (!error && typeof count === 'number') return count;
      }
    } catch (_) {}
    const users = await this.listAccess().catch(() => []);
    return users.filter(u => String(u.registrationIp || u.registration_ip || '') === cleanIp).length;
  }

  async countUsersByFingerprint(fingerprint) {
    const cleanFp = String(fingerprint || '').trim();
    if (!cleanFp || cleanFp === 'dfp_unknown') return 0;
    try {
      if (this.client) {
        const { count, error } = await this.client
          .from(USERS)
          .select('*', { count: 'exact', head: true })
          .eq('device_fingerprint', cleanFp);
        if (!error && typeof count === 'number') return count;
      }
    } catch (_) {}
    const users = await this.listAccess().catch(() => []);
    return users.filter(u => String(u.deviceFingerprint || u.device_fingerprint || '') === cleanFp).length;
  }

  async isIpWhitelisted(ip) {
    const cleanIp = String(ip || '').trim();
    if (!cleanIp) return false;
    try {
      if (this.client) {
        const { data, error } = await this.client
          .from('manager_ip_whitelist')
          .select('ip')
          .eq('ip', cleanIp)
          .maybeSingle();
        if (!error && data?.ip) return true;
      }
    } catch (_) {}
    return false;
  }

  async listIpWhitelist() {
    try {
      if (this.client) {
        const { data, error } = await this.client
          .from('manager_ip_whitelist')
          .select('ip, reason, created_by, created_at')
          .order('created_at', { ascending: false });
        if (!error && Array.isArray(data)) return data;
      }
    } catch (_) {}
    return [];
  }

  async addIpWhitelist({ ip, reason = '', createdBy = 'admin' }) {
    const cleanIp = String(ip || '').trim();
    if (!cleanIp) throw new Error('Địa chỉ IP không hợp lệ.');
    if (this.client) {
      const { error } = await this.client
        .from('manager_ip_whitelist')
        .upsert({
          ip: cleanIp,
          reason: String(reason || ''),
          created_by: String(createdBy || 'admin'),
          created_at: new Date().toISOString()
        });
      if (error) throw error;
    }
    return { ok: true, ip: cleanIp };
  }

  async removeIpWhitelist(ip) {
    const cleanIp = String(ip || '').trim();
    if (!cleanIp) return false;
    if (this.client) {
      const { error } = await this.client
        .from('manager_ip_whitelist')
        .delete()
        .eq('ip', cleanIp);
      if (error) throw error;
    }
    return true;
  }

  async isRecentAdminIp(ip) {
    const cleanIp = String(ip || '').trim();
    if (!cleanIp) return false;
    if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') return true;
    try {
      if (this.client) {
        const recentSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        let auditQuery = this.client
          .from('audit_logs')
          .select('id, actor_username, actor_role, actor_ip, timestamp')
          .eq('actor_ip', cleanIp)
          .gte('timestamp', recentSince);
        if (typeof auditQuery.or === 'function') {
          auditQuery = auditQuery.or('actor_role.eq.admin,actor_username.eq.admin');
        } else if (typeof auditQuery.eq === 'function') {
          auditQuery = auditQuery.eq('actor_role', 'admin');
        }
        let res = await auditQuery
          .order('timestamp', { ascending: false })
          .limit(10);
        if (res?.error && isMissingSchemaError(res.error)) {
          res = await this.client
            .from('audit_logs')
            .select('id, actor_username, actor_role')
            .eq('ip', cleanIp)
            .limit(10);
        }
        const data = res?.data;
        if (!res?.error && Array.isArray(data) && data.length > 0) {
          const hasAdminLog = data.some((d) =>
            String(d.actor_username || d.actor_id || '').toLowerCase() === 'admin' ||
            String(d.actor_role || '').toLowerCase() === 'admin'
          );
          if (hasAdminLog) return true;
        }
      }
    } catch (_) {}
    return false;
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

      if (usedFallback && typeof this.client.from(USERS).select === 'function') {
        try {
          const allUsers = [];
          const PAGE_SIZE = 1000;
          let offset = 0;
          while (true) {
            const query = this.client
              .from(USERS)
              .select('id, username, assigned_bot_ids');
            const { data: page, error: allErr } = typeof query?.range === 'function'
              ? await query.range(offset, offset + PAGE_SIZE - 1)
              : await query;
            if (allErr) {
              if (!isMissingSchemaError(allErr) && String(allErr?.code || '') !== '42501') {
                throw allErr;
              }
              break;
            }
            if (!Array.isArray(page) || page.length === 0) break;
            allUsers.push(...page);
            if (typeof query?.range !== 'function' || page.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
          }
          usersToUpdate = allUsers.filter((u) => {
            const ids = Array.isArray(u.assigned_bot_ids)
              ? u.assigned_bot_ids.map((x) => String(x).toLowerCase())
              : (typeof u.assigned_bot_ids === 'string' ? (() => { try { const a = JSON.parse(u.assigned_bot_ids || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } })().map((x) => String(x).toLowerCase()) : []);
            return ids.includes(targetId);
          });
        } catch (scanErr) {
          if (!isMissingSchemaError(scanErr) && String(scanErr?.code || '') !== '42501') {
            throw scanErr;
          }
        }
      }

      for (const u of usersToUpdate) {
        const rawIds = Array.isArray(u.assigned_bot_ids)
          ? u.assigned_bot_ids
          : (typeof u.assigned_bot_ids === 'string' ? (() => { try { const a = JSON.parse(u.assigned_bot_ids || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } })() : []);
        const filtered = rawIds.filter((id) => String(id).trim().toLowerCase() !== targetId);
        if (filtered.length !== rawIds.length) {
          const updateRes = await this.client
            .from(USERS)
            .update({ assigned_bot_ids: filtered, updated_at: new Date().toISOString() })
            .eq('id', u.id);
          if (updateRes?.error && !isMissingSchemaError(updateRes.error)) {
            throw updateRes.error instanceof Error ? updateRes.error : new Error(updateRes.error.message || 'Lỗi cập nhật assigned_bot_ids.');
          }
        }
      }
    } catch (err) {
      if (!isMissingSchemaError(err)) {
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
    const row = await this.resolveUserRow(username);
    if (row) {
      user = this.adapter && typeof this.adapter.mapDatabaseUser === 'function'
        ? this.adapter.mapDatabaseUser(row)
        : {
            ...row,
            userId: row.id || ('usr_' + row.username),
            assignedBotIds: Array.isArray(row.assigned_bot_ids) ? row.assigned_bot_ids.map(String) : [],
            isPermanent: Boolean(row.is_permanent),
            expiresAt: row.expires_at || null,
            planName: row.plan_name || 'Gói mặc định',
            allowAccountChange: row.allow_account_change !== false
          };
    }
    if (!user && this.adapter && typeof this.adapter.fetchUserAuthorization === 'function') {
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
  async registerTrialUser({ userId, username, password, trialDays = 1, planName = 'FREE TRIAL', registrationIp = null, deviceFingerprint = null, registrationUserAgent = null }) {
    this.invalidateCache();
    const cleanUsername = String(username || '').toLowerCase().trim();
    if (!cleanUsername) {
      throw new Error('Tên đăng nhập không hợp lệ.');
    }
    const safePassword = password
      ? ((String(password).startsWith('scrypt$') || isStoredCredentialCiphertext(password)) ? password : encryptUserPassword(password))
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
        if (!error && data?.ok) {
          const res = unwrapRpc(data);
          if (registrationIp || deviceFingerprint) {
            try {
              const { error: regError } = await this.client.from(USERS).update({
                registration_ip: registrationIp,
                device_fingerprint: deviceFingerprint,
                registration_user_agent: registrationUserAgent
              }).eq('username', cleanUsername);
              if (regError && !isMissingSchemaError(regError)) {
                if (typeof this.logger?.warn === 'function') {
                  this.logger.warn('Failed to update trial user registration anti-fraud telemetry', { error: regError.message || regError });
                }
              }
            } catch (regEx) {
              if (typeof this.logger?.warn === 'function') {
                this.logger.warn('Exception updating trial user registration anti-fraud telemetry', { error: regEx.message || regEx });
              }
            }
          }
          return res;
        }
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
          .select('worker_id, bot_number, enabled, settings')
          .order('bot_number');
        if (workersErr && !isMissingSchemaError(workersErr)) {
          throw workersErr instanceof Error ? workersErr : new Error(workersErr.message || 'Lỗi đọc danh sách Bot.');
        }
        if (Array.isArray(workers) && workers.length > 0) {
          candidateWorkers = workers.map((w) => ({
            workerId: String(w.worker_id),
            botNumber: w.bot_number || 1,
            enabled: Boolean(w.enabled),
            rentable: w.settings?.rentable !== false && w.settings?.rentable !== 'false'
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
          enabled: Boolean(w.enabled),
          rentable: w.settings?.rentable !== false && w.settings?.rentable !== 'false'
        }));
      }

      const excludedWorkers = new Set();
      let lastConflictError = null;

      while (true) {
        let freeWorkerId = null;
        let botNumber = 1;

        for (const w of candidateWorkers) {
          if (!w.enabled || !w.rentable || excludedWorkers.has(w.workerId)) continue;
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
          registrationIp: registrationIp || null,
          deviceFingerprint: deviceFingerprint || null,
          registrationUserAgent: registrationUserAgent || null,
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

  async recordUserLogin(identifier, clientIp) {
    if (!identifier || !clientIp) return;
    const cleanId = String(identifier).trim();
    const cleanIp = String(clientIp).trim();
    const nowIso = new Date().toISOString();
    this.invalidateUserCache(cleanId, cleanId);
    try {
      if (this.client) {
        const quotedId = quotePostgrestValue(cleanId);
        const quotedUsername = quotePostgrestValue(cleanId.toLowerCase());
        const { error } = await this.client.from(USERS).update({
          last_login_ip: cleanIp,
          last_login_at: nowIso
        }).or(`id.eq.${quotedId},username.eq.${quotedUsername}`);
        if (error && !isMissingSchemaError(error)) {
          if (this.logger?.warn) {
            this.logger.warn('Failed to update last_login_ip', { identifier: cleanId, ip: cleanIp, error: error.message });
          }
        }
      }
    } catch (err) {
      if (this.logger?.warn) {
        this.logger.warn('Exception updating last_login_ip', { identifier: cleanId, ip: cleanIp, error: err.message });
      }
    }
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

    // Resolve existing link first so we know BOTH Discord ID and Web userId/username
    const existingLink = await this.getDiscordLink(id).catch(() => null);
    const linkedDiscordId = String(existingLink?.discord_user_id || existingLink?.discordUserId || '').trim();
    const linkedManagerUserId = String(existingLink?.manager_user_id || existingLink?.managerUserId || '').trim();
    const linkedUsername = String(existingLink?.username || '').trim();

    const settingKeysToDelete = [...new Set(
      [id, linkedDiscordId, linkedManagerUserId, linkedUsername, linkedUsername.toLowerCase()]
        .filter(Boolean)
        .map((v) => `discord_link:${v}`)
    )];

    // 1. Try Supabase RPC (fail closed on real errors; fallback ONLY on missing RPC)
    if (typeof this.client?.rpc === 'function') {
      try {
        const { data, error } = await this.client.rpc('manager_unlink_discord_account', {
          p_identifier: id
        });
        if (!error && data?.ok) {
          // Also purge any fallback manager_settings keys so legacy step-3 lookup cannot resurrect unlinked Discord ID
          for (const settingKey of settingKeysToDelete) {
            try {
              await this.client.from(SETTINGS).delete().eq('key', settingKey);
            } catch (_) {}
          }
          return true;
        }
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
    const idCandidates = [...new Set([id, linkedDiscordId, linkedManagerUserId].filter(Boolean))];
    const userCandidates = [...new Set([id.toLowerCase(), linkedUsername.toLowerCase()].filter(Boolean))];
    const ops = [];
    for (const cand of idCandidates) {
      ops.push(() => this.client.from('manager_discord_links').delete().eq('discord_user_id', cand));
      ops.push(() => this.client.from('manager_discord_links').delete().eq('manager_user_id', cand));
      ops.push(() => this.client.from(USERS).update({ discord_user_id: null, updated_at: nowIso }).eq('discord_user_id', cand));
      ops.push(() => this.client.from(USERS).update({ discord_user_id: null, updated_at: nowIso }).eq('id', cand));
    }
    for (const uname of userCandidates) {
      ops.push(() => this.client.from('manager_discord_links').delete().eq('username', uname));
      ops.push(() => this.client.from(USERS).update({ discord_user_id: null, updated_at: nowIso }).eq('username', uname));
    }
    for (const settingKey of settingKeysToDelete) {
      ops.push(() => this.client.from(SETTINGS).delete().eq('key', settingKey));
    }
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
    const qId = quotePostgrestValue(id);
    const qLower = quotePostgrestValue(id.toLowerCase());

    // 1. Check manager_discord_links table
    try {
      const { data, error } = await this.client.from('manager_discord_links')
        .select('*')
        .or(`discord_user_id.eq.${qId},manager_user_id.eq.${qId},username.eq.${qLower}`)
        .eq('status', 'active')
        .maybeSingle();
      if (!error && data) return data;
    } catch (_) {}

    // 2. Check manager_users.discord_user_id
    try {
      const { data, error } = await this.client.from(USERS)
        .select('discord_user_id, username, id, updated_at')
        .or(`discord_user_id.eq.${qId},username.eq.${qLower},id.eq.${qId}`)
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
      let res = await this.client.from(USERS).select(USER_ACCESS_COLUMNS).eq('discord_user_id', dId).maybeSingle();
      if (res?.error && isMissingSchemaError(res.error)) {
        res = await this.client.from(USERS).select('*').eq('discord_user_id', dId).maybeSingle();
      }
      const data = res?.data;
      if (!res?.error && data) {
        const assignedIds = Array.isArray(data.assigned_bot_ids)
          ? data.assigned_bot_ids.map(String)
          : (typeof data.assigned_bot_ids === 'string' ? (() => { try { const a = JSON.parse(data.assigned_bot_ids || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } })().map(String) : []);
        const user = {
          id: data.id || ('usr_' + data.username),
          userId: data.id || data.username,
          username: data.username,
          role: data.role || 'user',
          status: data.status || 'active',
          isPermanent: Boolean(data.is_permanent),
          expiresAt: data.expires_at || null,
          planName: data.plan_name || 'Gói mặc định',
          note: data.note || '',
          allowAccountChange: data.allow_account_change !== false,
          lockReason: data.lock_reason || '',
          botCount: (data.bot_count !== undefined && data.bot_count !== null) ? Number(data.bot_count) : 1,
          botAliases: data.bot_aliases || {},
          assignedBotIds: assignedIds,
          workerIds: assignedIds,
          discordUserId: dId,
          createdAt: data.created_at,
          updatedAt: data.updated_at
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
      const ok = await this.adapter.insertKeys([{
        ...(record || {}),
        id: record?.id || row.id,
        keyId: record?.keyId || row.key_id
      }]);
      if (ok === false) {
        throw new Error('Không thể lưu mã kích hoạt mới vào Supabase (trùng mã hoặc lỗi ghi dữ liệu).');
      }
      return ok;
    }
    const { error } = await this.client.from(KEYS).insert(row);
    if (error) throw error;
  }

  async getKey(code) {
    const clean = String(code || '').trim();
    if (!clean) return null;
    const qCode = quotePostgrestValue(clean);
    const qUpper = quotePostgrestValue(clean.toUpperCase());
    if (this.client && typeof this.client.from === 'function') {
      try {
        const { data, error } = await this.client.from(KEYS).select('*')
          .or(`code_hash.eq.${qCode},code.eq.${qUpper},code.eq.${qCode},key_code.eq.${qUpper},id.eq.${qCode}`)
          .maybeSingle();
        if (!error && data) return mapFrom(data, KEY_FIELDS);
        if (error && (isMissingSchemaError(error) || error.code === '42703')) {
          // Try simpler columns if key_code does not exist on older table
          const fallback = await this.client.from(KEYS).select('*')
            .or(`code_hash.eq.${qCode},code.eq.${qUpper},id.eq.${qCode}`)
            .maybeSingle();
          if (!fallback.error && fallback.data) return mapFrom(fallback.data, KEY_FIELDS);
        }
      } catch (_) {}
    }
    if (this.adapter && typeof this.adapter.fetchKeys === 'function') {
      const keys = await this.adapter.fetchKeys();
      if (keys) {
        const found = keys.find((k) =>
          String(k.codeHash || k.code_hash || '').toLowerCase() === clean.toLowerCase() ||
          String(k.code || k.key || k.keyCode || '').toUpperCase() === clean.toUpperCase() ||
          String(k.id || k.keyId || '') === clean
        );
        if (found) return found;
      }
    }
    return null;
  }

  async listKeys(limit = 100) {
    if (this.client?.from) {
      const { data, error } = await this.client.from(KEYS).select('*').order('created_at', { ascending: false }).limit(limit);
      if (!error && Array.isArray(data)) {
        return data.map((row) => mapFrom(row, KEY_FIELDS));
      }
      if (error && (!this.adapter?.fetchKeys || !isMissingSchemaError(error))) throw error;
    }
    if (this.adapter && typeof this.adapter.fetchKeys === 'function') {
      const keys = await this.adapter.fetchKeys();
      if (keys) return keys.slice(0, limit);
    }
    return [];
  }

  async deleteKey(keyId) {
    this.invalidateCache();
    if (this.adapter && typeof this.adapter.deleteKey === 'function') {
      return await this.adapter.deleteKey(keyId);
    }
    const qId = quotePostgrestValue(String(keyId || '').trim());
    const { data, error } = await this.client.from(KEYS).delete().or(`id.eq.${qId},key_id.eq.${qId},code.eq.${qId}`).select('*');
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
      p_access_values: {
        ...mapTo(accessValues, ACCESS_FIELDS, ['userId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']),
        ...(Number.isFinite(Number(accessValues.addDays)) && Number(accessValues.addDays) > 0 ? { add_days: Math.floor(Number(accessValues.addDays)) } : {}),
        ...(Number.isFinite(Number(accessValues.durationMs)) && Number(accessValues.durationMs) > 0 ? { duration_ms: Math.floor(Number(accessValues.durationMs)) } : {})
      },
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
  async getSetting(key, { bypassCache = false } = {}) {
    const cacheKey = `setting:${key}`;
    if (!bypassCache) {
      const cached = this.getCachedEntry(cacheKey);
      if (cached.hit) return cached.data;
    }
    const { data, error } = await this.client.from(SETTINGS).select('value,updated_at').eq('key', key).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    let resolved = null;
    if (data) {
      if (Array.isArray(data.value)) resolved = data.value;
      else if (data.value && typeof data.value === 'object') resolved = { ...data.value, updatedAt: data.updated_at };
      else resolved = data.value ?? null;
    }
    this.setCached(cacheKey, resolved, 30000);
    return resolved;
  }

  async setSetting(key, value) {
    const { error } = await this.client.from(SETTINGS).upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    this.cache.delete(`setting:${key}`);
    if (key === 'system_maintenance') {
      this.cachedMaintenance = undefined;
      this.cachedMaintenanceAt = 0;
    } else if (key === 'system_announcement') {
      this.cachedAnnouncement = undefined;
      this.cachedAnnouncementAt = 0;
    }
    return this.getSetting(key, { bypassCache: true });
  }

  // --------------------------------------------------------------------------
  // OUTBOX QUEUE & PENDING ALLOCATIONS
  // --------------------------------------------------------------------------
  async enqueueOutbox(item) {
    if (this.adapter && typeof this.adapter.saveOutboxItem === 'function') {
      return await this.adapter.saveOutboxItem(item);
    }
    const rawBid = Number(item.botId ?? item.bot_id);
    const botIdInt = Number.isFinite(rawBid) ? Math.trunc(rawBid) : 0;
    const typeVal = String(item.type || item.taskType || 'auth_sync');
    const { data, error } = await this.client.from(OUTBOX).insert({
      id: item.id || crypto.randomUUID(),
      bot_id: botIdInt,
      type: typeVal,
      event_type: String(item.eventType || typeVal),
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
    const { error } = await this.client.from(OUTBOX).update({ status: 'dead_letter', error_code: errorCode, updated_at: new Date().toISOString() }).eq('id', id);
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
    const targetObj = (entry.target && typeof entry.target === 'object')
      ? entry.target
      : { raw: String(entry.target || entry.targetId || '').slice(0, 160) };
    const actionStr = String(entry.action || 'unknown').slice(0, 80);
    const inferredCategory = entry.category || (
      actionStr.startsWith('AUTH_') ? 'AUTH'
        : (actionStr.includes('BOT') || actionStr.includes('WORKER') ? 'BOT'
          : (actionStr.includes('USER') || actionStr.includes('KEY') ? 'USER' : 'SYSTEM'))
    );
    const logType = String(entry.logType || (inferredCategory === 'BOT' ? 'BOT' : 'SYSTEM')).toUpperCase();
    const actorUsername = entry.actor?.username || entry.actorId || 'system';
    const actorRole = entry.actor?.role || entry.actorRole || (String(actorUsername).toLowerCase() === 'admin' ? 'admin' : 'system');
    const actorIp = entry.actor?.ip || entry.actorIp || entry.details?.ip || '127.0.0.1';
    const nowIso = new Date().toISOString();

    if (this.adapter && typeof this.adapter.insertAuditLog === 'function') {
      return await this.adapter.insertAuditLog({
        id: auditId,
        logType,
        category: inferredCategory,
        actor: { username: actorUsername, role: actorRole, ip: actorIp },
        action: actionStr,
        actionLabel: entry.actionLabel || actionStr,
        target: targetObj,
        details: typeof entry.details === 'object' ? JSON.stringify(entry.details) : String(entry.details || ''),
        status: entry.status || 'SUCCESS',
        timestamp: nowIso
      });
    }
    const { error } = await this.client.from(AUDIT_LOGS).insert({
      id: auditId,
      log_type: logType,
      category: inferredCategory,
      actor_username: actorUsername,
      actor_role: actorRole,
      actor_ip: actorIp,
      action: actionStr,
      action_label: String(entry.actionLabel || actionStr).slice(0, 120),
      target: targetObj,
      details: typeof entry.details === 'object' ? JSON.stringify(entry.details) : String(entry.details || ''),
      status: entry.status || 'SUCCESS',
      timestamp: nowIso
    });
    if (error && error.code !== '42P01') throw error;
  }

  async listAudit(limitOrOpts = 100) {
    const opts = (limitOrOpts && typeof limitOrOpts === 'object') ? limitOrOpts : { limit: limitOrOpts };
    const limit = Math.max(1, Math.min(2000, Number(opts.limit) || 100));
    const parseAuditDetails = (val) => {
      if (!val) return null;
      if (typeof val === 'object') return val;
      try { return JSON.parse(val); } catch (_) { return val; }
    };
    const normalizeAuditRow = (e) => {
      const ts = e.timestamp || e.created_at || e.createdAt || null;
      const username = e.actor?.username || e.actor_username || e.actor_id || 'system';
      const role = e.actor?.role || e.actor_role || (String(username).toLowerCase() === 'admin' ? 'admin' : 'system');
      const detailsParsed = parseAuditDetails(e.details);
      const ip = e.actor?.ip || e.actor_ip || e.ip || (detailsParsed && typeof detailsParsed === 'object' ? detailsParsed.ip : null) || '127.0.0.1';
      const action = String(e.action || 'UNKNOWN');
      const category = String(e.category || (action.startsWith('AUTH_') ? 'AUTH' : (action.includes('BOT') || action.includes('WORKER') ? 'BOT' : 'SYSTEM'))).toUpperCase();
      const logType = String(e.logType || e.log_type || (category === 'BOT' ? 'BOT' : 'SYSTEM')).toUpperCase();
      return {
        id: e.id || null,
        logType,
        category,
        actorId: username,
        actor: { username, role, ip },
        action,
        actionLabel: e.actionLabel || e.action_label || action,
        target: e.target ?? '',
        details: detailsParsed,
        status: String(e.status || 'SUCCESS').toUpperCase(),
        timestamp: ts,
        createdAt: ts
      };
    };

    if (this.adapter && typeof this.adapter.fetchAuditLogs === 'function') {
      const res = await this.adapter.fetchAuditLogs({
        limit,
        page: opts.page,
        logType: opts.logType,
        category: opts.category,
        actor: opts.actor,
        search: opts.search
      });
      const rows = Array.isArray(res?.logs) ? res.logs : (Array.isArray(res?.entries) ? res.entries : null);
      if (rows) {
        return rows.map(normalizeAuditRow);
      }
    }
    let query = this.client.from(AUDIT_LOGS)
      .select('id,log_type,category,actor_username,actor_role,actor_ip,action,action_label,target,details,status,timestamp')
      .order('timestamp', { ascending: false })
      .limit(limit);
    let res = await query;
    if (res?.error && isMissingSchemaError(res.error)) {
      res = await this.client.from(AUDIT_LOGS)
        .select('id,actor_username,action,target,details,timestamp')
        .order('timestamp', { ascending: false })
        .limit(limit);
    }
    if (res?.error && res.error.code !== '42P01') throw res.error;
    return (res?.data || []).map(normalizeAuditRow);
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
    this.invalidateUserCache(userId, accessValues?.username || '');
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
