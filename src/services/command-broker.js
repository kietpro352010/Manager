'use strict';

const { randomUUID } = require('node:crypto');
const { readJson } = require('../utils/http');
const { ACTIONS } = require('./worker-registry');

const ALL_RESET_SYNC_STEPS = Object.freeze(['registry.resetData', 'commandStore.clearWorker', 'registry.updateStatus']);
const DEFAULT_MAX_STATE_SYNC_ATTEMPTS = 8;

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
    this.outboxTimer = null;
    this.outboxRunning = false;
    this.stateSyncRunning = false;
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
    await this.processPendingStateSyncs().catch((err) => {
      this.logger?.warn?.('pending_state_sync_batch_error', { message: err.message });
    });

    if (this.outboxRunning) return;
    this.outboxRunning = true;
    try {
      const store = this.commandStore?.adapter || this.registry?.store?.adapter;
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
    const resolvedAction = action === 'reconnect' ? 'restart' : action;
    const command = {
      commandId: randomUUID(),
      action: resolvedAction,
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
    const isSuccess = body.result ? body.result.ok === true : body.ok === true;
    if (command.action === 'reset' && isSuccess) {
      const { partialResetFailures } = await this.syncResetState(
        worker.workerId,
        workerStatus,
        'manager-command',
        command.commandId,
        { excludeCommandIds: command.commandId ? [command.commandId] : [] }
      );
      if (partialResetFailures.length > 0) {
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
    return { delivered: true, result: body.result || body };
  }

  async dispatchPoll(worker, command) {
    command.expiresAt = new Date(Date.now() + this.config.commandResultTimeoutMs).toISOString();

    const queued = await this.commandStore.enqueue({ ...command, workerId: worker.workerId });
    if (!queued) throw new Error('Worker command queue is full or the worker is disabled.');

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
      finish: (result) => {
        if (pending.done) return;
        pending.done = true;
        if (pending.timer) clearTimeout(pending.timer);
        this.pendingResults.delete(actualCommandId);
        resolveCompletion({ delivered: true, result });
      }
    };

    const existing = this.pendingResults.get(actualCommandId);
    if (existing) {
      const origFinish = existing.finish;
      existing.finish = (res) => {
        try { origFinish(res); } catch (_) {}
        try { pending.finish(res); } catch (_) {}
      };
    } else {
      this.pendingResults.set(actualCommandId, pending);
    }

    if (!pending.done) {
      pending.timer = setTimeout(() => {
        void this.commandStore.expire(actualCommandId).catch((error) => {
          this.logger.warn('worker_command_expire_failed', { commandId: actualCommandId, message: error.message });
        });
        if (pending.done) return;
        pending.done = true;
        this.pendingResults.delete(actualCommandId);
        resolveCompletion({ delivered: false, timedOut: true, commandId: actualCommandId });
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
    const result = (payload.result && typeof payload.result === 'object') ? { ...payload.result } : {};
    if (payload.action && !result.action) {
      result.action = payload.action;
    }
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

  async syncResetState(workerId, candidateStatus, statusSource, commandId = null, {
    excludeCommandIds = null,
    steps = null
  } = {}) {
    const partialResetFailures = [];
    const remainingSteps = [];
    const stepSet = (Array.isArray(steps) && steps.length > 0)
      ? new Set(steps)
      : new Set(ALL_RESET_SYNC_STEPS);
    const excluded = Array.isArray(excludeCommandIds)
      ? excludeCommandIds
      : (commandId ? [commandId] : []);

    if (stepSet.has('registry.resetData') && typeof this.registry?.resetData === 'function') {
      try {
        await this.registry.resetData(workerId);
      } catch (err) {
        const message = err?.message || String(err);
        partialResetFailures.push({ step: 'registry.resetData', error: message });
        remainingSteps.push('registry.resetData');
        this.logger?.error?.('command_reset_registry_sync_failed', {
          workerId,
          commandId,
          error: message
        });
      }
    }

    if (stepSet.has('commandStore.clearWorker') && typeof this.commandStore?.clearWorker === 'function') {
      try {
        await this.commandStore.clearWorker(workerId, { excludeCommandIds: excluded });
      } catch (err) {
        const message = err?.message || String(err);
        partialResetFailures.push({ step: 'commandStore.clearWorker', error: message });
        remainingSteps.push('commandStore.clearWorker');
        this.logger?.error?.('command_reset_queue_clear_failed', {
          workerId,
          commandId,
          error: message
        });
      }
    }

    if (stepSet.has('registry.updateStatus') && candidateStatus && typeof candidateStatus === 'object' && typeof this.registry?.updateStatus === 'function') {
      try {
        await this.registry.updateStatus(workerId, candidateStatus, statusSource);
      } catch (err) {
        const message = err?.message || String(err);
        partialResetFailures.push({ step: 'registry.updateStatus', error: message });
        remainingSteps.push('registry.updateStatus');
        this.logger?.error?.('command_reset_status_sync_failed', {
          workerId,
          commandId,
          error: message
        });
      }
    }

    return { partialResetFailures, remainingSteps };
  }

  async scheduleResetStateSyncRetry(workerId, commandId, result, existingSyncState, {
    candidateStatus = null,
    statusSource = 'manager-command-poll',
    remainingSteps = ALL_RESET_SYNC_STEPS,
    partialResetFailures = []
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
      candidateStatus: candidateStatus ?? existingSyncState?.candidateStatus ?? null,
      statusSource: statusSource || existingSyncState?.statusSource || 'manager-command-poll',
      pendingSteps: remainingSteps.length > 0 ? remainingSteps : [...ALL_RESET_SYNC_STEPS],
      partialResetFailures,
      lastError: detail,
      updatedAt: new Date().toISOString()
    };

    if (typeof this.commandStore?.markStateSyncPending === 'function') {
      try {
        await this.commandStore.markStateSyncPending(workerId, commandId, {
          result,
          syncState: nextSyncState,
          terminalFailed
        });
      } catch (markErr) {
        this.logger?.error?.('command_reset_mark_sync_pending_failed', {
          workerId,
          commandId,
          error: markErr?.message || String(markErr)
        });
      }
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

    return { detail, terminalFailed, attempts, nextRetryAt };
  }

  async processPendingStateSyncs({ limit = 10 } = {}) {
    const summary = { processed: 0, completed: 0, rescheduled: 0, failed: 0 };
    if (this.stateSyncRunning) return summary;
    if (typeof this.commandStore?.claimPendingStateSyncBatch !== 'function') return summary;

    this.stateSyncRunning = true;
    try {
      const batch = await this.commandStore.claimPendingStateSyncBatch(this.instanceId, limit, 60);
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
        const steps = Array.isArray(syncMeta.pendingSteps) && syncMeta.pendingSteps.length > 0
          ? syncMeta.pendingSteps
          : ALL_RESET_SYNC_STEPS;

        const { partialResetFailures, remainingSteps } = await this.syncResetState(
          wid,
          candidateStatus,
          statusSource,
          cid,
          { excludeCommandIds: [cid], steps }
        );

        if (partialResetFailures.length === 0) {
          let finalized = false;
          try {
            if (typeof this.commandStore?.finalizeCompleted === 'function') {
              finalized = await this.commandStore.finalizeCompleted(wid, cid, cmd.result, { leaseOwner: this.instanceId });
            } else {
              finalized = await this.commandStore.complete(wid, cid, cmd.result);
            }
          } catch (finErr) {
            partialResetFailures.push({ step: 'commandStore.finalizeCompleted', error: finErr?.message || String(finErr) });
          }

          if (finalized) {
            summary.completed += 1;
            this.logger?.info?.('command_reset_state_sync_recovered', {
              workerId: wid,
              commandId: cid,
              previousAttempts: Number(syncMeta.attempts || 0)
            });
            continue;
          }
          if (partialResetFailures.length === 0) {
            partialResetFailures.push({ step: 'commandStore.finalizeCompleted', error: 'finalize_returned_false' });
          }
        }

        const outcome = await this.scheduleResetStateSyncRetry(wid, cid, cmd.result, syncMeta, {
          candidateStatus,
          statusSource,
          remainingSteps: remainingSteps.length > 0 ? remainingSteps : steps,
          partialResetFailures
        });
        if (outcome.terminalFailed) summary.failed += 1;
        else summary.rescheduled += 1;
      }

      return summary;
    } finally {
      this.stateSyncRunning = false;
    }
  }

  async reportResult(workerId, commandId, result) {
    const wid = String(workerId || '').trim().toLowerCase();
    const cid = String(commandId || '').trim();
    const pending = this.pendingResults.get(cid);
    if (pending && pending.workerId !== wid) {
      return { ok: false, error: 'COMMAND_OWNERSHIP_MISMATCH' };
    }

    // Look up command metadata BEFORE transitioning state so RESET is detected reliably
    let storedCommand = null;
    if ((!pending || !pending.action) && !result?.action && typeof this.commandStore?.get === 'function') {
      try {
        storedCommand = await this.commandStore.get(cid);
      } catch (err) {
        this.logger?.warn?.('command_result_lookup_failed', {
          workerId: wid,
          commandId: cid,
          error: err?.message || String(err)
        });
      }
    }

    const action = pending?.action || result?.action || storedCommand?.action;
    const isSuccess = result?.ok === true || result?.result?.ok === true;
    const candidateStatus = result?.worker || result?.result?.worker || result?.status ||
      (result && typeof result === 'object' && ('state' in result || 'online' in result || 'connected' in result)
        ? result
        : null);

    // Two-phase durable execution + state sync for RESET commands:
    // Never mark a reset command terminally 'completed' before state sync succeeds.
    if (action === 'reset' && isSuccess) {
      const hasTwoPhaseStore = typeof this.commandStore?.recordExecutionCompleted === 'function';
      let execRec = null;

      if (hasTwoPhaseStore) {
        execRec = await this.commandStore.recordExecutionCompleted(wid, cid, result, {
          leaseOwner: this.instanceId,
          leaseSeconds: 15,
          candidateStatus,
          statusSource: 'manager-command-poll',
          pendingSteps: [...ALL_RESET_SYNC_STEPS]
        });

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
          return { ok: false, error: 'RESET_STATE_SYNC_FAILED', stateSyncFailed: true };
        }
        if (!execRec?.ok && !pending) {
          return { ok: false };
        }
      }

      const { partialResetFailures, remainingSteps } = await this.syncResetState(
        wid,
        candidateStatus,
        'manager-command-poll',
        cid,
        { excludeCommandIds: cid ? [cid] : [] }
      );

      if (partialResetFailures.length === 0) {
        let finalized = false;
        let finalizeError = null;
        try {
          finalized = typeof this.commandStore?.finalizeCompleted === 'function'
            ? await this.commandStore.finalizeCompleted(wid, cid, result, { leaseOwner: this.instanceId })
            : await this.commandStore.complete(wid, cid, result);
        } catch (err) {
          finalizeError = err;
        }

        if (finalizeError || (hasTwoPhaseStore && !finalized)) {
          const finalizeFailure = [{
            step: 'commandStore.finalizeCompleted',
            error: finalizeError?.message || 'finalize_returned_false'
          }];
          const { detail, terminalFailed } = await this.scheduleResetStateSyncRetry(
            wid,
            cid,
            result,
            execRec?.command?.result?._stateSync,
            {
              candidateStatus,
              statusSource: 'manager-command-poll',
              remainingSteps: [],
              partialResetFailures: finalizeFailure
            }
          );
          const failedResult = {
            ...(result && typeof result === 'object' ? result : {}),
            ok: false,
            error: 'RESET_STATE_SYNC_FAILED',
            stateSyncPending: !terminalFailed,
            executionCompleted: true,
            detail,
            partialResetFailures: finalizeFailure
          };
          if (pending && pending.workerId === wid && typeof pending.finish === 'function') {
            pending.finish(failedResult);
          }
          return {
            ok: false,
            error: 'RESET_STATE_SYNC_FAILED',
            stateSyncPending: !terminalFailed,
            executionCompleted: true,
            detail,
            partialResetFailures: finalizeFailure,
            completed: false
          };
        }

        if (pending && pending.workerId === wid && typeof pending.finish === 'function') {
          pending.finish(result);
        }
        return { ok: Boolean(finalized || pending) };
      }

      const { detail, terminalFailed } = await this.scheduleResetStateSyncRetry(
        wid,
        cid,
        result,
        execRec?.command?.result?._stateSync,
        {
          candidateStatus,
          statusSource: 'manager-command-poll',
          remainingSteps,
          partialResetFailures
        }
      );
      const failedResult = {
        ...(result && typeof result === 'object' ? result : {}),
        ok: false,
        error: 'RESET_STATE_SYNC_FAILED',
        stateSyncPending: !terminalFailed,
        executionCompleted: true,
        detail,
        partialResetFailures
      };
      if (pending && pending.workerId === wid && typeof pending.finish === 'function') {
        pending.finish(failedResult);
      }
      return {
        ok: false,
        error: 'RESET_STATE_SYNC_FAILED',
        stateSyncPending: !terminalFailed,
        executionCompleted: true,
        detail,
        partialResetFailures,
        completed: false
      };
    }

    const completed = await this.commandStore.complete(wid, cid, result);
    if (candidateStatus && typeof candidateStatus === 'object' && typeof this.registry?.updateStatus === 'function') {
      try {
        await this.registry.updateStatus(wid, candidateStatus, 'manager-command-poll');
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
    return { ok: Boolean(completed || pending) };
  }
}

module.exports = CommandBroker;
