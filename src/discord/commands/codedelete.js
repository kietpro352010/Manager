'use strict';

const { SlashCommandBuilder } = require('discord.js');

const definition = new SlashCommandBuilder()
  .setName('codedelete')
  .setDescription('Xóa mã code kích hoạt (Admin)')
  .addStringOption((option) => option.setName('id').setDescription('Code ID cần xóa từ /codelist (VD: code_abc123)').setRequired(true).setMinLength(8).setMaxLength(64));

async function execute(interaction, { entitlements, accessStore }) {
  const keyId = interaction.options.getString('id', true).trim();
  const removed = await entitlements.deleteCode(keyId);
  if (removed) await accessStore.addAudit({ actorId: interaction.user.id, action: 'code.delete', target: keyId });
  return removed ? `Deleted code \`${keyId}\`.` : `No code found with ID \`${keyId}\`.`;
}

module.exports = { data: definition, execute };
