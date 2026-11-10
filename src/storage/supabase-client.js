'use strict';

const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const {
  toKeyBuffer,
  encryptSecret,
  decryptSecret,
  encryptUserPassword,
  decryptUserPassword,
  isStoredCredentialCiphertext,
  isUnsupportedCredentialCiphertext,
  timingSafeStringEquals,
  safeEqual
} = require('../utils/secrets');
const { fetchWithRetry } = require('../utils/http');
const SUPABASE_SCHEMA_SQL = require('./schema-sql');

const SUPABASE_REQUIRED_TABLES = Object.freeze([
  'manager_users', 'manager_keys', 'bot_registry', 'manager_sessions', 'bot_settings',
  'audit_logs', 'bot_chat_logs', 'bot_event_logs', 'bot_position_state', 'bot_position_logs',
  'manager_backups', 'manager_locks', 'manager_key_usage_transactions', 'bot_log_clear_cutoffs',
  'manager_user_state', 'manager_users_write_transactions', 'manager_session_revocations',
  'manager_link4m_attempts', 'manager_outbox_queue', 'manager_pending_allocations',
  'manager_migration_entitlement_undo',
  'manager_workers', 'manager_commands'
]);

function normalizeManagerRole(role) {
  return String(role || '').trim().toLowerCase() === 'admin' ? 'admin' : 'user';
}

function normalizeMaxUses(value, fallback = 1) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const raw = Number(value);
  if (!Number.isSafeInteger(raw) || raw < 0) return null;
  return raw;
}

