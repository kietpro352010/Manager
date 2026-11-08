'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safe } = require('../panels/renderer');

const definition = new SlashCommandBuilder()
  .setName('codecreate')
  .setDescription('Tạo mã code thuê / kích hoạt bot (Admin)')
  .addIntegerOption((option) => option.setName('days').setDescription('Số ngày thuê bot (Mặc định: 30 ngày)').setMinValue(1).setMaxValue(36500))
  .addBooleanOption((option) => option.setName('permanent').setDescription('Cấp quyền thuê bot vĩnh viễn'))
  .addIntegerOption((option) => option.setName('bots').setDescription('Số lượng bot tự động gán cho người nhập mã (VD: 1 hoặc 2)').setMinValue(0).setMaxValue(25))
  .addStringOption((option) => option.setName('workers').setDescription('ID bot cố định muốn gán (VD: afk-01, afk-02 - để trống sẽ tự gán)').setMaxLength(1000))
  .addIntegerOption((option) => option.setName('uses').setDescription('Số lượt người dùng có thể kích hoạt mã này (Mặc định: 1)').setMinValue(1).setMaxValue(1000))
  .addStringOption((option) => option.setName('plan').setDescription('Tên gói hiển thị (VD: Gói VIP 1 Tháng)').setMaxLength(64))
  .addStringOption((option) => option.setName('expires_at').setDescription('Hạn chót nhập mã theo ngày ISO (VD: 2026-12-31)').setMaxLength(40));

async function execute(interaction, { entitlements, accessStore }) {
  const workerText = interaction.options.getString('workers') || '';
  const workerIds = workerText.split(',').map((id) => id.trim().toLowerCase()).filter(Boolean);
  const expiresText = interaction.options.getString('expires_at');
  const expiresAt = expiresText ? new Date(expiresText) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error('expires_at must be a valid ISO date.');
  const created = await entitlements.createCode({
    days: interaction.options.getInteger('days') ?? 30,
    permanent: interaction.options.getBoolean('permanent') === true,
    botCount: interaction.options.getInteger('bots') ?? (workerIds.length ? 0 : 1),
    workerIds,
    maxUses: interaction.options.getInteger('uses') ?? 1,
    planName: interaction.options.getString('plan') || 'Standard',
    expiresAt,
    actorId: interaction.user.id
  });
  await accessStore.addAudit({ actorId: interaction.user.id, action: 'code.create', target: created.keyId, details: { days: created.days, botCount: created.botCount, maxUses: created.maxUses } });
  return `🎉 **Tạo mã thành công!**\nGói: **${safe(created.planName || 'Standard', 64)}** · Thời hạn: ${created.isPermanent ? 'Vĩnh viễn' : `${created.days} ngày`} · Số slot bot: ${created.botCount} · Lượt dùng: ${created.maxUses}.\n\nMã kích hoạt:\n||${created.code}||\nID mã: \`${created.keyId}\` (chỉ hiển thị 1 lần).`;
}

module.exports = { data: definition, execute };
