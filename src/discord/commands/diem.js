'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed } = require('../panels/renderer');
const { renderUserPointsProfile, renderLoginRequiredNotice } = require('../panels/points-renderer');
const { resolveLoggedInPointsUser } = require('../../services/discord-points-service');

const definition = new SlashCommandBuilder()
  .setName('diem')
  .setDescription('Xem điểm tích lũy, chuỗi điểm danh và tổng tin nhắn của bạn hoặc người khác')
  .addUserOption((opt) =>
    opt.setName('nguoidung')
      .setDescription('Thành viên muốn xem điểm (để trống để xem của chính bạn)')
      .setRequired(false)
  );

async function execute(interaction, services) {
  const callerLinked = await resolveLoggedInPointsUser(interaction.user?.id, services);
  if (!callerLinked) {
    return renderLoginRequiredNotice();
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
      embeds: [embed('🤖 KHÔNG ÁP DỤNG CHO BOT', 'Không tính điểm hoặc chuỗi điểm danh cho tài khoản bot Discord.', 0xf59e0b)]
    };
  }

  if (targetUser.id !== interaction.user.id) {
    const targetLinked = await resolveLoggedInPointsUser(targetUser.id, services);
    if (!targetLinked) {
      return {
        embeds: [
          embed(
            '⏳ CHƯA THAM GIA TÍCH ĐIỂM',
            `<@${targetUser.id}> chưa đăng nhập tài khoản Web bằng \`/login\` nên chưa tham gia hệ thống tích điểm.`,
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

  return renderUserPointsProfile({ targetUser, profile });
}

module.exports = {
  data: definition,
  ephemeral: false,
  execute
};
