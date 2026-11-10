'use strict';

const { loadCommands } = require('../command-registry');
const { handlePanelInteraction } = require('./panel-handler');

const commands = loadCommands();
const commandMap = new Map(commands.map((command) => [command.data.name, command]));

function requiredRole(interaction) {
  if (interaction.commandName === 'setup') return 'setup';
  if (interaction.commandName === 'bot') {
    const subcommand = interaction.options.getSubcommand(false);
    return ['add', 'remove', 'rotate-secret', 'reset', 'stop-all', 'reconnect-errors', 'clean-dead'].includes(subcommand) ? 'admin' : 'user';
  }
  if (['user', 'wispbyte', 'render'].includes(interaction.commandName)) return 'admin';
  return 'user';
}

function roleAllows(role, required) { return role === 'admin' || (required === 'user' && role === 'user'); }

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

async function isAuthorizedSetupUser(interaction, services) {
  const userId = interaction.user?.id;
  if (!userId) return false;

  // 1. Configured Admin User ID (from Render environment or saved settings)
  if (services.config.adminUserId && services.config.adminUserId === userId) return true;
  if (services.accessControl.adminUserId && services.accessControl.adminUserId === userId) return true;

  // 2. Discord Server Owner
  let ownerId = interaction.guild?.ownerId;
  if (!ownerId && interaction.guild?.fetch) {
    try {
      const g = await interaction.guild.fetch();
      ownerId = g?.ownerId;
    } catch (_) {}
  }
  if (ownerId && ownerId === userId) return true;

  // 3. User with Administrator permission in this Discord server
  try {
    if (interaction.memberPermissions?.has('Administrator') || interaction.memberPermissions?.has(8n)) {
      return true;
    }
  } catch (_) {}
  try {
    if (typeof interaction.member?.permissions?.has === 'function') {
      if (interaction.member.permissions.has('Administrator') || interaction.member.permissions.has(8n)) {
        return true;
      }
    } else if (interaction.member?.permissions && (BigInt(interaction.member.permissions) & 8n)) {
      return true;
    }
  } catch (_) {}

  // 4. Configured Manager Admin role
  const role = services.accessControl.roleFor(interaction.member, interaction);
  if (role === 'admin') return true;

  return false;
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

        // SLA Guard < 1200ms: Acknowledge immediately to prevent Discord's 3-second timeout ("The application did not respond")
        await safeDeferReply(interaction, { ephemeral: true });

        const role = services.accessControl.roleFor(interaction.member, interaction);
        if (interaction.commandName === 'setup') {
          const allowed = await isAuthorizedSetupUser(interaction, services);
          if (!allowed) {
            return safeEditReply(interaction, {
              content: 'Chỉ Chủ sở hữu máy chủ Discord (Server Owner), Quản trị viên (Administrator), hoặc Admin được cấu hình mới có quyền chạy lệnh /setup.',
              allowedMentions: { parse: [] }
            });
          }
          const message = await command.execute(interaction, services);
          await safeEditReply(interaction, { ...commandReply(message), allowedMentions: { parse: [] } });
          return;
        }
        if (!services.accessControl.isConfigured()) {
          return safeEditReply(interaction, {
            content: 'Manager chưa được cấu hình vai trò trên máy chủ này. Chủ sở hữu hoặc Quản trị viên hãy dùng `/setup` trước.',
            allowedMentions: { parse: [] }
          });
        }
        if (!roleAllows(role, requiredRole(interaction))) {
          const text = role
            ? 'Hành động này yêu cầu quyền Admin.'
            : 'Bạn cần được gán Role Admin hoặc Role User đã được cấu hình trong server này để sử dụng bot.';
          return safeEditReply(interaction, { content: text, allowedMentions: { parse: [] } });
        }
        const message = await command.execute(interaction, services);
        await safeEditReply(interaction, { ...commandReply(message), allowedMentions: { parse: [] } });
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
          source: 'Discord Interaction',
          event: interaction.commandName || interaction.customId || 'interaction_failed',
          message: `Lệnh/Thao tác Discord thất bại: ${error.message}`,
          error,
          details: {
            command: interaction.commandName || interaction.customId || 'component',
            user: `<@${interaction.user?.id}> (\`${interaction.user?.id}\`)`
          },
          level: 'warn'
        });
      }
      const message = `Action failed: ${String(error.message || 'unknown error').slice(0, 800)}`;
      await safeEditReply(interaction, { content: message, allowedMentions: { parse: [] } });
    }
  });

  client.on('error', (error) => logger.error('discord_client_error', { message: error.message }));
  return commands;
}

module.exports = { attachInteractionHandler, rejectOutsideGuild };
