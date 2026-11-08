'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder, escapeMarkdown } = require('discord.js');

function safe(value, max = 100) {
  return escapeMarkdown(String(value || '—').replace(/[@\r\n]/g, ' ').slice(0, max));
}

const definition = new SlashCommandBuilder()
  .setName('code')
  .setDescription('Quản lý mã kích hoạt và nhận thưởng bot')
  .addSubcommand((command) => command.setName('redeem').setDescription('Kích hoạt mã gia hạn hoặc nhận bot')
    .addStringOption((option) => option.setName('code').setDescription('Nhập mã kích hoạt (VD: KING-XXXX-YYYY)').setRequired(true).setMinLength(6).setMaxLength(64)))
  .addSubcommand((command) => command.setName('status').setDescription('Kiểm tra thời hạn sử dụng bot và hạn mức vượt link'))
  .addSubcommand((command) => command.setName('link4m').setDescription('Lấy link vượt link nhận thêm giờ bot'))
  .addSubcommand((command) => command.setName('create').setDescription('Tạo mã code thuê / kích hoạt bot (Admin)')
    .addIntegerOption((option) => option.setName('days').setDescription('Số ngày thuê bot (Mặc định: 30 ngày)').setMinValue(1).setMaxValue(36500))
    .addBooleanOption((option) => option.setName('permanent').setDescription('Cấp quyền thuê bot vĩnh viễn'))
    .addIntegerOption((option) => option.setName('bots').setDescription('Số lượng bot tự động gán cho người nhập mã (VD: 1 hoặc 2)').setMinValue(0).setMaxValue(25))
    .addStringOption((option) => option.setName('workers').setDescription('ID bot cố định muốn gán (VD: afk-01, afk-02)').setMaxLength(1000))
    .addIntegerOption((option) => option.setName('uses').setDescription('Số lượt kích hoạt mã này (Mặc định: 1)').setMinValue(1).setMaxValue(1000))
    .addStringOption((option) => option.setName('plan').setDescription('Tên gói hiển thị (VD: Gói VIP 1 Tháng)').setMaxLength(64))
    .addStringOption((option) => option.setName('expires_at').setDescription('Hạn chót nhập mã theo ngày ISO (VD: 2026-12-31)').setMaxLength(40)))
  .addSubcommand((command) => command.setName('list').setDescription('Xem danh sách các mã code đã tạo (Admin)')
    .addIntegerOption((option) => option.setName('limit').setDescription('Số lượng mã hiển thị').setMinValue(1).setMaxValue(25)))
  .addSubcommand((command) => command.setName('delete').setDescription('Xóa mã code kích hoạt (Admin)')
    .addStringOption((option) => option.setName('id').setDescription('Code ID cần xóa (VD: code_abc123)').setRequired(true).setMinLength(8).setMaxLength(64)));

async function execute(interaction, { entitlements, accessStore, accessControl, link4m }) {
  const action = interaction.options.getSubcommand();
  const discordRole = accessControl.roleFor(interaction.member, interaction);
  const isAdmin = discordRole === 'admin';
  const requireAdmin = () => { if (!isAdmin) throw new Error('Chỉ thành viên có role Discord Admin mới có quyền thực hiện.'); };

  if (action === 'create') {
    requireAdmin();
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

  if (action === 'list') {
    requireAdmin();
    const entries = await entitlements.listCodes(interaction.options.getInteger('limit') || 15);
    if (!entries.length) return 'Chưa có mã kích hoạt nào được tạo.';
    return entries.map((entry) => {
      const expires = entry.expiresAt ? new Date(entry.expiresAt).toLocaleDateString('vi-VN') : 'vĩnh viễn';
      const duration = entry.isPermanent ? 'vĩnh viễn' : `${entry.days} ngày`;
      return `• \`${safe(entry.keyId)}\` · Gói: **${safe(entry.planName)}** · ${duration} · Đã dùng: ${entry.usedCount}/${entry.maxUses} · Trạng thái: \`${entry.status}\` · Hết hạn: ${expires}`;
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
    await accessStore.addAudit({ actorId: interaction.user.id, action: 'code.redeem', target: result.workerIds.join(',') || 'time-only', details: { missingWorkers: result.missingWorkers, planName: result.planName } });
    const access = result.isPermanent ? 'Vĩnh viễn' : `đến <t:${Math.floor(Date.parse(result.expiresAt) / 1000)}:f>`;
    const workers = result.workerIds.length ? result.workerIds.map((id) => `\`${id}\``).join(', ') : 'Chưa gán bot';
    const shortage = result.missingWorkers ? `\n⚠️ Hiện chưa đủ bot trống cho ${result.missingWorkers} slot. Admin sẽ gán thêm sau.` : '';
    return `🎉 **Kích hoạt mã thành công!**\n• Thời hạn: **${access}**\n• Gói: **${result.planName}**\n• Bot được gán: ${workers}${shortage}`;
  }

  if (action === 'link4m') {
    const attempt = await link4m.startAttempt(interaction.user.id);
    await accessStore.addAudit({ actorId: interaction.user.id, action: 'link4m.start', target: attempt.attemptId, details: { reused: attempt.reused } });
    const expires = Math.floor(new Date(attempt.expiresAt).getTime() / 1000);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Mở link Link4M').setStyle(ButtonStyle.Link).setURL(attempt.providerUrl));
    const embed = new EmbedBuilder().setColor(0x0f766e).setTitle('Nhận giờ qua Link4M')
      .setDescription(`Hoàn thành vượt link trước <t:${expires}:R>. Sau khi vượt link xong, hệ thống sẽ tự cộng giờ; bạn có thể dùng \`/code status\` để kiểm tra.`)
      .setFooter({ text: `Phần thưởng: ${attempt.rewardHours} giờ · Lượt ${attempt.attemptId}` });
    return { embeds: [embed], components: [row] };
  }

  const member = await accessControl.memberFor(interaction.user.id);
  const status = await link4m.status(interaction.user.id);
  const access = discordRole === 'admin' ? 'Admin · Toàn quyền' : !member ? 'Chưa có dữ liệu' : member.status === 'disabled' ? 'Đã bị vô hiệu hóa' : member.isPermanent ? 'Vĩnh viễn' : member.expiresAt ? `Đến <t:${Math.floor(Date.parse(member.expiresAt) / 1000)}:f>` : 'Hết hạn';
  const workers = member?.workerIds?.length ? member.workerIds.map((id) => `\`${id}\``).join(', ') : 'Chưa có';
  const reward = status.eligible ? `${status.remainingToday}/${status.dailyLimit} lượt hôm nay · ${status.rewardHours}h/lượt` : status.reason || `Link4M tạm đóng · còn ${status.remainingToday ?? 0}/${status.dailyLimit} lượt hôm nay`;
  return `Quyền hạn: **${access}**\nBot được gán: ${workers}\nVượt link Link4M: ${reward}`;
}

module.exports = { data: definition, execute };
