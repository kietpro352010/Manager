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
    steps = null,
    ensureLeaseHeld = null
  } = {}) {
    const partialResetFailures = [];
    const remainingSteps = [];
    const stepSet = (Array.isArray(steps) && steps.length > 0)
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
      pendingSteps: remainingSteps.length > 0 ? remainingSteps : [...ALL_RESET_SYNC_STEPS],
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
        const steps = Array.isArray(syncMeta.pendingSteps) && syncMeta.pendingSteps.length > 0
          ? syncMeta.pendingSteps
          : ALL_RESET_SYNC_STEPS;

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
        return { ok: Boolean(outcome.completed || pending) };
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
      return {
        ...failedResult,
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
