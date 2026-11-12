'use strict';

const crypto = require('node:crypto');
const { normalizeMaxUses } = require('../storage/supabase-client');

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashCode(value) {
  return crypto.createHash('sha256').update(normalizeCode(value)).digest('hex');
}

function formatCode() {
  const raw = crypto.randomBytes(12).toString('hex').toUpperCase();
  return `KM-${raw.match(/.{1,4}/g).join('-')}`;
}

const STOP_CONFIRMED_STATES = new Set(['stopped', 'offline']);

function hasUnconfirmedFlag(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return obj.timedOut === true ||
    obj.queued === true ||
    obj.pending === true ||
    obj.ok === false ||
    (typeof obj.error === 'string' && obj.error.trim() !== '' && obj.ok !== true);
}

function isCachedWorkerStopped(worker) {
  const status = worker?.status;
  if (!status || typeof status !== 'object') return false;
  if (status.online === true || status.connected === true) return false;
  const state = typeof status.state === 'string' ? status.state.trim().toLowerCase() : '';
  return STOP_CONFIRMED_STATES.has(state);
}

/**
 * Confirm that a worker stop dispatch actually reached a stopped/offline state
 * rather than timing out, queueing, merely delivering, or leaving the worker connected.
 */
function isWorkerStopConfirmed(res) {
  if (!res || typeof res !== 'object') return false;
  if (res.delivered === false) return false;

  const detail = res.result && typeof res.result === 'object' ? res.result : null;
  const nestedResult = detail?.result && typeof detail.result === 'object' ? detail.result : null;
  const objects = [
    nestedResult?.worker?.status,
    nestedResult?.worker,
    nestedResult?.status,
    nestedResult,
    detail?.worker?.status,
    detail?.worker,
    detail?.status,
    detail,
    res.worker?.status,
    res.worker,
    res.status,
    res
  ].filter((candidate) => candidate && typeof candidate === 'object');

  for (const obj of objects) {
    if (hasUnconfirmedFlag(obj)) return false;
    if (obj.connected === true || obj.online === true) return false;
  }

  const states = objects
    .map((obj) => (typeof obj.state === 'string' ? obj.state.trim().toLowerCase() : ''))
    .filter(Boolean);

  if (states.length > 0) {
    return states.every((state) => STOP_CONFIRMED_STATES.has(state));
  }

  const acknowledged =
    res.delivered === true ||
    res.ok === true ||
    detail?.ok === true ||
    nestedResult?.ok === true;

  return Boolean(acknowledged && objects.some((obj) => obj.stopped === true));
}

class EntitlementService {
  constructor({ store, registry, accessControl, logger, userLock }) {
    this.store = store;
    this.registry = registry;
    this.accessControl = accessControl;
    this.logger = logger;
    this.userLock = userLock;
  }

