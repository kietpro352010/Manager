'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { renderBotsList, embed } = require('../panels/renderer');
const { resolveLinkedUser, getUserBots } = require('../handlers/panel-handler');

const definition = new SlashCommandBuilder()
  .setName('bots')
  .setDescription('Mở bảng điều khiển danh sách bot của tài khoản');

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

  if (user.role !== 'admin') {
    const isEntitled = services?.accessControl?.isEntitled
      ? services.accessControl.isEntitled(user)
      : (String(user.status || 'active').toLowerCase() !== 'disabled' && (user.isPermanent === true || (user.expiresAt && new Date(user.expiresAt).getTime() > Date.now())));

    if (!isEntitled) {
      const isLocked = String(user.status || 'active').toLowerCase() === 'disabled';
      const title = isLocked ? '⛔ TÀI KHOẢN BỊ KHÓA' : '⛔ TÀI KHOẢN HẾT HẠN HOẶC BỊ KHÓA';
      const desc = isLocked
        ? 'Tài khoản của bạn đã bị vô hiệu hóa bởi Quản trị viên.'
        : 'Tài khoản của bạn đã hết hạn thuê bot hoặc bị vô hiệu hóa. Vui lòng gia hạn trên Web Manager để tiếp tục sử dụng bot.';
      return {
        embeds: [embed(title, desc, 0xef4444)]
      };
    }
  }

  const userBots = await getUserBots(user, services);
  return renderBotsList({ user, workers: userBots, page: 0 });
}

module.exports = {
  data: definition,
  execute
};