function getSupabaseKeyRole(key) {
  const k = String(key || '').trim();
  if (!k) return 'none';
  if (k.startsWith('sb_publishable_')) return 'anon';
  if (k.startsWith('sb_secret_')) return 'service';
  const parts = k.split('.');
  if (parts.length === 3 && parts.every((p) => p.length > 0)) {
    try {
      const decodeB64 = (segment) => JSON.parse(Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      const header = decodeB64(parts[0]);
      const payload = decodeB64(parts[1]);
      if (header?.alg && String(header.alg).includes('HS')) {
        const role = String(payload?.role || '').toLowerCase();
        const ref = String(payload?.ref || '').toLowerCase();
        if (role === 'service_role' || ref === 'service_role') return 'service';
        if (role === 'anon' || role === 'anon_key' || ref === 'anon') return 'anon';
        return 'unknown';
      }
    } catch (_) {}
  }
  return 'unknown';
}

function buildPostgrestIlikePattern(raw) {
  const safe = String(raw ?? '').replace(/["\\]/g, '').trim();
  if (!safe) return '';
  return '"*' + encodeURIComponent(safe) + '*"';
}

let localFencingTokenCounter = 100;
const localProcessLocks = new Map();
async function withLocalProcessLock(lockKey, fn) {
  const key = String(lockKey);
  const prevPromise = localProcessLocks.get(key) || Promise.resolve();
  let release;
  const nextPromise = new Promise((resolve) => { release = resolve; });
  const chainedPromise = prevPromise.then(() => nextPromise);
  localProcessLocks.set(key, chainedPromise);
  await prevPromise;
  const fencingToken = ++localFencingTokenCounter;
  const lockContext = {
    owner: 'local_' + process.pid + '_' + Date.now(),
    fencingToken,
    isLockValid: () => true,
    assertLockValid: () => {}
  };
  try {
    return await fn(lockContext);
  } finally {
    release();
    if (localProcessLocks.get(key) === chainedPromise) {
      localProcessLocks.delete(key);
    }
  }
}

class SupabaseAdapter {
    constructor(config = {}) {
        this.url = (config.url || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
        this.key = (config.key || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();
        this.enabled = !!(this.url && this.key);
        this.lastPingOk = false;
        this.lastPingError = '';
        this.lastMissingTables = [];
    }

    updateConfig(url, key) {
        this.url = (url || '').trim().replace(/\/+$/, '');
        this.key = (key || '').trim();
        this.enabled = !!(this.url && this.key);
        this.lastMissingTables = [];
    }

    isEnabled() {
        return !!(this.url && this.key);
    }

    getHeaders(extra = {}) {
        const headers = {
            'apikey': this.key,
            'Content-Type': 'application/json',
            ...extra
        };
        if (typeof this.key === 'string' && this.key.split('.').length === 3) {
            headers['Authorization'] = `Bearer ${this.key}`;
        }
        return headers;
    }

    async fetchWithRetry(url, options = {}, { maxRetries = 3, initialDelayMs = 400, maxDelayMs = 3000, timeoutMs = 15000 } = {}) {
        let attempt = 0;
        while (attempt < maxRetries) {
            attempt++;
            try {
                const signal = options.signal || AbortSignal.timeout(timeoutMs);
                const res = await fetch(url, { ...options, signal });
                if (attempt < maxRetries && [408, 429, 500, 502, 503, 504].includes(res.status)) {
                    const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 200);
                    console.warn(`[SUPABASE RETRY] HTTP ${res.status} khi gọi ${url.split('?')[0]}. Thử lại lần ${attempt}/${maxRetries} sau ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                return res;
            } catch (err) {
                const isAbort = err.name === 'AbortError' || err.name === 'TimeoutError' || /timeout|aborted/i.test(err.message);
                const isConnError = /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(err.message);
                if (attempt < maxRetries && (isAbort || isConnError)) {
                    const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 200);
                    console.warn(`[SUPABASE RETRY] Lỗi mạng (${err.message}) khi gọi ${url.split('?')[0]}. Thử lại lần ${attempt}/${maxRetries} sau ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                throw err;
            }
        }
    }

    async fetchAllRows(table, { order = '', pageSize = 1000, uniqueKey = '', select = '*' } = {}) {
        if (!this.isEnabled()) throw new Error('Supabase chưa được cấu hình.');
        if (!/^[a-z0-9_]+$/i.test(String(table || ''))) throw new Error('Tên bảng Supabase không hợp lệ.');
        const safePageSize = Math.max(1, Math.min(1000, Number(pageSize) || 1000));
        const rows = [];
        const seen = new Set();
        let offset = 0;
        let expectedTotal = null;
        for (let page = 0; page < 1000; page++) {
            const params = new URLSearchParams({
                select: String(select || '*'),
                limit: String(safePageSize),
                offset: String(offset)
            });
            if (order) params.set('order', order);
            const res = await this.fetchWithRetry(this.url + '/rest/v1/' + table + '?' + params.toString(), {
                headers: this.getHeaders({ Prefer: 'count=exact' })
            }, { timeoutMs: 15000 });
            if (!res.ok) throw new Error('Đọc ' + table + ' thất bại: HTTP ' + res.status + ' ' + await res.text().catch(() => ''));
            const data = await res.json();
            if (!Array.isArray(data)) throw new Error('Supabase trả payload ' + table + ' không phải array.');
            const contentRange = String(res.headers?.get?.('content-range') || '');
            const totalPart = contentRange.split('/')[1];
            const total = totalPart && totalPart !== '*' ? Number(totalPart) : NaN;
            if (expectedTotal === null && Number.isSafeInteger(total) && total >= 0) expectedTotal = total;
            if (page === 0 && expectedTotal === null) {
                throw new Error('Supabase không trả Content-Range hợp lệ khi đọc ' + table + '; không thể xác minh đã tải đủ dữ liệu.');
            }
            if (data.length === 0) break;
            for (const row of data) {
                if (uniqueKey) {
                    const key = String(row?.[uniqueKey] ?? '').trim();
                    if (key) {
                        if (seen.has(key)) throw new Error('Dữ liệu ' + table + ' bị trùng khóa ' + uniqueKey + '=' + key + '; không thể đọc đầy đủ.');
                        seen.add(key);
                    }
                }
                rows.push(row);
            }
            offset += data.length;
            // Do not stop early when rows reach the first-page count: a concurrent insert could
            // otherwise be silently omitted. Always read to the empty page, then compare totals.
        }
        if (expectedTotal !== null && rows.length !== expectedTotal) {
            throw new Error('Đọc ' + table + ' thiếu dữ liệu: nhận ' + rows.length + '/' + expectedTotal + ' bản ghi.');
        }
        return rows;
    }

    async withManagerLock(lockKey, fn, leaseSeconds = 900, options = {}) {
        if (typeof fn === 'object' && typeof leaseSeconds === 'function') {
            const temp = fn;
            fn = leaseSeconds;
            options = { ...options, ...temp };
            leaseSeconds = temp.leaseSeconds ?? temp.lease ?? 900;
        }
        if (options._localLockHeld !== true) {
            return await withLocalProcessLock(lockKey, () => this.withManagerLock(lockKey, fn, leaseSeconds, { ...options, _localLockHeld: true }));
        }
        const owner = crypto.randomUUID();
        const safeLeaseSeconds = Math.max(30, Math.min(3600, Number(leaseSeconds) || 900));
        const waitTimeoutMs = Math.max(0, Number(options.waitTimeoutMs ?? 15000));
        const deadline = Date.now() + waitTimeoutMs;

        const rpc = async (name, body) => {
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/rpc/${name}`, {
                method: 'POST', headers: this.getHeaders(), body: JSON.stringify(body)
            }, { timeoutMs: 8000, maxRetries: 2 });
            const text = await res.text().catch(() => '');
            if (!res.ok) throw new Error('Cloud lock RPC ' + name + ' thất bại (HTTP ' + res.status + '): ' + text.slice(0, 200));
            return text ? JSON.parse(text) : null;
        };

        let isAcquired = false;
        let fencingToken = 1;
        while (true) {
            const acquired = await rpc('acquire_manager_lock', { p_lock_key: String(lockKey), p_owner_id: owner, p_lease_seconds: safeLeaseSeconds });
            if (typeof acquired === 'object' && acquired !== null) {
                isAcquired = acquired.ok === true;
                if (acquired.fencing_token) fencingToken = Number(acquired.fencing_token);
            } else if (typeof acquired === 'number' && acquired > 0) {
                isAcquired = true;
                fencingToken = acquired;
            } else {
                isAcquired = acquired === true || (Array.isArray(acquired) && acquired[0] === true);
            }
            if (isAcquired) break;
            if (Date.now() >= deadline) {
                throw new Error('Tác vụ đang được Manager khác xử lý trên Cloud: ' + lockKey);
            }
            const jitterMs = 200 + Math.floor(Math.random() * 250);
            await new Promise(r => setTimeout(r, Math.min(jitterMs, Math.max(50, deadline - Date.now()))));
        }
        let renewalInFlight = null;
        let lockLostError = null;
        let lockLeaseUntil = Date.now() + safeLeaseSeconds * 1000;
        const renew = () => {
            if (renewalInFlight) return renewalInFlight;
            renewalInFlight = rpc('renew_manager_lock', {
                p_lock_key: String(lockKey), p_owner_id: owner, p_lease_seconds: safeLeaseSeconds
            }).then(result => {
                const renewed = result === true || (Array.isArray(result) && result[0] === true) || (typeof result === 'object' && result?.ok === true);
                if (!renewed) {
                    lockLostError = new Error('Lock Cloud đã hết hạn hoặc không còn thuộc Manager này.');
                    return false;
                }
                lockLeaseUntil = Date.now() + safeLeaseSeconds * 1000;
                return true;
            }).catch(err => {
                if (Date.now() >= lockLeaseUntil - 5000) lockLostError = err;
                console.error('[SUPABASE] Không gia hạn được lock ' + lockKey + ':', err.message);
                return false;
            }).finally(() => { renewalInFlight = null; });
            return renewalInFlight;
        };
        const heartbeat = setInterval(() => { void renew(); }, Math.max(5000, Math.min(30000, Math.floor(safeLeaseSeconds * 1000 / 3))));
        if (typeof heartbeat.unref === 'function') heartbeat.unref();
        // P1-04: Monotonic fencing token context truyền vào callback
        const lockContext = {
            owner,
            fencingToken,
            isLockValid: () => !lockLostError && Date.now() < lockLeaseUntil - 2000,
            assertLockValid: () => {
                if (lockLostError || Date.now() >= lockLeaseUntil - 2000) {
                    throw new Error('STALE_FENCING_TOKEN: Lock Cloud đã mất quyền sở hữu hoặc lease đã hết hạn: ' + (lockLostError?.message || lockKey));
                }
            }
        };
        try {
            const result = await fn(lockContext);
            if (lockLostError || Date.now() >= lockLeaseUntil - 2000) throw new Error('STALE_FENCING_TOKEN: Lock Cloud đã mất quyền sở hữu trong lúc chạy: ' + (lockLostError?.message || lockKey));
            return result;
        } finally {
            clearInterval(heartbeat);
            if (renewalInFlight) await renewalInFlight;
            try { await rpc('release_manager_lock', { p_lock_key: String(lockKey), p_owner_id: owner }); }
            catch (err) { console.error('[SUPABASE] Không nhả được lock ' + lockKey + '; lock sẽ tự hết hạn:', err.message); }
        }
    }

    async verifyLockFencing(lockKey, ownerId, fencingToken) {
        if (!this.isEnabled()) return true;
        try {
            const data = await this.callRpc('verify_manager_lock_fencing', {
                p_lock_key: String(lockKey),
                p_owner_id: String(ownerId),
                p_fencing_token: Number(fencingToken)
            });
            return data === true || (Array.isArray(data) && data[0] === true);
        } catch (_) {
            return false;
        }
    }

    async callRpc(name, body, timeoutMs = 10000) {
        if (!this.isEnabled() || !/^[a-z][a-z0-9_]*$/i.test(String(name || ''))) {
            throw new Error('Supabase RPC không hợp lệ hoặc chưa được cấu hình.');
        }
        const res = await this.fetchWithRetry(`${this.url}/rest/v1/rpc/${name}`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body || {})
        }, { timeoutMs, maxRetries: 3 });
        const text = await res.text().catch(() => '');
        if (!res.ok) {
            const error = new Error('Supabase RPC ' + name + ' thất bại (HTTP ' + res.status + ').');
            error.status = res.status;
            error.responseText = text.slice(0, 500);
            error.missingRpc = (res.status === 404 || res.status === 400) && /(?:PGRST202|function .* does not exist|could not find the function|schema cache)/i.test(text);
            throw error;
        }
        if (!text) return null;
        try { return JSON.parse(text); }
        catch (_) { throw new Error('Supabase RPC ' + name + ' trả JSON không hợp lệ.'); }
    }

    async testConnection() {
        if (!this.isEnabled()) return { ok: false, error: 'Chưa cấu hình Supabase URL hoặc API Key' };
        if (getSupabaseKeyRole(this.key) === 'anon') {
            const error = 'Cần dùng SUPABASE_SERVICE_ROLE_KEY (không dùng anon/publishable key) để lưu dữ liệu an toàn.';
            this.lastPingOk = false;
            this.lastPingError = error;
            return { ok: false, error };
        }
        try {
            // Bước 1: Đọc nhanh OpenAPI spec qua 1 HTTP request duy nhất để xác minh toàn bộ bảng và RPC (<600ms)
            let spec = null;
            let rpcSpecVerified = false;
            let rpcProbeError = '';
            let missingRpcs = [];
            let missingTables = [];

            try {
                const specRes = await this.fetchWithRetry(`${this.url}/rest/v1/`, {
                    headers: this.getHeaders()
                }, { timeoutMs: 8000, maxRetries: 2 });
                if (specRes.ok) {
                    spec = await specRes.json().catch(() => null);
                } else {
                    rpcProbeError = 'HTTP ' + specRes.status;
                }
            } catch (err) {
                rpcProbeError = err.message || String(err);
            }

            if (spec && typeof spec === 'object' && spec.paths && typeof spec.paths === 'object') {
                rpcSpecVerified = true;
                const paths = Object.keys(spec.paths);
                const normalizedPaths = paths.map(pathName => String(pathName).replace(/\/+$/, ''));
                const defs = new Set(Object.keys(spec.definitions || {}));
                const pathSet = new Set(normalizedPaths);

                // Kiểm tra 21 bảng bắt buộc qua definitions / paths trong spec
                missingTables = SUPABASE_REQUIRED_TABLES.filter(t => !defs.has(t) && !pathSet.has('/' + t));

                const requiredRpcs = [
                    '/rpc/record_bot_position_change', '/rpc/consume_manager_key_usage',
                    '/rpc/acquire_manager_lock', '/rpc/release_manager_lock', '/rpc/renew_manager_lock', '/rpc/verify_manager_lock_fencing',
                    '/rpc/read_manager_users_snapshot', '/rpc/save_manager_users_snapshot',
                    '/rpc/insert_manager_users_if_absent', '/rpc/redeem_manager_key_and_save_users',
                    '/rpc/read_manager_session', '/rpc/read_manager_authorization', '/rpc/create_manager_user_session', '/rpc/revoke_manager_session',
                    '/rpc/claim_manager_link4m_reward', '/rpc/start_manager_link4m_attempt',
                    '/rpc/patch_manager_registry', '/rpc/set_bot_log_clear_cutoff',
                    '/rpc/rollback_manager_link4m_attempt', '/rpc/update_manager_link4m_sync_status',
                    '/rpc/set_manager_link4m_short_url', '/rpc/claim_manager_outbox_batch', '/rpc/claim_manager_pending_allocations',
                    '/rpc/prune_manager_historical_data'
                ];
                missingRpcs = requiredRpcs.filter(r => !normalizedPaths.includes(r));
            } else {
                // Fallback: Khi không đọc được spec OpenAPI, kiểm tra bảng qua từng batch nhỏ 4 bảng (chống nghẽn socket/timeout)
                const batchSize = 4;
                const checks = [];
                for (let i = 0; i < SUPABASE_REQUIRED_TABLES.length; i += batchSize) {
                    const batch = SUPABASE_REQUIRED_TABLES.slice(i, i + batchSize);
                    const batchResults = await Promise.all(batch.map(async table => {
                        const res = await this.fetchWithRetry(`${this.url}/rest/v1/${table}?select=*&limit=1`, {
                            headers: this.getHeaders()
                        }, { timeoutMs: 6000, maxRetries: 2 });
                        return { table, ok: res.ok, status: res.status, text: res.ok ? '' : await res.text().catch(() => '') };
                    }));
                    checks.push(...batchResults);
                }
                const failed = checks.filter(item => !item.ok);
                missingTables = failed
                    .filter(item => item.status === 404 || /relation|schema cache|does not exist/i.test(item.text))
                    .map(item => item.table);
            }

            this.lastMissingTables = missingTables;

            if (missingTables.length > 0) {
                this.lastPingOk = false;
                const error = `Thiếu bảng Supabase: ${missingTables.join(', ')}. Hãy chạy SQL schema trong mục Supabase Cloud.`;
                this.lastPingError = error;
                return { ok: false, error, missingTables };
            }

            if (rpcSpecVerified && missingRpcs.length > 0) {
                this.lastPingOk = false;
                const error = 'Thiếu một hoặc nhiều RPC bắt buộc trên Supabase (' + missingRpcs.join(', ') + '). Hãy chạy các migration Supabase theo thứ tự trước khi bật Manager.';
                this.lastPingError = error;
                return { ok: false, error, missingRpc: true, rpcVerified: true, missingRpcs };
            } else if (!rpcSpecVerified) {
                this.lastPingOk = false;
                const error = `Chưa xác minh được RPC record_bot_position_change trên Supabase: ${rpcProbeError || 'không đọc được OpenAPI spec'}. Chưa thể kết luận RPC bị thiếu.`;
                this.lastPingError = error;
                return { ok: false, error, missingRpc: false, rpcVerified: false, rpcProbeError: rpcProbeError || 'OpenAPI spec không đọc được.' };
            }

            // Bước 2: Kiểm tra quyền đọc dữ liệu thực tế và schema cột trên manager_users
            const userColumns = await this.fetchWithRetry(`${this.url}/rest/v1/manager_users?select=id,username,allow_account_change,lock_reason,note&limit=0`, {
                headers: this.getHeaders()
            }, { timeoutMs: 6000, maxRetries: 2 });
            if (!userColumns.ok) {
                const error = 'Thiếu cột user allow_account_change/lock_reason/note. Hãy chạy migration 20261023_manager_user_transactions.sql.';
                this.lastPingOk = false;
                this.lastPingError = error;
                return { ok: false, error, missingColumns: true };
            }

            this.lastPingOk = true;
            this.lastPingError = '';
            return { ok: true, message: 'Kết nối Supabase Cloud thành công!', rpcVerified: true };
        } catch (err) {
            this.lastPingOk = false;
            this.lastMissingTables = [];
            this.lastPingError = err.message;
            return { ok: false, error: `Lỗi kết nối Supabase: ${err.message}` };
        }
    }

    // --- USERS ---
    async fetchUsers() {
        if (!this.isEnabled()) return null;
        try {
            const data = await this.fetchAllRows('manager_users', { order: 'username.asc', uniqueKey: 'username' });
            return data.map(u => this.mapDatabaseUser(u));
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải users:', err.message);
            return null;
        }
    }

    userToDatabaseRows(users) {
        return users.map(u => {
            let encPassword;
            if (!process.env.MANAGER_MASTER_KEY_PREVIOUS && u._rawEncryptedPassword && isStoredCredentialCiphertext(u._rawEncryptedPassword) && String(u.password ?? '') === u._decryptedPasswordSnapshot) {
                encPassword = u._rawEncryptedPassword;
            } else {
                encPassword = encryptUserPassword(String(u.password ?? ''));
            }
            return {
                id: String(u.id || ('usr_' + u.username)),
                username: String(u.username || ''),
                password: encPassword,
                role: String(u.role || 'user'),
                status: String(u.status || 'active'),
                assigned_bot_ids: Array.isArray(u.assignedBotIds) ? u.assignedBotIds : [],
                expires_at: u.expiresAt ? String(u.expiresAt) : null,
                is_permanent: Boolean(u.isPermanent === true || u.is_permanent === true || ((u.expiresAt === null || u.expiresAt === undefined) && (u.expires_at === null || u.expires_at === undefined) && String(u.status || 'active').toLowerCase() === 'active' && String(u.role || 'user').toLowerCase() !== 'admin')),
                plan_name: String(u.planName || 'Gói mặc định'),
                bot_aliases: (u.botAliases && typeof u.botAliases === 'object' && !Array.isArray(u.botAliases)) ? u.botAliases : {},
                allow_account_change: u.allowAccountChange !== false,
                lock_reason: String(u.lockReason || ''),
                note: String(u.note || ''),
                bot_count: Math.max(1, Number(u.botCount || (Array.isArray(u.assignedBotIds) && u.assignedBotIds.length ? u.assignedBotIds.length : 1))),
                created_at: u.createdAt || new Date().toISOString(),
                updated_at: u.updatedAt || new Date().toISOString()
            };
        });
    }

    mapDatabaseUser(u) {
        const encryptedPassword = String(u.password || '');
        const password = decryptUserPassword(encryptedPassword);
        if (encryptedPassword && isUnsupportedCredentialCiphertext(encryptedPassword)) {
            throw new Error('Mật khẩu cloud dùng định dạng mã hóa không được hỗ trợ: ' + encryptedPassword.slice(0, 12) + '…');
        }
        if (encryptedPassword && isStoredCredentialCiphertext(encryptedPassword) && password === null) {
            throw new Error('Không thể giải mã mật khẩu cloud. Hãy giữ nguyên MANAGER_MASTER_KEY khi deploy.');
        }
        const assignedArr = Array.isArray(u.assigned_bot_ids) ? u.assigned_bot_ids : [];
        const mapped = {
            id: u.id,
            username: u.username,
            password,
            role: u.role || 'user',
            status: u.status || 'active',
            assignedBotIds: assignedArr,
            botCount: Math.max(1, parseInt(u.bot_count ?? u.botCount, 10) || assignedArr.length || 1),
            expiresAt: u.expires_at || null,
            isPermanent: Boolean(u.is_permanent === true),
            planName: u.plan_name || 'Gói mặc định',
            botAliases: (u.bot_aliases && typeof u.bot_aliases === 'object') ? u.bot_aliases : {},
            allowAccountChange: u.allow_account_change !== false,
            lockReason: String(u.lock_reason || ''),
            note: String(u.note || ''),
            registeredIp: u.registered_ip || u.registeredIp || (typeof u.note === 'string' && u.note.match(/\[IP:\s*([^\]]+)\]/) ? u.note.match(/\[IP:\s*([^\]]+)\]/)[1].trim() : ''),
            createdIp: u.created_ip || u.createdIp || (typeof u.note === 'string' && u.note.match(/\[IP:\s*([^\]]+)\]/) ? u.note.match(/\[IP:\s*([^\]]+)\]/)[1].trim() : ''),
            createdAt: u.created_at,
            updatedAt: u.updated_at
        };
        Object.defineProperties(mapped, {
            _rawEncryptedPassword: { value: encryptedPassword, enumerable: false, writable: true },
            _decryptedPasswordSnapshot: { value: password, enumerable: false, writable: true }
        });
        return mapped;
    }

    async pruneHistoricalData() {
        if (!this.isEnabled()) return null;
        try {
            return await this.callRpc('prune_manager_historical_data', {});
        } catch (err) {
            console.warn('[SUPABASE] prune_manager_historical_data soft failure:', err.message);
            return null;
        }
    }

    async fetchUsersSnapshot() {
        if (!this.isEnabled()) return null;
        try {
            const data = await this.callRpc('read_manager_users_snapshot', {});
            const result = Array.isArray(data) ? data[0] : data;
            const revision = Number(result?.revision);
            if (result?.ok !== true || !Array.isArray(result.users) || !Number.isSafeInteger(revision) || revision < 1) return null;
            return { revision, users: result.users.map(row => this.mapDatabaseUser(row)) };
        } catch (err) {
            console.error('[SUPABASE] Không đọc được snapshot users phiên bản hóa:', err.message);
            return null;
        }
    }

    async fetchSessionByTokenHash(tokenHash) {
        if (!this.isEnabled() || !tokenHash) return { ok: false, error: 'Supabase session store chưa sẵn sàng.' };
        try {
            const data = await this.callRpc('read_manager_session', { p_token_hash: String(tokenHash) }, 5000);
            const result = Array.isArray(data) ? data[0] : data;
            if (result?.ok !== true) return { ok: false, error: 'Không thể xác minh session trên Supabase.' };
            const row = result.session;
            if (!row) return { ok: true, session: null };
            return { ok: true, session: {
                tokenHash: String(row.token_hash || ''), userId: String(row.user_id || ''),
                username: String(row.username || ''), role: String(row.role || 'user'),
                assignedBotIds: Array.isArray(row.assigned_bot_ids) ? row.assigned_bot_ids.map(Number) : [],
                expiresAt: Number(row.expires_at || 0), planName: String(row.plan_name || 'Gói thường'),
                allowAccountChange: row.allow_account_change !== false, status: String(row.status || 'active')
            } };
        } catch (err) {
            return { ok: false, error: err.message || 'Không thể xác minh session trên Supabase.' };
        }
    }

    async fetchManagerAuthorization(tokenHash) {
        if (!this.isEnabled() || !tokenHash) return { ok: false, error: 'Supabase session store chưa sẵn sàng.' };
        try {
            const data = await this.callRpc('read_manager_authorization', { p_token_hash: String(tokenHash) }, 6000);
            const result = Array.isArray(data) ? data[0] : data;
            if (result?.ok !== true) return { ok: false, error: 'Không thể xác minh phiên đăng nhập trên Supabase.' };
            const sessionRow = result.session;
            const userRow = result.user;
            return {
                ok: true,
                session: sessionRow ? {
                    tokenHash: String(sessionRow.token_hash || ''), userId: String(sessionRow.user_id || ''),
                    username: String(sessionRow.username || ''), role: normalizeManagerRole(sessionRow.role),
                    assignedBotIds: Array.isArray(sessionRow.assigned_bot_ids) ? sessionRow.assigned_bot_ids.map(Number) : [],
                    expiresAt: Number(sessionRow.expires_at || 0), planName: String(sessionRow.plan_name || 'Gói thường'),
                    allowAccountChange: sessionRow.allow_account_change !== false, status: String(sessionRow.status || 'active')
                } : null,
                user: userRow ? {
                    id: String(userRow.id || ''), username: String(userRow.username || ''), status: String(userRow.status || 'active'),
                    assignedBotIds: Array.isArray(userRow.assigned_bot_ids) ? userRow.assigned_bot_ids.map(Number) : [],
                    expiresAt: userRow.expires_at || null, planName: String(userRow.plan_name || 'Gói thường'),
                    isPermanent: Boolean(userRow.is_permanent === true || (!userRow.expires_at && String(userRow.status || 'active').toLowerCase() === 'active')),
                    allowAccountChange: userRow.allow_account_change !== false, lockReason: String(userRow.lock_reason || ''),
                    botCount: Math.max(1, parseInt(userRow.bot_count ?? userRow.botCount, 10) || (Array.isArray(userRow.assigned_bot_ids) ? userRow.assigned_bot_ids.length : 1))
                } : null
            };
        } catch (err) {
            return { ok: false, error: err.message || 'Không thể xác minh phiên đăng nhập trên Supabase.' };
        }
    }

    async fetchUserAuthorization(userId, username) {
        if (!this.isEnabled()) return { ok: false, error: 'Supabase users chưa sẵn sàng.' };
        try {
            const params = new URLSearchParams({
                select: 'id,username,status,assigned_bot_ids,expires_at,plan_name,allow_account_change,lock_reason,is_permanent,bot_count',
                limit: '2'
            });
            if (userId) params.set('id', 'eq.' + String(userId));
            else params.set('username', 'ilike.' + String(username || '').replace(/[(),]/g, ''));
            const res = await fetch(`${this.url}/rest/v1/manager_users?${params.toString()}`, {
                headers: this.getHeaders(), signal: AbortSignal.timeout(6000)
            });
            if (!res.ok) throw new Error('Đọc entitlement user thất bại (HTTP ' + res.status + ').');
            const rows = await res.json();
            if (!Array.isArray(rows) || rows.length > 1) throw new Error('Supabase trả entitlement user không hợp lệ hoặc trùng.');
            const row = rows[0];
            return { ok: true, user: row ? {
                id: String(row.id || ''), username: String(row.username || ''), status: String(row.status || 'active'),
                assignedBotIds: Array.isArray(row.assigned_bot_ids) ? row.assigned_bot_ids.map(Number) : [],
                expiresAt: row.expires_at || null, planName: String(row.plan_name || 'Gói thường'),
                isPermanent: Boolean(row.is_permanent === true || (!row.expires_at && String(row.status || 'active').toLowerCase() === 'active')),
                allowAccountChange: row.allow_account_change !== false, lockReason: String(row.lock_reason || ''),
                botCount: Math.max(1, parseInt(row.bot_count ?? row.botCount, 10) || (Array.isArray(row.assigned_bot_ids) ? row.assigned_bot_ids.length : 1))
            } : null };
        } catch (err) {
            return { ok: false, error: err.message || 'Không thể xác minh entitlement user trên Supabase.' };
        }
    }

    async reconcileUserSnapshotTransaction(transactionId, expectedRevision, rows) {
        try {
            const params = new URLSearchParams({
                select: 'transaction_id,expected_revision,users_payload,result',
                transaction_id: 'eq.' + String(transactionId), limit: '1'
            });
            const res = await fetch(`${this.url}/rest/v1/manager_users_write_transactions?${params.toString()}`, {
                headers: this.getHeaders(), signal: AbortSignal.timeout(6000)
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const records = await res.json();
            const row = Array.isArray(records) ? records[0] : null;
            if (row && Number(row.expected_revision) === Number(expectedRevision) && stableJson(row.users_payload) === stableJson(rows)) {
                const result = row.result;
                if (result?.ok === true) return result;
            }
            return { ok: false, uncertain: true, error: 'Không đối chiếu được kết quả ghi users; không retry bằng snapshot khác.' };
        } catch (err) {
            return { ok: false, uncertain: true, error: 'Không thể đối chiếu transaction users trên Cloud: ' + err.message };
        }
    }

    async saveUsersSnapshot(users, expectedRevision, { transactionId = crypto.randomUUID(), allowEmpty = false } = {}) {
        if (!this.isEnabled() || !Array.isArray(users) || !Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) < 1 || (!allowEmpty && users.length === 0)) {
            return { ok: false, error: 'INVALID_USER_SNAPSHOT' };
        }
        const rows = this.userToDatabaseRows(users);
        try {
            const data = await this.callRpc('save_manager_users_snapshot', {
                p_expected_revision: Number(expectedRevision), p_transaction_id: transactionId,
                p_users: rows, p_allow_empty: allowEmpty === true
            });
            const result = Array.isArray(data) ? data[0] : data;
            return result && typeof result === 'object' ? result : { ok: false, uncertain: true, error: 'Cloud trả kết quả ghi users không hợp lệ.' };
        } catch (err) {
            if (err.missingRpc) return { ok: false, missingRpc: true, error: 'Thiếu RPC save_manager_users_snapshot; hãy chạy migration 20261023_manager_user_transactions.sql.' };
            if (err.name === 'TimeoutError' || err.name === 'AbortError' || err.status >= 500) {
                return await this.reconcileUserSnapshotTransaction(transactionId, expectedRevision, rows);
            }
            return { ok: false, status: err.status || 503, error: err.message || 'Không lưu được users trên Supabase.' };
        }
    }

    async insertUsersIfAbsent(users) {
        if (!this.isEnabled() || !Array.isArray(users) || !users.length) return Array.isArray(users) && users.length === 0;
        const rows = this.userToDatabaseRows(users);
        try {
            const data = await this.callRpc('insert_manager_users_if_absent', { p_users: rows });
            const result = Array.isArray(data) ? data[0] : data;
            return result?.ok === true;
        } catch (err) {
            console.error('[SUPABASE] Không thể import users theo chế độ insert-only:', err.message);
            return false;
        }
    }

    async redeemKeyAndSaveUsersAtomic(code, username, users, expectedRevision, transactionId = crypto.randomUUID()) {
        if (!this.isEnabled() || !Array.isArray(users) || !Number.isSafeInteger(Number(expectedRevision))) {
            return { ok: false, error: 'INVALID_REDEMPTION_SNAPSHOT' };
        }
        const rows = this.userToDatabaseRows(users);
        const body = {
            p_code: String(code || '').trim().toUpperCase(), p_username: String(username || '').trim().toLowerCase(),
            p_transaction_id: transactionId, p_expected_revision: Number(expectedRevision), p_users: rows,
            p_allow_empty: false
        };
        const reconcile = async () => {
            try {
                const params = new URLSearchParams({
                    select: 'transaction_id,username,usage_snapshot,user_revision',
                    transaction_id: 'eq.' + transactionId, limit: '1'
                });
                const res = await fetch(`${this.url}/rest/v1/manager_key_usage_transactions?${params.toString()}`, {
                    headers: this.getHeaders(), signal: AbortSignal.timeout(6000)
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const records = await res.json();
                const row = Array.isArray(records) ? records[0] : null;
                if (row && String(row.username || '').toLowerCase() === body.p_username && row.usage_snapshot) {
                    return { ok: true, transactionId, row: row.usage_snapshot, userRevision: Number(row.user_revision), reconciled: true };
                }
                return { ok: false, uncertain: true, error: 'Giao dịch redeem chưa được xác nhận; không lặp lại với transaction ID mới.' };
            } catch (err) {
                return { ok: false, uncertain: true, error: 'Không thể đối chiếu giao dịch redeem trên Cloud: ' + err.message };
            }
        };
        try {
            const data = await this.callRpc('redeem_manager_key_and_save_users', body, 12000);
            const result = Array.isArray(data) ? data[0] : data;
            return result && typeof result === 'object' ? { ...result, transactionId } : { ok: false, uncertain: true, error: 'Cloud trả kết quả redeem không hợp lệ.' };
        } catch (err) {
            if (err.missingRpc) return { ok: false, missingRpc: true, error: 'Thiếu RPC redeem_manager_key_and_save_users; hãy chạy migration 20261023_manager_user_transactions.sql.' };
            if (err.name === 'TimeoutError' || err.name === 'AbortError' || err.status >= 500) return await reconcile();
            return { ok: false, status: err.status || 503, error: err.message || 'Không thể xác nhận giao dịch redeem.' };
        }
    }

    async syncAllUsers(users) {
        // Legacy import path is insert-only; it must never merge a stale full snapshot.
        return await this.insertUsersIfAbsent(users);
    }

    async deleteUser(userId) {
        const snapshot = await this.fetchUsersSnapshot();
        if (!snapshot) return false;
        const users = snapshot.users.filter(user => String(user.id || '') !== String(userId || ''));
        if (users.length === snapshot.users.length) return true;
        const result = await this.saveUsersSnapshot(users, snapshot.revision, { allowEmpty: users.length === 0 });
        return result.ok === true;
    }

    async replaceUsersSnapshot(users, { allowEmpty = false } = {}) {
        if (!this.isEnabled() || !Array.isArray(users) || (!allowEmpty && users.length === 0)) return false;
        const current = await this.fetchUsersSnapshot();
        if (!current) return false;
        const result = await this.saveUsersSnapshot(users, current.revision, { allowEmpty });
        return result.ok === true;
    }

    // --- KEYS ---
    async fetchKeys() {
        if (!this.isEnabled()) return null;
        try {
            const data = await this.fetchAllRows('manager_keys', { order: 'id.asc', uniqueKey: 'id' });
            return data.map(k => ({
                id: k.id,
                key: k.code || k.key,
                code: k.code || k.key,
                days: k.days,
                isPermanent: k.days === -1 || k.is_permanent === true,
                planName: k.plan_name,
                botIds: Array.isArray(k.bot_ids) ? k.bot_ids : [],
                botCount: k.bot_count !== undefined ? Number(k.bot_count) : (Array.isArray(k.bot_ids) && k.bot_ids.length ? k.bot_ids.length : 1),
                used: !!k.used,
                usedBy: k.used_by || null,
                usedAt: k.used_at || null,
                // Giữ đúng quy ước: 0 = không giới hạn. `Number(x) || 1` sẽ phá vỡ unlimited.
                maxUses: normalizeMaxUses(k.max_uses),
                usedCount: k.used_count !== undefined ? Number(k.used_count) : (k.used ? 1 : (k.used_by ? 1 : 0)),
                usedUsers: Array.isArray(k.used_users) ? k.used_users : (k.used_by ? k.used_by.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : []),
                expiresAt: k.expires_at || null,
                note: k.note || null,
                createdAt: k.created_at
            }));
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải keys:', err.message);
            return null;
        }
    }

    async insertKeys(keys) {
        if (!this.isEnabled() || !Array.isArray(keys) || !keys.length) return Array.isArray(keys) && keys.length === 0;
        if (keys.some(key => normalizeMaxUses(key?.maxUses) === null)) {
            console.error('[SUPABASE] Từ chối tạo key có maxUses âm hoặc không phải số nguyên.');
            return false;
        }
        const rows = keys.map(k => {
            const code = String(k.key || k.code || '').trim().toUpperCase();
            return {
                id: String(k.id || ('key_' + code)), code, key_code: code,
                days: Number(k.days || 1), plan_name: String(k.planName || 'Gói mặc định'),
                is_permanent: Boolean(k.isPermanent === true || k.days === -1),
                bot_ids: Array.isArray(k.botIds) ? k.botIds : [],
                bot_count: Number(k.botCount !== undefined ? k.botCount : (Array.isArray(k.botIds) && k.botIds.length ? k.botIds.length : 1)),
                used: Boolean(k.used), used_by: k.usedBy ? String(k.usedBy) : null,
                used_at: k.usedAt ? String(k.usedAt) : null, max_uses: normalizeMaxUses(k.maxUses),
                used_count: Number(k.usedCount || 0), used_users: Array.isArray(k.usedUsers) ? k.usedUsers : [],
                expires_at: k.expiresAt || null, note: k.note ? String(k.note) : null,
                ...(k.createdAt ? { created_at: k.createdAt } : {})
            };
        });
        try {
            const res = await fetch(`${this.url}/rest/v1/manager_keys?on_conflict=id`, {
                method: 'POST',
                headers: this.getHeaders({ Prefer: 'resolution=ignore-duplicates,return=representation' }),
                body: JSON.stringify(rows), signal: AbortSignal.timeout(10000)
            });
            if (!res.ok) {
                console.error('[SUPABASE] Lỗi insert-only keys:', 'HTTP ' + res.status + ': ' + await res.text().catch(() => ''));
                return false;
            }
            const inserted = await res.json().catch(() => []);
            const insertedIds = new Set(Array.isArray(inserted) ? inserted.map(row => String(row.id)) : []);
            if (insertedIds.size !== rows.length || rows.some(row => !insertedIds.has(row.id))) {
                // Do not report a partial batch as success; remove only rows returned by this insert.
                for (const id of insertedIds) await this.deleteKey(id);
                return false;
            }
            return true;
        } catch (err) {
            console.error('[SUPABASE] Lỗi insert-only keys:', err.message);
            return false;
        }
    }

    // Legacy imports and snapshot restore may adjust key metadata, but never usage counters.
    async updateKeysMetadata(keys) {
        if (!this.isEnabled() || !Array.isArray(keys)) return false;
        if (keys.some(key => normalizeMaxUses(key?.maxUses) === null)) return false;
        if (!keys.length) return true;
        try {
            for (const k of keys) {
                const code = String(k.key || k.code || '').trim().toUpperCase();
                const id = String(k.id || ('key_' + code));
                const res = await fetch(`${this.url}/rest/v1/manager_keys?id=eq.${encodeURIComponent(id)}`, {
                    method: 'PATCH',
                    headers: this.getHeaders({ Prefer: 'return=minimal' }),
                    body: JSON.stringify({
                        days: Number(k.days || 1), plan_name: String(k.planName || 'Gói mặc định'),
                        is_permanent: Boolean(k.isPermanent === true || k.days === -1),
                        bot_ids: Array.isArray(k.botIds) ? k.botIds : [],
                        bot_count: Number(k.botCount !== undefined ? k.botCount : (Array.isArray(k.botIds) && k.botIds.length ? k.botIds.length : 1)),
                        max_uses: normalizeMaxUses(k.maxUses), expires_at: k.expiresAt || null,
                        note: k.note ? String(k.note) : null
                    }),
                    signal: AbortSignal.timeout(10000)
                });
                if (!res.ok) {
                    console.error('[SUPABASE] Lỗi cập nhật metadata key ' + code + ' (schema migration cần thiết):', 'HTTP ' + res.status + ': ' + await res.text().catch(() => ''));
                    return false;
                }
            }
            return true;
        } catch (err) {
            console.error('[SUPABASE] Lỗi cập nhật metadata keys:', err.message);
            return false;
        }
    }

    // Kept for import callers; duplicate IDs/codes are ignored and existing rows are never overwritten.
    async syncAllKeys(keys) { return this.insertKeys(keys); }

    // Nguyên tố hóa việc tiêu thụ giftcode:
    // PATCH có điều kiện `used_count=eq.<expected>` là compare-and-swap một lệnh SQL,
    // nên 2 instance Manager hoặc 2 request song song không thể cùng tiêu thụ lượt cuối.
    // Trả về:
    //   true        : CAS thành công (lượt đã được trừ nguyên tố trên Cloud)
    //   'conflict'  : HTTP 200 nhưng 0 dòng khớp -> ai đó đã tiêu thụ trước
    //   false       : HTTP lỗi/không đọc được số dòng -> lỗi hạ tầng
    //   null        : bảng chưa có cột CAS hoặc lỗi không xác định -> caller dùng fallback
    async consumeKeyUsageAtomic(code, username) {
        if (!this.isEnabled()) return { ok: false, error: 'Supabase chưa sẵn sàng.' };
        const normalizedCode = String(code || '').trim().toUpperCase();
        const normalizedUser = String(username || '').trim().toLowerCase();
        const transactionId = crypto.randomUUID();
        const reconcile = async () => {
            try {
                const check = await fetch(`${this.url}/rest/v1/manager_key_usage_transactions?transaction_id=eq.${encodeURIComponent(transactionId)}&select=transaction_id,username,usage_snapshot`, {
                    headers: this.getHeaders(), signal: AbortSignal.timeout(8000)
                });
                if (!check.ok) throw new Error('HTTP ' + check.status);
                const rows = await check.json();
                const transaction = Array.isArray(rows) ? rows.find(row => row.transaction_id === transactionId) : null;
                if (transaction && String(transaction.username).toLowerCase() === normalizedUser && transaction.usage_snapshot && typeof transaction.usage_snapshot === 'object') {
                    return { ok: true, reconciled: true, transactionId, row: transaction.usage_snapshot };
                }
                return { ok: false, uncertain: true, error: 'CAS timeout; Cloud chưa xác nhận được transaction ID nên giao dịch bị dừng an toàn.' };
            } catch (err) {
                return { ok: false, uncertain: true, error: 'CAS timeout và không thể đối chiếu transaction ID trên Cloud: ' + err.message };
            }
        };
        try {
            const res = await fetch(`${this.url}/rest/v1/rpc/consume_manager_key_usage`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ p_code: normalizedCode, p_username: normalizedUser, p_transaction_id: transactionId }),
                signal: AbortSignal.timeout(10000)
            });
            const text = await res.text().catch(() => '');
            if (!res.ok) {
                const missingRpc = (res.status === 404 || res.status === 400) && /(?:PGRST202|function .* does not exist|could not find the function|consume_manager_key_usage)/i.test(text);
                if (!missingRpc && (res.status >= 500 || res.status === 408)) return await reconcile();
                return { ok: false, missingRpc, uncertain: !missingRpc && (res.status >= 500 || res.status === 408), error: 'Không xác nhận được CAS tiêu thụ Key (HTTP ' + res.status + '): ' + text.slice(0, 300) };
            }
            const data = text ? JSON.parse(text) : null;
            const result = Array.isArray(data) ? data[0] : data;
            if (!result || typeof result !== 'object') return { ok: false, uncertain: true, error: 'Supabase trả phản hồi CAS không hợp lệ.' };
            return result.ok === true ? { ...result, transactionId } : result;
        } catch (err) {
            const reconciled = await reconcile();
            return reconciled.ok || !reconciled.uncertain ? reconciled : { ...reconciled, error: 'Trạng thái CAS không xác định: ' + err.message + '. ' + reconciled.error };
        }
    }

    async deleteKey(keyId) {
        if (!this.isEnabled() || !keyId) return false;
        try {
            const raw = String(keyId).trim();
            const id = raw.startsWith('key_') ? raw : ('key_' + raw);
            const res = await fetch(`${this.url}/rest/v1/manager_keys?or=(id.eq.${encodeURIComponent(id)},code.eq.${encodeURIComponent(raw)})`, {
                method: 'DELETE',
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(5000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi xóa key:', err.message);
            return false;
        }
    }

    async replaceKeysSnapshot(keys, { allowEmpty = false } = {}) {
        if (!this.isEnabled() || !Array.isArray(keys) || (!allowEmpty && keys.length === 0)) return false;
        const current = await this.fetchKeys();
        if (!Array.isArray(current)) return false;
        const currentById = new Map(current.map(key => [String(key.id || '').toLowerCase(), key]));
        const currentByCode = new Map(current.map(key => [normalizeKeyCode(key), key]));
        const newKeys = [];
        const existingKeys = [];
        const keep = new Set();
        for (const key of keys) {
            const id = String(key?.id || ('key_' + (key?.key || key?.code || ''))).toLowerCase();
            const match = currentById.get(id) || currentByCode.get(normalizeKeyCode(key));
            if (match) {
                existingKeys.push({ ...key, id: match.id });
                keep.add(String(match.id).toLowerCase());
            } else {
                newKeys.push(key);
                keep.add(id);
            }
        }
        if (newKeys.length && !(await this.insertKeys(newKeys))) return false;
        if (existingKeys.length && !(await this.updateKeysMetadata(existingKeys))) return false;
        for (const key of current) {
            const id = String(key?.id || '');
            if (id && !keep.has(id.toLowerCase()) && !(await this.deleteKey(id))) return false;
        }
        return true;
    }

    async clearUsers() {
        const snapshot = await this.fetchUsersSnapshot();
        if (!snapshot) return false;
        const result = await this.saveUsersSnapshot([], snapshot.revision, { allowEmpty: true });
        return result.ok === true;
    }

    async clearKeys() {
        if (!this.isEnabled()) return false;
        try {
            const res = await fetch(`${this.url}/rest/v1/manager_keys`, {
                method: 'DELETE',
                headers: this.getHeaders({ Prefer: 'return=minimal' }),
                signal: AbortSignal.timeout(10000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi xóa toàn bộ keys:', err.message);
            return false;
        }
    }

    // --- REGISTRY ---
    async fetchRegistry() {
        if (!this.isEnabled()) return null;
        try {
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/bot_registry?id=eq.default&select=*`, {
                headers: this.getHeaders()
            }, { timeoutMs: 12000, maxRetries: 3 });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                const registryData = data[0].data;
                if (!registryData || typeof registryData !== 'object') return null;
                const restored = { ...registryData };
                restored.botRentalDisabled = normalizeBotRentalDisabled(registryData.botRentalDisabled);
                restored.pendingAllocations = Array.isArray(registryData.pendingAllocations) ? registryData.pendingAllocations : [];
                restored.registeredIps = (registryData.registeredIps && typeof registryData.registeredIps === 'object') ? registryData.registeredIps : {};
                if (Array.isArray(restored.dynamicBots)) {
                    restored.dynamicBots = restored.dynamicBots.map(b => {
                        if (b && b.secretKey && isStoredCredentialCiphertext(String(b.secretKey))) {
                            const plain = decryptUserPassword(String(b.secretKey));
                            return { ...b, secretKey: plain !== null ? plain : b.secretKey };
                        }
                        return b;
                    });
                }
                if (restored.systemSettings && typeof restored.systemSettings === 'object') {
                    const sys = { ...restored.systemSettings };
                    for (const field of ['link4mApiToken', 'link4mSecretKey']) {
                        const stored = String(sys[field] || '');
                        if (stored && isStoredCredentialCiphertext(stored)) {
                            const plain = decryptUserPassword(stored);
                            if (plain !== null) sys[field] = plain;
                        }
                    }
                    restored.systemSettings = sys;
                }
                if (registryData.webhook && typeof registryData.webhook === 'object') {
                    const webhook = { ...registryData.webhook };
                    let legacyMaskedSecret = false;
                    for (const field of ['discordUrl', 'telegramToken']) {
                        const stored = String(webhook[field] || '');
                        if (stored === '[CONFIGURED]') {
                            legacyMaskedSecret = true;
                            if (registry?.webhook?.[field] && registry.webhook[field] !== '[CONFIGURED]') {
                                webhook[field] = registry.webhook[field];
                            } else {
                                delete webhook[field];
                            }
                            continue;
                        }
                        if (isUnsupportedCredentialCiphertext(stored)) {
                            throw new Error('Webhook cloud dùng định dạng mã hóa không được hỗ trợ: ' + stored.slice(0, 12) + '…');
                        }
                        if (isStoredCredentialCiphertext(stored)) {
                            const plain = decryptUserPassword(stored);
                            if (plain === null) {
                                throw new Error('Không thể giải mã webhook cloud. Hãy giữ nguyên MANAGER_MASTER_KEY khi deploy.');
                            }
                            webhook[field] = plain;
                        }
                    }
                    if (legacyMaskedSecret) webhook._legacyMaskedSecrets = true;
                    restored.webhook = webhook;
                }
                return restored;
            }
            return {};
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải registry:', err.message);
            return null;
        }
    }

    async saveRegistry(payload) {
        if (!this.isEnabled()) return false;
        try {
            const encryptedDynamicBots = (payload.dynamicBots || []).map(b => {
                const item = { ...b };
                if (item.secretKey) {
                    const str = String(item.secretKey);
                    item.secretKey = isStoredCredentialCiphertext(str) ? str : encryptUserPassword(str);
                }
                return item;
            });
            const encryptedSystemSettings = payload.systemSettings ? {
                ...payload.systemSettings,
                link4mApiToken: (payload.systemSettings.link4mApiToken)
                    ? (isStoredCredentialCiphertext(String(payload.systemSettings.link4mApiToken)) ? String(payload.systemSettings.link4mApiToken) : encryptUserPassword(String(payload.systemSettings.link4mApiToken)))
                    : '',
                link4mSecretKey: (payload.systemSettings.link4mSecretKey)
                    ? (isStoredCredentialCiphertext(String(payload.systemSettings.link4mSecretKey)) ? String(payload.systemSettings.link4mSecretKey) : encryptUserPassword(String(payload.systemSettings.link4mSecretKey)))
                    : ''
            } : {};
            const dataToSave = {
                adminPassword: payload.adminPassword,
                dynamicBots: encryptedDynamicBots,
                disabledEnvUrls: payload.disabledEnvUrls || [],
                disabledEnvIds: payload.disabledEnvIds || [],
                overrides: payload.overrides || [],
                orderUrls: payload.orderUrls || [],
                order: payload.order || [],
                botIdMap: payload.botIdMap || {},
                botAliases: payload.botAliases || {},
                botTags: payload.botTags || {},
                // BUG-03 (Wave A recheck §6.1-3): đường full-save cũng persist per-bot secret
                // (đã mã hóa at-rest qua cùng serializer với patchRegistry).
                botSecrets: serializeBotSecretsForCloud(
                    (payload.botSecrets && typeof payload.botSecrets === 'object' && !Array.isArray(payload.botSecrets))
                        ? payload.botSecrets
                        : registry.botSecrets
                ),
                botRentalDisabled: normalizeBotRentalDisabled(payload.botRentalDisabled),
                systemSettings: encryptedSystemSettings,
                lastBotId: payload.lastBotId || 0,
                pendingResets: (payload.pendingResets && typeof payload.pendingResets === 'object' && !Array.isArray(payload.pendingResets))
                    ? payload.pendingResets
                    : {},
                pendingAllocations: (payload.pendingAllocations && Array.isArray(payload.pendingAllocations))
                    ? payload.pendingAllocations
                    : (Array.isArray(registry.pendingAllocations) ? registry.pendingAllocations : []),
                outboxQueue: (payload.outboxQueue && Array.isArray(payload.outboxQueue))
                    ? payload.outboxQueue
                    : (Array.isArray(registry.outboxQueue) ? registry.outboxQueue : []),
                mustChangePassword: payload.mustChangePassword === true,
                supabase: payload.supabase ? {
                    url: payload.supabase.url || '',
                    enabled: !!payload.supabase.enabled
                } : null,
                webhook: payload.webhook ? {
                    enabled: !!payload.webhook.enabled,
                    discordUrl: (payload.webhook.discordUrl && payload.webhook.discordUrl !== '[CONFIGURED]') ? (isStoredCredentialCiphertext(String(payload.webhook.discordUrl)) ? String(payload.webhook.discordUrl) : encryptUserPassword(String(payload.webhook.discordUrl))) : '',
                    telegramToken: (payload.webhook.telegramToken && payload.webhook.telegramToken !== '[CONFIGURED]') ? (isStoredCredentialCiphertext(String(payload.webhook.telegramToken)) ? String(payload.webhook.telegramToken) : encryptUserPassword(String(payload.webhook.telegramToken))) : '',
                    telegramChatId: String(payload.webhook.telegramChatId || ''),
                    notifyOnOffline: payload.webhook.notifyOnOffline !== false,
                    notifyOnLowTotem: payload.webhook.notifyOnLowTotem !== false,
                    notifyOnLowHealth: payload.webhook.notifyOnLowHealth !== false,
                    notifyOnDeath: payload.webhook.notifyOnDeath !== false,
                    notifyOnRecover: payload.webhook.notifyOnRecover !== false,
                    offlineThresholdMinutes: payload.webhook.offlineThresholdMinutes || 5
                } : {},
                announcement: payload.announcement || {}
            };
            const pendingResets = dataToSave.pendingResets;
            // BUG-05 (Wave B0): RPC patch_manager_registry UPSERT per-key — entry đã xóa
            // trong RAM sẽ HỒI SINH từ Cloud nếu không truyền p_pending_reset_deletes
            // (saveRegistryUnlocked đã diff baseline đúng cách; đường full-save này trước
            // giờ truyền [] nên checkpoint 'completed' cứ sống lại sau mỗi sync).
            const baselineResetsForDelete = (registryCloudBaseline && registryCloudBaseline.pendingResets && typeof registryCloudBaseline.pendingResets === 'object' && !Array.isArray(registryCloudBaseline.pendingResets))
                ? registryCloudBaseline.pendingResets
                : {};
            const pendingResetDeletes = Object.keys(baselineResetsForDelete)
                .filter(k => !Object.prototype.hasOwnProperty.call(pendingResets, k));
            return await this.patchRegistry(dataToSave, pendingResets, pendingResetDeletes, { webhookEncrypted: true });
        } catch (err) {
            console.error('[SUPABASE] Lỗi lưu registry:', err.message);
            return false;
        }
    }

    async patchRegistry(patch = {}, pendingResetPatch = {}, pendingResetDeletes = [], { webhookEncrypted = false } = {}) {
        if (!this.isEnabled()) return false;
        try {
            const safePatch = { ...patch };
            delete safePatch.pendingResets;
            if (safePatch.dynamicBots && Array.isArray(safePatch.dynamicBots)) {
                safePatch.dynamicBots = safePatch.dynamicBots.map(b => {
                    const item = { ...b };
                    if (item.secretKey) {
                        const str = String(item.secretKey);
                        item.secretKey = isStoredCredentialCiphertext(str) ? str : encryptUserPassword(str);
                    }
                    return item;
                });
            }
            if (safePatch.systemSettings && typeof safePatch.systemSettings === 'object') {
                const sys = { ...safePatch.systemSettings };
                for (const field of ['link4mApiToken', 'link4mSecretKey']) {
                    const val = String(sys[field] || '');
                    if (val && !isStoredCredentialCiphertext(val)) {
                        sys[field] = encryptUserPassword(val);
                    }
                }
                safePatch.systemSettings = sys;
            }
            if (safePatch.webhook && typeof safePatch.webhook === 'object') {
                safePatch.webhook = { ...safePatch.webhook };
                if (!webhookEncrypted) for (const field of ['discordUrl', 'telegramToken']) {
                    if (safePatch.webhook[field]) safePatch.webhook[field] = encryptUserPassword(String(safePatch.webhook[field]));
                }
            }
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/rpc/patch_manager_registry`, {
                method: 'POST', headers: this.getHeaders(),
                body: JSON.stringify({
                    p_patch: safePatch,
                    p_pending_reset_patch: pendingResetPatch,
                    p_pending_reset_deletes: pendingResetDeletes
                })
            }, { timeoutMs: 12000, maxRetries: 3 });
            if (!res.ok) {
                console.error('[SUPABASE] Lỗi cập nhật registry theo patch:', 'HTTP ' + res.status + ': ' + await res.text().catch(() => ''));
                return false;
            }
            const result = await res.json().catch(() => null);
            return result?.ok === true || (Array.isArray(result) && result[0]?.ok === true);
        } catch (err) {
            console.error('[SUPABASE] Lỗi cập nhật registry theo patch:', err.message);
            return false;
        }
    }

    // --- SESSIONS ---
    async fetchSessions() {
        if (!this.isEnabled()) return null;
        try {
            const data = await this.fetchAllRows('manager_sessions', { order: 'token_hash.asc', uniqueKey: 'token_hash' });
            return data.map(r => ({
                tokenHash: r.token_hash,
                userId: r.user_id,
                username: r.username,
                role: normalizeManagerRole(r.role),
                assignedBotIds: Array.isArray(r.assigned_bot_ids) ? r.assigned_bot_ids : [],
                expiresAt: Number(r.expires_at) || 0,
                planName: r.plan_name || 'Gói thường',
                allowAccountChange: r.allow_account_change !== false,
                status: r.status || 'active'
            }));
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải sessions:', err.message);
            return null;
        }
    }

    async createManagerUserSession(session, expectedUserRevision) {
        if (!this.isEnabled()) {
            return { ok: true };
        }
        if (!session || !Number.isSafeInteger(Number(expectedUserRevision)) || Number(expectedUserRevision) < 1) {
            return { ok: false, error: 'INVALID_SESSION_TRANSACTION' };
        }
        const row = {
            token_hash: String(session.tokenHash || ''), user_id: String(session.userId || ''),
            username: String(session.username || ''), role: 'user',
            assigned_bot_ids: Array.isArray(session.assignedBotIds) ? session.assignedBotIds : [],
            expires_at: Number(session.expiresAt), plan_name: String(session.planName || 'Gói thường'),
            allow_account_change: session.allowAccountChange !== false, status: String(session.status || 'active'),
            updated_at: new Date().toISOString()
        };
        try {
            const data = await this.callRpc('create_manager_user_session', {
                p_expected_revision: Number(expectedUserRevision), p_session: row
            }, 12000);
            const result = Array.isArray(data) ? data[0] : data;
            return result && typeof result === 'object' ? result : { ok: false, error: 'INVALID_SESSION_RESPONSE' };
        } catch (err) {
            return { ok: false, status: err.status || 503, error: err.message || 'Không lưu được session user trên Supabase.' };
        }
    }

    async syncAllSessions(sessionsMap) {
        if (!this.isEnabled()) return false;
        try {
            const now = Date.now();
            const rows = [];
            const entries = sessionsMap instanceof Map ? sessionsMap.entries() : Object.entries(sessionsMap || {});
            for (const [tokenHash, s] of entries) {
                if (s && s.expiresAt > now) {
                    rows.push({
                        token_hash: s.tokenHash || tokenHash,
                        user_id: s.userId || '',
                        username: s.username || '',
                        role: s.role || 'user',
                        assigned_bot_ids: Array.isArray(s.assignedBotIds) ? s.assignedBotIds : [],
                        expires_at: Number(s.expiresAt),
                        plan_name: s.planName || 'Gói thường',
                        allow_account_change: s.allowAccountChange !== false,
                        status: s.status || 'active',
                        updated_at: new Date().toISOString()
                    });
                }
            }
            if (rows.length === 0) return true;
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_sessions`, {
                method: 'POST',
                headers: this.getHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
                body: JSON.stringify(rows)
            }, { timeoutMs: 12000, maxRetries: 3 });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi đồng bộ sessions:', err.message);
            return false;
        }
    }

    async deleteSession(tokenHash) {
        invalidateAuthCache(tokenHash);
        if (!this.isEnabled() || !tokenHash) return false;
        try {
            const data = await this.callRpc('revoke_manager_session', { p_token_hash: String(tokenHash) }, 5000);
            return data === true || (Array.isArray(data) && data[0] === true);
        } catch (err) {
            console.error('[SUPABASE] Lỗi thu hồi session trên Cloud:', err.message);
            return false;
        }
    }

    // --- LINK4M REWARDS ---
    async startLink4mAttempt(attemptId, tokenHash, username, vietnamDate, dailyLimit, rewardHours, ipAddress, providerRef) {
        if (!this.isEnabled()) return { ok: false, error: 'SUPABASE_DISABLED' };
        try {
            const data = await this.callRpc('start_manager_link4m_attempt', {
                p_attempt_id: String(attemptId),
                p_token_hash: String(tokenHash),
                p_username: String(username).toLowerCase(),
                p_vietnam_date: String(vietnamDate),
                p_daily_limit: parseInt(dailyLimit, 10) || 2,
                p_reward_hours: parseInt(rewardHours, 10) || 12,
                p_ip_address: String(ipAddress || ''),
                p_provider_reference: String(providerRef || '')
            }, 8000);
            return data && typeof data === 'object' ? data : { ok: false, error: 'INVALID_RPC_RESPONSE' };
        } catch (err) {
            console.error('[SUPABASE] Lỗi gọi start_manager_link4m_attempt:', err.message);
            return { ok: false, error: 'RPC_FAILED', message: err.message };
        }
    }

    async rollbackLink4mAttempt(attemptId) {
        if (!this.isEnabled() || !attemptId) return false;
        try {
            const res = await this.callRpc('rollback_manager_link4m_attempt', {
                p_attempt_id: String(attemptId)
            }, 5000);
            return res === true || (Array.isArray(res) && res[0] === true);
        } catch (err) {
            console.error('[SUPABASE] Lỗi rollbackLink4mAttempt:', err.message);
            return false;
        }
    }

    async updateLink4mSyncStatus(attemptId, syncStatus) {
        if (!this.isEnabled() || !attemptId) return false;
        try {
            const res = await this.callRpc('update_manager_link4m_sync_status', {
                p_attempt_id: String(attemptId),
                p_sync_status: String(syncStatus)
            }, 5000);
            return res === true || (Array.isArray(res) && res[0] === true);
        } catch (err) {
            console.error('[SUPABASE] Lỗi updateLink4mSyncStatus:', err.message);
            return false;
        }
    }

    // NEW-01 (Wave B1): persist URL rút gọn provider sau khi createRewardLink thành công.
    // Fail mềm (false) — reuse lần sau sẽ sinh lại shortlink cho cùng attemptId,
    // không tiêu thêm hạn mức. Không log URL để tránh lộ token trong link.
    async setLink4mShortUrl(attemptId, shortUrl) {
        if (!this.isEnabled() || !attemptId || !shortUrl) return false;
        try {
            const res = await this.callRpc('set_manager_link4m_short_url', {
                p_attempt_id: String(attemptId),
                p_short_url: String(shortUrl)
            }, 5000);
            return res === true || (Array.isArray(res) && res[0] === true);
        } catch (err) {
            console.error('[SUPABASE] Lỗi setLink4mShortUrl:', err.message);
            return false;
        }
    }
    async saveLink4mAttempt(attempt) {
        if (!this.isEnabled() || !attempt) return false;
        try {
            const payload = {
                attempt_id: attempt.attemptId,
                username: String(attempt.username || '').toLowerCase(),
                token_hash: attempt.tokenHash,
                status: attempt.status || 'pending',
                vietnam_date: attempt.vietnamDate,
                created_at: attempt.createdAt || new Date().toISOString(),
                expires_at: attempt.expiresAt,
                verified_at: attempt.verifiedAt || null,
                rewarded_at: attempt.rewardedAt || null,
                reward_hours: attempt.rewardHours || 12,
                ip_address: attempt.ipAddress || '',
                provider_reference: attempt.providerReference || '',
                failure_reason: attempt.failureReason || ''
            };
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_link4m_attempts`, {
                method: 'POST',
                headers: this.getHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
                body: JSON.stringify(payload)
            }, { timeoutMs: 5000, maxRetries: 2 });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi lưu manager_link4m_attempts:', err.message);
            return false;
        }
    }

    async fetchLink4mDailyUsage(username, vietnamDate) {
        if (!this.isEnabled() || !username || !vietnamDate) return { ok: true, count: 0 };
        try {
            const params = new URLSearchParams({
                username: `eq.${String(username).toLowerCase()}`,
                vietnam_date: `eq.${vietnamDate}`,
                status: 'eq.rewarded',
                select: 'attempt_id'
            });
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_link4m_attempts?${params.toString()}`, {
                headers: this.getHeaders()
            }, { timeoutMs: 5000, maxRetries: 2 });
            if (!res.ok) return { ok: false, count: 0, error: `HTTP ${res.status}` };
            const rows = await res.json();
            return { ok: true, count: Array.isArray(rows) ? rows.length : 0 };
        } catch (err) {
            console.error('[SUPABASE] Lỗi đọc daily usage Link4M:', err.message);
            return { ok: false, count: 0, error: err.message };
        }
    }

    async fetchLink4mLastRewarded(username) {
        if (!this.isEnabled() || !username) return null;
        try {
            const params = new URLSearchParams({
                username: `eq.${String(username).toLowerCase()}`,
                status: 'eq.rewarded',
                order: 'rewarded_at.desc.nullslast',
                limit: '1',
                select: 'attempt_id,rewarded_at,created_at'
            });
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_link4m_attempts?${params.toString()}`, {
                headers: this.getHeaders()
            }, { timeoutMs: 5000, maxRetries: 2 });
            if (!res.ok) return null;
            const rows = await res.json();
            return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        } catch (err) {
            console.error('[SUPABASE] Lỗi đọc last rewarded Link4M:', err.message);
            return null;
        }
    }

    async fetchLink4mActiveAttempt(username) {
        if (!this.isEnabled() || !username) return { ok: true, attempt: null };
        try {
            const nowIso = new Date().toISOString();
            const params = new URLSearchParams({
                username: `eq.${String(username).toLowerCase()}`,
                status: 'eq.pending',
                expires_at: `gt.${nowIso}`,
                order: 'created_at.desc',
                limit: '1',
                select: '*'
            });
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_link4m_attempts?${params.toString()}`, {
                headers: this.getHeaders()
            }, { timeoutMs: 5000, maxRetries: 2 });
            if (!res.ok) return { ok: false, attempt: null, error: `HTTP ${res.status}` };
            const rows = await res.json();
            return { ok: true, attempt: Array.isArray(rows) && rows.length > 0 ? rows[0] : null };
        } catch (err) {
            console.error('[SUPABASE] Lỗi đọc active attempt Link4M:', err.message);
            return { ok: false, attempt: null, error: err.message };
        }
    }

    async claimLink4mReward(attemptId, tokenHash, username, rewardHours = 12, providerRef = '') {
        if (!this.isEnabled()) return { ok: false, error: 'SUPABASE_DISABLED' };
        try {
            const data = await this.callRpc('claim_manager_link4m_reward', {
                p_attempt_id: String(attemptId),
                p_token_hash: String(tokenHash),
                p_username: String(username).toLowerCase(),
                p_reward_hours: parseInt(rewardHours, 10) || 12,
                p_provider_reference: String(providerRef || '')
            }, 8000);
            return data && typeof data === 'object' ? data : { ok: false, error: 'INVALID_RPC_RESPONSE' };
        } catch (err) {
            console.error('[SUPABASE] Lỗi gọi claim_manager_link4m_reward:', err.message);
            return { ok: false, error: 'RPC_FAILED', message: err.message };
        }
    }

    // --- BOT SETTINGS ---
    async fetchBotSettings(botId) {
        return this.fetchBotSettingsStrict(botId);
    }

    async fetchBotSettingsStrict(botId) {
        const stableId = String(botId || '').trim();
        if (!this.isEnabled() || !/^[1-9][0-9]{0,8}$/.test(stableId)) throw new Error('BOT_ID không hợp lệ hoặc Supabase chưa cấu hình.');
        const res = await this.fetchWithRetry(this.url + '/rest/v1/bot_settings?bot_id=eq.' + encodeURIComponent(stableId) + '&select=*', {
            headers: this.getHeaders()
        }, { timeoutMs: 8000, maxRetries: 3 });
        if (!res.ok) throw new Error('Đọc bot_settings #' + stableId + ' thất bại: HTTP ' + res.status + ' ' + await res.text().catch(() => ''));
        const rows = await res.json();
        if (!Array.isArray(rows)) throw new Error('Supabase trả payload bot_settings không phải array.');
        const row = rows[0] || null;
        if (row && typeof row === 'object') {
            if (Array.isArray(row.bot_schedules) && !Array.isArray(row.schedules)) {
                row.schedules = row.bot_schedules;
            } else if (Array.isArray(row.schedules) && !Array.isArray(row.bot_schedules)) {
                row.bot_schedules = row.schedules;
            }
        }
        return row;
    }

    async fetchAllBotSettings() {
        if (!this.isEnabled()) return null;
        try {
            return await this.fetchAllRows('bot_settings', { order: 'bot_id.asc', uniqueKey: 'bot_id' });
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải toàn bộ bot_settings:', err.message);
            return null;
        }
    }

    async saveBotSettings(botId, payload = {}) {
        const stableId = String(botId || '').trim();
        if (!this.isEnabled() || !/^[1-9][0-9]{0,8}$/.test(stableId)) return false;
        try {
            const existing = await this.fetchBotSettingsStrict(stableId); // null = NOT_FOUND; thrown error = READ_ERROR.
            const clearCredentials = payload.clearCredentials === true || payload.clearPassword === true;
            const clearProxyPassword = payload.clearCredentials === true || payload.clearProxyPassword === true;
            const suppliedPassword = Object.prototype.hasOwnProperty.call(payload, 'password') ? String(payload.password ?? '') : '';
            const incomingSettings = payload.settings && typeof payload.settings === 'object' ? { ...payload.settings } : null;
            const incomingProxy = payload.proxy && typeof payload.proxy === 'object'
                ? { ...payload.proxy }
                : (incomingSettings?.proxy && typeof incomingSettings.proxy === 'object' ? { ...incomingSettings.proxy } : null);
            const storedPassword = String(existing?.password || '');
            let password = clearCredentials ? '' : storedPassword;
            if (!clearCredentials && suppliedPassword.trim() !== '' && suppliedPassword !== '********') {
                password = isStoredCredentialCiphertext(suppliedPassword) ? suppliedPassword : encryptUserPassword(suppliedPassword);
                if (!password) throw new Error('Không tạo được ciphertext cho password bot.');
            }
            const existingProxy = existing?.proxy && typeof existing.proxy === 'object' && Object.keys(existing.proxy).length
                ? existing.proxy
                : (existing?.settings?.proxy && typeof existing.settings.proxy === 'object' ? existing.settings.proxy : {});
            const proxy = incomingProxy ? { ...existingProxy, ...incomingProxy } : { ...existingProxy };
            const incomingProxyPassword = incomingProxy ? String(incomingProxy.password ?? '') : '';
            if (clearProxyPassword) proxy.password = '';
            else if (!incomingProxy || incomingProxyPassword === '' || incomingProxyPassword === '********') {
                proxy.password = String(existingProxy.password || '');
            } else {
                proxy.password = isStoredCredentialCiphertext(incomingProxyPassword)
                    ? incomingProxyPassword
                    : encryptUserPassword(incomingProxyPassword);
                if (!proxy.password) throw new Error('Không tạo được ciphertext cho password Proxy.');
            }
            const settings = incomingSettings || (existing?.settings && typeof existing.settings === 'object' ? { ...existing.settings } : {});
            if (settings.proxy && typeof settings.proxy === 'object') settings.proxy = { ...settings.proxy, password: proxy.password };
            else if (incomingProxy) settings.proxy = { ...proxy };
            const schedulesData = payload.botSchedules ?? payload.bot_schedules ?? payload.schedules ?? existing?.bot_schedules ?? existing?.schedules ?? [];
            const row = {
                bot_id: stableId,
                username: clearCredentials ? '' : (payload.username !== undefined && String(payload.username).trim() ? String(payload.username).trim() : (existing?.username || '')),
                password,
                settings,
                proxy,
                schedules: schedulesData,
                bot_schedules: schedulesData,
                auto_chat: payload.autoChatSchedules ?? payload.auto_chat ?? existing?.auto_chat ?? [],
                synced_auth: payload.syncedAuth && typeof payload.syncedAuth === 'object'
                    ? payload.syncedAuth
                    : (existing?.synced_auth && typeof existing.synced_auth === 'object' ? existing.synced_auth : {}),
                manually_stopped: payload.manuallyStopped ?? settings.manuallyStopped ?? existing?.manually_stopped ?? false,
                updated_at: new Date().toISOString()
            };
            const res = await this.fetchWithRetry(this.url + '/rest/v1/bot_settings?on_conflict=bot_id', {
                method: 'POST',
                headers: this.getHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
                body: JSON.stringify([row])
            }, { timeoutMs: 10000, maxRetries: 3 });
            if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + await res.text().catch(() => ''));
            const confirmed = await this.fetchBotSettingsStrict(stableId);
            const expSched = stableJson(schedulesData);
            const confSched = stableJson(confirmed?.bot_schedules || confirmed?.schedules || []);
            if (!confirmed || String(confirmed.bot_id) !== stableId || String(confirmed.password || '') !== password || String(confirmed.username || '') !== row.username ||
                stableJson(confirmed.proxy || {}) !== stableJson(proxy) || stableJson(confirmed.settings || {}) !== stableJson(settings) ||
                confSched !== expSched || stableJson(confirmed.auto_chat || []) !== stableJson(row.auto_chat) ||
                stableJson(confirmed.synced_auth || {}) !== stableJson(row.synced_auth) ||
                Boolean(confirmed.manually_stopped) !== Boolean(row.manually_stopped)) {
                throw new Error('Dữ liệu bot_settings sau khi lưu không khớp payload đã gửi.');
            }
            return true;
        } catch (err) {
            console.error('[SUPABASE] Lỗi lưu bot_settings:', err.message);
            return false;
        }
    }

    async fetchBotLogs(botId, kind = 'event', { limit = 100, page = 1 } = {}) {
        const stableId = String(botId || '').trim();
        if (!this.isEnabled() || !/^[1-9][0-9]{0,8}$/.test(stableId)) return null;
        const table = kind === 'chat' ? 'bot_chat_logs' : 'bot_event_logs';
        const safeLimit = readPositiveInt(limit, 100, 1, 500);
        const safePage = readPositiveInt(page, 1, 1, 1000000);
        const offset = (safePage - 1) * safeLimit;
        try {
            const res = await fetch(this.url + '/rest/v1/' + table + '?bot_id=eq.' + encodeURIComponent(stableId) + '&select=*&order=created_at.desc&limit=' + safeLimit + '&offset=' + offset, {
                headers: this.getHeaders({ Prefer: 'count=exact' }), signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + await res.text().catch(() => ''));
            const rows = await res.json();
            const range = res.headers.get('content-range') || '';
            const total = Number(range.split('/')[1]) || rows.length;
            return { rows: Array.isArray(rows) ? rows : [], total, page: safePage, limit: safeLimit };
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải log bot:', err.message);
            return null;
        }
    }

    async fetchBotPositionLogs(botId, { limit = 20, page = 1 } = {}) {
        const stableId = String(botId || '').trim();
        if (!this.isEnabled() || !/^[1-9][0-9]{0,8}$/.test(stableId)) return null;
        const safeLimit = readPositiveInt(limit, 20, 1, 100);
        const safePage = readPositiveInt(page, 1, 1, 1000000);
        const offset = (safePage - 1) * safeLimit;
        try {
            const res = await fetch(this.url + '/rest/v1/bot_position_logs?bot_id=eq.' + encodeURIComponent(stableId) + '&select=id,bot_id,changed_at,from_position,to_position,from_dimension,to_dimension,location_state,reason&order=changed_at.desc&limit=' + safeLimit + '&offset=' + offset, {
                headers: this.getHeaders({ Prefer: 'count=exact' }), signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + await res.text().catch(() => ''));
            const rows = await res.json();
            const range = res.headers.get('content-range') || '';
            const total = Number(range.split('/')[1]) || rows.length;
            return { rows: Array.isArray(rows) ? rows : [], total, page: safePage, limit: safeLimit };
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải lịch sử tọa độ:', err.message);
            return null;
        }
    }

    async setBotLogClearCutoff(botId, kind = 'event', createdBefore = null) {
        const stableId = String(botId || '').trim();
        const cutoffMs = Date.parse(createdBefore || '');
        if (!this.isEnabled() || !/^[1-9][0-9]{0,8}$/.test(stableId) || !Number.isFinite(cutoffMs)) return { ok: false, error: 'BOT_ID hoặc cutoff không hợp lệ.' };
        try {
            const res = await fetch(`${this.url}/rest/v1/rpc/set_bot_log_clear_cutoff`, {
                method: 'POST', headers: this.getHeaders(),
                body: JSON.stringify({ p_bot_id: stableId, p_kind: kind === 'chat' ? 'chat' : 'event', p_cutoff: new Date(cutoffMs).toISOString() }),
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + await res.text().catch(() => ''));
            const result = await res.json().catch(() => null);
            const data = Array.isArray(result) ? result[0] : result;
            if (data?.ok !== true) throw new Error(data?.error || 'Cutoff log chưa được xác nhận trên Cloud.');
            return { ok: true, cutoff: data.cutoff || new Date(cutoffMs).toISOString() };
        } catch (err) {
            return { ok: false, error: 'Không lưu được cutoff log bền vững (cần chạy migration mới): ' + err.message };
        }
    }

    async clearBotLogs(botId, kind = 'event', createdBefore = null) {
        const stableId = String(botId || '').trim();
        if (!this.isEnabled() || !/^[1-9][0-9]{0,8}$/.test(stableId)) return { ok: false, error: 'BOT_ID không hợp lệ hoặc Supabase chưa cấu hình.' };
        const table = kind === 'chat' ? 'bot_chat_logs' : 'bot_event_logs';
        const cutoff = createdBefore ? Date.parse(createdBefore) : NaN;
        try {
            if (!Number.isFinite(cutoff)) return { ok: false, error: 'Thiếu cutoff hợp lệ; từ chối xóa log để tránh xóa log mới.' };
            const tombstone = await this.setBotLogClearCutoff(stableId, kind, new Date(cutoff).toISOString());
            if (!tombstone.ok) return tombstone;
            const effectiveCutoff = new Date(Date.parse(tombstone.cutoff || cutoff)).toISOString();
            const cutoffQuery = '&created_at=lt.' + encodeURIComponent(effectiveCutoff);
            const res = await fetch(this.url + '/rest/v1/' + table + '?bot_id=eq.' + encodeURIComponent(stableId) + cutoffQuery, {
                method: 'DELETE', headers: this.getHeaders({ Prefer: 'count=exact,return=minimal' }), signal: AbortSignal.timeout(10000)
            });
            if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + await res.text().catch(() => ''));
            const range = res.headers.get('content-range') || '';
            return { ok: true, deleted: Number(range.split('/')[1]) || 0, cutoff: effectiveCutoff };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    async recordBotPositionChange({ botId, position, dimension, locationState, reason = 'MOVE', eventKey, id, changedAt }) {
        const stableId = String(botId || '').trim();
        if (!this.isEnabled() || !/^[1-9][0-9]{0,8}$/.test(stableId)) return { ok: false, error: 'BOT_ID không hợp lệ hoặc Supabase chưa cấu hình.' };
        const key = String(eventKey || crypto.randomUUID());
        const body = { p_id: id || crypto.randomUUID(), p_bot_id: stableId, p_changed_at: changedAt || new Date().toISOString(), p_to_position: position, p_to_dimension: dimension, p_location_state: locationState || 'Unknown', p_reason: reason, p_event_key: key, p_min_distance: 5.0 };
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const res = await fetch(this.url + '/rest/v1/rpc/record_bot_position_change', {
                    method: 'POST', headers: this.getHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(8000)
                });
                if (!res.ok) {
                    const errText = await res.text().catch(() => '');
                    if (res.status === 404 || /function.*does not exist|rpc.*not found/i.test(errText)) {
                        return { ok: false, error: 'RPC record_bot_position_change chưa được tạo trong schema Supabase; vị trí bot không được lưu.', missingRpc: true };
                    }
                    throw new Error('HTTP ' + res.status + ': ' + errText);
                }
                const result = await res.json().catch(() => ({}));
                return { ok: true, result };
            } catch (err) {
                if (attempt === 1) return { ok: false, error: err.message };
            }
        }
        return { ok: false, error: 'Không thể ghi lịch sử tọa độ.' };
    }

    async deleteBotSettings(botId) {
        if (!this.isEnabled() || !botId) return false;
        try {
            const res = await fetch(`${this.url}/rest/v1/bot_settings?bot_id=eq.${encodeURIComponent(String(botId))}`, {
                method: 'DELETE',
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(5000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi xóa bot_settings trên cloud:', err.message);
            return false;
        }
    }

    async replaceBotSettingsSnapshot(settingsByBot, { allowEmpty = false } = {}) {
        if (!this.isEnabled() || !settingsByBot || typeof settingsByBot !== 'object' || Array.isArray(settingsByBot) || (!allowEmpty && Object.keys(settingsByBot).length === 0)) return false;
        const current = await this.fetchAllBotSettings();
        if (!Array.isArray(current)) return false;
        const ids = Object.keys(settingsByBot);
        for (const id of ids) {
            const row = settingsByBot[id];
            if (!/^[1-9][0-9]{0,8}$/.test(id) || !row || (row.bot_id && String(row.bot_id) !== id) ||
                !(await this.restoreBotSettingsRow({ ...row, bot_id: id }))) return false;
        }
        const keep = new Set(ids);
        for (const row of current) {
            const id = String(row?.bot_id || '');
            if (id && !keep.has(id) && !(await this.deleteBotSettings(id))) return false;
        }
        return true;
    }

    async restoreBotSettingsRow(row) {
        if (!this.isEnabled() || !row?.bot_id) return false;
        try {
            const schedulesData = Array.isArray(row.bot_schedules) ? row.bot_schedules : (Array.isArray(row.schedules) ? row.schedules : []);
            const restoredRow = {
                bot_id: String(row.bot_id),
                username: String(row.username || ''),
                password: String(row.password || ''),
                settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
                proxy: row.proxy && typeof row.proxy === 'object' ? row.proxy : {},
                schedules: schedulesData,
                bot_schedules: schedulesData,
                auto_chat: Array.isArray(row.auto_chat) ? row.auto_chat : [],
                manually_stopped: row.manually_stopped === true,
                synced_auth: row.synced_auth && typeof row.synced_auth === 'object' ? row.synced_auth : {},
                updated_at: row.updated_at || new Date().toISOString()
            };
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/bot_settings?on_conflict=bot_id`, {
                method: 'POST',
                headers: this.getHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
                body: JSON.stringify([restoredRow])
            }, { timeoutMs: 10000, maxRetries: 3 });
            if (!res.ok) return false;
            const confirmed = await this.fetchBotSettingsStrict(restoredRow.bot_id);
            const expSched = stableJson(schedulesData);
            const confSched = stableJson(confirmed?.bot_schedules || confirmed?.schedules || []);
            return !!confirmed &&
                String(confirmed.password || '') === restoredRow.password &&
                String(confirmed.username || '') === restoredRow.username &&
                stableJson(confirmed.settings || {}) === stableJson(restoredRow.settings) &&
                stableJson(confirmed.proxy || {}) === stableJson(restoredRow.proxy) &&
                confSched === expSched &&
                stableJson(confirmed.auto_chat || []) === stableJson(restoredRow.auto_chat) &&
                Boolean(confirmed.manually_stopped) === restoredRow.manually_stopped &&
                stableJson(confirmed.synced_auth || {}) === stableJson(restoredRow.synced_auth || {});
        } catch (err) {
            console.error('[SUPABASE] Lỗi khôi phục bot_settings:', err.message);
            return false;
        }
    }

    // --- AUDIT LOGS ---
    async insertAuditLog(entry) {
        if (!this.isEnabled()) return false;
        try {
            const row = {
                id: String(entry.id),
                bot_id: entry.botId ?? entry.target?.botId ?? entry.target?.bot_id ?? null,
                log_type: String(entry.logType || 'SYSTEM'),
                category: String(entry.category || 'SYSTEM'),
                action: String(entry.action || 'UNKNOWN'),
                action_label: String(entry.actionLabel || entry.action || ''),
                actor_username: String(entry.actor?.username || 'system'),
                actor_role: String(entry.actor?.role || 'system'),
                actor_ip: String(entry.actor?.ip || '127.0.0.1'),
                target: entry.target || {},
                details: String(entry.details || ''),
                status: String(entry.status || 'SUCCESS'),
                timestamp: entry.timestamp || new Date().toISOString()
            };
            const res = await fetch(`${this.url}/rest/v1/audit_logs`, {
                method: 'POST',
                headers: this.getHeaders({ 'Prefer': 'resolution=ignore-duplicates,return=minimal' }),
                body: JSON.stringify([row]),
                signal: AbortSignal.timeout(5000)
            });
            return res.ok;
        } catch (_) {
            return false;
        }
    }

    async syncAuditLogs(entries) {
        if (!this.isEnabled() || !Array.isArray(entries)) return false;
        try {
            const uniqueMap = new Map();
            for (const entry of entries) {
                if (!entry || !entry.id) continue;
                const id = String(entry.id);
                if (!uniqueMap.has(id)) {
                    uniqueMap.set(id, {
                        id,
                        bot_id: entry.botId ?? entry.target?.botId ?? entry.target?.bot_id ?? null,
                        log_type: String(entry.logType || 'SYSTEM'),
                        category: String(entry.category || 'SYSTEM'),
                        action: String(entry.action || 'UNKNOWN'),
                        action_label: String(entry.actionLabel || entry.action || ''),
                        actor_username: String(entry.actor?.username || 'system'),
                        actor_role: String(entry.actor?.role || 'system'),
                        actor_ip: String(entry.actor?.ip || '127.0.0.1'),
                        target: entry.target || {},
                        details: String(entry.details || ''),
                        status: String(entry.status || 'SUCCESS'),
                        timestamp: entry.timestamp || new Date().toISOString()
                    });
                }
            }
            const rows = Array.from(uniqueMap.values());
            for (let offset = 0; offset < rows.length; offset += 200) {
                const res = await fetch(`${this.url}/rest/v1/audit_logs`, {
                    method: 'POST',
                    headers: this.getHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
                    body: JSON.stringify(rows.slice(offset, offset + 200)),
                    signal: AbortSignal.timeout(12000)
                });
                if (!res.ok) return false;
            }
            return true;
        } catch (err) {
            console.error('[SUPABASE] Lỗi đồng bộ audit logs:', err.message);
            return false;
        }
    }

    async fetchAuditLogs({ logType = '', category = '', status = '', q = '', actor = '', botId = '', limit = 50, page = 1 } = {}) {
        if (!this.isEnabled()) return null;
        try {
            const offset = (page - 1) * limit;
            let query = `select=*&order=timestamp.desc&limit=${limit}&offset=${offset}`;
            if (logType) {
                if (logType === 'SYSTEM') {
                    query += `&or=(log_type.eq.SYSTEM,log_type.eq.MANAGER)`;
                } else {
                    query += `&log_type=eq.${encodeURIComponent(logType)}`;
                }
            }
            if (category) query += `&category=eq.${encodeURIComponent(category)}`;
            if (status) query += `&status=eq.${encodeURIComponent(status)}`;
            if (actor) {
                const actorPattern = buildPostgrestIlikePattern(actor);
                if (actorPattern) query += `&actor_username=ilike.${actorPattern}`;
            }
            if (botId) query += `&bot_id=eq.${encodeURIComponent(botId)}`;
            if (q) {
                const qPattern = buildPostgrestIlikePattern(q);
                if (qPattern) query += `&or=(action.ilike.${qPattern},details.ilike.${qPattern},actor_username.ilike.${qPattern})`;
            }

            const res = await fetch(`${this.url}/rest/v1/audit_logs?${query}`, {
                headers: this.getHeaders({ 'Prefer': 'count=exact' }),
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const contentRange = res.headers.get('content-range');
            let total = 0;
            if (contentRange) {
                const parts = contentRange.split('/');
                if (parts[1]) total = parseInt(parts[1], 10) || 0;
            }

            const data = await res.json();
            const logs = data.map(r => ({
                id: r.id,
                botId: r.bot_id || null,
                logType: r.log_type === 'MANAGER' ? 'SYSTEM' : (r.log_type || 'SYSTEM'),
                timestamp: r.timestamp,
                actor: {
                    username: r.actor_username,
                    role: r.actor_role,
                    ip: r.actor_ip
                },
                category: r.category,
                action: r.action,
                actionLabel: r.action_label,
                target: r.target,
                details: r.details,
                status: r.status
            }));

            const totalPages = Math.max(1, Math.ceil(total / limit));
            return { logs, total, page, limit, totalPages };
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải audit logs:', err.message);
            return null;
        }
    }

    async clearAuditLogs() {
        if (!this.isEnabled()) return false;
        try {
            const res = await fetch(`${this.url}/rest/v1/audit_logs?id=neq.placeholder_none`, {
                method: 'DELETE',
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(8000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi xóa audit logs:', err.message);
            return false;
        }
    }

    async fetchBackups() {
        if (!this.isEnabled()) return null;
        try {
            const rows = await this.fetchAllRows('manager_backups', {
                select: 'name,created_at,size_bytes',
                order: 'created_at.desc',
                uniqueKey: 'name'
            });
            return rows.map(row => ({
                filename: row.name,
                createdAt: row.created_at,
                sizeBytes: row.size_bytes,
                mtimeMs: Date.parse(row.created_at) || 0
            }));
        } catch (err) {
            console.error('[SUPABASE] Lỗi tải danh sách backup:', err.message);
            return null;
        }
    }

    async fetchBackupPayload(filename) {
        if (!this.isEnabled() || !/^backup-[A-Za-z0-9._-]+\.json$/.test(String(filename || ''))) throw new Error('Tên bản sao lưu không hợp lệ hoặc Supabase chưa cấu hình.');
        const res = await fetch(`${this.url}/rest/v1/manager_backups?name=eq.${encodeURIComponent(filename)}&select=payload`, {
            headers: this.getHeaders(), signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) throw new Error('Không đọc được backup từ Supabase (HTTP ' + res.status + ').');
        const rows = await res.json();
        if (!Array.isArray(rows)) throw new Error('Supabase trả payload backup không hợp lệ.');
        return rows[0]?.payload || null;
    }

    async saveBackup(name, payload) {
        if (!this.isEnabled() || !name || !payload) return false;
        try {
            const safePayload = sanitizeBackupPayload(payload);
            const serialized = JSON.stringify(safePayload);
            const res = await fetch(`${this.url}/rest/v1/manager_backups?on_conflict=name`, {
                method: 'POST', headers: this.getHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
                body: JSON.stringify([{ name, bot_id: null, created_at: safePayload.createdAt || new Date().toISOString(), size_bytes: Buffer.byteLength(serialized), payload: safePayload }]),
                signal: AbortSignal.timeout(15000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi lưu backup:', err.message);
            return false;
        }
    }

    async deleteBackup(name) {
        if (!this.isEnabled() || !name) return false;
        try {
            const res = await fetch(`${this.url}/rest/v1/manager_backups?name=eq.${encodeURIComponent(name)}`, {
                method: 'DELETE', headers: this.getHeaders(), signal: AbortSignal.timeout(8000)
            });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] Lỗi xóa backup:', err.message);
            return false;
        }
    }

    async pruneBackups(maxKeep = 30) {
        const backups = await this.fetchBackups();
        if (!backups) return false;
        const extras = backups.slice(Math.max(1, Number(maxKeep) || 30));
        const results = await Promise.all(extras.map(backup => this.deleteBackup(backup.filename)));
        return results.every(Boolean);
    }

    // --- DISTRIBUTED OUTBOX RPC METHODS (P1-02) ---
    async saveOutboxItem(item) {
        if (!this.isEnabled()) return false;
        try {
            const bId = Number(item.botId || item.bot_id);
            const rawStatus = String(item.status || 'pending');
            const safeStatus = rawStatus === 'dispatched_to_sql' ? 'pending' : rawStatus;
            const row = {
                id: String(item.id || ('outbox_' + bId + '_' + Date.now().toString(36))),
                bot_id: bId,
                type: String(item.type || 'auth_sync'),
                status: safeStatus,
                attempts: Number(item.attempts || 0),
                max_attempts: Number(item.maxAttempts || item.max_attempts || 8),
                next_retry_at: item.nextRetryAt ? new Date(item.nextRetryAt).toISOString() : new Date().toISOString(),
                backoff_ms: Number(item.backoffMs || item.backoff_ms || 3000),
                processing_started_at: item.processingStartedAt ? new Date(item.processingStartedAt).toISOString() : null,
                completed_at: item.completedAt ? new Date(item.completedAt).toISOString() : null,
                lease_owner: item.leaseOwner || item.lease_owner || null,
                lease_until: item.leaseUntil ? new Date(item.leaseUntil).toISOString() : null,
                last_status_code: item.lastStatusCode || null,
                error_code: item.errorCode || null,
                last_error: item.lastError || null,
                payload: item.payload || (item.committedTransaction ? { committedTransaction: item.committedTransaction } : {}),
                committed_transaction: item.committedTransaction || item.committed_transaction || null,
                created_at: item.createdAt || new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_outbox_queue`, {
                method: 'POST',
                headers: {
                    ...this.getHeaders(),
                    'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify(row)
            }, { timeoutMs: 8000, maxRetries: 2 });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] saveOutboxItem error:', err.message);
            return false;
        }
    }

    async claimOutboxBatch(workerId, limit = 10, leaseSeconds = 60) {
        if (!this.isEnabled()) return [];
        try {
            const data = await this.callRpc('claim_manager_outbox_batch', {
                p_worker_id: String(workerId),
                p_limit: Number(limit) || 10,
                p_lease_seconds: Number(leaseSeconds) || 60
            });
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('[SUPABASE] claimOutboxBatch error:', err.message);
            return [];
        }
    }

    async completeOutboxItem(itemId, workerId) {
        if (!this.isEnabled()) return false;
        try {
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_outbox_queue?id=eq.${encodeURIComponent(itemId)}&lease_owner=eq.${encodeURIComponent(workerId)}`, {
                method: 'PATCH',
                headers: { ...this.getHeaders(), 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    status: 'completed',
                    completed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
            }, { timeoutMs: 8000, maxRetries: 2 });
            if (!res.ok) return false;
            const updatedRows = await res.json().catch(() => []);
            return Array.isArray(updatedRows) && updatedRows.length > 0;
        } catch (err) {
            console.error('[SUPABASE] completeOutboxItem error:', err.message);
            return false;
        }
    }

    async failOutboxItem(itemId, workerId, errorCode) {
        if (!this.isEnabled()) return false;
        try {
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_outbox_queue?id=eq.${encodeURIComponent(itemId)}&lease_owner=eq.${encodeURIComponent(workerId)}`, {
                method: 'PATCH',
                headers: { ...this.getHeaders(), 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    status: 'dead_letter',
                    last_error: String(errorCode || 'MAX_ATTEMPTS_EXCEEDED'),
                    updated_at: new Date().toISOString()
                })
            }, { timeoutMs: 8000, maxRetries: 2 });
            if (!res.ok) return false;
            const updatedRows = await res.json().catch(() => []);
            return Array.isArray(updatedRows) && updatedRows.length > 0;
        } catch (err) {
            console.error('[SUPABASE] failOutboxItem error:', err.message);
            return false;
        }
    }

    async rescheduleOutboxItem(itemId, workerId, nextRetryAtIso, reason = 'RETRY') {
        if (!this.isEnabled()) return false;
        try {
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_outbox_queue?id=eq.${encodeURIComponent(itemId)}&lease_owner=eq.${encodeURIComponent(workerId)}`, {
                method: 'PATCH',
                headers: { ...this.getHeaders(), 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    status: 'pending',
                    lease_owner: null,
                    lease_until: null,
                    next_retry_at: String(nextRetryAtIso),
                    last_error: String(reason || 'RETRY'),
                    updated_at: new Date().toISOString()
                })
            }, { timeoutMs: 8000, maxRetries: 2 });
            if (!res.ok) return false;
            const updatedRows = await res.json().catch(() => []);
            return Array.isArray(updatedRows) && updatedRows.length > 0;
        } catch (err) {
            console.error('[SUPABASE] rescheduleOutboxItem error:', err.message);
            return false;
        }
    }

    async fetchOutboxQueue(limit = 100) {
        if (!this.isEnabled()) return [];
        try {
            const lim = Math.max(1, Math.min(200, Number(limit) || 100));
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_outbox_queue?select=*&order=updated_at.desc&limit=${lim}`, {
                method: 'GET',
                headers: this.getHeaders()
            }, { timeoutMs: 8000, maxRetries: 2 });
            if (!res.ok) return [];
            const data = await res.json().catch(() => []);
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('[SUPABASE] fetchOutboxQueue error:', err.message);
            return [];
        }
    }

    async retryFailedOutboxItems() {
        if (!this.isEnabled()) return 0;
        try {
            const nowIso = new Date().toISOString();
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_outbox_queue?status=in.(dead_letter,failed_permanent,pending)`, {
                method: 'PATCH',
                headers: { ...this.getHeaders(), 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    status: 'pending',
                    attempts: 0,
                    lease_owner: null,
                    lease_until: null,
                    next_retry_at: nowIso,
                    updated_at: nowIso
                })
            }, { timeoutMs: 8000, maxRetries: 2 });
            if (!res.ok) return 0;
            const updatedRows = await res.json().catch(() => []);
            return Array.isArray(updatedRows) ? updatedRows.length : 0;
        } catch (err) {
            console.error('[SUPABASE] retryFailedOutboxItems error:', err.message);
            return 0;
        }
    }

    // --- DISTRIBUTED PENDING ALLOCATIONS METHODS (P1-01) ---
    async claimPendingAllocations(workerId, limit = 10, leaseSeconds = 60) {
        if (!this.isEnabled()) return [];
        try {
            const data = await this.callRpc('claim_manager_pending_allocations', {
                p_worker_id: String(workerId),
                p_limit: Number(limit) || 10,
                p_lease_seconds: Number(leaseSeconds) || 60
            });
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('[SUPABASE] claimPendingAllocations error:', err.message);
            return [];
        }
    }

    async completePendingAllocation(jobId, finalStatus = 'completed', workerId = null) {
        if (!this.isEnabled()) return false;
        try {
            const updatePayload = {
                status: finalStatus === 'completed' ? 'completed' : 'failed',
                completed_at: new Date().toISOString(),
                lease_owner: null,
                lease_until: null,
                updated_at: new Date().toISOString()
            };
            if (finalStatus !== 'completed') {
                updatePayload.last_error = String(finalStatus);
            }
            const cleanWorkerId = workerId ? String(workerId).trim() : '';
            if (!cleanWorkerId) {
                console.warn('[PENDING_ALLOC] completePendingAllocation rejected: workerId required for lease ownership verification.');
                return false;
            }
            let query = `?id=eq.${encodeURIComponent(jobId)}&lease_owner=eq.${encodeURIComponent(cleanWorkerId)}`;
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_pending_allocations${query}`, {
                method: 'PATCH',
                headers: { ...this.getHeaders(), 'Prefer': 'return=representation' },
                body: JSON.stringify(updatePayload)
            }, { timeoutMs: 8000, maxRetries: 2 });
            if (!res.ok) return false;
            const updatedRows = await res.json().catch(() => []);
            return Array.isArray(updatedRows) && updatedRows.length > 0;
        } catch (err) {
            console.error('[SUPABASE] completePendingAllocation error:', err.message);
            return false;
        }
    }

    async fetchPendingAllocations(status = 'pending_retry') {
        if (!this.isEnabled()) return [];
        try {
            const query = status ? `?status=eq.${encodeURIComponent(status)}&order=created_at.asc` : '?order=created_at.asc';
            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_pending_allocations${query}`, {
                headers: this.getHeaders(),
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) return [];
            return await res.json();
        } catch (err) {
            console.error('[SUPABASE] fetchPendingAllocations error:', err.message);
            return [];
        }
    }

    async savePendingAllocation(job) {
        if (!this.isEnabled()) return false;
        try {
            const row = {
                id: String(job.id || ('alloc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8))),
                username: String(job.username || '').toLowerCase().trim(),
                target_bot_count: Number(job.neededCount || job.targetBotCount || 1),
                current_assigned: Number(job.currentAssigned || 0),
                missing_bot_count: Number(job.missingBotCount || 1),
                preferred_bot_ids: Array.isArray(job.preferredBotIds) ? job.preferredBotIds : [],
                status: String(job.status || 'pending_retry'),
                attempts: Number(job.attempts || 0),
                max_attempts: Number(job.maxAttempts || 10),
                next_retry_at: job.nextRetryAt || new Date().toISOString(),
                lease_owner: job.leaseOwner || null,
                lease_until: job.leaseUntil || null,
                last_error: job.lastError || job.reason || null,
                updated_at: new Date().toISOString()
            };
            if (job.createdAt) row.created_at = job.createdAt;
            if (job.status === 'completed') row.completed_at = new Date().toISOString();

            const res = await this.fetchWithRetry(`${this.url}/rest/v1/manager_pending_allocations`, {
                method: 'POST',
                headers: {
                    ...this.getHeaders(),
                    'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify(row)
            }, { timeoutMs: 8000, maxRetries: 2 });
            return res.ok;
        } catch (err) {
            console.error('[SUPABASE] savePendingAllocation error:', err.message);
            return false;
        }
    }

}


function createSupabaseClient({ url, secretKey }) {
  const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
  const cleanKey = String(secretKey || '').trim();
  const client = createClient(cleanUrl, cleanKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': 'kingmc-worker-manager' } }
  });
  client.adapter = new SupabaseAdapter({ url: cleanUrl, key: cleanKey });
  return client;
}

module.exports = {
  createSupabaseClient,
  SupabaseAdapter,
  SUPABASE_REQUIRED_TABLES,
  SUPABASE_SCHEMA_SQL,
  getSupabaseKeyRole,
  buildPostgrestIlikePattern,
  withLocalProcessLock,
  normalizeMaxUses,
  normalizeManagerRole
};
