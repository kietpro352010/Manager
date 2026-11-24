'use strict';

async function getEffectiveAllowedGuildId(config, services) {
  if (config?.discordGuildId && String(config.discordGuildId).trim()) {
    return String(config.discordGuildId).trim();
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

function isSuperAdmin(interaction, services, resolvedAllowedGuildId = undefined) {
  if (!interaction?.guildId) return false;
  const userId = interaction?.user?.id;
  if (!userId) return false;

  const isConfiguredAdmin = Boolean(
    (services?.config?.adminUserId && services.config.adminUserId === userId) ||
    (services?.accessControl?.adminUserId && services.accessControl.adminUserId === userId)
  );
  if (isConfiguredAdmin) return true;

  const allowedGuildId = resolvedAllowedGuildId !== undefined
    ? String(resolvedAllowedGuildId || '').trim()
    : String(services?.config?.discordGuildId || '').trim();
  const isAllowedGuild = Boolean(allowedGuildId && interaction.guildId === allowedGuildId);
  if (!isAllowedGuild) return false;

  const ownerId = interaction?.guild?.ownerId;
  return Boolean(ownerId && ownerId === userId);
}

function isUserAdmin(interaction, services, user, resolvedAllowedGuildId = undefined) {
  if (!interaction?.guildId) return false;
  const userId = interaction?.user?.id;
  if (!userId) return false;

  // 1. Configured Admin User ID
  if (services?.config?.adminUserId && services.config.adminUserId === userId) return true;
  if (services?.accessControl?.adminUserId && services.accessControl.adminUserId === userId) return true;

  const allowedGuildId = resolvedAllowedGuildId !== undefined
    ? String(resolvedAllowedGuildId || '').trim()
    : String(services?.config?.discordGuildId || '').trim();
  const isAllowedGuild = Boolean(allowedGuildId && interaction.guildId === allowedGuildId);

  if (isAllowedGuild) {
    // 2. Server Owner (scoped to configured guild)
    const ownerId = interaction?.guild?.ownerId;
    if (ownerId && ownerId === userId) return true;

    // 3. Discord Administrator Permission (scoped to configured guild)
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

    // 4. Configured Manager Admin Role (scoped to configured guild)
    const role = services?.accessControl?.roleFor?.(interaction?.member, interaction);
    if (role === 'admin') return true;
  }

  // 5. Linked Database User Role (must not be disabled)
  if (user?.role === 'admin' && String(user?.status || 'active').toLowerCase() !== 'disabled') return true;

  return false;
}

exports.isSuperAdmin = isSuperAdmin;
exports.isUserAdmin = isUserAdmin;
exports.getEffectiveAllowedGuildId = getEffectiveAllowedGuildId;

const { loadCommands } = require('../command-registry');
const { handlePanelInteraction, resolveLinkedUser, hasAuthorizedRole } = require('./panel-handler');

const commands = loadCommands();
const commandMap = new Map(commands.map((command) => [command.data.name, command]));

function isIgnorableDiscordError(err) {
  if (!err) return false;
  const code = err.code || err.rawError?.code;
  const msg = String(err.message || '').toLowerCase();
  return (
    code === 10062 || // Unknown interaction (token expired > 3s)
    code === 40060 || // Interaction has already been acknowledged
    msg.includes('unknown interaction') ||
    msg.includes('already been acknowledged')
  );
}

async function safeDeferReply(interaction, options = { ephemeral: true }) {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply(options);
    return true;
  } catch (err) {
    const code = err?.code || err?.rawError?.code;
    if (code === 10062) return false;
    if (isIgnorableDiscordError(err)) return true;
    throw err;
  }
}

async function safeEditReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }
    return await interaction.reply(payload);
  } catch (err) {
    if (isIgnorableDiscordError(err)) return null;
    try {
      return await interaction.followUp({ ...payload, ephemeral: true });
    } catch (fErr) {
      if (!isIgnorableDiscordError(fErr)) throw fErr;
      return null;
    }
  }
}

