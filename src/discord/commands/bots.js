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

  const userBots = await getUserBots(user, services);
  return renderBotsList({ user, workers: userBots, page: 0 });
}

module.exports = {
  data: definition,
  execute
};
