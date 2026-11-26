'use strict';

const { SlashCommandBuilder } = require('discord.js');
const {
  renderBotsList,
  renderUnauthenticatedPanel,
  renderEntitlementBlockedPanel
} = require('../panels/renderer');
const {
  resolveLinkedUser,
  getUserBots,
  isUserAccountEntitled,
  resolvePublicBaseUrl
} = require('../handlers/panel-handler');

const definition = new SlashCommandBuilder()
  .setName('bots')
  .setDescription('Mở bảng điều khiển danh sách bot của tài khoản');

async function execute(interaction, services) {
  const discordUserId = interaction?.user?.id;
  const publicBaseUrl = resolvePublicBaseUrl(services);
  const user = await resolveLinkedUser(interaction, services);
  if (!user) {
    return renderUnauthenticatedPanel({ discordUserId, publicBaseUrl });
  }

  if (user.role !== 'admin') {
    const normalizedUser = { ...user, expiresAt: user.expiresAt || user.expiresAtRental || null };
    if (!isUserAccountEntitled(normalizedUser, services)) {
      return renderEntitlementBlockedPanel({
        user: normalizedUser,
        discordUserId,
        publicBaseUrl
      });
    }
  }

  const userBots = await getUserBots(user, services);
  return renderBotsList({ user, workers: userBots, page: 0 });
}

module.exports = {
  data: definition,
  execute
};
