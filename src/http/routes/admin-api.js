'use strict';

const express = require('express');
const { decryptUserPassword, hashAdminPassword } = require('../../utils/secrets');
const rawSchema = require('../../storage/schema-sql');
const SCHEMA_SQL = typeof rawSchema === 'string' ? rawSchema : (rawSchema?.SCHEMA_SQL || '');

function createAdminApi({
  store,
  entitlementService,
  registry,
  broker,
  fleetOperations,
  adminNotifier,
  config,
  logger
}) {
  const router = express.Router();

  // Middleware: Require Admin Role
  function requireAdmin(req, res, next) {
    const session = req.managerAuthSession;
    if (!session || session.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (ADMIN) mới có quyền truy cập.' });
    }
    return next();
  }

  router.use(requireAdmin);

  // 1. USER MANAGEMENT
  router.get('/users', async (_req, res) => {
    try {
      const users = await store.listAccess();
      return res.json({ ok: true, users });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/users', async (req, res) => {
    try {
      const { action, userId, values } = req.body || {};
      if (action === 'delete') {
        await store.removeAccess(userId);
        await store.addAudit({ action: 'ADMIN_DELETE_USER', targetId: userId, actorId: req.managerAuthSession.username });
        return res.json({ ok: true, message: 'Đã xóa người dùng thành công.' });
      }

      await store.setAccess(userId, values || {}, req.managerAuthSession.username);
      await store.addAudit({ action: 'ADMIN_UPDATE_USER', targetId: userId, actorId: req.managerAuthSession.username, details: values });
      return res.json({ ok: true, message: 'Đã cập nhật thông tin người dùng.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/users/:id/reveal-password', async (req, res) => {
    try {
      const { id } = req.params;
      const user = await store.getUser(id);
      if (!user) return res.status(404).json({ ok: false, error: 'Không tìm thấy người dùng.' });

      const decrypted = decryptUserPassword(user.password);
      return res.json({ ok: true, password: decrypted || '(Không thể giải mã hoặc mật khẩu trống)' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/users/:id/renew-days', async (req, res) => {
    try {
      const { id } = req.params;
      const { days, isPermanent } = req.body || {};
      const access = await store.getAccess(id);
      if (!access) return res.status(404).json({ ok: false, error: 'Không tìm thấy người dùng.' });

      let newExpiry = access.expiresAt;
      if (isPermanent) {
        newExpiry = null;
      } else {
        const addedDays = Number(days) || 30;
        const currentMs = access.expiresAt ? Date.parse(access.expiresAt) : Date.now();
        const baseMs = Math.max(Date.now(), Number.isFinite(currentMs) ? currentMs : Date.now());
        newExpiry = new Date(baseMs + addedDays * 86400000).toISOString();
      }

      await store.setAccess(id, {
        isPermanent: Boolean(isPermanent),
        expiresAt: newExpiry,
        status: 'active'
      }, req.managerAuthSession.username);

      return res.json({ ok: true, message: 'Gia hạn người dùng thành công.', expiresAt: newExpiry, isPermanent: Boolean(isPermanent) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 2. AUDIT LOGS
  router.get('/audit-logs', async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(10, Number(req.query?.limit) || 100));
      const logs = await store.listAudit(limit);
      return res.json({ ok: true, logs });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/audit-logs/clear', async (req, res) => {
    try {
      if (store.client) {
        await store.client.from('manager_audit').delete().neq('id', 0);
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
        const headers = ['id', 'action', 'target_id', 'actor_id', 'created_at', 'details'];
        const rows = logs.map(l => [
          l.id || '',
          l.action || '',
          l.targetId || '',
          l.actorId || '',
          l.createdAt || '',
          JSON.stringify(l.details || {}).replace(/"/g, '""')
        ].map(val => `"${val}"`).join(','));
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

  // 3. GIFTCODES & LICENSE KEYS
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
      const { days, permanent, botCount, workerIds, maxUses, planName, count } = req.body || {};
      const numKeys = Math.min(50, Math.max(1, Number(count) || 1));
      const generated = [];

      for (let i = 0; i < numKeys; i++) {
        const key = await entitlementService.createCode({
          days: Number(days) || 30,
          permanent: Boolean(permanent),
          botCount: Number(botCount) || 1,
          workerIds: Array.isArray(workerIds) ? workerIds : [],
          maxUses: Number.isFinite(Number(maxUses)) ? Number(maxUses) : 1,
          planName: planName || 'Standard',
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

  // 4. SUPABASE CLOUD MANAGEMENT
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

  router.get('/supabase/schema', (_req, res) => {
    return res.type('text/plain').send(SCHEMA_SQL);
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
      await registry.load();
      return res.json({ ok: true, message: 'Đã đồng bộ dữ liệu mới nhất từ Supabase về RAM.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 5. CLOUD BACKUPS
  router.get('/backups', async (_req, res) => {
    try {
      const backups = await store.fetchBackups();
      return res.json({ ok: true, backups });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/backups/create', async (req, res) => {
    try {
      const name = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const payload = {
        registry: await registry.list(),
        users: await store.listAccess(),
        keys: await entitlementService.listCodes(500),
        timestamp: new Date().toISOString()
      };
      await store.saveBackup(name, payload);
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

      if (backup.registry) {
        for (const bot of backup.registry) {
          await registry.saveConfig(bot.workerId, bot);
        }
      }
      return res.json({ ok: true, message: 'Đã khôi phục dữ liệu từ bản sao lưu.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 6. FLEET BULK CONTROLS
  router.post('/all/send', async (req, res) => {
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'Tin nhắn không được để trống.' });

    try {
      const workers = (await registry.list()).filter(w => w.status?.state === 'online');
      const results = await Promise.allSettled(
        workers.map(w => broker.dispatch(w.workerId, 'chat', { message }))
      );
      return res.json({ ok: true, message: `Đã phát tin nhắn tới ${workers.length} bot đang online.` });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/all/:action', async (req, res, next) => {
    const { action } = req.params;
    if (action === 'send') return next();
    try {
      if (action === 'start') {
        const result = await fleetOperations.startAll({ respectManuallyStopped: false });
        return res.json({ ok: true, message: 'Đã gửi lệnh bật toàn bộ bot.', result });
      } else if (action === 'stop') {
        const result = await fleetOperations.stopAll();
        return res.json({ ok: true, message: 'Đã gửi lệnh tắt toàn bộ bot.', result });
      } else if (action === 'reconnect') {
        const result = await fleetOperations.reconnectErrors();
        return res.json({ ok: true, message: 'Đã gửi lệnh kết nối lại các bot bị lỗi.', result });
      }
      return res.status(400).json({ ok: false, error: 'Hành động không hợp lệ.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 7. DIAGNOSTICS & SYSTEM METRICS
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
