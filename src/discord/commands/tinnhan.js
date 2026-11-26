'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed } = require('../panels/renderer');
const { renderUserMessagesStats, renderLoginRequiredNotice } = require('../panels/points-renderer');
const { resolveLoggedInPointsUser } = require('../../services/discord-points-service');

const definition = new SlashCommandBuilder()
  .setName('tinnhan')
  .setDescription('Xem tổng số tin nhắn từ trước tới nay của bạn hoặc người khác')
  .addUserOption((opt) =>
    opt.setName('nguoidung')
      .setDescription('Thành viên muốn xem số tin nhắn (để trống để xem của chính bạn)')
      .setRequired(false)
  );

async function execute(interaction, services) {
  const callerLinked = await resolveLoggedInPointsUser(interaction.user?.id, services);
  if (!callerLinked) {
    return renderLoginRequiredNotice(interaction.user?.id);
  }

  const pointsService = services?.discordPoints;
  if (!pointsService) {
    return {
      embeds: [embed('❌ CHƯA SẴN SÀNG', 'Hệ thống điểm tích lũy chưa được khởi tạo.', 0xef4444)]
    };
  }

  const targetUser = interaction.options?.getUser?.('nguoidung') || interaction.user;
  if (targetUser?.bot) {
    return {
      embeds: [embed('🤖 KHÔNG ÁP DỤNG CHO BOT', 'Không tính điểm hoặc thống kê tin nhắn cho tài khoản bot Discord.', 0xf59e0b)]
    };
  }

  if (targetUser.id !== interaction.user.id) {
    const targetLinked = await resolveLoggedInPointsUser(targetUser.id, services);
    if (!targetLinked) {
      return {
        embeds: [
          embed(
            '⏳ CHƯA THAM GIA TÍCH ĐIỂM',
            `<@${targetUser.id}> chưa đăng nhập tài khoản Web bằng \`/login\` nên chưa có thống kê tin nhắn.`,
            0xf59e0b
          )
        ]
      };
    }
  }

  const targetName = targetUser.globalName || targetUser.username || '';
  const profile = await pointsService.getProfile({
    guildId: interaction.guildId,
    userId: targetUser.id,
    username: targetName
  });

  return renderUserMessagesStats({ targetUser, profile });
}

module.exports = {
  data: definition,
  ephemeral: false,
  execute
};
