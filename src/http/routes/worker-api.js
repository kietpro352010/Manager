'use strict';

const express = require('express');
const { createWorkerAuth, extractWorkerSecret } = require('../middleware/worker-auth');
const { resolveClientIp } = require('../../services/captcha');
const { timingSafeStringEquals } = require('../../utils/secrets');
const { isWispbyteControlPanelUrl } = require('../../utils/http');

const POLL_TELEMETRY_KEYS = [
  'state', 'online', 'connected', 'username', 'health', 'food', 'tps', 'pingMs',
  'totemCount', 'goldenAppleCount', 'foodCount', 'position', 'dimension', 'locationState',
  'inventory', 'currentWindow', 'lastError', 'lastKickReason', 'restriction',
  'manuallyStopped', 'maintenanceWindow', 'proxyEnabled', 'serverHost', 'server',
  'uptimeSeconds', 'connectedAt', 'reconnectAttempts', 'reconnectCount',
  'cpuPercent', 'rssMb', 'heapUsedMb', 'lastStateAt'
];

function hasFiniteCoord(val) {
  return val !== null && val !== undefined && String(val).trim() !== '' && Number.isFinite(Number(val));
}

function sendCompactWorkerJson(res, payload) {
  const raw = JSON.stringify(payload);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(raw);
}

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
      const clientIp = resolveClientIp(req);
      const incomingStatus = req.body?.status || {};
      const statusWithIp = { ...incomingStatus, ...(clientIp ? { clientIp } : {}) };
      const worker = await registry.updateStatus(req.workerId, statusWithIp, 'worker-heartbeat');
      if (!worker) return res.status(404).json({ ok: false, error: 'worker_not_found' });
      const settingsRevision = typeof registry.getSettingsRevision === 'function'
        ? registry.getSettingsRevision(req.workerId)
        : 1;
      return sendCompactWorkerJson(res, { ok: true, settingsRevision });
    } catch (error) { return next(error); }
  });

  router.post('/events', auth, async (req, res, next) => {
    try {
      const body = req.body || {};
      const incomingEvents = Array.isArray(body.events)
        ? body.events.filter((e) => e && typeof e === 'object' && !Array.isArray(e)).slice(0, 50)
        : [body];
      if (incomingEvents.length === 0) {
        return res.json({ ok: true, count: 0 });
      }

      let workerMeta = undefined;
      for (const event of incomingEvents) {
        const result = await registry.addEvent(req.workerId, event);
        if (!result) {
          return res.status(404).json({ ok: false, error: 'worker_not_found_or_disabled' });
        }

        // Check alerts (resolve human-friendly bot label once per batch and pass exact parameter order)
        if (adminNotifier && ['bot_death', 'low_totem', 'afk_kicked', 'afk_recovered', 'reconnect_exhausted'].includes(event.type)) {
          try {
            if (workerMeta === undefined) {
              workerMeta = await registry.find(req.workerId).catch(() => null);
            }
            const botLabel = workerMeta?.settings?.alias || workerMeta?.alias || workerMeta?.name || req.workerId;
            if (event.type === 'bot_death') {
              await Promise.resolve(adminNotifier.notifyBotDeath?.(req.workerId, botLabel, event.coords || event.position || event.reason || null)).catch(() => {});
              if (typeof adminNotifier.notifyBotLifecycleEvent === 'function') {
                await Promise.resolve(adminNotifier.notifyBotLifecycleEvent({
                  workerId: req.workerId,
                  workerMeta,
                  event,
                  registry,
                  skipAdminAlert: true
                })).catch(() => {});
              }
            } else if (event.type === 'low_totem') {
              await Promise.resolve(adminNotifier.notifyLowTotem?.(req.workerId, botLabel, event.count ?? event.totemCount ?? 0)).catch(() => {});
            } else if (typeof adminNotifier.notifyBotLifecycleEvent === 'function') {
              await Promise.resolve(adminNotifier.notifyBotLifecycleEvent({
                workerId: req.workerId,
                workerMeta,
                event,
                registry
              })).catch(() => {});
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

      return sendCompactWorkerJson(res, Array.isArray(body.events) ? { ok: true, count: incomingEvents.length } : { ok: true });
    } catch (error) { return next(error); }
  });

  router.post('/poll', auth, async (req, res, next) => {
    const ac = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) ac.abort();
    };
    res.on('close', onClose);
    try {
      if (typeof registry.find === 'function') {
        const currentWorker = await registry.find(req.workerId);
        if (!currentWorker || currentWorker.enabled === false) {
          return res.status(404).json({ ok: false, error: 'worker_not_found' });
        }
        const currentUrl = String(currentWorker.serviceUrl || '').trim();
        const isConfiguredRenderHttp = currentWorker.provider === 'render'
          && Boolean(currentUrl)
          && !isWispbyteControlPanelUrl(currentUrl)
          && (currentWorker.status?.source === 'admin-config' || currentWorker.status?.transport === 'render-http');
        if (isConfiguredRenderHttp) {
          return res.status(409).json({ ok: false, error: 'worker_configured_for_render_http' });
        }
      }
      const clientIp = resolveClientIp(req);
      const rawStatus = req.body?.status;
      const hasStatusObj = Boolean(rawStatus && typeof rawStatus === 'object' && !Array.isArray(rawStatus));
      const hasTelemetry = hasStatusObj && POLL_TELEMETRY_KEYS.some((k) => Object.hasOwn(rawStatus, k));
      if (hasTelemetry) {
        const statusWithIp = { ...rawStatus, ...(clientIp ? { clientIp } : {}) };
        const updated = await registry.updateStatus(req.workerId, statusWithIp, 'wispbyte-poll');
        if (updated === null) {
          return res.status(404).json({ ok: false, error: 'worker_not_found' });
        }
      } else if (typeof registry.touchHeartbeat === 'function') {
        const hb = await registry.touchHeartbeat(req.workerId, { fromPoll: true });
        if (hb === null) {
          return res.status(404).json({ ok: false, error: 'worker_not_found' });
        }
      }

      const requestedWait = Number(req.body?.waitMs);
      const defaultPollWaitMs = config.workerPollWaitMs || 45000;
      const waitMs = Number.isFinite(requestedWait)
        ? Math.max(0, Math.min(defaultPollWaitMs, requestedWait))
        : defaultPollWaitMs;

      const pollOpts = { waitMs };
      Object.defineProperty(pollOpts, 'signal', {
        value: ac.signal,
        enumerable: false,
        configurable: true
      });
      const command = await broker.poll(req.workerId, pollOpts);
      if (res.writableEnded || ac.signal.aborted) return undefined;
      registry.touchLiveHeartbeat?.(req.workerId);
      const settingsRevision = typeof registry.getSettingsRevision === 'function'
        ? registry.getSettingsRevision(req.workerId)
        : 1;
      if (!command) {
        return sendCompactWorkerJson(res, { ok: true, command: null, settingsRevision });
      }
      return res.json({ ok: true, command, settingsRevision });
    } catch (error) {
      return next(error);
    } finally {
      res.off?.('close', onClose);
      res.removeListener?.('close', onClose);
    }
  });

  router.post('/result', auth, async (req, res, next) => {
    try {
      const commandId = String(req.body?.commandId || '');
      if (!/^(?:cmd_)?[0-9a-f-]{36}$/i.test(commandId)) return res.status(400).json({ ok: false, error: 'invalid_command_id' });
      if (typeof registry.find === 'function') {
        const worker = await registry.find(req.workerId);
        if (!worker || worker.enabled === false) {
          return res.status(404).json({ ok: false, error: 'worker_not_found_or_disabled' });
        }
      }
      let accepted;
      try {
        accepted = await broker.acceptResult(req.workerId, req.body || {});
      } catch (validationErr) {
        if (/^Invalid .* result/i.test(validationErr?.message || '')) {
          return res.status(400).json({ ok: false, error: 'invalid_result_payload', detail: validationErr.message });
        }
        throw validationErr;
      }
      if (accepted === false || (accepted && typeof accepted === 'object' && accepted.ok === false)) {
        const errCode = (accepted && typeof accepted === 'object' && accepted.error) ? accepted.error : 'result_rejected';
        const status = errCode === 'COMMAND_OWNERSHIP_MISMATCH'
          ? 403
          : (errCode === 'STATE_SYNC_IN_PROGRESS' || errCode === 'result_rejected' ? 409 : 500);
        return res.status(status).json({
          ok: false,
          accepted: false,
          error: errCode,
          ...(accepted?.executionCompleted !== undefined ? { executionCompleted: Boolean(accepted.executionCompleted) } : {}),
          ...(accepted?.stateSyncPending !== undefined ? { stateSyncPending: Boolean(accepted.stateSyncPending) } : {}),
          ...(accepted?.detail ? { detail: accepted.detail } : {}),
          ...(accepted?.partialResetFailures ? { partialResetFailures: accepted.partialResetFailures } : {})
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

      const clientIp = resolveClientIp(req);
      const globalSecret = config.botSecretKey || '';
      const isGlobal = Boolean(globalSecret && timingSafeStringEquals(incomingSecret, globalSecret));
      let isAuthed = isGlobal;
      if (isGlobal) {
        logger?.warn?.('GLOBAL_BOT_SECRET_USED', {
          action: 'worker-report',
          workerId,
          ip: clientIp
        });
        if (typeof workerStore?.addAudit === 'function') {
          await workerStore.addAudit({
            action: 'GLOBAL_BOT_SECRET_USED',
            targetId: workerId,
            actorId: 'system:global_secret',
            details: { ip: clientIp, endpoint: '/report' }
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

      const incomingStatus = req.body?.status || req.body || {};
      const status = { ...incomingStatus, ...(clientIp ? { clientIp } : {}) };
      await registry.updateStatus(workerId, status, 'worker-report');

      // Record position change telemetry to Cloud if coordinates provided (never coerce null/'' to 0)
      const telemetryBotId = String(existingWorker.botNumber || (/^[1-9][0-9]{0,8}$/.test(workerId) ? workerId : '')).trim();
      const rawPos = status.position;
      if (
        workerStore &&
        telemetryBotId &&
        rawPos &&
        typeof rawPos === 'object' &&
        hasFiniteCoord(rawPos.x) &&
        hasFiniteCoord(rawPos.z) &&
        (rawPos.y === undefined || hasFiniteCoord(rawPos.y))
      ) {
        const pos = {
          x: Number(rawPos.x),
          y: rawPos.y !== undefined ? Number(rawPos.y) : 0,
          z: Number(rawPos.z)
        };
        const eventKey = status.eventKey || `move:${telemetryBotId}:${Math.round(pos.x)}:${Math.round(pos.y)}:${Math.round(pos.z)}:${Math.floor(Date.now() / 5000)}`;
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
