'use strict';

const crypto = require('node:crypto');
const express = require('express');
const {
  encryptSecret,
  decryptSecret,
  decryptUserPassword,
  hashAdminPasswordAsync,
  isStoredCredentialCiphertext
} = require('../../utils/secrets');
const { validateSafeBotUrl } = require('../../services/proxy-validation');
const { isWispbyteControlPanelUrl } = require('../../utils/http');
const { resolveClientIp } = require('../../services/captcha');
const { resolveRequestOrigin, DEFAULT_PUBLIC_MANAGER_URL } = require('../../config/host-runtime');
const { getMaintenanceState, setMaintenanceState } = require('../../utils/maintenance');
const rawSchema = require('../../storage/schema-sql');
const SCHEMA_SQL = typeof rawSchema === 'string' ? rawSchema : (rawSchema?.SCHEMA_SQL || '');

function isLocalBotUrlAllowed() {
  return process.env.ALLOW_LOCAL_BOT_URLS === 'true' || process.env.NODE_ENV !== 'production';
}

function isLoopbackBotUrl(rawUrl) {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/.*)?$/i.test(String(rawUrl || '').trim());
}

async function validateWorkerBotUrl(rawUrl) {
  const clean = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (isWispbyteControlPanelUrl(clean)) {
    throw new Error('Không dùng link trang quản trị Wispbyte làm URL bot. Hãy để trống URL để dùng chế độ Wispbyte Pull.');
  }
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error('URL bot không hợp lệ.');
  }
  const allowLocal = isLocalBotUrlAllowed();
  const isLoop = isLoopbackBotUrl(clean);
  if (parsed.protocol === 'http:') {
    if (!(isLoop && allowLocal)) {
      throw new Error('Worker URL bắt buộc phải dùng HTTPS (chỉ cho phép localhost/127.0.0.1 khi không phải production).');
    }
    return clean;
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Worker URL phải dùng giao thức https://.');
  }
  if (isLoop && allowLocal) {
    return clean;
  }
  return validateSafeBotUrl(clean);
}

function validateHttpOrHttpsUrl(rawUrl, fieldLabel = 'URL') {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    const err = new Error(`${fieldLabel} không hợp lệ.`);
    err.status = 400;
    throw err;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const err = new Error(`${fieldLabel} chỉ được phép dùng giao thức http:// hoặc https://.`);
    err.status = 400;
    throw err;
  }
  return clean;
}

const USER_ALLOWED_FIELDS = [
  'status', 'expiresAt', 'planName', 'note', 'workerIds', 'assignedBotIds',
  'botCount', 'username', 'password', 'isPermanent', 'botAliases',
  'allowAccountChange', 'lockReason', 'discordUserId'
];

