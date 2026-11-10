'use strict';

const { randomUUID } = require('node:crypto');
const { readJson } = require('../utils/http');
const { ACTIONS } = require('./worker-registry');

class CommandBroker {
  constructor({ registry, commandStore, config, logger, fetchImpl = global.fetch }) {
    this.registry = registry;
    this.commandStore = commandStore;
    this.config = config;
    this.logger = logger;
    this.fetch = fetchImpl;
    this.pollWaiters = new Map();
    this.wakeVersions = new Map();
    this.pendingResults = new Map();
    this.outboxTimer = null;
    this.outboxRunning = false;
  }

  startOutboxProcessor({ intervalMs = 5000 } = {}) {
    if (this.outboxTimer) return;
    this.outboxTimer = setInterval(() => {
      void this.processOutboxBatch();
    }, intervalMs);
    this.outboxTimer.unref?.();
  }

  stopOutboxProcessor() {
    if (this.outboxTimer) {
      clearInterval(this.outboxTimer);
      this.outboxTimer = null;
    }
  }

  async processOutboxBatch() {
    if (this.outboxRunning) return;
    this.outboxRunning = true;
    try {
      const store = this.commandStore.adapter || this.registry.store.adapter;
      if (!store || typeof store.claimOutboxBatch !== 'function') return;

      const batch = await store.claimOutboxBatch(`mgr_${process.pid}`, 10, 60);
      if (!Array.isArray(batch) || batch.length === 0) return;

      for (const item of batch) {
        const payload = item.payload || {};
        const workerId = String(payload.workerId || item.worker_id || '');
        const action = item.task_type || item.type || 'status';

        try {
          const worker = await this.registry.find(workerId);
          if (!worker || !worker.enabled) {
            await store.failOutboxItem(item.id, `mgr_${process.pid}`, 'WORKER_DISABLED_OR_NOT_FOUND');
            continue;
          }

          if (worker.provider === 'render' && worker.serviceUrl) {
            await this.dispatchRender(worker, { commandId: item.id, action, payload });
            await store.completeOutboxItem(item.id, `mgr_${process.pid}`);
          } else {
            // WispByte pull mode
            if (this.hasActivePoller(workerId)) {
              this.wakePoller(workerId);
            }
          }
        } catch (err) {
          const attempts = Number(item.attempts || 1);
          if (attempts >= 8) {
            await store.failOutboxItem(item.id, `mgr_${process.pid}`, err.message || 'MAX_RETRIES_EXCEEDED');
          } else {
            const nextRetryDelaySec = Math.min(3600, Math.pow(2, attempts) * 10);
            const nextRetryAtIso = new Date(Date.now() + nextRetryDelaySec * 1000).toISOString();
            await store.rescheduleOutboxItem(item.id, `mgr_${process.pid}`, nextRetryAtIso, err.message);
          }
        }
      }
    } catch (err) {
      this.logger?.warn('outbox_processing_error', { message: err.message });
    } finally {
      this.outboxRunning = false;
    }
  }

