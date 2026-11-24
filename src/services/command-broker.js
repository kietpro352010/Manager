'use strict';

const { randomUUID } = require('node:crypto');
const { readJson, isWispbyteControlPanelUrl } = require('../utils/http');
const { resolveAndValidateHost, validateProxyUrl } = require('./proxy-validation');
const { ACTIONS } = require('./worker-registry');

const ALL_RESET_SYNC_STEPS = Object.freeze(['registry.resetData', 'commandStore.clearWorker', 'registry.updateStatus']);
const DEFAULT_MAX_STATE_SYNC_ATTEMPTS = 8;
// Worker commands can spend up to 30s queued, then up to 15s executing.
const DEFAULT_RENDER_COMMAND_TIMEOUT_MS = 50000;

class CommandBroker {
  constructor({ registry, commandStore, config, logger, fetchImpl = global.fetch }) {
    this.registry = registry;
    this.commandStore = commandStore;
    this.config = config;
    this.logger = logger;
    this.fetch = fetchImpl;
    this.instanceId = `mgr_${process.pid}_${randomUUID().slice(0, 8)}`;
    this.pollWaiters = new Map();
    this.wakeVersions = new Map();
    this.pendingResults = new Map();
    this.resultWaiters = new Map();
    this.outboxTimer = null;
    this.outboxIntervalMs = 30000;
    this.outboxRunning = false;
    this.idleOutboxTicks = 0;
    this.stateSyncRunning = false;
    this.stateSyncBlockedReason = null;
    this.missingAtomicRpcLogged = false;
  }

  getStateSyncLeaseConfig() {
    const explicitMs = Number(this.config?.stateSyncLeaseMs);
    const explicitSec = Number(this.config?.stateSyncLeaseSeconds);
    let leaseMs;
    if (Number.isFinite(explicitMs) && explicitMs > 0) {
      leaseMs = Math.max(50, explicitMs);
    } else if (Number.isFinite(explicitSec) && explicitSec > 0) {
      leaseMs = Math.max(50, explicitSec * 1000);
    } else {
      const baseTimeoutMs = Math.max(10000, Number(this.config?.commandResultTimeoutMs) || 30000);
      leaseMs = Math.max(45000, baseTimeoutMs * 2);
    }
    const leaseSeconds = Math.max(1, Math.ceil(leaseMs / 1000));
    const renewIntervalMs = Math.max(20, Math.min(Math.floor(leaseMs / 3), 20000));
    return { leaseMs, leaseSeconds, renewIntervalMs };
  }

  _scheduleNextOutboxTick(delayMs) {
    if (this.outboxTimer) {
      clearTimeout(this.outboxTimer);
      this.outboxTimer = null;
    }
    if (!this._outboxActive) return;
    const safeDelay = Math.max(100, Number(delayMs) || this.outboxIntervalMs);
    this.outboxTimer = setTimeout(async () => {
      this.outboxTimer = null;
      if (!this._outboxActive) return;
      const hadWork = await this.processOutboxBatch().catch(() => false);
      if (hadWork) {
        this.idleOutboxTicks = 0;
        this._scheduleNextOutboxTick(this.outboxIntervalMs);
      } else {
        this.idleOutboxTicks = Math.min(10, this.idleOutboxTicks + 1);
        const backoffSchedule = [this.outboxIntervalMs, 60000, 180000, 300000];
        const nextDelay = backoffSchedule[Math.min(this.idleOutboxTicks, backoffSchedule.length - 1)];
        this._scheduleNextOutboxTick(Math.max(this.outboxIntervalMs, nextDelay));
      }
    }, safeDelay);
    this.outboxTimer.unref?.();
  }

  startOutboxProcessor({ intervalMs = 30000 } = {}) {
    if (this._outboxActive) return;
    this._outboxActive = true;
    this.outboxIntervalMs = Math.max(1000, Number(intervalMs) || 30000);
    this.idleOutboxTicks = 0;
    this._scheduleNextOutboxTick(this.outboxIntervalMs);
  }

  triggerOutbox(delayMs = 250) {
    if (!this._outboxActive) return;
    this.idleOutboxTicks = 0;
    this._scheduleNextOutboxTick(delayMs);
  }

  stopOutboxProcessor() {
    this._outboxActive = false;
    if (this.outboxTimer) {
      clearTimeout(this.outboxTimer);
      this.outboxTimer = null;
    }
  }

  async processOutboxBatch() {
    let hadWork = false;
    const syncSummary = await this.processPendingStateSyncs().catch((err) => {
      this.logger?.warn?.('pending_state_sync_batch_error', { message: err.message });
      return null;
    });
    if (syncSummary && syncSummary.processed > 0) hadWork = true;

    if (this.outboxRunning) return hadWork;
    this.outboxRunning = true;
    try {
      const store = this.commandStore?.adapter || this.registry?.store?.adapter;
      if (!store || typeof store.claimOutboxBatch !== 'function') return hadWork;

      const batch = await store.claimOutboxBatch(this.instanceId, 10, 60);
      if (!Array.isArray(batch) || batch.length === 0) return hadWork;
      hadWork = true;

      for (const item of batch) {
        const payload = item.payload || {};
        const workerId = String(payload.workerId || item.worker_id || '');
        const action = item.task_type || item.type || 'status';

        try {
          if (action === 'pending_allocation_compensation') {
            await store.completeOutboxItem(item.id, this.instanceId);
            continue;
          }
          const worker = await this.registry.find(workerId);
          if (!worker || !worker.enabled) {
            await store.failOutboxItem(item.id, this.instanceId, 'WORKER_DISABLED_OR_NOT_FOUND');
            continue;
          }

          if (!this._shouldUsePollTransport(worker) && worker.serviceUrl) {
            await this.dispatchRender(worker, { commandId: item.id, action, payload });
            await store.completeOutboxItem(item.id, this.instanceId);
          } else {
            // WispByte pull mode: command already queued in manager_commands; wake poller & mark outbox done
            if (this.hasActivePoller(workerId)) {
              this.wakePoller(workerId);
            }
            await store.completeOutboxItem(item.id, this.instanceId);
          }
        } catch (err) {
          try {
            const attempts = Number(item.attempts || 1);
            if (attempts >= 8) {
              await store.failOutboxItem(item.id, this.instanceId, err.message || 'MAX_RETRIES_EXCEEDED');
            } else {
              const nextRetryDelaySec = Math.min(3600, Math.pow(2, attempts) * 10);
              const nextRetryAtIso = new Date(Date.now() + nextRetryDelaySec * 1000).toISOString();
              await store.rescheduleOutboxItem(item.id, this.instanceId, nextRetryAtIso, err.message);
              this.triggerOutbox(nextRetryDelaySec * 1000);
            }
          } catch (failErr) {
            this.logger?.warn?.('outbox_reschedule_failed', { itemId: item.id, error: failErr?.message });
          }
        }
      }
    } catch (err) {
      this.logger?.warn('outbox_processing_error', { message: err.message });
    } finally {
      this.outboxRunning = false;
    }
    return hadWork;
  }

