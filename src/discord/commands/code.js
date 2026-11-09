'use strict';

const { SlashCommandBuilder, escapeMarkdown } = require('discord.js');

function safe(value, max = 100) {
  return escapeMarkdown(String(value || '—').replace(/[@\r\n]/g, ' ').slice(0, max));
}

const definition = new SlashCommandBuilder()
  .setName('code')
  .setDescription('Quản lý mã kích hoạt nhận bot vĩnh viễn')
  .addSubcommand((command) => command.setName('redeem').setDescription('Kích hoạt mã nhận bot vĩnh viễn')
    .addStringOption((option) => option.setName('code').setDescription('Nhập mã kích hoạt (VD: KM-XXXX-YYYY)').setRequired(true).setMinLength(6).setMaxLength(64)))
  .addSubcommand((command) => command.setName('status').setDescription('Kiểm tra bot được gán cho tài khoản của bạn'))
  .addSubcommand((command) => command.setName('create').setDescription('Tạo mã code kích hoạt bot vĩnh viễn (Admin)')
    .addIntegerOption((option) => option.setName('bots').setDescription('Số lượng bot tự động gán cho người nhập mã (VD: 1 hoặc 2)').setMinValue(0).setMaxValue(25))
    .addStringOption((option) => option.setName('workers').setDescription('Số thứ tự hoặc ID bot cố định muốn gán (VD: 01, 02)').setMaxLength(1000))
    .addIntegerOption((option) => option.setName('uses').setDescription('Số lượt kích hoạt mã này (Mặc định: 1)').setMinValue(1).setMaxValue(1000))
    .addStringOption((option) => option.setName('plan').setDescription('Tên gói hiển thị (VD: Thành viên VIP)').setMaxLength(64)))
  .addSubcommand((command) => command.setName('list').setDescription('Xem danh sách các mã code đã tạo (Admin)')
    .addIntegerOption((option) => option.setName('limit').setDescription('Số lượng mã hiển thị').setMinValue(1).setMaxValue(25)))
  .addSubcommand((command) => command.setName('delete').setDescription('Xóa mã code kích hoạt (Admin)')
    .addStringOption((option) => option.setName('id').setDescription('Code ID cần xóa (VD: code_abc123)').setRequired(true).setMinLength(8).setMaxLength(64)));

async function execute(interaction, { entitlements, accessStore, accessControl }) {
  const action = interaction.options.getSubcommand();
  const discordRole = accessControl.roleFor(interaction.member, interaction);
  const isAdmin = discordRole === 'admin';
  const requireAdmin = () => { if (!isAdmin) throw new Error('Chỉ thành viên có role Discord Admin mới có quyền thực hiện.'); };

  if (action === 'create') {
    requireAdmin();
    const workerText = interaction.options.getString('workers') || '';
    const workerIds = workerText.split(',').map((id) => id.trim().toLowerCase()).filter(Boolean);
    const created = await entitlements.createCode({
      days: -1,
      permanent: true,
      botCount: interaction.options.getInteger('bots') ?? (workerIds.length ? 0 : 1),
      workerIds,
      maxUses: interaction.options.getInteger('uses') ?? 1,
      planName: interaction.options.getString('plan') || 'Vĩnh viễn',
      expiresAt: null,
      actorId: interaction.user.id
    });
    await accessStore.addAudit({ actorId: interaction.user.id, action: 'code.create', target: created.keyId, details: { botCount: created.botCount, maxUses: created.maxUses } });
    return `🎉 **Tạo mã thành công!**\nGói: **${safe(created.planName || 'Vĩnh viễn', 64)}** · Thời hạn: **Vĩnh viễn** · Số slot bot: ${created.botCount} · Lượt dùng: ${created.maxUses}.\n\nMã kích hoạt:\n||${created.code}||\nID mã: \`${created.keyId}\` (chỉ hiển thị 1 lần).`;
  }

  if (action === 'list') {
    requireAdmin();
    const entries = await entitlements.listCodes(interaction.options.getInteger('limit') || 15);
    if (!entries.length) return 'Chưa có mã kích hoạt nào được tạo.';
    return entries.map((entry) => {
      return `• \`${safe(entry.keyId)}\` · Gói: **${safe(entry.planName)}** · Vĩnh viễn · Đã dùng: ${entry.usedCount}/${entry.maxUses} · Trạng thái: \`${entry.status}\``;
    }).join('\n').slice(0, 1900);
  }

  if (action === 'delete') {
    requireAdmin();
    const keyId = interaction.options.getString('id', true).trim();
    const removed = await entitlements.deleteCode(keyId);
    if (removed) await accessStore.addAudit({ actorId: interaction.user.id, action: 'code.delete', target: keyId });
    return removed ? `✅ Đã xóa mã \`${keyId}\`.` : `Không tìm thấy mã nào có ID \`${keyId}\`.`;
  }

  if (action === 'redeem') {
    const raw = interaction.options.getString('code') || interaction.options.getString('value', true);
    const result = await entitlements.redeem(interaction.user.id, raw, discordRole);
    await accessStore.addAudit({ actorId: interaction.user.id, action: 'code.redeem', target: result.workerIds.join(',') || 'none', details: { missingWorkers: result.missingWorkers, planName: result.planName } });

    // Auto-assign member role on Discord if configured
    if (accessControl.userRoleId && interaction.guild) {
      const memberObj = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (memberObj && !memberObj.roles.cache.has(accessControl.userRoleId)) {
        await memberObj.roles.add(accessControl.userRoleId).catch(() => {});
      }
    }

    const workers = result.workerIds.length ? result.workerIds.map((id) => `\`${id}\``).join(', ') : 'Chưa gán bot';
    const shortage = result.missingWorkers ? `\n⚠️ Hiện chưa đủ bot trống cho ${result.missingWorkers} slot. Admin sẽ gán thêm sau.` : '';
    return `🎉 **Kích hoạt mã thành công!**\n• Thời hạn: **Vĩnh viễn**\n• Gói: **${result.planName}**\n• Bot được gán: ${workers}${shortage}\n💡 Dùng \`/panel\` hoặc \`/bot list\` để bắt đầu điều khiển bot của bạn.`;
  }

  const member = await accessControl.memberFor(interaction.user.id);
  const access = discordRole === 'admin' ? 'Admin · Toàn quyền' : !member ? 'Chưa có dữ liệu' : member.status === 'disabled' ? 'Đã bị vô hiệu hóa' : 'Vĩnh viễn';
  const workers = member?.workerIds?.length ? member.workerIds.map((id) => `\`${id}\``).join(', ') : 'Chưa có bot nào';
  return `Quyền hạn: **${access}**\nBot được gán cho bạn: ${workers}\n💡 Dùng \`/panel\` để mở giao diện điều khiển.`;
}

module.exports = { data: definition, execute };
