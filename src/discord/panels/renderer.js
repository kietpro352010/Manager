'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, TextInputStyle
} = require('discord.js');
const { escapeMarkdown } = require('discord.js');

const COLOR = 0x0f766e;

const { cleanText, extractChatMessage, diagnoseErrorMessage } = require('../../utils/text-format');

function padId(num) {
  const n = Number(num) || 0;
  return n < 10 ? `0${n}` : `${n}`;
}

function safe(value, max = 180) {
  const limit = Math.min(max, 1024);
  return escapeMarkdown(String(value || '—').replace(/[\r\n\t]/g, ' ').slice(0, limit)).replace(/@/g, '@\u200b');
}

function can(role, required) { return required === 'user' ? ['user', 'admin'].includes(role) : role === 'admin'; }
function button(label, customId, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setLabel(String(label).slice(0, 80)).setCustomId(customId).setStyle(style).setDisabled(disabled);
}
function embed(title, description = '', color = COLOR) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(String(title || '').slice(0, 256))
    .setDescription(String(description || '').slice(0, 4096))
    .setTimestamp(new Date());
}
function pageNavigation(role, page = 'overview') {
  const row = new ActionRowBuilder().addComponents(
    button('Tổng quan', 'km:page:overview', page === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    button('Danh sách Bot', 'km:page:workers', page === 'workers' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ...(can(role, 'admin') ? [button('Thành viên', 'km:page:access', page === 'access' ? ButtonStyle.Primary : ButtonStyle.Secondary)] : []),
    ...(can(role, 'admin') ? [button('Nhật ký', 'km:page:audit', page === 'audit' ? ButtonStyle.Primary : ButtonStyle.Secondary)] : []),
    button('Làm mới', 'km:page:refresh', ButtonStyle.Success)
  );
  return row;
}

function uptimeText(value) {
  const seconds = Math.max(0, Number(value) || 0);
  if (!seconds) return '0s';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainingSeconds}s`;
  return `${seconds}s`;
}

function formatRate(value) {
  if (value === null || value === undefined || value === '') return '—';
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0) return '—';
  return rate >= 1024 ? `${(rate / 1024).toFixed(1)} KB/s` : `${Math.round(rate)} B/s`;
}

function workerState(worker) {
  if (!worker.reachable) return 'Mất kết nối';
  const status = worker.status || {};
  if (status.online && ['online', 'entering'].includes(status.state)) return 'Online (AFK)';
  if (status.state === 'authenticating') return 'Đang đăng nhập';
  if (status.state === 'connecting') return 'Đang kết nối';
  if (status.state === 'stopped') return 'Đã dừng';
  return status.state || 'chưa rõ';
}

function statusColor(worker) {
  if (!worker || !worker.reachable) return 0xe74c3c; // Red
  const status = worker.status || {};
  if (status.online || status.state === 'online') return 0x2ecc71; // Green
  if (['connecting', 'authenticating', 'entering', 'reconnect_scheduled'].includes(status.state)) return 0xf1c40f; // Yellow
  if (status.state === 'stopped') return 0x95a5a6; // Gray
  return 0xe74c3c; // Red
}

function statusBadge(worker) {
  if (!worker || !worker.reachable) return '🔴 **Host Mất Kết Nối**';
  const status = worker.status || {};
  if (status.online || status.state === 'online') return '🟢 **Đang Online (AFK Trong Cụm)**';
  if (status.state === 'authenticating') return '🟡 **Đang Đăng Nhập Sảnh (/login)...**';
  if (status.state === 'entering') return '🟡 **Đang Vào Cụm KingSMP...**';
  if (status.state === 'connecting') return '🟡 **Đang Kết Nối Server...**';
  if (status.state === 'reconnect_scheduled') return '🟡 **Đang Chờ Kết Nối Lại...**';
  if (status.state === 'stopped') return '⚪ **Đã Dừng Hoạt Động**';
  if (status.restriction) return `⚠️ **Bị Giới Hạn Server (${safe(status.restriction)})**`;
  return `🔴 **Mất Kết Nối (${safe(status.state || 'chưa rõ')})**`;
}

async function botDashboard({ registry, accessControl }, userId, role, notice = '') {
  const workers = await accessControl.workersFor(userId, await registry.list(), role);
  const lines = workers.slice(0, 22).map((worker) => {
    const status = worker.status || {};
    const gamePing = Number.isFinite(status.pingMs) ? `${Math.round(status.pingMs)}ms` : '—';
    const uptime = status.online ? uptimeText(status.uptimeSeconds) : '—';
    const icon = worker.reachable && (status.online || status.state === 'online') ? '🟢' : worker.reachable ? '🟡' : '🔴';
    return `${icon} **Bot #${padId(worker.botNumber)} · ${safe(worker.name, 36)}** · Ping: ${gamePing} · Uptime: ${uptime}`;
  });
  if (workers.length > 22) lines.push(`…và ${workers.length - 22} bot khác.`);
  if (!workers.length) lines.push(role === 'admin' ? 'Chưa có bot nào được đăng ký trong hệ thống.' : 'Chưa có bot nào được gán cho bạn. Hãy liên hệ Admin để được cấp bot.');

  const components = [];
  if (workers.length) {
    const options = workers.slice(0, 25).map((worker) => ({
      label: `Bot #${padId(worker.botNumber)} · ${String(worker.name || worker.workerId).slice(0, 80)}`,
      description: `${workerState(worker)} · ${worker.provider}`.slice(0, 100),
      value: worker.workerId
    }));
    const select = new StringSelectMenuBuilder().setCustomId('km:worker:select')
      .setPlaceholder('Chọn bot để mở bảng điều khiển chi tiết').addOptions(options);
    components.push(new ActionRowBuilder().addComponents(select));
  }
  components.push(pageNavigation(role, 'overview'));
  return { embeds: [embed('🎮 Danh Sách Bot KingMC AFK', `${notice ? `**${safe(notice, 220)}**\n\n` : ''}${lines.join('\n')}`, 0x0f766e)
    .setFooter({ text: `Quyền hạn: ${role === 'admin' ? 'Quản trị viên (Toàn quyền)' : 'Thành viên'} · Dùng /panel để mở lại` })], components };
}

