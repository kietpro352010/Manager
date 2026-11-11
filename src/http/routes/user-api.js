'use strict';

const express = require('express');
const { validateProxyUrl } = require('../../services/proxy-validation');
const { decryptSecret } = require('../../utils/secrets');

function safeDecryptJson(ciphertext, key) {
  if (!ciphertext || !key) return null;
  try {
    const raw = decryptSecret(ciphertext, key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

// Helper: Sanitize Bot DTO according to session permissions (Hiding IP/URL/Proxy for rental clients)
function sanitizeBotForSession(botData, session) {
  if (!botData) return botData;
  const copy = { ...botData };
  delete copy.secretKey;
  delete copy.secretCiphertext;
  if (session && session.role === 'admin') return copy;

  copy.url = '';
  copy.serviceUrl = '';
  delete copy.sourceUrl;
  delete copy.registryFile;
  copy.ipAddress = '';
  copy.host = '';
  copy.proxy = null;
  copy.proxyCiphertext = null;

  if (session && session.allowAccountChange === false) {
    if (copy.settings && typeof copy.settings === 'object') {
      copy.settings = { ...copy.settings };
      if (copy.settings.spawnCommands) copy.settings.spawnCommands = '********';
    }
  }
  return copy;
}

function createUserApi({
  store,
  entitlementService,
  link4mService,
  registry,
  broker,
  fleetOperations,
  config,
  logger
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

  // Helper: Extract decrypted Minecraft username from worker credentials if configured
  function getBotUsername(worker) {
    if (!worker) return '';
    const ciphertext = worker.settings?.mcCredentialsCiphertext;
    if (ciphertext && registry.encryptionKey) {
      const creds = safeDecryptJson(ciphertext, registry.encryptionKey);
      if (creds && creds.username) return creds.username;
    }
    if (worker.username) return worker.username;
    if (worker.status?.username) return worker.status.username;
    return '';
  }

  // Middleware: Require Authenticated User Session
  function requireSession(req, res, next) {
    const session = req.managerAuthSession;
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Chưa đăng nhập hệ thống.' });
    }
    if (session.status === 'disabled') {
      return res.status(403).json({ ok: false, error: 'Tài khoản của bạn đã bị vô hiệu hóa bởi Quản trị viên.' });
    }
    return next();
  }

  // Helper: Verify User Access to Target Bot
  async function checkBotPermissionAsync(req, targetId) {
    const session = req.managerAuthSession;
    if (!session) return { allowed: false, status: 401, error: 'Chưa đăng nhập hệ thống.' };

    const worker = await resolveWorker(targetId);
    if (!worker) return { allowed: false, status: 404, error: 'Không tìm thấy bot.' };

    if (session.role === 'admin') return { allowed: true, user: session, worker };

    const isExpired = session.status === 'expired' ||
      (session.expiresAtRental && Date.now() > Date.parse(session.expiresAtRental));

    if (isExpired) {
      return { allowed: false, status: 403, error: 'Tài khoản của bạn đã hết hạn thuê bot. Vui lòng gia hạn để tiếp tục sử dụng.' };
    }

    const assigned = Array.isArray(session.assignedBotIds) ? session.assignedBotIds.map(String) : [];
    if (assigned.includes(String(worker.workerId)) || assigned.includes(String(worker.botNumber))) {
      return { allowed: true, user: session, worker };
    }
    return { allowed: false, status: 403, error: 'Bạn không có quyền quản lý bot này.' };
  }

  // Helper: Build standardized safe bot payload for API responses
  function buildBotPayload(worker, session, summary = null, assignment = null) {
    const username = getBotUsername(worker);
    const configured = Boolean(worker.settings?.mcCredentialsCiphertext || (username && username !== 'Chưa đặt'));
    const isOnline = worker.status?.state === 'online';
    const isReachable = Boolean(worker.reachable || isOnline);
    const botNum = Number(worker.botNumber || worker.workerId || 1);

    const safeBot = sanitizeBotForSession({
      id: worker.workerId,
      botNumber: botNum,
      workerId: worker.workerId,
      name: worker.name || worker.alias || `KingMC Bot ${botNum}`,
      alias: worker.alias || worker.name || `KingMC Bot ${botNum}`,
      label: worker.alias || worker.name || `KingMC Bot ${botNum}`,
      username: username || 'Chưa đặt',
      configured,
      available: isReachable,
      platform: worker.platform || worker.provider || 'wispbyte',
      provider: worker.provider || 'wispbyte',
      enabled: worker.enabled,
      status: worker.status?.state || 'offline',
      state: worker.status?.state || 'offline',
      online: isOnline,
      server: worker.status?.server || worker.serverHost || 'mc.kingmc.vn',
      health: worker.status?.health ?? 20,
      food: worker.status?.food ?? 20,
      totemCount: worker.status?.totemCount ?? 0,
      goldenAppleCount: worker.status?.goldenAppleCount ?? 0,
      inventory: worker.status?.inventory || [],
      pos: worker.status?.position || { x: 0, y: 0, z: 0 },
      position: worker.status?.position || { x: 0, y: 0, z: 0 },
      ping: worker.status?.pingMs ?? worker.status?.ping ?? 0,
      tps: typeof worker.status?.tps === 'number' ? worker.status.tps : null,
      serverTps: typeof worker.status?.tps === 'number' ? worker.status.tps : null,
      uptime: worker.status?.uptimeSeconds ?? worker.status?.uptime ?? 0,
      uptimeSeconds: worker.status?.uptimeSeconds ?? worker.status?.uptime ?? 0,
      lastSeen: worker.lastHeartbeat || null,
      manuallyStopped: Boolean(worker.status?.manuallyStopped),
      tags: worker.tags || [],
      rentable: worker.rentable !== false,
      assignedUsername: assignment?.username || null,
      assignedPlan: assignment?.planName || null,
      summary: summary?.data || null,
      url: worker.serviceUrl || '',
      proxy: worker.proxy || null,
      currentWindow: worker.status?.currentWindow || null,
      history: {
        ping: worker.status?.pingHistory || [],
        ram: worker.status?.ramHistory || []
      },
      hostHardware: {
        ramUsedMb: worker.status?.rssMb || 0,
        ramTotalMb: 512,
        ramPercent: worker.status?.rssMb ? Math.round((worker.status.rssMb / 512) * 100) : 0,
        cpuPercent: worker.status?.cpuPercent || 0,
        cpuCores: 1,
        botRssMb: worker.status?.rssMb || 0,
        botHeapMb: worker.status?.heapUsedMb || 0,
        netDownKb: 0,
        netUpKb: 0
      }
    }, session);

    return safeBot;
  }

  // Helper to fetch user assignments map
  async function getUserAssignmentsMap() {
    const map = new Map();
    try {
      if (typeof store.listAccess === 'function') {
        const users = await store.listAccess();
        if (Array.isArray(users)) {
          for (const u of users) {
            const botIds = Array.isArray(u.workerIds) && u.workerIds.length
              ? u.workerIds
              : (Array.isArray(u.assignedBotIds) ? u.assignedBotIds : []);
            for (const bId of botIds) {
              map.set(String(bId), { username: u.username, planName: u.planName });
            }
          }
        }
      }
    } catch (_) {}
    return map;
  }

  // 1. GET ALL ACCESSIBLE BOTS (used by dashboard home & table)
  const getBotsHandler = async (req, res) => {
    try {
      const session = req.managerAuthSession;
      const allBots = await registry.list();
      const assignmentMap = await getUserAssignmentsMap();

      let visibleBots = [];
      if (session.role === 'admin') {
        visibleBots = allBots;
      } else {
        const assigned = Array.isArray(session.assignedBotIds) ? session.assignedBotIds.map(String) : [];
        visibleBots = allBots.filter((b) => assigned.includes(String(b.workerId)) || assigned.includes(String(b.botNumber)));
      }

      const payload = visibleBots.map((bot) => {
        const summary = registry.summary(bot.workerId) || {};
        const assignment = assignmentMap.get(String(bot.workerId)) || assignmentMap.get(String(bot.botNumber)) || null;
        return buildBotPayload(bot, session, summary, assignment);
      });

      return res.json({ ok: true, bots: payload });
    } catch (error) {
      logger.error('Failed to get bots', { error: error.message });
      return res.status(500).json({ ok: false, error: error.message });
    }
  };

  router.get('/bots', requireSession, getBotsHandler);
  router.get('/registry', requireSession, getBotsHandler);

  // 2. REORDER BOTS (Drag and drop in UI)
  router.post('/bots/reorder', requireSession, async (req, res) => {
    return res.json({ ok: true, message: 'Đã lưu thứ tự bot.' });
  });

  // 3. GET SYSTEM ANNOUNCEMENT
  router.get('/announcement', requireSession, async (_req, res) => {
    return res.json({
      ok: true,
      announcement: store.cachedAnnouncement || ''
    });
  });

  // 4. GET BOT SNAPSHOT (Complete state for Detail drawer/modal)
  router.get('/bot/:id/snapshot', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const worker = perm.worker;
    const session = req.managerAuthSession;
    const summary = registry.summary(worker.workerId);
    const assignmentMap = await getUserAssignmentsMap();
    const assignment = assignmentMap.get(String(worker.workerId)) || assignmentMap.get(String(worker.botNumber)) || null;
    const safeBot = buildBotPayload(worker, session, summary, assignment);

    const inventory = worker.status?.inventory || { items: [], slots: {}, revision: 0 };
    const settings = {
      ecoMode: worker.settings?.ecoMode !== false,
      autoTotem: worker.settings?.autoTotem !== false,
      antiHungry: worker.settings?.antiHungry !== false,
      autoReconnect: worker.settings?.autoReconnect !== false,
      antiAfkKick: worker.settings?.antiAfkKick !== false,
      spawnCommands: worker.settings?.spawnCommands || '',
      proxy: worker.proxy || null
    };

    return res.json({
      ok: true,
      rev: Date.now(),
      bot: safeBot,
      inventory,
      settings,
      autoChatSchedules: worker.settings?.autoChatSchedules || [],
      botSchedules: worker.settings?.botSchedules || []
    });
  });

  // 5. GET SPECIFIC BOT STATE (Fallback for Detail drawer)
  router.get('/bot/:id/state', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const worker = perm.worker;
    const session = req.managerAuthSession;
    const summary = registry.summary(worker.workerId);
    const assignmentMap = await getUserAssignmentsMap();
    const assignment = assignmentMap.get(String(worker.workerId)) || assignmentMap.get(String(worker.botNumber)) || null;
    const safeBot = buildBotPayload(worker, session, summary, assignment);

    return res.json({
      ok: true,
      bot: safeBot,
      ...safeBot
    });
  });

  // 6. DETAIL SUB-GETTERS (Fallbacks)
  router.get('/bot/:id/inventory', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    return res.json({
      ok: true,
      inventory: perm.worker.status?.inventory || { items: [], slots: {}, revision: 0 }
    });
  });

  router.get('/bot/:id/settings', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    const worker = perm.worker;
    return res.json({
      ok: true,
      settings: {
        ecoMode: worker.settings?.ecoMode !== false,
        autoTotem: worker.settings?.autoTotem !== false,
        antiHungry: worker.settings?.antiHungry !== false,
        autoReconnect: worker.settings?.autoReconnect !== false,
        antiAfkKick: worker.settings?.antiAfkKick !== false,
        spawnCommands: worker.settings?.spawnCommands || '',
        proxy: worker.proxy || null
      }
    });
  });

  router.get(['/bot/:id/autoChat', '/bot/:id/auto-chat'], requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    return res.json({
      ok: true,
      autoChatSchedules: perm.worker.settings?.autoChatSchedules || []
    });
  });

  router.get(['/bot/:id/botSchedules', '/bot/:id/bot-schedules'], requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    return res.json({
      ok: true,
      botSchedules: perm.worker.settings?.botSchedules || []
    });
  });

  router.get('/bot/:id/logs', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    return res.json({
      ok: true,
      logs: registry.getLogs(perm.worker.workerId)
    });
  });

  router.get('/bot/:id/chat-logs', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    const logs = registry.getLogs(perm.worker.workerId);
    const chatLogs = logs.filter((l) => l.type === 'chat' || l.type === 'message');
    return res.json({
      ok: true,
      logs: chatLogs
    });
  });

  router.get('/bot/:id/position-logs', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    return res.json({ ok: true, logs: [] });
  });

  // 7. SAVE MINECRAFT CREDENTIALS
  router.post('/bot/:id/account', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    if (req.managerAuthSession.role !== 'admin' && req.managerAuthSession.allowAccountChange === false) {
      return res.status(403).json({ ok: false, error: 'Gói dịch vụ của bạn không cho phép tự đổi tài khoản Minecraft.' });
    }

    const { username, password } = req.body || {};
    const cleanUser = String(username || '').trim();
    if (!cleanUser) {
      return res.status(400).json({ ok: false, error: 'Tên nhân vật Minecraft không được để trống.' });
    }

    try {
      const worker = perm.worker;
      await registry.updateCredentials(worker.workerId, { username: cleanUser, password });
      await store.addAudit({
        action: 'BOT_CREDENTIALS_SET',
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        details: { username: cleanUser }
      });
      return res.json({
        ok: true,
        message: 'Đã lưu tài khoản Minecraft thành công.',
        username: cleanUser
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 8. SEND CHAT MESSAGE VIA BOT (accepts both message and text)
  router.post('/bot/:id/send', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const worker = perm.worker;
    const message = String(req.body?.text || req.body?.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'Nội dung tin nhắn không được để trống.' });

    try {
      await broker.dispatch(worker.workerId, 'chat', { message });
      await store.addAudit({
        action: 'BOT_CHAT_SENT',
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        details: { message: message.slice(0, 100) }
      });

      return res.json({ ok: true, message: `Đã gửi tin nhắn tới server: "${message}"` });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 9. SCHEDULE CONFIGURATION
  router.post(['/bot/:id/auto-chat', '/bot/:id/autoChat'], requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const worker = perm.worker;
    const schedules = Array.isArray(req.body?.autoChatSchedules) ? req.body.autoChatSchedules : [];

    try {
      await registry.updateSettings(worker.workerId, { autoChatSchedules: schedules });
      return res.json({ ok: true, message: 'Đã lưu lịch Auto Chat thành công.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post(['/bot/:id/bot-schedules', '/bot/:id/botSchedules'], requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const worker = perm.worker;
    const schedules = Array.isArray(req.body?.botSchedules) ? req.body.botSchedules : [];

    try {
      await registry.updateSettings(worker.workerId, { botSchedules: schedules });
      return res.json({ ok: true, message: 'Đã lưu lịch hoạt động Bot thành công.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 10. CLEAR LOGS
  router.post(['/bot/:id/logs/clear', '/bot/:id/chat-logs/clear'], requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    if (registry.botLogsCache) {
      registry.botLogsCache.set(perm.worker.workerId, []);
    }
    return res.json({ ok: true, message: 'Đã xóa nhật ký sự kiện.' });
  });

  // 11. REMOTE WINDOW GUI ACTIONS
  router.post('/bot/:id/window/click', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    try {
      const result = await broker.dispatch(perm.worker.workerId, 'window_click', req.body || {});
      return res.json({ ok: true, message: 'Đã gửi thao tác click giao diện.', result: result?.result || null });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/bot/:id/window/close', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    try {
      const result = await broker.dispatch(perm.worker.workerId, 'window_close', req.body || {});
      return res.json({ ok: true, message: 'Đã gửi thao tác đóng giao diện.', result: result?.result || null });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 12. INVENTORY SUB-ACTIONS
  router.post('/bot/:id/inventory/:invAction', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const invAction = req.params.invAction;
    try {
      const result = await broker.dispatch(perm.worker.workerId, 'inventory', { action: invAction, ...req.body });
      return res.json({ ok: true, message: `Đã thực hiện thao tác ${invAction} kho đồ.`, result: result?.result || null });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 13. PROXY TEST & SETTINGS
  router.post('/bot/:id/proxy/test', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const proxyUrl = String(req.body?.proxy || req.body?.proxyUrl || '').trim();
    if (proxyUrl) {
      try {
        validateProxyUrl(proxyUrl);
      } catch (validationErr) {
        return res.status(400).json({ ok: false, error: 'Proxy không hợp lệ: ' + validationErr.message });
      }
    }
    return res.json({ ok: true, message: 'Proxy hợp lệ và sẵn sàng kết nối.' });
  });

  router.get('/bot/:id/proxy', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const worker = perm.worker;
    return res.json({ ok: true, proxy: worker?.proxy || null });
  });

  router.post('/bot/:id/proxy', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const proxyUrl = String(req.body?.proxy || req.body?.proxyUrl || '').trim();
    if (proxyUrl) {
      try {
        validateProxyUrl(proxyUrl);
      } catch (validationErr) {
        return res.status(400).json({ ok: false, error: 'Proxy không hợp lệ hoặc bị từ chối: ' + validationErr.message });
      }
    }

    try {
      await registry.updateProxy(perm.worker.workerId, proxyUrl || null);
      return res.json({ ok: true, message: 'Đã cập nhật proxy cho bot.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 14. UPDATE BOT SETTINGS
  router.post('/bot/:id/settings', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    if (req.managerAuthSession.role !== 'admin' && req.managerAuthSession.allowAccountChange === false) {
      return res.status(403).json({ ok: false, error: 'Gói dịch vụ của bạn không cho phép tự đổi cài đặt bot.' });
    }

    try {
      const patch = req.body || {};
      const worker = perm.worker;

      const updatedConfig = {
        ...worker,
        alias: patch.alias ? String(patch.alias).trim().slice(0, 32) : worker.alias,
        serverHost: patch.serverHost ? String(patch.serverHost).trim() : worker.serverHost,
        serverPort: patch.serverPort ? Number(patch.serverPort) : worker.serverPort,
        username: patch.username ? String(patch.username).trim() : worker.username,
        auth: patch.auth || worker.auth,
        proxy: patch.proxy !== undefined ? patch.proxy : worker.proxy,
        version: patch.version ? String(patch.version).trim() : worker.version
      };

      await registry.saveConfig(worker.workerId, updatedConfig);
      await store.addAudit({
        action: 'BOT_SETTINGS_UPDATED',
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        details: { username: updatedConfig.username, host: updatedConfig.serverHost }
      });

      return res.json({ ok: true, message: 'Đã cập nhật cài đặt bot thành công.', bot: updatedConfig });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 15. UPDATE BOT ALIAS & TAGS
  router.post('/bot/:id/alias', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const alias = String(req.body?.alias || '').trim().slice(0, 32);
    try {
      await registry.updateAlias(perm.worker.workerId, alias);
      return res.json({ ok: true, alias, message: 'Đã đổi biệt danh bot thành công.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/bot/:id/tags', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const tags = Array.isArray(req.body?.tags) ? req.body.tags.map((t) => String(t).trim().slice(0, 20)).slice(0, 5) : [];
    try {
      await registry.updateTags(perm.worker.workerId, tags);
      return res.json({ ok: true, tags, message: 'Đã cập nhật nhãn bot.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 16. EXECUTE LIFECYCLE ACTION ON BOT (start, stop, restart, reconnect, respawn, look, toss, reset)
  router.post('/bot/:id/:action', requireSession, async (req, res, next) => {
    const { id, action } = req.params;
    if (['send', 'settings', 'alias', 'tags', 'proxy', 'account', 'window', 'inventory', 'logs', 'chat-logs', 'auto-chat', 'autoChat', 'bot-schedules', 'botSchedules'].includes(action)) {
      return next();
    }
    const perm = await checkBotPermissionAsync(req, id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const allowedActions = ['start', 'stop', 'restart', 'reconnect', 'respawn', 'inventory', 'look', 'toss', 'status', 'reset'];
    if (!allowedActions.includes(action)) {
      return res.status(400).json({ ok: false, error: `Hành động "${action}" không được hỗ trợ.` });
    }

    try {
      const worker = perm.worker;
      const resolvedAction = action === 'reconnect' ? 'restart' : action;

      // Track manual stop status
      if (action === 'stop') {
        await registry.updateStatus(worker.workerId, { ...worker.status, manuallyStopped: true }, 'user-stop');
      } else if (action === 'start' || action === 'restart' || action === 'reconnect') {
        await registry.updateStatus(worker.workerId, { ...worker.status, manuallyStopped: false }, 'user-start');
      }

      const result = await broker.dispatch(worker.workerId, resolvedAction, req.body || {});
      await store.addAudit({
        action: `BOT_${action.toUpperCase()}`,
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        details: { result: result?.result || 'dispatched' }
      });

      if (result?.result && typeof result.result === 'object' && result.result.ok === false) {
        const reason = result.result.detail || result.result.error || 'UNKNOWN_ERROR';
        logger?.error?.('Bot action state sync or execution failed', {
          botId: worker.workerId,
          action,
          error: result.result.error || null,
          detail: result.result.detail || null
        });
        return res.status(500).json({
          ok: false,
          error: `Thực thi lệnh ${action} không hoàn tất: ${reason}`,
          code: result.result.error || null,
          result: result.result
        });
      }

      return res.json({
        ok: true,
        message: `Đã gửi lệnh ${action} tới Bot #${worker.botNumber || worker.workerId}.`,
        result: result?.result || null
      });
    } catch (error) {
      logger.error('Bot action failed', { botId: id, action, error: error.message });
      return res.status(500).json({ ok: false, error: 'Không thể thực thi lệnh: ' + error.message });
    }
  });

  // 17. GIFTCODE / RENTAL RENEWAL
  const handleKeyRedemption = async (req, res) => {
    const session = req.managerAuthSession;
    if (!session) return res.status(401).json({ ok: false, error: 'Chưa đăng nhập.' });

    const rawKey = req.body?.key || req.body?.code;
    const key = String(rawKey || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: 'Vui lòng nhập mã Giftcode / Khóa kích hoạt.' });

    try {
      const result = await entitlementService.redeem(session.userId, key, session.role);

      // Refresh session assigned bots and expiry in memory
      session.assignedBotIds = result.workerIds.map(Number).filter((n) => Number.isFinite(n));
      session.isPermanent = result.isPermanent;
      session.status = 'active';
      session.expiresAtRental = result.expiresAt;

      await store.addAudit({
        action: 'KEY_REDEEMED',
        targetId: session.userId,
        actorId: session.username,
        details: { keySuffix: key.slice(-4), isPermanent: result.isPermanent, expiresAt: result.expiresAt }
      });

      return res.json({
        ok: true,
        message: 'Kích hoạt / Gia hạn Giftcode thành công!',
        isPermanent: result.isPermanent,
        expiresAt: result.expiresAt,
        assignedBotIds: session.assignedBotIds
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  };

  router.post('/renew', requireSession, handleKeyRedemption);
  router.post('/rental/redeem-key', requireSession, handleKeyRedemption);

  // 18. LINK4M REWARDS
  router.get(['/rewards/link4m/status', '/status'], requireSession, async (req, res) => {
    try {
      const status = await link4mService.getDailyQuotaStatus(req.managerAuthSession.userId);
      return res.json({ ok: true, ...status });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post(['/rewards/link4m/start', '/start'], requireSession, async (req, res) => {
    try {
      const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
      const result = await link4mService.createLinkAttempt(req.managerAuthSession.userId, clientIp);
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.get(['/rewards/link4m/return', '/return'], async (req, res) => {
    try {
      const { token, attempt } = req.query;
      const safeToken = encodeURIComponent(String(token || ''));
      const safeAttempt = encodeURIComponent(String(attempt || ''));
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>KingMC - Đang xác nhận phần thưởng...</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:50px;background:#0d1117;color:#fff;">
          <h2>Đang xác thực vượt link hoàn tất...</h2>
          <p>Hệ thống đang cộng giờ sử dụng bot cho tài khoản của bạn. Vui lòng chờ...</p>
          <script>
            fetch('/api/rewards/link4m/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: '${safeToken}', attemptId: '${safeAttempt}' })
            }).then(r => r.json()).then(data => {
              if (data.ok) {
                alert('Chúc mừng! Bạn đã nhận thêm ' + (data.addedHours || data.rewardHours || 12) + ' giờ sử dụng Bot thành công.');
                window.location.href = '/';
              } else {
                alert('Xác thực thất bại: ' + (data.error || 'Token không hợp lệ.'));
                window.location.href = '/';
              }
            }).catch(() => {
              window.location.href = '/';
            });
          </script>
        </body>
        </html>
      `);
    } catch (error) {
      return res.status(500).send('Lỗi xử lý xác nhận: ' + error.message);
    }
  });

  router.post(['/rewards/link4m/verify', '/verify'], async (req, res) => {
    try {
      const rawToken = req.body?.token;
      const rawAttempt = req.body?.attemptId || req.body?.attempt;
      const token = rawToken ? decodeURIComponent(rawToken) : null;
      const attemptId = rawAttempt ? decodeURIComponent(rawAttempt) : null;

      if (!token && !attemptId) {
        return res.status(400).json({ ok: false, error: 'Thiếu token hoặc mã phiên xác nhận.' });
      }

      const result = await link4mService.verifyAndClaimReward(token, attemptId);
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 18b. DISCORD LINKING STATUS & UNLINK
  router.get(['/user/discord-link', '/discord-link'], requireSession, async (req, res) => {
    try {
      const user = req.managerAuthSession;
      const link = await store.getDiscordLink(user.userId || user.username);
      if (!link) {
        return res.json({ ok: true, linked: false });
      }
      return res.json({
        ok: true,
        linked: true,
        discordUserId: link.discord_user_id || link.discordUserId,
        username: link.username || user.username,
        linkedAt: link.linked_at || link.linkedAt || null
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post(['/user/discord-unlink', '/discord-unlink'], requireSession, async (req, res) => {
    try {
      const user = req.managerAuthSession;
      await store.unlinkDiscord(user.userId || user.username);
      return res.json({ ok: true, message: 'Đã hủy liên kết tài khoản Discord thành công.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 19. PUBLIC SYSTEM INFO
  router.get(['/public/system-info', '/system-info'], async (_req, res) => {
    const memory = process.memoryUsage();
    const bots = await registry.list();
    const onlineCount = bots.filter((b) => b.status?.state === 'online').length;

    return res.json({
      ok: true,
      service: 'KingMC AFK Bot Cloud 24/7',
      version: '11.8-Modular-Enterprise',
      uptime: Math.floor(process.uptime()),
      totalBots: bots.length,
      onlineBots: onlineCount,
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024))
      },
      time: new Date().toISOString()
    });
  });

  return router;
}

module.exports = { createUserApi };
