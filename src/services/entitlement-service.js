'use strict';

const crypto = require('node:crypto');

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
    const uses = Number(maxUses);
    if (!permanent && (!Number.isInteger(duration) || duration < 1 || duration > 36500)) throw new Error('Code duration must be 1–36500 days or permanent.');
    if (!Number.isInteger(slots) || slots < 0 || slots > 25) throw new Error('Bot count must be between 0 and 25.');
    if (!Number.isInteger(uses) || uses < 1 || uses > 1000) throw new Error('Max uses must be between 1 and 1000.');
    const fixedIds = [...new Set(workerIds.map((id) => String(id).trim().toLowerCase()).filter(Boolean))];
    let codeExpiry = null;
    if (expiresAt) {
      codeExpiry = new Date(expiresAt);
      if (Number.isNaN(codeExpiry.getTime()) || codeExpiry <= new Date()) throw new Error('Code expiry must be a valid future date.');
    }
    if (fixedIds.length > 25) throw new Error('A code can include up to 25 fixed workers.');
    if (fixedIds.length && uses > 1) throw new Error('Codes with fixed worker assignments can only be redeemed once.');
    const known = new Set((await this.registry.list()).map((worker) => worker.workerId));
    if (fixedIds.some((id) => !known.has(id))) throw new Error('One or more fixed worker IDs are not registered.');

    const code = formatCode();
    const keyId = crypto.randomUUID();
    await this.store.createKey({
      keyId, codeHash: hashCode(code), codeSuffix: code.slice(-4), status: 'unused',
      days: permanent ? -1 : duration, isPermanent: Boolean(permanent), botCount: fixedIds.length || slots,
      workerIds: fixedIds, planName: String(planName || 'Standard').slice(0, 64),
      maxUses: uses, usedCount: 0, usedUsers: [], expiresAt: codeExpiry,
      createdBy: actorId, createdAt: new Date()
    });
    return { code, keyId, days: permanent ? -1 : duration, isPermanent: Boolean(permanent), botCount: fixedIds.length || slots, maxUses: uses, planName: String(planName || 'Standard').slice(0, 64) };
  }

  async listCodes(limit = 20) { return this.store.listKeys(limit); }

  async deleteCode(keyId) { return this.store.deleteKey(String(keyId || '').trim()); }

  async redeem(userId, rawCode, discordRole) {
    const run = () => this.redeemLocked(userId, rawCode, discordRole);
    return this.userLock ? this.userLock.run(userId, run) : run();
  }

  async redeemLocked(userId, rawCode, discordRole) {
    const normalized = normalizeCode(rawCode);
    if (normalized.length < 12 || normalized.length > 32) throw new Error('That code is not valid.');
    if (discordRole !== 'user') throw new Error('Only members with the configured Discord user role can redeem codes.');
    const member = await this.accessControl.memberFor(userId);
    if (member?.status === 'disabled') throw new Error('This code cannot be redeemed by this account.');

    const codeHash = hashCode(normalized);
    const key = await this.store.getKey(codeHash);
    if (!key) throw new Error('Code is invalid, expired, already used, or has no uses remaining.');

    const now = Date.now();
    const existingPermanent = member?.isPermanent === true;
    const isPermanent = existingPermanent || key.isPermanent === true;
    const currentExpiry = member?.expiresAt ? Date.parse(member.expiresAt) : NaN;
    const base = Number.isFinite(currentExpiry) && currentExpiry > now ? currentExpiry : now;
    const expiresAt = isPermanent ? null : new Date(base + Math.max(1, Number(key.days) || 1) * 86400000).toISOString();
    const currentIds = Array.isArray(member?.workerIds) ? member.workerIds : [];
    const desired = [...currentIds];
    const fixedIds = Array.isArray(key.workerIds) ? key.workerIds : [];
    const candidates = await this.registry.list();
    const registeredIds = new Set(candidates.map((worker) => worker.workerId));
    const targetCount = Math.max(currentIds.length, Number(key.botCount) || 0);
    for (const workerId of fixedIds) {
      if (desired.includes(workerId)) continue;
      if (!registeredIds.has(workerId)) continue;
      const assigned = await this.store.assignedUser(workerId);
      if (assigned && assigned.userId !== userId) continue;
      desired.push(workerId);
    }

    if (!fixedIds.length && desired.length < targetCount) {
      for (const worker of candidates) {
        if (desired.length >= targetCount) break;
        if (desired.includes(worker.workerId)) continue;
        if (await this.store.assignedUser(worker.workerId)) continue;
        desired.push(worker.workerId);
      }
    }

    const redeemed = await this.store.redeemKeyWithAccess(codeHash, userId, {
      role: 'user', status: 'active', workerIds: desired, isPermanent,
      expiresAt, planName: String(key.planName || member?.planName || 'Standard').slice(0, 64),
      note: member?.note || '', username: member?.username || ''
    }, `code:${key.keyId}`);
    if (!redeemed) throw new Error('Code is invalid, expired, already used, or has no uses remaining.');

    return {
      expiresAt, isPermanent, workerIds: desired,
      missingWorkers: Math.max(0, targetCount - desired.length),
      planName: key.planName
    };
  }
}

module.exports = { EntitlementService, normalizeCode, hashCode };
