'use strict';

const express = require('express');
const { createWorkerAuth, extractWorkerSecret } = require('../middleware/worker-auth');
const { timingSafeStringEquals } = require('../../utils/secrets');

function createWorkerApi({ registry, broker, workerStore, adminNotifier, config, logger }) {
  const router = express.Router({ mergeParams: true });
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
    const orig = router[method].bind(router);
    router[method] = (path, ...handlers) => orig(
      path,
      ...handlers.map((fn) => (typeof fn === 'function' && fn.length < 4
        ? (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
        : fn))
    );
  }
  const auth = createWorkerAuth(registry);

  function getWorkerClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
      const first = forwarded.split(',')[0].trim();
      if (first) return first;
    }
    return req.ip || req.socket?.remoteAddress || null;
  }

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
      const clientIp = getWorkerClientIp(req);
      const incomingStatus = req.body?.status || {};
      const statusWithIp = { ...incomingStatus, ...(clientIp ? { clientIp } : {}) };
      const worker = await registry.updateStatus(req.workerId, statusWithIp, 'worker-heartbeat');
      if (!worker) return res.status(404).json({ ok: false, error: 'worker_not_found' });
      const settingsRevision = typeof registry.getSettingsRevision === 'function'
        ? registry.getSettingsRevision(req.workerId)
        : 1;
      return res.json({ ok: true, settingsRevision });
    } catch (error) { return next(error); }
  });

  router.post('/events', auth, async (req, res, next) => {
    try {
      const event = req.body || {};
      const result = await registry.addEvent(req.workerId, event);
      if (!result) {
        return res.status(404).json({ ok: false, error: 'worker_not_found_or_disabled' });
      }

      // Check alerts (resolve human-friendly bot label and pass exact parameter order)
      if (adminNotifier) {
        if (['bot_death', 'low_totem', 'afk_kicked', 'afk_recovered', 'reconnect_exhausted'].includes(event.type)) {
          try {
            const workerMeta = await registry.find(req.workerId).catch(() => null);
            const botLabel = workerMeta?.alias || workerMeta?.name || req.workerId;
            if (event.type === 'bot_death') {
              await Promise.resolve(adminNotifier.notifyBotDeath?.(req.workerId, botLabel, event.coords || event.position || event.reason || null));
              if (typeof adminNotifier.notifyBotLifecycleEvent === 'function') {
                await adminNotifier.notifyBotLifecycleEvent({
                  workerId: req.workerId,
                  workerMeta,
                  event,
                  registry,
                  skipAdminAlert: true
                });
              }
            } else if (event.type === 'low_totem') {
              await Promise.resolve(adminNotifier.notifyLowTotem?.(req.workerId, botLabel, event.count ?? event.totemCount ?? 0));
            } else if (typeof adminNotifier.notifyBotLifecycleEvent === 'function') {
              await adminNotifier.notifyBotLifecycleEvent({
                workerId: req.workerId,
                workerMeta,
                event,
                registry
              });
            }
          } catch (notifyErr) {
            logger?.warn?.('worker_event_notification_failed', {
              workerId: req.workerId,
              eventType: event.type,
              error: notifyErr?.message || String(notifyErr)
            });
          }
        }
      }

      return res.json({ ok: true });
    } catch (error) { return next(error); }
  });

  router.post('/poll', auth, async (req, res, next) => {
    try {
      const clientIp = getWorkerClientIp(req);
      const incomingStatus = req.body?.status || {};
      const statusWithIp = { ...incomingStatus, ...(clientIp ? { clientIp } : {}) };
      await registry.updateStatus(req.workerId, statusWithIp, 'wispbyte-poll');
      const requestedWait = Number(req.body?.waitMs);
      const waitMs = Number.isFinite(requestedWait)
        ? Math.max(0, Math.min(config.workerPollWaitMs || 15000, requestedWait))
        : (config.workerPollWaitMs || 15000);

      const command = await broker.poll(req.workerId, { waitMs });
      const settingsRevision = typeof registry.getSettingsRevision === 'function'
        ? registry.getSettingsRevision(req.workerId)
        : 1;
      return res.json({ ok: true, command, settingsRevision });
    } catch (error) { return next(error); }
  });

  router.post('/result', auth, async (req, res, next) => {
    try {
      const commandId = String(req.body?.commandId || '');
      if (!/^(?:cmd_)?[0-9a-f-]{36}$/i.test(commandId)) return res.status(400).json({ ok: false, error: 'invalid_command_id' });
      const accepted = await broker.acceptResult(req.workerId, req.body || {});
      if (accepted && typeof accepted === 'object' && accepted.ok === false && accepted.error) {
        const status = accepted.error === 'COMMAND_OWNERSHIP_MISMATCH'
          ? 403
          : (accepted.error === 'STATE_SYNC_IN_PROGRESS' ? 409 : 500);
        return res.status(status).json({
          ok: false,
          accepted: false,
          error: accepted.error,
          ...(accepted.executionCompleted !== undefined ? { executionCompleted: Boolean(accepted.executionCompleted) } : {}),
          ...(accepted.stateSyncPending !== undefined ? { stateSyncPending: Boolean(accepted.stateSyncPending) } : {}),
          ...(accepted.detail ? { detail: accepted.detail } : {}),
          ...(accepted.partialResetFailures ? { partialResetFailures: accepted.partialResetFailures } : {})
        });
      }
      return res.json({ ok: true, accepted });
    } catch (error) { return next(error); }
  });

  // 2. Direct Worker Node Endpoints (WispByte pull/report architecture)
  router.post('/report', async (req, res) => {
    try {
      const incomingSecret = extractWorkerSecret(req);
      const workerId = String(req.body?.workerId || req.body?.id || req.headers['x-manager-bot-id'] || '').trim().toLowerCase();
      if (!workerId) return res.status(400).json({ ok: false, error: 'missing_worker_id' });

      const globalSecret = config.botSecretKey || '';
      const isGlobal = Boolean(globalSecret && timingSafeStringEquals(incomingSecret, globalSecret));
      let isAuthed = isGlobal;
      if (isGlobal) {
        logger?.warn?.('GLOBAL_BOT_SECRET_USED', {
          action: 'worker-report',
          workerId,
          ip: req.ip
        });
        if (typeof workerStore?.addAudit === 'function') {
          await workerStore.addAudit({
            action: 'GLOBAL_BOT_SECRET_USED',
            targetId: workerId,
            actorId: 'system:global_secret',
            details: { ip: req.ip, endpoint: '/report' }
          }).catch(() => null);
        }
      } else {
        isAuthed = await registry.authenticate(workerId, incomingSecret);
      }

      if (!isAuthed) {
        return res.status(401).json({ ok: false, error: 'unauthorized_worker_secret' });
      }

      const existingWorker = await registry.find(workerId);
      if (!existingWorker || existingWorker.enabled === false) {
        return res.status(404).json({ ok: false, error: 'worker_not_found_or_disabled' });
      }

      const clientIp = getWorkerClientIp(req);
      const incomingStatus = req.body?.status || req.body || {};
      const status = { ...incomingStatus, ...(clientIp ? { clientIp } : {}) };
      await registry.updateStatus(workerId, status, 'worker-report');

      // Record position change telemetry to Cloud if coordinates provided
      const telemetryBotId = String(existingWorker.botNumber || (/^[1-9][0-9]{0,8}$/.test(workerId) ? workerId : '')).trim();
      if (workerStore && telemetryBotId && status.position && Number.isFinite(Number(status.position.x))) {
        const pos = status.position;
        const eventKey = status.eventKey || `move:${telemetryBotId}:${Math.round(Number(pos.x))}:${Math.round(Number(pos.y ?? 0))}:${Math.round(Number(pos.z ?? 0))}:${Math.floor(Date.now() / 5000)}`;
        await workerStore.recordPositionChange({
          botId: telemetryBotId,
          changedAt: status.changedAt || new Date().toISOString(),
          position: pos,
          dimension: status.dimension || 'unknown',
          locationState: status.locationState || status.state || 'Unknown',
          reason: status.positionReason || 'MOVE',
          eventKey,
          minDistance: Number.isFinite(Number(status.minDistance)) ? Number(status.minDistance) : 5.0
        }).catch(() => false);
      }

      return res.json({ ok: true, ack: true, time: new Date().toISOString() });
    } catch (error) {
      logger?.error('Worker report error', { error: error.message });
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  return router;
}

module.exports = { createWorkerApi };
