'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { renderAdminStatus, renderAdminBots, embed } = require('../panels/renderer');
const { resolveLinkedUser } = require('../handlers/panel-handler');

const definition = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Bảng điều khiển và quản trị hệ thống Enterprise (Dành riêng cho Admin)')
  .addSubcommand((cmd) =>
    cmd.setName('status').setDescription('Xem tổng quan sức khỏe, tài nguyên RAM, Uptime và cơ sở dữ liệu')
  )
  .addSubcommand((cmd) =>
    cmd.setName('health').setDescription('Kiểm tra chi tiết liveness & readiness (Discord Gateway, Supabase DB)')
  )
  .addSubcommand((cmd) =>
    cmd.setName('bots').setDescription('Xem toàn bộ bot trong hệ thống Fleet với quyền quản trị')
  )
  .addSubcommand((cmd) =>
    cmd.setName('setup').setDescription('Thiết lập cấu hình phân quyền Admin/User Role cho Discord Server này')
      .addRoleOption((opt) => opt.setName('admin_role').setDescription('Role dành cho Quản trị viên (Admin)').setRequired(true))
      .addRoleOption((opt) => opt.setName('user_role').setDescription('Role dành cho Thành viên thuê bot (User)').setRequired(true))
      .addUserOption((opt) => opt.setName('admin_user').setDescription('User Discord được chỉ định làm SuperAdmin (tùy chọn)').setRequired(false))
  );

async function execute(interaction, services) {
  const user = await resolveLinkedUser(interaction, services);
  const isSuperAdmin = user?.role === 'admin' ||
    (services.config?.adminUserId && services.config.adminUserId === interaction.user.id) ||
    interaction.guild?.ownerId === interaction.user.id;

  const subcommand = interaction.options.getSubcommand();

  // 1. SETUP
  if (subcommand === 'setup') {
    if (!isSuperAdmin) {
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
    if (adminUser) services.accessControl.setAdminUserId(adminUser.id);

    await services.accessStore.setSetting('discord_roles', {
      adminRoleId: adminRole.id,
      userRoleId: userRole.id,
      adminUserId: adminUser ? adminUser.id : (services.config.adminUserId || '')
    });

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

  // Ensure role is admin for remaining subcommands
  if (!isSuperAdmin) {
    return {
      embeds: [embed('⛔ TỪ CHỐI TRUY CẬP', 'Lệnh này chỉ dành cho Quản trị viên hệ thống (Admin).', 0xef4444)]
    };
  }

  // 2. STATUS & HEALTH
  if (subcommand === 'status' || subcommand === 'health') {
    const allWorkers = await services.registry.list();
    const onlineWorkers = allWorkers.filter((w) => w.status?.online).length;
    const stats = { totalWorkers: allWorkers.length, onlineWorkers };

    let dbOk = true;
    let dbLatencyMs = 0;
    if (services.store?.adapter && typeof services.store.adapter.testConnection === 'function') {
      const start = Date.now();
      try {
        const testRes = await services.store.adapter.testConnection();
        dbOk = Boolean(testRes?.ok);
        dbLatencyMs = Date.now() - start;
      } catch (_) {
        dbOk = false;
      }
    }

    const systemInfo = {
      uptime: process.uptime(),
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024))
      },
      checks: {
        database: { ok: dbOk, latencyMs: dbLatencyMs },
        discord: { ok: services.client ? services.client.isReady() : true }
      }
    };

    return renderAdminStatus({ stats, systemInfo });
  }

  // 3. BOTS
  if (subcommand === 'bots') {
    const allWorkers = await services.registry.list();
    return renderAdminBots({ workers: allWorkers, page: 0 });
  }
}

module.exports = {
  data: definition,
  execute
};
