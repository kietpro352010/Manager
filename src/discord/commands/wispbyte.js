'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed, renderWispbyteList, renderWispbyteCheckResult } = require('../panels/renderer');
const { resolveLinkedUser } = require('../handlers/panel-handler');

function checkUserAdmin(interaction, services, user, allowedGuildId) {
  const { isUserAdmin } = require('../handlers/interaction-handler');
  return isUserAdmin(interaction, services, user, allowedGuildId);
}

const definition = new SlashCommandBuilder()
  .setName('wispbyte')
  .setDescription('Quản lý đa tài khoản Wispbyte & Tự động giữ hạn 14 ngày (Chỉ Admin)')
  .addSubcommand((cmd) =>
    cmd.setName('list')
      .setDescription('Xem danh sách tài khoản Wispbyte, trạng thái và số lần gia hạn')
  )
  .addSubcommand((cmd) =>
    cmd.setName('check')
      .setDescription('Kiểm tra và truy cập Client Panel ngay lập tức cho toàn bộ tài khoản')
  )
  .addSubcommand((cmd) =>
    cmd.setName('add')
      .setDescription('Thêm hoặc cập nhật tài khoản Wispbyte')
      .addStringOption((opt) =>
        opt.setName('id')
          .setDescription('ID định danh tài khoản (2–32 ký tự: chữ thường, số, gạch ngang, gạch dưới)')
          .setRequired(true)
          .setMaxLength(32)
      )
      .addStringOption((opt) =>
        opt.setName('cookie')
          .setDescription('Chuỗi Cookie đăng nhập (lấy từ Header Cookie https://wispbyte.com/client)')
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName('name')
          .setDescription('Tên gợi nhớ (ví dụ: Wispbyte Node 1)')
          .setRequired(false)
          .setMaxLength(48)
      )
      .addStringOption((opt) =>
        opt.setName('panel_url')
          .setDescription('URL Panel Wispbyte (mặc định: https://wispbyte.com/client)')
          .setRequired(false)
      )
  )
  .addSubcommand((cmd) =>
    cmd.setName('remove')
      .setDescription('Xóa một tài khoản Wispbyte khỏi hệ thống')
      .addStringOption((opt) =>
        opt.setName('id')
          .setDescription('ID tài khoản Wispbyte cần xóa')
          .setRequired(true)
      )
  );

