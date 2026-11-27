'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const AsyncKeyLock = require('../../services/async-key-lock');
const {
  renderBotsList,
  renderBotDetail,
  renderBotLogs,
  renderAdminStatus,
  renderAdminBots,
  renderWispbyteList,
  renderWispbyteCheckResult,
  renderUnauthenticatedPanel,
  renderEntitlementBlockedPanel,
  renderAlreadyLoggedInPanel,
  renderLoggedOutPanel,
  buildLoginModal,
  formatAccountPlanBadge,
  resolveEffectiveExpiresAt,
  getWorkerState,
  safe,
  embed,
  button
} = require('../panels/renderer');
const {
  verifyUserPassword,
  verifyAdminPasswordAsync,
  hashAdminPasswordAsync,
  encryptUserPassword,
  isStoredCredentialCiphertext
} = require('../../utils/secrets');
const { getMaintenanceState } = require('../../utils/maintenance');

const panelControlLock = new AsyncKeyLock();
const resolvedUserCache = new WeakMap();
const resolvedGuildCache = new WeakMap();
const resolvedRolesCache = new WeakMap();
const resolvedMaintenanceCache = new WeakMap();

async function resolveInteractionMaintenance(services, interaction = null) {
  if (interaction && typeof interaction === 'object' && resolvedMaintenanceCache.has(interaction)) {
    return resolvedMaintenanceCache.get(interaction);
  }
  const maint = await getMaintenanceState(services?.accessStore || services?.store);
  if (interaction && typeof interaction === 'object') {
    resolvedMaintenanceCache.set(interaction, maint);
  }
  return maint;
}

async function resolveAllowedGuildId(services, interaction = null) {
  if (interaction && typeof interaction === 'object' && resolvedGuildCache.has(interaction)) {
    return resolvedGuildCache.get(interaction);
  }
  let resolved = '';
  if (services?.config?.discordGuildId && String(services.config.discordGuildId).trim()) {
    resolved = String(services.config.discordGuildId).trim();
  }
  if (!resolved) {
    const snap = services?.managerRuntimeSettings?.snapshot?.();
    if (snap && (snap.guildId || snap.discordGuildId)) {
      const id = String(snap.guildId || snap.discordGuildId).trim();
      if (id) resolved = id;
    }
  }
  if (!resolved) {
    try {
      const roleSettings = await services?.managerRuntimeSettings?.getRoleSettings?.();
      if (roleSettings?.guildId && String(roleSettings.guildId).trim()) {
        resolved = String(roleSettings.guildId).trim();
      }
    } catch (_) {}
  }
  if (!resolved) {
    try {
      const stored = await services?.accessStore?.getSetting?.('discord_access');
      if (stored?.guildId && String(stored.guildId).trim()) {
        resolved = String(stored.guildId).trim();
      }
    } catch (_) {}
  }
  if (interaction && typeof interaction === 'object') {
    resolvedGuildCache.set(interaction, resolved);
  }
  return resolved;
}

function isIgnorable(err) {
  if (!err) return false;
  const code = err.code || err.rawError?.code;
  const msg = String(err.message || '').toLowerCase();
  return code === 10062 || code === 40060 || msg.includes('unknown interaction') || msg.includes('already been acknowledged');
}

async function safeDeferUpdate(interaction) {
  if (interaction.deferred || interaction.replied) return;
  try {
    await interaction.deferUpdate();
  } catch (err) {
    if (!isIgnorable(err)) throw err;
  }
}

async function safeUpdate(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
    }
    return await interaction.update({ ...payload, allowedMentions: { parse: [] } });
  } catch (err) {
    if (isIgnorable(err)) return null;
    try {
      return await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } catch (fErr) {
      if (!isIgnorable(fErr)) throw fErr;
      return null;
    }
  }
}

async function safeReply(interaction, payload) {
  const safePayload = payload && typeof payload === 'object'
    ? { ...payload, allowedMentions: payload.allowedMentions || { parse: [] } }
    : payload;
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(safePayload);
    }
    return await interaction.reply(safePayload);
  } catch (err) {
    if (!isIgnorable(err)) throw err;
  }
}

// In-memory rate limiting map for panel buttons: userId -> timestamp
const userActionCooldown = new Map();
function checkCooldown(userId, cooldownMs = 800) {
  const now = Date.now();
  const last = userActionCooldown.get(userId) || 0;
  if (now - last < cooldownMs) return false;
  if (userActionCooldown.size >= 2000 && !userActionCooldown.has(userId)) {
    for (const [k, ts] of userActionCooldown.entries()) {
      if (now - ts > 60000) userActionCooldown.delete(k);
    }
    if (userActionCooldown.size >= 2000) {
      const oldest = userActionCooldown.keys().next().value;
      if (oldest !== undefined) userActionCooldown.delete(oldest);
    }
  }
  userActionCooldown.set(userId, now);
  return true;
}

// In-memory login rate limit map for Discord: discordUserId -> { count, windowStart }
const discordLoginAttempts = new Map();
function checkLoginRateLimit(discordUserId) {
  const now = Date.now();
  const record = discordLoginAttempts.get(discordUserId);
  if (!record || now - record.windowStart > 15 * 60 * 1000) {
    if (discordLoginAttempts.size >= 2000 && !discordLoginAttempts.has(discordUserId)) {
      for (const [k, val] of discordLoginAttempts.entries()) {
        if (now - val.windowStart > 15 * 60 * 1000) discordLoginAttempts.delete(k);
      }
      if (discordLoginAttempts.size >= 2000) {
        const oldest = discordLoginAttempts.keys().next().value;
        if (oldest !== undefined) discordLoginAttempts.delete(oldest);
      }
    }
    discordLoginAttempts.set(discordUserId, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (record.count >= 5) {
    const waitMins = Math.ceil((15 * 60 * 1000 - (now - record.windowStart)) / 60000);
    return { allowed: false, error: `Bạn đã đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${waitMins} phút.` };
  }
  record.count++;
  return { allowed: true };
}

function resetLoginRateLimit(discordUserId) {
  discordLoginAttempts.delete(discordUserId);
}

// Global per-username login rate limit map: lowerUsername -> { count, windowStart } (10 fails / 15 min)
const usernameLoginAttempts = new Map();
function isUsernameRateLimited(username) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return { allowed: true };
  const now = Date.now();
  const record = usernameLoginAttempts.get(key);
  if (!record || now - record.windowStart > 15 * 60 * 1000) {
    if (record) usernameLoginAttempts.delete(key);
    return { allowed: true };
  }
  if (record.count >= 10) {
    const waitMins = Math.ceil((15 * 60 * 1000 - (now - record.windowStart)) / 60000);
    return { allowed: false, error: `Tài khoản này đã bị thử đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${waitMins} phút.` };
  }
  return { allowed: true };
}

function recordUsernameFailedAttempt(username) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return;
  const now = Date.now();
  const record = usernameLoginAttempts.get(key);
  if (!record || now - record.windowStart > 15 * 60 * 1000) {
    if (usernameLoginAttempts.size >= 2000 && !usernameLoginAttempts.has(key)) {
      for (const [k, val] of usernameLoginAttempts.entries()) {
        if (now - val.windowStart > 15 * 60 * 1000) usernameLoginAttempts.delete(k);
      }
      if (usernameLoginAttempts.size >= 2000) {
        const oldest = usernameLoginAttempts.keys().next().value;
        if (oldest !== undefined) usernameLoginAttempts.delete(oldest);
      }
    }
    usernameLoginAttempts.set(key, { count: 1, windowStart: now });
  } else {
    record.count += 1;
  }
}

function resetUsernameRateLimit(username) {
  const key = String(username || '').trim().toLowerCase();
  if (key) usernameLoginAttempts.delete(key);
}

// Clean up stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of discordLoginAttempts.entries()) {
    if (now - val.windowStart > 15 * 60 * 1000) discordLoginAttempts.delete(key);
  }
  for (const [key, val] of usernameLoginAttempts.entries()) {
    if (now - val.windowStart > 15 * 60 * 1000) usernameLoginAttempts.delete(key);
  }
  for (const [key, time] of userActionCooldown.entries()) {
    if (now - time > 60000) userActionCooldown.delete(key);
  }
}, 10 * 60 * 1000).unref();

