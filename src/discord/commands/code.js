'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require('discord.js');

const definition = new SlashCommandBuilder()
  .setName('code')
  .setDescription('Quản lý mã kích hoạt và nhận thưởng bot')
  .addSubcommand((command) => command.setName('redeem').setDescription('Kích hoạt mã gia hạn hoặc nhận bot')
    .addStringOption((option) => option.setName('code').setDescription('Nhập mã kích hoạt (VD: KING-XXXX-YYYY)').setRequired(true).setMinLength(6).setMaxLength(64)))
  .addSubcommand((command) => command.setName('status').setDescription('Kiểm tra thời hạn sử dụng bot và hạn mức vượt link'))
  .addSubcommand((command) => command.setName('link4m').setDescription('Lấy link vượt link nhận thêm giờ bot'));

async function execute(interaction, { entitlements, accessStore, accessControl, link4m }) {
  const action = interaction.options.getSubcommand();
  const discordRole = accessControl.roleFor(interaction.member);
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
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Open Link4M').setStyle(ButtonStyle.Link).setURL(attempt.providerUrl));
    const embed = new EmbedBuilder().setColor(0x0f766e).setTitle('Link4M reward')
      .setDescription(`Complete the provider flow before <t:${expires}:R>. Completion is checked by the manager; then use \`/code status\` to see your updated access.`)
      .setFooter({ text: `Reward: ${attempt.rewardHours} hours · attempt ${attempt.attemptId}` });
    return { embeds: [embed], components: [row] };
  }
  const member = await accessControl.memberFor(interaction.user.id);
  const status = await link4m.status(interaction.user.id);
  const access = discordRole === 'admin' ? 'Admin · full access' : !member ? 'No access record' : member.status === 'disabled' ? 'Disabled' : member.isPermanent ? 'Permanent' : member.expiresAt ? `Until <t:${Math.floor(Date.parse(member.expiresAt) / 1000)}:f>` : 'Expired';
  const workers = member?.workerIds?.length ? member.workerIds.map((id) => `\`${id}\``).join(', ') : 'none';
  const reward = status.eligible ? `${status.remainingToday}/${status.dailyLimit} today · ${status.rewardHours}h per reward` : status.reason || `Link4M unavailable · ${status.remainingToday ?? 0}/${status.dailyLimit} rewards left today`;
  return `Access: **${access}**\nAssigned workers: ${workers}\nLink4M: ${reward}`;
}

module.exports = { data: definition, execute };
