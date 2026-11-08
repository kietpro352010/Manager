'use strict';

const SNOWFLAKE = /^\d{17,20}$/;
const ROLES = new Set(['user', 'admin']);

class AccessControl {
  constructor({ store, adminRoleId, userRoleId }) {
    this.store = store;
    this.adminRoleId = '';
    this.userRoleId = '';
    if (adminRoleId || userRoleId) this.setRoleIds(adminRoleId, userRoleId);
  }

  setRoleIds(adminRoleId, userRoleId) {
    const admin = String(adminRoleId || '').trim();
    const user = String(userRoleId || '').trim();
    if (!SNOWFLAKE.test(admin) || !SNOWFLAKE.test(user) || admin === user) {
      throw new Error('Admin and User role IDs must be valid, different Discord role IDs.');
    }
    this.adminRoleId = admin;
    this.userRoleId = user;
  }

  isConfigured() {
    return SNOWFLAKE.test(this.adminRoleId) && SNOWFLAKE.test(this.userRoleId) && this.adminRoleId !== this.userRoleId;
  }

  async memberFor(userId) {
    return this.store.getAccess(String(userId));
  }

  roleFor(member) {
    if (!this.isConfigured()) return null;
    if (typeof member === 'string' || typeof member === 'number') return null;
    const roles = Array.isArray(member?.roles)
      ? member.roles.map(String)
      : member?.roles?.cache ? [...member.roles.cache.keys()].map(String) : [];
    if (roles.includes(this.adminRoleId)) return 'admin';
    if (roles.includes(this.userRoleId)) return 'user';
    return null;
  }

  async canUseWorker(userId, worker, discordRole) {
    if (discordRole === 'admin') return true;
    if (discordRole !== 'user') return false;
    const member = await this.memberFor(userId);
    if (!member || member.status === 'disabled') return false;
    if (!this.isEntitled(member)) return false;
    const assignedIds = Array.isArray(member.workerIds) ? member.workerIds : [];
    return assignedIds.includes(worker.workerId);
  }

  async workersFor(userId, workers, discordRole) {
    if (discordRole === 'admin') return workers;
    if (discordRole !== 'user') return [];
    const member = await this.memberFor(userId);
    if (!member || !this.isEntitled(member)) return [];
    return workers.filter((worker) => Array.isArray(member.workerIds) && member.workerIds.includes(worker.workerId));
  }

  isEntitled(member) {
    if (!member || member.status !== 'active') return false;
    return member.isPermanent === true || Boolean(member.expiresAt && Date.parse(member.expiresAt) > Date.now());
  }

  async grant(actorId, userId, options = {}, actorRole) {
    this.validateUserId(userId);
    if (actorRole !== 'admin') throw new Error('Only admins can manage users.');
    const role = String(options.role || 'user').toLowerCase();
    if (role !== 'user') throw new Error('Admin and user roles are managed by Discord server roles.');
    const workerIds = [...new Set((options.workerIds || []).map((id) => String(id).trim().toLowerCase()).filter(Boolean))];
    if (workerIds.some((id) => !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id))) throw new Error('One or more worker IDs are invalid.');

    let isPermanent = options.isPermanent === true;
    let expiresAt = options.expiresAt || null;
    if (role === 'admin') { isPermanent = true; expiresAt = null; }
    if (role === 'user' && !isPermanent) {
      const expiry = expiresAt ? new Date(expiresAt) : null;
      if (!expiry || Number.isNaN(expiry.getTime()) || expiry <= new Date()) throw new Error('Users need a future expiration date or permanent access.');
      expiresAt = expiry.toISOString();
    }

    return this.store.setAccess(userId, {
      role, workerIds, status: options.status === 'disabled' ? 'disabled' : 'active',
      isPermanent, expiresAt, planName: String(options.planName || (isPermanent ? 'Permanent' : 'Standard')).slice(0, 64),
      note: String(options.note || '').slice(0, 300), username: String(options.username || '').slice(0, 64)
    }, actorId);
  }

  async updateMember(actorId, userId, patch = {}, actorRole) {
    const current = await this.store.getAccess(userId);
    if (!current) throw new Error('User was not found.');
    return this.grant(actorId, userId, { ...current, ...patch, role: 'user' }, actorRole);
  }

  async revoke(actorId, userId, actorRole) {
    this.validateUserId(userId);
    if (actorRole !== 'admin') throw new Error('Only admins can manage users.');
    return this.store.removeAccess(userId);
  }

  validateUserId(userId) {
    if (!SNOWFLAKE.test(String(userId || ''))) throw new Error('Enter a valid Discord user ID.');
  }
}

module.exports = { AccessControl, ROLES, SNOWFLAKE };
