'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { buildAdminPasswordModal, embed } = require('../panels/renderer');
const { resolveLinkedUser } = require('../handlers/panel-handler');

async function getAllowedGuildId(services) {
  const { getEffectiveAllowedGuildId } = require('../handlers/interaction-handler');
  return getEffectiveAllowedGuildId(services?.config, services);
}

function checkUserAdmin(interaction, services, user, allowedGuildId) {
  const { isUserAdmin } = require('../handlers/interaction-handler');
  return isUserAdmin(interaction, services, user, allowedGuildId);
}

function checkSuperAdmin(interaction, services, allowedGuildId) {
  const { isSuperAdmin } = require('../handlers/interaction-handler');
  return isSuperAdmin(interaction, services, allowedGuildId);
}

const definition = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Bảng điều khiển và quản trị hệ thống Enterprise (Dành riêng cho Admin)')
  .addSubcommand((cmd) =>
    cmd.setName('setup').setDescription('Thiết lập cấu hình phân quyền Admin/User Role cho Discord Server này')
      .addRoleOption((opt) => opt.setName('admin_role').setDescription('Role dành cho Quản trị viên (Admin)').setRequired(true))
      .addRoleOption((opt) => opt.setName('user_role').setDescription('Role dành cho Thành viên thuê bot (User)').setRequired(true))
      .addUserOption((opt) => opt.setName('admin_user').setDescription('User Discord được chỉ định làm SuperAdmin (tùy chọn)').setRequired(false))
  )
  .addSubcommand((cmd) =>
    cmd.setName('password').setDescription('Thiết lập hoặc đổi mật khẩu Web cho tài khoản Quản trị viên (admin)')
      .addStringOption((opt) => opt.setName('new_password').setDescription('Tùy chọn (khuyến nghị bỏ trống để nhập an toàn qua biểu mẫu ẩn)').setMaxLength(256).setRequired(false))
  );

function shouldSkipDefer(interaction) {
  try {
    return interaction?.options?.getSubcommand?.(false) === 'password' && !interaction?.options?.getString?.('new_password');
  } catch (_) {
    return false;
  }
}