async function overview({ registry, accessControl }, userId, role, notice = '') {
  const workers = await accessControl.workersFor(userId, await registry.list(), role);
  const member = await accessControl.memberFor(userId);
  const lines = workers.slice(0, 8).map((worker) => {
    const icon = worker.reachable && (worker.status?.online || worker.status?.state === 'online') ? '🟢' : worker.reachable ? '🟡' : '🔴';
    return `${icon} **Bot #${padId(worker.botNumber)} · ${safe(worker.name, 40)}** · ${workerState(worker)}`;
  });
  if (workers.length > 8) lines.push(`…và ${workers.length - 8} bot khác. Mở **Danh sách Bot** để xem hết.`);
  if (!workers.length) lines.push(role === 'admin' ? 'Chưa có bot nào được đăng ký.' : 'Chưa có bot nào được gán cho tài khoản của bạn.');
  const accessText = role === 'admin' ? 'Quản trị viên (Admin)' : 'Thành viên (User)';
  const entitlement = role === 'user'
    ? (accessControl.isEntitled(member) ? 'Vĩnh viễn' : 'Đã tạm khóa')
    : 'Toàn quyền hệ thống';
  const body = [notice ? `**${safe(notice, 220)}**` : '', lines.join('\n')].filter(Boolean).join('\n\n');
  const panel = embed('👑 KingMC AFK · Bảng Tổng Quan', body, 0x0f766e)
    .addFields({ name: 'Quyền hạn của bạn', value: `${accessText} · ${entitlement}`, inline: true })
    .setFooter({ text: `Người dùng: ${userId}` });
  return { embeds: [panel], components: [pageNavigation(role)] };
}