async function execute(interaction, services) {
  const { getEffectiveAllowedGuildId } = require('../handlers/interaction-handler');
  const allowedGuildId = await getEffectiveAllowedGuildId(services?.config, services);
  const user = (services?.accessStore?.getUserByDiscordId && typeof resolveLinkedUser === 'function')
    ? await resolveLinkedUser(interaction, services)
    : null;
  const isAdmin = checkUserAdmin(interaction, services, user, allowedGuildId);

  if (!isAdmin) {
    return {
      embeds: [embed('⛔ TỪ CHỐI TRUY CẬP', 'Lệnh này chỉ dành cho Quản trị viên hệ thống (Admin).', 0xef4444)]
    };
  }

  const manager = services?.wispbyteKeepAlive;
  if (!manager) {
    return {
      embeds: [embed('❌ LỖI', 'Dịch vụ WispbyteKeepAlive chưa được khởi tạo trên Manager.', 0xef4444)]
    };
  }

  const subcommand = interaction.options?.getSubcommand?.(false) || 'list';

  // 1. LIST
  if (subcommand === 'list') {
    const accounts = await manager.getAccounts();
    return renderWispbyteList({ accounts });
  }

  // 2. CHECK / RENEW
  if (subcommand === 'check') {
    const res = await manager.checkAll({ notifyDiscord: false });
    return renderWispbyteCheckResult({
      results: res.results || [],
      total: res.total || 0,
      okCount: res.okCount || 0,
      expiredCount: res.expiredCount || 0,
      errorCount: (res.results || []).filter((r) => !r.success && r.status !== 'expired').length
    });
  }

  // 3. ADD / UPDATE
  if (subcommand === 'add') {
    const id = String(interaction.options.getString('id') || '').trim().toLowerCase();
    const rawCookie = String(interaction.options.getString('cookie') || '');
    if (/[\r\n]/.test(rawCookie)) {
      return {
        embeds: [embed('❌ COOKIE KHÔNG HỢP LỆ', 'Cookie không được chứa ký tự xuống dòng (CRLF).', 0xef4444)]
      };
    }
    const cookie = rawCookie.trim();
    const name = String(interaction.options.getString('name') || id).trim();
    const panelUrl = String(interaction.options.getString('panel_url') || '').trim();

    if (!id || !/^[a-z0-9_-]{2,32}$/.test(id)) {
      return {
        embeds: [embed('❌ ID KHÔNG HỢP LỆ', 'ID tài khoản phải từ 2–32 ký tự thường, số, dấu gạch nối hoặc gạch dưới.', 0xef4444)]
      };
    }
    if (!cookie || cookie.length < 10) {
      return {
        embeds: [embed('❌ COOKIE KHÔNG HỢP LỆ', 'Cookie phải là chuỗi hợp lệ (dài tối thiểu 10 ký tự).', 0xef4444)]
      };
    }

    try {
      await manager.addOrUpdateAccount({ id, name, cookie, panelUrl: panelUrl || undefined });

      // Ngay sau khi lưu, thực hiện kiểm tra ping kết nối Client Panel
      let pingSuccess = false;
      let pingStatus = 'unknown';
      let pingMsg = '—';
      try {
        const testPing = await manager.pingAccount({ id, name, cookie, panelUrl });
        if (testPing) {
          pingSuccess = Boolean(testPing.success);
          pingStatus = testPing.status || 'unknown';
          pingMsg = testPing.message || '—';

          const accounts = await manager.getAccounts();
          const targetAcc = accounts.find((a) => a.id === id);
          if (targetAcc) {
            targetAcc.lastPingAt = new Date().toISOString();
            targetAcc.lastStatus = pingStatus;
            targetAcc.lastMessage = pingMsg;
            if (pingSuccess) targetAcc.renewCount = (targetAcc.renewCount || 0) + 1;
            await manager.saveAccounts(accounts);
          }
        }
      } catch (pingErr) {
        pingStatus = 'error';
        pingMsg = pingErr.message || 'Lỗi kiểm tra ping';
      }

      const icon = pingSuccess ? '🟢' : (pingStatus === 'expired' ? '🔴' : '🟡');

      return {
        embeds: [
          embed(
            '✅ ĐÃ LƯU TÀI KHOẢN WISPBYTE',
            `Đã lưu tài khoản **${name}** (\`${id}\`) vào hệ thống (mã hóa an toàn trong database).\n\n` +
            `**Kết quả kiểm tra kết nối Client Panel:**\n` +
            `${icon} **Trạng thái:** \`${pingStatus.toUpperCase()}\`\n` +
            `> Chi tiết: *${pingMsg}*\n\n` +
            `*Hệ thống sẽ tự động gửi request truy cập Client Panel mỗi 24 giờ để giữ hạn 14 ngày.*`,
            pingSuccess ? 0x22c55e : 0xf59e0b
          )
        ]
      };
    } catch (err) {
      return {
        embeds: [embed('❌ LỖI LƯU TÀI KHOẢN', err.message || 'Không thể lưu tài khoản Wispbyte.', 0xef4444)]
      };
    }
  }

  // 4. REMOVE
  if (subcommand === 'remove') {
    const id = String(interaction.options.getString('id') || '').trim().toLowerCase();
    if (!id) {
      return {
        embeds: [embed('❌ LỖI', 'Vui lòng cung cấp ID tài khoản cần xóa.', 0xef4444)]
      };
    }

    const removed = await manager.deleteAccount(id);
    if (removed) {
      return {
        embeds: [embed('🗑️ ĐÃ XÓA TÀI KHOẢN', `Đã xóa tài khoản Wispbyte **${id}** khỏi hệ thống.`, 0x22c55e)]
      };
    }
    return {
      embeds: [embed('⚠️ KHÔNG TÌM THẤY', `Không tìm thấy tài khoản Wispbyte với ID: **${id}**.`, 0xf59e0b)]
    };
  }

  return renderWispbyteList({ accounts: await manager.getAccounts() });
}

module.exports = {
  data: definition,
  execute
};
