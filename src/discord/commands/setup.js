'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { normalizePublicUrl } = require('../../config/host-runtime');

const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Thiết lập cấu hình Manager cho máy chủ Discord này')
  .addRoleOption((option) => option.setName('admin_role').setDescription('Role Discord Quản trị viên (Admin)').setRequired(true))
  .addRoleOption((option) => option.setName('user_role').setDescription('Role Discord Thành viên được dùng bot (User)').setRequired(true))
  .addUserOption((option) => option.setName('admin_user').setDescription('Tài khoản Discord Admin nhận tin nhắn thông báo lỗi (DM)').setRequired(false))
  .addStringOption((option) => option.setName('admin_user_id').setDescription('Hoặc nhập ID Discord của Admin nhận báo lỗi (VD: 123456789012345678)').setRequired(false))
  .addStringOption((option) => option.setName('public_url').setDescription('URL Public HTTPS của Manager (nếu dùng vượt link Link4M)').setMaxLength(250));

async function execute(interaction, services) {
  if (!interaction.inGuild?.() || interaction.guildId !== services.config.discordGuildId) {
    throw new Error('Setup is available only in the Discord server pinned in manager configuration.');
  }
  const role = services.accessControl.roleFor(interaction.member);
  const isGuildOwner = interaction.guild?.ownerId === interaction.user.id;
  if (services.accessControl.isConfigured() ? role !== 'admin' : !isGuildOwner) {
    throw new Error(services.accessControl.isConfigured()
      ? 'Only the configured manager Admin role can change setup.'
      : 'Only the Discord server owner can run the initial manager setup.');
  }

  const adminRole = interaction.options.getRole('admin_role', true);
  const userRole = interaction.options.getRole('user_role', true);
  if (adminRole.id === userRole.id || adminRole.id === interaction.guildId || userRole.id === interaction.guildId) {
    throw new Error('Choose two different server roles; @everyone cannot be used.');
  }
  if (adminRole.managed || userRole.managed) throw new Error('Choose normal server roles, not integration-managed roles.');

  const publicUrlInput = interaction.options.getString('public_url');
  let publicUrlConfigured = Boolean(services.managerRuntimeSettings.snapshot().publicBaseUrl);
  if (publicUrlInput !== null) {
    const publicBaseUrl = normalizePublicUrl(publicUrlInput);
    if (!publicBaseUrl) throw new Error('Public manager URL must use HTTPS and contain no username or password.');
    await services.managerRuntimeSettings.update({ publicBaseUrl });
    services.config.publicBaseUrl = publicBaseUrl;
    services.link4m.config.publicBaseUrl = publicBaseUrl;
    publicUrlConfigured = true;
  }

  const adminUser = interaction.options.getUser('admin_user');
  const adminUserIdInput = interaction.options.getString('admin_user_id')?.trim();
  const designatedAdminUserId = adminUser?.id || (adminUserIdInput && /^\d{17,20}$/.test(adminUserIdInput) ? adminUserIdInput : null) || interaction.user.id;

  const previous = { adminRoleId: services.accessControl.adminRoleId, userRoleId: services.accessControl.userRoleId };
  const next = {
    guildId: interaction.guildId,
    adminRoleId: adminRole.id,
    userRoleId: userRole.id,
    adminUserId: designatedAdminUserId,
    configuredBy: interaction.user.id,
    configuredAt: new Date().toISOString()
  };
  await services.accessStore.setSetting('discord_access', next);
  services.accessControl.setRoleIds(next.adminRoleId, next.userRoleId);
  services.config.adminRoleId = next.adminRoleId;
  services.config.userRoleId = next.userRoleId;
  services.config.adminUserId = designatedAdminUserId;
  if (services.adminNotifier) {
    services.adminNotifier.setAdminUserId(designatedAdminUserId);
    // Send a test confirmation DM to the admin
    void services.adminNotifier.sendAlert({
      source: 'Manager',
      event: 'setup_completed',
      message: `✅ Bạn đã được chỉ định làm Admin nhận tin nhắn thông báo lỗi 24/7 từ KingMC Bot AFK Manager!\nServer: **${interaction.guild.name}**\nMọi sự cố phát sinh từ Supabase, Worker hay Manager sẽ được tự động gửi chi tiết về DM này.`,
      details: {
        adminRoleId: adminRole.id,
        userRoleId: userRole.id,
        configuredBy: interaction.user.tag || interaction.user.id
      },
      level: 'info'
    });
  }
  await services.accessStore.addAudit({
    actorId: interaction.user.id,
    action: 'manager.setup.roles',
    target: interaction.guildId,
    details: {
      previousAdminRoleId: previous.adminRoleId || null, previousUserRoleId: previous.userRoleId || null,
      adminRoleId: next.adminRoleId, userRoleId: next.userRoleId, adminUserId: designatedAdminUserId, publicUrlConfigured
    }
  }).catch((error) => services.logger.warn('manager_setup_audit_write_failed', { message: error.message }));

  return {
    content: `✅ **Thiết lập Manager thành công!**\n• Role Admin: <@&${next.adminRoleId}>\n• Role User: <@&${next.userRoleId}>\n• Admin nhận tin nhắn báo lỗi (DM): <@${designatedAdminUserId}> (\`${designatedAdminUserId}\`)\n• Public HTTPS URL: ${publicUrlConfigured ? 'Đã cấu hình' : 'Chưa cấu hình'}.\n\n*(Một tin nhắn xác nhận đã được gửi vào hộp thư DM của bạn).*`,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('km:setup:secrets').setLabel('Cài đặt API Secrets').setStyle(ButtonStyle.Secondary)
    )]
  };
}

module.exports = { data, execute };
