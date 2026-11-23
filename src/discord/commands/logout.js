'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed } = require('../panels/renderer');

const definition = new SlashCommandBuilder()
  .setName('logout')
  .setDescription('Đăng xuất và hủy liên kết tài khoản Discord với Web Manager');

async function execute(interaction, services) {
  const discordUserId = interaction.user?.id;
  await services.accessStore.unlinkDiscord(discordUserId);
  await services.accessStore?.addAudit?.({
    action: 'DISCORD_LOGOUT',
    actorId: discordUserId,
    targetId: discordUserId,
    details: { guildId: interaction.guildId || null }
  }).catch(() => null);

  let roleNote = '';
  if (services) {
    const { getEffectiveRoleIds, removeMemberRole } = require('../handlers/panel-handler');
    const { adminRoleId, userRoleId } = await getEffectiveRoleIds(services);
    const removed = [];
    if (userRoleId) {
      const ok = await removeMemberRole(interaction, userRoleId);
      if (ok) removed.push(`<@&${userRoleId}>`);
    }
    if (adminRoleId) {
      const ok = await removeMemberRole(interaction, adminRoleId);
      if (ok) removed.push(`<@&${adminRoleId}>`);
    }
    if (removed.length > 0) {
      roleNote = `\n\n🛡️ Đã thu hồi Role: ${removed.join(', ')}`;
    }
  }

  return {
    embeds: [
      embed(
        '🚪 ĐÃ ĐĂNG XUẤT',
        `Tài khoản Discord của bạn đã được hủy liên kết khỏi Web Manager thành công.${roleNote}\n\nBạn có thể sử dụng lại lệnh \`/login\` bất kỳ lúc nào để đăng nhập lại và nhận lại Role.`,
        0x0ea5e9
      )
    ]
  };
}

module.exports = {
  data: definition,
  execute
};
