'use strict';

const crypto = require('node:crypto');
const { normalizeMaxUses } = require('../storage/supabase-client');
const { getMaintenanceState, flushMaintenanceCompensation } = require('../utils/maintenance');

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

const DEFAULT_GRACE_PERIOD_MS = 6 * 60 * 60 * 1000; // 6 hours

class EntitlementService {
  constructor({ store, registry, accessControl, logger, userLock, gracePeriodMs, config } = {}) {
    this.store = store;
    this.registry = registry;
    this.accessControl = accessControl;
    this.logger = logger;
    this.userLock = userLock;
    this.isSweepRunning = false;
    this.stopPendingByUser = new Map();
    const cfgHours = config?.botExpirationGraceHours;
    const envHoursRaw = process.env.BOT_EXPIRATION_GRACE_HOURS;
    const envHours = (envHoursRaw !== undefined && String(envHoursRaw).trim() !== '') ? Number(envHoursRaw) : NaN;
    this.gracePeriodMs = Number.isFinite(gracePeriodMs) && gracePeriodMs >= 0
      ? gracePeriodMs
      : (cfgHours !== undefined && cfgHours !== null && String(cfgHours).trim() !== '' && Number.isFinite(Number(cfgHours)) && Number(cfgHours) >= 0
          ? Number(cfgHours) * 3600 * 1000
          : (Number.isFinite(envHours) && envHours >= 0
              ? envHours * 3600 * 1000
              : DEFAULT_GRACE_PERIOD_MS));
  }

  async createCode({ days, permanent = false, botCount = 0, workerIds = [], maxUses = 1, planName = 'Standard', expiresAt = null, customCode = '', actorId }) {
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
    if (fixedIds.length && uses !== 1) throw new Error('Codes with fixed worker assignments can only be redeemed once.');

    const workers = await this.registry.list();
    const known = new Map(workers.map((worker) => [String(worker.workerId), worker]));
    if (fixedIds.some((id) => !known.has(id))) throw new Error('One or more fixed worker IDs are not registered.');
    if (fixedIds.some((id) => known.get(id).enabled === false || known.get(id).rentable === false)) {
      throw new Error('Fixed workers must be enabled and available for rental.');
    }

    if (typeof customCode !== 'string') throw new Error('Custom code must be a string.');
    const normalizedCustomCode = normalizeCode(customCode);
    if (customCode && (normalizedCustomCode.length < 10 || normalizedCustomCode.length > 36)) {
      throw new Error('Custom code must contain 10–36 letters or numbers.');
    }
    const code = normalizedCustomCode || formatCode();
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
      botCount: Math.max(1, fixedIds.length, slots),
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
      botCount: Math.max(1, fixedIds.length, slots),
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
    const codeHash = hashCode(rawCode);
    return this.userLock.run(`key:${codeHash}`, () =>
      this.userLock.run('global:bot_allocation', () =>
        this.userLock.run(userId, run)
      )
    );
  }

