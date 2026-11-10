'use strict';

const express = require('express');
const { validateProxyUrl } = require('../../services/proxy-validation');

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
  function checkBotPermission(req, botId) {
    const session = req.managerAuthSession;
    if (!session) return { allowed: false, status: 401, error: 'Chưa đăng nhập hệ thống.' };
    if (session.role === 'admin') return { allowed: true, user: session };

    const isExpired = session.status === 'expired' ||
      (session.expiresAtRental && Date.now() > Date.parse(session.expiresAtRental));

    if (isExpired) {
      return { allowed: false, status: 403, error: 'Tài khoản của bạn đã hết hạn thuê bot. Vui lòng gia hạn để tiếp tục sử dụng.' };
    }

    const id = String(botId);
    const assigned = Array.isArray(session.assignedBotIds) ? session.assignedBotIds.map(String) : [];
    if (assigned.includes(id)) {
      return { allowed: true, user: session };
    }
    return { allowed: false, status: 403, error: 'Bạn không có quyền quản lý bot này.' };
  }

  // 1. GET ALL ACCESSIBLE BOTS
  router.get('/bots', requireSession, async (req, res) => {
    try {
      const session = req.managerAuthSession;
      const allBots = await registry.list();

      let visibleBots = [];
      if (session.role === 'admin') {
        visibleBots = allBots;
      } else {
        const assigned = Array.isArray(session.assignedBotIds) ? session.assignedBotIds.map(String) : [];
        visibleBots = allBots.filter((b) => assigned.includes(String(b.workerId)));
      }

      // Map to safe client format with real-time status summary
      const payload = visibleBots.map((bot) => {
        const summary = registry.summary(bot.workerId) || {};
        return {
          id: bot.workerId,
          workerId: bot.workerId,
          name: bot.name || `Bot #${bot.workerId}`,
          alias: bot.alias || bot.name || `Bot #${bot.workerId}`,
          platform: bot.platform,
          enabled: bot.enabled,
          status: bot.status?.state || 'offline',
          state: bot.status?.state || 'offline',
          online: bot.status?.state === 'online',
          server: bot.status?.server || bot.serverHost || 'mc.kingmc.vn',
          health: bot.status?.health ?? 20,
          food: bot.status?.food ?? 20,
          totemCount: bot.status?.totemCount ?? 0,
          goldenAppleCount: bot.status?.goldenAppleCount ?? 0,
          inventory: bot.status?.inventory || [],
          pos: bot.status?.position || { x: 0, y: 0, z: 0 },
          ping: bot.status?.ping ?? 0,
          uptime: bot.status?.uptime ?? 0,
          lastSeen: bot.lastHeartbeat || null,
          manuallyStopped: Boolean(bot.status?.manuallyStopped),
          tags: bot.tags || [],
          summary: summary.data || null
        };
      });

      return res.json({ ok: true, bots: payload });
    } catch (error) {
      logger.error('Failed to get bots', { error: error.message });
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 2. GET SPECIFIC BOT STATE
  router.get('/bot/:id/state', requireSession, async (req, res) => {
    const perm = checkBotPermission(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const botId = String(req.params.id);
    const worker = await registry.get(botId);
    if (!worker) return res.status(404).json({ ok: false, error: 'Không tìm thấy bot.' });

    const summary = registry.summary(botId);
    return res.json({
      ok: true,
      bot: {
        id: worker.workerId,
        alias: worker.alias || worker.name || `Bot #${worker.workerId}`,
        platform: worker.platform,
        status: worker.status || {},
        logs: registry.getLogs(botId),
        summary: summary?.data || null
      }
    });
  });

  // 3. EXECUTE ACTION ON BOT (start, stop, restart, reconnect, inventory, respawn, look, toss)
  router.post('/bot/:id/:action', requireSession, async (req, res) => {
    const { id, action } = req.params;
    const perm = checkBotPermission(req, id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const allowedActions = ['start', 'stop', 'restart', 'reconnect', 'respawn', 'inventory', 'look', 'toss', 'status'];
    if (!allowedActions.includes(action)) {
      return res.status(400).json({ ok: false, error: `Hành động "${action}" không được hỗ trợ.` });
    }

    try {
      const worker = await registry.get(id);
      if (!worker) return res.status(404).json({ ok: false, error: 'Không tìm thấy bot.' });

      // Track manual stop status
      if (action === 'stop') {
        await registry.updateStatus(id, { ...worker.status, manuallyStopped: true }, 'user-stop');
      } else if (action === 'start' || action === 'restart') {
        await registry.updateStatus(id, { ...worker.status, manuallyStopped: false }, 'user-start');
      }

      const result = await broker.dispatch(id, action, req.body || {});
      await store.addAudit({
        action: `BOT_${action.toUpperCase()}`,
        targetId: id,
        actorId: req.managerAuthSession.username,
        details: { result: result?.result || 'dispatched' }
      });

      return res.json({
        ok: true,
        message: `Đã gửi lệnh ${action} tới Bot #${id}.`,
        result: result?.result || null
      });
    } catch (error) {
      logger.error('Bot action failed', { botId: id, action, error: error.message });
      return res.status(500).json({ ok: false, error: 'Không thể thực thi lệnh: ' + error.message });
    }
  });

  // 4. SEND CHAT MESSAGE VIA BOT
  router.post('/bot/:id/send', requireSession, async (req, res) => {
    const { id } = req.params;
    const perm = checkBotPermission(req, id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'Nội dung tin nhắn không được để trống.' });

    try {
      const result = await broker.dispatch(id, 'chat', { message });
      await store.addAudit({
        action: 'BOT_CHAT_SENT',
        targetId: id,
        actorId: req.managerAuthSession.username,
        details: { message: message.slice(0, 100) }
      });

      return res.json({ ok: true, message: `Đã gửi tin nhắn tới server: "${message}"` });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 5. UPDATE BOT SETTINGS (MC Credentials, Proxy, etc.)
  router.post('/bot/:id/settings', requireSession, async (req, res) => {
    const { id } = req.params;
    const perm = checkBotPermission(req, id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    if (req.managerAuthSession.role !== 'admin' && req.managerAuthSession.allowAccountChange === false) {
      return res.status(403).json({ ok: false, error: 'Gói dịch vụ của bạn không cho phép tự đổi tài khoản Minecraft.' });
    }

    try {
      const patch = req.body || {};
      const worker = await registry.get(id);
      if (!worker) return res.status(404).json({ ok: false, error: 'Không tìm thấy bot.' });

      // Clean & validate settings
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

      await registry.saveConfig(id, updatedConfig);
      await store.addAudit({
        action: 'BOT_SETTINGS_UPDATED',
        targetId: id,
        actorId: req.managerAuthSession.username,
        details: { username: updatedConfig.username, host: updatedConfig.serverHost }
      });

      return res.json({ ok: true, message: 'Đã cập nhật cài đặt bot thành công.', bot: updatedConfig });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 6. UPDATE BOT ALIAS
  router.post('/bot/:id/alias', requireSession, async (req, res) => {
    const { id } = req.params;
    const perm = checkBotPermission(req, id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const alias = String(req.body?.alias || '').trim().slice(0, 32);
    try {
      await registry.updateAlias(id, alias);
      return res.json({ ok: true, alias, message: 'Đã đổi biệt danh bot thành công.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 7. UPDATE BOT TAGS
  router.post('/bot/:id/tags', requireSession, async (req, res) => {
    const { id } = req.params;
    const perm = checkBotPermission(req, id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const tags = Array.isArray(req.body?.tags) ? req.body.tags.map((t) => String(t).trim().slice(0, 20)).slice(0, 5) : [];
    try {
      await registry.updateTags(id, tags);
      return res.json({ ok: true, tags, message: 'Đã cập nhật nhãn bot.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 8. PROXY GET / SET
  router.get('/bot/:id/proxy', requireSession, async (req, res) => {
    const { id } = req.params;
    const perm = checkBotPermission(req, id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const worker = await registry.get(id);
    return res.json({ ok: true, proxy: worker?.proxy || null });
  });

  router.post('/bot/:id/proxy', requireSession, async (req, res) => {
    const { id } = req.params;
    const perm = checkBotPermission(req, id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const proxyUrl = String(req.body?.proxy || '').trim();
    if (proxyUrl) {
      const validation = await validateProxyUrl(proxyUrl);
      if (!validation.ok) {
        return res.status(400).json({ ok: false, error: 'Proxy không hợp lệ hoặc bị từ chối: ' + validation.error });
      }
    }

    try {
      await registry.updateProxy(id, proxyUrl || null);
      return res.json({ ok: true, message: 'Đã cập nhật proxy cho bot.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 9. GIFTCODE / RENTAL RENEWAL
  const handleKeyRedemption = async (req, res) => {
    const session = req.managerAuthSession;
    if (!session) return res.status(401).json({ ok: false, error: 'Chưa đăng nhập.' });

    const rawKey = req.body?.key || req.body?.code;
    const key = String(rawKey || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: 'Vui lòng nhập mã Giftcode / Khóa kích hoạt.' });

    try {
      const result = await entitlementService.redeem(session.userId, key, session.role);

      // Refresh session assigned bots and expiry in memory
      session.assignedBotIds = result.workerIds.map(Number).filter(n => Number.isFinite(n));
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

  // 10. LINK4M REWARDS
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
      const { token } = req.query;
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
              body: JSON.stringify({ token: '${encodeURIComponent(String(token || ''))}' })
            }).then(r => r.json()).then(data => {
              if (data.ok) {
                alert('Chúc mừng! Bạn đã nhận thêm ' + (data.addedHours || 4) + ' giờ sử dụng Bot thành công.');
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
      const token = req.body?.token;
      if (!token) return res.status(400).json({ ok: false, error: 'Thiếu token xác nhận.' });
      const result = await link4mService.verifyAndClaimReward(decodeURIComponent(token));
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 11. PUBLIC SYSTEM INFO
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
