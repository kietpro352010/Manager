'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed } = require('../panels/renderer');

const definition = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Xem hướng dẫn sử dụng Discord Dashboard & liên kết Web Manager');

async function execute() {
  const desc =
    `### 🌟 HỆ THỐNG BOT AFK KINGMC CLOUD 24/7 (DUAL-ENGINE)\n\n` +
    `Discord Bot đóng vai trò là **Bảng điều khiển thu nhỏ**, tập trung theo dõi trạng thái và thao tác nhanh từng bot thông qua giao diện nút bấm trực quan.\n\n` +
    `### 📌 DANH SÁCH LỆNH NGƯỜI DÙNG\n` +
    `• \`/login\`: Mở biểu mẫu đăng nhập tài khoản Web Manager bằng Username & Mật khẩu.\n` +
    `• \`/logout\`: Đăng xuất và hủy liên kết tài khoản Discord hiện tại.\n` +
    `• \`/bots\`: Mở bảng điều khiển chính danh sách bot bạn sở hữu.\n` +
    `• \`/logs\`: Xem nhật ký 10 sự kiện gần nhất của bot với menu chuyển bot nhanh.\n` +
    `• \`/help\`: Hiển thị bảng hướng dẫn này.\n\n` +
    `### 🎮 THAO TÁC TRÊN PANEL TỪNG BOT\n` +
    `Khi gọi \`/bots\`, bấm vào nút của từng bot để mở chi tiết:\n` +
    `• **BẬT (START):** Khởi chạy phiên AFK kết nối máy chủ KingMC.\n` +
    `• **TẮT (STOP):** Ngắt kết nối và đóng an toàn phiên bot.\n` +
    `• **KHỞI ĐỘNG LẠI (RESTART):** Tải lại cấu hình và kết nối lại ngay lập tức.\n` +
    `• **LÀM MỚI (REFRESH):** Cập nhật chỉ số Ping, Uptime, Reconnect mới nhất.\n\n` +
    `> 💡 *Để đổi mật khẩu Minecraft, thiết lập Proxy SOCKS5, nạp Giftcode hoặc đổi tên hiển thị, vui lòng truy cập nền tảng **Web Manager**.*`;

  return {
    embeds: [embed('HƯỚNG DẪN SỬ DỤNG DISCORD MONITORING', desc, 0x0ea5e9)]
  };
}

module.exports = {
  data: definition,
  execute
};
