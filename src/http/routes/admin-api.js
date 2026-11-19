'use strict';

const crypto = require('node:crypto');
const express = require('express');
const {
  encryptSecret,
  decryptSecret,
  decryptUserPassword,
  hashAdminPassword,
  isStoredCredentialCiphertext
} = require('../../utils/secrets');
const { validateSafeBotUrl } = require('../../services/proxy-validation');
const rawSchema = require('../../storage/schema-sql');
const SCHEMA_SQL = typeof rawSchema === 'string' ? rawSchema : (rawSchema?.SCHEMA_SQL || '');

const USER_ALLOWED_FIELDS = [
  'status', 'expiresAt', 'planName', 'note', 'workerIds', 'assignedBotIds',
  'botCount', 'username', 'password', 'isPermanent', 'botAliases',
  'allowAccountChange', 'lockReason'
];

function csvEscapeCell(val) {
  let str = val === null || val === undefined
    ? ''
    : (typeof val === 'object' ? JSON.stringify(val) : String(val));
  if (/^[=+\-@\t\r]/.test(str)) {
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
  registry,
  broker,
  fleetOperations,
  adminNotifier,
  config,
  logger,
  invalidateUserSessions
}) {
  const router = express.Router();

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

  // 1. USER MANAGEMENT
  router.get('/users', async (_req, res) => {
    try {
      const [storedUsers, workers] = await Promise.all([store.listAccess(), registry.list()]);
      const users = storedUsers.map((user) => ({
        ...user,
        id: String(user.userId || user.id || ''),
        assignedBotIds: Array.isArray(user.workerIds)
          ? [...new Set(user.workerIds.map((workerId) => String(workerId).trim().toLowerCase()).filter(Boolean))]
          : []
      }));
      // Build ownership map strictly in RAM (eliminates N+1 store.assignedUser() queries!)
      const ownerByWorkerId = new Map();
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
        botOwnership[worker.workerId] = ownerByWorkerId.get(key) || ownerByWorkerId.get(String(worker.botNumber || '')) || null;
      }
      const availableBots = workers.map((worker) => ({
        id: String(worker.workerId),
        workerId: String(worker.workerId),
        botNumber: worker.botNumber,
        label: worker.alias || worker.name || `Bot #${worker.botNumber || worker.workerId}`,
        enabled: worker.enabled !== false,
        rentable: worker.rentable !== false,
        currentOwner: botOwnership[worker.workerId] || null
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
    // Never allow mass-assignment of privileged roles via user CRUD
    if (src.role !== undefined && String(src.role).trim().toLowerCase() === 'user') {
      values.role = 'user';
    }
    return values;
  }

  router.post('/users', async (req, res) => {
    try {
      const { action, userId, values, id, ...rest } = req.body || {};
      let targetUserId = userId || id;

      if (action === 'delete') {
        if (!targetUserId) return res.status(400).json({ ok: false, error: 'Thiếu userId cần xóa.' });
        await store.removeAccess(targetUserId);
        if (typeof invalidateUserSessions === 'function') invalidateUserSessions(targetUserId);
        await store.addAudit({
          action: 'ADMIN_DELETE_USER',
          targetId: targetUserId,
          actorId: req.managerAuthSession.username,
          actorRole: 'admin',
          actorIp: req.ip || '127.0.0.1'
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
      if (!targetUserId) {
        const username = String(updateData.username || '').trim().toLowerCase();
        const password = String(updateData.password || '');
        if (!username || !password) {
          return res.status(400).json({ ok: false, error: 'Tạo tài khoản mới cần username và password.' });
        }
        targetUserId = `usr_${crypto.randomUUID()}`;
        updateData.username = username;
        updateData.role = 'user';
      }

      await store.setAccess(targetUserId, updateData, req.managerAuthSession.username);
      if (String(updateData.status || '').trim().toLowerCase() === 'disabled') {
        if (typeof invalidateUserSessions === 'function') invalidateUserSessions(targetUserId);
        if (typeof store.adapter?.revokeUserSessions === 'function') {
          await store.adapter.revokeUserSessions(targetUserId).catch(() => null);
        }
      }
      const auditDetails = { ...updateData };
      if (auditDetails.password) auditDetails.password = '[REDACTED]';
      await store.addAudit({
        action: 'ADMIN_UPDATE_USER',
        targetId: targetUserId,
        actorId: req.managerAuthSession.username,
        actorRole: 'admin',
        actorIp: req.ip || '127.0.0.1',
        details: auditDetails
      });
      return res.json({ ok: true, message: 'Đã cập nhật thông tin người dùng.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.all(['/users/:id', '/user/:id'], async (req, res) => {
    const { id } = req.params;
    if (req.method === 'DELETE') {
      try {
        await store.removeAccess(id);
        if (typeof invalidateUserSessions === 'function') invalidateUserSessions(id);
        await store.addAudit({
          action: 'ADMIN_DELETE_USER',
          targetId: id,
          actorId: req.managerAuthSession.username,
          actorRole: 'admin',
          actorIp: req.ip || '127.0.0.1'
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

        await store.setAccess(id, values, req.managerAuthSession.username);
        if (String(values.status || '').trim().toLowerCase() === 'disabled') {
          if (typeof invalidateUserSessions === 'function') invalidateUserSessions(id);
          if (typeof store.adapter?.revokeUserSessions === 'function') {
            await store.adapter.revokeUserSessions(id).catch(() => null);
          }
        }
        const auditDetails = { ...values };
        if (auditDetails.password) auditDetails.password = '[REDACTED]';
        await store.addAudit({
          action: 'ADMIN_UPDATE_USER',
          targetId: id,
          actorId: req.managerAuthSession.username,
          actorRole: 'admin',
          actorIp: req.ip || '127.0.0.1',
          details: auditDetails
        });
        return res.json({ ok: true, message: 'Đã cập nhật thông tin người dùng.' });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
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
          actorIp: req.ip || '127.0.0.1',
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
          actorIp: req.ip || '127.0.0.1',
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
      const rawUrls = Array.isArray(body.urls) && body.urls.length
        ? body.urls
        : (body.url || body.serviceUrl ? [body.url || body.serviceUrl] : []);

      const baseLabel = String(body.label || body.name || '').trim();
      const explicitWorkerId = body.workerId ? String(body.workerId).trim().toLowerCase() : undefined;
      const explicitProvider = body.provider ? String(body.provider).trim().toLowerCase() : undefined;
      const rawSecret = body.secret !== undefined ? body.secret : body.secretKey;
      let explicitSecret = undefined;
      if (rawSecret !== undefined && rawSecret !== null) {
        if (typeof rawSecret !== 'string' || rawSecret.trim().length < 32) {
          return res.status(400).json({
            ok: false,
            success: false,
            error: 'Worker secret must be at least 32 characters'
          });
        }
        explicitSecret = rawSecret.trim();
      }

      const managerBaseUrl = String(config.publicBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

      // Case 1: No URLs provided (manual / wispbyte worker)
      if (!rawUrls.length) {
        const result = await registry.add({
          workerId: explicitWorkerId,
          name: baseLabel || undefined,
          provider: explicitProvider || 'wispbyte',
          serviceUrl: body.serviceUrl || '',
          serviceId: body.serviceId || '',
          secret: explicitSecret
        });

        const envConfig = `MANAGER_URL=${managerBaseUrl}\nWORKER_ID_1=${result.worker.workerId}\nWORKER_SECRET_1=${result.secret}`;

        return res.status(201).json({
          ok: true,
          message: 'Đã thêm Bot mới thành công.',
          bot: result.worker,
          bots: [result.worker],
          secret: result.secret,
          envConfig
        });
      }

      // Case 2: One or more URLs provided (Render / Web workers with Dual-Slot auto detection)
      const added = [];
      const skipped = [];
      const envConfigs = [];
      let firstSecret = undefined;

      for (let i = 0; i < rawUrls.length; i++) {
        const rawUrl = String(rawUrls[i] || '').trim().replace(/\/+$/, '');
        if (!rawUrl) continue;

        const isHttpUrl = /^https?:\/\//i.test(rawUrl);
        const provider = explicitProvider || (isHttpUrl ? 'render' : 'wispbyte');
        let slots = 2; // Default dual-slot (1 worker = 2 bot) for Render / host instances

        if (isHttpUrl) {
          try {
            await validateSafeBotUrl(rawUrl);
          } catch (ssrfErr) {
            skipped.push({ url: rawUrl, slot: 0, reason: ssrfErr.message });
            continue;
          }
        }

        // Probe worker /health endpoint if accessible
        if (provider === 'render' && isHttpUrl) {
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2500);
            try {
              const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch : null;
              if (fetchFn) {
                const probe = await fetchFn(`${rawUrl}/health`, {
                  signal: controller.signal,
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
            logger?.info?.('Worker probe cold-start or timeout, defaulting to dual-slot', {
              url: rawUrl,
              error: probeErr?.message
            });
            slots = 2;
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
              serviceUrl: isHttpUrl ? rawUrl : '',
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
          let envChunk = `# Cấu hình Worker: ${rawUrl}\nMANAGER_URL=${managerBaseUrl}\n`;
          clusterBots.forEach((cb) => {
            envChunk += `WORKER_ID_${cb.slot}=${cb.worker.workerId}\nWORKER_SECRET_${cb.slot}=${cb.secret}\n`;
          });
          envConfigs.push(envChunk.trim());
        }
      }

      if (added.length === 0 && skipped.length > 0) {
        return res.status(400).json({
          ok: false,
          error: skipped[0].reason || 'Không thể thêm bot.',
          skipped
        });
      }

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

      const added = [];
      const skipped = [];
      for (const item of botsToImport) {
        try {
          const rawUrl = String(item.url || item.serviceUrl || '').trim();
          const safeUrl = rawUrl ? await validateSafeBotUrl(rawUrl) : '';
          const result = await registry.add({
            name: item.label || item.name,
            provider: item.provider || 'wispbyte',
            serviceUrl: safeUrl,
            serviceId: item.serviceId || ''
          });
          added.push(result.worker);
        } catch (err) {
          skipped.push({ item, reason: err.message });
        }
      }

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
      await store.addAudit({
        action: 'ADMIN_DELETE_BOT',
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
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
      if (has('url') || has('serviceUrl')) {
        const rawServiceUrl = body.url ?? body.serviceUrl;
        if (typeof rawServiceUrl !== 'string') {
          return res.status(400).json({ ok: false, error: 'URL bot không hợp lệ.' });
        }
        const serviceUrl = rawServiceUrl.trim().replace(/\/+$/, '');
        if (serviceUrl) {
          if (!/^https:\/\//i.test(serviceUrl) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(serviceUrl)) {
            return res.status(400).json({ ok: false, error: 'Worker URL phải dùng HTTPS.' });
          }
          try {
            await validateSafeBotUrl(serviceUrl);
          } catch (ssrfErr) {
            return res.status(400).json({ ok: false, error: ssrfErr.message || 'Worker URL bị chặn do chính sách bảo mật (SSRF).' });
          }
        }
        if (!serviceUrl && worker.provider === 'render' && !worker.renderServiceId) {
          return res.status(400).json({ ok: false, error: 'Render worker cần URL hoặc Render service ID.' });
        }
        patch.serviceUrl = serviceUrl;
      }

      const rawSecret = body.secretKey ?? body.secret;
      const secret = typeof rawSecret === 'string' ? rawSecret.trim() : '';
      if (secret && secret.length < 32) {
        return res.status(400).json({ ok: false, error: 'Worker secret phải có ít nhất 32 ký tự.' });
      }
      if (!Object.keys(patch).length && !secret) {
        return res.status(400).json({ ok: false, error: 'Không có thông tin nào để cập nhật.' });
      }

      if (Object.keys(patch).length) await registry.updateSettings(worker.workerId, patch);
      if (secret) await registry.setSecret(worker.workerId, secret);
      const updated = await registry.find(worker.workerId);
      await store.addAudit({
        action: 'ADMIN_UPDATE_BOT',
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        details: {
          label: updated.alias || updated.name,
          tags: updated.tags || [],
          rentable: updated.rentable !== false,
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
          url: updated.serviceUrl || ''
        }
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
        details: { reason: 'admin_manually_reset_customer_bot' }
      });

      return res.json({ ok: true, message: `Đã đặt lại dữ liệu Bot #${worker.botNumber || worker.workerId} về mặc định.` });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 3. AUDIT LOGS
  router.get('/audit-logs', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query?.limit, 10) || 50));
      const q = String(req.query?.q || '').trim().toLowerCase();
      const category = String(req.query?.category || '').trim().toLowerCase();
      const status = String(req.query?.status || '').trim().toLowerCase();
      const logType = String(req.query?.logType || '').trim().toLowerCase();

      const hasFilters = Boolean(q || category || status || logType);
      const fetchLimit = hasFilters
        ? Math.min(500, Math.max(200, page * limit))
        : Math.min(500, page * limit);
      const allLogs = await store.listAudit(fetchLimit);
      const logsArray = Array.isArray(allLogs) ? allLogs : [];

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
        filtered = filtered.filter((log) => {
          const logCategory = String(log.category || log.details?.category || '').toLowerCase();
          return logCategory === category;
        });
      }

      if (status) {
        filtered = filtered.filter((log) => {
          const logStatus = String(log.status || log.details?.status || '').toLowerCase();
          return logStatus === status;
        });
      }

      if (logType && logType !== 'all') {
        filtered = filtered.filter((log) => {
          const logTypeVal = String(log.logType || log.details?.logType || '').toLowerCase();
          return logTypeVal === logType;
        });
      }

      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const startIndex = (page - 1) * limit;
      const paginatedLogs = filtered.slice(startIndex, startIndex + limit);

      return res.json({
        ok: true,
        logs: paginatedLogs,
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
      const logs = await store.listAudit(1000);
      const format = String(req.query?.format || 'json').toLowerCase();
      if (format === 'csv') {
        const headers = ['id', 'timestamp', 'log_type', 'category', 'actor', 'role', 'ip', 'action', 'target', 'status', 'details'];
        const rows = logs.map((l) => [
          l.id || '',
          l.timestamp || l.createdAt || '',
          l.logType || 'SYSTEM',
          l.category || 'SYSTEM',
          l.actor?.username || l.actorId || 'system',
          l.actor?.role || 'system',
          l.actor?.ip || '',
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
          days: Number(days) || 30,
          permanent: Boolean(permanent),
          botCount: Number(botCount) || 1,
          workerIds: Array.isArray(workerIds) ? workerIds : [],
          maxUses: Number.isFinite(Number(maxUses)) ? Number(maxUses) : 1,
          planName: planName || 'Standard',
          customCode: customKey,
          expiresAt,
          actorId: req.managerAuthSession.username
        });
        generated.push(key);
      }

      return res.status(201).json({ ok: true, message: `Đã tạo ${generated.length} mã Giftcode thành công.`, keys: generated });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
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
        const testRes = await store.adapter.testConnection();
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

  router.post('/supabase/config', async (req, res) => {
    return res.json({ ok: true, message: 'Đã cập nhật cấu hình Supabase.' });
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

  async function buildBackupPayload() {
    const [workers, accessUsers, keys] = await Promise.all([
      registry.list(),
      store.listAccess(),
      entitlementService?.listCodes ? entitlementService.listCodes(500) : []
    ]);
    // Preserve encrypted passwords in backups so restore never wipes user login credentials
    let rawPasswordMap = new Map();
    if (store?.client && typeof store.client.from === 'function') {
      try {
        const { data } = await store.client.from('manager_users').select('id,username,password');
        if (Array.isArray(data)) {
          for (const row of data) {
            if (row?.id && row.password) rawPasswordMap.set(String(row.id), row.password);
            if (row?.username && row.password) rawPasswordMap.set(String(row.username).toLowerCase(), row.password);
          }
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
        actorIp: req.ip || '127.0.0.1',
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

      const summary = { workersRestored: 0, usersRestored: 0, keysRestored: 0, warnings: [] };

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
      } else if (backup.registry && typeof registry.saveConfig === 'function') {
        await registry.saveConfig(backup.registry);
      }

      // 2. Restore users
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
              const keyId = k.keyId || k.id || `key_${crypto.randomUUID()}`;
              const row = {
                id: keyId,
                key_id: keyId,
                code: k.code || k.key || k.keyCode || '',
                code_hash: k.codeHash || k.code_hash || '',
                code_suffix: k.codeSuffix || k.code_suffix || '',
                status: k.status || 'unused',
                days: Number(k.days ?? 30),
                is_permanent: Boolean(k.isPermanent ?? k.is_permanent),
                bot_count: Number(k.botCount ?? k.bot_count ?? 1),
                worker_ids: Array.isArray(k.workerIds || k.worker_ids) ? (k.workerIds || k.worker_ids) : [],
                plan_name: k.planName || k.plan_name || 'Standard',
                max_uses: Number(k.maxUses ?? k.max_uses ?? 1),
                used_count: Number(k.usedCount ?? k.used_count ?? 0),
                used_users: Array.isArray(k.usedUsers || k.used_users) ? (k.usedUsers || k.used_users) : [],
                expires_at: k.expiresAt || k.expires_at || null
              };
              const { error } = await store.client.from('manager_keys').upsert(row, { onConflict: 'key_id' });
              if (error && error.code !== '23505') throw error;
              summary.keysRestored += 1;
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

      store?.invalidateCache?.();
      registry?.store?.invalidateCache?.();

      await store.addAudit({
        action: 'ADMIN_RESTORE_BACKUP',
        actorId: req.managerAuthSession.username,
        actorRole: 'admin',
        actorIp: req.ip || '127.0.0.1',
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
      if (!filename) return res.status(400).json({ ok: false, error: 'Thiếu tên bản sao lưu.' });

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

  // 7. FLEET BULK CONTROLS (F-05: supports tag filter & unpacked settings)
  router.post('/all/send', async (req, res) => {
    const message = String(req.body?.text || req.body?.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'Tin nhắn không được để trống.' });
    const tag = req.body?.tag || '';

    try {
      const [allWorkers, assignedSet] = await Promise.all([
        registry.list(),
        tag ? getAssignedWorkerIdSet() : Promise.resolve(new Set())
      ]);
      const matched = filterWorkersByTag(allWorkers, tag, assignedSet);
      const onlineTargets = matched.filter((w) => w.status?.state === 'online');
      const results = await Promise.allSettled(
        onlineTargets.map((w) => broker.dispatch(w.workerId, 'chat', { message }))
      );
      const okCount = results.filter((r) => r.status === 'fulfilled' && r.value?.delivered !== false && r.value?.result?.ok !== false).length;
      const failedCount = onlineTargets.length - okCount;
      return res.json({
        ok: true,
        total: onlineTargets.length,
        okCount,
        failedCount,
        message: `Đã phát tin nhắn tới ${okCount}/${onlineTargets.length} bot đang online.`
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

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
      for (const worker of targets) {
        try {
          await registry.updateSettings(worker.workerId, settingsPatch);
          okCount += 1;
        } catch (_) {
          failedCount += 1;
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
    if (['send', 'settings'].includes(action)) return next();
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
      store.cachedAnnouncement = record;
      if (store && typeof store.setSetting === 'function') {
        await store.setSetting('system_announcement', record);
      }
      return res.json({ ok: true, message: 'Đã cập nhật thông báo hệ thống.', announcement: record });
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

  router.get('/webhook', async (_req, res) => {
    try {
      const webhook = await loadWebhookSettings();
      return res.json({
        ok: true,
        webhook,
        webhookUrl: webhook.discordUrl
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/webhook', async (req, res) => {
    try {
      const incoming = req.body?.webhook && typeof req.body.webhook === 'object' ? req.body.webhook : (req.body || {});
      const normalized = normalizeWebhookSettings(incoming);
      if (normalized.discordUrl) {
        normalized.discordUrl = validateDiscordWebhookUrl(normalized.discordUrl);
      }
      const encKey = registry?.encryptionKey || config?.encryptionKey;
      const toPersist = {
        enabled: normalized.enabled,
        discordUrl: encKey ? '' : normalized.discordUrl,
        discordUrlCiphertext: normalized.discordUrl && encKey ? encryptSecret(normalized.discordUrl, encKey) : null,
        telegramToken: encKey ? '' : normalized.telegramToken,
        telegramTokenCiphertext: normalized.telegramToken && encKey ? encryptSecret(normalized.telegramToken, encKey) : null,
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
      return res.json({
        ok: true,
        message: 'Đã lưu cấu hình Webhook thông báo thành công.',
        webhook: normalized,
        webhookUrl: normalized.discordUrl
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
      const target = normalizeWebhookSettings({
        ...saved,
        ...(incoming.discordUrl !== undefined || incoming.webhookUrl !== undefined ? { discordUrl: incoming.discordUrl ?? incoming.webhookUrl } : {}),
        ...(incoming.telegramToken !== undefined ? { telegramToken: incoming.telegramToken } : {}),
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
  router.get('/settings/system', async (_req, res) => {
    try {
      const defaultSettings = {
        publicBaseUrl: config.publicBaseUrl || '',
        renderApiKey: config.renderApiKey ? '********' : '',
        link4mApiToken: config.link4mApiToken ? '********' : '',
        wispbyteEnabled: true,
        trialGiftEnabled: Boolean(config.trialGiftEnabled ?? false),
        trialDays: Number(config.trialDays || 3)
      };

      let persisted = null;
      if (typeof store.getSetting === 'function') {
        persisted = await store.getSetting('system_settings').catch(() => null);
      } else if (store.client) {
        const { data } = await store.client.from('manager_settings').select('value').eq('key', 'system_settings').maybeSingle().catch(() => ({}));
        persisted = data?.value;
      }

      const mergedSettings = {
        ...defaultSettings,
        ...(persisted && typeof persisted === 'object' ? persisted : {})
      };
      mergedSettings.trialGiftEnabled = Boolean(mergedSettings.trialGiftEnabled);
      mergedSettings.trialDays = Number.isFinite(Number(mergedSettings.trialDays)) ? Number(mergedSettings.trialDays) : 3;

      return res.json({
        ok: true,
        settings: mergedSettings,
        ...mergedSettings
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/settings/system', async (req, res) => {
    try {
      const rawPatch = req.body || {};
      const patch = {};
      if (rawPatch.publicBaseUrl !== undefined) patch.publicBaseUrl = String(rawPatch.publicBaseUrl || '').trim().slice(0, 512);
      if (rawPatch.trialGiftEnabled !== undefined) patch.trialGiftEnabled = Boolean(rawPatch.trialGiftEnabled);
      if (rawPatch.trialDays !== undefined) {
        const daysNum = Number(rawPatch.trialDays);
        if (!Number.isInteger(daysNum) || daysNum < 1 || daysNum > 365) {
          return res.status(400).json({ ok: false, error: 'Số ngày dùng thử phải từ 1 đến 365.' });
        }
        patch.trialDays = daysNum;
      }
      if (rawPatch.wispbyteEnabled !== undefined) patch.wispbyteEnabled = Boolean(rawPatch.wispbyteEnabled);

      let currentSettings = {};
      if (typeof store.getSetting === 'function') {
        const persisted = await store.getSetting('system_settings').catch(() => null);
        if (persisted && typeof persisted === 'object') {
          currentSettings = persisted;
        }
      } else if (store.client) {
        const { data } = await store.client.from('manager_settings').select('value').eq('key', 'system_settings').maybeSingle().catch(() => ({}));
        if (data?.value && typeof data.value === 'object') {
          currentSettings = data.value;
        }
      }

      const mergedSettings = {
        publicBaseUrl: config.publicBaseUrl || '',
        renderApiKey: config.renderApiKey ? '********' : '',
        link4mApiToken: config.link4mApiToken ? '********' : '',
        wispbyteEnabled: true,
        trialGiftEnabled: Boolean(config.trialGiftEnabled ?? false),
        trialDays: Number(config.trialDays || 3),
        ...currentSettings,
        ...patch
      };

      if (typeof store.setSetting === 'function') {
        await store.setSetting('system_settings', mergedSettings);
      } else if (store.client) {
        await store.client.from('manager_settings').upsert({
          key: 'system_settings',
          value: mergedSettings,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
      }

      return res.json({
        ok: true,
        message: 'Đã cập nhật cấu hình hệ thống.',
        settings: mergedSettings
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
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
        actorIp: req.ip || '127.0.0.1',
        details: { method: 'GET', botCount: bots.length }
      }).catch(() => null);
      return res.json({ ok: true, bots });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/admin/credentials', async (req, res) => {
    try {
      const body = req.body || {};
      if (!Object.prototype.hasOwnProperty.call(body, 'password')) {
        const bots = await listAllBotCredentials();
        await store.addAudit({
          action: 'ADMIN_VIEW_BOT_CREDENTIALS',
          actorId: req.managerAuthSession?.username || 'admin',
          actorRole: 'admin',
          actorIp: req.ip || '127.0.0.1',
          details: { method: 'POST', botCount: bots.length }
        }).catch(() => null);
        return res.json({ ok: true, bots });
      }
      const { password } = body;
      if (typeof password !== 'string' || password.length < 6 || password.length > 256) {
        return res.status(400).json({ ok: false, error: 'Mật khẩu phải dài từ 6 đến 256 ký tự.' });
      }
      const hashed = hashAdminPassword(password);
      if (store && typeof store.setSetting === 'function') {
        await store.setSetting('admin_credentials', { passwordHash: hashed, updatedAt: new Date().toISOString() });
      }
      if (typeof registry.setAdminPassword === 'function') {
        registry.setAdminPassword(hashed);
      }
      return res.json({ ok: true, message: 'Đã cập nhật mật khẩu quản trị viên.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 11. PENDING RESETS
  router.get('/pending-resets', async (_req, res) => {
    return res.json({ ok: true, resets: [] });
  });

  router.post('/pending-resets/all/resolve', async (_req, res) => {
    return res.json({ ok: true, message: 'Đã xử lý tất cả yêu cầu reset.' });
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
