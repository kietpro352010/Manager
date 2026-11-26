'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { buildLoginModal, renderAlreadyLoggedInPanel } = require('../panels/renderer');
const {
  resolveActiveDiscordAccountLink,
  syncDiscordMemberRolesForUser,
  resolvePublicBaseUrl
} = require('../handlers/panel-handler');

const definition = new SlashCommandBuilder()
  .setName('login')
  .setDescription('Đăng nhập tài khoản Web Manager để liên kết và điều khiển bot');

async function execute(interaction, services) {
  const discordUserId = interaction?.user?.id;
  if (discordUserId && services?.accessStore) {
    let lookupTimer = null;
    try {
      const existingUser = await Promise.race([
        resolveActiveDiscordAccountLink(discordUserId, services),
        new Promise((resolve) => {
          lookupTimer = setTimeout(() => resolve(null), 1500);
          lookupTimer.unref?.();
        })
      ]);
      if (existingUser) {
        let syncTimer = null;
        const roleSyncNote = await Promise.race([
          syncDiscordMemberRolesForUser(interaction, existingUser, services).catch(() => ''),
          new Promise((resolve) => {
            syncTimer = setTimeout(() => resolve(''), 800);
            syncTimer.unref?.();
          })
        ]).finally(() => {
          if (syncTimer) clearTimeout(syncTimer);
        });
        return renderAlreadyLoggedInPanel({
          user: existingUser,
          discordUserId,
          roleSyncNote,
          publicBaseUrl: resolvePublicBaseUrl(services)
        });
      }
    } catch (_) {
      // Fall through to modal if lookup fails transiently; modal submit re-verifies authoritatively
    } finally {
      if (lookupTimer) clearTimeout(lookupTimer);
    }
  }

  const modal = buildLoginModal();
  return interaction.showModal(modal);
}

module.exports = {
  data: definition,
  execute,
  skipDefer: true
};