// Resolve authenticated user & verify admin
async function getEffectiveRoleIds(services, interaction = null) {
  if (interaction && typeof interaction === 'object' && resolvedRolesCache.has(interaction)) {
    return resolvedRolesCache.get(interaction);
  }
  let adminRoleId = services?.accessControl?.adminRoleId || services?.config?.adminRoleId || '';
  let userRoleId = services?.accessControl?.userRoleId || services?.config?.userRoleId || '';
  if (!adminRoleId || !userRoleId) {
    const snap = services?.managerRuntimeSettings?.snapshot?.();
    if (snap) {
      if (!adminRoleId && (snap.adminRoleId || snap.discordAdminRoleId)) {
        adminRoleId = String(snap.adminRoleId || snap.discordAdminRoleId).trim();
      }
      if (!userRoleId && (snap.userRoleId || snap.discordUserRoleId)) {
        userRoleId = String(snap.userRoleId || snap.discordUserRoleId).trim();
      }
    }
  }
  if (!adminRoleId || !userRoleId) {
    try {
      const stored = await services?.accessStore?.getSetting?.('discord_access');
      if (stored) {
        if (!adminRoleId && stored.adminRoleId) adminRoleId = String(stored.adminRoleId).trim();
        if (!userRoleId && stored.userRoleId) userRoleId = String(stored.userRoleId).trim();
      }
    } catch (_) {}
  }
  const result = { adminRoleId, userRoleId };
  if (interaction && typeof interaction === 'object') {
    resolvedRolesCache.set(interaction, result);
  }
  return result;
}

async function addMemberRole(interaction, roleId) {
  if (!interaction?.guild || !roleId) return false;
  try {
    let member = interaction.member;
    if (!member?.roles?.add && interaction.guild.members?.fetch) {
      member = await interaction.guild.members.fetch(interaction.user?.id).catch(() => null);
    }
    if (member?.roles?.add) {
      await member.roles.add(roleId);
      return true;
    }
  } catch (err) {
    console.warn(`[DISCORD] Không thể cấp role ${roleId}:`, err.message);
  }
  return false;
}

async function removeMemberRole(interaction, roleId) {
  if (!interaction?.guild || !roleId) return false;
  try {
    let member = interaction.member;
    if (!member?.roles?.remove && interaction.guild.members?.fetch) {
      member = await interaction.guild.members.fetch(interaction.user?.id).catch(() => null);
    }
    if (member?.roles?.remove) {
      const inspectableRoles = Array.isArray(member?.roles)
        ? member.roles.map(String)
        : (member?.roles?.cache
          ? [...member.roles.cache.keys()].map(String)
          : (Array.isArray(member?._roles) ? member._roles.map(String) : null));
      if (inspectableRoles && !inspectableRoles.includes(String(roleId))) {
        return false;
      }
      await member.roles.remove(roleId);
      return true;
    }
  } catch (err) {
    console.warn(`[DISCORD] Không thể gỡ role ${roleId}:`, err.message);
  }
  return false;
}

async function hasAuthorizedRole(interaction, services) {
  if (!interaction?.guildId) return false;
  const userId = interaction?.user?.id;
  if (!userId) return false;

  // 1. Configured Admin User ID
  if (services?.config?.adminUserId && services.config.adminUserId === userId) return true;
  if (services?.accessControl?.adminUserId && services.accessControl.adminUserId === userId) return true;

  // Enforce allowed guild fail-closed before checking setup roles (never guild ownership or raw permissions)
  const allowedGuildId = await resolveAllowedGuildId(services, interaction);
  if (!allowedGuildId || interaction.guildId !== allowedGuildId) {
    return false;
  }

  // 2. Resolve configured role IDs
  const { adminRoleId, userRoleId } = await getEffectiveRoleIds(services, interaction);

  // If neither role is configured yet inside the allowed guild, allow interactions (initial unconfigured setup state)
  if (!adminRoleId && !userRoleId) return true;

  // 3. Check member roles
  let member = interaction?.member;
  if (!member?.roles?.cache && !Array.isArray(member?.roles) && interaction.guild?.members?.fetch) {
    member = await interaction.guild.members.fetch(userId).catch(() => null);
  }
  const memberRoles = Array.isArray(member?.roles)
    ? member.roles.map(String)
    : member?.roles?.cache ? [...member.roles.cache.keys()].map(String) : [];

  if (adminRoleId && memberRoles.includes(String(adminRoleId))) return true;
  if (userRoleId && memberRoles.includes(String(userRoleId))) return true;

  return false;
}

// Resolve authenticated user & verify admin
async function resolveLinkedUser(interaction, services) {
  if (!interaction?.guildId) return null;
  const discordUserId = interaction.user?.id;
  if (!discordUserId) return null;

  if (resolvedUserCache.has(interaction)) {
    return resolvedUserCache.get(interaction);
  }

  const allowedGuildId = await resolveAllowedGuildId(services, interaction);
  const isAllowedGuild = Boolean(allowedGuildId && interaction.guildId === allowedGuildId);
  const { adminRoleId: effectiveAdminRoleId } = await getEffectiveRoleIds(services, interaction);

  // 1. Strictly recognize admin ONLY via configured Admin Discord User ID or configured Admin Role in allowed guild
  const configuredAdminUserId = String(services?.config?.adminUserId || services?.accessControl?.adminUserId || '').trim();
  const isConfiguredAdmin = Boolean(
    (services?.config?.adminUserId && services.config.adminUserId === discordUserId) ||
    (services?.accessControl?.adminUserId && services.accessControl.adminUserId === discordUserId)
  );
  const memberRoles = Array.isArray(interaction?.member?.roles)
    ? interaction.member.roles.map(String)
    : interaction?.member?.roles?.cache
      ? [...interaction.member.roles.cache.keys()].map(String)
      : (Array.isArray(interaction?.member?._roles) ? interaction.member._roles.map(String) : []);
  const hasAdminRole = Boolean(isAllowedGuild && (
    services?.accessControl?.roleFor?.(interaction.member, interaction) === 'admin' ||
    (effectiveAdminRoleId && memberRoles.includes(String(effectiveAdminRoleId)))
  ));
  const qualifiesAsDiscordAdmin = isConfiguredAdmin || hasAdminRole;
  const hasDiscordAdminConfig = Boolean(configuredAdminUserId || effectiveAdminRoleId);

  // 2. Check if user is linked to a Web Manager account
  const linked = await services?.accessStore?.getUserByDiscordId?.(discordUserId);
  let resolved = null;
  if (linked) {
    if (String(linked.status || '').toLowerCase() === 'disabled') {
      resolved = null;
    } else if (linked.role === 'admin' && hasDiscordAdminConfig && !qualifiesAsDiscordAdmin) {
      resolved = null;
    } else {
      resolved = qualifiesAsDiscordAdmin && linked.role !== 'admin'
        ? { ...linked, role: 'admin', isPermanent: true }
        : linked;
    }
  } else if (qualifiesAsDiscordAdmin) {
    resolved = {
      userId: 'admin',
      username: 'Enterprise Admin',
      role: 'admin',
      assignedBotIds: null,
      isPermanent: true
    };
  }

  resolvedUserCache.set(interaction, resolved);
  return resolved;
}

function resolvePublicBaseUrl(services) {
  const { DEFAULT_PUBLIC_MANAGER_URL } = require('../../config/host-runtime');
  const raw = String(
    services?.config?.publicBaseUrl ||
    services?.managerRuntimeSettings?.snapshot?.()?.publicBaseUrl ||
    services?.managerRuntimeSettings?.getActiveManagerUrls?.()?.[0] ||
    DEFAULT_PUBLIC_MANAGER_URL
  ).trim();
  return raw.startsWith('http') ? raw : '';
}

function isUserAccountEntitled(user, services, maintenance = null) {
  if (!user) return false;
  if (String(user.role || '').toLowerCase() === 'admin') return true;
  const rawExp = user.expiresAt || user.expiresAtRental || null;
  const effectiveExp = resolveEffectiveExpiresAt(rawExp, maintenance);
  const normalizedUser = { ...user, expiresAt: effectiveExp };
  if (services?.accessControl?.isEntitled) {
    return Boolean(services.accessControl.isEntitled(normalizedUser));
  }
  const statusStr = String(normalizedUser.status || 'active').toLowerCase();
  if (statusStr === 'disabled' || statusStr === 'expired') return false;
  if (normalizedUser.isPermanent === true) return true;
  if (normalizedUser.inGracePeriod === true) return true;
  const expiryMs = normalizedUser.expiresAt ? Date.parse(normalizedUser.expiresAt) : NaN;
  if (statusStr === 'grace_period' && Number.isFinite(expiryMs)) {
    const rawAnchor = maintenance?.enabled
      ? (maintenance.lastCompensatedAt || maintenance.startedAt || maintenance.updatedAt || '')
      : '';
    const anchorMs = rawAnchor ? Date.parse(rawAnchor) : NaN;
    const nowMs = Date.now();
    const baseGraceEndMs = expiryMs + 6 * 3600 * 1000;
    const effectiveGraceEndMs = (maintenance?.enabled && Number.isFinite(anchorMs) && nowMs > anchorMs && baseGraceEndMs > anchorMs)
      ? baseGraceEndMs + (nowMs - anchorMs)
      : baseGraceEndMs;
    return effectiveGraceEndMs > nowMs;
  }
  return Number.isFinite(expiryMs) && expiryMs > Date.now();
}

