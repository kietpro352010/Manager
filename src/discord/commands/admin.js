'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { renderAdminStatus, renderAdminBots, buildAdminPasswordModal, embed } = require('../panels/renderer');
const { resolveLinkedUser } = require('../handlers/panel-handler');

function checkUserAdmin(interaction, services, user) {
  const { isUserAdmin } = require('../handlers/interaction-handler');
  return isUserAdmin(interaction, services, user);
}

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
  const user = (services?.accessStore?.getUserByDiscordId && typeof resolveLinkedUser === 'function')
    ? await resolveLinkedUser(interaction, services)
    : null;
  const isAdmin = checkUserAdmin(interaction, services, user);

  if (!isAdmin) {
    return {
      embeds: [embed('⛔ TỪ CHỐI TRUY CẬP', 'Lệnh này chỉ dành cho Quản trị viên hệ thống (Admin).', 0xef4444)]
    };
  }

  const subcommand = interaction.options.getSubcommand();

  // 1. SETUP
  if (subcommand === 'setup') {
    const isSuperAdmin = user?.role === 'admin' ||
      (services?.config?.adminUserId && services.config.adminUserId === interaction.user?.id) ||
      (services?.accessControl?.adminUserId && services.accessControl.adminUserId === interaction.user?.id) ||
      interaction.guild?.ownerId === interaction.user?.id;

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
    if (adminUser) {
      services.accessControl.setAdminUserId(adminUser.id);
      services.adminNotifier?.setAdminUserId?.(adminUser.id);
    }

    await services.accessStore.setSetting('discord_access', {
      guildId: interaction.guildId || services.config?.discordGuildId || '',
      adminRoleId: adminRole.id,
      userRoleId: userRole.id,
      adminUserId: adminUser ? adminUser.id : (services.config.adminUserId || ''),
      configuredBy: interaction.user?.id || 'discord-setup'
    });

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
    const isSuperAdmin = user?.role === 'admin' ||
      (services?.config?.adminUserId && services.config.adminUserId === interaction.user?.id) ||
      (services?.accessControl?.adminUserId && services.accessControl.adminUserId === interaction.user?.id) ||
      interaction.guild?.ownerId === interaction.user?.id;

    if (!isSuperAdmin) {
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

    const { hashAdminPassword } = require('../../utils/secrets');
    const hashed = hashAdminPassword(newPassword);
    if (services.accessStore && typeof services.accessStore.setSetting === 'function') {
      await services.accessStore.setSetting('admin_credentials', {
        passwordHash: hashed,
        updatedAt: new Date().toISOString()
      });
    }
    if (typeof services.registry?.setAdminPassword === 'function') {
      services.registry.setAdminPassword(hashed);
    }
    if (typeof services.accessStore?.adapter?.revokeUserSessions === 'function') {
      await services.accessStore.adapter.revokeUserSessions('admin').catch(() => null);
    }
    if (typeof services.invalidateAdminSessions === 'function') {
      services.invalidateAdminSessions();
    }

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

  // 2. STATUS
  if (subcommand === 'status') {
    const allWorkers = services.registry?.list ? await services.registry.list() : [];
    const onlineWorkers = allWorkers.filter((w) => w.status?.online).length;
    const stats = { totalWorkers: allWorkers.length, onlineWorkers };

    let dbOk = true;
    let dbLatencyMs = 0;
    const store = services.store || services.supabaseClient;
    if (store?.adapter && typeof store.adapter.testConnection === 'function') {
      const start = Date.now();
      try {
        const testRes = await store.adapter.testConnection();
        dbOk = Boolean(testRes?.ok !== false);
        dbLatencyMs = Date.now() - start;
      } catch (_) {
        dbOk = false;
      }
    } else if (typeof store?.testConnection === 'function') {
      const start = Date.now();
      try {
        const testRes = await store.testConnection();
        dbOk = Boolean(testRes?.ok !== false);
        dbLatencyMs = Date.now() - start;
      } catch (_) {
        dbOk = false;
      }
    }

    const discordReady = Boolean((services.discordClient || services.client)?.isReady?.());

    const systemInfo = {
      uptime: process.uptime(),
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024))
      },
      checks: {
        database: { ok: dbOk, latencyMs: dbLatencyMs },
        discord: { ok: discordReady }
      }
    };

    return renderAdminStatus({ stats, systemInfo });
  }

  // 3. HEALTH (Deep Probe)
  if (subcommand === 'health') {
    const allWorkers = services.registry?.list ? await services.registry.list() : [];
    let reachableWorkers = 0;
    for (const w of allWorkers) {
      const isReachable = Boolean(
        w.reachable ||
        w.status?.online ||
        (w.lastHeartbeat && Date.now() - new Date(w.lastHeartbeat).getTime() <= 120000)
      );
      if (isReachable) reachableWorkers++;
    }
    const totalWorkers = allWorkers.length;

    let dbOk = false;
    let dbLatencyMs = -1;
    const store = services.store || services.supabaseClient;
    if (store?.adapter && typeof store.adapter.testConnection === 'function') {
      const start = Date.now();
      try {
        const testRes = await store.adapter.testConnection();
        dbOk = Boolean(testRes?.ok !== false);
        dbLatencyMs = Date.now() - start;
      } catch (_) {
        dbOk = false;
        dbLatencyMs = Date.now() - start;
      }
    } else if (typeof store?.testConnection === 'function') {
      const start = Date.now();
      try {
        const testRes = await store.testConnection();
        dbOk = Boolean(testRes?.ok !== false);
        dbLatencyMs = Date.now() - start;
      } catch (_) {
        dbOk = false;
        dbLatencyMs = Date.now() - start;
      }
    } else {
      dbOk = Boolean(store);
      dbLatencyMs = 0;
    }

    const broker = services.commandBroker || services.broker;
    const pendingQueueCount = (broker?.pendingResults?.size ?? (broker?.queue?.length ?? 0));

    const discordClient = services.discordClient || services.client;
    const discordReady = Boolean(discordClient?.isReady?.());
    const discordPing = typeof discordClient?.ws?.ping === 'number' ? discordClient.ws.ping : -1;

    const isSystemHealthy = dbOk && discordReady;
    const healthColor = isSystemHealthy ? 0x22c55e : (dbOk || discordReady ? 0xf59e0b : 0xef4444);

    const desc =
      `### 🏥 KẾT QUẢ KIỂM TRA SỨC KHỎE HỆ THỐNG (DEEP PROBE)\n\n` +
      `• **Cơ sở dữ liệu (Database):** ${dbOk ? '🟢 Khỏe mạnh' : '🔴 Lỗi kết nối'} (\`${dbLatencyMs >= 0 ? `${dbLatencyMs} ms` : 'N/A'}\`)\n` +
      `• **CommandBroker Queue:** \`${pendingQueueCount}\` lệnh đang chờ xử lý\n` +
      `• **Discord Gateway:** ${discordReady ? '🟢 Đã kết nối' : '🔴 Chưa sẵn sàng'} (Ping: \`${discordPing >= 0 ? `${discordPing} ms` : 'N/A'}\`)\n` +
      `• **Worker Fleet Reachability:** **${reachableWorkers}/${totalWorkers}** workers hoạt động (${totalWorkers > 0 ? Math.round((reachableWorkers / totalWorkers) * 100) : 100}%)\n` +
      `• **Node.js Uptime:** \`${Math.round(process.uptime())}s\` | Heap: \`${Math.round(process.memoryUsage().heapUsed / (1024 * 1024))} MB\``;

    const healthEmbed = embed('🏥 KIỂM TRA SỨC KHỎE HỆ THỐNG — HEALTH PROBE', desc, healthColor);
    return {
      embeds: [healthEmbed],
      probe: {
        dbOk,
        dbLatencyMs,
        pendingQueueCount,
        discordReady,
        discordPing,
        reachableWorkers,
        totalWorkers
      }
    };
  }

  // 4. BOTS
  if (subcommand === 'bots') {
    const allWorkers = services.registry?.list ? await services.registry.list() : [];
    return renderAdminBots({ workers: allWorkers, page: 0 });
  }
}

module.exports = {
  data: definition,
  execute,
  shouldSkipDefer
};
