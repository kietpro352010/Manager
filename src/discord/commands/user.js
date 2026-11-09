'use strict';

const { SlashCommandBuilder, escapeMarkdown } = require('discord.js');
const { padId } = require('../panels/renderer');

const SNOWFLAKE = /^\d{17,20}$/;

const definition = new SlashCommandBuilder()
  .setName('user')
  .setDescription('Quản lý phân quyền và gán bot cho thành viên Discord (Admin)')
  .addSubcommand((command) => command.setName('list').setDescription('Xem danh sách người dùng và các bot được gán vĩnh viễn'))
  .addSubcommand((command) => command.setName('show').setDescription('Xem thông tin bot được gán cho một người dùng')
    .addUserOption((opt) => opt.setName('user').setDescription('Chọn người dùng Discord').setRequired(false))
    .addStringOption((opt) => opt.setName('discord_id').setDescription('Hoặc nhập ID Discord của người dùng').setRequired(false)))
  .addSubcommand((command) => command.setName('grant').setDescription('Gán bot vĩnh viễn cho người dùng và tự động cấp role Member')
    .addStringOption((opt) => opt.setName('workers').setDescription('Số thứ tự hoặc ID bot muốn gán (VD: 1, 2 hoặc 01, 02)').setRequired(true).setMaxLength(500))
    .addUserOption((opt) => opt.setName('user').setDescription('Chọn người dùng Discord').setRequired(false))
    .addStringOption((opt) => opt.setName('discord_id').setDescription('Hoặc nhập ID Discord của người dùng').setRequired(false)))
  .addSubcommand((command) => command.setName('remove').setDescription('Thu hồi toàn bộ bot và tự động gỡ role Member của người dùng')
    .addUserOption((opt) => opt.setName('user').setDescription('Chọn người dùng Discord').setRequired(false))
    .addStringOption((opt) => opt.setName('discord_id').setDescription('Hoặc nhập ID Discord của người dùng').setRequired(false)))
  .addSubcommand((command) => command.setName('disable').setDescription('Tạm khóa quyền sử dụng bot của người dùng')
    .addUserOption((opt) => opt.setName('user').setDescription('Chọn người dùng Discord').setRequired(false))
    .addStringOption((opt) => opt.setName('discord_id').setDescription('Hoặc nhập ID Discord của người dùng').setRequired(false)))
  .addSubcommand((command) => command.setName('enable').setDescription('Mở khóa lại quyền sử dụng bot cho người dùng')
    .addUserOption((opt) => opt.setName('user').setDescription('Chọn người dùng Discord').setRequired(false))
    .addStringOption((opt) => opt.setName('discord_id').setDescription('Hoặc nhập ID Discord của người dùng').setRequired(false)));

function safe(value, max = 160) {
  return escapeMarkdown(String(value || '—').replace(/[@\r\n]/g, ' ').slice(0, max));
}

function resolveUserId(interaction) {
  const userOption = interaction.options.getUser('user');
  if (userOption?.id) return userOption.id;
  const rawId = interaction.options.getString('discord_id')?.trim();
  if (rawId && SNOWFLAKE.test(rawId)) return rawId;
  return null;
}

async function resolveRequestedWorkers(registry, inputString) {
  const tokens = String(inputString || '').split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean);
  if (!tokens.length) throw new Error('Vui lòng nhập ít nhất một số thứ tự hoặc ID bot muốn gán (VD: 1, 2 hoặc 01, 02).');
  const resolved = [];
  const seen = new Set();
  for (const token of tokens) {
    let worker = null;
    if (/^\d+$/.test(token)) {
      worker = await registry.findByNumber(parseInt(token, 10));
    }
    if (!worker) {
      worker = await registry.find(token.toLowerCase());
    }
    if (!worker) {
      throw new Error(`Không tìm thấy bot nào khớp với "${token}". Hãy kiểm tra lại danh sách bot bằng lệnh /bot list.`);
    }
    if (seen.has(worker.workerId)) continue;
    seen.add(worker.workerId);
    resolved.push(worker);
  }
  return resolved;
}

