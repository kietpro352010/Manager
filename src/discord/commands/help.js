'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed } = require('../panels/renderer');

const definition = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Xem hướng dẫn sử dụng Discord Dashboard & liên kết Web Manager');

async function execute() {
  const helpEmbed = embed(
    '📘 HƯỚNG DẪN SỬ DỤNG KBOT DISCORD',
    'Bảng điều khiển thu nhỏ giúp bạn theo dõi trạng thái và bật/tắt bot nhanh ngay trên Discord.',
    0x0ea5e9
  )
    .addFields(
      {
        name: '👤 Lệnh Người Dùng',
        value:
          '• `/login` — Liên kết tài khoản Web bằng Username & Mật khẩu\n' +
          '• `/logout` — Đăng xuất và hủy liên kết tài khoản Discord\n' +
          '• `/bots` — Mở danh sách bot và bảng điều khiển nhanh\n' +
          '• `/logs` — Xem nhật ký hoạt động gần nhất của bot\n' +
          '• `/help` — Hiển thị bảng hướng dẫn này',
        inline: false
      },
      {
        name: '🛡️ Lệnh Quản Trị (Admin)',
        value:
          '• `/check` — Gửi bảng theo dõi hệ thống (tự động cập nhật mỗi 15 phút)\n' +
          '• `/kbot` — Danh sách máy chủ Discord đang chạy KBot\n' +
          '• `/admin` — Phân quyền Role server & đổi mật khẩu Admin\n' +
          '• `/wispbyte` — Quản lý tài khoản Wispbyte & giữ hạn 14 ngày',
        inline: false
      },
      {
        name: '🎮 Thao Tác Nhanh Trong /bots',
        value:
          'Chọn nút tên bot để xem Ping, TPS, Vị trí, Uptime và thao tác **Bật / Tắt / Khởi động lại / Làm mới**.',
        inline: false
      }
    )
    .setFooter({ text: 'Đổi tài khoản Minecraft, Proxy, nạp Key hay xem Chat trực tiếp trên Web Manager' });

  return { embeds: [helpEmbed] };
}

module.exports = {
  data: definition,
  execute
};
