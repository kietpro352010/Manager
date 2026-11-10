'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed } = require('../panels/renderer');

const definition = new SlashCommandBuilder()
  .setName('logout')
  .setDescription('Đăng xuất và hủy liên kết tài khoản Discord với Web Manager');

async function execute(interaction, services) {
  const discordUserId = interaction.user?.id;
  await services.accessStore.unlinkDiscord(discordUserId);

  return {
    embeds: [
      embed(
        '🚪 ĐÃ ĐĂNG XUẤT',
        'Tài khoản Discord của bạn đã được hủy liên kết khỏi Web Manager thành công.\n\nBạn có thể sử dụng lại lệnh `/login` bất kỳ lúc nào để đăng nhập lại.',
        0x0ea5e9
      )
    ]
  };
}

module.exports = {
  data: definition,
  execute
};
