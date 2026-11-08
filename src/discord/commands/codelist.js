'use strict';

const { SlashCommandBuilder, escapeMarkdown } = require('discord.js');

const definition = new SlashCommandBuilder()
  .setName('codelist')
  .setDescription('List access codes (admin)')
  .addIntegerOption((option) => option.setName('limit').setDescription('Number of codes to show').setMinValue(1).setMaxValue(25));

function safe(value) { return escapeMarkdown(String(value || '—').replace(/[@\r\n]/g, ' ').slice(0, 100)); }

async function execute(interaction, { entitlements }) {
  const entries = await entitlements.listCodes(interaction.options.getInteger('limit') || 15);
  if (!entries.length) return 'Chưa có mã kích hoạt nào được tạo.';
  return entries.map((entry) => {
    const expires = entry.expiresAt ? new Date(entry.expiresAt).toLocaleDateString('vi-VN') : 'vĩnh viễn';
    const duration = entry.isPermanent ? 'vĩnh viễn' : `${entry.days} ngày`;
    return `• \`${safe(entry.keyId)}\` · Gói: **${safe(entry.planName)}** · ${duration} · Đã dùng: ${entry.usedCount}/${entry.maxUses} · Trạng thái: \`${entry.status}\` · Hết hạn: ${expires}`;
  }).join('\n').slice(0, 1900);
}

module.exports = { data: definition, execute };