async function syncDiscordMemberRolesForUser(interaction, user, services, maintenance = null) {
  if (!interaction?.guild || !user || !services) return '';
  const { adminRoleId, userRoleId } = await getEffectiveRoleIds(services, interaction);
  if (!adminRoleId && !userRoleId) return '';

  const effectiveMaintenance = maintenance || await resolveInteractionMaintenance(services, interaction).catch(() => null);

  const memberRoles = Array.isArray(interaction?.member?.roles)
    ? interaction.member.roles.map(String)
    : interaction?.member?.roles?.cache
      ? [...interaction.member.roles.cache.keys()].map(String)
      : (Array.isArray(interaction?.member?._roles) ? interaction.member._roles.map(String) : []);

  const isAdmin = String(user.role || '').toLowerCase() === 'admin';
  if (isAdmin) {
    const configuredAdminUserId = String(services?.config?.adminUserId || services?.accessControl?.adminUserId || '').trim();
    const isCfgAdmin = Boolean(configuredAdminUserId && configuredAdminUserId === String(interaction.user?.id || ''));
    if (adminRoleId && (!configuredAdminUserId || isCfgAdmin) && !memberRoles.includes(String(adminRoleId))) {
      const added = await addMemberRole(interaction, adminRoleId);
      if (userRoleId && !memberRoles.includes(String(userRoleId))) {
        await addMemberRole(interaction, userRoleId).catch(() => null);
      }
      if (added) return `• **Role Discord:** <@&${adminRoleId}> *(Đã tự động đồng bộ lại)*`;
    }
    return adminRoleId && memberRoles.includes(String(adminRoleId))
      ? `• **Role Discord:** <@&${adminRoleId}>`
      : '';
  }

  if (!userRoleId) return '';
  const entitled = isUserAccountEntitled(user, services, effectiveMaintenance);
  const hasUserRole = memberRoles.includes(String(userRoleId));

  if (entitled && !hasUserRole) {
    const added = await addMemberRole(interaction, userRoleId);
    return added
      ? `• **Role Discord:** <@&${userRoleId}> *(Đã tự động cấp lại)*`
      : `• **Role Discord:** <@&${userRoleId}> *(Bot chưa đủ quyền gán role)*`;
  }
  if (!entitled && hasUserRole) {
    const removed = await removeMemberRole(interaction, userRoleId);
    if (removed) {
      return `• **Role Discord:** *(Đã thu hồi <@&${userRoleId}> do gói hết hạn hoặc bị khóa)*`;
    }
  }
  if (entitled && hasUserRole) {
    return `• **Role Discord:** <@&${userRoleId}>`;
  }
  return '';
}

async function resolveActiveDiscordAccountLink(discordUserId, services) {
  const uid = String(discordUserId || '').trim();
  if (!uid || !services?.accessStore) return null;

  if (typeof services.accessStore.getUserByDiscordId === 'function') {
    const linkedUser = await services.accessStore.getUserByDiscordId(uid, { bypassCache: true });
    if (linkedUser && linkedUser.username) {
      return linkedUser;
    }
  }

  if (typeof services.accessStore.getDiscordLink === 'function') {
    const rawLink = await services.accessStore.getDiscordLink(uid);
    if (rawLink && rawLink.username) {
      const uname = String(rawLink.username).trim();
      if (uname.toLowerCase() === 'admin') {
        return {
          id: 'admin',
          userId: 'admin',
          username: 'admin',
          role: 'admin',
          status: 'active',
          isPermanent: true,
          discordUserId: uid
        };
      }
      if (typeof services.accessStore.getUser === 'function') {
        const user = await services.accessStore.getUser(uname, { bypassCache: true });
        if (user) return user;
        // Orphaned link row whose Web user was deleted -> clean up automatically so /login is not blocked
        if (typeof services.accessStore.unlinkDiscord === 'function') {
          await services.accessStore.unlinkDiscord(uid).catch(() => null);
        }
        return null;
      }
      return {
        userId: rawLink.manager_user_id || uname,
        username: uname,
        role: 'user',
        status: 'active',
        discordUserId: uid
      };
    }
  }

  return null;
}

async function performDiscordLogout(interaction, services) {
  const discordUserId = String(interaction?.user?.id || '').trim();
  if (interaction && typeof interaction === 'object') {
    resolvedUserCache.delete(interaction);
  }
  const store = services?.accessStore;
  const checkedExisting = Boolean(
    store && (typeof store.getUserByDiscordId === 'function' || typeof store.getDiscordLink === 'function')
  );
  let existingUser = null;
  if (checkedExisting && discordUserId) {
    existingUser = await resolveActiveDiscordAccountLink(discordUserId, services).catch(() => null);
  }

  const wasLoggedIn = Boolean(existingUser);
  const unlinkedUsername = existingUser?.username ? String(existingUser.username) : '';

  if (discordUserId && typeof store?.unlinkDiscord === 'function' && (!checkedExisting || wasLoggedIn)) {
    await store.unlinkDiscord(discordUserId);
  }
  if (discordUserId) {
    try { require('./points-message-handler').clearMessagePointsLoginCache(discordUserId); } catch (_) {}
  }

  const removedRoles = [];
  if (services && interaction) {
    const { adminRoleId, userRoleId } = await getEffectiveRoleIds(services, interaction);
    if (userRoleId) {
      const ok = await removeMemberRole(interaction, userRoleId);
      if (ok) removedRoles.push(`<@&${userRoleId}>`);
    }
    if (adminRoleId) {
      const ok = await removeMemberRole(interaction, adminRoleId);
      if (ok) removedRoles.push(`<@&${adminRoleId}>`);
    }
  }

  if (!checkedExisting || wasLoggedIn || removedRoles.length > 0) {
    await store?.addAudit?.({
      action: 'DISCORD_LOGOUT',
      actorId: discordUserId,
      targetId: existingUser?.userId || existingUser?.id || discordUserId,
      details: {
        guildId: interaction?.guildId || null,
        ...(unlinkedUsername ? { username: unlinkedUsername } : {})
      }
    }).catch(() => null);
  }

  return { checkedExisting, wasLoggedIn, unlinkedUsername, removedRoles };
}

// Strict ownership check (Backend Authorization Guard)
function checkBotOwnership(user, workerId, worker = null, allWorkers = null) {
  if (!user || !workerId) return false;
  if (user.role === 'admin') return true;

  const targetId = String(workerId).trim().toLowerCase();
  const assigned = Array.isArray(user.assignedBotIds)
    ? user.assignedBotIds.map((id) => String(id).trim().toLowerCase()).filter(Boolean)
    : [];

  if (assigned.includes(targetId)) return true;
  const botNum = Number(worker?.botNumber);
  if (Number.isInteger(botNum) && botNum > 0) {
    const botNumStr = String(botNum);
    if (assigned.includes(botNumStr)) {
      if (/^\d+$/.test(targetId) && Number(targetId) !== botNum) return false;
      if (Array.isArray(allWorkers) && allWorkers.some((w) => w && String(w.workerId || '').trim().toLowerCase() === botNumStr && String(w.workerId || '').trim().toLowerCase() !== targetId)) {
        return false;
      }
      return true;
    }
  }

  return false;
}

// Get user's accessible bots
async function getUserBots(user, services, maintenance = null) {
  if (!user || typeof services?.registry?.list !== 'function') return [];
  const allWorkers = await services.registry.list();
  if (user.role === 'admin') return allWorkers;

  if (services?.accessControl?.isEntitled) {
    const rawExp = user.expiresAt || user.expiresAtRental || null;
    const normalizedUser = { ...user, expiresAt: resolveEffectiveExpiresAt(rawExp, maintenance) };
    if (!services.accessControl.isEntitled(normalizedUser)) {
      return [];
    }
  }

  return allWorkers.filter((w) => checkBotOwnership(user, w.workerId, w, allWorkers));
}