async function workersPage({ registry, accessControl }, userId, role, notice = '') {
  const workers = await accessControl.workersFor(userId, await registry.list(), role);
  const lines = workers.slice(0, 20).map((worker) => {
    const icon = worker.reachable && (worker.status?.online || worker.status?.state === 'online') ? '🟢' : worker.reachable ? '🟡' : '🔴';
    return `${icon} **Bot #${padId(worker.botNumber)} · ${safe(worker.name, 40)}** (\`${safe(worker.workerId, 32)}\`) · ${workerState(worker)}`;
  });
  if (!workers.length) lines.push('Chưa có bot nào được đăng ký trong hệ thống.');
  if (workers.length > 20) lines.push(`Đang hiển thị 20 / ${workers.length} bot.`);
  const components = [];
  if (workers.length) {
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId('km:worker:select')
      .setPlaceholder('Chọn bot để điều khiển')
      .addOptions(workers.slice(0, 25).map((worker) => ({
        label: `Bot #${padId(worker.botNumber)} · ${String(worker.name || worker.workerId).slice(0, 80)}`,
        description: `Mã: ${worker.workerId} · ${workerState(worker)}`.slice(0, 100),
        value: worker.workerId
      })))));
  }
  const tools = [];
  if (can(role, 'admin')) tools.push(
    button('Thêm bot mới', 'km:workers:add', ButtonStyle.Success),
    button('Tắt toàn bộ', 'km:fleet:stop-all', ButtonStyle.Danger),
    button('Khởi động lại lỗi', 'km:fleet:reconnect-errors', ButtonStyle.Primary),
    button('Dọn dẹp', 'km:fleet:clean-dead', ButtonStyle.Secondary)
  );
  tools.push(button('Quay lại', 'km:page:overview'));
  components.push(new ActionRowBuilder().addComponents(tools));
  return { embeds: [embed('📋 Danh Sách Bot', `${notice ? `**${safe(notice, 220)}**\n\n` : ''}${lines.join('\n')}`, 0x0f766e)], components };
}

async function workerDetail({ registry, accessControl }, userId, workerId, role, notice = '') {
  const worker = await registry.find(workerId);
  if (!worker) return { embeds: [embed('Không tìm thấy Bot', 'Bot này có thể đã bị xóa khỏi hệ thống. Hãy làm mới danh sách.', 0xe74c3c)], components: [pageNavigation(role, 'workers')] };
  if (!(await accessControl.canUseWorker(userId, worker, role))) throw new Error('Bạn không có quyền truy cập bot này hoặc quyền truy cập của bạn đã hết hạn.');
  const status = worker.status || {};
  const privateSettings = await registry.privateSettings(workerId);

  const events = (worker.events || []).slice(-4).reverse();
  const eventIcons = {
    kicked: '🚪', connection_error: '⚠️', online: '🟢', stopped: '🛑',
    maintenance: '🕒', chat: '💬', ip_limited: '⛔', banned: '🚫'
  };
  const logLines = events.map((event) => {
    const date = new Date(event.occurredAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
    const icon = eventIcons[event.type] || '•';
    const text = extractChatMessage(event.message || event.reason || '');
    return `\`${date}\` ${icon} ${safe(text, 110)}`;
  });

  const color = statusColor(worker);
  const badge = statusBadge(worker);
  const description = [notice ? `**${safe(notice, 220)}**\n` : '', badge].filter(Boolean).join('\n');

  const pingText = Number.isFinite(status.pingMs) ? `${Math.round(status.pingMs)}ms` : '—';
  const mgrLatency = Number.isFinite(status.managerLatencyMs) ? `${status.managerLatencyMs}ms` : '15ms';
  const tpsText = Number.isFinite(status.tps) ? status.tps.toFixed(1) : '20.0';
  const uptimeVal = status.online ? uptimeText(status.uptimeSeconds) : '0s';
  const ramText = Number.isFinite(status.rssMb) ? `${Math.round(status.rssMb)} MB` : '—';
  const cpuText = Number.isFinite(status.cpuPercent) ? `${status.cpuPercent.toFixed(1)}%` : '—';
  const accountText = privateSettings?.credentialsConfigured ? safe(privateSettings.username, 32) : 'Chưa cài đặt';

  const panel = embed(`🤖 Quản Lý Bot #${padId(worker.botNumber)} · ${safe(worker.name, 48)}`, description, color).addFields(
    { name: '👤 Tài khoản', value: `\`${accountText}\``, inline: true },
    { name: '⚡ Độ trễ', value: `Game: \`${pingText}\` · Host: \`${mgrLatency}\``, inline: true },
    { name: '⏱️ Hoạt động', value: `Uptime: \`${uptimeVal}\` · TPS: \`${tpsText}\``, inline: true },
    { name: '📊 Tài nguyên Host', value: `RAM: \`${ramText}\` · CPU: \`${cpuText}\``, inline: true }
  );

  const errorText = status.lastError || status.lastKickReason;
  if (errorText) {
    panel.addFields({
      name: '⚠️ Chẩn đoán lỗi & gợi ý',
      value: safe(diagnoseErrorMessage(errorText), 500),
      inline: false
    });
  }

  panel.addFields({ name: '📜 Nhật ký gần đây', value: (logLines.join('\n') || 'Chưa có sự kiện nào.').slice(0, 1024), inline: false });
  panel.setFooter({ text: '🕒 Bảo trì server: 04:30 - 05:30 hàng ngày · Dùng /panel để mở lại' });

  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    button('🟢 Bật Bot', `km:worker:action:start:${workerId}`, ButtonStyle.Success),
    button('🛑 Tắt Bot', `km:worker:action:stop:${workerId}`, ButtonStyle.Danger),
    button('🔄 Khởi động lại', `km:worker:action:restart:${workerId}`, ButtonStyle.Primary),
    button('🔄 Cập nhật', `km:worker:action:status:${workerId}`)
  ));
  const management = [
    button('💬 Gửi chat game', `km:worker:chat:${workerId}`, ButtonStyle.Primary),
    button('👤 Tài khoản MC', `km:worker:credentials:${workerId}`, ButtonStyle.Secondary),
    button('📋 Danh sách Bot', 'km:page:workers')
  ];
  rows.push(new ActionRowBuilder().addComponents(management));
  const adminTools = [];
  if (can(role, 'admin')) {
    adminTools.push(button('Reset dữ liệu', `km:worker:reset:${workerId}`, ButtonStyle.Danger), button('Đổi Secret', `km:worker:rotate:${workerId}`, ButtonStyle.Secondary), button('Xóa Bot', `km:worker:remove:${workerId}`, ButtonStyle.Danger));
    rows.push(new ActionRowBuilder().addComponents(adminTools));
  }
  return { embeds: [panel], components: rows };
}

