'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed } = require('../panels/renderer');
const {
  renderLoginRequiredNotice
} = require('../panels/points-renderer');
const { buildBxhPanel, BXH_MONITOR_SETTING_KEY } = require('../bxh-monitor');
const { resolveLoggedInPointsUser } = require('../../services/discord-points-service');

const definition = new SlashCommandBuilder()
  .setName('bxh')
  .setDescription('Xem Top 10 Điểm tích lũy, Chuỗi điểm danh và Tổng tin nhắn (tự cập nhật mỗi 15 phút)')
  .addStringOption((opt) =>
    opt.setName('loai')
      .setDescription('Chế độ hiển thị (mặc định: Tổng hợp cả 3 Top 10)')
      .setRequired(false)
      .addChoices(
        { name: '📊 Tổng hợp (Top 10 Điểm + Chuỗi + Tin nhắn)', value: 'tatca' },
        { name: '🏆 Chỉ Điểm tích lũy', value: 'diem' },
        { name: '🔥 Chỉ Chuỗi điểm danh', value: 'chuoi' },
        { name: '💬 Chỉ Tổng tin nhắn', value: 'tinnhan' }
      )
  )
  .addIntegerOption((opt) =>
    opt.setName('soluong')
      .setDescription('Số lượng hiển thị mỗi bảng (5–20, mặc định 10)')
      .setRequired(false)
      .setMinValue(5)
      .setMaxValue(20)
  );

async function execute(interaction, services) {
  const loggedInUser = await resolveLoggedInPointsUser(interaction.user?.id, services);
  if (!loggedInUser) {
    return renderLoginRequiredNotice(interaction.user?.id);
  }

  const pointsService = services?.discordPoints;
  if (!pointsService) {
    return {
      embeds: [embed('❌ CHƯA SẴN SÀNG', 'Hệ thống điểm tích lũy chưa được khởi tạo.', 0xef4444)]
    };
  }

  const type = interaction.options?.getString?.('loai') || 'tatca';
  const limit = interaction.options?.getInteger?.('soluong') || 10;
  const intervalMs = services?.bxhMonitor?.intervalMs || 15 * 60 * 1000;
  const guildName = interaction.guild?.name || 'Server';

  const rendered = await buildBxhPanel(services, {
    guildId: interaction.guildId,
    guildName,
    type,
    limit,
    viewerUserId: interaction.user?.id,
    updatedAtMs: Date.now(),
    intervalMs,
    hasViewer: true
  });
  const panel = { embeds: rendered.embeds, components: rendered.components };

  if (interaction.deferred) {
    const msg = await interaction.editReply({ ...panel, allowedMentions: { parse: [] } });
    const messageId = msg?.id || (await interaction.fetchReply?.().catch(() => null))?.id;
    const channelId = interaction.channelId;
    const guildId = interaction.guildId;

    if (channelId && messageId) {
      const entry = {
        guildId: guildId || null,
        guildName,
        channelId,
        messageId,
        type: rendered.type,
        limit: rendered.limit,
        updatedAt: new Date(rendered.updatedAtMs).toISOString()
      };
      if (services?.bxhMonitor?.trackMessage) {
        await services.bxhMonitor.trackMessage(entry).catch(() => null);
      } else if (services?.accessStore?.setSetting) {
        await services.accessStore.setSetting(BXH_MONITOR_SETTING_KEY, {
          entries: [entry],
          updatedAt: entry.updatedAt
        }).catch(() => null);
      }
    }
    return null;
  }

  return panel;
}

module.exports = {
  data: definition,
  ephemeral: false,
  execute
};