  async createCode({ days, permanent = false, botCount = 0, workerIds = [], maxUses = 1, planName = 'Standard', expiresAt = null, actorId }) {
    const duration = Number(days);
    const slots = Number(botCount);
    const uses = normalizeMaxUses(maxUses, 1);

    if (!permanent && (!Number.isInteger(duration) || duration < 1 || duration > 36500)) {
      throw new Error('Code duration must be 1–36500 days or permanent.');
    }
    if (!Number.isInteger(slots) || slots < 0 || slots > 25) {
      throw new Error('Bot count must be between 0 and 25.');
    }
    if (uses === null || uses < 0 || uses > 100000) {
      throw new Error('Max uses must be 0 (unlimited) or a positive integer up to 100,000.');
    }

    const fixedIds = [...new Set(workerIds.map((id) => String(id).trim().toLowerCase()).filter(Boolean))];
    let codeExpiry = null;
    if (expiresAt) {
      codeExpiry = new Date(expiresAt);
      if (Number.isNaN(codeExpiry.getTime()) || codeExpiry <= new Date()) {
        throw new Error('Code expiry must be a valid future date.');
      }
    }
    if (fixedIds.length > 25) throw new Error('A code can include up to 25 fixed workers.');
    if (fixedIds.length && uses > 1) throw new Error('Codes with fixed worker assignments can only be redeemed once.');

    const known = new Set((await this.registry.list()).map((worker) => String(worker.workerId)));
    if (fixedIds.some((id) => !known.has(id))) throw new Error('One or more fixed worker IDs are not registered.');

    const code = formatCode();
    const keyId = `key_${crypto.randomUUID()}`;

    const record = {
      id: keyId,
      keyId,
      code,
      key: code,
      keyCode: code,
      codeHash: hashCode(code),
      codeSuffix: code.slice(-4),
      status: 'unused',
      days: permanent ? -1 : duration,
      durationDays: permanent ? -1 : duration,
      isPermanent: Boolean(permanent),
      botCount: fixedIds.length || slots || 1,
      botIds: fixedIds,
      workerIds: fixedIds,
      planName: String(planName || 'Standard').slice(0, 64),
      maxUses: uses,
      usedCount: 0,
      usedUsers: [],
      expiresAt: codeExpiry ? codeExpiry.toISOString() : null,
      createdBy: String(actorId || 'system'),
      createdAt: new Date().toISOString()
    };

    await this.store.createKey(record);
    return {
      code,
      keyId,
      days: permanent ? -1 : duration,
      isPermanent: Boolean(permanent),
      botCount: fixedIds.length || slots || 1,
      maxUses: uses,
      planName: record.planName
    };
  }

  async listCodes(limit = 100) {
    return this.store.listKeys(limit);
  }

  async deleteCode(keyId) {
    return this.store.deleteKey(String(keyId || '').trim());
  }

  async redeem(userId, rawCode, discordRole = 'user') {
    const run = () => this.redeemLocked(userId, rawCode, discordRole);
    if (!this.userLock) return run();
    return this.userLock.run('global:bot_allocation', () => this.userLock.run(userId, run));
  }

  async redeemLocked(userId, rawCode, discordRole) {
    const normalized = normalizeCode(rawCode);
    if (normalized.length < 10 || normalized.length > 36) {
      throw new Error('Mã Giftcode không đúng định dạng.');
    }

    const cleanUserId = String(userId || '').trim();
    const member = this.accessControl
      ? await this.accessControl.memberFor(cleanUserId)
      : (this.store && typeof this.store.getAccess === 'function' ? await this.store.getAccess(cleanUserId) : null);
    if (member?.status === 'disabled') {
      throw new Error('Tài khoản này đã bị khóa quyền nạp mã.');
    }

    const codeHash = hashCode(normalized);
    let key = await this.store.getKey(codeHash);
    if (!key) {
      key = await this.store.getKey(normalized);
    }
    if (!key) {
      throw new Error('Mã Giftcode không tồn tại hoặc đã hết hạn.');
    }

    // 1. Kiểm tra hạn mức sử dụng (max_uses)
    const maxUses = normalizeMaxUses(key.maxUses ?? key.max_uses, 1);
    const usedUsers = Array.isArray(key.usedUsers) ? key.usedUsers.map(String) : [];
    const normalizedUser = cleanUserId.toLowerCase();

    if (usedUsers.includes(normalizedUser)) {
      throw new Error('Tài khoản của bạn đã từng nhập mã Giftcode này rồi.');
    }
    if (maxUses > 0 && (key.usedCount || 0) >= maxUses) {
      throw new Error('Mã Giftcode này đã hết lượt sử dụng.');
    }
    if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) {
      throw new Error('Mã Giftcode này đã quá hạn sử dụng.');
    }

    // 2. Tính toán thời hạn thuê mới (Cộng dồn nếu còn hạn, hoặc tính từ now)
    const now = Date.now();
    const existingPermanent = member?.isPermanent === true;
    const isPermanent = existingPermanent || key.isPermanent === true || key.days === -1;
    const currentExpiry = member?.expiresAt ? Date.parse(member.expiresAt) : NaN;
    const base = Number.isFinite(currentExpiry) && currentExpiry > now ? currentExpiry : now;
    const addedDays = Math.max(1, Number(key.days) || 1);
    const expiresAt = isPermanent ? null : new Date(base + addedDays * 86400000).toISOString();

