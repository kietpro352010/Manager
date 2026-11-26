'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { renderUnauthenticatedPanel, renderLoggedOutPanel } = require('../panels/renderer');
const { performDiscordLogout, resolvePublicBaseUrl } = require('../handlers/panel-handler');

const definition = new SlashCommandBuilder()
  .setName('logout')
  .setDescription('Đăng xuất và hủy liên kết tài khoản Discord với Web Manager');

async function execute(interaction, services) {
  const discordUserId = interaction?.user?.id;
  const res = await performDiscordLogout(interaction, services);

  if (res.checkedExisting && !res.wasLoggedIn && res.removedRoles.length === 0) {
    return renderUnauthenticatedPanel({
      discordUserId,
      title: 'ℹ️ BẠN CHƯA ĐĂNG NHẬP',
      reason: 'Tài khoản Discord của bạn hiện chưa liên kết với tài khoản Web Manager nào.\n\n👉 Bấm nút **Đăng nhập ngay** bên dưới (hoặc dùng `/login`) nếu bạn muốn đăng nhập.',
      publicBaseUrl: resolvePublicBaseUrl(services)
    });
  }

  return renderLoggedOutPanel({
    discordUserId,
    unlinkedUsername: res.unlinkedUsername,
    removedRoles: res.removedRoles,
    includeReloginButton: Boolean(discordUserId)
  });
}

module.exports = {
  data: definition,
  execute
};
