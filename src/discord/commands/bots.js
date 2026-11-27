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
const { getMaintenanceState } = require('../../utils/maintenance');

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

  const maintenance = await getMaintenanceState(services?.accessStore || services?.store);

  if (user.role !== 'admin') {
    const normalizedUser = { ...user, expiresAt: user.expiresAt || user.expiresAtRental || null };
    if (!isUserAccountEntitled(normalizedUser, services, maintenance)) {
      return renderEntitlementBlockedPanel({
        user: normalizedUser,
        discordUserId,
        publicBaseUrl
      });
    }
  }

  const userBots = await getUserBots(user, services, maintenance);
  return renderBotsList({ user, workers: userBots, page: 0, maintenance });
}

module.exports = {
  data: definition,
  execute
};