  normalizePayload(action, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Command payload must be an object.');
    }
    if (action === 'chat') {
      const message = String(payload.message || '').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();
      if (!message || message.length > 256) throw new Error('Chat message must contain 1–256 characters.');
      return { message };
    }
    if (action === 'set-afk-mode') {
      return { mode: 'still' };
    }
    if (action === 'set-proxy') {
      return { url: String(payload.url || '').trim() };
    }
    return payload;
  }

  async dispatch(workerId, action, payload = {}) {
    if (!ACTIONS.has(action)) throw new Error(`Unsupported worker action: ${action}`);
    const safePayload = this.normalizePayload(action, payload);
    const worker = await this.registry.find(workerId);
    if (!worker || !worker.enabled) throw new Error(`Worker ${workerId} is not registered or is disabled.`);

    this.logger.info('worker_command_dispatch', { workerId, provider: worker.provider, action });
    const command = {
      commandId: randomUUID(),
      action,
      payload: safePayload,
      createdAt: new Date().toISOString()
    };

    if (worker.provider === 'render') {
      return this.dispatchRender(worker, command);
    }

    if (!worker.lastHeartbeat || Date.now() - new Date(worker.lastHeartbeat).getTime() > 120000) {
      throw new Error(`Wispbyte worker ${workerId} has not checked in recently.`);
    }
    return this.dispatchPoll(worker, command);
  }

  async dispatchRender(worker, command) {
    const baseUrl = worker.serviceUrl;
    const secret = await this.registry.credential(worker.workerId);
    const response = await this.fetch(`${baseUrl}/api/v1/bots/${encodeURIComponent(worker.workerId)}/command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': secret,
        'x-manager-bot-id': String(worker.workerId)
      },
      body: JSON.stringify({ action: command.action, payload: command.payload }),
      signal: AbortSignal.timeout(30000)
    });

    const body = await readJson(response);
    if (!response.ok || !body.ok) throw new Error(body.error || `Worker returned HTTP ${response.status}.`);

    const workerStatus = body.result?.worker || body.result || {};
    if (command.action === 'reset' && body.result?.ok === true) {
      await this.registry.resetData(worker.workerId);
    }
    if (['start', 'stop', 'restart', 'status', 'reset'].includes(command.action)) {
      await this.registry.updateStatus(worker.workerId, workerStatus, 'manager-command');
    }
    return { delivered: true, result: body.result || body };
  }

  async dispatchPoll(worker, command) {
    command.expiresAt = new Date(Date.now() + this.config.commandResultTimeoutMs).toISOString();
    let resolveCompletion;
    const completion = new Promise((resolve) => { resolveCompletion = resolve; });
    const pending = {
      workerId: worker.workerId,
      done: false,
      timer: null,
      finish: (result) => {
        if (pending.done) return;
        pending.done = true;
        if (pending.timer) clearTimeout(pending.timer);
        this.pendingResults.delete(command.commandId);
        resolveCompletion({ delivered: true, result });
      }
    };
    this.pendingResults.set(command.commandId, pending);

    try {
      const queued = await this.commandStore.enqueue({ ...command, workerId: worker.workerId });
      if (!queued) throw new Error('Worker command queue is full or the worker is disabled.');
    } catch (error) {
      pending.done = true;
      this.pendingResults.delete(command.commandId);
      throw error;
    }

    if (!pending.done) {
      pending.timer = setTimeout(() => {
        void this.commandStore.expire(command.commandId).catch((error) => {
          this.logger.warn('worker_command_expire_failed', { commandId: command.commandId, message: error.message });
        });
        if (pending.done) return;
        pending.done = true;
        this.pendingResults.delete(command.commandId);
        resolveCompletion({ delivered: false, timedOut: true, commandId: command.commandId });
      }, this.config.commandResultTimeoutMs);
      pending.timer.unref?.();
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

  async poll(workerId, { waitMs = this.config.workerPollWaitMs } = {}) {
    const next = await this.commandStore.take(workerId);
    if (next) return next;

    const currentVersion = this.wakeVersions.get(workerId) || 0;
    await new Promise((resolve) => {
      let resolved = false;
      const onWake = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve();
      };

      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        const currentWaiters = this.pollWaiters.get(workerId) || [];
        const index = currentWaiters.indexOf(onWake);
        if (index !== -1) currentWaiters.splice(index, 1);
        resolve();
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

    return this.commandStore.take(workerId);
  }

  async status(worker) {
    const workerId = typeof worker === 'object' && worker ? (worker.workerId || worker.id) : worker;
    const res = await this.dispatch(workerId, 'status');
    return res?.result?.worker || res?.result?.detail || res?.result || {};
  }

  async acceptResult(workerId, payload = {}) {
    const commandId = String(payload.commandId || '');
    const result = payload.result || {};
    return this.reportResult(workerId, commandId, result);
  }

  cancelWorker(workerId) {
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
      void this.commandStore.clearWorker(id).catch(() => {});
    }
  }

  async reportResult(workerId, commandId, result) {
    await this.commandStore.complete(workerId, commandId, result);
    const pending = this.pendingResults.get(commandId);
    if (pending && pending.workerId === workerId) {
      pending.finish(result);
    }
    return { ok: true };
  }
}

module.exports = CommandBroker;
