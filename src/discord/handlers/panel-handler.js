'use strict';

const { MessageFlags } = require('discord.js');
const AsyncKeyLock = require('../../services/async-key-lock');
const {
  renderBotsList,
  renderBotDetail,
  renderBotLogs,
  renderAdminStatus,
  renderAdminBots,
  renderWispbyteList,
  renderWispbyteCheckResult,
  getWorkerState,
  embed
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

async function resolveAllowedGuildId(services) {
  if (services?.config?.discordGuildId && String(services.config.discordGuildId).trim()) {
    return String(services.config.discordGuildId).trim();
  }
  const snap = services?.managerRuntimeSettings?.snapshot?.();
  if (snap && (snap.guildId || snap.discordGuildId)) {
    const id = String(snap.guildId || snap.discordGuildId).trim();
    if (id) return id;
  }
  try {
    const roleSettings = await services?.managerRuntimeSettings?.getRoleSettings?.();
    if (roleSettings?.guildId && String(roleSettings.guildId).trim()) {
      return String(roleSettings.guildId).trim();
    }
  } catch (_) {}
  try {
    const stored = await services?.accessStore?.getSetting?.('discord_access');
    if (stored?.guildId && String(stored.guildId).trim()) {
      return String(stored.guildId).trim();
    }
  } catch (_) {}
  return '';
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
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }
    return await interaction.reply(payload);
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
async function getEffectiveRoleIds(services) {
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
  return { adminRoleId, userRoleId };
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

  // Enforce allowed guild fail-closed before checking guild owner/admin perm/roles (DISCORD-01/03)
  const allowedGuildId = await resolveAllowedGuildId(services);
  if (!allowedGuildId || interaction.guildId !== allowedGuildId) {
    return false;
  }

  // 2. Server Owner (scoped to configured guild)
  const ownerId = interaction.guild?.ownerId;
  if (ownerId && ownerId === userId) return true;

  // 3. Discord Administrator permission (scoped to configured guild)
  try {
    if (interaction?.memberPermissions?.has?.('Administrator') || interaction?.memberPermissions?.has?.(8n)) {
      return true;
    }
  } catch (_) {}
  try {
    if (typeof interaction?.member?.permissions?.has === 'function') {
      if (interaction.member.permissions.has('Administrator') || interaction.member.permissions.has(8n)) {
        return true;
      }
    } else if (interaction?.member?.permissions && (BigInt(interaction.member.permissions) & 8n)) {
      return true;
    }
  } catch (_) {}

  // 4. Resolve configured role IDs
  const { adminRoleId, userRoleId } = await getEffectiveRoleIds(services);

  // If neither role is configured yet inside the allowed guild, allow interactions (initial unconfigured setup state)
  if (!adminRoleId && !userRoleId) return true;

  // 5. Check member roles
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

  const allowedGuildId = await resolveAllowedGuildId(services);
  const isAllowedGuild = Boolean(allowedGuildId && interaction.guildId === allowedGuildId);

  // 1. Check if user qualifies as configured admin or configured-guild admin
  const isConfiguredAdmin = Boolean(
    (services?.config?.adminUserId && services.config.adminUserId === discordUserId) ||
    (services?.accessControl?.adminUserId && services.accessControl.adminUserId === discordUserId)
  );
  const isOwner = Boolean(isAllowedGuild && interaction.guild?.ownerId === discordUserId);
  const hasAdminPerm = Boolean(isAllowedGuild && (
    interaction.memberPermissions?.has?.('Administrator') ||
    interaction.memberPermissions?.has?.(8n) ||
    interaction.member?.permissions?.has?.('Administrator') ||
    interaction.member?.permissions?.has?.(8n)
  ));
  const hasAdminRole = Boolean(isAllowedGuild && services?.accessControl?.roleFor?.(interaction.member, interaction) === 'admin');
  const qualifiesAsDiscordAdmin = isConfiguredAdmin || isOwner || hasAdminPerm || hasAdminRole;

  // 2. Check if user is linked to a Web Manager account
  const linked = await services?.accessStore?.getUserByDiscordId?.(discordUserId);
  let resolved = null;
  if (linked) {
    if (String(linked.status || '').toLowerCase() === 'disabled') {
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
async function getUserBots(user, services) {
  if (!user) return [];
  const allWorkers = await services.registry.list();
  if (user.role === 'admin') return allWorkers;

  if (services?.accessControl?.isEntitled) {
    const normalizedUser = { ...user, expiresAt: user.expiresAt || user.expiresAtRental || null };
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

  const effectiveGuildId = await resolveAllowedGuildId(services);
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
      const storedAdminPass = services.registry.getAdminPassword() || services.config.adminPassword;
      if (storedAdminPass && await verifyAdminPasswordAsync(cleanPassword, storedAdminPass)) {
        resetLoginRateLimit(discordUserId);
        resetUsernameRateLimit(cleanUsername);
        await services.accessStore.linkDiscord(discordUserId, 'admin', 'admin');
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

        return safeReply(interaction, {
          embeds: [
            embed(
              '✅ ĐĂNG NHẬP THÀNH CÔNG',
              `Đã liên kết Discord với tài khoản **Quản trị viên (ADMIN)**.\n\n` +
              `• **Tài khoản:** \`${cleanUsername}\`\n` +
              `• **Phân quyền:** \`Enterprise Administrator\`${roleInfo}\n\n` +
              `Dùng lệnh \`/bots\` để quản lý hoặc \`/check\` để xem tình trạng hệ thống.`,
              0x22c55e
            )
          ]
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
    await services.accessStore.linkDiscord(discordUserId, user.username, canonicalUserId);
    await services.accessStore?.recordUserLogin?.(canonicalUserId, null).catch(() => null);
    await services.accessStore?.addAudit?.({
      action: 'DISCORD_LOGIN_SUCCESS',
      actorId: discordUserId,
      targetId: canonicalUserId,
      details: { username: user.username, guildId: interaction.guildId }
    }).catch(() => null);

    // Never grant userRoleId to expired/unentitled users (DISCORD-03)
    const normalizedUser = { ...user, expiresAt: user.expiresAt || user.expiresAtRental || null };
    const isUserEntitled = user.role === 'admin' || (
      services?.accessControl?.isEntitled
        ? services.accessControl.isEntitled(normalizedUser)
        : (String(normalizedUser.status || 'active').toLowerCase() !== 'disabled' && (normalizedUser.isPermanent === true || (normalizedUser.expiresAt && new Date(normalizedUser.expiresAt).getTime() > Date.now())))
    );

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

    return safeReply(interaction, {
      embeds: [
        embed(
          '✅ ĐĂNG NHẬP THÀNH CÔNG',
          `Đã liên kết tài khoản Discord <@${discordUserId}> với Web Manager.\n\n` +
          `• **Tài khoản Web:** **${user.username}**\n` +
          `• **Gói dịch vụ:** ${user.planName || 'Gói tiêu chuẩn'}\n` +
          `• **Hạn sử dụng:** ${user.isPermanent ? 'Vĩnh viễn' : (user.expiresAt ? new Date(user.expiresAt).toLocaleDateString('vi-VN') : '—')}${roleInfo}\n\n` +
          `👉 Sử dụng lệnh \`/bots\` để mở bảng điều khiển và theo dõi bot của bạn.`,
          0x22c55e
        )
      ]
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
        embeds: [embed('⛔ TỪ CHỐI TRUY CẬP', 'Chỉ Chủ sở hữu server hoặc SuperAdmin mới có quyền đổi mật khẩu quản trị viên.', 0xef4444)]
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

  // Verify Discord role / authorization before interacting with panel controls (DISCORD-03)
  const authorizedRole = await hasAuthorizedRole(interaction, services);
  if (!authorizedRole) {
    return safeReply(interaction, {
      embeds: [embed('⛔ KHÔNG CÓ QUYỀN', 'Bạn chưa có Role hoặc quyền truy cập bảng điều khiển. Vui lòng sử dụng `/login`.', 0xef4444)],
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
    const errorEmbed = embed(
      '⚠️ CHƯA ĐĂNG NHẬP',
      'Bạn chưa liên kết tài khoản Discord với Web Manager.\n\nVui lòng sử dụng lệnh `/login` để đăng nhập bằng Username và Password.',
      0xf59e0b
    );
    return safeUpdate(interaction, { embeds: [errorEmbed], components: [] });
  }


  if (user.role !== 'admin') {
    const normalizedUser = { ...user, expiresAt: user.expiresAt || user.expiresAtRental || null };
    const isEntitled = services?.accessControl?.isEntitled
      ? services.accessControl.isEntitled(normalizedUser)
      : (String(normalizedUser.status || 'active').toLowerCase() !== 'disabled' && (normalizedUser.isPermanent === true || (normalizedUser.expiresAt && new Date(normalizedUser.expiresAt).getTime() > Date.now())));

    if (!isEntitled) {
      const isLocked = String(normalizedUser.status || 'active').toLowerCase() === 'disabled';
      const title = isLocked ? '⛔ TÀI KHOẢN BỊ KHÓA' : '⛔ TÀI KHOẢN HẾT HẠN HOẶC BỊ KHÓA';
      const desc = isLocked
        ? 'Tài khoản của bạn đã bị vô hiệu hóa bởi Quản trị viên.'
        : 'Tài khoản của bạn đã hết hạn thuê bot hoặc bị vô hiệu hóa. Vui lòng gia hạn trên Web Manager để tiếp tục sử dụng bot.';
      return safeUpdate(interaction, {
        embeds: [embed(title, desc, 0xef4444)],
        components: []
      });
    }
  }

  // 1. Back to / Refresh Bots list: bots:list, bots:refresh, bots:page:{num}
  if (customId === 'bots:list' || customId === 'bots:refresh' || customId.startsWith('bots:page:')) {
    let page = 0;
    if (customId.startsWith('bots:page:')) {
      page = Number(customId.split(':')[2]) || 0;
    }
    const userBots = await getUserBots(user, services);
    const view = renderBotsList({ user, workers: userBots, page });
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
        components: [renderBotsList({ user, workers: await getUserBots(user, services) }).components[0]]
      });
    }

    const view = renderBotDetail({ user, worker });
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
      const maintenance = await getMaintenanceState(services?.accessStore || services?.store);
      if (maintenance.enabled) {
        return safeUpdate(interaction, {
          embeds: [embed(
            '🛠️ HỆ THỐNG ĐANG BẢO TRÌ',
            `${maintenance.message}\n\nTạm khóa thao tác điều khiển worker đối với người dùng cho đến khi bảo trì hoàn tất.`,
            0xf59e0b
          )]
        });
      }

      const normalizedUser = { ...user, expiresAt: user.expiresAt || user.expiresAtRental || null };
      const statusStr = String(normalizedUser.status || 'active').toLowerCase();
      const expiryMs = normalizedUser.expiresAt ? Date.parse(normalizedUser.expiresAt) : NaN;
      const isEntitled = services.accessControl?.isEntitled
        ? services.accessControl.isEntitled(normalizedUser)
        : (statusStr === 'active' && (normalizedUser.isPermanent === true || (Number.isFinite(expiryMs) && expiryMs > Date.now())));

      if (!isEntitled) {
        return safeUpdate(interaction, {
          embeds: [embed(
            '⛔ TÀI KHOẢN HẾT HẠN HOẶC BỊ KHÓA',
            'Tài khoản của bạn đã hết hạn thuê bot hoặc bị vô hiệu hóa. Vui lòng gia hạn trên Web Manager để tiếp tục điều khiển bot.',
            0xef4444
          )]
        });
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
          notice = `⏹️ Bot \`${workerId}\` hiện đang ngoại tuyến nên đã đánh dấu **DỪNG** trên Manager (sẽ không tự chạy lại khi Worker bật lên).`;
        } else if (err?.code === 'WORKER_UNAVAILABLE') {
          notice = `⚠️ Worker \`${workerId}\` chưa check-in với Manager trong 2 phút qua (${err.message}). Hãy kiểm tra container Wispbyte đang chạy và đúng biến môi trường.`;
        } else {
          notice = `❌ Lỗi khi gửi lệnh ${action}: ${err.message}`;
        }
      }
    });

    const updatedWorker = (await services.registry.find(workerId)) || worker;
    const view = renderBotDetail({ user, worker: updatedWorker, notice });
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
        components: [renderBotsList({ user, workers: await getUserBots(user, services) }).components[0]]
      });
    }

    const fullBotId = worker.workerId || worker.id;
    const storeRef = services?.store || services?.registry?.store;
    let logs = [];
    try {
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

    return safeUpdate(interaction, renderBotLogs({
      user,
      worker,
      logs: Array.isArray(logs) ? logs.slice(-25) : []
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
      if (dbStore?.adapter && typeof dbStore.adapter.testConnection === 'function') {
        const start = Date.now();
        const testRes = await dbStore.adapter.testConnection().catch((err) => ({ ok: false, error: err.message }));
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
  checkBotOwnership,
  getUserBots,
  safeDeferUpdate,
  getEffectiveRoleIds,
  addMemberRole,
  removeMemberRole,
  hasAuthorizedRole,
  handleStaleWorkerInteraction: async () => {}
};
