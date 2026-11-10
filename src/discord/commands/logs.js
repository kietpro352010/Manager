'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { renderBotLogs, embed } = require('../panels/renderer');
const { resolveLinkedUser, getUserBots } = require('../handlers/panel-handler');

const definition = new SlashCommandBuilder()
  .setName('logs')
  .setDescription('Xem nhật ký hoạt động gần nhất của bot')
  .addStringOption((opt) =>
    opt.setName('bot')
      .setDescription('Mã định danh hoặc số thứ tự bot (tùy chọn)')
      .setRequired(false)
  );

async function execute(interaction, services) {
  const user = await resolveLinkedUser(interaction, services);
  if (!user) {
    return {
      embeds: [
        embed(
          '⚠️ CHƯA ĐĂNG NHẬP',
          'Bạn chưa liên kết tài khoản Discord với Web Manager.\n\nVui lòng sử dụng lệnh `/login` để nhập Username và Password tài khoản Web.',
          0xf59e0b
        )
      ]
    };
  }

  const userBots = await getUserBots(user, services);
  if (userBots.length === 0) {
    return {
      embeds: [
        embed(
          '⚠️ CHƯA CÓ BOT',
          'Tài khoản của bạn hiện chưa được phân bổ bot nào. Hãy liên hệ Admin hoặc truy cập Web Manager để tạo bot.',
          0xf59e0b
        )
      ]
    };
  }

  const requestedInput = interaction.options?.getString('bot')?.trim();
  let targetWorker = null;

  if (requestedInput) {
    targetWorker = userBots.find((b) =>
      String(b.workerId).toLowerCase() === requestedInput.toLowerCase() ||
      String(b.botNumber) === requestedInput ||
      (b.name && b.name.toLowerCase() === requestedInput.toLowerCase())
    );
    if (!targetWorker) {
      return {
        embeds: [
          embed(
            '❌ KHÔNG TÌM THẤY BOT',
            `Không tìm thấy bot \`${requestedInput}\` trong danh sách bot thuộc quyền quản lý của bạn.`,
            0xef4444
          )
        ]
      };
    }
  } else {
    targetWorker = userBots[0];
  }

  const logs = services.registry.getLogs(targetWorker.workerId);
  return renderBotLogs({ user, worker: targetWorker, logs, userBots });
}

module.exports = {
  data: definition,
  execute
};
