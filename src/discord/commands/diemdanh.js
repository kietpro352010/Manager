'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed } = require('../panels/renderer');
const { renderCheckinResult, renderLoginRequiredNotice } = require('../panels/points-renderer');
const { resolveLoggedInPointsUser } = require('../../services/discord-points-service');

const definition = new SlashCommandBuilder()
  .setName('diemdanh')
  .setDescription('Điểm danh hằng ngày nhận +10 điểm (mốc mỗi 7 ngày thưởng thêm +30 điểm)');

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

  const displayName =
    interaction.member?.displayName ||
    interaction.user?.globalName ||
    interaction.user?.username ||
    loggedInUser.username ||
    '';

  const result = await pointsService.checkin({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    username: displayName
  });

  return renderCheckinResult({ user: interaction.user, result });
}

module.exports = {
  data: definition,
  ephemeral: false,
  execute
};