  normalizePayload(action, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      const err = new Error('Command payload must be an object.');
      err.code = 'INVALID_PAYLOAD';
      err.status = 400;
      throw err;
    }
    // These are WorkerRuntime controls, not user-facing command options. Keeping
    // them out preserves the Manager's dispatch deadline and the Worker's queue.
    const safePayload = { ...payload };
    delete safePayload.timeoutMs;
    delete safePayload.execTimeoutMs;
    delete safePayload.queueTimeoutMs;
    if (action === 'chat') {
      const message = String(safePayload.message || '').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();
      if (!message || message.length > 256) {
        const err = new Error('Chat message must contain 1–256 characters.');
        err.code = 'INVALID_PAYLOAD';
        err.status = 400;
        throw err;
      }
      return { message };
    }
    if (action === 'set-afk-mode') {
      return { mode: 'still' };
    }
    if (action === 'set-proxy') {
      return { url: String(safePayload.url || '').trim() };
    }
    return safePayload;
  }

  _shouldUsePollTransport(worker) {
    if (!worker || typeof worker !== 'object') return true;
    if (worker.provider !== 'render') return true;
    if (this.hasActivePoller(worker.workerId)) return true;
    const transport = String(worker.transport || worker.status?.transport || '').trim().toLowerCase();
    if (transport === 'wispbyte-poll') return true;
    const source = String(worker.status?.source || '').trim().toLowerCase();
    if (source === 'wispbyte-poll') return true;
    const serviceUrl = String(worker.serviceUrl || '').trim();
    if (isWispbyteControlPanelUrl(serviceUrl)) return true;
    if (!serviceUrl && !String(worker.renderServiceId || '').trim()) return true;
    return false;
  }

  async dispatch(workerId, action, payload = {}) {
    if (!ACTIONS.has(action)) {
      const err = new Error(`Unsupported worker action: ${action}`);
      err.code = 'UNSUPPORTED_ACTION';
      err.status = 400;
      throw err;
    }
    const safePayload = this.normalizePayload(action, payload);
    if (action === 'set-proxy') {
      if (!safePayload.url) {
        const err = new Error('Proxy URL is required for set-proxy.');
        err.code = 'INVALID_PAYLOAD';
        err.status = 400;
        throw err;
      }
      try {
        safePayload.url = await validateProxyUrl(safePayload.url);
      } catch (proxyErr) {
        proxyErr.code = 'INVALID_PAYLOAD';
        proxyErr.status = 400;
        throw proxyErr;
      }
    }
    const worker = await this.registry.find(workerId);
    if (!worker) {
      const err = new Error(`Worker ${workerId} is not registered.`);
      err.code = 'WORKER_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    if (!worker.enabled) {
      const err = new Error(`Worker ${workerId} is disabled.`);
      err.code = 'WORKER_DISABLED';
      err.status = 409;
      throw err;
    }

    this.idleOutboxTicks = 0;
    const usePoll = this._shouldUsePollTransport(worker);
    this.logger.info('worker_command_dispatch', {
      workerId,
      provider: worker.provider,
      transport: usePoll ? 'wispbyte-poll' : 'render-http',
      action
    });
    const resolvedAction = action === 'reconnect' ? 'restart' : action;
    const command = {
      commandId: randomUUID(),
      action: resolvedAction,
      payload: safePayload,
      createdAt: new Date().toISOString()
    };

    if (!usePoll) {
      return this.dispatchRender(worker, command);
    }

    const hasRecentHeartbeat = Boolean(worker.lastHeartbeat && Date.now() - new Date(worker.lastHeartbeat).getTime() <= 120000);
    if (!this.hasActivePoller(worker.workerId) && !hasRecentHeartbeat) {
      const err = new Error(`Wispbyte worker ${workerId} has not checked in recently.`);
      err.code = 'WORKER_UNAVAILABLE';
      err.status = 503;
      throw err;
    }
    return this.dispatchPoll(worker, command);
  }

  async dispatchRender(worker, command) {
    const baseUrl = String(worker?.serviceUrl || '').trim().replace(/\/+$/, '');
    if (!baseUrl) {
      const err = new Error('Render worker has no configured service URL.');
      err.code = 'INVALID_WORKER_URL';
      err.status = 400;
      throw err;
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      const err = new Error('Render worker service URL is invalid.');
      err.code = 'INVALID_WORKER_URL';
      err.status = 400;
      throw err;
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      const err = new Error('Render worker URL must use http:// or https://.');
      err.code = 'INVALID_WORKER_URL';
      err.status = 400;
      throw err;
    }
    if (isWispbyteControlPanelUrl(baseUrl)) {
      const err = new Error('URL cấu hình của Bot là trang quản trị Wispbyte (không nhận lệnh HTTP Push). Hãy xóa Web URL bot để dùng chế độ Wispbyte Pull.');
      err.code = 'INVALID_WORKER_URL';
      err.status = 422;
      throw err;
    }
    if (parsedUrl.username || parsedUrl.password || parsedUrl.hostname.includes('%')) {
      const err = new Error('Render worker URL contains invalid credentials or zone identifier.');
      err.code = 'INVALID_WORKER_URL';
      err.status = 400;
      throw err;
    }
    const allowLocal = process.env.ALLOW_LOCAL_BOT_URLS === 'true' || process.env.NODE_ENV !== 'production';
    const hostLower = parsedUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const isLoopback = hostLower === 'localhost' || hostLower === '127.0.0.1' || hostLower === '::1';
    if (parsedUrl.protocol === 'http:' && !(allowLocal && isLoopback) && (process.env.NODE_ENV === 'production' || this.fetch === global.fetch)) {
      const err = new Error('Render worker URL must use HTTPS.');
      err.code = 'INVALID_WORKER_URL';
      err.status = 400;
      throw err;
    }
    try {
      await resolveAndValidateHost(hostLower, { allowLocal: allowLocal && isLoopback });
    } catch (urlErr) {
      const msg = String(urlErr?.message || '');
      const isDnsFailure = /Lỗi phân giải DNS|Không thể phân giải DNS/i.test(msg);
      if (!(this.fetch !== global.fetch && isDnsFailure)) {
        urlErr.code = urlErr.code || 'INVALID_WORKER_URL';
        urlErr.status = urlErr.status || 400;
        throw urlErr;
      }
    }

    const secret = await this.registry.credential(worker.workerId);
    if (!secret) {
      const err = new Error(`Missing worker secret for ${worker.workerId}.`);
      err.code = 'MISSING_WORKER_SECRET';
      err.status = 500;
      throw err;
    }
    let response;
    let body;
    try {
      response = await this.fetch(`${baseUrl}/api/v1/bots/${encodeURIComponent(worker.workerId)}/command`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-worker-secret': secret,
          'x-manager-bot-id': String(worker.workerId)
        },
        body: JSON.stringify({ action: command.action, payload: command.payload }),
        redirect: 'manual',
        signal: AbortSignal.timeout(DEFAULT_RENDER_COMMAND_TIMEOUT_MS)
      });
      if (response && response.status >= 300 && response.status < 400) {
        const redirErr = new Error(`Worker command endpoint returned unexpected redirect (HTTP ${response.status}).`);
        redirErr.status = 502;
        throw redirErr;
      }
      try {
        body = await readJson(response);
      } catch (parseErr) {
        if (parseErr?.isInvalidJson) {
          if (response.status === 405) {
            const err = new Error(`URL Worker (${parsedUrl.host}) trả về HTTP 405 (Method Not Allowed) — URL này là trang web/panel tĩnh, không phải API BotWorker. Nếu chạy trên Wispbyte, hãy xóa Web URL của bot.`);
            err.code = 'INVALID_WORKER_URL';
            err.status = 422;
            throw err;
          }
          if (response.status === 404) {
            const err = new Error(`URL Worker (${parsedUrl.host}) không tìm thấy endpoint điều khiển BotWorker (HTTP 404).`);
            err.code = 'WORKER_NOT_FOUND';
            err.status = 502;
            throw err;
          }
          if ([502, 503, 504, 521, 522, 524].includes(response.status)) {
            const err = new Error(`Máy chủ Worker (${parsedUrl.host}) đang khởi động lại hoặc tạm ngưng phản hồi (HTTP ${response.status}).`);
            err.code = 'WORKER_UNAVAILABLE';
            err.status = 503;
            throw err;
          }
          if (!response.ok) {
            const err = new Error(`Máy chủ Worker (${parsedUrl.host}) trả về mã lỗi HTTP ${response.status} (phản hồi không phải JSON).`);
            err.code = 'WORKER_UPSTREAM_ERROR';
            err.status = 502;
            throw err;
          }
          const err = new Error(`URL Worker (${parsedUrl.host}) trả về nội dung HTML/văn bản thay vì JSON hợp lệ (HTTP ${response.status}). Hãy kiểm tra lại Web URL bot.`);
          err.code = 'INVALID_WORKER_URL';
          err.status = 502;
          throw err;
        }
        throw parseErr;
      }
    } catch (fetchErr) {
      if (fetchErr.name === 'TimeoutError' || fetchErr.code === 'ETIMEDOUT' || /timed out/i.test(fetchErr.message)) {
        const timeoutErr = new Error('Command execution timed out waiting for worker response.');
        timeoutErr.code = 'result_timeout';
        timeoutErr.timedOut = true;
        throw timeoutErr;
      }
      throw fetchErr;
    }

    if (!response.ok || !body.ok) {
      const err = new Error(body.error || `Worker returned HTTP ${response.status}.`);
      const upstreamStatus = Number(response.status);
      if (body.code || body.error === 'execution_timeout') {
        err.code = body.code || body.error;
      } else if (upstreamStatus === 405) {
        err.code = 'INVALID_WORKER_URL';
      } else if (upstreamStatus === 401 || upstreamStatus === 403) {
        err.code = 'WORKER_AUTH_FAILED';
      }
      err.status = upstreamStatus === 405
        ? 422
        : ([400, 409, 422, 429, 503, 504].includes(upstreamStatus) ? upstreamStatus : 502);
      throw err;
    }

    const workerStatus = body.result?.worker || body.result || {};
    const isSuccess = body.result ? (body.result.ok !== false) : body.ok === true;
    if (command.action === 'reset' && isSuccess) {
      const { partialResetFailures, remainingSteps } = await this.syncResetState(
        worker.workerId,
        workerStatus,
        'manager-command',
        command.commandId,
        { excludeCommandIds: command.commandId ? [command.commandId] : [] }
      );
      if (partialResetFailures.length > 0) {
        if (
          typeof this.commandStore?.enqueue === 'function' &&
          typeof this.commandStore?.recordExecutionCompleted === 'function' &&
          typeof this.commandStore?.markStateSyncPending === 'function'
        ) {
          try {
            await this.commandStore.enqueue({
              commandId: command.commandId,
              workerId: worker.workerId,
              action: command.action,
              payload: command.payload || {},
              expiresAt: new Date(Date.now() + 60000).toISOString()
            });
            const { leaseMs, leaseSeconds } = this.getStateSyncLeaseConfig();
            const rec = await this.commandStore.recordExecutionCompleted(worker.workerId, command.commandId, body.result || body, {
              leaseOwner: this.instanceId,
              leaseSeconds,
              leaseMs,
              candidateStatus: workerStatus,
              statusSource: 'manager-command',
              pendingSteps: remainingSteps.length > 0 ? remainingSteps : [...ALL_RESET_SYNC_STEPS]
            });
            if (rec?.ok) {
              await this.scheduleResetStateSyncRetry(
                worker.workerId,
                command.commandId,
                body.result || body,
                rec.command?.result?._stateSync || {},
                {
                  candidateStatus: workerStatus,
                  statusSource: 'manager-command',
                  remainingSteps: remainingSteps.length > 0 ? remainingSteps : [...ALL_RESET_SYNC_STEPS],
                  partialResetFailures,
                  expectedLeaseOwner: this.instanceId,
                  fencingToken: rec.fencingToken ?? 0
                }
              );
            }
          } catch (persistErr) {
            this.logger?.warn?.('render_reset_state_sync_persist_failed', {
              workerId: worker.workerId,
              commandId: command.commandId,
              error: persistErr?.message || String(persistErr)
            });
          }
        }
        const detail = partialResetFailures.map((f) => `${f.step}: ${f.error}`).join('; ');
        this.logger?.error?.('command_reset_partial_sync_failed', {
          workerId: worker.workerId,
          commandId: command.commandId,
          failures: partialResetFailures
        });
        const syncErr = new Error(`RESET_STATE_SYNC_FAILED: ${detail}`);
        syncErr.code = 'RESET_STATE_SYNC_FAILED';
        syncErr.partialResetFailures = partialResetFailures;
        throw syncErr;
      }
    } else if (['start', 'stop', 'restart', 'status', 'reset'].includes(command.action)) {
      try {
        await this.registry.updateStatus(worker.workerId, workerStatus, 'manager-command');
      } catch (err) {
        this.logger?.warn?.('command_status_sync_failed', {
          workerId: worker.workerId,
          commandId: command.commandId,
          action: command.action,
          error: err?.message || String(err)
        });
      }
    }
    return {
      ok: isSuccess,
      delivered: true,
      timedOut: false,
      commandId: command.commandId,
      action: command.action,
      result: body.result || body
    };
  }

  async dispatchPoll(worker, command) {
    command.expiresAt = new Date(Date.now() + this.config.commandResultTimeoutMs).toISOString();

    const queued = await this.commandStore.enqueue({ ...command, workerId: worker.workerId });
    if (!queued) {
      const err = new Error('Worker command queue is full or the worker is disabled.');
      err.code = 'QUEUE_BUSY';
      err.status = 503;
      throw err;
    }

    const actualCommandId = String(queued.commandId || command.commandId);

    let resolveCompletion;
    const completion = new Promise((resolve) => { resolveCompletion = resolve; });
    const pending = {
      workerId: worker.workerId,
      commandId: actualCommandId,
      action: command.action,
      command,
      done: false,
      timer: null,
      waiters: [],
      settleWaiters: (payload) => {
        const list = pending.waiters.splice(0, pending.waiters.length);
        for (const waiter of list) {
          try { waiter(payload); } catch (_) {}
        }
      },
      finish: (result) => {
        if (pending.done) return;
        pending.done = true;
        if (pending.timer) clearTimeout(pending.timer);
        this.pendingResults.delete(actualCommandId);
        const isSuccess = result ? (result.ok !== false) : true;
        const completionPayload = {
          ok: isSuccess,
          delivered: true,
          timedOut: false,
          commandId: actualCommandId,
          action: command.action,
          result
        };
        pending.settleWaiters(completionPayload);
        resolveCompletion(completionPayload);
      }
    };

    const existing = this.pendingResults.get(actualCommandId);
    if (existing) {
      if (existing.timer) {
        clearTimeout(existing.timer);
        existing.timer = null;
      }
      existing.waiters.push(resolveCompletion);
      existing.timer = setTimeout(() => {
        void this.commandStore.expire(actualCommandId).catch((error) => {
          this.logger.warn('worker_command_expire_failed', { commandId: actualCommandId, message: error.message });
        });
        if (existing.done) return;
        existing.done = true;
        this.pendingResults.delete(actualCommandId);
        const timeoutPayload = {
          ok: false,
          delivered: false,
          timedOut: true,
          commandId: actualCommandId,
          action: existing.action,
          result: null
        };
        existing.settleWaiters(timeoutPayload);
        existing.resolvePrimary?.(timeoutPayload);
      }, this.config.commandResultTimeoutMs);
      existing.timer.unref?.();
    } else {
      pending.resolvePrimary = resolveCompletion;
      this.pendingResults.set(actualCommandId, pending);
      if (!pending.done) {
        pending.timer = setTimeout(() => {
          void this.commandStore.expire(actualCommandId).catch((error) => {
            this.logger.warn('worker_command_expire_failed', { commandId: actualCommandId, message: error.message });
          });
          if (pending.done) return;
          pending.done = true;
          this.pendingResults.delete(actualCommandId);
          const timeoutPayload = {
            ok: false,
            delivered: false,
            timedOut: true,
            commandId: actualCommandId,
            action: command.action,
            result: null
          };
          pending.settleWaiters(timeoutPayload);
          resolveCompletion(timeoutPayload);
        }, this.config.commandResultTimeoutMs);
        pending.timer.unref?.();
      }
    }

    this.wakePoller(worker.workerId);
    return completion;
  }

  hasActivePoller(workerId) {
    const waiters = this.pollWaiters.get(workerId);
    return Array.isArray(waiters) && waiters.length > 0;
  }

  wakePoller(workerId) {
    const waiters = this.pollWaiters.get(workerId);
    if (!waiters || !waiters.length) return;
    this.wakeVersions.set(workerId, (this.wakeVersions.get(workerId) || 0) + 1);
    for (const waiter of waiters.splice(0, waiters.length)) {
      waiter();
    }
  }

  async poll(workerId, { waitMs = this.config.workerPollWaitMs, signal = null } = {}) {
    const next = await this.commandStore.take(workerId);
    if (next || signal?.aborted) return next;

    const currentVersion = this.wakeVersions.get(workerId) || 0;
    await new Promise((resolve) => {
      let resolved = false;
      let timer = null;
      let onAbort = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener?.('abort', onAbort);
        const currentWaiters = this.pollWaiters.get(workerId);
        if (currentWaiters) {
          const index = currentWaiters.indexOf(onWake);
          if (index !== -1) currentWaiters.splice(index, 1);
          if (currentWaiters.length === 0) this.pollWaiters.delete(workerId);
        }
      };

      const onWake = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve();
      };

      if (signal) {
        if (signal.aborted) {
          resolve();
          return;
        }
        onAbort = () => onWake();
        signal.addEventListener?.('abort', onAbort, { once: true });
      }

      timer = setTimeout(() => {
        onWake();
      }, Math.max(100, Math.min(waitMs, 30000)));
      timer.unref?.();

      if ((this.wakeVersions.get(workerId) || 0) !== currentVersion) {
        onWake();
        return;
      }

      if (!this.pollWaiters.has(workerId)) {
        this.pollWaiters.set(workerId, []);
      }
      this.pollWaiters.get(workerId).push(onWake);
    });

    if (signal?.aborted) return null;
    return this.commandStore.take(workerId);
  }

  async status(worker) {
    const workerId = typeof worker === 'object' && worker ? (worker.workerId || worker.id) : worker;
    const res = await this.dispatch(workerId, 'status');
    return res?.result?.worker || res?.result?.detail || res?.result || {};
  }

  validateResultPayload(action, rawResult) {
    if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
      throw new Error(`Invalid command result: expected an object for action '${action}'.`);
    }
    const validated = { ...rawResult };
    validated.ok = Boolean(rawResult.ok ?? (rawResult.result ? rawResult.result.ok : !rawResult.error));
    if (rawResult.error) {
      validated.error = String(rawResult.error).slice(0, 500);
    }
    if (action) {
      validated.action = String(action);
    }

    if (['start', 'stop', 'restart', 'reconnect', 'status', 'reset'].includes(action)) {
      const rawWorker = rawResult.worker || rawResult.result?.worker ||
        (('state' in rawResult || 'online' in rawResult || 'connected' in rawResult) ? rawResult : null);
      if (rawWorker && typeof rawWorker === 'object') {
        const validator = this.registry?.constructor?.validateWorkerStatus || this.registry?.validateWorkerStatus;
        if (typeof validator === 'function') {
          validated.worker = validator(rawWorker, 'command-result');
        }
      }
    } else if (action === 'chat') {
      if (rawResult.message !== undefined) {
        validated.message = String(rawResult.message || '').slice(0, 256);
      }
    } else if (action === 'inventory') {
      if (rawResult.items !== undefined && !Array.isArray(rawResult.items)) {
        throw new Error("Invalid inventory result: 'items' must be an array.");
      }
    } else if (action === 'window_click') {
      if (rawResult.slot !== undefined && rawResult.slot !== null && !Number.isInteger(Number(rawResult.slot))) {
        throw new Error("Invalid window_click result: 'slot' must be an integer.");
      }
    }

    return validated;
  }

  async waitForResult(commandId, { timeoutMs = (this.config?.commandResultTimeoutMs || 30000) } = {}) {
    const cid = String(commandId || '').trim();
    const rawTimeout = Number(timeoutMs);
    const defaultTimeout = Number(this.config?.commandResultTimeoutMs) || 30000;
    const effectiveTimeoutMs = Math.min(2147483647, Math.max(50, Number.isFinite(rawTimeout) ? Math.floor(rawTimeout) : defaultTimeout));

    // 1. Check in-memory waiter
    const pending = this.pendingResults.get(cid);
    if (pending) {
      return new Promise((resolve) => {
        let settled = false;
        const done = (payload) => {
          if (settled) return;
          settled = true;
          clearTimeout(waitTimer);
          const idx = Array.isArray(pending.waiters) ? pending.waiters.indexOf(done) : -1;
          if (idx !== -1) pending.waiters.splice(idx, 1);
          resolve(payload);
        };
        const waitTimer = setTimeout(() => {
          done({
            ok: false,
            delivered: false,
            timedOut: true,
            commandId: cid,
            action: pending.action,
            result: null
          });
        }, effectiveTimeoutMs);
        waitTimer.unref?.();

        if (Array.isArray(pending.waiters)) {
          pending.waiters.push(done);
        } else {
          const origFinish = pending.finish;
          pending.finish = (res) => {
            try { origFinish(res); } catch (_) {}
            done({
              ok: res?.ok !== false,
              delivered: true,
              timedOut: false,
              commandId: cid,
              action: pending.action,
              result: res
            });
          };
        }
      });
    }

    // 2. Durable lookup in DB
    if (typeof this.commandStore?.get === 'function') {
      try {
        const stored = await this.commandStore.get(cid);
        if (stored) {
          if (stored.status === 'completed') {
            return {
              ok: true,
              delivered: true,
              timedOut: false,
              commandId: cid,
              action: stored.action,
              result: stored.result
            };
          }
          if (stored.status === 'failed' || stored.status === 'state_sync_failed') {
            return {
              ok: false,
              delivered: true,
              timedOut: false,
              commandId: cid,
              action: stored.action,
              result: stored.result,
              error: stored.status === 'state_sync_failed' ? 'RESET_STATE_SYNC_FAILED' : 'command_failed'
            };
          }
          if (stored.status === 'expired') {
            return {
              ok: false,
              delivered: false,
              timedOut: true,
              commandId: cid,
              action: stored.action,
              result: null
            };
          }
        }
      } catch (err) {
        this.logger?.warn?.('waitForResult_db_lookup_failed', { commandId: cid, error: err.message });
      }
    }

    // 3. Fallback wait: listen for in-memory result notification (0ms local wake-up)
    //    AND backoff DB polling (1000ms -> 2000ms) for multi-instance environments.
    return new Promise((resolve) => {
      let settled = false;
      let pollTimer = null;
      let deadlineTimer = null;
      let pollStep = 0;
      const startTime = Date.now();
      const shortPollMode = effectiveTimeoutMs <= 1200;

      const finish = (outcome) => {
        if (settled) return;
        settled = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (deadlineTimer) clearTimeout(deadlineTimer);
        const set = this.resultWaiters.get(cid);
        if (set) {
          set.delete(onResultNotify);
          if (set.size === 0) this.resultWaiters.delete(cid);
        }
        resolve(outcome);
      };

      const onResultNotify = (res, action) => {
        finish({
          ok: res?.ok !== false,
          delivered: true,
          timedOut: false,
          commandId: cid,
          action: action || null,
          result: res
        });
      };

      if (!this.resultWaiters.has(cid)) this.resultWaiters.set(cid, new Set());
      this.resultWaiters.get(cid).add(onResultNotify);

      deadlineTimer = setTimeout(() => {
        finish({ ok: false, delivered: false, timedOut: true, commandId: cid, result: null });
      }, effectiveTimeoutMs);
      deadlineTimer.unref?.();

      const schedulePoll = () => {
        if (settled) return;
        const remaining = effectiveTimeoutMs - (Date.now() - startTime);
        if (remaining <= 0) return;
        const nextDelay = shortPollMode
          ? Math.min(remaining, Math.max(50, Math.min(200, Math.floor(effectiveTimeoutMs / 4))))
          : Math.min(remaining, pollStep === 0 ? 1000 : 2000);
        pollStep += 1;
        pollTimer = setTimeout(async () => {
          pollTimer = null;
          if (settled) return;
          if (typeof this.commandStore?.get === 'function') {
            try {
              const stored = await this.commandStore.get(cid);
              if (stored && (stored.status === 'completed' || stored.status === 'failed' || stored.status === 'state_sync_failed' || stored.status === 'expired')) {
                const isCompleted = stored.status === 'completed';
                return finish({
                  ok: isCompleted,
                  delivered: stored.status !== 'expired',
                  timedOut: stored.status === 'expired',
                  commandId: cid,
                  action: stored.action,
                  result: stored.result
                });
              }
            } catch (_) {}
          }
          schedulePoll();
        }, nextDelay);
        pollTimer.unref?.();
      };

      schedulePoll();
    });
  }

  async acceptResult(workerId, payload = {}) {
    const wid = String(workerId || '').trim().toLowerCase();
    const commandId = String(payload.commandId || '').trim();
    let result = (payload.result && typeof payload.result === 'object') ? { ...payload.result } : { ...(payload || {}) };
    delete result.commandId;
    const pending = this.pendingResults.get(commandId);
    if (pending && pending.workerId !== wid) {
      return { ok: false, error: 'COMMAND_OWNERSHIP_MISMATCH' };
    }
    let storedCommand = null;
    if (!pending && typeof this.commandStore?.get === 'function') {
      storedCommand = await this.commandStore.get(commandId);
      if (storedCommand && storedCommand.workerId && String(storedCommand.workerId).toLowerCase() !== wid) {
        return { ok: false, error: 'COMMAND_OWNERSHIP_MISMATCH' };
      }
    }
    // Always trust authoritative pending/DB action when present; only fall back to payload when neither exists (WORKER-CHAN-01).
    const action = pending?.action || storedCommand?.action || payload.action || result.action;
    result = this.validateResultPayload(action, result);
    return this.reportResult(workerId, commandId, result, { storedCommand: storedCommand || undefined });
  }

  async cancelWorker(workerId) {
    const id = String(workerId);
    const waiters = this.pollWaiters.get(id);
    if (waiters && waiters.length) {
      for (const waiter of waiters.splice(0, waiters.length)) {
        try { waiter(); } catch {}
      }
    }
    this.pollWaiters.delete(id);
    this.wakeVersions.delete(id);

    for (const [commandId, pending] of this.pendingResults.entries()) {
      if (pending && pending.workerId === id) {
        try {
          pending.finish({ ok: false, error: 'worker_cancelled' });
        } catch {}
      }
    }
    if (typeof this.commandStore.clearWorker === 'function') {
      try {
        await this.commandStore.clearWorker(id);
      } catch (err) {
        this.logger?.warn?.('clear_worker_failed_on_cancel', { workerId: id, error: err?.message });
      }
    }
  }

  async syncResetState(workerId, candidateStatus, statusSource, commandId = null, {
    excludeCommandIds = null,
    steps = null,
    ensureLeaseHeld = null
  } = {}) {
    const partialResetFailures = [];
    const remainingSteps = [];
    const stepSet = Array.isArray(steps)
      ? new Set(steps)
      : new Set(ALL_RESET_SYNC_STEPS);
    const excluded = Array.isArray(excludeCommandIds)
      ? excludeCommandIds
      : (commandId ? [commandId] : []);

    let abortedDueToLeaseLoss = false;
    let leaseLossReason = null;

    const plannedSteps = [
      {
        name: 'registry.resetData',
        shouldRun: () => stepSet.has('registry.resetData') && typeof this.registry?.resetData === 'function',
        logEvent: 'command_reset_registry_sync_failed',
        exec: () => this.registry.resetData(workerId)
      },
      {
        name: 'commandStore.clearWorker',
        shouldRun: () => stepSet.has('commandStore.clearWorker') && typeof this.commandStore?.clearWorker === 'function',
        logEvent: 'command_reset_queue_clear_failed',
        exec: () => this.commandStore.clearWorker(workerId, { excludeCommandIds: excluded })
      },
      {
        name: 'registry.updateStatus',
        shouldRun: () => stepSet.has('registry.updateStatus') && candidateStatus && typeof candidateStatus === 'object' && typeof this.registry?.updateStatus === 'function',
        logEvent: 'command_reset_status_sync_failed',
        exec: () => this.registry.updateStatus(workerId, candidateStatus, statusSource)
      }
    ];

    for (let i = 0; i < plannedSteps.length; i += 1) {
      const step = plannedSteps[i];
      if (!step.shouldRun()) continue;

      if (typeof ensureLeaseHeld === 'function') {
        const gate = await ensureLeaseHeld(`before:${step.name}`);
        if (!gate || !gate.held) {
          abortedDueToLeaseLoss = true;
          leaseLossReason = gate?.reason || 'lease_lost';
          for (let j = i; j < plannedSteps.length; j += 1) {
            if (plannedSteps[j].shouldRun()) remainingSteps.push(plannedSteps[j].name);
          }
          break;
        }
      }

      try {
        await step.exec();
      } catch (err) {
        const message = err?.message || String(err);
        partialResetFailures.push({ step: step.name, error: message });
        remainingSteps.push(step.name);
        this.logger?.error?.(step.logEvent, {
          workerId,
          commandId,
          error: message
        });
      }
    }

    return { partialResetFailures, remainingSteps, abortedDueToLeaseLoss, leaseLossReason };
  }

  async scheduleResetStateSyncRetry(workerId, commandId, result, existingSyncState, {
    candidateStatus = null,
    statusSource = 'manager-command-poll',
    remainingSteps = ALL_RESET_SYNC_STEPS,
    partialResetFailures = [],
    expectedLeaseOwner = null,
    fencingToken = null
  } = {}) {
    const attempts = Number(existingSyncState?.attempts || 0) + 1;
    const maxAttempts = Number(this.config?.maxStateSyncAttempts || DEFAULT_MAX_STATE_SYNC_ATTEMPTS);
    const terminalFailed = attempts >= maxAttempts;
    const backoffMs = Math.min(300000, 5000 * (2 ** Math.min(attempts - 1, 6)));
    const nextRetryAt = terminalFailed ? null : new Date(Date.now() + backoffMs).toISOString();
    const detail = partialResetFailures.map((f) => `${f.step}: ${f.error}`).join('; ');

    const nextSyncState = {
      ...(existingSyncState && typeof existingSyncState === 'object' ? existingSyncState : {}),
      pending: !terminalFailed,
      executionCompleted: true,
      status: terminalFailed ? 'state_sync_failed' : 'state_sync_pending',
      attempts,
      nextRetryAt,
      leaseOwner: null,
      leaseUntil: null,
      fencingToken: fencingToken ?? existingSyncState?.fencingToken ?? 0,
      candidateStatus: candidateStatus ?? existingSyncState?.candidateStatus ?? null,
      statusSource: statusSource || existingSyncState?.statusSource || 'manager-command-poll',
      pendingSteps: Array.isArray(remainingSteps) ? [...remainingSteps] : [...ALL_RESET_SYNC_STEPS],
      partialResetFailures,
      lastError: detail,
      updatedAt: new Date().toISOString()
    };

    let markRejected = false;
    if (typeof this.commandStore?.markStateSyncPending === 'function') {
      try {
        const marked = await this.commandStore.markStateSyncPending(workerId, commandId, {
          result,
          syncState: nextSyncState,
          terminalFailed,
          leaseOwner: expectedLeaseOwner,
          fencingToken
        });
        if (!marked && expectedLeaseOwner) {
          markRejected = true;
        }
      } catch (markErr) {
        this.logger?.error?.('command_reset_mark_sync_pending_failed', {
          workerId,
          commandId,
          error: markErr?.message || String(markErr)
        });
        throw markErr;
      }
    }

    if (markRejected) {
      this.logger?.error?.('command_reset_lease_lost', {
        workerId,
        commandId,
        leaseOwner: expectedLeaseOwner,
        fencingToken,
        phase: 'mark_sync_pending_rejected'
      });
      return { detail, terminalFailed, attempts, nextRetryAt, leaseLost: true };
    }

    this.logger?.error?.(
      terminalFailed ? 'command_reset_state_sync_exhausted' : 'command_reset_partial_sync_failed',
      {
        workerId,
        commandId,
        attempts,
        terminalFailed,
        nextRetryAt,
        failures: partialResetFailures
      }
    );

    return { detail, terminalFailed, attempts, nextRetryAt, leaseLost: false };
  }

  async executeLeasedResetSync({
    workerId,
    commandId,
    candidateStatus,
    statusSource,
    steps = null,
    result,
    existingSyncState = null,
    fencingToken = null,
    hasTwoPhaseStore = false,
    isRecovery = false
  }) {
    const wid = String(workerId || '').trim().toLowerCase();
    const cid = String(commandId || '').trim();
    const hasRenew = typeof this.commandStore?.renewStateSyncLease === 'function';
    const hasVerify = typeof this.commandStore?.verifyStateSyncLease === 'function';
    const { leaseMs, leaseSeconds, renewIntervalMs } = this.getStateSyncLeaseConfig();

    let leaseLost = false;
    let leaseLossReason = null;
    let timerStopped = false;
    let activeRenewal = null;
    let renewTimer = null;

    const triggerRenewal = () => {
      if (timerStopped || leaseLost || activeRenewal) return;
      activeRenewal = (async () => {
        try {
          const res = await this.commandStore.renewStateSyncLease(wid, cid, this.instanceId, leaseSeconds, {
            leaseMs,
            fencingToken
          });
          const ok = typeof res === 'boolean' ? res : Boolean(res && res.ok);
          if (!ok) {
            leaseLost = true;
            leaseLossReason = (res && (res.reason || res.error)) || 'lease_renewal_rejected';
          }
        } catch (err) {
          if (err?.code === 'ATOMIC_STATE_SYNC_RPC_REQUIRED') {
            leaseLost = true;
            leaseLossReason = err.code;
          } else {
            this.logger?.warn?.('command_reset_lease_renew_error', {
              workerId: wid,
              commandId: cid,
              leaseOwner: this.instanceId,
              error: err?.message || String(err)
            });
          }
        } finally {
          activeRenewal = null;
        }
      })();
    };

    const ensureLeaseHeld = async (_phase) => {
      if (leaseLost) return { held: false, reason: leaseLossReason || 'lease_lost' };
      if (activeRenewal) {
        await activeRenewal;
        if (leaseLost) return { held: false, reason: leaseLossReason || 'lease_lost' };
      }
      if (!hasVerify) return { held: true };

      try {
        const check = await this.commandStore.verifyStateSyncLease(wid, cid, this.instanceId, {
          fencingToken
        });
        const held = typeof check === 'boolean' ? check : Boolean(check && (check.held === true || check.ok === true));
        if (!held) {
          leaseLost = true;
          leaseLossReason = (check && (check.reason || check.error)) || 'lease_verification_failed';
          return { held: false, reason: leaseLossReason };
        }
        return { held: true };
      } catch (err) {
        leaseLost = true;
        leaseLossReason = err?.code || err?.message || 'lease_verification_error';
        return { held: false, reason: leaseLossReason };
      }
    };

    if (hasRenew) {
      renewTimer = setInterval(triggerRenewal, renewIntervalMs);
      renewTimer.unref?.();
    }

    try {
      const { partialResetFailures, remainingSteps, abortedDueToLeaseLoss, leaseLossReason: stepLossReason } = await this.syncResetState(
        wid,
        candidateStatus,
        statusSource,
        cid,
        {
          excludeCommandIds: cid ? [cid] : [],
          steps,
          ensureLeaseHeld: hasVerify || hasRenew ? ensureLeaseHeld : null
        }
      );

      if (abortedDueToLeaseLoss) {
        const reason = stepLossReason || leaseLossReason || 'lease_lost';
        this.logger?.error?.('command_reset_lease_lost', {
          workerId: wid,
          commandId: cid,
          leaseOwner: this.instanceId,
          fencingToken,
          phase: 'sync_step',
          reason
        });
        return {
          ok: false,
          error: 'STATE_SYNC_LEASE_LOST',
          leaseLost: true,
          reason,
          completed: false
        };
      }

      const preWriteGate = await ensureLeaseHeld(
        partialResetFailures.length === 0 ? 'before:finalizeCompleted' : 'before:markStateSyncPending'
      );
      if (!preWriteGate.held) {
        this.logger?.error?.('command_reset_lease_lost', {
          workerId: wid,
          commandId: cid,
          leaseOwner: this.instanceId,
          fencingToken,
          phase: 'before_write',
          reason: preWriteGate.reason
        });
        return {
          ok: false,
          error: 'STATE_SYNC_LEASE_LOST',
          leaseLost: true,
          reason: preWriteGate.reason,
          completed: false
        };
      }

      if (partialResetFailures.length === 0) {
        let finalized = false;
        let finalizeError = null;
        try {
          finalized = typeof this.commandStore?.finalizeCompleted === 'function'
            ? await this.commandStore.finalizeCompleted(wid, cid, result, {
              leaseOwner: this.instanceId,
              fencingToken
            })
            : await this.commandStore.complete(wid, cid, result);
        } catch (err) {
          finalizeError = err;
        }

        if (finalizeError || (hasTwoPhaseStore && !finalized)) {
          if (!finalizeError && !finalized && hasVerify) {
            const postCheck = await ensureLeaseHeld('after:finalize_rejected');
            if (!postCheck.held) {
              this.logger?.error?.('command_reset_lease_lost', {
                workerId: wid,
                commandId: cid,
                leaseOwner: this.instanceId,
                fencingToken,
                phase: 'finalize_rejected',
                reason: postCheck.reason
              });
              return {
                ok: false,
                error: 'STATE_SYNC_LEASE_LOST',
                leaseLost: true,
                reason: postCheck.reason,
                completed: false
              };
            }
          }

          const finalizeFailure = [{
            step: 'commandStore.finalizeCompleted',
            error: finalizeError?.message || 'finalize_returned_false'
          }];
          const outcome = await this.scheduleResetStateSyncRetry(wid, cid, result, existingSyncState, {
            candidateStatus,
            statusSource,
            remainingSteps: [],
            partialResetFailures: finalizeFailure,
            expectedLeaseOwner: hasTwoPhaseStore ? this.instanceId : null,
            fencingToken
          });
          if (outcome.leaseLost) {
            return {
              ok: false,
              error: 'STATE_SYNC_LEASE_LOST',
              leaseLost: true,
              reason: 'mark_sync_pending_rejected',
              completed: false
            };
          }
          return {
            ok: false,
            error: 'RESET_STATE_SYNC_FAILED',
            stateSyncPending: !outcome.terminalFailed,
            terminalFailed: outcome.terminalFailed,
            executionCompleted: true,
            detail: outcome.detail,
            partialResetFailures: finalizeFailure,
            completed: false
          };
        }

        if (isRecovery) {
          this.logger?.info?.('command_reset_state_sync_recovered', {
            workerId: wid,
            commandId: cid,
            previousAttempts: Number(existingSyncState?.attempts || 0)
          });
        }
        return { ok: true, completed: Boolean(finalized), leaseLost: false };
      }

      const fallbackSteps = remainingSteps.length > 0
        ? remainingSteps
        : (Array.isArray(steps) && steps.length > 0 ? steps : [...ALL_RESET_SYNC_STEPS]);
      const outcome = await this.scheduleResetStateSyncRetry(wid, cid, result, existingSyncState, {
        candidateStatus,
        statusSource,
        remainingSteps: fallbackSteps,
        partialResetFailures,
        expectedLeaseOwner: hasTwoPhaseStore ? this.instanceId : null,
        fencingToken
      });
      if (outcome.leaseLost) {
        return {
          ok: false,
          error: 'STATE_SYNC_LEASE_LOST',
          leaseLost: true,
          reason: 'mark_sync_pending_rejected',
          completed: false
        };
      }
      return {
        ok: false,
        error: 'RESET_STATE_SYNC_FAILED',
        stateSyncPending: !outcome.terminalFailed,
        terminalFailed: outcome.terminalFailed,
        executionCompleted: true,
        detail: outcome.detail,
        partialResetFailures,
        completed: false
      };
    } finally {
      timerStopped = true;
      if (renewTimer) clearInterval(renewTimer);
      if (activeRenewal) {
        await activeRenewal.catch(() => {});
      }
    }
  }

  async processPendingStateSyncs({ limit = 10 } = {}) {
    const summary = { processed: 0, completed: 0, rescheduled: 0, failed: 0, leaseLost: 0, blocked: false, error: null };
    if (this.stateSyncRunning) return summary;
    if (typeof this.commandStore?.claimPendingStateSyncBatch !== 'function') return summary;

    const { leaseMs, leaseSeconds } = this.getStateSyncLeaseConfig();
    this.stateSyncRunning = true;
    try {
      let batch;
      try {
        batch = await this.commandStore.claimPendingStateSyncBatch(this.instanceId, limit, leaseSeconds, { leaseMs });
        this.stateSyncBlockedReason = null;
        this.missingAtomicRpcLogged = false;
      } catch (claimErr) {
        if (claimErr?.code === 'ATOMIC_STATE_SYNC_RPC_REQUIRED') {
          this.stateSyncBlockedReason = claimErr.code;
          summary.blocked = true;
          summary.error = claimErr.code;
          if (!this.missingAtomicRpcLogged) {
            this.missingAtomicRpcLogged = true;
            this.logger?.error?.('command_reset_atomic_rpc_missing', {
              error: claimErr.message,
              missingRpcs: claimErr.missingRpcs || []
            });
          }
          return summary;
        }
        throw claimErr;
      }

      if (!Array.isArray(batch) || batch.length === 0) return summary;

      for (const cmd of batch) {
        summary.processed += 1;
        const wid = String(cmd.workerId || '').trim().toLowerCase();
        const cid = String(cmd.commandId || '').trim();
        const syncMeta = (cmd.result && typeof cmd.result === 'object' && cmd.result._stateSync)
          ? cmd.result._stateSync
          : {};
        const candidateStatus = syncMeta.candidateStatus ||
          cmd.result?.worker ||
          cmd.result?.result?.worker ||
          cmd.result?.status ||
          null;
        const statusSource = syncMeta.statusSource || 'manager-command-poll';
        const steps = Array.isArray(syncMeta.pendingSteps)
          ? syncMeta.pendingSteps
          : ALL_RESET_SYNC_STEPS;

        try {
          const outcome = await this.executeLeasedResetSync({
            workerId: wid,
            commandId: cid,
            candidateStatus,
            statusSource,
            steps,
            result: cmd.result,
            existingSyncState: syncMeta,
            fencingToken: syncMeta.fencingToken ?? null,
            hasTwoPhaseStore: true,
            isRecovery: true
          });

          if (outcome.completed) summary.completed += 1;
          else if (outcome.leaseLost) summary.leaseLost += 1;
          else if (outcome.terminalFailed) summary.failed += 1;
          else summary.rescheduled += 1;
        } catch (itemErr) {
          summary.rescheduled += 1;
          this.logger?.error?.('command_reset_pending_sync_item_error', {
            workerId: wid,
            commandId: cid,
            error: itemErr?.message || String(itemErr)
          });
        }
      }

      return summary;
    } finally {
      this.stateSyncRunning = false;
    }
  }

  _notifyResultWaiters(commandId, result, action = null) {
    const waiters = this.resultWaiters.get(commandId);
    if (waiters && waiters.size > 0) {
      for (const notify of [...waiters]) {
        try { notify(result, action || null); } catch (_) {}
      }
      this.resultWaiters.delete(commandId);
    }
  }

  async reportResult(workerId, commandId, rawResult, { storedCommand: preloadedCommand = undefined } = {}) {
    this.idleOutboxTicks = 0;
    const wid = String(workerId || '').trim().toLowerCase();
    const cid = String(commandId || '').trim();
    const pending = this.pendingResults.get(cid);
    if (pending && pending.workerId !== wid) {
      return { ok: false, error: 'COMMAND_OWNERSHIP_MISMATCH' };
    }

    // Look up command metadata BEFORE transitioning state so RESET is detected reliably
    let storedCommand = preloadedCommand !== undefined ? preloadedCommand : null;
    if (storedCommand === null && typeof this.commandStore?.get === 'function') {
      storedCommand = await this.commandStore.get(cid);
    }

    if (storedCommand && storedCommand.workerId && String(storedCommand.workerId).toLowerCase() !== wid) {
      return { ok: false, error: 'COMMAND_OWNERSHIP_MISMATCH' };
    }

    const action = storedCommand?.action || pending?.action || rawResult?.action;
    const result = this.validateResultPayload(action, rawResult);

    // If storedCommand is already completed, return idempotent success
    if (storedCommand?.status === 'completed') {
      if (pending && pending.workerId === wid && typeof pending.finish === 'function') {
        pending.finish(result);
      }
      this._notifyResultWaiters(cid, result, action);
      return { ok: true, alreadyCompleted: true };
    }

    const isSuccess = result?.ok === true || result?.result?.ok === true;
    const candidateStatus = result?.worker || result?.result?.worker || result?.status ||
      (result && typeof result === 'object' && ('state' in result || 'online' in result || 'connected' in result)
        ? result
        : null);

    // If storedCommand was expired, route successful RESET through durable two-phase reset sync (WORKER-CHAN-02),
    // and guard non-reset late completion with conditional status === 'expired'.
    if (storedCommand?.status === 'expired' && !(action === 'reset' && isSuccess)) {
      if (this.commandStore.client && typeof this.commandStore.client.from === 'function') {
        try {
          let updateQuery = this.commandStore.client.from('manager_commands').update({
            status: 'completed',
            result: result ?? {},
            completed_at: new Date().toISOString()
          }).eq('command_id', cid).eq('worker_id', wid);
          if (typeof updateQuery?.eq === 'function') {
            updateQuery = updateQuery.eq('status', 'expired');
          }
          await updateQuery;
        } catch (err) {
          this.logger?.error?.('command_late_expired_update_failed', {
            workerId: wid,
            commandId: cid,
            action: action || 'unknown',
            error: err?.message || String(err)
          });
        }
      }
      if (candidateStatus && typeof candidateStatus === 'object' && typeof this.registry?.updateStatus === 'function') {
        try {
          await this.registry.updateStatus(wid, candidateStatus, 'manager-command-poll-late');
        } catch (err) {
          this.logger?.warn?.('command_late_status_sync_failed', {
            workerId: wid,
            commandId: cid,
            action: action || 'unknown',
            error: err?.message || String(err)
          });
        }
      }
      if (pending && pending.workerId === wid && typeof pending.finish === 'function') {
        pending.finish(result);
      }
      this._notifyResultWaiters(cid, result, action);
      return { ok: true, lateResult: true, status: 'completed' };
    }

    // Two-phase durable execution + state sync for RESET commands:
    // Never mark a reset command terminally 'completed' before state sync succeeds.
    if (action === 'reset' && isSuccess) {
      const hasTwoPhaseStore = typeof this.commandStore?.recordExecutionCompleted === 'function';
      const { leaseMs, leaseSeconds } = this.getStateSyncLeaseConfig();
      let execRec = null;

      if (hasTwoPhaseStore) {
        try {
          execRec = await this.commandStore.recordExecutionCompleted(wid, cid, result, {
            leaseOwner: this.instanceId,
            leaseSeconds,
            leaseMs,
            candidateStatus,
            statusSource: 'manager-command-poll',
            pendingSteps: [...ALL_RESET_SYNC_STEPS]
          });
        } catch (recErr) {
          if (recErr?.code === 'ATOMIC_STATE_SYNC_RPC_REQUIRED') {
            this.stateSyncBlockedReason = recErr.code;
            if (!this.missingAtomicRpcLogged) {
              this.missingAtomicRpcLogged = true;
              this.logger?.error?.('command_reset_atomic_rpc_missing', {
                error: recErr.message,
                missingRpcs: recErr.missingRpcs || []
              });
            }
            const failedResult = {
              ...(result && typeof result === 'object' ? result : {}),
              ok: false,
              error: 'RESET_STATE_SYNC_FAILED',
              atomicRpcRequired: true,
              detail: recErr.message
            };
            if (pending && pending.workerId === wid && typeof pending.finish === 'function') {
              pending.finish(failedResult);
            }
            this._notifyResultWaiters(cid, failedResult, action);
            return {
              ok: false,
              error: 'RESET_STATE_SYNC_FAILED',
              atomicRpcRequired: true,
              detail: recErr.message
            };
          }
          throw recErr;
        }

        if (execRec?.error === 'STATE_SYNC_IN_PROGRESS') {
          return {
            ok: false,
            error: 'STATE_SYNC_IN_PROGRESS',
            stateSyncPending: true,
            executionCompleted: true
          };
        }
        if (execRec?.alreadyCompleted) {
          if (pending && pending.workerId === wid && typeof pending.finish === 'function') {
            pending.finish(result);
          }
          this._notifyResultWaiters(cid, result, action);
          return { ok: true, alreadyCompleted: true };
        }
        if (execRec?.reason === 'state_sync_failed') {
          const failedResult = {
            ...(result && typeof result === 'object' ? result : {}),
            ok: false,
            error: 'RESET_STATE_SYNC_FAILED',
            stateSyncFailed: true
          };
          if (pending && pending.workerId === wid && typeof pending.finish === 'function') {
            pending.finish(failedResult);
          }
          this._notifyResultWaiters(cid, failedResult, action);
          return { ok: false, error: 'RESET_STATE_SYNC_FAILED', stateSyncFailed: true };
        }
        if (!execRec?.ok) {
          const rejectPayload = {
            ...(result && typeof result === 'object' ? result : {}),
            ok: false,
            error: execRec?.error || execRec?.reason || 'record_execution_failed'
          };
          if (pending && pending.workerId === wid && typeof pending.finish === 'function') {
            pending.finish(rejectPayload);
          }
          this._notifyResultWaiters(cid, rejectPayload, action);
          return { ok: false, ...(execRec?.reason ? { reason: execRec.reason } : {}) };
        }
      }

      const outcome = await this.executeLeasedResetSync({
        workerId: wid,
        commandId: cid,
        candidateStatus,
        statusSource: 'manager-command-poll',
        result,
        existingSyncState: execRec?.command?.result?._stateSync,
        fencingToken: execRec?.fencingToken ?? execRec?.command?.result?._stateSync?.fencingToken ?? null,
        hasTwoPhaseStore,
        isRecovery: false
      });

      if (outcome.ok) {
        if (pending && pending.workerId === wid && typeof pending.finish === 'function') {
          pending.finish(result);
        }
        this._notifyResultWaiters(cid, result, action);
        return { ok: Boolean(outcome.completed) };
      }

      const failedResult = {
        ...(result && typeof result === 'object' ? result : {}),
        ok: false,
        error: outcome.error || 'RESET_STATE_SYNC_FAILED',
        ...(outcome.leaseLost ? { leaseLost: true, reason: outcome.reason } : {}),
        ...(typeof outcome.stateSyncPending === 'boolean' ? { stateSyncPending: outcome.stateSyncPending } : {}),
        executionCompleted: true,
        ...(outcome.detail ? { detail: outcome.detail } : {}),
        ...(outcome.partialResetFailures ? { partialResetFailures: outcome.partialResetFailures } : {})
      };
      if (pending && pending.workerId === wid && typeof pending.finish === 'function') {
        pending.finish(failedResult);
      }
      this._notifyResultWaiters(cid, failedResult, action);
      return {
        ...failedResult,
        completed: false
      };
    }

    const completed = await this.commandStore.complete(wid, cid, result);

    // Sync live inventory / currentWindow / status from command results immediately into registry cache
    const hasLivePatch = Boolean(
      (candidateStatus && typeof candidateStatus === 'object') ||
      (result && typeof result === 'object' && (result.inventory || Object.prototype.hasOwnProperty.call(result, 'currentWindow')))
    );
    if (hasLivePatch && typeof this.registry?.updateStatus === 'function') {
      const mergedStatus = {
        ...(candidateStatus && typeof candidateStatus === 'object' ? candidateStatus : {}),
        ...(result?.inventory && typeof result.inventory === 'object' ? { inventory: result.inventory } : {}),
        ...(result && Object.prototype.hasOwnProperty.call(result, 'currentWindow') ? { currentWindow: result.currentWindow } : {})
      };
      try {
        await this.registry.updateStatus(wid, mergedStatus, 'manager-command-poll');
      } catch (err) {
        this.logger?.warn?.('command_status_sync_failed', {
          workerId: wid,
          commandId: cid,
          action: action || 'unknown',
          error: err?.message || String(err)
        });
      }
    }

    if (pending && pending.workerId === wid && typeof pending.finish === 'function') {
      pending.finish(result);
    }
    this._notifyResultWaiters(cid, result, action);
    return { ok: Boolean(completed) };
  }
}

module.exports = CommandBroker;