async function syncDiscordRole(guild, userId, roleId, action = 'add') {
  if (!guild || !roleId || !userId) return { ok: false, reason: 'missing_params' };
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { ok: false, reason: 'member_not_in_guild' };
    if (action === 'add') {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId, 'Tự động cấp role Member khi được gán bot KingMC');
      }
      return { ok: true, action: 'added' };
    }
    if (action === 'remove') {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId, 'Tự động gỡ role Member khi bị thu hồi bot KingMC');
      }
      return { ok: true, action: 'removed' };
    }
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  return { ok: false, reason: 'unknown' };
}

async function execute(interaction, services) {
  const { accessControl, accessStore, registry, config, discordClient } = services;
  const action = interaction.options.getSubcommand();
  const actorRole = accessControl.roleFor(interaction.member, interaction);
  if (actorRole !== 'admin') throw new Error('Chỉ thành viên có role Discord Admin mới có quyền thực hiện.');

  const guild = interaction.guild || (discordClient && config.discordGuildId ? await discordClient.guilds.fetch(config.discordGuildId).catch(() => null) : null);
  const userRoleId = accessControl.userRoleId;

  // Subcommand: list
  if (action === 'list') {
    const entries = await accessStore.listAccess();
    if (!entries.length) return '📋 Chưa có thành viên nào được cấp quyền quản lý bot.';
    const lines = entries.slice(0, 20).map((entry) => {
      const statusIcon = entry.status === 'disabled' ? '🔴 Đã khóa' : '🟢 Hoạt động';
      const botTags = (entry.workerIds || []).map((id) => `\`#${id}\``).join(', ') || 'Chưa gán bot';
      return `• <@${entry.userId}> · ${statusIcon} · **Vĩnh viễn**\n  └ 🤖 Bot: ${botTags}`;
    });
    return `👥 **Danh Sách Phân Quyền Bot KingMC**\n\n${lines.join('\n')}${entries.length > 20 ? `\n\n…và ${entries.length - 20} người dùng khác.` : ''}\n\n🔒 *Mỗi bot được gán độc quyền cho 1 người dùng, không thể dùng chung.*`;
  }

  const userId = resolveUserId(interaction);
  if (!userId) {
    throw new Error('Vui lòng chọn người dùng từ danh sách hoặc nhập ID Discord hợp lệ (17–20 số).');
  }

  // Subcommand: show
  if (action === 'show') {
    const member = await accessControl.memberFor(userId);
    if (!member) return `Chưa có thông tin phân quyền cho tài khoản <@${userId}>.`;
    const statusIcon = member.status === 'disabled' ? '🔴 Đang bị khóa' : '🟢 Đang hoạt động';
    const bots = (member.workerIds || []).map((id) => `\`#${id}\``).join(', ') || 'Chưa gán bot nào';
    let roleText = '—';
    if (guild && userRoleId) {
      const gm = await guild.members.fetch(userId).catch(() => null);
      roleText = gm?.roles?.cache?.has(userRoleId) ? `✅ Đã có role <@&${userRoleId}>` : `⚠️ Chưa có role <@&${userRoleId}>`;
    }
    return `👤 **Thông Tin Phân Quyền: <@${userId}>**\n• Trạng thái: ${statusIcon}\n• Thời hạn: ♾️ **Vĩnh viễn**\n• Bot được gán: 🤖 ${bots}\n• Role Discord: ${roleText}\n• Gói: \`${safe(member.planName || 'Vĩnh viễn')}\``;
  }

  // Subcommand: grant
  if (action === 'grant') {
    const workerInput = interaction.options.getString('workers', true);
    const resolvedWorkers = await resolveRequestedWorkers(registry, workerInput);

    // Strict Exclusive Check: A bot cannot be shared by multiple users
    for (const worker of resolvedWorkers) {
      const assigned = await accessStore.assignedUser(worker.workerId);
      if (assigned && assigned.userId !== userId) {
        throw new Error(
          `❌ Bot **#${padId(worker.botNumber)}** (\`${safe(worker.name)}\`) hiện đang được gán cho <@${assigned.userId}>!\n` +
          `Mỗi bot chỉ thuộc về 1 người dùng độc quyền, không dùng chung. Vui lòng thu hồi bot từ người dùng cũ trước khi gán cho người khác.`
        );
      }
    }

    const workerIds = resolvedWorkers.map((w) => w.workerId);
    await accessControl.grant(interaction.user.id, userId, {
      role: 'user',
      workerIds,
      status: 'active',
      isPermanent: true,
      expiresAt: null,
      planName: 'Vĩnh viễn'
    }, actorRole);

    await accessStore.addAudit({
      actorId: interaction.user.id,
      action: 'user.grant',
      target: userId,
      details: { workerIds, permanent: true }
    });

    // Auto-assign Discord Member Role
    let roleMessage = '';
    if (userRoleId) {
      const syncResult = await syncDiscordRole(guild, userId, userRoleId, 'add');
      if (syncResult.ok) {
        roleMessage = `\n👑 **Role Member:** Đã tự động cấp role <@&${userRoleId}> trên Discord.`;
      } else if (syncResult.reason === 'member_not_in_guild') {
        roleMessage = `\n⚠️ Người dùng chưa vào server Discord nên chưa thể tự gán role <@&${userRoleId}>.`;
      } else {
        roleMessage = `\n⚠️ Không thể tự cấp role: Hãy đảm bảo bot có quyền "Manage Roles" và role của bot nằm trên role <@&${userRoleId}>.`;
      }
    }

    const botTags = resolvedWorkers.map((w) => `**#${padId(w.botNumber)}** (\`${safe(w.name)}\`)`).join(', ');
    return (
      `🎉 **Gán bot thành công cho <@${userId}>!**\n` +
      `🤖 **Bot được gán:** ${botTags}\n` +
      `♾️ **Thời hạn:** Vĩnh viễn${roleMessage}\n` +
      `🔒 **Độc quyền:** Bot đã được khóa riêng cho người này, các thành viên khác không thể can thiệp.`
    );
  }

  // Subcommand: disable / enable
  if (action === 'disable' || action === 'enable') {
    const status = action === 'disable' ? 'disabled' : 'active';
    await accessControl.updateMember(interaction.user.id, userId, { status }, actorRole);
    await accessStore.addAudit({ actorId: interaction.user.id, action: `user.${action}`, target: userId });
    return `${action === 'disable' ? '🔴 Đã tạm khóa' : '🟢 Đã mở khóa lại'} quyền sử dụng bot của <@${userId}>.`;
  }

  // Subcommand: remove
  const member = await accessControl.memberFor(userId);
  const releasedBots = (member?.workerIds || []).map((id) => `\`#${id}\``).join(', ') || 'Không có';
  const removed = await accessControl.revoke(interaction.user.id, userId, actorRole);
  if (removed) {
    await accessStore.addAudit({ actorId: interaction.user.id, action: 'user.remove', target: userId });
    // Auto-remove Discord Member Role
    let roleRemoveMsg = '';
    if (userRoleId) {
      const syncResult = await syncDiscordRole(guild, userId, userRoleId, 'remove');
      if (syncResult.ok) {
        roleRemoveMsg = `\n👋 Đã tự động gỡ role <@&${userRoleId}> khỏi tài khoản.`;
      }
    }
    return `🗑️ **Đã thu hồi toàn bộ quyền và bot của <@${userId}>!**\n🔓 Các bot đã được giải phóng: ${releasedBots}${roleRemoveMsg}`;
  }

  return `Không tìm thấy dữ liệu phân quyền nào của tài khoản <@${userId}>.`;
}

module.exports = { data: definition, execute };
