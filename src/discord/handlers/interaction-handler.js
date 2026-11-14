'use strict';

function isUserAdmin(interaction, services, user) {
  const userId = interaction?.user?.id;
  if (!userId) return false;

  // 1. Configured Admin User ID
  if (services?.config?.adminUserId && services.config.adminUserId === userId) return true;
  if (services?.accessControl?.adminUserId && services.accessControl.adminUserId === userId) return true;

  // 2. Server Owner
  const ownerId = interaction?.guild?.ownerId;
  if (ownerId && ownerId === userId) return true;

  // 3. Discord Administrator Permission
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

  // 4. Configured Manager Admin Role
  const role = services?.accessControl?.roleFor?.(interaction?.member, interaction);
  if (role === 'admin') return true;

  // 5. Linked Database User Role
  if (user?.role === 'admin') return true;

  return false;
}

exports.isUserAdmin = isUserAdmin;

const { loadCommands } = require('../command-registry');
const { handlePanelInteraction, resolveLinkedUser } = require('./panel-handler');

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
  if (interaction.deferred || interaction.replied) return;
  try {
    await interaction.deferReply(options);
  } catch (err) {
    if (!isIgnorableDiscordError(err)) throw err;
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

async function rejectOutsideGuild(interaction, logger, allowedGuildId) {
  if (interaction.inGuild?.() && interaction.guildId === allowedGuildId) return false;
  logger.warn('discord_interaction_outside_allowed_guild', {
    actorId: interaction.user?.id,
    guildId: interaction.guildId || null,
    interactionType: interaction.commandName || interaction.customId || 'unknown'
  });
  const reply = {
    content: 'This manager is available only in its configured Discord server.',
    allowedMentions: { parse: [] },
    ephemeral: true
  };
  await interaction.reply(reply).catch(() => {});
  return true;
}

function attachInteractionHandler(client, { config, services, logger }) {
  client.on('interactionCreate', async (interaction) => {
    try {
      const supportedInteraction = interaction.isChatInputCommand?.()
        || interaction.isButton?.()
        || interaction.isStringSelectMenu?.()
        || interaction.isModalSubmit?.();
      if (supportedInteraction && await rejectOutsideGuild(interaction, logger, config.discordGuildId)) return;

      if (interaction.isChatInputCommand()) {
        const command = commandMap.get(interaction.commandName);
        if (!command) return;

        // Commands that open modals (e.g. /login) MUST NOT be deferred!
        if (command.skipDefer) {
          return await command.execute(interaction, services);
        }

        // SLA Guard < 1200ms: Acknowledge immediately to prevent Discord's 3-second timeout
        await safeDeferReply(interaction, { ephemeral: true });

        // Admin command authorization check
        if (interaction.commandName === 'admin') {
          const user = (services?.accessStore?.getUserByDiscordId && typeof resolveLinkedUser === 'function')
            ? await resolveLinkedUser(interaction, services)
            : null;
          const allowed = isUserAdmin(interaction, services, user);
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
        await handlePanelInteraction(interaction, services);
      }
    } catch (error) {
      logger.warn('discord_interaction_failed', {
        command: interaction.commandName || interaction.customId || 'component',
        actorId: interaction.user?.id,
        message: error.message
      });
      if (services.adminNotifier) {
        void services.adminNotifier.sendAlert({
          type: 'discord_interaction_error',
          severity: 'warn',
          event: interaction.commandName || interaction.customId || 'interaction_failed',
          details: {
            command: interaction.commandName || interaction.customId || 'component',
            user: `<@${interaction.user?.id}> (\`${interaction.user?.id}\`)`,
            error: error.message
          }
        });
      }
      try {
        await safeEditReply(interaction, {
          content: '❌ Đã có lỗi xảy ra khi thực hiện yêu cầu. Vui lòng thử lại sau hoặc liên hệ Admin.',
          allowedMentions: { parse: [] }
        });
      } catch (_) {}
    }
  });
}

module.exports = {
  attachInteractionHandler,
  isUserAdmin,
  requiredRole: () => 'user',
  roleAllows: () => true
};
