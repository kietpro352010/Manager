'use strict';

const { SlashCommandBuilder, escapeMarkdown } = require('discord.js');

const definition = new SlashCommandBuilder()
  .setName('user')
  .setDescription('Quản lý phân quyền và gán bot cho thành viên Discord (Admin)')
  .addSubcommand((command) => command.setName('list').setDescription('Xem danh sách người dùng đã được cấp quyền bot'))
  .addSubcommand((command) => command.setName('show').setDescription('Xem thông tin chi tiết một người dùng')
    .addStringOption((option) => option.setName('discord_id').setDescription('ID tài khoản Discord của người dùng (VD: 123456789012345678)').setRequired(true).setMinLength(17).setMaxLength(20)))
  .addSubcommand((command) => command.setName('grant').setDescription('Cấp quyền hoặc gia hạn ngày thuê và gán bot cho người dùng')
    .addStringOption((option) => option.setName('discord_id').setDescription('ID tài khoản Discord của người dùng (VD: 123456789012345678)').setRequired(true).setMinLength(17).setMaxLength(20))
    .addStringOption((option) => option.setName('workers').setDescription('ID bot muốn gán (phân cách bằng dấu phẩy, VD: afk-01, afk-02)').setMaxLength(1000))
    .addIntegerOption((option) => option.setName('days').setDescription('Số ngày cấp thêm (VD: 30)').setMinValue(1).setMaxValue(36500))
    .addBooleanOption((option) => option.setName('permanent').setDescription('Cấp quyền vĩnh viễn (True/False)'))
    .addStringOption((option) => option.setName('plan').setDescription('Tên gói (VD: Gói VIP)').setMaxLength(64)))
  .addSubcommand((command) => command.setName('disable').setDescription('Tạm khóa quyền sử dụng bot của người dùng')
    .addStringOption((option) => option.setName('discord_id').setDescription('ID tài khoản Discord của người dùng (VD: 123456789012345678)').setRequired(true).setMinLength(17).setMaxLength(20)))
  .addSubcommand((command) => command.setName('enable').setDescription('Mở khóa lại quyền sử dụng bot cho người dùng')
    .addStringOption((option) => option.setName('discord_id').setDescription('ID tài khoản Discord của người dùng (VD: 123456789012345678)').setRequired(true).setMinLength(17).setMaxLength(20)))
  .addSubcommand((command) => command.setName('remove').setDescription('Xóa hoàn toàn quyền và thu hồi bot của người dùng')
    .addStringOption((option) => option.setName('discord_id').setDescription('ID tài khoản Discord của người dùng (VD: 123456789012345678)').setRequired(true).setMinLength(17).setMaxLength(20)));

function safe(value, max = 160) { return escapeMarkdown(String(value || '—').replace(/[@\r\n]/g, ' ').slice(0, max)); }

async function execute(interaction, { accessControl, accessStore, registry }) {
  const action = interaction.options.getSubcommand();
  const userId = interaction.options.getString('discord_id')?.trim();
  const actorRole = accessControl.roleFor(interaction.member, interaction);
  if (action === 'list') {
    const entries = await accessStore.listAccess();
    const records = entries.slice(0, 18).map((entry) => {
      const access = entry.isPermanent ? 'permanent' : `until ${entry.expiresAt ? new Date(entry.expiresAt).toLocaleDateString('en-GB') : 'unset'}`;
      return `• <@${entry.userId}> · ${entry.status || 'active'} · ${access} · ${safe((entry.workerIds || []).join(', ') || 'no workers', 100)}`;
    });
    return [records.join('\n'), entries.length > 18 ? `…and ${entries.length - 18} more.` : ''].filter(Boolean).join('\n') || 'No user access grants.';
  }
  if (action === 'show') {
    const member = await accessControl.memberFor(userId);
    if (!member) return 'No manager access record found for that Discord ID.';
    const expires = member.isPermanent ? 'permanent' : member.expiresAt ? new Date(member.expiresAt).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'not set';
    return `<@${userId}> · user access **${safe(member.status || 'active')}** · ${member.isPermanent ? 'permanent' : `expires ${expires}`} · plan ${safe(member.planName)}\nWorkers: ${safe((member.workerIds || []).join(', ') || 'none', 400)}\nDiscord roles are managed in server settings.`;
  }
  if (action === 'grant') {
    const workerIds = (interaction.options.getString('workers') || '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean);
    const ids = new Set((await registry.list()).map((worker) => worker.workerId));
    const unknown = workerIds.filter((id) => !ids.has(id));
    if (unknown.length) throw new Error(`Unknown worker ID(s): ${unknown.join(', ')}`);
    const permanent = interaction.options.getBoolean('permanent') === true;
    const days = interaction.options.getInteger('days') || 30;
    const member = await accessControl.grant(interaction.user.id, userId, {
      role: 'user', workerIds,
      isPermanent: permanent, expiresAt: permanent ? null : new Date(Date.now() + days * 86400000).toISOString(),
      planName: interaction.options.getString('plan') || 'Standard', status: 'active'
    }, actorRole);
    await accessStore.addAudit({ actorId: interaction.user.id, action: 'user.grant', target: userId, details: { workerIds: member.workerIds, permanent, days } });
    const access = member.isPermanent ? 'permanent' : `until ${new Date(member.expiresAt).toLocaleDateString('en-GB')}`;
    return `Granted <@${userId}> user access · ${access} · workers: ${safe(member.workerIds.join(', ') || 'none', 300)}. They also need the configured Discord user role.`;
  }
  if (action === 'disable' || action === 'enable') {
    const status = action === 'disable' ? 'disabled' : 'active';
    await accessControl.updateMember(interaction.user.id, userId, { status }, actorRole);
    await accessStore.addAudit({ actorId: interaction.user.id, action: `user.${action}`, target: userId });
    return `${action === 'disable' ? 'Disabled' : 'Enabled'} manager access for <@${userId}>.`;
  }
  const removed = await accessControl.revoke(interaction.user.id, userId, actorRole);
  if (removed) await accessStore.addAudit({ actorId: interaction.user.id, action: 'user.remove', target: userId });
  return removed ? `Removed <@${userId}> and their worker assignments.` : 'No manager access record found for that Discord ID.';
}

module.exports = { data: definition, execute };