    // 3. Phân bổ Bot rảnh
    const currentIds = Array.isArray(member?.workerIds) ? member.workerIds.map(String) : [];
    const desired = [...currentIds];
    const fixedIds = Array.isArray(key.workerIds) ? key.workerIds.map(String) : (Array.isArray(key.botIds) ? key.botIds.map(String) : []);
    const candidates = await this.registry.list();
    const registeredIds = new Set(candidates.map((w) => String(w.workerId)));
    const targetCount = Math.max(currentIds.length, Number(key.botCount) || 1);

    // Gán các bot cố định trong key
    for (const workerId of fixedIds) {
      if (desired.includes(workerId)) continue;
      if (!registeredIds.has(workerId)) continue;
      const assigned = await this.store.assignedUser(workerId);
      if (assigned && assigned.userId !== cleanUserId) continue;
      desired.push(workerId);
    }

    // Gán bổ sung bot rảnh nếu còn thiếu
    if (desired.length < targetCount) {
      for (const worker of candidates) {
        if (desired.length >= targetCount) break;
        if (desired.includes(String(worker.workerId))) continue;
        if (await this.store.assignedUser(String(worker.workerId))) continue;
        desired.push(String(worker.workerId));
      }
    }

    // 4. Gọi nạp nguyên tử qua Store
    const redeemed = await this.store.redeemKeyWithAccess(codeHash, cleanUserId, {
      role: 'user',
      status: 'active',
      workerIds: desired,
      isPermanent,
      expiresAt,
      planName: String(key.planName || member?.planName || 'Standard').slice(0, 64),
      note: member?.note || '',
      username: member?.username || cleanUserId,
      botCount: targetCount,
      stopPendingWorkers: []
    }, `code:${key.keyId || key.id}`);

    if (!redeemed) {
      throw new Error('Nạp mã thất bại: Giao dịch nguyên tử không thành công.');
    }

    // 5. Nếu thiếu bot so với hạn ngạch của key, đẩy vào hàng đợi cấp phát tự động
    const missingWorkers = Math.max(0, targetCount - desired.length);
    if (missingWorkers > 0) {
      const nowIso = new Date().toISOString();
      const allocUsername = String(member?.username || cleanUserId).trim().toLowerCase();
      if (this.store.adapter && typeof this.store.adapter.savePendingAllocation === 'function') {
        await this.store.adapter.savePendingAllocation({
          id: `alloc_${crypto.randomUUID()}`,
          username: allocUsername,
          targetBotCount: targetCount,
          currentAssigned: desired.length,
          missingBotCount: missingWorkers,
          status: 'pending_retry',
          createdAt: nowIso
        }).catch((err) => {
          this.logger?.warn('enqueue_pending_allocation_failed', { userId: cleanUserId, error: err.message });
        });
      } else {
        await this.store.client?.from?.('manager_pending_allocations')?.insert?.({
          id: `alloc_${crypto.randomUUID()}`,
          username: allocUsername,
          target_bot_count: targetCount,
          current_assigned: desired.length,
          missing_bot_count: missingWorkers,
          status: 'pending_retry',
          created_at: nowIso,
          updated_at: nowIso
        }).catch((err) => {
          this.logger?.warn('enqueue_pending_allocation_failed', { userId: cleanUserId, error: err.message });
        });
      }
    }

    this.logger?.info('key_redeemed_success', {
      userId: cleanUserId,
      code: key.code || normalized,
      addedDays,
      isPermanent,
      expiresAt,
      assignedBots: desired.length,
      missingBots: missingWorkers
    });