function csvEscapeCell(val) {
  let str = val === null || val === undefined
    ? ''
    : (typeof val === 'object' ? JSON.stringify(val) : String(val));
  if (/^[\s\r\n]*[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function validateDiscordWebhookUrl(urlStr) {
  const raw = String(urlStr || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Discord Webhook URL không đúng định dạng.');
  }
  const host = parsed.hostname.toLowerCase();
  const isDiscordHost = host === 'discord.com' || host === 'discordapp.com' || host === 'ptb.discord.com' || host === 'canary.discord.com';
  if (parsed.protocol !== 'https:' || !isDiscordHost || !parsed.pathname.startsWith('/api/webhooks/')) {
    throw new Error('Discord Webhook URL phải là liên kết HTTPS hợp lệ từ discord.com/api/webhooks/...');
  }
  return raw;
}

function normalizeWebhookSettings(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: Boolean(src.enabled),
    discordUrl: String(src.discordUrl || src.webhookUrl || '').trim(),
    telegramToken: String(src.telegramToken || '').trim(),
    telegramChatId: String(src.telegramChatId || '').trim(),
    notifyOnOffline: src.notifyOnOffline !== false,
    notifyOnRecover: src.notifyOnRecover !== false,
    notifyOnLowTotem: src.notifyOnLowTotem !== false,
    notifyOnLowHealth: Boolean(src.notifyOnLowHealth),
    notifyOnDeath: src.notifyOnDeath !== false,
    offlineThresholdMinutes: Math.max(1, Math.min(1440, Number(src.offlineThresholdMinutes) || 5))
  };
}

function filterWorkersByTag(workers, rawTag, assignedWorkerIds) {
  const tag = String(rawTag || '').trim().toLowerCase();
  if (!tag || tag === 'all') return workers;
  const assignedSet = assignedWorkerIds instanceof Set ? assignedWorkerIds : new Set();
  if (tag === 'sys:rented') {
    return workers.filter((w) => assignedSet.has(String(w.workerId).toLowerCase()));
  }
  if (tag === 'sys:rentable') {
    return workers.filter((w) => w.rentable !== false && !assignedSet.has(String(w.workerId).toLowerCase()));
  }
  if (tag === 'sys:not-rentable') {
    return workers.filter((w) => w.rentable === false);
  }
  const cleanTag = tag.replace(/^#/, '');
  return workers.filter((w) => Array.isArray(w.tags) && w.tags.some((t) => String(t).trim().toLowerCase().replace(/^#/, '') === cleanTag));
}

function safeDecryptBotJson(ciphertext, key) {
  if (!ciphertext || !key) return null;
  try {
    const raw = decryptSecret(ciphertext, key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function createAdminApi({
  store,
  entitlementService,
  link4mService,
  managerRuntimeSettings = null,
  registry,
  broker,
  fleetOperations,
  adminNotifier,
  discordClient = null,
  config,
  logger,
  invalidateUserSessions,
  invalidateAdminSessions
}) {
  const discordProfileCache = new Map();
  const DISCORD_PROFILE_HIT_TTL_MS = 10 * 60 * 1000;
  const DISCORD_PROFILE_MISS_TTL_MS = 2 * 60 * 1000;
  const DISCORD_PROFILE_CACHE_MAX = 1000;

  async function resolveDiscordProfile(discordId) {
    const id = String(discordId || '').trim();
    if (!id || !/^\d{17,20}$/.test(id)) {
      return { discordUsername: '', discordDisplayName: '' };
    }
    const now = Date.now();
    const cached = discordProfileCache.get(id);
    if (cached && now < cached.expiresAt) {
      return cached.profile;
    }

    const client = discordClient || adminNotifier?.client || null;
    if (!client) {
      return { discordUsername: '', discordDisplayName: '' };
    }

    let resolvedUser = client.users?.cache?.get?.(id) || null;
    if (!resolvedUser && typeof client.users?.fetch === 'function') {
      let timer = null;
      try {
        resolvedUser = await Promise.race([
          Promise.resolve(client.users.fetch(id)).catch(() => null),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(null), 1500);
            timer.unref?.();
          })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    const discordUsername = String(resolvedUser?.username || '').trim();
    const discordDisplayName = String(
      resolvedUser?.globalName || resolvedUser?.displayName || resolvedUser?.username || ''
    ).trim();
    const profile = { discordUsername, discordDisplayName };
    const ttl = (discordUsername || discordDisplayName) ? DISCORD_PROFILE_HIT_TTL_MS : DISCORD_PROFILE_MISS_TTL_MS;

    if (!discordProfileCache.has(id) && discordProfileCache.size >= DISCORD_PROFILE_CACHE_MAX) {
      for (const [k, entry] of discordProfileCache.entries()) {
        if (now >= entry.expiresAt) discordProfileCache.delete(k);
      }
      while (discordProfileCache.size >= DISCORD_PROFILE_CACHE_MAX) {
        const oldest = discordProfileCache.keys().next().value;
        if (oldest === undefined) break;
        discordProfileCache.delete(oldest);
      }
    }
    discordProfileCache.set(id, { profile, expiresAt: now + ttl });
    return profile;
  }

  async function resolveDiscordProfilesMap(discordIds) {
    const uniqueIds = [...new Set(discordIds.map((x) => String(x || '').trim()).filter((x) => /^\d{17,20}$/.test(x)))];
    const map = new Map();
    const CONCURRENCY = 6;
    for (let i = 0; i < uniqueIds.length; i += CONCURRENCY) {
      const batch = uniqueIds.slice(i, i + CONCURRENCY);
      const profiles = await Promise.all(batch.map((id) => resolveDiscordProfile(id)));
      batch.forEach((id, idx) => map.set(id, profiles[idx]));
    }
    return map;
  }
  const router = express.Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
    const orig = router[method].bind(router);
    router[method] = (path, ...handlers) => orig(
      path,
      ...handlers.map((fn) => (typeof fn === 'function' && fn.length < 4
        ? (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
        : fn))
    );
  }

  // Helper: Resolve worker by workerId (string) or botNumber (number/string)
  async function resolveWorker(targetId) {
    if (!targetId && targetId !== 0) return null;
    const strId = String(targetId).trim().toLowerCase();
    let worker = await registry.find(strId);
    if (worker) return worker;
    const num = Number(strId);
    if (Number.isInteger(num) && num > 0) {
      worker = await registry.findByNumber(num);
      if (worker) return worker;
    }
    return null;
  }

  // Middleware: Require Admin Role
  function requireAdmin(req, res, next) {
    const session = req.managerAuthSession;
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Chưa đăng nhập hệ thống.' });
    }
    if (session.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (ADMIN) mới có quyền truy cập.' });
    }
    return next();
  }

  router.use(requireAdmin);

  // Helper: revoke in-memory & DB sessions across both id and username
  async function revokeAllUserSessions(targetIdOrUsername, knownUser = null) {
    const targets = new Set();
    if (targetIdOrUsername) targets.add(String(targetIdOrUsername));
    const userObj = knownUser || await store.getUser?.(targetIdOrUsername, { bypassCache: true }).catch(() => null)
      || await store.getAccess?.(targetIdOrUsername).catch(() => null);
    if (userObj?.id) targets.add(String(userObj.id));
    if (userObj?.userId) targets.add(String(userObj.userId));
    if (userObj?.username) targets.add(String(userObj.username));
    for (const target of targets) {
      if (typeof invalidateUserSessions === 'function') invalidateUserSessions(target);
      if (typeof store?.adapter?.revokeUserSessions === 'function') {
        await store.adapter.revokeUserSessions(target).catch(() => null);
      }
    }
  }

  // 1. USER MANAGEMENT
  router.get('/users', async (_req, res) => {
    try {
      const [storedUsers, workers] = await Promise.all([store.listAccess(), registry.list()]);
      const discordMap = await resolveDiscordProfilesMap(
        storedUsers.map((user) => user.discordUserId || user.discord_user_id || '')
      );
      const users = storedUsers.map((user) => {
        const assignedBotIds = Array.isArray(user.workerIds)
          ? [...new Set(user.workerIds.map((workerId) => String(workerId).trim().toLowerCase()).filter(Boolean))]
          : [];
        const dId = String(user.discordUserId || user.discord_user_id || '').trim();
        const dProfile = dId ? (discordMap.get(dId) || { discordUsername: '', discordDisplayName: '' }) : { discordUsername: '', discordDisplayName: '' };
        return {
          id: String(user.userId || user.id || ''),
          userId: String(user.userId || user.id || ''),
          username: String(user.username || ''),
          role: String(user.role || 'user'),
          status: String(user.status || 'active'),
          planName: String(user.planName || user.plan_name || 'Standard'),
          note: String(user.note || ''),
          isPermanent: Boolean(user.isPermanent ?? user.is_permanent),
          expiresAt: user.expiresAt || user.expires_at || null,
          botCount: Number(user.botCount ?? user.bot_count ?? 1),
          allowAccountChange: (user.allowAccountChange ?? user.allow_account_change) !== false,
          lockReason: String(user.lockReason || user.lock_reason || ''),
          botAliases: (user.botAliases && typeof user.botAliases === 'object' && !Array.isArray(user.botAliases))
            ? user.botAliases
            : (user.bot_aliases && typeof user.bot_aliases === 'object' ? user.bot_aliases : {}),
          discordUserId: dId,
          discordUsername: dProfile.discordUsername,
          discordDisplayName: dProfile.discordDisplayName,
          lastLoginIp: String(user.lastLoginIp || user.last_login_ip || ''),
          lastLoginAt: user.lastLoginAt || user.last_login_at || null,
          registrationIp: String(user.registrationIp || user.registration_ip || ''),
          createdAt: user.createdAt || user.created_at || null,
          updatedAt: user.updatedAt || user.updated_at || null,
          workerIds: assignedBotIds,
          assignedBotIds
        };
      });
      // Build ownership map strictly in RAM (match workerId first; botNumber only when unambiguous)
      const ownerByWorkerId = new Map();
      const workerIdSet = new Set(workers.map((w) => String(w.workerId).trim().toLowerCase()));
      for (const user of users) {
        for (const wid of user.assignedBotIds) {
          if (!ownerByWorkerId.has(wid)) {
            ownerByWorkerId.set(wid, { userId: user.id, username: user.username });
          }
        }
      }
      const botOwnership = {};
      for (const worker of workers) {
        const key = String(worker.workerId).trim().toLowerCase();
        const numKey = worker.botNumber !== null && worker.botNumber !== undefined ? String(worker.botNumber) : '';
        const numIsAmbiguous = Boolean(numKey && numKey !== key && workerIdSet.has(numKey));
        botOwnership[worker.workerId] = ownerByWorkerId.get(key)
          || (!numIsAmbiguous && numKey ? ownerByWorkerId.get(numKey) : null)
          || null;
      }
      const encKey = registry?.encryptionKey || config?.encryptionKey;
      const availableBots = await Promise.all(workers.map(async (worker) => {
        let mcUser = worker.status?.username || worker.settings?.account?.username || worker.settings?.username || '';
        if (!mcUser && worker.settings?.mcCredentialsCiphertext && encKey) {
          mcUser = safeDecryptBotJson(worker.settings.mcCredentialsCiphertext, encKey)?.username || '';
        }
        if (!mcUser && typeof registry.privateSettings === 'function') {
          const priv = await registry.privateSettings(worker.workerId).catch(() => null);
          mcUser = priv?.username || '';
        }
        return {
          id: String(worker.workerId),
          workerId: String(worker.workerId),
          botNumber: worker.botNumber,
          label: worker.alias || worker.name || `Bot #${worker.botNumber || worker.workerId}`,
          botMinecraftUser: String(mcUser || ''),
          enabled: worker.enabled !== false,
          rentable: worker.rentable !== false,
          currentOwner: botOwnership[worker.workerId] || null
        };
      }));
      return res.json({ ok: true, users, availableBots, botOwnership });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  function sanitizeUserUpdateBody(rawBody) {
    const src = rawBody && typeof rawBody === 'object' ? rawBody : {};
    const values = {};
    for (const k of USER_ALLOWED_FIELDS) {
      if (src[k] !== undefined) values[k] = src[k];
    }
    if (values.workerIds === undefined && values.assignedBotIds !== undefined) {
      values.workerIds = values.assignedBotIds;
    }
    delete values.assignedBotIds;

    // Never auto-promote isPermanent from empty or unparseable expiresAt (API-03)
    if (Object.prototype.hasOwnProperty.call(values, 'expiresAt')) {
      if (values.expiresAt === '' || values.expiresAt === null) {
        values.expiresAt = null;
      } else {
        const parsed = Date.parse(values.expiresAt);
        if (!Number.isFinite(parsed)) {
          const err = new Error('Định dạng thời hạn (expiresAt) không hợp lệ.');
          err.status = 400;
          throw err;
        }
        const year = new Date(parsed).getUTCFullYear();
        if (year < 1970 || year > 2100) {
          const err = new Error('Năm hết hạn (expiresAt) phải từ 1970 đến 2100.');
          err.status = 400;
          throw err;
        }
        values.expiresAt = new Date(parsed).toISOString();
      }
    }

    if (values.isPermanent !== undefined) {
      if (typeof values.isPermanent !== 'boolean') {
        const err = new Error('Trường isPermanent phải là kiểu boolean.');
        err.status = 400;
        throw err;
      }
    }

    if (values.allowAccountChange !== undefined) {
      if (typeof values.allowAccountChange !== 'boolean') {
        const err = new Error('Trường allowAccountChange phải là kiểu boolean.');
        err.status = 400;
        throw err;
      }
    }

    if (values.botAliases !== undefined && values.botAliases !== null) {
      if (typeof values.botAliases !== 'object' || Array.isArray(values.botAliases)) {
        const err = new Error('botAliases phải là đối tượng JSON hợp lệ.');
        err.status = 400;
        throw err;
      }
      const entries = Object.entries(values.botAliases);
      if (entries.length > 100) {
        const err = new Error('botAliases tối đa 100 mục.');
        err.status = 400;
        throw err;
      }
      const cleanAliases = {};
      for (const [k, v] of entries) {
        const cleanKey = String(k || '').trim().slice(0, 64);
        if (!cleanKey) {
          const err = new Error('Tên khóa trong botAliases không hợp lệ.');
          err.status = 400;
          throw err;
        }
        if (typeof v !== 'string' || v.length > 64) {
          const err = new Error('Giá trị botAliases phải là chuỗi tối đa 64 ký tự.');
          err.status = 400;
          throw err;
        }
        cleanAliases[cleanKey] = v.trim();
      }
      values.botAliases = cleanAliases;
    }

    if (values.discordUserId !== undefined) {
      if (values.discordUserId === null || String(values.discordUserId).trim() === '') {
        values.discordUserId = '';
      } else {
        const snowflake = String(values.discordUserId).trim();
        if (!/^\d{17,22}$/.test(snowflake)) {
          const err = new Error('Discord User ID phải là chuỗi số snowflake 17-22 chữ số.');
          err.status = 400;
          throw err;
        }
        values.discordUserId = snowflake;
      }
    }

    if (values.workerIds !== undefined && values.workerIds !== null) {
      if (!Array.isArray(values.workerIds)) {
        const err = new Error('Danh sách bot (workerIds) phải là một mảng.');
        err.status = 400;
        throw err;
      }
      values.workerIds = values.workerIds.map((id) => String(id || '').trim()).filter(Boolean);
    }

    if (values.status !== undefined) {
      const validStatuses = ['active', 'expired', 'disabled', 'grace_period'];
      const st = String(values.status || '').trim().toLowerCase();
      if (!validStatuses.includes(st)) {
        const err = new Error('Trạng thái người dùng không hợp lệ.');
        err.status = 400;
        throw err;
      }
      values.status = st;
    }

    if (values.botCount !== undefined) {
      const cnt = Number(values.botCount);
      if (!Number.isSafeInteger(cnt) || cnt < 0 || cnt > 100) {
        const err = new Error('Số lượng bot (botCount) phải là số nguyên từ 0 đến 100.');
        err.status = 400;
        throw err;
      }
      values.botCount = cnt;
    }

    // Never allow mass-assignment of privileged roles via user CRUD
    if (src.role !== undefined && String(src.role).trim().toLowerCase() === 'user') {
      values.role = 'user';
    }
    return values;
  }

  router.post('/users', async (req, res) => {
    try {
      const { action, userId, values, id, ...rest } = req.body || {};
      const actorIp = resolveClientIp(req) || '127.0.0.1';
      let targetUserId = userId || id;

      if (action === 'delete') {
        if (!targetUserId) return res.status(400).json({ ok: false, error: 'Thiếu userId cần xóa.' });
        const existingUser = await store.getUser?.(targetUserId, { bypassCache: true }).catch(() => null)
          || await store.getAccess?.(targetUserId).catch(() => null);
        await store.removeAccess(targetUserId);
        await revokeAllUserSessions(targetUserId, existingUser);
        await store.addAudit({
          action: 'ADMIN_DELETE_USER',
          targetId: targetUserId,
          actorId: req.managerAuthSession.username,
          actorRole: 'admin',
          actorIp
        });
        return res.json({ ok: true, message: 'Đã xóa người dùng thành công.' });
      }

      const updateData = sanitizeUserUpdateBody(values || rest);
      if (updateData.username !== undefined) {
        const username = String(updateData.username || '').trim().toLowerCase();
        if (!/^[a-z0-9_]{3,32}$/.test(username)) {
          return res.status(400).json({ ok: false, error: 'Tên đăng nhập phải từ 3 đến 32 ký tự, chỉ gồm chữ, số và dấu gạch dưới.' });
        }
        if (username === 'admin' || username === String(config?.adminUsername || '').trim().toLowerCase()) {
          return res.status(400).json({ ok: false, error: 'Tên tài khoản này được bảo lưu cho Quản trị viên.' });
        }
        updateData.username = username;
      }
      if (updateData.password !== undefined) {
        const password = updateData.password;
        if (typeof password !== 'string' || password.length < 6 || password.length > 256) {
          return res.status(400).json({ ok: false, error: 'Mật khẩu phải dài từ 6 đến 256 ký tự.' });
        }
      }
      const isCreate = !targetUserId;
      let prevUser = null;
      if (isCreate) {
        const username = String(updateData.username || '').trim().toLowerCase();
        const password = String(updateData.password || '');
        if (!username || !password) {
          return res.status(400).json({ ok: false, error: 'Tạo tài khoản mới cần username và password.' });
        }
        targetUserId = `usr_${crypto.randomUUID()}`;
        updateData.username = username;
        updateData.role = 'user';
      } else {
        prevUser = await store.getUser?.(targetUserId, { bypassCache: true }).catch(() => null)
          || await store.getAccess?.(targetUserId).catch(() => null);
      }

      await store.setAccess(targetUserId, updateData, req.managerAuthSession.username);
      const prevBots = new Set(Array.isArray(prevUser?.workerIds) ? prevUser.workerIds.map((w) => String(w).toLowerCase()) : []);
      const nextBots = Array.isArray(updateData.workerIds) ? new Set(updateData.workerIds.map((w) => String(w).toLowerCase())) : null;
      const botsRevoked = Boolean(nextBots && [...prevBots].some((w) => !nextBots.has(w)));
      const shouldRevokeSessions = !isCreate && (
        String(updateData.status || '').trim().toLowerCase() === 'disabled' ||
        updateData.password !== undefined ||
        updateData.allowAccountChange === false ||
        botsRevoked
      );
      if (shouldRevokeSessions) {
        await revokeAllUserSessions(targetUserId, prevUser);
      }
      const auditDetails = { ...updateData };
      if (auditDetails.password) auditDetails.password = '[REDACTED]';
      await store.addAudit({
        action: 'ADMIN_UPDATE_USER',
        targetId: targetUserId,
        actorId: req.managerAuthSession.username,
        actorRole: 'admin',
        actorIp,
        details: auditDetails
      });
      return res.json({ ok: true, message: 'Đã cập nhật thông tin người dùng.' });
    } catch (error) {
      const status = error.status === 400 ? 400 : 500;
      return res.status(status).json({ ok: false, error: error.message });
    }
  });

  router.all(['/users/:id', '/user/:id'], async (req, res) => {
    const { id } = req.params;
    const actorIp = resolveClientIp(req) || '127.0.0.1';
    if (req.method === 'DELETE') {
      try {
        const existingUser = await store.getUser?.(id, { bypassCache: true }).catch(() => null)
          || await store.getAccess?.(id).catch(() => null);
        await store.removeAccess(id);
        await revokeAllUserSessions(id, existingUser);
        await store.addAudit({
          action: 'ADMIN_DELETE_USER',
          targetId: id,
          actorId: req.managerAuthSession.username,
          actorRole: 'admin',
          actorIp
        });
        return res.json({ ok: true, message: 'Đã xóa người dùng thành công.' });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
    }

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      try {
        const rawBody = req.body?.values || req.body || {};
        const values = sanitizeUserUpdateBody(rawBody);

        if (values.username !== undefined) {
          const username = String(values.username || '').trim().toLowerCase();
          if (!/^[a-z0-9_]{3,32}$/.test(username)) {
            return res.status(400).json({ ok: false, error: 'Tên đăng nhập phải từ 3 đến 32 ký tự, chỉ gồm chữ, số và dấu gạch dưới.' });
          }
          if (username === 'admin' || username === String(config?.adminUsername || '').trim().toLowerCase()) {
            return res.status(400).json({ ok: false, error: 'Tên tài khoản này được bảo lưu cho Quản trị viên.' });
          }
          values.username = username;
        }

        if (values.password !== undefined) {
          const password = values.password;
          if (typeof password !== 'string' || password.length < 6 || password.length > 256) {
            return res.status(400).json({ ok: false, error: 'Mật khẩu phải dài từ 6 đến 256 ký tự.' });
          }
        }

        const prevUser = await store.getUser?.(id, { bypassCache: true }).catch(() => null)
          || await store.getAccess?.(id).catch(() => null);

        await store.setAccess(id, values, req.managerAuthSession.username);
        const prevBots = new Set(Array.isArray(prevUser?.workerIds) ? prevUser.workerIds.map((w) => String(w).toLowerCase()) : []);
        const nextBots = Array.isArray(values.workerIds) ? new Set(values.workerIds.map((w) => String(w).toLowerCase())) : null;
        const botsRevoked = Boolean(nextBots && [...prevBots].some((w) => !nextBots.has(w)));
        if (
          String(values.status || '').trim().toLowerCase() === 'disabled' ||
          values.password !== undefined ||
          values.allowAccountChange === false ||
          botsRevoked
        ) {
          await revokeAllUserSessions(id, prevUser);
        }
        const auditDetails = { ...values };
        if (auditDetails.password) auditDetails.password = '[REDACTED]';
        await store.addAudit({
          action: 'ADMIN_UPDATE_USER',
          targetId: id,
          actorId: req.managerAuthSession.username,
          actorRole: 'admin',
          actorIp,
          details: auditDetails
        });
        return res.json({ ok: true, message: 'Đã cập nhật thông tin người dùng.' });
      } catch (error) {
        const status = error.status === 400 ? 400 : 500;
        return res.status(status).json({ ok: false, error: error.message });
      }
    }

    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  });

  router.post('/users/:id/reveal-password', async (req, res) => {
    try {
      const { id } = req.params;
      const user = await store.getUser(id, { bypassCache: true });
      if (!user) return res.status(404).json({ ok: false, error: 'Không tìm thấy người dùng.' });

      const stored = String(user._rawEncryptedPassword || user.password || '');
      if (stored.startsWith('scrypt$')) {
        return res.status(409).json({
          ok: false,
          code: 'PASSWORD_NOT_REVERSIBLE',
          error: 'Mật khẩu cũ đang ở dạng băm một chiều (scrypt). Hãy đặt lại mật khẩu cho user hoặc đợi user đăng nhập 1 lần để tự động đồng bộ mã hóa 2 chiều.'
        });
      }
      const decrypted = isStoredCredentialCiphertext(stored)
        ? decryptUserPassword(stored)
        : stored;
      if (decrypted === null) {
        return res.status(409).json({ ok: false, code: 'PASSWORD_NOT_REVERSIBLE', error: 'Không thể giải mã mật khẩu đã lưu.' });
      }
      if (typeof store.addAudit === 'function') {
        await store.addAudit({
          action: 'ADMIN_REVEAL_USER_PASSWORD',
          targetId: user.id || id,
          actorId: req.managerAuthSession.username,
          actorRole: 'admin',
          actorIp: resolveClientIp(req) || '127.0.0.1',
          details: { username: user.username }
        }).catch(() => {});
      }
      return res.json({ ok: true, password: decrypted || '' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/users/:id/renew-days', async (req, res) => {
    try {
      const { id } = req.params;
      const body = req.body || {};
      const isPerm = Boolean(body.isPermanent || body.setPermanent);
      const fixedDate = body.fixedDate !== undefined && body.fixedDate !== null ? String(body.fixedDate).trim() : '';
      const planName = body.planName !== undefined && body.planName !== null ? String(body.planName).trim().slice(0, 64) : undefined;
      const access = await store.getAccess(id);
      if (!access) return res.status(404).json({ ok: false, error: 'Không tìm thấy người dùng.' });

      const now = Date.now();
      let newExpiry = access.expiresAt || null;
      let nextStatus = access.status === 'disabled' ? 'disabled' : 'active';

      if (isPerm) {
        newExpiry = null;
        nextStatus = access.status === 'disabled' ? 'disabled' : 'active';
      } else if (fixedDate) {
        const parsedMs = Date.parse(fixedDate);
        if (!Number.isFinite(parsedMs)) {
          return res.status(400).json({ ok: false, error: 'Ngày hết hạn cố định không hợp lệ.' });
        }
        const year = new Date(parsedMs).getUTCFullYear();
        if (year < 1970 || year > 2100) {
          return res.status(400).json({ ok: false, error: 'Năm hết hạn phải nằm trong khoảng 1970 đến 2100.' });
        }
        newExpiry = new Date(parsedMs).toISOString();
        nextStatus = access.status === 'disabled' ? 'disabled' : (parsedMs > now ? 'active' : 'expired');
      } else {
        const addedDays = Number(body.days);
        if (!Number.isFinite(addedDays) || addedDays === 0 || addedDays < -3650 || addedDays > 3650) {
          return res.status(400).json({ ok: false, error: 'Số ngày gia hạn phải nằm trong khoảng -3650 đến 3650 (khác 0).' });
        }
        const currentMs = access.expiresAt ? Date.parse(access.expiresAt) : NaN;
        const baseMs = addedDays > 0
          ? Math.max(now, Number.isFinite(currentMs) ? currentMs : now)
          : (Number.isFinite(currentMs) ? currentMs : now);
        const targetMs = baseMs + addedDays * 86400000;
        const year = new Date(targetMs).getUTCFullYear();
        if (year < 1970 || year > 2100) {
          return res.status(400).json({ ok: false, error: 'Năm hết hạn sau gia hạn vượt ngoài khoảng 1970 đến 2100.' });
        }
        newExpiry = new Date(targetMs).toISOString();
        nextStatus = access.status === 'disabled' ? 'disabled' : (targetMs > now ? 'active' : 'expired');
      }

      const patch = {
        isPermanent: isPerm,
        expiresAt: newExpiry,
        status: nextStatus
      };
      if (planName) patch.planName = planName;

      await store.setAccess(id, patch, req.managerAuthSession.username);
      if (typeof store.addAudit === 'function') {
        await store.addAudit({
          action: 'ADMIN_RENEW_USER',
          targetId: id,
          actorId: req.managerAuthSession.username,
          actorRole: 'admin',
          actorIp: resolveClientIp(req) || '127.0.0.1',
          details: { isPermanent: isPerm, expiresAt: newExpiry, planName: planName || access.planName, status: nextStatus }
        }).catch(() => {});
      }

      return res.json({
        ok: true,
        message: 'Cập nhật thời hạn người dùng thành công.',
        expiresAt: newExpiry,
        isPermanent: isPerm,
        status: nextStatus,
        planName: planName || access.planName
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/user/:username/add-days', async (req, res) => {
    try {
      const { username } = req.params;
      const addedDays = Number(req.body?.days);
      if (!Number.isFinite(addedDays) || addedDays === 0 || addedDays < -3650 || addedDays > 3650) {
        return res.status(400).json({ ok: false, error: 'Số ngày gia hạn phải nằm trong khoảng -3650 đến 3650 (khác 0).' });
      }
      const user = await store.getAccess(username);
      if (!user) return res.status(404).json({ ok: false, error: 'Không tìm thấy người dùng.' });

      const now = Date.now();
      const currentMs = user.expiresAt ? Date.parse(user.expiresAt) : NaN;
      const baseMs = addedDays > 0
        ? Math.max(now, Number.isFinite(currentMs) ? currentMs : now)
        : (Number.isFinite(currentMs) ? currentMs : now);
      const targetMs = baseMs + addedDays * 86400000;
      const year = new Date(targetMs).getUTCFullYear();
      if (year < 1970 || year > 2100) {
        return res.status(400).json({ ok: false, error: 'Năm hết hạn sau gia hạn vượt ngoài khoảng 1970 đến 2100.' });
      }
      const newExpiry = new Date(targetMs).toISOString();
      const nextStatus = user.status === 'disabled' ? 'disabled' : (targetMs > now ? 'active' : 'expired');

      await store.setAccess(user.userId, {
        isPermanent: false,
        expiresAt: newExpiry,
        status: nextStatus
      }, req.managerAuthSession.username);

      return res.json({
        ok: true,
        message: `Đã cập nhật ${addedDays > 0 ? '+' : ''}${addedDays} ngày cho người dùng ${username}.`,
        expiresAt: newExpiry,
        status: nextStatus
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 2. BOT REGISTRATION & MANAGEMENT (ADMIN)
  router.post(['/bots', '/bot'], async (req, res) => {
    try {
      const body = req.body || {};
      const rawUrls = (Array.isArray(body.urls) && body.urls.length
        ? body.urls
        : (body.url || body.serviceUrl ? [body.url || body.serviceUrl] : [])).slice(0, 50);

      const baseLabel = String(body.label || body.name || '').trim();
      const explicitWorkerId = body.workerId ? String(body.workerId).trim().toLowerCase() : undefined;
      const explicitProvider = body.provider ? String(body.provider).trim().toLowerCase() : undefined;
      const rawSecret = body.secret !== undefined ? body.secret : body.secretKey;
      const explicitSecret = typeof rawSecret === 'string' && rawSecret.trim() ? rawSecret.trim() : undefined;

      const actorIp = resolveClientIp(req) || '127.0.0.1';

      // Case 1: No URLs provided (manual / wispbyte worker -> 1 or 2 slots)
      if (!rawUrls.length) {
        const provider = explicitProvider || 'wispbyte';
        const rawSlots = body.slots !== undefined ? Number(body.slots) : (body.botCount !== undefined ? Number(body.botCount) : 1);
        const slots = Number.isInteger(rawSlots) && rawSlots >= 1 && rawSlots <= 2 ? rawSlots : 1;
        const rawCount = body.count !== undefined ? Number(body.count) : 1;
        const serverCount = Number.isInteger(rawCount) && rawCount >= 1 && rawCount <= 25 ? rawCount : 1;
        const serviceUrlVal = body.serviceUrl ? await validateWorkerBotUrl(body.serviceUrl) : '';

        const added = [];
        const envConfigs = [];
        let firstSecret = undefined;

        for (let srvIdx = 0; srvIdx < serverCount; srvIdx++) {
          const clusterBots = [];
          for (let slot = 1; slot <= slots; slot++) {
            let botLabel = undefined;
            if (baseLabel) {
              if (serverCount > 1 && slots > 1) botLabel = `${baseLabel} ${srvIdx + 1} (Slot ${slot})`;
              else if (serverCount > 1) botLabel = `${baseLabel} ${srvIdx + 1}`;
              else if (slots > 1) botLabel = `${baseLabel} (Slot ${slot})`;
              else botLabel = baseLabel;
            }
            const totalTarget = serverCount * slots;
            const slotWorkerId = (explicitWorkerId && totalTarget === 1) ? explicitWorkerId : undefined;
            const slotSecret = (explicitSecret && totalTarget === 1) ? explicitSecret : undefined;

            const result = await registry.add({
              workerId: slotWorkerId,
              name: botLabel,
              provider,
              serviceUrl: serviceUrlVal,
              serviceId: body.serviceId || '',
              secret: slotSecret
            });
            if (firstSecret === undefined) firstSecret = result.secret;
            clusterBots.push({ worker: result.worker, secret: result.secret, slot });
            added.push(result.worker);
          }
          if (clusterBots.length > 0) {
            const header = serverCount > 1 ? `# Server Wispbyte #${srvIdx + 1}\n` : '';
            const transportLine = `WORKER_TRANSPORT=${provider === 'render' ? 'render-http' : 'wispbyte-poll'}\n`;
            const countLine = slots > 1 ? `WORKER_BOT_COUNT=${slots}\n` : '';
            const nodeOptsLine = provider === 'wispbyte' ? 'NODE_OPTIONS=--max-old-space-size=400\n' : '';
            let chunk = `${header}${transportLine}${countLine}`;
            clusterBots.forEach((cb) => {
              chunk += `WORKER_ID_${cb.slot}=${cb.worker.workerId}\n`;
            });
            chunk += nodeOptsLine;
            envConfigs.push(chunk.trim());
          }
        }

        await store.addAudit?.({
          action: 'ADMIN_CREATE_BOT',
          targetId: added.map((b) => b.workerId).join(','),
          actorId: req.managerAuthSession.username,
          actorRole: 'admin',
          actorIp,
          details: { provider, count: serverCount, slots, addedCount: added.length }
        }).catch(() => null);

        const envConfig = envConfigs.join('\n\n');

        return res.status(201).json({
          ok: true,
          message: added.length > 1 ? `Đã thêm thành công ${added.length} Bot!` : 'Đã thêm Bot mới thành công.',
          bot: added[0],
          bots: added,
          secret: firstSecret,
          envConfig
        });
      }

      // Case 2: One or more URLs / identifiers provided
      const added = [];
      const skipped = [];
      const envConfigs = [];
      let firstSecret = undefined;

      for (let i = 0; i < rawUrls.length; i++) {
        const rawUrl = String(rawUrls[i] || '').trim().replace(/\/+$/, '');
        if (!rawUrl) {
          skipped.push({ url: rawUrls[i], slot: 0, reason: 'URL worker không được để trống.' });
          continue;
        }

        const isHttpUrl = /^https?:\/\//i.test(rawUrl);
        const isWispPanel = isHttpUrl && isWispbyteControlPanelUrl(rawUrl);
        const provider = isWispPanel ? 'wispbyte' : (explicitProvider || (isHttpUrl ? 'render' : 'wispbyte'));
        const requestedSlots = body.slots !== undefined ? Number(body.slots) : null;
        let slots = (Number.isInteger(requestedSlots) && requestedSlots >= 1 && requestedSlots <= 2)
          ? requestedSlots
          : (isHttpUrl ? 2 : 1); // Render / Wispbyte panel entries default to dual-slot; manual identifier creates 1 slot
        let effectiveServiceUrl = (isHttpUrl && !isWispPanel) ? rawUrl : '';

        if (isWispPanel) {
          effectiveServiceUrl = '';
        } else if (provider === 'render') {
          if (!isHttpUrl) {
            skipped.push({ url: rawUrl, slot: 0, reason: 'Render worker bắt buộc phải sử dụng URL HTTPS hợp lệ.' });
            continue;
          }
          try {
            await validateWorkerBotUrl(rawUrl);
          } catch (ssrfErr) {
            skipped.push({ url: rawUrl, slot: 0, reason: ssrfErr.message });
            continue;
          }
        } else if (isHttpUrl) {
          try {
            await validateWorkerBotUrl(rawUrl);
          } catch (ssrfErr) {
            skipped.push({ url: rawUrl, slot: 0, reason: ssrfErr.message });
            continue;
          }
        } else {
          if (!/^[a-zA-Z0-9._-]+$/.test(rawUrl)) {
            skipped.push({ url: rawUrl, slot: 0, reason: 'Identifier worker không hợp lệ.' });
            continue;
          }
          if (requestedSlots === null) slots = 1;
        }

        // Probe worker /health endpoint if accessible (skip for Wispbyte panel URLs)
        if (!isWispPanel && provider === 'render' && isHttpUrl) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2500);
            try {
              const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch : null;
              if (fetchFn) {
                const probe = await fetchFn(`${rawUrl}/health`, {
                  signal: controller.signal,
                  redirect: 'manual',
                  headers: { 'Accept': 'application/json' }
                });
                if (probe && probe.ok) {
                  const probeData = await probe.json().catch(() => ({}));
                  const reportedCount = Number(probeData.botCount || probeData.slots || probeData.slotCount);
                  if (Number.isInteger(reportedCount) && reportedCount >= 1 && reportedCount <= 2) {
                    slots = reportedCount;
                  }
                }
              }
            } finally {
              clearTimeout(timer);
            }
          } catch (probeErr) {
            // Worker might be booting or cold-starting; keep default dual-slot
            logger?.info?.('Worker probe cold-start or timeout, keeping fallback slot count', {
              url: rawUrl,
              error: probeErr?.message
            });
            if (requestedSlots === null) slots = 2;
          }
        }

        const clusterBots = [];
        for (let slot = 1; slot <= slots; slot++) {
          try {
            const botLabel = baseLabel
              ? (slots > 1 ? `${baseLabel} (Slot ${slot})` : baseLabel)
              : undefined;
            const slotWorkerId = (explicitWorkerId && slots === 1) ? explicitWorkerId : undefined;
            const slotSecret = (explicitSecret && slots === 1) ? explicitSecret : undefined;

            const result = await registry.add({
              workerId: slotWorkerId,
              name: botLabel,
              provider,
              serviceUrl: effectiveServiceUrl,
              serviceId: body.serviceId || '',
              secret: slotSecret
            });

            if (firstSecret === undefined) firstSecret = result.secret;
            clusterBots.push({
              worker: result.worker,
              secret: result.secret,
              slot
            });
            added.push(result.worker);
          } catch (err) {
            skipped.push({ url: rawUrl, slot, reason: err.message });
          }
        }

        if (clusterBots.length > 0) {
          const header = isWispPanel
            ? `# Cấu hình Wispbyte Pull (từ link panel): ${rawUrl}`
            : `# Cấu hình Worker: ${rawUrl}`;
          const transportLine = `WORKER_TRANSPORT=${provider === 'render' ? 'render-http' : 'wispbyte-poll'}\n`;
          const countLine = slots > 1 ? `WORKER_BOT_COUNT=${slots}\n` : '';
          const nodeOptsLine = provider !== 'render' ? 'NODE_OPTIONS=--max-old-space-size=400\n' : '';
          let envChunk = `${header}\n${transportLine}${countLine}`;
          clusterBots.forEach((cb) => {
            envChunk += `WORKER_ID_${cb.slot}=${cb.worker.workerId}\n`;
          });
          envChunk += nodeOptsLine;
          envConfigs.push(envChunk.trim());
        }
      }

      if (added.length === 0) {
        return res.status(400).json({
          ok: false,
          error: skipped[0]?.reason || 'Không có URL hoặc worker hợp lệ để thêm.',
          skipped
        });
      }

      await store.addAudit?.({
        action: 'ADMIN_CREATE_BOT',
        targetId: added.map((b) => b.workerId).join(','),
        actorId: req.managerAuthSession.username,
        actorRole: 'admin',
        actorIp,
        details: { addedCount: added.length, skippedCount: skipped.length }
      }).catch(() => null);

      const totalEnv = envConfigs.join('\n\n');
      return res.status(201).json({
        ok: true,
        message: `Đã thêm thành công ${added.length} Bot!` + (skipped.length ? ` (Bỏ qua ${skipped.length})` : ''),
        bots: added,
        bot: added[0],
        secret: firstSecret,
        envConfig: totalEnv,
        skipped
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.post('/bots/batch-import', async (req, res) => {
    try {
      const botsToImport = Array.isArray(req.body?.bots) ? req.body.bots : [];
      if (!botsToImport.length) {
        return res.status(400).json({ ok: false, error: 'Danh sách bot nhập trống.' });
      }
      if (botsToImport.length > 50) {
        return res.status(400).json({ ok: false, error: 'Chỉ được nhập tối đa 50 bot mỗi lần.' });
      }

      const added = [];
      const skipped = [];
      for (const item of botsToImport) {
        try {
          const rawUrl = String(item.url || item.serviceUrl || '').trim();
          const serviceId = String(item.renderServiceId || item.serviceId || '').trim();
          const isHttpUrl = /^https?:\/\//i.test(rawUrl);
          const isWispPanel = isHttpUrl && isWispbyteControlPanelUrl(rawUrl);
          const explicitProvider = String(item.provider || '').trim().toLowerCase();
          const provider = isWispPanel
            ? 'wispbyte'
            : ((explicitProvider === 'render' || explicitProvider === 'wispbyte') ? explicitProvider : (isHttpUrl ? 'render' : 'wispbyte'));
          if (provider === 'render' && !rawUrl && !serviceId) {
            throw new Error('Render worker cần có URL HTTPS hoặc Render service ID.');
          }
          const validatedUrl = (!isWispPanel && rawUrl) ? await validateWorkerBotUrl(rawUrl) : '';
          const safeUrl = (isWispPanel || provider === 'wispbyte') ? '' : validatedUrl;
          const result = await registry.add({
            name: item.label || item.name,
            provider,
            serviceUrl: safeUrl,
            serviceId
          });
          added.push(result.worker);
        } catch (err) {
          skipped.push({ item, reason: err.message });
        }
      }

      await store.addAudit?.({
        action: 'ADMIN_BATCH_IMPORT_BOTS',
        actorId: req.managerAuthSession.username,
        actorRole: 'admin',
        actorIp: resolveClientIp(req) || '127.0.0.1',
        details: { addedCount: added.length, skippedCount: skipped.length }
      }).catch(() => null);

      return res.json({
        ok: true,
        message: `Đã nhập thành công ${added.length} bot.` + (skipped.length ? ` (Bỏ qua ${skipped.length})` : ''),
        addedCount: added.length,
        skippedCount: skipped.length,
        bots: added,
        skipped
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.delete(['/bot/:id', '/bots/:id'], async (req, res) => {
    try {
      const worker = await resolveWorker(req.params.id);
      if (!worker) return res.status(404).json({ ok: false, error: 'Không tìm thấy bot cần xóa.' });

      await registry.remove(worker.workerId);
      await store?.removeWorkerAssignments?.(worker.workerId);
      await store.addAudit({
        action: 'ADMIN_DELETE_BOT',
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        actorRole: 'admin',
        actorIp: resolveClientIp(req) || '127.0.0.1',
        details: { botNumber: worker.botNumber, name: worker.name }
      });

      return res.json({ ok: true, message: `Đã xóa Bot #${worker.botNumber || worker.workerId} thành công.` });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.patch('/bot/:id', async (req, res) => {
    try {
      const worker = await resolveWorker(req.params.id);
      if (!worker) return res.status(404).json({ ok: false, error: 'Không tìm thấy bot cần sửa.' });

      const body = req.body || {};
      const patch = {};
      const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
      if (has('label') || has('alias') || has('name')) patch.alias = body.label ?? body.alias ?? body.name;
      if (has('tags')) {
        if (!Array.isArray(body.tags)) return res.status(400).json({ ok: false, error: 'Tags phải là một danh sách.' });
        patch.tags = body.tags;
      }
      if (has('rentable')) {
        if (typeof body.rentable !== 'boolean') return res.status(400).json({ ok: false, error: 'Trạng thái cho thuê không hợp lệ.' });
        patch.rentable = body.rentable;
      }
      if (has('provider')) {
        const nextProvider = String(body.provider || '').trim().toLowerCase();
        if (!['render', 'wispbyte'].includes(nextProvider)) {
          return res.status(400).json({ ok: false, error: 'Provider phải là render hoặc wispbyte.' });
        }
        patch.provider = nextProvider;
      }
      if (has('url') || has('serviceUrl')) {
        const rawServiceUrl = body.url ?? body.serviceUrl;
        if (typeof rawServiceUrl !== 'string') {
          return res.status(400).json({ ok: false, error: 'URL bot không hợp lệ.' });
        }
        const serviceUrl = rawServiceUrl.trim().replace(/\/+$/, '');
        if (serviceUrl && isWispbyteControlPanelUrl(serviceUrl)) {
          patch.serviceUrl = '';
          patch.provider = 'wispbyte';
        } else {
          if (serviceUrl) {
            try {
              await validateWorkerBotUrl(serviceUrl);
            } catch (ssrfErr) {
              return res.status(400).json({ ok: false, error: ssrfErr.message || 'Worker URL bị chặn do chính sách bảo mật (SSRF).' });
            }
          }
          if (!serviceUrl && !worker.renderServiceId) {
            if (patch.provider === 'render') {
              return res.status(400).json({ ok: false, error: 'Render worker cần URL hoặc Render service ID.' });
            }
            if (!patch.provider && worker.provider === 'render') {
              patch.provider = 'wispbyte';
            }
          }
          patch.serviceUrl = patch.provider === 'wispbyte' ? '' : serviceUrl;
        }
      }
      if (patch.provider === 'wispbyte' && !Object.hasOwn(patch, 'serviceUrl')) {
        patch.serviceUrl = '';
      }
      if (patch.provider === 'render') {
        const candidateUrl = Object.hasOwn(patch, 'serviceUrl')
          ? patch.serviceUrl
          : (isWispbyteControlPanelUrl(worker.serviceUrl) ? '' : String(worker.serviceUrl || '').trim());
        if (!candidateUrl && !worker.renderServiceId) {
          return res.status(400).json({ ok: false, error: 'Render worker cần URL hoặc Render service ID.' });
        }
      }

      const rawSecret = body.secretKey ?? body.secret;
      const secret = typeof rawSecret === 'string' ? rawSecret.trim() : '';
      if (!Object.keys(patch).length && !secret) {
        return res.status(400).json({ ok: false, error: 'Không có thông tin nào để cập nhật.' });
      }

      if (Object.keys(patch).length) await registry.updateSettings(worker.workerId, patch);
      if (secret) await registry.setSecret(worker.workerId, secret);
      const rawUpdated = await registry.find(worker.workerId, { bypassCache: true });
      const updated = registry.publicView(rawUpdated) || rawUpdated;
      if (updated?.provider === 'render' && broker && typeof broker.wakePoller === 'function') {
        broker.wakePoller(worker.workerId);
      }
      await store.addAudit({
        action: 'ADMIN_UPDATE_BOT',
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        actorRole: 'admin',
        actorIp: resolveClientIp(req) || '127.0.0.1',
        details: {
          label: updated.alias || updated.name,
          tags: updated.tags || [],
          rentable: updated.rentable !== false,
          provider: updated.provider,
          serviceUrlChanged: has('url') || has('serviceUrl'),
          secretChanged: Boolean(secret)
        }
      });
      return res.json({
        ok: true,
        message: 'Đã cập nhật bot.',
        bot: {
          id: String(updated.workerId),
          workerId: String(updated.workerId),
          botNumber: updated.botNumber,
          label: updated.alias || updated.name,
          tags: updated.tags || [],
          rentable: updated.rentable !== false,
          provider: updated.provider,
          url: updated.serviceUrl || '',
          renderServiceId: updated.renderServiceId || ''
        }
      });
    } catch (error) {
      const status = (error?.status >= 400 && error?.status < 500)
        || /Provider must be|Render workers need|Worker URL|Proxy |must be an array|không hợp lệ|Wispbyte/i.test(error?.message || '')
        ? (error?.status >= 400 && error?.status < 500 ? error.status : 400)
        : 500;
      return res.status(status).json({ ok: false, error: error.message });
    }
  });

  router.get('/bot/:id/env', async (req, res) => {
    try {
      const worker = await resolveWorker(req.params.id);
      if (!worker) return res.status(404).json({ ok: false, error: 'Không tìm thấy bot.' });

      const provider = String(worker.provider || 'wispbyte').trim().toLowerCase() === 'render' ? 'render' : 'wispbyte';
      const transport = provider === 'render' ? 'render-http' : 'wispbyte-poll';
      const managerBaseUrl = resolveRequestOrigin(req, config?.publicBaseUrl || DEFAULT_PUBLIC_MANAGER_URL);
      const vars = {
        WORKER_TRANSPORT: transport,
        WORKER_ID_1: String(worker.workerId),
        ...(provider === 'wispbyte' ? { NODE_OPTIONS: '--max-old-space-size=400' } : {})
      };
      const envText = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n');

      await store.addAudit?.({
        action: 'ADMIN_EXPORT_BOT_ENV',
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        actorRole: 'admin',
        actorIp: resolveClientIp(req) || '127.0.0.1',
        details: { provider, transport, idOnly: true }
      }).catch(() => {});

      return res.json({
        ok: true,
        workerId: String(worker.workerId),
        botNumber: worker.botNumber ?? null,
        provider,
        transport,
        managerUrl: managerBaseUrl,
        idOnly: true,
        vars,
        envText
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/bot/:id/reset-customer', async (req, res) => {
    try {
      const worker = await resolveWorker(req.params.id);
      if (!worker) return res.status(404).json({ ok: false, error: 'Không tìm thấy bot.' });

      // Guarantee physical in-memory Minecraft session disconnects
      if (broker && typeof broker.dispatch === 'function') {
        try {
          await broker.dispatch(worker.workerId, 'stop', { reason: 'reset-customer' });
        } catch (dispatchErr) {
          logger?.warn?.('DISPATCH_STOP_FAILED_ON_RESET_CUSTOMER', {
            workerId: worker.workerId,
            error: dispatchErr.message
          });
        }
      }

      await registry.resetData(worker.workerId);
      await store?.removeWorkerAssignments?.(worker.workerId);
      await store.addAudit({
        action: 'ADMIN_RESET_BOT_CUSTOMER',
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        actorRole: 'admin',
        actorIp: resolveClientIp(req) || '127.0.0.1',
        details: { reason: 'admin_manually_reset_customer_bot' }
      });

      return res.json({ ok: true, message: `Đã đặt lại dữ liệu Bot #${worker.botNumber || worker.workerId} về mặc định.` });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 3. AUDIT LOGS
  function filterAuditLogsList(logsArray, { q = '', category = '', status = '', logType = '' } = {}) {
    let filtered = logsArray;
    if (q) {
      filtered = filtered.filter((log) => {
        const actionStr = String(log.action || '').toLowerCase();
        const labelStr = String(log.actionLabel || '').toLowerCase();
        const actorStr = String(log.actor?.username || log.actorId || log.actor || log.user || '').toLowerCase();
        const targetStr = (typeof log.target === 'object' ? JSON.stringify(log.target) : String(log.target || log.targetId || '')).toLowerCase();
        const messageStr = String(log.message || log.msg || '').toLowerCase();
        let detailsStr = '';
        if (log.details) {
          detailsStr = typeof log.details === 'object' ? JSON.stringify(log.details).toLowerCase() : String(log.details).toLowerCase();
        }
        return actionStr.includes(q) ||
          labelStr.includes(q) ||
          actorStr.includes(q) ||
          targetStr.includes(q) ||
          messageStr.includes(q) ||
          detailsStr.includes(q);
      });
    }
    if (category) {
      filtered = filtered.filter((log) => String(log.category || log.details?.category || '').toLowerCase() === category);
    }
    if (status) {
      filtered = filtered.filter((log) => String(log.status || log.details?.status || '').toLowerCase() === status);
    }
    if (logType && logType !== 'all') {
      filtered = filtered.filter((log) => {
        const raw = String(log.logType || log.details?.logType || '').toLowerCase();
        const normalized = raw === 'manager' ? 'system' : raw;
        return normalized === logType;
      });
    }
    return filtered;
  }

  async function queryAuditLogs({ page = 1, limit = 50, q = '', category = '', status = '', logType = '' } = {}) {
    const startIndex = (page - 1) * limit;
    if (typeof store.queryAudit === 'function') {
      const resObj = await store.queryAudit({ page, limit, q, category, status, logType });
      if (resObj && Array.isArray(resObj.logs)) {
        const total = Number.isFinite(Number(resObj.total)) ? Number(resObj.total) : resObj.logs.length;
        return { logs: resObj.logs, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
      }
    }

    if (store?.client && typeof store.client.from === 'function') {
      try {
        const upperCategory = category ? String(category).toUpperCase() : '';
        const upperStatus = status ? String(status).toUpperCase() : '';
        const upperLogType = logType && logType !== 'all' ? String(logType).toUpperCase() : '';
        let query = store.client.from('audit_logs').select('*', { count: 'exact' });
        if (upperCategory && typeof query?.eq === 'function') query = query.eq('category', upperCategory);
        if (upperStatus && typeof query?.eq === 'function') query = query.eq('status', upperStatus);
        if (upperLogType) {
          if (upperLogType === 'SYSTEM' && typeof query?.in === 'function') {
            query = query.in('log_type', ['SYSTEM', 'MANAGER']);
          } else if (typeof query?.eq === 'function') {
            query = query.eq('log_type', upperLogType);
          }
        }
        if (typeof query?.order === 'function') query = query.order('timestamp', { ascending: false });
        if (!q && typeof query?.range === 'function') {
          const { data, error, count } = await query.range(startIndex, startIndex + limit - 1);
          if (!error && Array.isArray(data)) {
            const total = Number.isFinite(Number(count)) ? Number(count) : data.length;
            return { logs: data, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
          }
        } else if (typeof query?.limit === 'function') {
          const { data, error } = await query.limit(2000);
          if (!error && Array.isArray(data)) {
            const filtered = filterAuditLogsList(data, { q, category, status, logType });
            return {
              logs: filtered.slice(startIndex, startIndex + limit),
              total: filtered.length,
              totalPages: Math.max(1, Math.ceil(filtered.length / limit))
            };
          }
        }
      } catch (_) {}
    }

    const hasFilters = Boolean(q || category || status || logType);
    const fetchLimit = hasFilters ? Math.min(2000, Math.max(500, page * limit)) : Math.min(500, page * limit);
    const allLogs = await store.listAudit(fetchLimit);
    const logsArray = Array.isArray(allLogs) ? allLogs : [];
    const filtered = filterAuditLogsList(logsArray, { q, category, status, logType });
    return {
      logs: filtered.slice(startIndex, startIndex + limit),
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit))
    };
  }

  router.get('/audit-logs', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query?.limit, 10) || 50));
      const q = String(req.query?.q || '').trim().toLowerCase();
      const category = String(req.query?.category || '').trim().toLowerCase();
      const status = String(req.query?.status || '').trim().toLowerCase();
      const logType = String(req.query?.logType || '').trim().toLowerCase();

      const { logs, total, totalPages } = await queryAuditLogs({ page, limit, q, category, status, logType });
      return res.json({
        ok: true,
        logs,
        page,
        limit,
        total,
        totalPages
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/audit-logs/clear', async (req, res) => {
    try {
      if (typeof store.clearAuditLogs === 'function') {
        await store.clearAuditLogs();
      } else if (store.client) {
        const { error } = await store.client.from('audit_logs').delete().neq('id', '');
        if (error) throw error;
      }
      return res.json({ ok: true, message: 'Đã xóa toàn bộ nhật ký kiểm toán.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get('/audit-logs/export', async (req, res) => {
    try {
      const q = String(req.query?.q || '').trim().toLowerCase();
      const category = String(req.query?.category || '').trim().toLowerCase();
      const status = String(req.query?.status || '').trim().toLowerCase();
      const logType = String(req.query?.logType || '').trim().toLowerCase();
      const { logs } = await queryAuditLogs({ page: 1, limit: 1000, q, category, status, logType });
      const format = String(req.query?.format || 'json').toLowerCase();
      if (format === 'csv') {
        const headers = ['id', 'timestamp', 'log_type', 'category', 'actor', 'role', 'ip', 'action', 'target', 'status', 'details'];
        const rows = logs.map((l) => [
          l.id || '',
          l.timestamp || l.createdAt || '',
          l.logType || 'SYSTEM',
          l.category || 'SYSTEM',
          l.actor?.username || l.actorId || 'system',
          l.actor?.role || l.actorRole || 'system',
          l.actor?.ip || l.actorIp || '',
          l.action || '',
          l.target || l.targetId || '',
          l.status || 'SUCCESS',
          l.details || {}
        ].map(csvEscapeCell).join(','));
        const csv = [headers.join(','), ...rows].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="audit_logs.csv"');
        return res.send(csv);
      }
      return res.json({ ok: true, logs });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 4. GIFTCODES & LICENSE KEYS
  router.get('/keys', async (req, res) => {
    try {
      const keys = await entitlementService.listCodes(200);
      return res.json({ ok: true, keys });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/keys', async (req, res) => {
    try {
      const { days, permanent, botCount, workerIds, maxUses, planName, count, customKey, validDays } = req.body || {};
      const requestedCount = count === undefined || count === null || String(count).trim() === '' ? 1 : Number(count);
      if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 50) {
        return res.status(400).json({ ok: false, error: 'Số lượng mã phải từ 1 đến 50.' });
      }
      if (customKey !== undefined && customKey !== null && typeof customKey !== 'string') {
        return res.status(400).json({ ok: false, error: 'Mã tự đặt phải là chuỗi ký tự.' });
      }
      const numKeys = requestedCount;
      if (customKey && numKeys !== 1) {
        return res.status(400).json({ ok: false, error: 'Mã tự đặt chỉ tạo được một mã mỗi lần.' });
      }

      let parsedDays = 30;
      if (days !== undefined && days !== null) {
        if (typeof days === 'string' && days.trim() === '') {
          return res.status(400).json({ ok: false, error: 'Số ngày sử dụng (days) phải là số nguyên từ 1 đến 36500.' });
        }
        const d = Number(days);
        if (!Number.isInteger(d) || d < 1 || d > 36500) {
          return res.status(400).json({ ok: false, error: 'Số ngày sử dụng (days) phải là số nguyên từ 1 đến 36500.' });
        }
        parsedDays = d;
      }

      let parsedBotCount = 1;
      if (botCount !== undefined && botCount !== null) {
        if (typeof botCount === 'string' && botCount.trim() === '') {
          return res.status(400).json({ ok: false, error: 'Số lượng bot (botCount) phải là số nguyên từ 1 đến 100.' });
        }
        const b = Number(botCount);
        if (!Number.isInteger(b) || b < 1 || b > 100) {
          return res.status(400).json({ ok: false, error: 'Số lượng bot (botCount) phải là số nguyên từ 1 đến 100.' });
        }
        parsedBotCount = b;
      }

      let parsedMaxUses = 1;
      if (maxUses !== undefined && maxUses !== null) {
        if (typeof maxUses === 'string' && maxUses.trim() === '') {
          return res.status(400).json({ ok: false, error: 'Số lượt sử dụng (maxUses) phải là số nguyên từ 1 đến 100000.' });
        }
        const m = Number(maxUses);
        if (!Number.isInteger(m) || m < 1 || m > 100000) {
          return res.status(400).json({ ok: false, error: 'Số lượt sử dụng (maxUses) phải là số nguyên từ 1 đến 100000.' });
        }
        parsedMaxUses = m;
      }

      let expiresAt = null;
      if (validDays !== undefined && validDays !== null && String(validDays).trim() !== '') {
        const daysValid = Number(validDays);
        if (!Number.isInteger(daysValid) || daysValid < 1 || daysValid > 36500) {
          return res.status(400).json({ ok: false, error: 'Hạn sử dụng mã phải từ 1 đến 36500 ngày.' });
        }
        expiresAt = new Date(Date.now() + daysValid * 86400000).toISOString();
      }
      const generated = [];

      for (let i = 0; i < numKeys; i++) {
        const key = await entitlementService.createCode({
          days: parsedDays,
          permanent: Boolean(permanent),
          botCount: parsedBotCount,
          workerIds: Array.isArray(workerIds) ? workerIds : [],
          maxUses: parsedMaxUses,
          planName: planName || 'Standard',
          customCode: customKey,
          expiresAt,
          actorId: req.managerAuthSession.username
        });
        generated.push(key);
      }

      await store.addAudit?.({
        action: 'ADMIN_CREATE_KEY',
        actorId: req.managerAuthSession.username,
        actorRole: 'admin',
        actorIp: resolveClientIp(req) || '127.0.0.1',
        details: { count: generated.length, days: parsedDays, botCount: parsedBotCount, maxUses: parsedMaxUses, permanent: Boolean(permanent) }
      }).catch(() => null);

      return res.status(201).json({ ok: true, message: `Đã tạo ${generated.length} mã Giftcode thành công.`, keys: generated });
    } catch (error) {
      const isValidation = /không hợp lệ|phải là|bắt buộc|tối đa|trùng|tồn tại|chỉ|fixed/i.test(error.message || '');
      return res.status(isValidation ? 400 : 500).json({ ok: false, error: error.message });
    }
  });

  router.delete('/keys/:keyId', async (req, res) => {
    try {
      await entitlementService.deleteCode(req.params.keyId);
      return res.json({ ok: true, message: 'Đã xóa mã Giftcode.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 4b. IP WHITELIST MANAGEMENT (Anti-bot multi-account exemption)
  router.get('/ip-whitelist', async (_req, res) => {
    try {
      const list = typeof store.listIpWhitelist === 'function' ? await store.listIpWhitelist() : [];
      return res.json({ ok: true, whitelist: list });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/ip-whitelist', async (req, res) => {
    try {
      const { ip, reason } = req.body || {};
      const cleanIp = String(ip || '').trim();
      if (!cleanIp) {
        return res.status(400).json({ ok: false, error: 'Vui lòng cung cấp địa chỉ IP.' });
      }
      if (typeof store.addIpWhitelist === 'function') {
        await store.addIpWhitelist({ ip: cleanIp, reason, createdBy: req.managerAuthSession?.username || 'admin' });
      }
      return res.json({ ok: true, message: `Đã thêm IP ${cleanIp} vào Whitelist thành công.` });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.delete('/ip-whitelist/:ip', async (req, res) => {
    try {
      const ip = req.params?.ip;
      if (typeof store.removeIpWhitelist === 'function') {
        await store.removeIpWhitelist(ip);
      }
      return res.json({ ok: true, message: `Đã xóa IP ${ip} khỏi Whitelist.` });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 5. SUPABASE CLOUD MANAGEMENT
  router.get('/supabase/status', async (_req, res) => {
    const isEnabled = Boolean(store.adapter && store.adapter.isEnabled());
    let pingMs = 0;
    let connected = false;
    if (isEnabled) {
      const start = Date.now();
      try {
        const checkFn = typeof store.adapter.ping === 'function'
          ? () => store.adapter.ping()
          : () => store.adapter.testConnection();
        const testRes = await checkFn();
        connected = Boolean(testRes?.ok);
        pingMs = Date.now() - start;
      } catch (_) {}
    }
    return res.json({
      ok: true,
      enabled: isEnabled,
      connected,
      pingMs,
      url: store.adapter?.url ? store.adapter.url.slice(0, 20) + '...' : null
    });
  });

  router.get('/supabase/schema', (req, res) => {
    const accept = String(req.headers?.accept || '').toLowerCase();
    if (req.query?.format === 'text' || (accept.includes('text/plain') && !accept.includes('application/json'))) {
      return res.type('text/plain').send(SCHEMA_SQL);
    }
    return res.json({ ok: true, sql: SCHEMA_SQL });
  });

  router.post('/supabase/upload', async (req, res) => {
    try {
      await registry.save();
      return res.json({ ok: true, message: 'Đã đẩy dữ liệu Registry và trạng thái lên Supabase.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/supabase/sync-down', async (_req, res) => {
    try {
      store?.invalidateCache?.();
      registry?.store?.invalidateCache?.();
      await registry.load();
      return res.json({ ok: true, message: 'Đã làm mới cache và đồng bộ dữ liệu mới nhất từ Supabase về RAM.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/supabase/test', async (_req, res) => {
    try {
      if (store.adapter && typeof store.adapter.testConnection === 'function') {
        const result = await store.adapter.testConnection();
        return res.json(result || { ok: true, message: 'Kết nối Supabase ổn định.' });
      }
      return res.json({ ok: true, message: 'Kết nối Supabase sẵn sàng.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/supabase/config', async (_req, res) => {
    return res.status(501).json({ ok: false, error: 'Cập nhật cấu hình Supabase lúc runtime không được hỗ trợ.' });
  });

  // 6. CLOUD BACKUPS
  router.get('/backups', async (_req, res) => {
    try {
      const backups = await store.fetchBackups();
      return res.json({ ok: true, backups });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  async function fetchAllKeysForBackup() {
    if (store?.client && typeof store.client.from === 'function') {
      try {
        const pageSize = 500;
        const all = [];
        for (let offset = 0; offset < 50000; offset += pageSize) {
          const { data, error } = await store.client
            .from('manager_keys')
            .select('*')
            .order('created_at', { ascending: false })
            .range(offset, offset + pageSize - 1);
          if (error) throw error;
          if (!Array.isArray(data) || data.length === 0) break;
          all.push(...data);
          if (data.length < pageSize) break;
        }
        return all;
      } catch (_) {}
    }
    if (entitlementService?.listCodes) {
      return await entitlementService.listCodes(5000);
    }
    return [];
  }

  async function fetchAllSettingsForBackup() {
    if (store?.client && typeof store.client.from === 'function') {
      try {
        const { data, error } = await store.client.from('manager_settings').select('key,value');
        if (!error && Array.isArray(data)) {
          const out = {};
          for (const row of data) {
            if (row?.key) out[row.key] = row.value;
          }
          return out;
        }
      } catch (_) {}
    }
    if (typeof store?.getSetting === 'function') {
      const settingsObj = {};
      for (const k of ['system_settings', 'system_announcement', 'system_maintenance', 'webhook_settings', 'discord_access', 'link4m_runtime', 'manager_runtime']) {
        const val = await store.getSetting(k).catch(() => null);
        if (val !== null && val !== undefined) settingsObj[k] = val;
      }
      return settingsObj;
    }
    return {};
  }

  async function buildBackupPayload() {
    const [workers, accessUsers, keys, settings] = await Promise.all([
      registry.list(),
      store.listAccess(),
      fetchAllKeysForBackup(),
      fetchAllSettingsForBackup()
    ]);
    // Preserve encrypted passwords in backups so restore never wipes user login credentials
    let rawPasswordMap = new Map();
    if (store?.client && typeof store.client.from === 'function') {
      try {
        const PAGE_SIZE = 1000;
        let offset = 0;
        while (true) {
          const query = store.client.from('manager_users').select('id,username,password');
          const { data, error } = typeof query?.range === 'function'
            ? await query.range(offset, offset + PAGE_SIZE - 1)
            : await query;
          if (error || !Array.isArray(data) || data.length === 0) break;
          for (const row of data) {
            if (row?.id && row.password) rawPasswordMap.set(String(row.id), row.password);
            if (row?.username && row.password) rawPasswordMap.set(String(row.username).toLowerCase(), row.password);
          }
          if (typeof query?.range !== 'function' || data.length < PAGE_SIZE) break;
          offset += PAGE_SIZE;
        }
      } catch (_) {}
    }
    const usersWithCreds = (Array.isArray(accessUsers) ? accessUsers : []).map((u) => {
      const pw = rawPasswordMap.get(String(u.userId || u.id || '')) || rawPasswordMap.get(String(u.username || '').toLowerCase());
      return pw ? { ...u, password: pw } : { ...u };
    });
    return {
      version: 2,
      registry: workers,
      users: usersWithCreds,
      keys: Array.isArray(keys) ? keys : [],
      settings: settings && typeof settings === 'object' ? settings : {},
      timestamp: new Date().toISOString()
    };
  }

  router.post('/backups/create', async (req, res) => {
    try {
      const name = 'backup-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
      const payload = await buildBackupPayload();
      await store.saveBackup(name, payload);
      await store.addAudit({
        action: 'ADMIN_CREATE_BACKUP',
        actorId: req.managerAuthSession.username,
        actorRole: 'admin',
        actorIp: resolveClientIp(req) || '127.0.0.1',
        details: { filename: name, users: payload.users.length, workers: payload.registry.length, keys: payload.keys.length }
      });
      return res.json({ ok: true, message: 'Đã tạo bản sao lưu thành công.', filename: name, backup: { filename: name } });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/backups/:filename/restore', async (req, res) => {
    try {
      const { filename } = req.params;
      if (!filename || !/^[a-zA-Z0-9._-]+$/.test(filename)) {
        return res.status(400).json({ ok: false, error: 'Tên bản sao lưu không hợp lệ.' });
      }
      const backup = await store.fetchBackupPayload(filename);
      if (!backup) return res.status(404).json({ ok: false, error: 'Không tìm thấy bản sao lưu.' });

      // Create automatic safety backup before mutating live state (M-07a)
      if (typeof store.saveBackup === 'function') {
        try {
          const safetyName = 'pre-restore-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.json';
          const currentPayload = await buildBackupPayload();
          await store.saveBackup(safetyName, currentPayload);
        } catch (safetyErr) {
          logger?.warn?.('backup_pre_restore_snapshot_failed', { error: safetyErr?.message });
        }
      }

      const summary = { workersRestored: 0, usersRestored: 0, keysRestored: 0, settingsRestored: 0, warnings: [] };

      // 1. Restore registry (idempotent: updates existing or recreates deleted workers)
      if (Array.isArray(backup.registry)) {
        for (const bot of backup.registry) {
          if (bot?.workerId) {
            try {
              await registry.saveConfig(bot.workerId, bot);
              summary.workersRestored += 1;
            } catch (botErr) {
              summary.warnings.push(`worker:${bot.workerId}: ${botErr.message}`);
            }
          }
        }
      } else if (backup.registry && typeof backup.registry === 'object' && typeof registry.saveConfig === 'function') {
        for (const [wid, bot] of Object.entries(backup.registry)) {
          const targetId = bot?.workerId || wid;
          if (targetId && bot && typeof bot === 'object') {
            try {
              await registry.saveConfig(targetId, { ...bot, workerId: targetId });
              summary.workersRestored += 1;
            } catch (botErr) {
              summary.warnings.push(`worker:${targetId}: ${botErr.message}`);
            }
          }
        }
      }

      // 2. Restore users & revoke existing sessions so restored status/credentials apply immediately (API-04)
      if (Array.isArray(backup.users)) {
        for (const u of backup.users) {
          const userId = u.userId || u.id || u.username;
          if (userId) {
            try {
              if (typeof store.setAccess === 'function') {
                await store.setAccess(userId, u, 'backup-restore');
              } else if (typeof store.updateUser === 'function') {
                await store.updateUser(userId, u);
              } else if (typeof store.createUser === 'function') {
                await store.createUser(u);
              }
              await revokeAllUserSessions(userId, u);
              summary.usersRestored += 1;
            } catch (userErr) {
              summary.warnings.push(`user:${userId}: ${userErr.message}`);
            }
          }
        }
      }

      // 3. Restore keys idempotently (skip duplicates cleanly instead of aborting)
      if (Array.isArray(backup.keys)) {
        for (const k of backup.keys) {
          try {
            if (store.client && typeof store.client.from === 'function') {
              const keyId = k.keyId || k.key_id || k.id || `key_${crypto.randomUUID()}`;
              const rawCode = String(k.code || k.key || k.keyCode || '').trim();
              const normalizedCode = rawCode.toUpperCase().replace(/[^A-Z0-9-]/g, '');
              const computedHash = normalizedCode
                ? crypto.createHash('sha256').update(normalizedCode).digest('hex')
                : '';
              const row = {
                id: k.id || keyId,
                key_id: keyId,
                code: rawCode,
                code_hash: k.codeHash || k.code_hash || computedHash,
                code_suffix: k.codeSuffix || k.code_suffix || (rawCode ? rawCode.slice(-4) : ''),
                status: k.status || 'unused',
                days: Number(k.days ?? 30),
                is_permanent: Boolean(k.isPermanent ?? k.is_permanent),
                bot_count: Number(k.botCount ?? k.bot_count ?? 1),
                worker_ids: Array.isArray(k.workerIds || k.worker_ids) ? (k.workerIds || k.worker_ids) : [],
                allow_account_change: (k.allowAccountChange ?? k.allow_account_change) !== false,
                note: String(k.note || ''),
                plan_name: k.planName || k.plan_name || 'Standard',
                max_uses: Number(k.maxUses ?? k.max_uses ?? 1),
                used_count: Number(k.usedCount ?? k.used_count ?? 0),
                used_users: Array.isArray(k.usedUsers || k.used_users) ? (k.usedUsers || k.used_users) : [],
                expires_at: k.expiresAt || k.expires_at || null
              };
              const { error } = await store.client.from('manager_keys').upsert(row, { onConflict: 'key_id' });
              if (error && error.code !== '23505') throw error;
              if (!error) summary.keysRestored += 1;
            } else if (typeof store.createKey === 'function') {
              await store.createKey(k);
              summary.keysRestored += 1;
            }
          } catch (keyErr) {
            if (keyErr?.code !== '23505') {
              summary.warnings.push(`key:${k.keyId || k.id || '?'}: ${keyErr.message}`);
            }
          }
        }
      }

      // 4. Restore manager_settings when present (API-14)
      if (backup.settings && typeof backup.settings === 'object' && !Array.isArray(backup.settings)) {
        for (const [settingKey, settingVal] of Object.entries(backup.settings)) {
          if (!settingKey || settingVal === undefined) continue;
          try {
            if (typeof store?.setSetting === 'function') {
              await store.setSetting(settingKey, settingVal);
              summary.settingsRestored += 1;
            } else if (store?.client && typeof store.client.from === 'function') {
              const { error } = await store.client.from('manager_settings').upsert({
                key: settingKey,
                value: settingVal,
                updated_at: new Date().toISOString()
              }, { onConflict: 'key' });
              if (error) throw error;
              summary.settingsRestored += 1;
            }
          } catch (setErr) {
            summary.warnings.push(`setting:${settingKey}: ${setErr.message}`);
          }
        }
      }

      store?.invalidateCache?.();
      registry?.store?.invalidateCache?.();

      await store.addAudit({
        action: 'ADMIN_RESTORE_BACKUP',
        actorId: req.managerAuthSession.username,
        actorRole: 'admin',
        actorIp: resolveClientIp(req) || '127.0.0.1',
        details: { filename, ...summary }
      });
      return res.json({ ok: true, message: 'Đã khôi phục dữ liệu từ bản sao lưu.', summary });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.delete('/backups/:filename', async (req, res) => {
    try {
      const { filename } = req.params;
      if (!filename || !/^[a-zA-Z0-9._-]+$/.test(filename)) {
        return res.status(400).json({ ok: false, error: 'Tên bản sao lưu không hợp lệ.' });
      }

      if (typeof store.deleteBackup === 'function') {
        const deleted = await store.deleteBackup(filename);
        if (deleted === false) {
          return res.status(404).json({ ok: false, error: 'Không tìm thấy bản sao lưu hoặc xóa thất bại.' });
        }
      } else if (store.client) {
        const { error, count } = await store.client.from('manager_backups').delete({ count: 'exact' }).eq('name', filename);
        if (error) throw error;
        if (count === 0) {
          return res.status(404).json({ ok: false, error: 'Không tìm thấy bản sao lưu.' });
        }
      }

      await store.addAudit({
        action: 'ADMIN_DELETE_BACKUP',
        actorId: req.managerAuthSession.username,
        details: { filename }
      });
      return res.json({ ok: true, message: 'Đã xóa bản sao lưu.' });
    } catch (error) {
      if (error.status === 404 || error.statusCode === 404 || /not found|không tìm thấy/i.test(error.message)) {
        return res.status(404).json({ ok: false, error: error.message || 'Không tìm thấy bản sao lưu.' });
      }
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  async function getAssignedWorkerIdSet() {
    const set = new Set();
    try {
      if (typeof store?.listAccess === 'function') {
        const users = await store.listAccess();
        if (Array.isArray(users)) {
          for (const u of users) {
            const ids = Array.isArray(u.workerIds) ? u.workerIds : (Array.isArray(u.assignedBotIds) ? u.assignedBotIds : []);
            for (const id of ids) {
              const clean = String(id || '').trim().toLowerCase();
              if (clean) set.add(clean);
            }
          }
        }
      }
    } catch (_) {}
    return set;
  }

  // 7. BULK SETTINGS & LIFECYCLE CONTROLS
  router.post('/all/settings', async (req, res) => {
    try {
      const body = req.body || {};
      const tag = body.tag || '';
      const rawSettings = (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings))
        ? body.settings
        : body;
      const settingsPatch = {};
      for (const boolKey of ['ecoMode', 'autoTotem', 'antiHungry', 'autoReconnect', 'antiAfkKick', 'rentable']) {
        if (rawSettings[boolKey] !== undefined) settingsPatch[boolKey] = Boolean(rawSettings[boolKey]);
      }
      if (rawSettings.spawnCommands !== undefined) settingsPatch.spawnCommands = String(rawSettings.spawnCommands || '').slice(0, 1000);
      if (Array.isArray(body.autoChatSchedules)) settingsPatch.autoChatSchedules = body.autoChatSchedules;
      else if (Array.isArray(rawSettings.autoChatSchedules)) settingsPatch.autoChatSchedules = rawSettings.autoChatSchedules;
      if (Array.isArray(body.botSchedules)) settingsPatch.botSchedules = body.botSchedules;
      else if (Array.isArray(rawSettings.botSchedules)) settingsPatch.botSchedules = rawSettings.botSchedules;

      const [allWorkers, assignedSet] = await Promise.all([
        registry.list(),
        tag ? getAssignedWorkerIdSet() : Promise.resolve(new Set())
      ]);
      const targets = filterWorkersByTag(allWorkers, tag, assignedSet);
      let okCount = 0;
      let failedCount = 0;
      for (let i = 0; i < targets.length; i += 8) {
        const chunk = targets.slice(i, i + 8);
        const settled = await Promise.allSettled(
          chunk.map((worker) => registry.updateSettings(worker.workerId, settingsPatch))
        );
        for (const r of settled) {
          if (r.status === 'fulfilled') okCount += 1;
          else failedCount += 1;
        }
      }
      return res.json({
        ok: true,
        total: targets.length,
        okCount,
        failedCount,
        message: `Đã áp dụng cài đặt hàng loạt cho ${okCount}/${targets.length} bot.`
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/all/:action', async (req, res, next) => {
    const { action } = req.params;
    if (action === 'settings') return next();
    try {
      if (action === 'start') {
        const result = await fleetOperations.startAll({ respectManuallyStopped: false });
        return res.json({ ok: true, message: 'Đã gửi lệnh bật toàn bộ bot.', result });
      } else if (action === 'stop') {
        const result = await fleetOperations.stopAll();
        return res.json({ ok: true, message: 'Đã gửi lệnh tắt toàn bộ bot.', result });
      } else if (action === 'restart') {
        const result = typeof fleetOperations.restartAll === 'function'
          ? await fleetOperations.restartAll()
          : await fleetOperations.startAll({ respectManuallyStopped: false });
        return res.json({ ok: true, message: 'Đã gửi lệnh khởi động lại toàn bộ bot.', result });
      } else if (action === 'reconnect') {
        const result = await fleetOperations.reconnectErrors();
        return res.json({ ok: true, message: 'Đã gửi lệnh kết nối lại các bot bị lỗi.', result });
      }
      return res.status(400).json({ ok: false, error: 'Hành động không hợp lệ.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 8. ANNOUNCEMENT (F-03: persist & return full structured object)
  router.post('/announcement', async (req, res) => {
    try {
      const body = req.body || {};
      const title = String(body.title || '').trim().slice(0, 120);
      const content = String(body.content ?? body.announcement ?? body.message ?? '').trim().slice(0, 2000);
      const modeRaw = String(body.mode || 'daily').trim().toLowerCase();
      const mode = ['daily', 'every_login', 'time_range', 'banner', 'modal', 'toast'].includes(modeRaw) ? modeRaw : 'daily';
      const enabled = body.enabled !== undefined ? Boolean(body.enabled) : Boolean(content || title);
      const startDate = body.startDate ? String(body.startDate).trim().slice(0, 64) : '';
      const endDate = body.endDate ? String(body.endDate).trim().slice(0, 64) : '';
      const updatedAt = new Date().toISOString();
      const record = {
        id: String(body.id || `ann_${Date.now()}`),
        enabled,
        title,
        content,
        mode,
        startDate,
        endDate,
        updatedAt
      };
      if (store && typeof store.setSetting === 'function') {
        await store.setSetting('system_announcement', record);
      }
      store.cachedAnnouncement = record;
      store.cachedAnnouncementAt = Date.now();
      return res.json({ ok: true, message: 'Đã cập nhật thông báo hệ thống.', announcement: record });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 8.5. SYSTEM MAINTENANCE MODE (Lock / Reopen user worker controls)
  router.get('/maintenance', async (_req, res) => {
    try {
      const maintenance = await getMaintenanceState(store);
      return res.json({ ok: true, maintenance });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/maintenance', async (req, res) => {
    try {
      const body = req.body || {};
      const actor = req.managerAuthSession?.username || 'admin';
      const maintenance = await setMaintenanceState(
        store,
        {
          enabled: body.enabled,
          message: body.message
        },
        actor
      );
      if (typeof store?.addAudit === 'function') {
        await store.addAudit({
          action: 'ADMIN_SET_MAINTENANCE',
          targetId: 'system',
          actorId: actor,
          actorRole: 'admin',
          actorIp: resolveClientIp(req) || '127.0.0.1',
          details: {
            enabled: maintenance.enabled,
            message: maintenance.message
          }
        }).catch(() => {});
      }
      return res.json({
        ok: true,
        maintenance,
        message: maintenance.enabled
          ? 'Đã BẬT chế độ bảo trì — tạm khóa thao tác worker đối với người dùng.'
          : 'Đã TẮT chế độ bảo trì — đã mở lại thao tác worker cho người dùng.'
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 9. WEBHOOK (F-04 & M-09: never mutate frozen config; persist encrypted secrets in manager_settings)
  async function loadWebhookSettings() {
    let saved = null;
    if (typeof store?.getSetting === 'function') {
      saved = await store.getSetting('webhook_settings').catch(() => null);
    }
    const base = normalizeWebhookSettings({
      discordUrl: config?.discordWebhookUrl || '',
      telegramToken: config?.telegramBotToken || '',
      telegramChatId: config?.telegramChatId || '',
      ...(saved && typeof saved === 'object' ? saved : {})
    });
    const encKey = registry?.encryptionKey || config?.encryptionKey;
    if (saved?.discordUrlCiphertext && encKey) {
      try { base.discordUrl = decryptSecret(saved.discordUrlCiphertext, encKey) || base.discordUrl; } catch (_) {}
    }
    if (saved?.telegramTokenCiphertext && encKey) {
      try { base.telegramToken = decryptSecret(saved.telegramTokenCiphertext, encKey) || base.telegramToken; } catch (_) {}
    }
    return base;
  }

  function maskWebhookView(webhook) {
    return {
      ...webhook,
      discordUrl: webhook.discordUrl ? '********' : '',
      telegramToken: webhook.telegramToken ? '********' : ''
    };
  }

  router.get('/webhook', async (_req, res) => {
    try {
      const webhook = await loadWebhookSettings();
      const masked = maskWebhookView(webhook);
      return res.json({
        ok: true,
        webhook: masked,
        webhookUrl: masked.discordUrl
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/webhook', async (req, res) => {
    try {
      const saved = await loadWebhookSettings();
      const incoming = req.body?.webhook && typeof req.body.webhook === 'object' ? req.body.webhook : (req.body || {});
      const normalized = normalizeWebhookSettings(incoming);
      if (normalized.discordUrl === '********') normalized.discordUrl = saved.discordUrl;
      if (normalized.telegramToken === '********') normalized.telegramToken = saved.telegramToken;
      if (normalized.discordUrl) {
        normalized.discordUrl = validateDiscordWebhookUrl(normalized.discordUrl);
      }
      const encKey = registry?.encryptionKey || config?.encryptionKey;
      if ((normalized.discordUrl || normalized.telegramToken) && !encKey) {
        return res.status(500).json({
          ok: false,
          error: 'Chưa cấu hình MANAGER_ENCRYPTION_KEY nên không thể mã hóa và lưu thông tin Webhook/Token an toàn.'
        });
      }
      const toPersist = {
        enabled: normalized.enabled,
        discordUrl: '',
        discordUrlCiphertext: normalized.discordUrl ? encryptSecret(normalized.discordUrl, encKey) : null,
        telegramToken: '',
        telegramTokenCiphertext: normalized.telegramToken ? encryptSecret(normalized.telegramToken, encKey) : null,
        telegramChatId: normalized.telegramChatId,
        notifyOnOffline: normalized.notifyOnOffline,
        notifyOnRecover: normalized.notifyOnRecover,
        notifyOnLowTotem: normalized.notifyOnLowTotem,
        notifyOnLowHealth: normalized.notifyOnLowHealth,
        notifyOnDeath: normalized.notifyOnDeath,
        offlineThresholdMinutes: normalized.offlineThresholdMinutes,
        updatedAt: new Date().toISOString()
      };
      if (typeof store?.setSetting === 'function') {
        await store.setSetting('webhook_settings', toPersist);
      }
      if (adminNotifier && typeof adminNotifier.configureWebhook === 'function') {
        adminNotifier.configureWebhook(normalized);
      } else if (adminNotifier && typeof adminNotifier.setTelegramConfig === 'function') {
        adminNotifier.setTelegramConfig(normalized.telegramToken, normalized.telegramChatId);
      }
      const masked = maskWebhookView(normalized);
      return res.json({
        ok: true,
        message: 'Đã lưu cấu hình Webhook thông báo thành công.',
        webhook: masked,
        webhookUrl: masked.discordUrl
      });
    } catch (error) {
      const status = /Webhook URL|không đúng định dạng|HTTPS/i.test(error.message) ? 400 : 500;
      return res.status(status).json({ ok: false, error: error.message });
    }
  });

  router.post('/webhook/test', async (req, res) => {
    try {
      const saved = await loadWebhookSettings();
      const incoming = req.body?.webhook && typeof req.body.webhook === 'object' ? req.body.webhook : (req.body || {});
      const incomingDiscord = incoming.discordUrl !== undefined || incoming.webhookUrl !== undefined
        ? (incoming.discordUrl ?? incoming.webhookUrl)
        : undefined;
      const incomingToken = incoming.telegramToken;
      const target = normalizeWebhookSettings({
        ...saved,
        ...(incomingDiscord !== undefined && incomingDiscord !== '********' ? { discordUrl: incomingDiscord } : {}),
        ...(incomingToken !== undefined && incomingToken !== '********' ? { telegramToken: incomingToken } : {}),
        ...(incoming.telegramChatId !== undefined ? { telegramChatId: incoming.telegramChatId } : {})
      });
      if (target.discordUrl) {
        target.discordUrl = validateDiscordWebhookUrl(target.discordUrl);
      }

      const deliveredChannels = [];
      if (target.discordUrl) {
        const resp = await fetch(target.discordUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: '🔔 **KingMC Manager**: Kiểm tra kết nối Discord Webhook thành công!'
          }),
          redirect: 'manual',
          signal: AbortSignal.timeout(8000)
        });
        if (!resp.ok) {
          throw new Error(`Discord Webhook trả về HTTP ${resp.status}.`);
        }
        deliveredChannels.push('Discord Webhook');
      }
      if (target.telegramToken && target.telegramChatId) {
        const resp = await fetch(`https://api.telegram.org/bot${encodeURIComponent(target.telegramToken)}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: target.telegramChatId,
            text: '🔔 <b>KingMC Manager</b>: Kiểm tra kết nối Telegram thành công!',
            parse_mode: 'HTML'
          }),
          redirect: 'manual',
          signal: AbortSignal.timeout(8000)
        });
        if (!resp.ok) {
          throw new Error(`Telegram API trả về HTTP ${resp.status}.`);
        }
        deliveredChannels.push('Telegram');
      }
      if (deliveredChannels.length === 0 && adminNotifier && typeof adminNotifier.sendAlert === 'function') {
        await adminNotifier.sendAlert({
          source: 'KingMC Manager',
          event: 'webhook_test',
          message: '🔔 Đây là tin nhắn kiểm tra kết nối thông báo từ KingMC Manager.',
          level: 'info'
        });
        deliveredChannels.push('Admin Notifier');
      }
      return res.json({
        ok: true,
        channels: deliveredChannels,
        message: `Đã gửi tin nhắn kiểm tra thành công tới: ${deliveredChannels.join(', ') || 'hệ thống thông báo'}!`
      });
    } catch (error) {
      const status = /Webhook URL|HTTPS|định dạng/i.test(error.message) ? 400 : 500;
      return res.status(status).json({ ok: false, error: error.message });
    }
  });

  // 10. SYSTEM RUNTIME SETTINGS & ADMIN CREDENTIALS (M-09: never mutate frozen config!)
  let systemSettingsChain = Promise.resolve();

  function tryDecryptSystemSecret(ciphertext) {
    if (!ciphertext) return { present: false, ok: false, failed: false, value: '' };
    const encKey = registry?.encryptionKey || config?.encryptionKey;
    const prevKey = config?.previousEncryptionKey || null;
    if (!encKey) return { present: true, ok: false, failed: false, value: '' };
    try {
      const val = String(decryptSecret(ciphertext, encKey, prevKey) || '').trim();
      return val ? { present: true, ok: true, failed: false, value: val } : { present: true, ok: false, failed: true, value: '' };
    } catch (_) {
      return { present: true, ok: false, failed: true, value: '' };
    }
  }

  async function readPersistedSystemSettingsStrict() {
    if (typeof store?.getSetting === 'function') {
      const raw = await store.getSetting('system_settings', { bypassCache: true });
      if (!raw || typeof raw !== 'object') return null;
      const clean = { ...raw };
      delete clean.updatedAt;
      return clean;
    }
    if (store?.client) {
      const { data, error } = await Promise.resolve(
        store.client.from('manager_settings').select('value').eq('key', 'system_settings').maybeSingle()
      );
      if (error && error.code !== 'PGRST116') throw error;
      if (!data?.value || typeof data.value !== 'object') return null;
      const clean = { ...data.value };
      delete clean.updatedAt;
      return clean;
    }
    return null;
  }

  router.get('/settings/system', async (_req, res) => {
    try {
      const l4mCfg = link4mService?.publicConfig?.() || {};
      const defaultSettings = {
        publicBaseUrl: config.publicBaseUrl || '',
        renderApiKey: config.renderApiKey ? '********' : '',
        link4mRewardEnabled: l4mCfg.configuredEnabled ?? Boolean(config.link4mRewardEnabled),
        link4mMode: l4mCfg.mode || 'api',
        link4mUrl: l4mCfg.customUrl || '',
        link4mApiToken: (config.link4mApiToken || l4mCfg.hasApiToken || l4mCfg.providerConfigured) ? '********' : '',
        link4mRewardHours: Number(l4mCfg.rewardHours || config.link4mRewardHours || 12),
        link4mDailyLimit: Number(l4mCfg.dailyLimit || config.link4mDailyLimit || 2),
        link4mSecretKey: (config.link4mSecretKey || l4mCfg.hasSecretKey || l4mCfg.webhookConfigured) ? '********' : '',
        wispbyteEnabled: true,
        trialGiftEnabled: Boolean(config.trialGiftEnabled ?? false),
        trialDays: Number(config.trialDays || 3)
      };

      const persisted = await readPersistedSystemSettingsStrict();
      const persistedObj = persisted && typeof persisted === 'object' ? { ...persisted } : {};
      if (!persistedObj.publicBaseUrl && config.publicBaseUrl) {
        persistedObj.publicBaseUrl = config.publicBaseUrl;
      }

      const apiTokCheck = tryDecryptSystemSecret(persistedObj.link4mApiTokenCiphertext);
      const secKeyCheck = tryDecryptSystemSecret(persistedObj.link4mSecretKeyCiphertext);

      const mergedSettings = {
        ...defaultSettings,
        ...persistedObj
      };
      if (persistedObj.link4mRewardEnabled === undefined && l4mCfg.configuredEnabled !== undefined) {
        mergedSettings.link4mRewardEnabled = Boolean(l4mCfg.configuredEnabled);
      }
      if (persistedObj.link4mRewardHours === undefined && l4mCfg.rewardHours !== undefined) {
        mergedSettings.link4mRewardHours = Number(l4mCfg.rewardHours);
      }
      if (persistedObj.link4mDailyLimit === undefined && l4mCfg.dailyLimit !== undefined) {
        mergedSettings.link4mDailyLimit = Number(l4mCfg.dailyLimit);
      }
      mergedSettings.trialGiftEnabled = Boolean(mergedSettings.trialGiftEnabled);
      mergedSettings.trialDays = Number.isFinite(Number(mergedSettings.trialDays)) ? Number(mergedSettings.trialDays) : 3;
      mergedSettings.link4mRewardEnabled = Boolean(mergedSettings.link4mRewardEnabled);
      mergedSettings.link4mRewardHours = Number.isFinite(Number(mergedSettings.link4mRewardHours)) ? Number(mergedSettings.link4mRewardHours) : 12;
      mergedSettings.link4mDailyLimit = Number.isFinite(Number(mergedSettings.link4mDailyLimit)) ? Number(mergedSettings.link4mDailyLimit) : 2;
      mergedSettings.link4mMode = ['api', 'custom_url'].includes(String(mergedSettings.link4mMode || '').trim().toLowerCase())
        ? String(mergedSettings.link4mMode).trim().toLowerCase()
        : 'api';

      // Verify actual usable/decryptable secrets rather than trusting stale masked placeholders
      const hasValidApiToken = apiTokCheck.present
        ? !apiTokCheck.failed
        : Boolean(
            (l4mCfg.hasApiToken !== undefined ? l4mCfg.hasApiToken : (mergedSettings.link4mMode === 'api' && l4mCfg.providerConfigured)) ||
            (persistedObj.hasLink4mApiToken !== false && config.link4mApiToken)
          );
      const hasValidSecretKey = secKeyCheck.present
        ? !secKeyCheck.failed
        : Boolean(
            (l4mCfg.hasSecretKey !== undefined ? l4mCfg.hasSecretKey : l4mCfg.webhookConfigured) ||
            (persistedObj.hasLink4mSecretKey !== false && config.link4mSecretKey)
          );

      mergedSettings.link4mApiToken = hasValidApiToken ? '********' : '';
      mergedSettings.link4mSecretKey = hasValidSecretKey ? '********' : '';
      if (apiTokCheck.failed) mergedSettings.link4mTokenDecryptionFailed = true;
      if (secKeyCheck.failed) mergedSettings.link4mSecretDecryptionFailed = true;

      delete mergedSettings.link4mApiTokenCiphertext;
      delete mergedSettings.link4mSecretKeyCiphertext;

      return res.json({
        ok: true,
        settings: mergedSettings,
        ...mergedSettings
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/settings/system', (req, res) => {
    const run = async () => {
      try {
        const rawPatch = req.body || {};
        const patch = {};
        if (rawPatch.publicBaseUrl !== undefined) {
          patch.publicBaseUrl = validateHttpOrHttpsUrl(String(rawPatch.publicBaseUrl || '').trim().slice(0, 512), 'publicBaseUrl');
        }
        if (rawPatch.trialGiftEnabled !== undefined) patch.trialGiftEnabled = Boolean(rawPatch.trialGiftEnabled);
        if (rawPatch.trialDays !== undefined) {
          const daysNum = Number(rawPatch.trialDays);
          if (!Number.isInteger(daysNum) || daysNum < 1 || daysNum > 365) {
            return res.status(400).json({ ok: false, error: 'Số ngày dùng thử phải từ 1 đến 365.' });
          }
          patch.trialDays = daysNum;
        }
        if (rawPatch.wispbyteEnabled !== undefined) patch.wispbyteEnabled = Boolean(rawPatch.wispbyteEnabled);

        // Link4M settings fields
        if (rawPatch.link4mRewardEnabled !== undefined) patch.link4mRewardEnabled = Boolean(rawPatch.link4mRewardEnabled);
        if (rawPatch.link4mMode !== undefined) {
          const modeVal = String(rawPatch.link4mMode || 'api').trim().toLowerCase();
          patch.link4mMode = ['api', 'custom_url'].includes(modeVal) ? modeVal : 'api';
        }
        if (rawPatch.link4mUrl !== undefined) {
          patch.link4mUrl = validateHttpOrHttpsUrl(String(rawPatch.link4mUrl || '').trim().slice(0, 512), 'link4mUrl');
        }
        if (rawPatch.link4mRewardHours !== undefined) {
          const hrs = Number(rawPatch.link4mRewardHours);
          if (!Number.isInteger(hrs) || hrs < 1 || hrs > 48) {
            return res.status(400).json({ ok: false, error: 'Số giờ thưởng Link4M phải từ 1 đến 48.' });
          }
          patch.link4mRewardHours = hrs;
        }
        if (rawPatch.link4mDailyLimit !== undefined) {
          const lim = Number(rawPatch.link4mDailyLimit);
          if (!Number.isInteger(lim) || lim < 1 || lim > 10) {
            return res.status(400).json({ ok: false, error: 'Giới hạn lượt Link4M/ngày phải từ 1 đến 10.' });
          }
          patch.link4mDailyLimit = lim;
        }

        const currentRaw = await readPersistedSystemSettingsStrict();
        const currentSettings = currentRaw && typeof currentRaw === 'object' ? { ...currentRaw } : {};
        delete currentSettings.updatedAt;
        if (currentSettings.link4mApiToken === '********' && !currentSettings.link4mApiTokenCiphertext) {
          delete currentSettings.link4mApiToken;
        }
        if (currentSettings.link4mSecretKey === '********' && !currentSettings.link4mSecretKeyCiphertext) {
          delete currentSettings.link4mSecretKey;
        }

        const encKey = registry?.encryptionKey || config?.encryptionKey;
        let newApiToken = null;
        if (rawPatch.link4mApiToken !== undefined) {
          const rawTok = String(rawPatch.link4mApiToken || '').trim();
          if (rawTok !== '********') {
            if (rawTok && !encKey) {
              return res.status(500).json({ ok: false, error: 'Chưa cấu hình MANAGER_ENCRYPTION_KEY để mã hóa Link4M API token.' });
            }
            newApiToken = rawTok;
            patch.hasLink4mApiToken = Boolean(rawTok);
            patch.link4mApiToken = rawTok ? '********' : '';
            patch.link4mApiTokenCiphertext = rawTok ? encryptSecret(rawTok, encKey) : null;
          }
        }
        let newSecretKey = null;
        if (rawPatch.link4mSecretKey !== undefined) {
          const rawSec = String(rawPatch.link4mSecretKey || '').trim();
          if (rawSec !== '********') {
            if (rawSec && !encKey) {
              return res.status(500).json({ ok: false, error: 'Chưa cấu hình MANAGER_ENCRYPTION_KEY để mã hóa Link4M secret key.' });
            }
            newSecretKey = rawSec;
            patch.hasLink4mSecretKey = Boolean(rawSec);
            patch.link4mSecretKey = rawSec ? '********' : '';
            patch.link4mSecretKeyCiphertext = rawSec ? encryptSecret(rawSec, encKey) : null;
          }
        }

        const existingTokCheck = newApiToken === null ? tryDecryptSystemSecret(currentSettings.link4mApiTokenCiphertext) : null;
        const existingSecCheck = newSecretKey === null ? tryDecryptSystemSecret(currentSettings.link4mSecretKeyCiphertext) : null;
        const resolvedApiToken = newApiToken !== null
          ? newApiToken
          : (existingTokCheck?.ok ? existingTokCheck.value : null);
        const resolvedSecretKey = newSecretKey !== null
          ? newSecretKey
          : (existingSecCheck?.ok ? existingSecCheck.value : null);

        const mergedSettings = {
          publicBaseUrl: config.publicBaseUrl || '',
          renderApiKey: config.renderApiKey ? '********' : '',
          link4mRewardEnabled: Boolean(config.link4mRewardEnabled),
          link4mMode: 'api',
          link4mUrl: '',
          link4mRewardHours: Number(config.link4mRewardHours || 12),
          link4mDailyLimit: Number(config.link4mDailyLimit || 2),
          wispbyteEnabled: true,
          trialGiftEnabled: Boolean(config.trialGiftEnabled ?? false),
          trialDays: Number(config.trialDays || 3),
          ...currentSettings,
          ...patch
        };
        if (!mergedSettings.publicBaseUrl && config.publicBaseUrl) {
          mergedSettings.publicBaseUrl = config.publicBaseUrl;
        }
        const effectiveHasApiToken = Boolean(
          mergedSettings.link4mApiTokenCiphertext ||
          (mergedSettings.hasLink4mApiToken !== false && config.link4mApiToken)
        );
        const effectiveHasSecretKey = Boolean(
          mergedSettings.link4mSecretKeyCiphertext ||
          (mergedSettings.hasLink4mSecretKey !== false && config.link4mSecretKey)
        );
        mergedSettings.link4mApiToken = effectiveHasApiToken ? '********' : '';
        mergedSettings.link4mSecretKey = effectiveHasSecretKey ? '********' : '';

        if (typeof store.setSetting === 'function') {
          await store.setSetting('system_settings', mergedSettings);
        } else if (store.client) {
          const { error } = await store.client.from('manager_settings').upsert({
            key: 'system_settings',
            value: mergedSettings,
            updated_at: new Date().toISOString()
          }, { onConflict: 'key' });
          if (error) throw error;
        }

        // Sync durable manager_runtime secrets if ManagerRuntimeSettings is wired
        if (managerRuntimeSettings && typeof managerRuntimeSettings.update === 'function') {
          const rtPatch = {};
          if (patch.publicBaseUrl !== undefined) rtPatch.publicBaseUrl = mergedSettings.publicBaseUrl;
          if (resolvedApiToken !== null) rtPatch.link4mApiToken = resolvedApiToken;
          if (resolvedSecretKey !== null) rtPatch.link4mSecretKey = resolvedSecretKey;
          if (Object.keys(rtPatch).length > 0) {
            await managerRuntimeSettings.update(rtPatch);
          }
        }

        // Synchronize live Link4mService runtime config immediately without mutating frozen config in place
        if (link4mService) {
          if (typeof link4mService.configure === 'function' && (
            patch.link4mRewardEnabled !== undefined ||
            patch.link4mRewardHours !== undefined ||
            patch.link4mDailyLimit !== undefined ||
            patch.link4mMode !== undefined ||
            patch.link4mUrl !== undefined
          )) {
            await link4mService.configure({
              enabled: mergedSettings.link4mRewardEnabled,
              rewardHours: mergedSettings.link4mRewardHours,
              dailyLimit: mergedSettings.link4mDailyLimit
            });
          }
          const credUpdate = {
            ...(mergedSettings.publicBaseUrl ? { publicBaseUrl: mergedSettings.publicBaseUrl } : {}),
            ...(patch.publicBaseUrl === '' ? { publicBaseUrl: '' } : {}),
            ...(mergedSettings.link4mMode !== undefined ? { link4mMode: mergedSettings.link4mMode } : {}),
            ...(mergedSettings.link4mUrl !== undefined ? { link4mUrl: mergedSettings.link4mUrl } : {}),
            ...(resolvedApiToken !== null ? { link4mApiToken: resolvedApiToken } : {}),
            ...(resolvedSecretKey !== null ? { link4mSecretKey: resolvedSecretKey } : {})
          };
          if (Object.keys(credUpdate).length > 0) {
            if (typeof link4mService.setRuntimeCredentials === 'function') {
              link4mService.setRuntimeCredentials(credUpdate);
            } else if (link4mService.config) {
              link4mService.config = { ...link4mService.config, ...credUpdate };
            }
          }
        }

        const publicResponse = { ...mergedSettings };
        delete publicResponse.link4mApiTokenCiphertext;
        delete publicResponse.link4mSecretKeyCiphertext;

        return res.json({
          ok: true,
          message: 'Đã cập nhật cấu hình hệ thống.',
          settings: publicResponse
        });
      } catch (error) {
        const status = error.status === 400 ? 400 : 500;
        return res.status(status).json({ ok: false, error: error.message });
      }
    };
    const next = systemSettingsChain.then(run, run);
    systemSettingsChain = next.catch(() => {});
    return next;
  });

  async function listAllBotCredentials() {
    const workers = typeof registry.list === 'function' ? await registry.list() : [];
    const results = await Promise.all(workers.map(async (worker) => {
      const id = String(worker.workerId || worker.id || '');
      const label = worker.alias || worker.name || `Bot #${worker.botNumber || id}`;
      try {
        let username = '';
        let password = '';
        if (typeof registry.privateSettings === 'function') {
          const priv = await registry.privateSettings(id);
          username = priv?.username || '';
          password = priv?.password || '';
        } else {
          const full = typeof registry.find === 'function' ? await registry.find(id) : worker;
          const creds = safeDecryptBotJson(full?.settings?.mcCredentialsCiphertext, registry.encryptionKey);
          username = creds?.username || '';
          password = creds?.password || '';
        }
        return {
          id,
          workerId: id,
          botNumber: worker.botNumber || null,
          label,
          ok: true,
          username,
          password
        };
      } catch (err) {
        return {
          id,
          workerId: id,
          botNumber: worker.botNumber || null,
          label,
          ok: false,
          error: err?.message || 'Không thể đọc thông tin tài khoản bot.'
        };
      }
    }));
    return results;
  }

  router.get('/admin/credentials', async (req, res) => {
    try {
      const bots = await listAllBotCredentials();
      await store.addAudit({
        action: 'ADMIN_VIEW_BOT_CREDENTIALS',
        actorId: req.managerAuthSession?.username || 'admin',
        actorRole: 'admin',
        actorIp: resolveClientIp(req) || '127.0.0.1',
        details: { method: 'GET', botCount: bots.length }
      }).catch(() => null);
      return res.json({ ok: true, bots });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/admin/credentials', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const bodyKeys = Object.keys(body);
      const hasPasswordField = Object.prototype.hasOwnProperty.call(body, 'password')
        || Object.prototype.hasOwnProperty.call(body, 'newPassword');
      const actorIp = resolveClientIp(req) || '127.0.0.1';

      if (hasPasswordField) {
        const invalidExtra = bodyKeys.some((k) => k !== 'password' && k !== 'newPassword');
        if (invalidExtra) {
          return res.status(400).json({ ok: false, error: 'Tham số không hợp lệ.' });
        }
        const newPassword = Object.prototype.hasOwnProperty.call(body, 'password') ? body.password : body.newPassword;
        if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 256) {
          return res.status(400).json({ ok: false, error: 'Mật khẩu phải dài từ 6 đến 256 ký tự.' });
        }
        const hashed = await hashAdminPasswordAsync(newPassword);
        if (store && typeof store.setSetting === 'function') {
          await store.setSetting('admin_credentials', { passwordHash: hashed, updatedAt: new Date().toISOString() });
        }
        if (typeof registry.setAdminPassword === 'function') {
          registry.setAdminPassword(hashed);
        }
        // Immediately revoke other active admin sessions on password change
        const currentTokenHash = req.managerAuthSession?.tokenHash || null;
        if (typeof invalidateAdminSessions === 'function') {
          invalidateAdminSessions(currentTokenHash);
        }
        if (typeof store?.adapter?.revokeAdminSessions === 'function') {
          await store.adapter.revokeAdminSessions(currentTokenHash).catch(() => null);
        }
        await store.addAudit?.({
          action: 'ADMIN_CHANGE_PASSWORD',
          targetId: 'admin',
          actorId: req.managerAuthSession?.username || 'admin',
          actorRole: 'admin',
          actorIp
        }).catch(() => null);
        return res.json({ ok: true, message: 'Đã cập nhật mật khẩu quản trị viên.' });
      }

      if (bodyKeys.length > 0) {
        return res.status(400).json({ ok: false, error: 'Tham số không hợp lệ.' });
      }

      // Empty body preserves Dashboard UI modal & backward compatibility (API-06)
      const bots = await listAllBotCredentials();
      await store.addAudit?.({
        action: 'ADMIN_VIEW_BOT_CREDENTIALS',
        actorId: req.managerAuthSession?.username || 'admin',
        actorRole: 'admin',
        actorIp,
        details: { method: 'POST', botCount: bots.length }
      }).catch(() => null);
      return res.json({ ok: true, bots });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 11. PENDING RESETS
  router.get('/pending-resets', async (_req, res) => {
    return res.status(501).json({ ok: false, error: 'Endpoint pending-resets không còn được hỗ trợ.' });
  });

  router.post('/pending-resets/all/resolve', async (_req, res) => {
    return res.status(501).json({ ok: false, error: 'Endpoint pending-resets không còn được hỗ trợ.' });
  });

  // 12. DIAGNOSTICS & SYSTEM METRICS
  router.get('/diagnostics', async (_req, res) => {
    const memory = process.memoryUsage();
    return res.json({
      ok: true,
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        platform: process.platform,
        arch: process.arch
      },
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        externalMb: Math.round(memory.external / (1024 * 1024))
      },
      fleet: {
        total: (await registry.list()).length
      }
    });
  });

  return router;
}

module.exports = { createAdminApi };