  async redeemLocked(userId, rawCode, discordRole) {
    const normalized = normalizeCode(rawCode);
    if (normalized.length < 10 || normalized.length > 36) {
      throw new Error('Mã Giftcode không đúng định dạng.');
    }

    const cleanUserId = String(userId || '').trim();
    let member = this.accessControl
      ? await this.accessControl.memberFor(cleanUserId, { bypassCache: true })
      : (this.store && typeof this.store.getAccess === 'function' ? await this.store.getAccess(cleanUserId, { bypassCache: true }) : null);
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
    const usedUsers = Array.isArray(key.usedUsers)
      ? key.usedUsers.map((u) => String(u || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const normalizedUser = cleanUserId.toLowerCase();
    const normalizedUsername = String(member?.username || '').trim().toLowerCase();

    if (usedUsers.includes(normalizedUser) || (normalizedUsername && usedUsers.includes(normalizedUsername))) {
      throw new Error('Tài khoản của bạn đã từng nhập mã Giftcode này rồi.');
    }
    if (maxUses > 0 && (key.usedCount || 0) >= maxUses) {
      throw new Error('Mã Giftcode này đã hết lượt sử dụng.');
    }
    if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) {
      throw new Error('Mã Giftcode này đã quá hạn sử dụng.');
    }

    // Flush checkpoint bảo trì trước khi gán now + duration cho user chưa có hạn tương lai để tránh cộng bù ngược thời gian trước lúc nạp mã
    const activeMaint = await getMaintenanceState(this.store);
    const preCheckNow = Date.now();
    const preCheckExpiry = member?.expiresAt ? Date.parse(member.expiresAt) : NaN;
    if (activeMaint?.enabled && !(member?.isPermanent === true) && (!Number.isFinite(preCheckExpiry) || preCheckExpiry <= preCheckNow)) {
      await flushMaintenanceCompensation(this.store, {
        toMs: preCheckNow,
        gracePeriodMs: this.gracePeriodMs,
        turnOff: false,
        actor: 'system:redeem_checkpoint',
        logger: this.logger
      });
      member = this.accessControl
        ? await this.accessControl.memberFor(cleanUserId, { bypassCache: true })
        : (this.store && typeof this.store.getAccess === 'function' ? await this.store.getAccess(cleanUserId, { bypassCache: true }) : member);
      if (member?.status === 'disabled') {
        throw new Error('Tài khoản này đã bị khóa quyền nạp mã.');
      }
    }

    // 2. Tính toán thời hạn thuê mới (Cộng dồn nếu còn hạn, hoặc tính từ now)
    const now = Date.now();
    const existingPermanent = member?.isPermanent === true;
    const isPermanent = existingPermanent || key.isPermanent === true || key.days === -1;
    const currentExpiry = member?.expiresAt ? Date.parse(member.expiresAt) : NaN;
    const base = Number.isFinite(currentExpiry) && currentExpiry > now ? currentExpiry : now;
    let addedDays = 0;
    let durationMs = 0;
    if (!isPermanent) {
      const rawDurationMs = Number(key.durationMs ?? key.duration_ms);
      const rawDays = Number(key.days ?? key.durationDays);
      if (Number.isFinite(rawDurationMs) && rawDurationMs > 0) {
        durationMs = Math.floor(rawDurationMs);
        addedDays = Math.max(1, Math.round(durationMs / 86400000));
      } else if (Number.isFinite(rawDays) && rawDays > 0) {
        addedDays = Math.floor(rawDays);
      } else {
        throw new Error('Mã kích hoạt không có thời hạn hợp lệ.');
      }
    }
    const newExpiryMs = isPermanent ? null : (durationMs > 0 ? base + durationMs : base + addedDays * 86400000);
    if (!isPermanent && (!Number.isFinite(newExpiryMs) || newExpiryMs <= now)) {
      throw new Error('Không thể tính toán thời hạn sử dụng mới hợp lệ.');
    }
    const expiresAt = isPermanent ? null : new Date(newExpiryMs).toISOString();

    // 3. Phân bổ Bot rảnh (dùng map ownership 1 lần thay vì N+1 query assignedUser)
    const currentIds = Array.isArray(member?.workerIds) ? member.workerIds.map(String) : [];
    const desired = [...currentIds];
    const fixedIds = Array.isArray(key.workerIds) ? key.workerIds.map(String) : (Array.isArray(key.botIds) ? key.botIds.map(String) : []);
    const candidates = (await this.registry.list()).filter((worker) => worker.enabled !== false && worker.rentable !== false);
    const registeredIds = new Set(candidates.map((w) => String(w.workerId)));
    const newFixedCount = fixedIds.filter((workerId) => !currentIds.includes(workerId)).length;
    const targetCount = Math.max(currentIds.length, Number(key.botCount) || 1, currentIds.length + newFixedCount);

    let ownerByWorkerId = null;
    if (typeof this.store?.listAccess === 'function') {
      try {
        const allUsers = await this.store.listAccess();
        if (Array.isArray(allUsers)) {
          ownerByWorkerId = new Map();
          for (const u of allUsers) {
            const ownerId = String(u.userId || u.id || u.username || '');
            const ids = Array.isArray(u.workerIds) ? u.workerIds : (Array.isArray(u.assignedBotIds) ? u.assignedBotIds : []);
            for (const wid of ids) {
              const keyWid = String(wid || '').trim().toLowerCase();
              if (keyWid) ownerByWorkerId.set(keyWid, ownerId);
            }
          }
        }
      } catch (_) {
        ownerByWorkerId = null;
      }
    }

    const getOwner = async (workerId) => {
      const cleanWid = String(workerId || '').trim().toLowerCase();
      if (ownerByWorkerId) {
        return ownerByWorkerId.get(cleanWid) || null;
      }
      const assigned = await this.store.assignedUser(workerId);
      return assigned ? String(assigned.userId || '') : null;
    };

    // Gán các bot cố định trong key
    for (const workerId of fixedIds) {
      if (desired.length >= targetCount) break;
      if (desired.includes(workerId)) continue;
      if (!registeredIds.has(workerId)) continue;
      const ownerId = await getOwner(workerId);
      if (ownerId && ownerId !== cleanUserId) continue;
      desired.push(workerId);
    }

    // Gán bổ sung bot rảnh nếu còn thiếu
    if (desired.length < targetCount) {
      for (const worker of candidates) {
        if (desired.length >= targetCount) break;
        if (desired.includes(String(worker.workerId))) continue;
        if (await getOwner(String(worker.workerId))) continue;
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
      addDays: isPermanent ? 0 : addedDays,
      durationMs: isPermanent ? 0 : durationMs,
      planName: String(key.planName || member?.planName || 'Standard').slice(0, 64),
      note: member?.note || '',
      username: member?.username || cleanUserId,
      allowAccountChange: key.allowAccountChange !== undefined ? Boolean(key.allowAccountChange) : (member?.allowAccountChange !== false),
      botCount: targetCount,
      stopPendingWorkers: []
    }, `code:${key.keyId || key.id}`);

    if (!redeemed) {
      throw new Error('Nạp mã thất bại: Giao dịch nguyên tử không thành công.');
    }

    // 5. Nếu thiếu bot so với hạn ngạch của key, đẩy vào hàng đợi cấp phát tự động
    const missingWorkers = Math.max(0, targetCount - desired.length);
    let compensationState = null;
    if (missingWorkers > 0) {
      const nowIso = new Date().toISOString();
      const allocUsername = String(member?.username || cleanUserId).trim().toLowerCase();
      const allocId = `alloc_${crypto.randomUUID()}`;
      let allocationSaved = false;
      let allocError = null;

      if (this.store.adapter && typeof this.store.adapter.savePendingAllocation === 'function') {
        try {
          const res = await this.store.adapter.savePendingAllocation({
            id: allocId,
            username: allocUsername,
            targetBotCount: targetCount,
            currentAssigned: desired.length,
            missingBotCount: missingWorkers,
            status: 'pending_retry',
            createdAt: nowIso
          });
          if (res !== false) {
            allocationSaved = true;
          } else {
            allocError = new Error('savePendingAllocation returned false');
          }
        } catch (err) {
          allocError = err;
        }
      } else if (this.store.client?.from) {
        try {
          const allocRow = {
            id: allocId,
            username: allocUsername,
            target_bot_count: targetCount,
            current_assigned: desired.length,
            missing_bot_count: missingWorkers,
            status: 'pending_retry',
            created_at: nowIso,
            updated_at: nowIso
          };
          const allocTable = this.store.client.from('manager_pending_allocations');
          const res = typeof allocTable.upsert === 'function'
            ? await allocTable.upsert(allocRow, { onConflict: 'id', ignoreDuplicates: true })
            : await allocTable.insert(allocRow);
          if (res?.error) {
            allocError = res.error;
          } else {
            allocationSaved = true;
          }
        } catch (err) {
          allocError = err;
        }
      }

      if (!allocationSaved) {
        this.logger?.warn('enqueue_pending_allocation_failed_attempting_compensation', {
          userId: cleanUserId,
          error: allocError?.message || 'unknown'
        });

        const compensationRecord = {
          id: allocId,
          type: 'pending_allocation_compensation',
          userId: cleanUserId,
          username: allocUsername,
          targetBotCount: targetCount,
          currentAssigned: desired.length,
          missingBotCount: missingWorkers,
          status: 'pending_retry',
          error: allocError?.message || 'Allocation save failed',
          createdAt: nowIso
        };

        if (typeof this.store.enqueueOutbox === 'function') {
          try {
            await this.store.enqueueOutbox({
              id: `outbox_${allocId}`,
              taskType: 'pending_allocation_compensation',
              type: 'pending_allocation_compensation',
              payload: compensationRecord,
              status: 'pending',
              nextRetryAt: nowIso
            });
          } catch (outboxErr) {
            this.logger?.error?.('compensation_outbox_failed', { userId: cleanUserId, error: outboxErr.message });
          }
        }

        if (typeof this.store.saveCompensationRecord === 'function') {
          try {
            await this.store.saveCompensationRecord(compensationRecord);
          } catch (_) {}
        }

        if (!this.pendingCompensations) {
          this.pendingCompensations = new Map();
        }
        while (this.pendingCompensations.size >= 500) {
          const oldestKey = this.pendingCompensations.keys().next().value;
          if (oldestKey === undefined) break;
          this.pendingCompensations.delete(oldestKey);
        }
        this.pendingCompensations.set(allocId, compensationRecord);
        compensationState = compensationRecord;
      }
    }

    const rawCodeForMask = String(key.code || normalized || '');
    this.logger?.info('key_redeemed_success', {
      userId: cleanUserId,
      codeSuffix: rawCodeForMask ? `***${rawCodeForMask.slice(-4)}` : '***',
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
      planName: key.planName,
      compensationState: compensationState || null
    };
  }

  getPendingCompensations() {
    return Array.from(this.pendingCompensations?.values() || []);
  }

  clearPendingCompensations() {
    this.pendingCompensations?.clear();
  }

  async checkExpiredUsersAndGracefulStop({ broker, fleetOperations, gracePeriodMs } = {}) {
    if (this.isSweepRunning) {
      this.logger?.info?.('check_expired_users_sweep_already_running_skipping');
      return { checked: 0, expired: 0, skipped: true };
    }
    this.isSweepRunning = true;
    try {
      const maint = await getMaintenanceState(this.store);
      if (maint?.enabled) {
        return { checked: 0, expired: 0, pausedByMaintenance: true };
      }
      const users = await this.store.listAccess();
      if (!Array.isArray(users) || users.length === 0) return { checked: 0, expired: 0 };
      const now = Date.now();
      const effectiveGracePeriodMs = Number.isFinite(gracePeriodMs) && gracePeriodMs >= 0
        ? gracePeriodMs
        : this.gracePeriodMs;
      let expiredCount = 0;

      for (const u of users) {
        // Pre-filter before acquiring lock / bypassing cache to avoid N+1 DB reads on active/permanent/disabled users
        if (u.isPermanent || !u.expiresAt || u.status === 'disabled') continue;
        const listExpiryTime = Date.parse(u.expiresAt);
        if (!Number.isFinite(listExpiryTime) || listExpiryTime > now) continue;
        const memPending = this.stopPendingByUser.get(u.userId);
        const listPending = Array.isArray(u.stopPendingWorkers) && u.stopPendingWorkers.length
          ? u.stopPendingWorkers
          : (Array.isArray(memPending) ? memPending : []);
        if (u.status === 'expired' && listPending.length === 0) {
          continue;
        }
        // Already in grace_period and still within grace window -> skip redundant DB fetch & write!
        if (u.status === 'grace_period' && now <= listExpiryTime + effectiveGracePeriodMs) {
          continue;
        }

        const processUser = async () => {
          // Re-fetch fresh user from DB to avoid acting on stale snapshot; fail-closed on read error (ENT-06)
          let freshUser = u;
          if (typeof this.store.getAccess === 'function') {
            try {
              freshUser = await this.store.getAccess(u.userId, { bypassCache: true });
            } catch (readErr) {
              this.logger?.warn?.('expiration_sweep_reread_failed', { userId: u.userId, error: readErr?.message });
              return;
            }
            if (!freshUser) {
              this.stopPendingByUser.delete(u.userId);
              return;
            }
          }

          if (freshUser.isPermanent) {
            this.stopPendingByUser.delete(freshUser.userId);
            return;
          }
          if (!freshUser.expiresAt) return;
          const expiryTime = Date.parse(freshUser.expiresAt);
          if (!Number.isFinite(expiryTime) || expiryTime > now) {
            this.stopPendingByUser.delete(freshUser.userId);
            return;
          }

          // Skip permanently disabled accounts
          if (freshUser.status === 'disabled') return;

          // Distinguish isInGracePeriod: if expiryTime < now <= expiryTime + gracePeriodMs
          if (now <= expiryTime + effectiveGracePeriodMs) {
            // DO NOT stop worker. Keep bot running in game.
            if (freshUser.status !== 'grace_period') {
              await this.store.setAccess(freshUser.userId, {
                ...freshUser,
                status: 'grace_period',
                inGracePeriod: true
              }, 'system:grace_period');
              const remainingGraceMs = Math.max(0, (expiryTime + effectiveGracePeriodMs) - now);
              this.logger?.info('user_in_grace_period_bot_kept_running', {
                userId: freshUser.userId,
                username: freshUser.username,
                expiresAt: freshUser.expiresAt,
                remainingGraceMs,
                remainingMinutes: Math.round(remainingGraceMs / 60000)
              });
            }
            return;
          }

          // If here: isGracePeriodExpired (now > expiryTime + gracePeriodMs)
          const trackedPending = Array.isArray(freshUser.stopPendingWorkers) && freshUser.stopPendingWorkers.length
            ? freshUser.stopPendingWorkers
            : (this.stopPendingByUser.get(freshUser.userId) || []);

          // If already fully expired and has no pending unstopped bots, skip
          if (freshUser.status === 'expired' && trackedPending.length === 0) {
            this.stopPendingByUser.delete(freshUser.userId);
            return;
          }

          const workerIds = (Array.isArray(freshUser.workerIds) && freshUser.workerIds.length)
            ? freshUser.workerIds
            : ((Array.isArray(freshUser.assignedBotIds) && freshUser.assignedBotIds.length) ? freshUser.assignedBotIds : []);

          // Determine which bots still need to be stopped (scoped strictly to currently owned bots)
          const ownedSet = new Set(workerIds.map((id) => String(id).toLowerCase()));
          const botsToStop = (trackedPending.length ? trackedPending.filter((id) => ownedSet.has(String(id).toLowerCase())) : workerIds);

          if (botsToStop.length === 0) {
            this.stopPendingByUser.delete(freshUser.userId);
            if (freshUser.status !== 'expired') {
              await this.store.setAccess(freshUser.userId, {
                ...freshUser,
                status: 'expired',
                inGracePeriod: false,
                stopPendingWorkers: []
              }, 'system:expiration');
              expiredCount++;
            }
            return;
          }

          this.logger?.info('user_expiring_process_stops', {
            userId: freshUser.userId,
            username: freshUser.username,
            status: freshUser.status,
            botsToStop
          });

          // Mark as expiring while waiting for STOP results
          if (freshUser.status === 'active' || freshUser.status === 'grace_period') {
            this.stopPendingByUser.set(freshUser.userId, [...botsToStop]);
            await this.store.setAccess(freshUser.userId, {
              ...freshUser,
              status: 'expiring',
              inGracePeriod: false,
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
                const res = await fleetOperations.stopWorker(workerId, 'Gói thuê đã hết hạn ân hạn 6 giờ');
                stopped = isWorkerStopConfirmed(res);
              } else if (broker && typeof broker.dispatch === 'function') {
                const res = await broker.dispatch(workerId, 'stop', { reason: 'Gói thuê đã hết hạn ân hạn 6 giờ' });
                stopped = isWorkerStopConfirmed(res);
              }
            } catch (stopErr) {
              this.logger?.warn('failed_to_stop_expired_bot', { workerId, error: stopErr.message });
            }

            if (!stopped) {
              remainingFailed.push(workerId);
            }
          }

          // Before updating terminal status, re-read fresh user to check if renewed while stopping bots
          let latestUser = freshUser;
          if (typeof this.store.getAccess === 'function') {
            try {
              latestUser = await this.store.getAccess(freshUser.userId, { bypassCache: true });
            } catch (readErr) {
              this.logger?.warn?.('expiration_sweep_finalize_reread_failed', { userId: freshUser.userId, error: readErr?.message });
              return;
            }
            if (!latestUser) {
              this.stopPendingByUser.delete(freshUser.userId);
              return;
            }
          }

          const latestExpiry = latestUser.expiresAt ? Date.parse(latestUser.expiresAt) : NaN;
          if (
            latestUser.isPermanent ||
            (Number.isFinite(latestExpiry) && latestExpiry > Date.now()) ||
            latestUser.status === 'active' ||
            latestUser.status === 'disabled'
          ) {
            this.stopPendingByUser.delete(latestUser.userId);
            this.logger?.info('user_status_changed_during_graceful_stop_cancelling_expiration', {
              userId: latestUser.userId,
              status: latestUser.status,
              expiresAt: latestUser.expiresAt
            });
            return;
          }

          if (remainingFailed.length === 0) {
            // All bots confirmed stopped: transition to terminal 'expired' state
            this.stopPendingByUser.delete(latestUser.userId);
            const currentPending = Array.isArray(latestUser.stopPendingWorkers) ? latestUser.stopPendingWorkers : [];
            if (latestUser.status !== 'expired' || currentPending.length > 0 || latestUser.inGracePeriod) {
              await this.store.setAccess(latestUser.userId, {
                ...latestUser,
                status: 'expired',
                inGracePeriod: false,
                stopPendingWorkers: []
              }, 'system:expiration');
              expiredCount++;
            }
            this.logger?.info('user_grace_period_expired_bots_stopped', {
              userId: latestUser.userId,
              username: latestUser.username,
              stoppedWorkers: botsToStop
            });
          } else {
            // Some stops unconfirmed: retain in 'expiring' and skip redundant DB write if unchanged (ENT-08)
            this.stopPendingByUser.set(latestUser.userId, [...remainingFailed]);
            const prevPending = Array.isArray(latestUser.stopPendingWorkers) ? [...latestUser.stopPendingWorkers].map(String).sort() : [];
            const nextPending = [...remainingFailed].map(String).sort();
            const samePending = prevPending.length === nextPending.length && prevPending.every((v, idx) => v === nextPending[idx]);
            if (latestUser.status !== 'expiring' || !samePending || latestUser.inGracePeriod) {
              await this.store.setAccess(latestUser.userId, {
                ...latestUser,
                status: 'expiring',
                inGracePeriod: false,
                stopPendingWorkers: remainingFailed
              }, 'system:expiration_retry');
            }
            this.logger?.warn('user_expiration_partially_failed_will_retry', {
              userId: latestUser.userId,
              remainingFailed
            });
          }
        };

        if (this.userLock && typeof this.userLock.run === 'function') {
          await this.userLock.run(u.userId, processUser);
        } else {
          await processUser();
        }
      }

      return { checked: users.length, expired: expiredCount };
    } catch (err) {
      this.logger?.warn('check_expired_users_error', { error: err.message });
      return { error: err.message };
    } finally {
      this.isSweepRunning = false;
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

module.exports = { EntitlementService, DEFAULT_GRACE_PERIOD_MS, isWorkerStopConfirmed, normalizeCode, hashCode };