    return {
      success: true,
      expiresAt,
      isPermanent,
      workerIds: desired,
      assignedCount: desired.length,
      targetCount,
      missingWorkers,
      planName: key.planName
    };
  }

  async checkExpiredUsersAndGracefulStop({ broker, fleetOperations } = {}) {
    try {
      const users = await this.store.listAccess();
      if (!Array.isArray(users) || users.length === 0) return { checked: 0, expired: 0 };
      const now = Date.now();
      let expiredCount = 0;

      for (const u of users) {
        if (u.isPermanent) continue;
        if (!u.expiresAt) continue;
        const expiryTime = Date.parse(u.expiresAt);
        if (!Number.isFinite(expiryTime) || expiryTime > now) continue;

        // Skip permanently disabled accounts
        if (u.status === 'disabled') continue;

        // If already fully expired and has no pending unstopped bots, skip
        if (u.status === 'expired' && (!u.stopPendingWorkers || u.stopPendingWorkers.length === 0)) {
          continue;
        }

        const workerIds = (Array.isArray(u.workerIds) && u.workerIds.length)
          ? u.workerIds
          : ((Array.isArray(u.assignedBotIds) && u.assignedBotIds.length) ? u.assignedBotIds : []);

        // Determine which bots still need to be stopped
        const botsToStop = Array.isArray(u.stopPendingWorkers) && u.stopPendingWorkers.length
          ? u.stopPendingWorkers
          : workerIds;

        if (botsToStop.length === 0) {
          if (u.status !== 'expired') {
            await this.store.setAccess(u.userId, { ...u, status: 'expired', stopPendingWorkers: [] }, 'system:expiration');
            expiredCount++;
          }
          continue;
        }

        this.logger?.info('user_expiring_process_stops', {
          userId: u.userId,
          username: u.username,
          status: u.status,
          botsToStop
        });

        // Mark as expiring while waiting for STOP results
        if (u.status === 'active') {
          await this.store.setAccess(u.userId, {
            ...u,
            status: 'expiring',
            stopPendingWorkers: botsToStop
          }, 'system:expiring');
        }

        const remainingFailed = [];
        for (const workerId of botsToStop) {
          let stopped = false;
          try {
            const currentWorker = await this.registry?.find(workerId);
            if (isCachedWorkerStopped(currentWorker)) {
              stopped = true;
            } else if (fleetOperations && typeof fleetOperations.stopWorker === 'function') {
              const res = await fleetOperations.stopWorker(workerId, 'Gói thuê đã hết hạn');
              stopped = isWorkerStopConfirmed(res);
            } else if (broker && typeof broker.dispatch === 'function') {
              const res = await broker.dispatch(workerId, 'stop', { reason: 'Gói thuê đã hết hạn' });
              stopped = isWorkerStopConfirmed(res);
            }
          } catch (stopErr) {
            this.logger?.warn('failed_to_stop_expired_bot', { workerId, error: stopErr.message });
          }

          if (!stopped) {
            remainingFailed.push(workerId);
          }
        }

        if (remainingFailed.length === 0) {
          // All bots confirmed stopped: transition to terminal 'expired' state
          await this.store.setAccess(u.userId, {
            ...u,
            status: 'expired',
            stopPendingWorkers: []
          }, 'system:expiration');
          expiredCount++;
        } else {
          // Some stops unconfirmed: retain in 'expiring' for automatic retry on next cycle
          await this.store.setAccess(u.userId, {
            ...u,
            status: 'expiring',
            stopPendingWorkers: remainingFailed
          }, 'system:expiration_retry');
          this.logger?.warn('user_expiration_partially_failed_will_retry', {
            userId: u.userId,
            remainingFailed
          });
        }
      }

      return { checked: users.length, expired: expiredCount };
    } catch (err) {
      this.logger?.warn('check_expired_users_error', { error: err.message });
      return { error: err.message };
    }
  }

  async checkExpiredUsers(fleetOpsOrOpts, brokerArg) {
    if (fleetOpsOrOpts && typeof fleetOpsOrOpts.stopAll === 'function') {
      return this.checkExpiredUsersAndGracefulStop({ fleetOperations: fleetOpsOrOpts, broker: brokerArg || fleetOpsOrOpts.broker });
    }
    if (fleetOpsOrOpts && (fleetOpsOrOpts.fleetOperations || fleetOpsOrOpts.broker)) {
      return this.checkExpiredUsersAndGracefulStop(fleetOpsOrOpts);
    }
    return this.checkExpiredUsersAndGracefulStop({ fleetOperations: fleetOpsOrOpts, broker: brokerArg });
  }
}

module.exports = { EntitlementService, isWorkerStopConfirmed, normalizeCode, hashCode };