async function accessPage({ accessStore, config }, role, notice = '') {
  const entries = await accessStore.listAccess();
  const grants = entries.slice(0, 12).map((entry) => {
    const bots = Array.isArray(entry.workerIds) && entry.workerIds.length ? entry.workerIds.join(', ') : 'Chưa gán bot';
    const access = 'vĩnh viễn';
    return `• <@${entry.userId}> · ${entry.role} · ${entry.status || 'hoạt động'} · ${access} · ${safe(bots, 100)}`;
  });
  const text = [grants.length ? grants.join('\n') : 'Chưa có thành viên nào được cấp quyền.', entries.length > 15 ? `…và ${entries.length - 15} thành viên khác.` : '']
    .filter(Boolean).join('\n');
  const controls = [
    button('Thêm / Cập nhật User', 'km:access:grant', ButtonStyle.Success),
    button('Vô hiệu hóa User', 'km:access:disable', ButtonStyle.Danger),
    button('Xóa User', 'km:access:revoke', ButtonStyle.Danger),
    button('Quay lại', 'km:page:overview')
  ];
  return { embeds: [embed('👥 Quản Lý Thành Viên & Quyền Hạn', `${notice ? `**${safe(notice, 220)}**\n\n` : ''}${text}\n\nQuyền Discord quyết định Admin/User. User role: <@&${config.userRoleId}> · Admin role: <@&${config.adminRoleId}>.`, 0x0f766e)], components: [new ActionRowBuilder().addComponents(controls)] };
}

async function auditPage({ accessStore }, role) {
  const entries = await accessStore.listAudit(12);
  const lines = entries.map((entry) => {
    const time = new Date(entry.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    return `• \`${time}\` <@${entry.actorId}>: **${safe(entry.action, 40)}** ${entry.target ? `(\`${safe(entry.target, 40)}\`)` : ''}`;
  });
  return { embeds: [embed('📜 Nhật Ký Hoạt Động', lines.join('\n') || 'Chưa có nhật ký hoạt động nào.', 0x0f766e)], components: [pageNavigation(role, 'audit')] };
}

function textModal(customId, title, fields) {
  const { ModalBuilder, ActionRowBuilder, TextInputBuilder } = require('discord.js');
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  for (const field of fields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setStyle(field.style || TextInputStyle.Short)
      .setRequired(field.required !== false)
      .setMaxLength(field.maxLength || 100)
      .setPlaceholder(field.placeholder || '');
    if (field.value) input.setValue(field.value);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

module.exports = {
  overview,
  workersPage,
  workerDetail,
  botDashboard,
  accessPage,
  auditPage,
  textModal,
  can,
  safe,
  uptimeText,
  workerState,
  cleanText,
  extractChatMessage,
  padId,
  statusColor,
  statusBadge
};
