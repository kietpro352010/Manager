'use strict';

const { MessageFlags } = require('discord.js');
const {
  renderBotsList,
  renderBotDetail,
  renderAdminStatus,
  renderAdminBots,
  renderWispbyteList,
  renderWispbyteCheckResult,
  getWorkerState,
  embed
} = require('../panels/renderer');
const {
  verifyUserPassword,
  verifyAdminPassword,
  hashAdminPassword,
  encryptUserPassword,
  isStoredCredentialCiphertext
} = require('../../utils/secrets');

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

// Clean up stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of discordLoginAttempts.entries()) {
    if (now - val.windowStart > 15 * 60 * 1000) discordLoginAttempts.delete(key);
  }
  for (const [key, time] of userActionCooldown.entries()) {
    if (now - time > 60000) userActionCooldown.delete(key);
  }
}, 10 * 60 * 1000).unref();

// Resolve authenticated user & verify admin
async function resolveLinkedUser(interaction, services) {
  const discordUserId = interaction.user?.id;
  if (!discordUserId) return null;

  // 1. Check if user qualifies as server admin / configured admin
  const isConfiguredAdmin = Boolean(
    (services.config?.adminUserId && services.config.adminUserId === discordUserId) ||
    (services.accessControl?.adminUserId && services.accessControl.adminUserId === discordUserId)
  );
  const isOwner = interaction.guild?.ownerId === discordUserId;
  const hasAdminPerm = Boolean(
    interaction.memberPermissions?.has?.('Administrator') ||
    interaction.memberPermissions?.has?.(8n) ||
    interaction.member?.permissions?.has?.('Administrator') ||
    interaction.member?.permissions?.has?.(8n)
  );
  const hasAdminRole = services.accessControl?.roleFor?.(interaction.member, interaction) === 'admin';
  const qualifiesAsDiscordAdmin = isConfiguredAdmin || isOwner || hasAdminPerm || hasAdminRole;

  // 2. Check if user is linked to a Web Manager account
  const linked = await services.accessStore.getUserByDiscordId(discordUserId);
  if (linked) {
    return qualifiesAsDiscordAdmin && linked.role !== 'admin'
      ? { ...linked, role: 'admin', isPermanent: true }
      : linked;
  }

  if (qualifiesAsDiscordAdmin) {
    return {
      userId: 'admin',
      username: 'Enterprise Admin',
      role: 'admin',
      assignedBotIds: null,
      isPermanent: true
    };
  }

  return null;
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
  // Dynamic guild resolution
  const configGuildId = String(services?.config?.discordGuildId || '').trim();
  let effectiveGuildId = configGuildId;
  if (!effectiveGuildId) {
    try {
      const roleSettings = await services?.managerRuntimeSettings?.getRoleSettings?.();
      if (roleSettings?.guildId) effectiveGuildId = String(roleSettings.guildId).trim();
    } catch (_) {}
  }
  if (effectiveGuildId && interaction?.guildId !== effectiveGuildId) {
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

    // 1. Check Admin Login
    const adminUsername = String(services.config.adminUsername || 'admin').trim();
    if (cleanUsername.toLowerCase() === adminUsername.toLowerCase()) {
      const storedAdminPass = services.registry.getAdminPassword() || services.config.adminPassword;
      if (storedAdminPass && verifyAdminPassword(cleanPassword, storedAdminPass)) {
        resetLoginRateLimit(discordUserId);
        await services.accessStore.linkDiscord(discordUserId, 'admin', 'admin');

        return safeReply(interaction, {
          embeds: [
            embed(
              '✅ ĐĂNG NHẬP THÀNH CÔNG',
              `Đã liên kết Discord với tài khoản **Quản trị viên (ADMIN)**.\n\n` +
              `• **Tài khoản:** \`${cleanUsername}\`\n` +
              `• **Phân quyền:** \`Enterprise Administrator\`\n\n` +
              `Dùng lệnh \`/bots\` để quản lý hoặc \`/admin status\` để xem tình trạng hệ thống.`,
              0x22c55e
            )
          ]
        });
      }
    }

    // 2. Check Regular User Login
    const user = await services.accessStore.getUser(cleanUsername, { bypassCache: true });
    if (!user) {
      return safeReply(interaction, {
        embeds: [embed('❌ ĐĂNG NHẬP THẤT BẠI', 'Tên đăng nhập hoặc mật khẩu không chính xác.', 0xef4444)]
      });
    }

    const storedCredential = user.password || user._rawEncryptedPassword || '';
    const encKey = services.config?.encryptionKey || services.registry?.encryptionKey;
    const passMatch = verifyUserPassword(cleanPassword, storedCredential, encKey);
    if (!passMatch) {
      return safeReply(interaction, {
        embeds: [embed('❌ ĐĂNG NHẬP THẤT BẠI', 'Tên đăng nhập hoặc mật khẩu không chính xác.', 0xef4444)]
      });
    }

    if (user.status === 'disabled') {
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
    await services.accessStore.linkDiscord(discordUserId, user.username, user.id || user.userId || user.username);

    return safeReply(interaction, {
      embeds: [
        embed(
          '✅ ĐĂNG NHẬP THÀNH CÔNG',
          `Đã liên kết tài khoản Discord <@${discordUserId}> với Web Manager.\n\n` +
          `• **Tài khoản Web:** **${user.username}**\n` +
          `• **Gói dịch vụ:** ${user.planName || 'Gói tiêu chuẩn'}\n` +
          `• **Hạn sử dụng:** ${user.isPermanent ? 'Vĩnh viễn' : (user.expiresAt ? new Date(user.expiresAt).toLocaleDateString('vi-VN') : '—')}\n\n` +
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

    const linkedUser = await resolveLinkedUser(interaction, services);
    const isSuperAdmin = linkedUser?.role === 'admin' ||
      (services?.config?.adminUserId && services.config.adminUserId === discordUserId) ||
      (services?.accessControl?.adminUserId && services.accessControl.adminUserId === discordUserId) ||
      interaction.guild?.ownerId === discordUserId;

    if (!isSuperAdmin) {
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

    const hashed = hashAdminPassword(newPassword);
    if (services.accessStore && typeof services.accessStore.setSetting === 'function') {
      await services.accessStore.setSetting('admin_credentials', {
        passwordHash: hashed,
        updatedAt: new Date().toISOString()
      });
    }
    if (typeof services.registry?.setAdminPassword === 'function') {
      services.registry.setAdminPassword(hashed);
    }
    if (typeof services.accessStore?.adapter?.revokeAdminSessions === 'function') {
      await services.accessStore.adapter.revokeAdminSessions().catch(() => null);
    } else if (typeof services.accessStore?.adapter?.revokeUserSessions === 'function') {
      await services.accessStore.adapter.revokeUserSessions('admin').catch(() => null);
    }
    if (typeof services.invalidateAdminSessions === 'function') {
      services.invalidateAdminSessions();
    }

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
      const normalizedUser = { ...user, expiresAt: user.expiresAt || user.expiresAtRental || null };
      const statusStr = String(normalizedUser.status || 'active').toLowerCase();
      const expiryMs = normalizedUser.expiresAt ? Date.parse(normalizedUser.expiresAt) : NaN;
      const isEntitled = services.accessControl?.isEntitled
        ? services.accessControl.isEntitled(normalizedUser)
        : (statusStr === 'active' && (normalizedUser.isPermanent === true || !normalizedUser.expiresAt || (Number.isFinite(expiryMs) && expiryMs > Date.now())));

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

    // Dispatch command and verify actual delivery & non-timeout result
    let notice = '';
    try {
      const dispatchRes = await services.broker.dispatch(workerId, action);
      if (dispatchRes?.delivered === true && !dispatchRes?.timedOut && dispatchRes?.result?.ok !== false) {
        if (typeof services.registry?.updateStatus === 'function') {
          const currentWorker = (await services.registry.find(workerId).catch(() => null)) || worker;
          const currentStatus = currentWorker?.status || {};
          await services.registry.updateStatus(
            workerId,
            { ...currentStatus, manuallyStopped: action === 'stop' },
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
      notice = `❌ Lỗi khi gửi lệnh ${action}: ${err.message}`;
    }

    const updatedWorker = (await services.registry.find(workerId)) || worker;
    const view = renderBotDetail({ user, worker: updatedWorker, notice });
    return safeUpdate(interaction, view);
  }

  // Old log buttons in existing Discord messages now open the concise detail panel.
  if (customId.startsWith('logs:')) {
    const workerId = customId === 'logs:select'
      ? interaction.values?.[0]
      : customId.split(':')[2];
    const worker = workerId ? await services.registry.find(workerId) : null;

    if (!worker || !checkBotOwnership(user, workerId, worker)) {
      return safeUpdate(interaction, {
        embeds: [embed('⛔ BOT KHÔNG KHẢ DỤNG', 'Bot không tồn tại hoặc bạn không có quyền xem bot này.', 0xef4444)],
        components: [renderBotsList({ user, workers: await getUserBots(user, services) }).components[0]]
      });
    }

    return safeUpdate(interaction, renderBotDetail({
      user,
      worker,
      notice: 'Nhật ký bot không hiển thị trên Discord. Hãy dùng Web Manager nếu cần xem log.'
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
  handleStaleWorkerInteraction: async () => {}
};
