'use strict';

const express = require('express');
const { createWorkerAuth } = require('../middleware/worker-auth');
const { timingSafeStringEquals } = require('../../utils/secrets');

function createWorkerApi({ registry, broker, workerStore, adminNotifier, config, logger }) {
  const router = express.Router({ mergeParams: true });
  const auth = createWorkerAuth(registry);

  // 1. Scoped routes: /api/v1/workers/:workerId/*
  router.get('/bootstrap', auth, async (req, res, next) => {
    try {
      const bootstrap = await registry.bootstrap(req.workerId);
      if (!bootstrap) return res.status(404).json({ ok: false, error: 'worker_not_found' });
      return res.json({ ok: true, ...bootstrap });
    } catch (error) { return next(error); }
  });

  router.post('/heartbeat', auth, async (req, res, next) => {
    try {
      const worker = await registry.updateStatus(req.workerId, req.body?.status || {}, 'worker-heartbeat');
      if (!worker) return res.status(404).json({ ok: false, error: 'worker_not_found' });
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  router.post('/events', auth, async (req, res, next) => {
    try {
      const event = req.body || {};
      await registry.addEvent(req.workerId, event);

      // Check alerts
      if (adminNotifier) {
        if (event.type === 'bot_death') {
          adminNotifier.notifyBotDeath(req.workerId, event.reason || 'Không rõ nguyên nhân');
        } else if (event.type === 'low_totem') {
          adminNotifier.notifyLowTotem(req.workerId, event.count || 0);
        }
      }

      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  router.post('/poll', auth, async (req, res, next) => {
    try {
      await registry.updateStatus(req.workerId, req.body?.status || {}, 'wispbyte-poll');
      const requestedWait = Number(req.body?.waitMs);
      const waitMs = Number.isFinite(requestedWait)
        ? Math.max(0, Math.min(config.workerPollWaitMs || 15000, requestedWait))
        : (config.workerPollWaitMs || 15000);

      const command = await broker.poll(req.workerId, waitMs);
      return res.json({ ok: true, command });
    } catch (error) { return next(error); }
  });

  router.post('/result', auth, async (req, res, next) => {
    try {
      const commandId = String(req.body?.commandId || '');
      if (!/^[0-9a-f-]{36}$/i.test(commandId)) return res.status(400).json({ ok: false, error: 'invalid_command_id' });
      const accepted = await broker.acceptResult(req.workerId, req.body || {});
      return res.json({ ok: true, accepted });
    } catch (error) { return next(error); }
  });

  // 2. Direct Worker Node Endpoints (WispByte pull/report architecture)
  router.post('/report', async (req, res) => {
    try {
      const incomingSecret = req.headers['x-bot-secret'] || req.headers['x-worker-secret'] || '';
      const workerId = String(req.body?.workerId || req.body?.id || req.headers['x-manager-bot-id'] || '').trim();
      if (!workerId) return res.status(400).json({ ok: false, error: 'missing_worker_id' });

      const globalSecret = config.botSecretKey || '';
      const isAuthed = (globalSecret && timingSafeStringEquals(incomingSecret, globalSecret)) ||
                       (await registry.authenticate(workerId, incomingSecret));

      if (!isAuthed) {
        return res.status(401).json({ ok: false, error: 'unauthorized_worker_secret' });
      }

      const status = req.body?.status || req.body || {};
      await registry.updateStatus(workerId, status, 'worker-report');

      // Record position change telemetry to Cloud if coordinates provided
      if (workerStore && status.position && Number.isFinite(status.position.x)) {
        await workerStore.recordPositionChange(workerId, status.position).catch(() => false);
      }

      return res.json({ ok: true, ack: true, time: new Date().toISOString() });
    } catch (error) {
      logger?.error('Worker report error', { error: error.message });
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

module.exports = { createWorkerApi };