function commandReply(message) {
  if (typeof message === 'string') return { content: message };
  return message;
}

async function rejectOutsideGuild(interaction, logger, allowedGuildOrConfig, services) {
  if (!interaction?.isChatInputCommand?.() && !interaction?.isButton?.() && !interaction?.isStringSelectMenu?.() && !interaction?.isModalSubmit?.()) {
    return false;
  }

  // Reject all direct messages (DMs) unconditionally (DISCORD-01)
  if (!interaction?.guildId) {
    logger?.warn?.('discord_interaction_dm_rejected', {
      actorId: interaction?.user?.id,
      interactionType: interaction?.commandName || interaction?.customId || 'unknown'
    });
    const reply = {
      content: 'This manager is available only in its configured Discord server (DMs are not supported).',
      allowedMentions: { parse: [] },
      ephemeral: true
    };
    await interaction?.reply?.(reply)?.catch?.(() => {});
    return true;
  }

  let allowedGuildId = '';
  if (typeof allowedGuildOrConfig === 'string') {
    allowedGuildId = allowedGuildOrConfig.trim();
    if (!allowedGuildId && services) {
      allowedGuildId = await getEffectiveAllowedGuildId(services?.config, services);
    }
  } else if (allowedGuildOrConfig && typeof allowedGuildOrConfig === 'object') {
    allowedGuildId = await getEffectiveAllowedGuildId(allowedGuildOrConfig, services);
  } else {
    allowedGuildId = await getEffectiveAllowedGuildId(services?.config, services);
  }

  // Fail-closed when no allowed guild is configured: ONLY allow /admin setup by configured adminUserId (DISCORD-01).
  if (!allowedGuildId) {
    const subcommand = interaction?.isChatInputCommand?.() && interaction.commandName === 'admin'
      ? (() => { try { return interaction.options?.getSubcommand?.(false); } catch { return null; } })()
      : null;
    const configuredAdminId = services?.config?.adminUserId || services?.accessControl?.adminUserId || '';
    const isBootstrapSetup = subcommand === 'setup' && Boolean(configuredAdminId && interaction?.user?.id === configuredAdminId);
    if (isBootstrapSetup) {
      return false;
    }
    logger?.warn?.('discord_interaction_unconfigured_guild_rejected', {
      actorId: interaction?.user?.id,
      guildId: interaction?.guildId || null,
      interactionType: interaction?.commandName || interaction?.customId || 'unknown'
    });
    const reply = {
      content: 'This manager has not configured an allowed Discord server yet. Only the configured Admin can run /admin setup.',
      allowedMentions: { parse: [] },
      ephemeral: true
    };
    await interaction?.reply?.(reply)?.catch?.(() => {});
    return true;
  }

  if (interaction?.guildId === allowedGuildId) {
    return false;
  }

  logger?.warn?.('discord_interaction_outside_allowed_guild', {
    actorId: interaction?.user?.id,
    guildId: interaction?.guildId || null,
    allowedGuildId,
    interactionType: interaction?.commandName || interaction?.customId || 'unknown'
  });
  const reply = {
    content: 'This manager is available only in its configured Discord server.',
    allowedMentions: { parse: [] },
    ephemeral: true
  };
  await interaction?.reply?.(reply)?.catch?.(() => {});
  return true;
}

