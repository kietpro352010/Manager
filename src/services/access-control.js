'use strict';

const SNOWFLAKE = /^\d{17,20}$/;
const ROLES = new Set(['user', 'admin']);

class AccessControl {
  constructor({ store, adminRoleId, userRoleId, adminUserId }) {
    this.store = store;
    this.adminRoleId = '';
    this.userRoleId = '';
    this.adminUserId = String(adminUserId || '').trim();
    if (adminRoleId || userRoleId) this.setRoleIds(adminRoleId, userRoleId);
  }

  setAdminUserId(adminUserId) {
    this.adminUserId = String(adminUserId || '').trim();
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

  roleFor(member, interaction = null) {
    const memberId = String(
      member?.id ||
      member?.user?.id ||
      interaction?.user?.id ||
      ''
    );

    // 1. Designated admin user ID (configured via env or /setup)
    if (this.adminUserId && memberId && memberId === this.adminUserId) return 'admin';

    // 2. Server Owner is always admin
    const guildOwnerId = String(member?.guild?.ownerId || interaction?.guild?.ownerId || '');
    if (guildOwnerId && memberId && memberId === guildOwnerId) return 'admin';

    // 3. User with Discord Administrator permission is always admin
    try {
      if (interaction?.memberPermissions) {
        if (interaction.memberPermissions.has('Administrator') || interaction.memberPermissions.has(8n)) {
          return 'admin';
        }
      }
    } catch (_) {}
    try {
      if (typeof member?.permissions?.has === 'function') {
        if (member.permissions.has('Administrator') || member.permissions.has(8n)) {
          return 'admin';
        }
      } else if (member?.permissions) {
        if (BigInt(member.permissions) & 8n) return 'admin';
      }
    } catch (_) {}

    if (!this.isConfigured()) return null;

    // 4. Role-based check
    const roles = Array.isArray(member?.roles)
      ? member.roles.map(String)
      : member?.roles?.cache ? [...member.roles.cache.keys()].map(String) : [];

    if (this.adminRoleId && roles.includes(this.adminRoleId)) return 'admin';
    if (this.userRoleId && roles.includes(this.userRoleId)) return 'user';
    return null;
  }

  isEntitled(member) {
    if (!member) return false;
    const status = String(member.status || 'active').toLowerCase();
    if (status !== 'active') return false;
    if (member.isPermanent === true) return true;
    if (!member.expiresAt) return true; // Null expiresAt with active status is treated as lifetime or unexpired
    const expiryTime = Date.parse(member.expiresAt);
    return Number.isFinite(expiryTime) && expiryTime > Date.now();
  }

  async canUseWorker(userId, worker, discordRole) {
    if (discordRole === 'admin') return true;
    if (discordRole !== 'user') return false;
    const member = await this.memberFor(userId);
    if (!member || member.status === 'disabled') return false;
    if (!this.isEntitled(member)) return false;
    const assignedIds = Array.isArray(member.workerIds) ? member.workerIds.map(String) : [];
    return assignedIds.includes(String(worker.workerId));
  }

  async workersFor(userId, workers, discordRole) {
    if (discordRole === 'admin') return workers;
    if (discordRole !== 'user') return [];
    const member = await this.memberFor(userId);
    if (!member || !this.isEntitled(member)) return [];
    const assignedIds = new Set(Array.isArray(member.workerIds) ? member.workerIds.map(String) : []);
    return workers.filter((worker) => assignedIds.has(String(worker.workerId)));
  }

  async grant(actorId, userId, options = {}, actorRole) {
    this.validateUserId(userId);
    if (actorRole !== 'admin') throw new Error('Only admins can manage users.');
    const role = String(options.role || 'user').toLowerCase();
    if (role !== 'user') throw new Error('Admin and user roles are managed by Discord server roles.');
    const workerIds = [...new Set((options.workerIds || []).map((id) => String(id).trim().toLowerCase()).filter(Boolean))];
    if (workerIds.some((id) => !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id))) throw new Error('One or more worker IDs are invalid.');

    const isPermanent = options.isPermanent !== undefined ? Boolean(options.isPermanent) : true;
    const expiresAt = isPermanent ? null : (options.expiresAt || null);

    return this.store.setAccess(userId, {
      role,
      workerIds,
      status: options.status === 'disabled' ? 'disabled' : 'active',
      isPermanent,
      expiresAt,
      planName: String(options.planName || 'Vĩnh viễn').slice(0, 64),
      note: String(options.note || '').slice(0, 300),
      username: String(options.username || '').slice(0, 64)
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
