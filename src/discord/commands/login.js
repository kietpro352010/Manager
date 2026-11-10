'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { buildLoginModal } = require('../panels/renderer');

const definition = new SlashCommandBuilder()
  .setName('login')
  .setDescription('Đăng nhập tài khoản Web Manager để liên kết và điều khiển bot');

async function execute(interaction) {
  // Show modal directly as the first response
  const modal = buildLoginModal();
  return interaction.showModal(modal);
}

module.exports = {
  data: definition,
  execute,
  skipDefer: true
};