async function handlePanelInteraction(interaction, services) {
  // Reject DM interactions unconditionally and enforce allowed guild fail-closed (DISCORD-01)
  if (!interaction?.guildId) {
    await safeReply(interaction, {
      content: 'This manager is available only in its configured Discord server (DMs are not supported).',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const effectiveGuildId = await resolveAllowedGuildId(services, interaction);
  if (!effectiveGuildId || interaction.guildId !== effectiveGuildId) {
    await safeReply(interaction, {
      content: 'This manager is available only in its configured Discord server.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const discordUserId = interaction.user?.id;

  // --------------------------------------------------------------------------
  // A. MODAL SUBMIT: /login
  // --------------------------------------------------------------------------
  if (interaction.isModalSubmit() && interaction.customId === 'login_modal') {
    if (interaction.deferred || interaction.replied) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const alreadyLinked = await resolveActiveDiscordAccountLink(discordUserId, services).catch(() => null);
    if (alreadyLinked) {
      const maint = await resolveInteractionMaintenance(services, interaction).catch(() => null);
      const roleSyncNote = await syncDiscordMemberRolesForUser(interaction, alreadyLinked, services, maint).catch(() => '');
      return safeReply(interaction, renderAlreadyLoggedInPanel({
        user: alreadyLinked,
        discordUserId,
        roleSyncNote,
        publicBaseUrl: resolvePublicBaseUrl(services),
        maintenance: maint
      }));
    }

    const rate = checkLoginRateLimit(discordUserId);
    if (!rate.allowed) {
      await services?.accessStore?.addAudit?.({
        action: 'DISCORD_LOGIN_RATE_LIMITED',
        actorId: discordUserId,
        targetId: discordUserId,
        details: { scope: 'discord_user', guildId: interaction.guildId }
      }).catch(() => null);
      return safeReply(interaction, {
        embeds: [embed('⛔ ĐĂNG NHẬP BỊ GIỚI HẠN', rate.error, 0xef4444)]
      });
    }

    const cleanUsername = String(interaction.fields.getTextInputValue('login_username') || '').trim();
    const cleanPassword = String(interaction.fields.getTextInputValue('login_password') || '');

    if (!cleanUsername || !cleanPassword) {
      return safeReply(interaction, {
        embeds: [embed('❌ LỖI', 'Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu.', 0xef4444)]
      });
    }

    const userRate = isUsernameRateLimited(cleanUsername);
    if (!userRate.allowed) {
      await services?.accessStore?.addAudit?.({
        action: 'DISCORD_LOGIN_RATE_LIMITED',
        actorId: discordUserId,
        targetId: cleanUsername.toLowerCase(),
        details: { scope: 'username', guildId: interaction.guildId }
      }).catch(() => null);
      return safeReply(interaction, {
        embeds: [embed('⛔ ĐĂNG NHẬP BỊ GIỚI HẠN', userRate.error, 0xef4444)]
      });
    }

    // 1. Check Admin Login
    const adminUsername = String(services.config.adminUsername || 'admin').trim();
    if (cleanUsername.toLowerCase() === adminUsername.toLowerCase()) {
      let storedAdminPass = services.registry?.getAdminPassword?.() || '';
      if (typeof services?.accessStore?.getSetting === 'function') {
        try {
          const remoteCreds = await services.accessStore.getSetting('admin_credentials', { bypassCache: true });
          if (remoteCreds?.passwordHash && typeof remoteCreds.passwordHash === 'string') {
            storedAdminPass = remoteCreds.passwordHash;
            if (typeof services.registry?.setAdminPassword === 'function') {
              services.registry.setAdminPassword(storedAdminPass);
            }
          }
        } catch (_) {}
      }
      if (!storedAdminPass) {
        storedAdminPass = services.config.adminPassword;
      }
      if (storedAdminPass && await verifyAdminPasswordAsync(cleanPassword, storedAdminPass)) {
        resetLoginRateLimit(discordUserId);
        resetUsernameRateLimit(cleanUsername);
        try {
          await services.accessStore.linkDiscord(discordUserId, 'admin', 'admin');
        } catch (linkErr) {
          return safeReply(interaction, {
            embeds: [
              embed(
                '⚠️ KHÔNG THỂ LIÊN KẾT TÀI KHOẢN',
                linkErr?.message || 'Tài khoản Quản trị viên này hiện đã được liên kết với một tài khoản Discord khác.',
                0xf59e0b
              )
            ]
          });
        }
        try { require('./points-message-handler').clearMessagePointsLoginCache(discordUserId); } catch (_) {}
        await services.accessStore?.addAudit?.({
          action: 'DISCORD_LOGIN_SUCCESS',
          actorId: discordUserId,
          targetId: 'admin',
          details: { role: 'admin', guildId: interaction.guildId }
        }).catch(() => null);

        const { adminRoleId, userRoleId } = await getEffectiveRoleIds(services);
        let roleInfo = '';
        if (adminRoleId) {
          const added = await addMemberRole(interaction, adminRoleId);
          if (userRoleId) await addMemberRole(interaction, userRoleId).catch(() => null);
          roleInfo = added
            ? `\n• **Role Discord:** <@&${adminRoleId}> (Đã cấp)`
            : `\n• **Role Discord:** <@&${adminRoleId}> *(Bot chưa đủ quyền gán role)*`;
        }

        const publicBaseUrl = resolvePublicBaseUrl(services);
        const adminQuickRow = new ActionRowBuilder().addComponents(
          button('Mở danh sách Bot', 'bots:list', ButtonStyle.Primary, false, '🤖'),
          button('Tổng quan Admin', 'admin:status', ButtonStyle.Secondary, false, '🛡️')
        );
        if (publicBaseUrl) {
          adminQuickRow.addComponents(
            new ButtonBuilder()
              .setLabel('Web Dashboard')
              .setStyle(ButtonStyle.Link)
              .setURL(publicBaseUrl)
              .setEmoji('🌐')
          );
        }
        adminQuickRow.addComponents(
          button('Đăng xuất', `login:logout:${discordUserId}`, ButtonStyle.Danger, false, '🚪')
        );

        return safeReply(interaction, {
          embeds: [
            embed(
              '✅ ĐĂNG NHẬP THÀNH CÔNG',
              `Đã liên kết Discord với tài khoản **Quản trị viên (ADMIN)**.\n\n` +
              `• **Tài khoản:** \`${cleanUsername}\`\n` +
              `• **Phân quyền:** \`Enterprise Administrator\`${roleInfo}\n\n` +
              `👉 Chọn nhanh thao tác bên dưới hoặc dùng \`/bots\`, \`/check\`.`,
              0x22c55e
            )
          ],
          components: [adminQuickRow]
        });
      }
      recordUsernameFailedAttempt(cleanUsername);
      await services.accessStore?.addAudit?.({
        action: 'DISCORD_LOGIN_FAILED',
        actorId: discordUserId,
        targetId: cleanUsername.toLowerCase(),
        details: { reason: 'invalid_admin_password', guildId: interaction.guildId }
      }).catch(() => null);
      return safeReply(interaction, {
        embeds: [embed('❌ ĐĂNG NHẬP THẤT BẠI', 'Tên đăng nhập hoặc mật khẩu không chính xác.', 0xef4444)]
      });
    }

    // 2. Check Regular User Login
    const user = await services.accessStore.getUser(cleanUsername, { bypassCache: true });
    if (!user) {
      recordUsernameFailedAttempt(cleanUsername);
      await services.accessStore?.addAudit?.({
        action: 'DISCORD_LOGIN_FAILED',
        actorId: discordUserId,
        targetId: cleanUsername.toLowerCase(),
        details: { reason: 'user_not_found', guildId: interaction.guildId }
      }).catch(() => null);
      return safeReply(interaction, {
        embeds: [embed('❌ ĐĂNG NHẬP THẤT BẠI', 'Tên đăng nhập hoặc mật khẩu không chính xác.', 0xef4444)]
      });
    }

    const storedCredential = user.password || user._rawEncryptedPassword || '';
    const encKey = services.config?.encryptionKey || services.registry?.encryptionKey;
    const passMatch = verifyUserPassword(cleanPassword, storedCredential, encKey);
    if (!passMatch) {
      recordUsernameFailedAttempt(cleanUsername);
      await services.accessStore?.addAudit?.({
        action: 'DISCORD_LOGIN_FAILED',
        actorId: discordUserId,
        targetId: user.id || user.userId || cleanUsername.toLowerCase(),
        details: { reason: 'invalid_password', guildId: interaction.guildId }
      }).catch(() => null);
      return safeReply(interaction, {
        embeds: [embed('❌ ĐĂNG NHẬP THẤT BẠI', 'Tên đăng nhập hoặc mật khẩu không chính xác.', 0xef4444)]
      });
    }

    if (String(user.status || '').toLowerCase() === 'disabled') {
      await services.accessStore?.addAudit?.({
        action: 'DISCORD_LOGIN_BLOCKED_DISABLED',
        actorId: discordUserId,
        targetId: user.id || user.userId || cleanUsername.toLowerCase(),
        details: { guildId: interaction.guildId }
      }).catch(() => null);
      return safeReply(interaction, {
        embeds: [embed('⛔ TÀI KHOẢN BỊ KHÓA', 'Tài khoản của bạn đã bị vô hiệu hóa bởi Quản trị viên.', 0xef4444)]
      });
    }

    // Auto-migrate legacy scrypt$/plaintext user password to reversible AES-256-GCM
    const rawCredential = String(user._rawEncryptedPassword || user.password || '');
    if (encKey && rawCredential && !isStoredCredentialCiphertext(rawCredential) && typeof services.accessStore?.setAccess === 'function') {
      try {
        await services.accessStore.setAccess(user.id || user.userId || user.username, {
          ...user,
          password: encryptUserPassword(cleanPassword, encKey)
        });
      } catch (_) {}
    }

    resetLoginRateLimit(discordUserId);
    resetUsernameRateLimit(cleanUsername);
    const canonicalUserId = user.id || user.userId || user.username;
    try {
      await services.accessStore.linkDiscord(discordUserId, user.username, canonicalUserId);
    } catch (linkErr) {
      return safeReply(interaction, {
        embeds: [
          embed(
            '⚠️ KHÔNG THỂ LIÊN KẾT TÀI KHOẢN',
            linkErr?.message || 'Tài khoản Web này đã được liên kết với một tài khoản Discord khác. Vui lòng dùng `/logout` trên tài khoản Discord cũ hoặc liên hệ Admin hỗ trợ.',
            0xf59e0b
          )
        ]
      });
    }
    try { require('./points-message-handler').clearMessagePointsLoginCache(discordUserId); } catch (_) {}
    await services.accessStore?.recordUserLogin?.(canonicalUserId, null).catch(() => null);
    await services.accessStore?.addAudit?.({
      action: 'DISCORD_LOGIN_SUCCESS',
      actorId: discordUserId,
      targetId: canonicalUserId,
      details: { username: user.username, guildId: interaction.guildId }
    }).catch(() => null);

    // Never grant userRoleId to expired/unentitled users (DISCORD-03)
    const loginMaint = await resolveInteractionMaintenance(services, interaction).catch(() => null);
    const normalizedUser = { ...user, expiresAt: user.expiresAt || user.expiresAtRental || null };
    const isUserEntitled = isUserAccountEntitled(normalizedUser, services, loginMaint);

    const { adminRoleId, userRoleId } = await getEffectiveRoleIds(services);
    const targetRoleId = user.role === 'admin' ? (adminRoleId || userRoleId) : userRoleId;
    let roleInfo = '';
    if (targetRoleId && isUserEntitled) {
      const added = await addMemberRole(interaction, targetRoleId);
      roleInfo = added
        ? `\n• **Role Discord:** <@&${targetRoleId}> (Đã cấp)`
        : `\n• **Role Discord:** <@&${targetRoleId}> *(Bot chưa đủ quyền gán role)*`;
    } else if (targetRoleId && !isUserEntitled) {
      roleInfo = '\n• **Role Discord:** *(Không cấp — gói dịch vụ đã hết hạn hoặc chưa kích hoạt)*';
    }

    const publicBaseUrl = resolvePublicBaseUrl(services);
    const userQuickRow = new ActionRowBuilder();
    if (isUserEntitled) {
      userQuickRow.addComponents(
        button('Mở danh sách Bot', 'bots:list', ButtonStyle.Primary, false, '🤖')
      );
    }
    if (services?.discordPoints) {
      userQuickRow.addComponents(
        button('Điểm danh (+10đ)', `points:quick_checkin:${discordUserId}`, ButtonStyle.Success, false, '📅')
      );
    }
    if (publicBaseUrl) {
      userQuickRow.addComponents(
        new ButtonBuilder()
          .setLabel(isUserEntitled ? 'Web Dashboard' : 'Gia hạn trên Web')
          .setStyle(ButtonStyle.Link)
          .setURL(publicBaseUrl)
          .setEmoji('🌐')
      );
    }
    userQuickRow.addComponents(
      button('Đăng xuất', `login:logout:${discordUserId}`, ButtonStyle.Danger, false, '🚪')
    );

    const rawExpiry = normalizedUser.expiresAt;
    const frozenLoginBadge = loginMaint?.enabled ? formatAccountPlanBadge(normalizedUser, loginMaint) : '';
    const expiryLabel = normalizedUser.isPermanent
      ? 'Vĩnh viễn'
      : (frozenLoginBadge && isUserEntitled
        ? `${frozenLoginBadge} *(không trừ giờ khi bảo trì)*`
        : (rawExpiry ? new Date(rawExpiry).toLocaleDateString('vi-VN') : '—'));

    return safeReply(interaction, {
      embeds: [
        embed(
          '✅ ĐĂNG NHẬP THÀNH CÔNG',
          `Đã liên kết tài khoản Discord <@${discordUserId}> với Web Manager.\n\n` +
          `• **Tài khoản Web:** **${user.username}**\n` +
          `• **Gói dịch vụ:** ${user.planName || 'Gói tiêu chuẩn'}\n` +
          `• **Hạn sử dụng:** ${expiryLabel}${roleInfo}\n\n` +
          (isUserEntitled
            ? `👉 Bấm **Mở danh sách Bot** bên dưới (hoặc gõ \`/bots\`) để theo dõi và điều khiển bot ngay.`
            : `👉 Gói bot hiện chưa còn hạn — bạn vẫn có thể tích điểm cộng đồng (\`/diemdanh\`, \`/bxh\`) hoặc gia hạn trên Web Manager.`),
          0x22c55e
        )
      ],
      components: [userQuickRow]
    });
  }

  // --------------------------------------------------------------------------
  // A2. MODAL SUBMIT: /admin password (SEC-07: hidden modal input)
  // --------------------------------------------------------------------------
  if (interaction.isModalSubmit() && interaction.customId === 'admin_password_modal') {
    if (interaction.deferred || interaction.replied) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { isSuperAdmin } = require('./interaction-handler');
    if (!isSuperAdmin(interaction, services, effectiveGuildId)) {
      return safeReply(interaction, {
        embeds: [embed('⛔ TỪ CHỐI TRUY CẬP', 'Chỉ Admin được gán biến môi trường hoặc có Admin Role đã thiết lập mới có quyền đổi mật khẩu quản trị viên.', 0xef4444)]
      });
    }

    const newPassword = String(interaction.fields.getTextInputValue('new_password') || '');
    if (!newPassword || newPassword.length < 6 || newPassword.length > 256) {
      return safeReply(interaction, {
        embeds: [embed('❌ LỖI', 'Mật khẩu quản trị viên phải dài từ 6 đến 256 ký tự.', 0xef4444)]
      });
    }

    const hashed = await hashAdminPasswordAsync(newPassword);
    if (services.accessStore && typeof services.accessStore.setSetting === 'function') {
      await services.accessStore.setSetting('admin_credentials', {
        passwordHash: hashed,
        updatedAt: new Date().toISOString()
      });
    }
    if (typeof services.registry?.setAdminPassword === 'function') {
      services.registry.setAdminPassword(hashed);
    }
    if (typeof services.accessStore?.unlinkDiscord === 'function') {
      await services.accessStore.unlinkDiscord('admin').catch(() => null);
    }
    if (typeof services.accessStore?.adapter?.revokeAdminSessions === 'function') {
      await services.accessStore.adapter.revokeAdminSessions().catch(() => null);
    } else if (typeof services.accessStore?.adapter?.revokeUserSessions === 'function') {
      await services.accessStore.adapter.revokeUserSessions('admin').catch(() => null);
    }
    if (typeof services.invalidateAdminSessions === 'function') {
      services.invalidateAdminSessions();
    }
    await services.accessStore?.addAudit?.({
      action: 'DISCORD_ADMIN_PASSWORD_CHANGED',
      actorId: discordUserId,
      targetId: 'admin',
      details: { via: 'discord_modal', guildId: interaction.guildId }
    }).catch(() => null);

    return safeReply(interaction, {
      embeds: [
        embed(
          '✅ ĐỔI MẬT KHẨU ADMIN THÀNH CÔNG',
          'Đã cập nhật mật khẩu cho tài khoản Quản trị viên Web (`admin`). Bạn có thể dùng mật khẩu mới này để đăng nhập vào Web Dashboard ngay lập tức.',
          0x22c55e
        )
      ]
    });
  }

  // --------------------------------------------------------------------------
  // B. BUTTONS & SELECT MENUS
  // --------------------------------------------------------------------------
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  const customId = interaction.customId || '';

  // Handle noop button click (e.g. page counter)
  if (customId === 'bots:noop') {
    return safeDeferUpdate(interaction);
  }

  // 0. Status Monitor Refresh (Admin Only, Public View)
  if (customId === 'status_monitor:refresh') {
    const { isUserAdmin } = require('./interaction-handler');
    let isAdmin = isUserAdmin(interaction, services, null, effectiveGuildId);
    if (!isAdmin && services?.accessStore?.getUserByDiscordId && typeof resolveLinkedUser === 'function') {
      const user = await resolveLinkedUser(interaction, services).catch(() => null);
      isAdmin = isUserAdmin(interaction, services, user, effectiveGuildId);
    }

    if (!isAdmin) {
      if (interaction.deferred || interaction.replied) return;
      return safeReply(interaction, {
        content: '⛔ Chỉ Quản trị viên (Admin) mới có quyền làm mới bảng theo dõi hệ thống.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (!checkCooldown(discordUserId, 1500)) {
      return safeDeferUpdate(interaction);
    }

    await safeDeferUpdate(interaction);
    const { collectSystemStatus } = require('../status-monitor');
    const { renderStatusMonitorPanel } = require('../panels/renderer');
    const statusData = await collectSystemStatus(services, {
      intervalMs: services?.statusMonitor?.intervalMs || 15 * 60 * 1000
    });
    if (interaction.channelId && interaction.message?.id) {
      const tracked = {
        guildId: interaction.guildId || null,
        channelId: interaction.channelId,
        messageId: interaction.message.id,
        updatedAt: statusData.checkedAt || new Date().toISOString()
      };
      services?.accessStore?.setSetting?.('discord_status_monitor', tracked).catch(() => null);
      services?.statusMonitor?.setTrackedMessage?.(tracked);
    }
    const view = renderStatusMonitorPanel(statusData);
    return safeUpdate(interaction, view);
  }

  // 0B. KBot Server List Refresh (Admin Only, Ephemeral/Private View)
  if (customId === 'kbot:refresh_servers') {
    const { isUserAdmin } = require('./interaction-handler');
    let isAdmin = isUserAdmin(interaction, services, null, effectiveGuildId);
    if (!isAdmin && services?.accessStore?.getUserByDiscordId && typeof resolveLinkedUser === 'function') {
      const user = await resolveLinkedUser(interaction, services).catch(() => null);
      isAdmin = isUserAdmin(interaction, services, user, effectiveGuildId);
    }

    if (!isAdmin) {
      if (interaction.deferred || interaction.replied) return;
      return safeReply(interaction, {
        content: '⛔ Chỉ Quản trị viên (Admin) mới có quyền xem và làm mới danh sách máy chủ KBot.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (!checkCooldown(discordUserId, 1500)) {
      return safeDeferUpdate(interaction);
    }

    await safeDeferUpdate(interaction);
    const { renderKbotServerList } = require('../commands/kbot');
    const client = services?.discordClient || services?.client || interaction.client;
    const view = await renderKbotServerList(client);
    return safeUpdate(interaction, view);
  }

  // 0C. Discord Points Leaderboard Tabs (Accessible to logged-in users in configured guild)
  if (customId.startsWith('points:lb:')) {
    const { resolveLoggedInPointsUser } = require('../../services/discord-points-service');
    const {
      renderLoginRequiredNotice,
      renderPointsLeaderboard,
      renderCombinedPointsLeaderboard
    } = require('../panels/points-renderer');

    const loggedInUser = await resolveLoggedInPointsUser(discordUserId, services);
    if (!loggedInUser) {
      return safeReply(interaction, {
        ...renderLoginRequiredNotice(discordUserId),
        flags: MessageFlags.Ephemeral
      });
    }
    if (!services?.discordPoints) {
      return safeReply(interaction, {
        content: '❌ Hệ thống điểm tích lũy chưa được khởi tạo.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (!checkCooldown(discordUserId, 800)) {
      return safeDeferUpdate(interaction);
    }
    await safeDeferUpdate(interaction);
    const rawType = customId.split(':')[2] || 'tatca';
    if (rawType === 'tatca') {
      const combined = await services.discordPoints.getCombinedLeaderboards({
        guildId: interaction.guildId,
        limit: 10,
        viewerUserId: discordUserId
      });
      return safeUpdate(interaction, renderCombinedPointsLeaderboard({
        guildName: interaction.guild?.name || 'Server',
        combined
      }));
    }
    const leaderboard = await services.discordPoints.getLeaderboard({
      guildId: interaction.guildId,
      type: rawType,
      limit: 10,
      viewerUserId: discordUserId
    });
    return safeUpdate(interaction, renderPointsLeaderboard({
      guildName: interaction.guild?.name || 'Server',
      leaderboard
    }));
  }

  // 0D. Discord Points 1-Day Missed Streak Restore Prompt (points:restore:yes:<userId> | points:restore:no:<userId>)
  if (customId.startsWith('points:restore:')) {
    const [, , choice, ownerUserId] = customId.split(':');
    if (ownerUserId && String(discordUserId) !== String(ownerUserId)) {
      return safeReply(interaction, {
        content: '⛔ Chỉ chủ nhân của lệnh `/diemdanh` này mới có thể bấm nút lựa chọn.',
        flags: MessageFlags.Ephemeral
      });
    }

    const { resolveLoggedInPointsUser } = require('../../services/discord-points-service');
    const { renderLoginRequiredNotice, renderCheckinResult } = require('../panels/points-renderer');
    const loggedInUser = await resolveLoggedInPointsUser(discordUserId, services);
    if (!loggedInUser) {
      return safeReply(interaction, {
        ...renderLoginRequiredNotice(discordUserId),
        flags: MessageFlags.Ephemeral
      });
    }
    if (!services?.discordPoints) {
      return safeReply(interaction, {
        content: '❌ Hệ thống điểm tích lũy chưa được khởi tạo.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (!checkCooldown(discordUserId, 800)) {
      return safeDeferUpdate(interaction);
    }
    await safeDeferUpdate(interaction);

    const displayName =
      interaction.member?.displayName ||
      interaction.user?.globalName ||
      interaction.user?.username ||
      loggedInUser.username ||
      '';

    if (choice === 'yes') {
      const res = await services.discordPoints.restoreCheckin({
        guildId: interaction.guildId,
        userId: discordUserId,
        username: displayName
      });
      if (res.ok || res.alreadyCheckedIn) {
        return safeUpdate(interaction, renderCheckinResult({ user: interaction.user, result: res }));
      }
      if (res.reason === 'insufficient_points') {
        return safeUpdate(interaction, {
          embeds: [
            embed(
              '❌ KHÔNG ĐỦ ĐIỂM KHÔI PHỤC',
              `Bạn hiện có **${res.currentPoints} đ**, cần tối thiểu **${res.restoreCost} đ** để khôi phục chuỗi.\nBạn có thể nhắn tin tích thêm điểm hoặc gõ lại \`/diemdanh\` rồi chọn **Không** để điểm danh mới (+10đ).`,
              0xef4444
            )
          ],
          components: []
        });
      }
      return safeUpdate(interaction, {
        embeds: [
          embed(
            '⏳ HẾT HẠN KHÔI PHỤC CHUỖI',
            'Đã qua **00:00** sang ngày mới hoặc trạng thái chuỗi đã thay đổi. Vui lòng gõ lại `/diemdanh` nhé!',
            0xf59e0b
          )
        ],
        components: []
      });
    }

    const res = await services.discordPoints.checkin({
      guildId: interaction.guildId,
      userId: discordUserId,
      username: displayName,
      declineRestore: true
    });
    return safeUpdate(interaction, renderCheckinResult({ user: interaction.user, result: res }));
  }

  // 0D2. Discord Points 1-Click Quick Check-in Button (points:quick_checkin:<userId>)
  if (customId.startsWith('points:quick_checkin:')) {
    const ownerUserId = customId.split(':')[2] || '';
    if (ownerUserId && String(discordUserId) !== String(ownerUserId)) {
      return safeReply(interaction, {
        content: '⛔ Chỉ chính bạn mới có thể sử dụng nút điểm danh nhanh này.',
        flags: MessageFlags.Ephemeral
      });
    }
    const { resolveLoggedInPointsUser } = require('../../services/discord-points-service');
    const { renderLoginRequiredNotice, renderCheckinResult } = require('../panels/points-renderer');
    const loggedInUser = await resolveLoggedInPointsUser(discordUserId, services);
    if (!loggedInUser) {
      return safeReply(interaction, {
        ...renderLoginRequiredNotice(discordUserId),
        flags: MessageFlags.Ephemeral
      });
    }
    if (!services?.discordPoints) {
      return safeReply(interaction, {
        content: '❌ Hệ thống điểm tích lũy chưa được khởi tạo.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (!checkCooldown(discordUserId, 800)) {
      return safeDeferUpdate(interaction);
    }
    const displayName =
      interaction.member?.displayName ||
      interaction.user?.globalName ||
      interaction.user?.username ||
      loggedInUser.username ||
      '';
    const result = await services.discordPoints.checkin({
      guildId: interaction.guildId,
      userId: discordUserId,
      username: displayName
    });
    return safeReply(interaction, {
      ...renderCheckinResult({ user: interaction.user, result }),
      flags: MessageFlags.Ephemeral
    });
  }

  // 0E. Discord /login Logout & Re-login Buttons (Accessible to any linked user, even if expired/unroled)
  if (customId.startsWith('login:logout:') || customId === 'login:logout') {
    const ownerUserId = customId.includes(':') ? customId.split(':')[2] : '';
    if (ownerUserId && String(discordUserId) !== String(ownerUserId)) {
      return safeReply(interaction, {
        content: '⛔ Chỉ chính bạn mới có thể bấm nút đăng xuất này.',
        flags: MessageFlags.Ephemeral
      });
    }
    if (!checkCooldown(discordUserId, 800)) {
      return safeDeferUpdate(interaction);
    }
    await safeDeferUpdate(interaction);
    const res = await performDiscordLogout(interaction, services);
    if (res.checkedExisting && !res.wasLoggedIn && res.removedRoles.length === 0) {
      return safeUpdate(interaction, {
        embeds: [
          embed(
            'ℹ️ BẠN ĐÃ ĐĂNG XUẤT TRƯỚC ĐÓ',
            'Tài khoản Discord của bạn hiện không còn liên kết với tài khoản Web Manager nào.\n\nBấm **Đăng nhập lại** bên dưới nếu bạn muốn liên kết tài khoản.',
            0x0ea5e9
          )
        ],
        components: renderLoggedOutPanel({
          discordUserId,
          includeReloginButton: true
        }).components
      });
    }
    return safeUpdate(
      interaction,
      renderLoggedOutPanel({
        discordUserId,
        unlinkedUsername: res.unlinkedUsername,
        removedRoles: res.removedRoles,
        includeReloginButton: true
      })
    );
  }

  if (customId.startsWith('login:prompt:') || customId === 'login:prompt') {
    const ownerUserId = customId.includes(':') ? customId.split(':')[2] : '';
    if (ownerUserId && String(discordUserId) !== String(ownerUserId)) {
      return safeReply(interaction, {
        content: '⛔ Chỉ chính bạn mới có thể sử dụng nút đăng nhập này.',
        flags: MessageFlags.Ephemeral
      });
    }
    let lookupTimer = null;
    try {
      const existingUser = await Promise.race([
        resolveActiveDiscordAccountLink(discordUserId, services),
        new Promise((resolve) => {
          lookupTimer = setTimeout(() => resolve(null), 1500);
          lookupTimer.unref?.();
        })
      ]);
      if (existingUser) {
        const promptMaint = await resolveInteractionMaintenance(services, interaction).catch(() => null);
        let syncTimer = null;
        const roleSyncNote = await Promise.race([
          syncDiscordMemberRolesForUser(interaction, existingUser, services, promptMaint).catch(() => ''),
          new Promise((resolve) => {
            syncTimer = setTimeout(() => resolve(''), 800);
            syncTimer.unref?.();
          })
        ]).finally(() => {
          if (syncTimer) clearTimeout(syncTimer);
        });
        return safeReply(interaction, {
          ...renderAlreadyLoggedInPanel({
            user: existingUser,
            discordUserId,
            roleSyncNote,
            publicBaseUrl: resolvePublicBaseUrl(services),
            maintenance: promptMaint
          }),
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (_) {
      // Proceed to modal
    } finally {
      if (lookupTimer) clearTimeout(lookupTimer);
    }
    return interaction.showModal(buildLoginModal());
  }

  // Verify Discord role / authorization before interacting with panel controls (DISCORD-03)
  const authorizedRole = await hasAuthorizedRole(interaction, services);
  if (!authorizedRole) {
    return safeReply(interaction, {
      ...renderUnauthenticatedPanel({
        discordUserId,
        title: '⛔ KHÔNG CÓ QUYỀN TRUY CẬP',
        reason: 'Bạn chưa có Role thành viên hoặc gói thuê bot chưa kích hoạt.\n\n👉 Bấm **Đăng nhập ngay** bên dưới (hoặc gõ `/login`) để kiểm tra tài khoản và nhận Role tự động.',
        publicBaseUrl: resolvePublicBaseUrl(services)
      }),
      flags: MessageFlags.Ephemeral
    });
  }

  // Rate limit button presses
  if (!checkCooldown(discordUserId)) {
    return safeDeferUpdate(interaction);
  }

  await safeDeferUpdate(interaction);

  // Authenticate user
  const user = await resolveLinkedUser(interaction, services);
  if (!user) {
    return safeUpdate(
      interaction,
      renderUnauthenticatedPanel({
        discordUserId,
        publicBaseUrl: resolvePublicBaseUrl(services)
      })
    );
  }

  const maintenance = await resolveInteractionMaintenance(services, interaction);

  if (user.role !== 'admin') {
    const normalizedUser = { ...user, expiresAt: user.expiresAt || user.expiresAtRental || null };
    if (!isUserAccountEntitled(normalizedUser, services, maintenance)) {
      return safeUpdate(
        interaction,
        renderEntitlementBlockedPanel({
          user: normalizedUser,
          discordUserId,
          publicBaseUrl: resolvePublicBaseUrl(services)
        })
      );
    }
  }

  // 1. Back to / Refresh / Paginate Bots list: bots:list, bots:refresh, bots:first, bots:last, bots:page:{num}
  if (
    customId === 'bots:list' ||
    customId === 'bots:refresh' ||
    customId === 'bots:first' ||
    customId === 'bots:last' ||
    customId.startsWith('bots:page:')
  ) {
    const userBots = await getUserBots(user, services, maintenance);
    const totalPages = Math.max(1, Math.ceil(userBots.length / 5));
    let page = 0;
    if (customId === 'bots:first' || customId === 'bots:list') {
      page = 0;
    } else if (customId === 'bots:last') {
      page = totalPages - 1;
    } else if (customId.startsWith('bots:page:')) {
      page = Number(customId.split(':')[2]) || 0;
    } else if (customId === 'bots:refresh') {
      const footerText = String(
        interaction.message?.embeds?.[0]?.footer?.text ||
        interaction.message?.embeds?.[0]?.data?.footer?.text ||
        ''
      );
      const match = footerText.match(/Trang\s+(\d+)\s*\//i);
      if (match) {
        page = Math.max(0, Math.min(totalPages - 1, Number(match[1]) - 1));
      }
    }
    const view = renderBotsList({ user, workers: userBots, page, maintenance });
    return safeUpdate(interaction, view);
  }

  // 2. View Bot Detail: bot:view:{workerId} or bot:refresh:{workerId}
  if (customId.startsWith('bot:view:') || customId.startsWith('bot:refresh:')) {
    const workerId = customId.split(':')[2];
    const worker = await services.registry.find(workerId);
    const allWorkers = user.role === 'admin' ? null : (typeof services.registry?.list === 'function' ? await services.registry.list() : null);

    if (!worker || !checkBotOwnership(user, workerId, worker, allWorkers)) {
      return safeUpdate(interaction, {
        embeds: [embed('⛔ TỪ CHỐI TRUY CẬP', 'Bạn không có quyền truy cập hoặc bot này không tồn tại.', 0xef4444)],
        components: [renderBotsList({ user, workers: await getUserBots(user, services, maintenance), maintenance }).components[0]]
      });
    }

    const view = renderBotDetail({ user, worker, maintenance });
    return safeUpdate(interaction, view);
  }

  // 3. Control Bot: bot:start:{workerId}, bot:stop:{workerId}, bot:restart:{workerId}
  if (customId.startsWith('bot:start:') || customId.startsWith('bot:stop:') || customId.startsWith('bot:restart:')) {
    const [, action, workerId] = customId.split(':');
    const worker = await services.registry.find(workerId);
    const allWorkers = user.role === 'admin' ? null : (typeof services.registry?.list === 'function' ? await services.registry.list() : null);

    if (!worker || !checkBotOwnership(user, workerId, worker, allWorkers)) {
      return safeUpdate(interaction, {
        embeds: [embed('⛔ TỪ CHỐI THAO TÁC', 'Bạn không có quyền điều khiển bot này.', 0xef4444)]
      });
    }

    if (user.role !== 'admin') {
      if (maintenance.enabled) {
        const cleanMaintMsg = safe(maintenance.message || 'Hệ thống đang bảo trì nâng cấp máy chủ.', 600);
        const frozenBadge = formatAccountPlanBadge(user, maintenance);
        const badgeLine = frozenBadge ? `\n• **Thời hạn gói của bạn:** ${frozenBadge}` : '';
        return safeUpdate(interaction, {
          embeds: [embed(
            '🛠️ HỆ THỐNG ĐANG BẢO TRÌ',
            `${cleanMaintMsg}\n\n` +
            `⏸️ **An tâm:** Thời gian thuê bot đang được **đóng băng (không bị trừ giờ)** — thời gian sử dụng bot được giữ nguyên, không bị trừ trong lúc bảo trì.${badgeLine}\n\n` +
            `*Bạn vẫn có thể xem trạng thái & nhật ký bot bình thường; thao tác điều khiển sẽ mở lại ngay khi bảo trì hoàn tất.*`,
            0xf59e0b
          )],
          allowedMentions: { parse: [] }
        });
      }

      const normalizedUser = { ...user, expiresAt: user.expiresAt || user.expiresAtRental || null };
      if (!isUserAccountEntitled(normalizedUser, services, maintenance)) {
        return safeUpdate(
          interaction,
          renderEntitlementBlockedPanel({
            user: normalizedUser,
            discordUserId,
            publicBaseUrl: resolvePublicBaseUrl(services)
          })
        );
      }
    }

    // Serialize start/stop/restart actions per worker and patch ONLY manuallyStopped (DISCORD-11)
    let notice = '';
    await panelControlLock.run(String(workerId), async () => {
      try {
        const dispatchRes = await services.broker.dispatch(workerId, action);
        if (dispatchRes?.delivered === true && !dispatchRes?.timedOut && dispatchRes?.result?.ok !== false) {
          if (typeof services.registry?.updateStatus === 'function') {
            await services.registry.updateStatus(
              workerId,
              { manuallyStopped: action === 'stop' },
              action === 'stop' ? 'discord-stop' : 'discord-start'
            ).catch(() => {});
          }
          const actionLabels = { start: 'BẬT (START)', stop: 'TẮT (STOP)', restart: 'KHỞI ĐỘNG LẠI (RESTART)' };
          notice = `✅ Đã thực thi lệnh **${actionLabels[action] || action}** thành công cho bot \`${workerId}\`!`;
        } else {
          const reason = dispatchRes?.timedOut
            ? 'Worker phản hồi quá thời gian chờ (timeout)'
            : (dispatchRes?.result?.error || dispatchRes?.error || 'Worker chưa xác nhận hoàn tất');
          notice = `⚠️ Chưa xác nhận hoàn tất lệnh ${action}: ${reason}`;
        }
      } catch (err) {
        if (action === 'stop' && err?.code === 'WORKER_UNAVAILABLE' && typeof services.registry?.markOfflineStopped === 'function') {
          await services.registry.markOfflineStopped(workerId, { source: 'discord-offline-stop' }).catch(() => {});
          notice = `⏹️ Bot \`${workerId}\` hiện đang ngoại tuyến nên đã chuyển sang **DỪNG** (sẽ giữ trạng thái nghỉ khi container bật lại).`;
        } else if (err?.code === 'WORKER_UNAVAILABLE') {
          notice = `⚠️ Container của bot \`${workerId}\` hiện đang tắt (Stopped hoặc vừa tự dừng do chạm giới hạn CPU/RAM trên Wispbyte). Hãy bật lại container rồi thử lại.`;
        } else {
          notice = `❌ Không thể gửi lệnh ${action}: ${err.message}`;
        }
      }
    });

    const updatedWorker = (await services.registry.find(workerId)) || worker;
    const view = renderBotDetail({ user, worker: updatedWorker, notice, maintenance });
    return safeUpdate(interaction, view);
  }

  if (customId.startsWith('logs:')) {
    const workerId = customId === 'logs:select'
      ? interaction.values?.[0]
      : customId.split(':')[2];
    const worker = workerId ? await services.registry.find(workerId) : null;
    const allWorkers = user.role === 'admin' ? null : (typeof services.registry?.list === 'function' ? await services.registry.list() : null);

    if (!worker || !checkBotOwnership(user, workerId, worker, allWorkers)) {
      return safeUpdate(interaction, {
        embeds: [embed('⛔ BOT KHÔNG KHẢ DỤNG', 'Bot không tồn tại hoặc bạn không có quyền xem bot này.', 0xef4444)],
        components: [renderBotsList({ user, workers: await getUserBots(user, services, maintenance), maintenance }).components[0]]
      });
    }

    const fullBotId = worker.workerId || worker.id;
    const storeRef = services?.store || services?.registry?.store;
    let logs = [];
    try {
      if (typeof services?.registry?.refreshLogsFromStore === 'function') {
        await services.registry.refreshLogsFromStore(fullBotId, { kind: 'all', maxAgeMs: 3000 }).catch(() => {});
      }
      if (services?.workerClient?.getBotLogs) {
        logs = await services.workerClient.getBotLogs(fullBotId, 25);
      } else if (services?.registry?.getLogs) {
        logs = await services.registry.getLogs(fullBotId, 25);
      }
      if ((!Array.isArray(logs) || logs.length === 0) && storeRef?.get) {
        const fullRecord = await storeRef.get(fullBotId, { includeEvents: true }).catch(() => null);
        if (Array.isArray(fullRecord?.events) && fullRecord.events.length > 0) {
          logs = fullRecord.events;
        }
      }
      if ((!Array.isArray(logs) || logs.length === 0) && storeRef?.getAuditLogs) {
        logs = await storeRef.getAuditLogs({ botId: fullBotId, limit: 25 });
      }
    } catch (err) {
      logs = [{ time: new Date().toISOString(), type: 'error', message: 'Không thể tải logs: ' + err.message }];
    }

    const userBots = await getUserBots(user, services, maintenance);
    return safeUpdate(interaction, renderBotLogs({
      user,
      worker,
      logs: Array.isArray(logs) ? logs.slice(-25) : [],
      workers: userBots
    }));
  }

  // 6. Admin Panel Interactions
  if (customId.startsWith('admin:')) {
    if (user.role !== 'admin') {
      return safeUpdate(interaction, {
        embeds: [embed('⛔ TỪ CHỐI QUYỀN HẠN', 'Hành động này chỉ dành cho Quản trị viên.', 0xef4444)]
      });
    }

    if (customId === 'admin:status' || customId === 'admin:status:refresh') {
      const allWorkers = await services.registry.list();
      const onlineWorkers = allWorkers.filter((w) => getWorkerState(w).isOnline).length;
      const stats = { totalWorkers: allWorkers.length, onlineWorkers };
      let dbCheck = { ok: true, latencyMs: 0 };
      const dbStore = services.accessStore?.adapter ? services.accessStore : services.store;
      if (dbStore?.adapter && (typeof dbStore.adapter.ping === 'function' || typeof dbStore.adapter.testConnection === 'function')) {
        const start = Date.now();
        const probeFn = typeof dbStore.adapter.ping === 'function'
          ? () => dbStore.adapter.ping()
          : () => dbStore.adapter.testConnection();
        const testRes = await probeFn().catch((err) => ({ ok: false, error: err.message }));
        dbCheck = { ok: Boolean(testRes?.ok), latencyMs: Date.now() - start, error: testRes?.error };
      } else if (dbStore && typeof dbStore.ping === 'function') {
        const start = Date.now();
        const pingRes = await dbStore.ping().catch((err) => ({ ok: false, error: err.message }));
        dbCheck = { ok: Boolean(pingRes?.ok), latencyMs: Date.now() - start };
      }

      const systemInfo = {
        uptime: process.uptime(),
        memory: {
          rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
          heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024))
        },
        checks: {
          database: dbCheck,
          discord: { ok: true }
        }
      };
      const view = renderAdminStatus({ stats, systemInfo });
      return safeUpdate(interaction, view);
    }

    if (customId.startsWith('admin:bots:')) {
      const page = Number(customId.split(':')[2]) || 0;
      const allWorkers = await services.registry.list();
      const view = renderAdminBots({ workers: allWorkers, page });
      return safeUpdate(interaction, view);
    }
  }

  // 7. Wispbyte Panel Interactions
  if (customId.startsWith('wispbyte:')) {
    if (user.role !== 'admin') {
      return safeUpdate(interaction, {
        embeds: [embed('⛔ TỪ CHỐI QUYỀN HẠN', 'Hành động này chỉ dành cho Quản trị viên.', 0xef4444)]
      });
    }

    const manager = services?.wispbyteKeepAlive;
    if (!manager) {
      return safeUpdate(interaction, {
        embeds: [embed('❌ LỖI', 'Dịch vụ WispbyteKeepAlive không khả dụng.', 0xef4444)]
      });
    }

    if (customId === 'wispbyte:check') {
      const res = await manager.checkAll({ notifyDiscord: false });
      const view = renderWispbyteCheckResult({
        results: res.results || [],
        total: res.total || 0,
        okCount: res.okCount || 0,
        expiredCount: res.expiredCount || 0,
        errorCount: (res.results || []).filter((r) => !r.success && r.status !== 'expired').length
      });
      return safeUpdate(interaction, view);
    }

    if (customId === 'wispbyte:list') {
      const accounts = await manager.getAccounts();
      const view = renderWispbyteList({ accounts });
      return safeUpdate(interaction, view);
    }
  }
}

module.exports = {
  handlePanelInteraction,
  resolveLinkedUser,
  resolveActiveDiscordAccountLink,
  syncDiscordMemberRolesForUser,
  isUserAccountEntitled,
  resolvePublicBaseUrl,
  performDiscordLogout,
  checkBotOwnership,
  getUserBots,
  safeDeferUpdate,
  getEffectiveRoleIds,
  addMemberRole,
  removeMemberRole,
  hasAuthorizedRole,
  handleStaleWorkerInteraction: async () => {}
};