async function execute(interaction, services) {
  const allowedGuildId = await getAllowedGuildId(services);
  const user = (services?.accessStore?.getUserByDiscordId && typeof resolveLinkedUser === 'function')
    ? await resolveLinkedUser(interaction, services)
    : null;
  const isAdmin = checkUserAdmin(interaction, services, user, allowedGuildId);

  if (!isAdmin) {
    return {
      embeds: [embed('⛔ TỪ CHỐI TRUY CẬP', 'Lệnh này chỉ dành cho Quản trị viên hệ thống (Admin).', 0xef4444)]
    };
  }

  const subcommand = interaction.options.getSubcommand();

  // 1. SETUP
  if (subcommand === 'setup') {
    if (!checkSuperAdmin(interaction, services, allowedGuildId)) {
      return {
        embeds: [embed('⛔ TỪ CHỐI TRUY CẬP', 'Chỉ Chủ sở hữu server hoặc SuperAdmin mới có quyền chạy setup.', 0xef4444)]
      };
    }

    const adminRole = interaction.options.getRole('admin_role');
    const userRole = interaction.options.getRole('user_role');
    const adminUser = interaction.options.getUser('admin_user');

    if (adminRole.id === userRole.id) {
      return {
        embeds: [embed('❌ LỖI CẤU HÌNH', 'Role Admin và Role User phải là hai role khác nhau.', 0xef4444)]
      };
    }

    services.accessControl.setRoleIds(adminRole.id, userRole.id);
    if (adminUser) {
      services.accessControl.setAdminUserId(adminUser.id);
      services.adminNotifier?.setAdminUserId?.(adminUser.id);
    }

    await services.accessStore.setSetting('discord_access', {
      guildId: interaction.guildId || services.config?.discordGuildId || '',
      adminRoleId: adminRole.id,
      userRoleId: userRole.id,
      adminUserId: adminUser ? adminUser.id : (services.accessControl?.adminUserId || services.config.adminUserId || ''),
      configuredBy: interaction.user?.id || 'discord-setup'
    });

    await services.accessStore?.addAudit?.({
      action: 'DISCORD_ADMIN_SETUP',
      actorId: interaction.user?.id || 'discord-setup',
      targetId: interaction.guildId || '',
      details: { adminRoleId: adminRole.id, userRoleId: userRole.id, adminUserId: adminUser?.id || null }
    }).catch(() => null);

    // Tự động đồng bộ slash commands vào server này ngay lập tức
    try {
      const { registerCommands } = require('../register-commands');
      const cId = services.config?.discordClientId || interaction.client?.user?.id;
      if (services.config?.discordToken && cId && interaction.guildId) {
        await registerCommands({
          token: services.config.discordToken,
          clientId: cId,
          guildId: interaction.guildId
        });
      }
    } catch (_) {}

    return {
      embeds: [
        embed(
          '✅ THIẾT LẬP THÀNH CÔNG',
          `Đã cấu hình quyền hạn cho Discord Server này:\n\n` +
          `• **Admin Role:** <@&${adminRole.id}>\n` +
          `• **User Role:** <@&${userRole.id}>\n` +
          `• **Super Admin:** ${adminUser ? `<@${adminUser.id}>` : (services.config.adminUserId ? `<@${services.config.adminUserId}>` : 'Chủ sở hữu máy chủ')}`,
          0x22c55e
        )
      ]
    };
  }

  // 1B. PASSWORD (Đổi mật khẩu Web cho admin ngay trên Discord)
  if (subcommand === 'password') {
    if (!checkSuperAdmin(interaction, services, allowedGuildId)) {
      return {
        embeds: [embed('⛔ TỪ CHỐI TRUY CẬP', 'Chỉ Chủ sở hữu server hoặc SuperAdmin mới có quyền đổi mật khẩu quản trị viên.', 0xef4444)]
      };
    }

    const newPassword = interaction.options.getString('new_password');
    if (!newPassword) {
      if (typeof interaction.showModal === 'function' && !interaction.deferred && !interaction.replied) {
        await interaction.showModal(buildAdminPasswordModal());
        return null;
      }
      return {
        embeds: [embed('❌ LỖI', 'Mật khẩu quản trị viên phải dài từ 6 đến 256 ký tự.', 0xef4444)]
      };
    }
    if (newPassword.length < 6 || newPassword.length > 256) {
      return {
        embeds: [embed('❌ LỖI', 'Mật khẩu quản trị viên phải dài từ 6 đến 256 ký tự.', 0xef4444)]
      };
    }

    const { hashAdminPasswordAsync } = require('../../utils/secrets');
    const hashed = await hashAdminPasswordAsync(newPassword);
    if (services.accessStore && typeof services.accessStore.setSetting === 'function') {
      await services.accessStore.setSetting('admin_credentials', {
        passwordHash: hashed,
        updatedAt: new Date().toISOString()
      });
    }
    if (typeof services.registry?.setAdminPassword === 'function') {
      services.registry.setAdminPassword(hashed);
    }
    if (typeof services.accessStore?.unlinkDiscord === 'function') {
      await services.accessStore.unlinkDiscord('admin').catch(() => null);
    }
    if (typeof services.accessStore?.adapter?.revokeAdminSessions === 'function') {
      await services.accessStore.adapter.revokeAdminSessions().catch(() => null);
    } else if (typeof services.accessStore?.adapter?.revokeUserSessions === 'function') {
      await services.accessStore.adapter.revokeUserSessions('admin').catch(() => null);
    }
    if (typeof services.invalidateAdminSessions === 'function') {
      services.invalidateAdminSessions();
    }
    await services.accessStore?.addAudit?.({
      action: 'DISCORD_ADMIN_PASSWORD_CHANGED',
      actorId: interaction.user?.id || 'discord-admin',
      targetId: 'admin',
      details: { via: 'discord_command', guildId: interaction.guildId || null }
    }).catch(() => null);

    return {
      embeds: [
        embed(
          '✅ ĐỔI MẬT KHẨU ADMIN THÀNH CÔNG',
          'Đã cập nhật mật khẩu cho tài khoản Quản trị viên Web (`admin`). Bạn có thể dùng mật khẩu mới này để đăng nhập vào Web Dashboard ngay lập tức.',
          0x22c55e
        )
      ]
    };
  }

  return {
    embeds: [embed('❌ LỖI', `Lệnh con không hợp lệ: \`${subcommand}\`.`, 0xef4444)]
  };
}

module.exports = {
  data: definition,
  execute,
  shouldSkipDefer
};
