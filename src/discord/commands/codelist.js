'use strict';

const { SlashCommandBuilder, escapeMarkdown } = require('discord.js');

const definition = new SlashCommandBuilder()
  .setName('codelist')
  .setDescription('List access codes (admin)')
  .addIntegerOption((option) => option.setName('limit').setDescription('Number of codes to show').setMinValue(1).setMaxValue(25));

function safe(value) { return escapeMarkdown(String(value || '—').replace(/[@\r\n]/g, ' ').slice(0, 100)); }

async function execute(interaction, { entitlements }) {
  const entries = await entitlements.listCodes(interaction.options.getInteger('limit') || 15);
  if (!entries.length) return 'No access codes have been created.';
  return entries.map((entry) => {
    const expires = entry.expiresAt ? new Date(entry.expiresAt).toLocaleDateString('en-GB') : 'never';
    const duration = entry.isPermanent ? 'permanent' : `${entry.days} day(s)`;
    return `• \`${safe(entry.keyId)}\` · ${safe(entry.planName)} · ${duration} · ${entry.usedCount}/${entry.maxUses} used · ${entry.status} · expires ${expires}`;
  }).join('\n').slice(0, 1900);
}

module.exports = { data: definition, execute };