function attachInteractionHandler(client, { config, services, logger }) {
  client.on('interactionCreate', async (interaction) => {
    try {
      const supportedInteraction = interaction.isChatInputCommand?.()
        || interaction.isButton?.()
        || interaction.isStringSelectMenu?.()
        || interaction.isModalSubmit?.();
      if (supportedInteraction && await rejectOutsideGuild(interaction, logger, config, services)) return;

      if (interaction.isChatInputCommand()) {
        const command = commandMap.get(interaction.commandName);
        if (!command) return;

        // Commands that open modals (e.g. /login, /admin password without inline option) MUST NOT be deferred!
        const shouldSkip = Boolean(command.skipDefer)
          || (typeof command.shouldSkipDefer === 'function' && command.shouldSkipDefer(interaction));
        if (shouldSkip) {
          const message = await command.execute(interaction, services);
          if (message && !interaction.replied && !interaction.deferred) {
            await safeEditReply(interaction, { ...commandReply(message), allowedMentions: { parse: [] }, ephemeral: true });
          }
          return;
        }

        // SLA Guard < 1200ms: Defer immediately BEFORE slow DB/role lookups (DISCORD-10)
        const isEphemeral = command.ephemeral !== false;
        const acked = await safeDeferReply(interaction, { ephemeral: isEphemeral });
        if (!acked) return;

        // RBAC Role Gate: /login, /logout and community points commands do not require Web role linkage (DISCORD-12).
        const PUBLIC_SERVER_COMMANDS = new Set(['login', 'logout', 'diemdanh', 'diem', 'bxh', 'tinnhan']);
        if (!PUBLIC_SERVER_COMMANDS.has(interaction.commandName)) {
          const hasRole = await hasAuthorizedRole(interaction, services);
          if (!hasRole) {
            const { embed } = require('../panels/renderer');
            return safeEditReply(interaction, {
              embeds: [
                embed(
                  '⛔ BẠN CHƯA CÓ ROLE SỬ DỤNG BOT',
                  'Bạn chưa có Role thành viên hoặc chưa đăng nhập tài khoản Web Manager.\n\n' +
                  '👉 Vui lòng sử dụng lệnh `/login` để đăng nhập và nhận Role tự động.',
                  0xef4444
                )
              ],
              allowedMentions: { parse: [] }
            });
          }
        }

        // Admin command authorization check
        if (['admin', 'wispbyte', 'check', 'kbot', 'diemadmin'].includes(interaction.commandName)) {
          const allowedGuildId = await getEffectiveAllowedGuildId(config, services);
          const user = (services?.accessStore?.getUserByDiscordId && typeof resolveLinkedUser === 'function')
            ? await resolveLinkedUser(interaction, services)
            : null;
          const allowed = isUserAdmin(interaction, services, user, allowedGuildId);
          if (!allowed) {
            return safeEditReply(interaction, {
              content: '⛔ Bạn không có quyền truy cập lệnh Quản trị viên (Admin).',
              allowedMentions: { parse: [] }
            });
          }
        }

        const message = await command.execute(interaction, services);
        if (message) {
          await safeEditReply(interaction, { ...commandReply(message), allowedMentions: { parse: [] } });
        }
        return;
      }

      if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
        const panelServices = services?.config?.discordGuildId
          ? services
          : { ...(services || {}), config: { ...(config || {}), ...(services?.config || {}), discordGuildId: services?.config?.discordGuildId || config?.discordGuildId || '' } };
        await handlePanelInteraction(interaction, panelServices);
      }
    } catch (error) {
      logger.warn('discord_interaction_failed', {
        command: interaction.commandName || interaction.customId || 'component',
        actorId: interaction.user?.id,
        message: error.message
      });
      if (services.adminNotifier) {
        Promise.resolve(services.adminNotifier.sendAlert({
          source: 'Discord Interaction',
          event: interaction.commandName || interaction.customId || 'discord_interaction_error',
          message: error.message || 'Discord interaction failed',
          error,
          level: 'warn',
          details: {
            command: interaction.commandName || interaction.customId || 'component',
            user: `<@${interaction.user?.id}> (\`${interaction.user?.id}\`)`,
            error: error.message
          }
        })).catch(() => {});
      }
      try {
        await safeEditReply(interaction, {
          content: '❌ Đã có lỗi xảy ra khi thực hiện yêu cầu. Vui lòng thử lại sau hoặc liên hệ Admin.',
          allowedMentions: { parse: [] },
          ephemeral: true
        });
      } catch (_) {}
    }
  });
}

module.exports = {
  attachInteractionHandler,
  isSuperAdmin,
  isUserAdmin,
  hasAuthorizedRole,
  rejectOutsideGuild,
  getEffectiveAllowedGuildId,
  requiredRole: () => 'user',
  roleAllows: () => true
};
