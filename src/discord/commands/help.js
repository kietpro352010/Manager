'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { embed, button, plainCode } = require('../panels/renderer');
const {
  resolveActiveDiscordAccountLink,
  isUserAccountEntitled,
  resolvePublicBaseUrl
} = require('../handlers/panel-handler');

const definition = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Xem hướng dẫn sử dụng Discord Dashboard & liên kết Web Manager');

async function execute(interaction = null, services = null) {
  const discordUserId = String(interaction?.user?.id || '').trim();
  const publicBaseUrl = resolvePublicBaseUrl(services);

  let linkedUser = null;
  if (discordUserId && services?.accessStore) {
    linkedUser = await resolveActiveDiscordAccountLink(discordUserId, services).catch(() => null);
  }

  let showAdminSection = !interaction;
  if (interaction && services) {
    try {
      const { isUserAdmin, getEffectiveAllowedGuildId } = require('../handlers/interaction-handler');
      const allowedGuildId = await getEffectiveAllowedGuildId(services?.config, services);
      showAdminSection = isUserAdmin(interaction, services, linkedUser, allowedGuildId);
    } catch (_) {}
  }

  const accountBanner = linkedUser
    ? `✅ Đang đăng nhập với tài khoản Web **\`${plainCode(linkedUser.username, 48)}\`**. Chọn nhanh thao tác bằng các nút bên dưới!`
    : 'Bảng điều khiển thu nhỏ giúp bạn liên kết tài khoản Web, bật/tắt bot nhanh và tích điểm ngay trên Discord.';

  const helpEmbed = embed(
    '📘 HƯỚNG DẪN SỬ DỤNG KBOT DISCORD',
    accountBanner,
    0x0ea5e9
  ).addFields(
    {
      name: '🚀 Bắt Đầu Nhanh (3 Bước)',
      value:
        '1️⃣ Dùng `/login` (hoặc bấm nút **Đăng nhập ngay** bên dưới) nhập Username & Mật khẩu Web để nhận Role tự động.\n' +
        '2️⃣ Gõ `/bots` → Bấm vào tên bot để xem **Ping, TPS, Máu, Vị trí** và **Bật / Tắt / Khởi động lại / Xem Nhật ký**.\n' +
        '3️⃣ Gõ `/diemdanh` hằng ngày sau `00:00` để nhận **+10đ/ngày** và giữ chuỗi thưởng **+30đ** mỗi 7 ngày.',
      inline: false
    },
    {
      name: '🤖 Lệnh Điều Khiển Bot & Tài Khoản',
      value:
        '• `/login` — Đăng nhập / Kiểm tra trạng thái liên kết tài khoản Web\n' +
        '• `/logout` — Đăng xuất và thu hồi liên kết Discord hiện tại\n' +
        '• `/bots` — Mở bảng điều khiển danh sách bot của bạn\n' +
        '• `/logs [bot_id] [lines]` — Xem nhật ký hoạt động (chấp nhận ID, `#01`, số thứ tự hoặc tên bot)\n' +
        '• `/help` — Mở bảng hướng dẫn & phím tắt nhanh này',
      inline: false
    },
    {
      name: '🎁 Tích Điểm & Bảng Xếp Hạng (Dành cho thành viên đã /login)',
      value:
        '• `/diemdanh` — Điểm danh nhận **+10đ/ngày** (mốc 7, 14, 21... ngày **+30đ**; lỡ 1 ngày có thể dùng **50đ** khôi phục chuỗi)\n' +
        '• `/diem [nguoidung]` — Xem hồ sơ điểm, chuỗi hiện tại và hạng server\n' +
        '• `/tinnhan [nguoidung]` — Xem tổng tin nhắn tích lũy\n' +
        '• `/bxh` — Xem Top 10 Điểm, Chuỗi điểm danh & Tin nhắn\n' +
        '• Chat trong server tự động cộng âm thầm **+1đ/tin nhắn** *(điểm không bao giờ âm)*',
      inline: false
    }
  );

  if (showAdminSection) {
    helpEmbed.addFields({
      name: '🛡️ Lệnh Quản Trị Hệ Thống (Admin)',
      value:
        '• `/check` — Gửi bảng theo dõi trạng thái hệ thống tự động cập nhật mỗi 15 phút\n' +
        '• `/admin setup` · `/admin password` — Thiết lập Role phân quyền & đổi mật khẩu Admin\n' +
        '• `/wispbyte` — Quản lý đa tài khoản Wispbyte & giữ hạn 14 ngày\n' +
        '• `/kbot` — Xem danh sách máy chủ Discord đang chạy KBot\n' +
        '• `/diemadmin` — Cộng, trừ, đặt hoặc reset điểm thành viên',
      inline: false
    });
  }

  helpEmbed.setFooter({
    text: 'Đổi nick Minecraft, Proxy, Lịch hẹn giờ, Auto-Chat & Nạp Key trực tiếp trên Web Manager'
  });

  const components = [];
  if (discordUserId) {
    const quickRow = new ActionRowBuilder();
    if (!linkedUser) {
      quickRow.addComponents(
        button('Đăng nhập ngay', `login:prompt:${discordUserId}`, ButtonStyle.Primary, false, '🔐')
      );
      if (publicBaseUrl) {
        quickRow.addComponents(
          new ButtonBuilder()
            .setLabel('Mở trang Web')
            .setStyle(ButtonStyle.Link)
            .setURL(publicBaseUrl)
            .setEmoji('🌐')
        );
      }
    } else {
      if (isUserAccountEntitled(linkedUser, services)) {
        quickRow.addComponents(
          button('Danh sách Bot', 'bots:list', ButtonStyle.Primary, false, '🤖')
        );
      }
      quickRow.addComponents(
        button('Điểm danh', `points:quick_checkin:${discordUserId}`, ButtonStyle.Success, false, '📅'),
        button('Bảng xếp hạng', 'points:lb:tatca', ButtonStyle.Secondary, false, '🏆')
      );
      if (publicBaseUrl) {
        quickRow.addComponents(
          new ButtonBuilder()
            .setLabel('Web Dashboard')
            .setStyle(ButtonStyle.Link)
            .setURL(publicBaseUrl)
            .setEmoji('🌐')
        );
      }
      quickRow.addComponents(
        button('Đăng xuất', `login:logout:${discordUserId}`, ButtonStyle.Danger, false, '🚪')
      );
    }
    if (quickRow.components.length > 0) {
      components.push(quickRow);
    }
  }

  return { embeds: [helpEmbed], components };
}

module.exports = {
  data: definition,
  execute
};
