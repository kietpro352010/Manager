'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed } = require('../panels/renderer');
const {
  renderPointsLeaderboard,
  renderCombinedPointsLeaderboard,
  renderLoginRequiredNotice
} = require('../panels/points-renderer');
const { resolveLoggedInPointsUser } = require('../../services/discord-points-service');

const definition = new SlashCommandBuilder()
  .setName('bxh')
  .setDescription('Xem Top 10 Điểm tích lũy, Chuỗi điểm danh và Tổng tin nhắn')
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

  if (type === 'tatca') {
    const combined = await pointsService.getCombinedLeaderboards({
      guildId: interaction.guildId,
      limit,
      viewerUserId: interaction.user?.id
    });
    return renderCombinedPointsLeaderboard({
      guildName: interaction.guild?.name || 'Server',
      combined
    });
  }

  const leaderboard = await pointsService.getLeaderboard({
    guildId: interaction.guildId,
    type,
    limit,
    viewerUserId: interaction.user?.id
  });

  return renderPointsLeaderboard({
    guildName: interaction.guild?.name || 'Server',
    leaderboard
  });
}

module.exports = {
  data: definition,
  ephemeral: false,
  execute
};
