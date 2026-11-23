'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { renderStatusMonitorPanel, embed } = require('../panels/renderer');
const { collectSystemStatus } = require('../status-monitor');

function checkUserAdmin(interaction, services, user, allowedGuildId) {
  const { isUserAdmin } = require('../handlers/interaction-handler');
  return isUserAdmin(interaction, services, user, allowedGuildId);
}

const definition = new SlashCommandBuilder()
  .setName('check')
  .setDescription('Gửi bảng theo dõi trạng thái hệ thống All-in-One (Chỉ dành cho Admin)');

async function execute(interaction, services) {
  const { resolveLinkedUser } = require('../handlers/panel-handler');
  const { getEffectiveAllowedGuildId } = require('../handlers/interaction-handler');
  const allowedGuildId = await getEffectiveAllowedGuildId(services?.config, services);
  const user = (services?.accessStore?.getUserByDiscordId && typeof resolveLinkedUser === 'function')
    ? await resolveLinkedUser(interaction, services).catch(() => null)
    : null;

  const isAdmin = checkUserAdmin(interaction, services, user, allowedGuildId);
  if (!isAdmin) {
    return {
      embeds: [
        embed(
          '⛔ TỪ CHỐI TRUY CẬP',
          'Lệnh `/check` chỉ dành cho **Quản trị viên (Admin)** để gửi bảng theo dõi hệ thống.',
          0xef4444
        )
      ]
    };
  }

  const statusData = await collectSystemStatus(services, {
    intervalMs: services?.statusMonitor?.intervalMs || 15 * 60 * 1000
  });
  const panel = renderStatusMonitorPanel(statusData);

  // If already deferred by interaction-handler (with ephemeral: false)
  if (interaction.deferred) {
    const msg = await interaction.editReply({ ...panel, allowedMentions: { parse: [] } });
    const messageId = msg?.id || (await interaction.fetchReply?.().catch(() => null))?.id;
    const channelId = interaction.channelId;
    const guildId = interaction.guildId;

    if (channelId && messageId) {
      const tracked = {
        guildId: guildId || null,
        channelId,
        messageId,
        updatedAt: statusData.checkedAt || new Date().toISOString()
      };
      if (services?.accessStore?.setSetting) {
        await services.accessStore.setSetting('discord_status_monitor', tracked).catch(() => null);
      }
      if (services?.statusMonitor?.setTrackedMessage) {
        services.statusMonitor.setTrackedMessage(tracked);
      }
    }
    return null;
  }

  return panel;
}

module.exports = {
  data: definition,
  execute,
  ephemeral: false // Defer publicly so the monitor is visible to everyone in the channel
};
