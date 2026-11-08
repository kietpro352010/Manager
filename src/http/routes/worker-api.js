'use strict';

const express = require('express');
const { createWorkerAuth } = require('../middleware/worker-auth');

function createWorkerApi({ registry, broker, config }) {
  const router = express.Router({ mergeParams: true });
  const auth = createWorkerAuth(registry);

  router.use(auth);

  router.get('/bootstrap', async (req, res, next) => {
    try {
      const bootstrap = await registry.bootstrap(req.workerId);
      if (!bootstrap) return res.status(404).json({ ok: false, error: 'worker_not_found' });
      return res.json({ ok: true, ...bootstrap });
    } catch (error) { return next(error); }
  });

  router.post('/heartbeat', async (req, res, next) => {
    try {
      const worker = await registry.updateStatus(req.workerId, req.body?.status || {}, 'worker-heartbeat');
      if (!worker) return res.status(404).json({ ok: false, error: 'worker_not_found' });
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  router.post('/events', async (req, res, next) => {
    try {
      await registry.addEvent(req.workerId, req.body || {});
      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  router.post('/poll', async (req, res, next) => {
    try {
      const status = await registry.updateStatus(req.workerId, req.body?.status || {}, 'wispbyte-poll');
      if (!status) return res.status(404).json({ ok: false, error: 'worker_not_found' });
      const requestedWait = Number(req.body?.waitMs);
      const waitMs = Number.isFinite(requestedWait) ? Math.max(0, Math.min(config.workerPollWaitMs, requestedWait)) : config.workerPollWaitMs;
      const command = await broker.poll(req.workerId, waitMs);
      return res.json({ ok: true, command });
    } catch (error) { return next(error); }
  });

  router.post('/result', async (req, res, next) => {
    try {
      const commandId = String(req.body?.commandId || '');
      if (!/^[0-9a-f-]{36}$/i.test(commandId)) return res.status(400).json({ ok: false, error: 'invalid_command_id' });
      const accepted = await broker.acceptResult(req.workerId, req.body || {});
      return res.json({ ok: true, accepted });
    } catch (error) { return next(error); }
  });

  return router;
}

module.exports = { createWorkerApi };
