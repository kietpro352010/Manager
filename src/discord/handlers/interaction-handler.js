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
  if (interaction.commandName === 'render') return 'admin';
  if (interaction.commandName === 'code') return 'user';
  if (interaction.commandName === 'link4m') return interaction.options.getSubcommand() === 'configure' ? 'admin' : 'user';
  if (['codecreate', 'codelist', 'codedelete', 'user', 'wispbyte'].includes(interaction.commandName)) return 'admin';
  return 'user';
}

function roleAllows(role, required) { return role === 'admin' || (required === 'user' && role === 'user'); }

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
        const role = services.accessControl.roleFor(interaction.member);
        if (interaction.commandName === 'setup') {
          const isGuildOwner = interaction.guild?.ownerId === interaction.user.id;
          const allowed = services.accessControl.isConfigured() ? role === 'admin' : isGuildOwner;
          if (!allowed) {
            return interaction.reply({ content: services.accessControl.isConfigured()
              ? 'Only the configured manager Admin role can change setup.'
              : 'Only the Discord server owner can run the initial manager setup.', ephemeral: true, allowedMentions: { parse: [] } });
          }
          await interaction.deferReply({ ephemeral: true });
          const message = await command.execute(interaction, services);
          await interaction.editReply({ ...commandReply(message), allowedMentions: { parse: [] } });
          return;
        }
        if (!services.accessControl.isConfigured()) {
          return interaction.reply({ content: 'Manager setup is incomplete. The Discord server owner must run `/setup` in this server first.', ephemeral: true, allowedMentions: { parse: [] } });
        }
        if (!roleAllows(role, requiredRole(interaction))) {
          const text = role
            ? 'This action requires admin access.'
            : 'This manager requires the configured Discord Admin or User role in this server.';
          return interaction.reply({ content: text, ephemeral: true, allowedMentions: { parse: [] } });
        }
        await interaction.deferReply({ ephemeral: true });
        const message = await command.execute(interaction, services);
        await interaction.editReply({ ...commandReply(message), allowedMentions: { parse: [] } });
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
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
      else await interaction.reply({ content: message, ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
    }
  });

  client.on('error', (error) => logger.error('discord_client_error', { message: error.message }));
  return commands;
}

module.exports = { attachInteractionHandler, rejectOutsideGuild };
