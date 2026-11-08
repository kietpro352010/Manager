'use strict';

const ACCESS = 'manager_access';
const ASSIGNMENTS = 'manager_worker_assignments';
const KEYS = 'manager_keys';
const AUDIT = 'manager_audit';
const SETTINGS = 'manager_settings';
const LINK_ATTEMPTS = 'manager_link4m_attempts';

const ACCESS_FIELDS = {
  userId: 'user_id', role: 'role', status: 'status', isPermanent: 'is_permanent', expiresAt: 'expires_at',
  planName: 'plan_name', note: 'note', username: 'username', createdAt: 'created_at', updatedAt: 'updated_at',
  createdBy: 'created_by', updatedBy: 'updated_by'
};
const KEY_FIELDS = {
  keyId: 'key_id', codeHash: 'code_hash', codeSuffix: 'code_suffix', status: 'status', days: 'days',
  isPermanent: 'is_permanent', botCount: 'bot_count', workerIds: 'worker_ids', planName: 'plan_name',
  maxUses: 'max_uses', usedCount: 'used_count', usedUsers: 'used_users', expiresAt: 'expires_at',
  createdBy: 'created_by', createdAt: 'created_at', lastUsedAt: 'last_used_at', lastUsedBy: 'last_used_by'
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

function unwrapRpc(data) { return Array.isArray(data) ? (data[0] || null) : data; }

class SupabaseDashboardStore {
  constructor(client) { this.client = client; }

  async initialize() {
    const checks = ['manager_schema_migrations', ACCESS, ASSIGNMENTS, KEYS, AUDIT, SETTINGS, LINK_ATTEMPTS];
    for (const table of checks) {
      const { error } = await this.client.from(table).select('*').limit(0);
      if (error) throw new Error(`Supabase table ${table} is unavailable: ${error.message}`);
    }
    const requiredVersions = [
      '20261107_manager_schema',
      '20261108000000_durable_worker_commands',
      '20261109000000_atomic_entitlement_rewards',
      '20261110000000_atomic_worker_settings',
      '20261111000000_worker_reset_data'
    ];
    const { data: versions, error: versionError } = await this.client.from('manager_schema_migrations').select('version');
    if (versionError) throw versionError;
    const applied = new Set((versions || []).map((row) => row.version));
    const missing = requiredVersions.filter((version) => !applied.has(version));
    if (missing.length) throw new Error(`Supabase manager migrations are missing: ${missing.join(', ')}. Run the SQL files in supabase/migrations in filename order.`);
    const auditCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const [{ error: auditError }, { error: attemptError }] = await Promise.all([
      this.client.from(AUDIT).delete().lt('created_at', auditCutoff),
      this.client.from(LINK_ATTEMPTS).delete().lt('purge_at', now)
    ]);
    if (auditError) throw auditError;
    if (attemptError) throw attemptError;
  }

  async assignedWorkerIds(userId) {
    const { data, error } = await this.client.from(ASSIGNMENTS).select('worker_id').eq('user_id', userId).order('assigned_at');
    if (error) throw error;
    return (data || []).map((row) => row.worker_id);
  }

  async replaceAssignments(userId, workerIds, actorId) {
    const access = await this.getAccess(userId);
    return this.setAccess(userId, { ...(access || { role: 'user', status: 'active', isPermanent: false }), workerIds }, actorId);
  }

  async getAccess(userId) {
    const { data, error } = await this.client.from(ACCESS).select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { ...mapFrom(data, ACCESS_FIELDS), workerIds: await this.assignedWorkerIds(userId) };
  }

  async listAccess() {
    const [{ data: users, error: usersError }, { data: assignments, error: assignmentsError }] = await Promise.all([
      this.client.from(ACCESS).select('*').order('updated_at', { ascending: false }),
      this.client.from(ASSIGNMENTS).select('user_id,worker_id').order('assigned_at')
    ]);
    if (usersError) throw usersError;
    if (assignmentsError) throw assignmentsError;
    const grouped = new Map();
    for (const row of assignments || []) grouped.set(row.user_id, [...(grouped.get(row.user_id) || []), row.worker_id]);
    return (users || []).map((row) => ({ ...mapFrom(row, ACCESS_FIELDS), workerIds: grouped.get(row.user_id) || [] }));
  }

  async setAccess(userId, values, actorId) {
    const { workerIds = [], ...fields } = values;
    const { data, error } = await this.client.rpc('manager_set_user_access', {
      p_user_id: userId, p_values: mapTo(fields, ACCESS_FIELDS, ['userId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']),
      p_worker_ids: [...new Set(workerIds)].map(String), p_actor_id: String(actorId || '')
    });
    if (error) throw error;
    return { ...mapFrom(unwrapRpc(data), ACCESS_FIELDS), workerIds: await this.assignedWorkerIds(userId) };
  }

  async removeAccess(userId) {
    const { data, error } = await this.client.from(ACCESS).delete().eq('user_id', userId).select('user_id');
    if (error) throw error;
    return Boolean(data?.length);
  }

  async assignedUser(workerId) {
    const { data, error } = await this.client.from(ASSIGNMENTS).select('worker_id,user_id,assigned_by,assigned_at').eq('worker_id', workerId).maybeSingle();
    if (error) throw error;
    return data ? { workerId: data.worker_id, userId: data.user_id, assignedBy: data.assigned_by, assignedAt: data.assigned_at } : null;
  }

  async removeWorkerAssignments(workerId) {
    const { error } = await this.client.from(ASSIGNMENTS).delete().eq('worker_id', workerId);
    if (error) throw error;
  }

  async createKey(record) {
    const { error } = await this.client.from(KEYS).insert(mapTo(record, KEY_FIELDS));
    if (error) throw error;
  }

  async getKey(codeHash) {
    const { data, error } = await this.client.from(KEYS).select('*').eq('code_hash', codeHash).maybeSingle();
    if (error) throw error;
    return mapFrom(data, KEY_FIELDS);
  }

  async listKeys(limit = 25) {
    const { data, error } = await this.client.from(KEYS).select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map((row) => {
      const key = mapFrom(row, KEY_FIELDS);
      delete key.codeHash;
      return key;
    });
  }

  async deleteKey(keyId) {
    const { data, error } = await this.client.from(KEYS).delete().eq('key_id', keyId).select('key_id');
    if (error) throw error;
    return Boolean(data?.length);
  }

  async consumeKey(codeHash, userId) {
    const { data, error } = await this.client.rpc('manager_consume_key', { p_code_hash: codeHash, p_user_id: userId });
    if (error) throw error;
    return mapFrom(unwrapRpc(data), KEY_FIELDS);
  }

  async redeemKeyWithAccess(codeHash, userId, values, actorId) {
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

  async releaseConsumedKey(codeHash, userId) {
    const { error } = await this.client.rpc('manager_release_consumed_key', { p_code_hash: codeHash, p_user_id: userId });
    if (error) throw error;
  }

  async addAudit(entry) {
    const { error } = await this.client.from(AUDIT).insert({
      actor_id: entry.actorId || null, action: String(entry.action || 'unknown').slice(0, 80),
      target: String(entry.target || '').slice(0, 160), details: entry.details || {}, created_at: new Date().toISOString()
    });
    if (error) throw error;
  }

  async listAudit(limit = 100) {
    const { data, error } = await this.client.from(AUDIT).select('actor_id,action,target,details,created_at').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data || []).map((row) => ({ actorId: row.actor_id, action: row.action, target: row.target, details: row.details, createdAt: row.created_at }));
  }

  async getSetting(key) {
    const { data, error } = await this.client.from(SETTINGS).select('value,updated_at').eq('key', key).maybeSingle();
    if (error) throw error;
    return data ? { ...(data.value || {}), updatedAt: data.updated_at } : null;
  }

  async setSetting(key, value) {
    const { error } = await this.client.from(SETTINGS).upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return this.getSetting(key);
  }

  async findActiveLinkAttempt(userId, now = new Date()) {
    const { data, error } = await this.client.from(LINK_ATTEMPTS).select('*').eq('user_id', userId).eq('status', 'pending')
      .gt('expires_at', now.toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return mapFrom(data, LINK_FIELDS);
  }

  async getLinkAttempt(attemptId) {
    const { data, error } = await this.client.from(LINK_ATTEMPTS).select('*').eq('attempt_id', attemptId).maybeSingle();
    if (error) throw error;
    return mapFrom(data, LINK_FIELDS);
  }

  async getLatestLinkAttempt(userId) {
    const { data, error } = await this.client.from(LINK_ATTEMPTS).select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
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
    if (error) throw error;
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
