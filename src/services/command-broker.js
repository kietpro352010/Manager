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
  }

  normalizePayload(action, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Command payload must be an object.');
    if (action === 'chat') {
      const message = String(payload.message || '').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();
      if (!message || message.length > 256) throw new Error('Chat message must contain 1–256 characters.');
      return { message };
    }
    if (action === 'set-afk-mode') {
      return { mode: 'still' };
    }
    if (action === 'set-proxy') return { url: String(payload.url || '').trim() };
    return {};
  }

  async dispatch(workerId, action, payload = {}) {
    if (!ACTIONS.has(action)) throw new Error('Unsupported worker action.');
    const safePayload = this.normalizePayload(action, payload);
    const worker = await this.registry.find(workerId);
    if (!worker || !worker.enabled) throw new Error(`Worker ${workerId} is not registered or is disabled.`);
    this.logger.info('worker_command_dispatch', { workerId, provider: worker.provider, action });
    const command = { commandId: randomUUID(), action, payload: safePayload, createdAt: new Date().toISOString() };
    if (worker.provider === 'render') return this.dispatchRender(worker, command);
    if (!worker.lastHeartbeat || Date.now() - new Date(worker.lastHeartbeat).getTime() > 120000) {
      throw new Error(`Wispbyte worker ${workerId} has not checked in recently.`);
    }
    return this.dispatchPoll(worker, command);
  }

  async dispatchRender(worker, command) {
    const baseUrl = worker.serviceUrl;
    const secret = await this.registry.credential(worker.workerId);
    const response = await this.fetch(`${baseUrl}/api/v1/bots/${encodeURIComponent(worker.workerId)}/command`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-worker-secret': secret },
      body: JSON.stringify({ action: command.action, payload: command.payload }), signal: AbortSignal.timeout(30000)
    });
    const body = await readJson(response);
    if (!response.ok || !body.ok) throw new Error(body.error || `Worker returned HTTP ${response.status}.`);
    const workerStatus = body.result?.worker || body.result || {};
    if (command.action === 'reset' && body.result?.ok === true) await this.registry.resetData(worker.workerId);
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
      workerId: worker.workerId, done: false, timer: null,
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

  wakePoller(workerId) {
    this.wakeVersions.set(workerId, (this.wakeVersions.get(workerId) || 0) + 1);
    const waiters = this.pollWaiters.get(workerId);
    if (waiters?.length) waiters.shift()();
  }

  async poll(workerId, waitMs) {
    const startingVersion = this.wakeVersions.get(workerId) || 0;
    const commandNow = await this.commandStore.take(workerId);
    if (commandNow) return this.commandForWorker(commandNow);
    if (waitMs <= 0) return null;
    if ((this.wakeVersions.get(workerId) || 0) !== startingVersion) {
      return this.commandForWorker(await this.commandStore.take(workerId));
    }
    await new Promise((resolve) => {
      const waiters = this.pollWaiters.get(workerId) || [];
      const finish = () => {
        clearTimeout(timer);
        const current = this.pollWaiters.get(workerId) || [];
        this.pollWaiters.set(workerId, current.filter((fn) => fn !== finish));
        resolve();
      };
      const timer = setTimeout(finish, waitMs);
      waiters.push(finish);
      this.pollWaiters.set(workerId, waiters);
    });
    return this.commandForWorker(await this.commandStore.take(workerId));
  }

  commandForWorker(command) {
    if (!command) return null;
    return {
      commandId: command.commandId, action: command.action, payload: command.payload,
      createdAt: command.createdAt, expiresAt: command.expiresAt
    };
  }

  async acceptResult(workerId, payload) {
    const pending = this.pendingResults.get(payload.commandId);
    if (pending && pending.workerId !== workerId) return false;
    const accepted = await this.commandStore.complete(workerId, payload.commandId, payload.result || null);
    if (!accepted) return false;
    const result = payload.result || {};
    const workerStatus = result.worker || result;
    if (payload.action && ['start', 'stop', 'restart', 'status', 'reset'].includes(payload.action)
      && workerStatus && typeof workerStatus === 'object') {
      await this.registry.updateStatus(workerId, workerStatus, 'manager-command');
    }
    pending?.finish({ action: payload.action, ok: Boolean(result.ok ?? true), detail: result });
    return true;
  }

  async status(worker) {
    if (worker.provider !== 'render') return { ...worker.status, lastHeartbeat: worker.lastHeartbeat || null };
    const secret = await this.registry.credential(worker.workerId);
    const response = await this.fetch(`${worker.serviceUrl}/api/v1/bots/${encodeURIComponent(worker.workerId)}/status`, {
      headers: { 'x-worker-secret': secret }, signal: AbortSignal.timeout(15000)
    });
    const body = await readJson(response);
    if (!response.ok || !body.ok) throw new Error(body.error || `Worker returned HTTP ${response.status}.`);
    await this.registry.updateStatus(worker.workerId, body.worker || {}, 'manager-query');
    return body.worker;
  }

  cancelWorker(workerId) {
    for (const [commandId, pending] of this.pendingResults) {
      if (pending.workerId === workerId) pending.finish({ ok: false, error: 'worker_removed' });
    }
  }
}

module.exports = CommandBroker;
