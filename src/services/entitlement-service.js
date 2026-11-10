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
    return this.userLock ? this.userLock.run(userId, run) : run();
  }

  async redeemLocked(userId, rawCode, discordRole) {
    const normalized = normalizeCode(rawCode);
    if (normalized.length < 10 || normalized.length > 36) {
      throw new Error('Mã Giftcode không đúng định dạng.');
    }

    const cleanUserId = String(userId || '').trim();
    const member = await this.accessControl.memberFor(cleanUserId);
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
    const transactionId = `tx_${crypto.randomUUID()}`;
    const redeemed = await this.store.redeemKeyWithAccess(codeHash, cleanUserId, {
      role: 'user',
      status: 'active',
      workerIds: desired,
      isPermanent,
      expiresAt,
      planName: String(key.planName || member?.planName || 'Standard').slice(0, 64),
      note: member?.note || '',
      username: member?.username || cleanUserId,
      botCount: targetCount
    }, `code:${key.keyId || key.id}`);

    if (!redeemed) {
      // Fallback consume atomic
      await this.store.redeemKeyAtomic(normalized, cleanUserId, transactionId);
    }

    // 5. Nếu thiếu bot so với hạn ngạch của key, đẩy vào hàng đợi cấp phát tự động
    const missingWorkers = Math.max(0, targetCount - desired.length);
    if (missingWorkers > 0) {
      await this.store.client.from('manager_pending_allocations').insert({
        id: `alloc_${crypto.randomUUID()}`,
        user_id: cleanUserId,
        username: member?.username || cleanUserId,
        required_bot_count: missingWorkers,
        status: 'pending_retry',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).catch((err) => {
        this.logger?.warn('enqueue_pending_allocation_failed', { userId: cleanUserId, error: err.message });
      });
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
        if (u.status !== 'active') continue;
        if (!u.expiresAt) continue;
        const expiryTime = Date.parse(u.expiresAt);
        if (Number.isFinite(expiryTime) && expiryTime <= now) {
          this.logger?.info('user_expired_graceful_stop', { userId: u.userId, username: u.username, expiresAt: u.expiresAt });

          // Cập nhật trạng thái thành 'expired' nhưng bảo toàn workerIds và cấu hình
          await this.store.setAccess(u.userId, {
            ...u,
            status: 'expired'
          }, 'system:expiration');

          // Dừng toàn bộ bot của user
          const workerIds = (Array.isArray(u.workerIds) && u.workerIds.length) ? u.workerIds : (Array.isArray(u.assignedBotIds) ? u.assignedBotIds : []);
          for (const workerId of workerIds) {
            try {
              if (fleetOperations && typeof fleetOperations.stopWorker === 'function') {
                await fleetOperations.stopWorker(workerId, 'Gói thuê đã hết hạn');
              } else if (broker && typeof broker.dispatch === 'function') {
                await broker.dispatch(workerId, 'stop', { reason: 'Gói thuê đã hết hạn' });
              }
            } catch (stopErr) {
              this.logger?.warn('failed_to_stop_expired_bot', { workerId, error: stopErr.message });
            }
          }
          expiredCount++;
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

module.exports = { EntitlementService, normalizeCode, hashCode };
