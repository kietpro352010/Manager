'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, TextInputStyle, ModalBuilder, TextInputBuilder
} = require('discord.js');
const { escapeMarkdown } = require('discord.js');

const COLOR_BRAND = 0x0ea5e9; // Sky blue
const COLOR_ONLINE = 0x22c55e; // Green
const COLOR_OFFLINE = 0xef4444; // Red
const COLOR_WARN = 0xf59e0b; // Amber / Yellow

function padId(num) {
  const n = Number(num) || 0;
  return n < 10 ? `0${n}` : `${n}`;
}

function safe(value, max = 250) {
  const limit = Math.min(max, 1024);
  return escapeMarkdown(String(value || '—').replace(/[\r\n\t]/g, ' ').slice(0, limit)).replace(/@/g, '@\u200b');
}

function button(label, customId, style = ButtonStyle.Secondary, disabled = false, emoji = null) {
  const btn = new ButtonBuilder()
    .setLabel(String(label).slice(0, 80))
    .setCustomId(String(customId || 'noop').slice(0, 100))
    .setStyle(style)
    .setDisabled(disabled);
  if (emoji) btn.setEmoji(emoji);
  return btn;
}

function embed(title, description = '', color = COLOR_BRAND) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(String(title || '').slice(0, 256))
    .setDescription(String(description || '').slice(0, 4096))
    .setTimestamp(new Date());
}

function uptimeText(secondsVal) {
  const seconds = Math.max(0, Number(secondsVal) || 0);
  if (!seconds) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remSec = seconds % 60;
  if (days > 0) return `${days}d ${padId(hours)}h ${padId(minutes)}m`;
  if (hours > 0) return `${padId(hours)}h ${padId(minutes)}m`;
  if (minutes > 0) return `${padId(minutes)}m ${padId(remSec)}s`;
  return `${remSec}s`;
}

function getWorkerState(worker) {
  const rawState = String(worker?.status?.state || (worker?.status?.online ? 'online' : 'offline')).toLowerCase();
  const isAfkState = rawState === 'afk' || rawState === 'afk_locked';
  const isOnline = Boolean(worker?.status?.online || rawState === 'online' || isAfkState);
  const isBusy = ['connecting', 'reconnecting', 'starting', 'stopping'].includes(rawState);

  let label = 'OFFLINE';
  let emoji = '🔴';
  let color = COLOR_OFFLINE;

  if (isOnline) {
    label = isAfkState ? 'ONLINE (AFK)' : 'ONLINE';
    emoji = '🟢';
    color = COLOR_ONLINE;
  } else if (rawState === 'connecting' || rawState === 'reconnecting') {
    label = rawState.toUpperCase();
    emoji = '🟡';
    color = COLOR_WARN;
  } else if (rawState === 'stopping' || rawState === 'starting') {
    label = rawState.toUpperCase();
    emoji = '🟡';
    color = COLOR_WARN;
  }

  return { rawState, isOnline, isBusy, label, emoji, color };
}

// ----------------------------------------------------------------------------
// 1. MAIN BOTS LIST PANEL (/bots)
// ----------------------------------------------------------------------------
function renderBotsList({ user, workers = [], page = 0, pageSize = 5, notice = '' }) {
  const totalBots = workers.length;
  const totalPages = Math.max(1, Math.ceil(totalBots / pageSize));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const startIndex = currentPage * pageSize;
  const currentWorkers = workers.slice(startIndex, startIndex + pageSize);

  let desc = `Tài khoản: **${safe(user?.username || 'Khách')}**\nSố bot được cấp: **${totalBots}**`;
  if (notice) {
    desc += `\n\n${notice}`;
  }
  desc += '\n\nChọn nút có tên bot bên dưới để xem thông tin hoặc điều khiển bot.\n\n';

  if (totalBots === 0) {
    desc += '⚠️ *Bạn chưa sở hữu bot nào. Vui lòng liên hệ Admin hoặc truy cập Web Manager để đăng ký bot.*';
  } else {
    for (const worker of currentWorkers) {
      const state = getWorkerState(worker);
      const rawName = safe(worker.name || `BOT ${padId(worker.botNumber || 1)}`);
      const botLabel = rawName.toLowerCase().startsWith('bot #') ? rawName : `Bot #${padId(worker.botNumber || 1)} · ${rawName}`;
      const fullBotId = worker.workerId;
      const mcUsername = safe(worker.status?.username || worker.settings?.account?.username || '');
      desc += `${state.emoji} **${botLabel}**\n` +
              `> **Bot ID:** \`${fullBotId}\`\n` +
              (mcUsername ? `> **Username:** \`${mcUsername}\`\n` : '') +
              `> **Trạng thái:** \`${state.label}\`\n\n`;
    }
  }

  const hasOnline = workers.some((w) => getWorkerState(w).isOnline);
  const mainEmbed = embed('KINGMC CLOUD 24/7 — DANH SÁCH BOT', desc, hasOnline ? COLOR_ONLINE : COLOR_BRAND);

  // Components
  const components = [];

  // Row 1: Individual Bot Buttons (Up to 5 on this page)
  if (currentWorkers.length > 0) {
    const botButtonsRow = new ActionRowBuilder();
    for (const worker of currentWorkers) {
      const state = getWorkerState(worker);
      const botLabel = (worker.name ? `${worker.name}` : `BOT ${padId(worker.botNumber || 1)}`).slice(0, 20);
      botButtonsRow.addComponents(
        button(`${state.emoji} ${botLabel}`, `bot:view:${worker.workerId}`, ButtonStyle.Secondary)
      );
    }
    components.push(botButtonsRow);
  }

  // Row 2: Navigation & Refresh
  const navRow = new ActionRowBuilder();
  if (totalPages > 1) {
    navRow.addComponents(
      button('◀ Trang trước', `bots:page:${currentPage - 1}`, ButtonStyle.Secondary, currentPage <= 0),
      button(`${currentPage + 1}/${totalPages}`, 'bots:noop', ButtonStyle.Secondary, true),
      button('Trang sau ▶', `bots:page:${currentPage + 1}`, ButtonStyle.Secondary, currentPage >= totalPages - 1)
    );
  }
  navRow.addComponents(
    button('Làm mới', 'bots:refresh', ButtonStyle.Success, false, '🔄')
  );
  components.push(navRow);

  return { embeds: [mainEmbed], components };
}

// ----------------------------------------------------------------------------
// 2. PER-BOT DETAIL PANEL (bot:view:{workerId})
// ----------------------------------------------------------------------------
function renderBotDetail({ user, worker, notice = '', isExecuting = false }) {
  if (!worker) {
    return {
      embeds: [embed('❌ LỖI', 'Không tìm thấy thông tin bot này hoặc bot đã bị xóa.', COLOR_OFFLINE)],
      components: [new ActionRowBuilder().addComponents(button('Quay lại danh sách', 'bots:list', ButtonStyle.Secondary))]
    };
  }

  const state = getWorkerState(worker);
  const botName = safe(worker.name || `BOT ${padId(worker.botNumber || 1)}`);
  const rawWorkerId = String(worker.workerId || worker.id || '');
  const fullBotId = safe(rawWorkerId);
  const mcUsername = safe(worker.status?.username || worker.settings?.account?.username || 'Chưa thiết lập');
  const pingMs = Number(worker.status?.pingMs);
  const ping = state.isOnline && Number.isFinite(pingMs) ? `${pingMs} ms` : '—';
  const tpsValue = worker.status?.tps;
  const tps = tpsValue !== null && tpsValue !== undefined && Number.isFinite(Number(tpsValue))
    ? `${Number(tpsValue).toFixed(1)}`
    : '—';
  const uptime = state.isOnline ? uptimeText(worker.status?.uptimeSeconds) : '—';
  const reconnects = worker.status?.reconnectCount || worker.status?.reconnectAttempts || 0;
  const server = safe(worker.status?.server || worker.serverHost || 'mc.kingmc.vn');
  const provider = safe(worker.provider || 'wispbyte').toUpperCase();
  const position = worker.status?.position;
  const hasPosition = position &&
    [position.x, position.y, position.z].every((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const coordinates = hasPosition
    ? `X: ${Math.round(Number(position.x))}, Y: ${Math.round(Number(position.y))}, Z: ${Math.round(Number(position.z))}`
    : '';
  const rawDimension = String(worker.status?.dimension || '').replace(/^minecraft:/i, '').trim();
  const locationStates = { login: 'Đang đăng nhập', lobby: 'Sảnh', other: 'Trong game' };
  const rawLocationState = String(worker.status?.locationState || '').trim().toLowerCase();
  const locationState = locationStates[rawLocationState] || '';
  const location = [coordinates, rawDimension, locationState].filter(Boolean).join(' · ') || 'Chưa có dữ liệu vị trí';

  let descText = notice ? `${notice}\n\n` : '';
  descText += `> **Bot ID:** \`${fullBotId}\`\n` +
              `> **Username:** \`${mcUsername}\`\n` +
              `> **Server:** \`${server}\`\n` +
              `> **Trạng thái:** ${state.emoji} **${state.label}**\n` +
              `> **Ping:** \`${ping}\` · **TPS:** \`${tps}\`\n` +
              `> **Location:** \`${safe(location, 180)}\`\n` +
              `> **Uptime:** \`${uptime}\` · **Reconnects:** \`${reconnects}\`\n\n` +
              'Thông tin nhanh và thao tác bot ở các nút bên dưới.';

  const detailEmbed = embed(
    `${state.emoji} ${botName.toUpperCase()} — CHI TIẾT BOT`,
    descText,
    state.color
  );
  if (user?.role === 'admin') {
    detailEmbed.addFields({ name: '🖥️ Host / Nền tảng', value: '`' + provider + '`', inline: true });
  }

  // Buttons
  // ONLINE: Disable START, Enable STOP & RESTART
  // OFFLINE: Enable START, Disable STOP & RESTART
  // ERROR: Allow START, STOP (halt reconnect loop), and RESTART
  // CONNECTING/RECONNECTING/STARTING: Disable START & RESTART, allow STOP to cancel
  // STOPPING: Disable all
  const isStopping = state.rawState === 'stopping';
  const canStopState = state.isOnline || ['error', 'connecting', 'reconnecting', 'starting'].includes(state.rawState);
  const disableStart = state.isOnline || state.isBusy || isExecuting;
  const disableStop = !canStopState || isStopping || isExecuting;
  const disableRestart = (!state.isOnline && state.rawState !== 'error') || state.isBusy || isExecuting;

  const controlRow = new ActionRowBuilder().addComponents(
    button('BẬT (START)', `bot:start:${rawWorkerId}`, ButtonStyle.Success, disableStart, '▶️'),
    button('TẮT (STOP)', `bot:stop:${rawWorkerId}`, ButtonStyle.Danger, disableStop, '⏹️'),
    button('KHỞI ĐỘNG LẠI', `bot:restart:${rawWorkerId}`, ButtonStyle.Primary, disableRestart, '🔄')
  );

  const navRow = new ActionRowBuilder().addComponents(
    button('Làm mới', `bot:refresh:${rawWorkerId}`, ButtonStyle.Secondary, isExecuting, '🔄'),
    button('Quay lại danh sách', 'bots:list', ButtonStyle.Secondary, false, '◀')
  );

  return { embeds: [detailEmbed], components: [controlRow, navRow] };
}

// ----------------------------------------------------------------------------
// 4. ADMIN PANELS (/admin)
// ----------------------------------------------------------------------------
function renderAdminStatus({ stats, systemInfo, notice = '' }) {
  let desc = `### 🛡️ TỔNG QUAN HỆ THỐNG ENTERPRISE (ADMIN)\n\n`;
  if (notice) desc += `${notice}\n\n`;

  const totalWorkers = stats?.totalWorkers ?? 0;
  const onlineWorkers = stats?.onlineWorkers ?? 0;
  const memoryRss = systemInfo?.memory?.rssMb ?? Math.round(process.memoryUsage().rss / (1024 * 1024));
  const memoryHeap = systemInfo?.memory?.heapUsedMb ?? Math.round(process.memoryUsage().heapUsed / (1024 * 1024));
  const uptime = uptimeText(systemInfo?.uptime ?? process.uptime());
  const dbStatus = systemInfo?.checks?.database?.ok ? '🟢 Kết nối ổn định' : '🔴 Mất kết nối';
  const dbLatency = systemInfo?.checks?.database?.latencyMs ? `${systemInfo.checks.database.latencyMs} ms` : '—';
  const discordStatus = systemInfo?.checks?.discord?.ok ? '🟢 Sẵn sàng' : '🟡 Đang kết nối';

  desc += `• **Tổng số Bot trong Fleet:** **${totalWorkers}** bot\n` +
          `• **Đang Online:** **${onlineWorkers}** bot | **Offline:** **${totalWorkers - onlineWorkers}** bot\n` +
          `• **Bộ nhớ Node.js:** RSS \`${memoryRss} MB\` | Heap \`${memoryHeap} MB\`\n` +
          `• **Thời gian hoạt động:** \`${uptime}\`\n` +
          `• **Cơ sở dữ liệu (Supabase):** ${dbStatus} (\`${dbLatency}\`)\n` +
          `• **Discord Gateway:** ${discordStatus}\n`;

  const adminEmbed = embed('BẢNG ĐIỀU KHIỂN HỆ THỐNG — ADMIN', desc, COLOR_BRAND);

  const btnRow = new ActionRowBuilder().addComponents(
    button('Xem tất cả Bot', 'admin:bots:0', ButtonStyle.Primary, false, '🤖'),
    button('Wispbyte KeepAlive', 'wispbyte:list', ButtonStyle.Secondary, false, '🛰️'),
    button('Làm mới', 'admin:status:refresh', ButtonStyle.Secondary, false, '🔄')
  );

  return { embeds: [adminEmbed], components: [btnRow] };
}

function renderAdminBots({ workers = [], page = 0, pageSize = 5, notice = '' }) {
  const totalBots = workers.length;
  const totalPages = Math.max(1, Math.ceil(totalBots / pageSize));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const currentWorkers = workers.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  let desc = `### 🌐 QUẢN LÝ TOÀN BỘ BOT TRÊN HỆ THỐNG (ADMIN)\n` +
             `Tổng số bot: **${totalBots}** | Trang: **${currentPage + 1}/${totalPages}**\n\n`;
  if (notice) desc += `${notice}\n\n`;

  for (const worker of currentWorkers) {
    const state = getWorkerState(worker);
    const botName = safe(worker.name || `BOT ${padId(worker.botNumber || 1)}`);
    const fullBotId = worker.workerId;
    const mcUser = safe(worker.status?.username || '—');
    const provider = safe(worker.provider || 'wispbyte');

    desc += `${state.emoji} **${botName.toUpperCase()}** (\`${fullBotId}\`)\n` +
            `> Minecraft: \`${mcUser}\` | Host: \`${provider}\` | Trạng thái: **${state.label}**\n\n`;
  }

  const adminEmbed = embed('DANH SÁCH TOÀN BỘ BOT — ADMIN', desc, COLOR_BRAND);
  const components = [];

  if (currentWorkers.length > 0) {
    const btnRow = new ActionRowBuilder();
    for (const w of currentWorkers) {
      const state = getWorkerState(w);
      const label = (w.name || `BOT ${padId(w.botNumber || 1)}`).slice(0, 20);
      btnRow.addComponents(
        button(`${state.emoji} ${label}`, `bot:view:${w.workerId}`, ButtonStyle.Secondary)
      );
    }
    components.push(btnRow);
  }

  const navRow = new ActionRowBuilder();
  if (totalPages > 1) {
    navRow.addComponents(
      button('◀ Trang trước', `admin:bots:${currentPage - 1}`, ButtonStyle.Secondary, currentPage <= 0),
      button('Trang sau ▶', `admin:bots:${currentPage + 1}`, ButtonStyle.Secondary, currentPage >= totalPages - 1)
    );
  }
  navRow.addComponents(
    button('Tổng quan Admin', 'admin:status', ButtonStyle.Primary, false, '🛡️'),
    button('Làm mới', `admin:bots:${currentPage}`, ButtonStyle.Success, false, '🔄')
  );
  components.push(navRow);

  return { embeds: [adminEmbed], components };
}

// Modal helper for /login
function buildLoginModal() {
  const modal = new ModalBuilder()
    .setCustomId('login_modal')
    .setTitle('Đăng nhập tài khoản Web Manager');

  const usernameInput = new TextInputBuilder()
    .setCustomId('login_username')
    .setLabel('Tên đăng nhập (Username)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Nhập username tài khoản Web của bạn')
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(32);

  const passwordInput = new TextInputBuilder()
    .setCustomId('login_password')
    .setLabel('Mật khẩu (Password)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Nhập mật khẩu của bạn')
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(128);

  modal.addComponents(
    new ActionRowBuilder().addComponents(usernameInput),
    new ActionRowBuilder().addComponents(passwordInput)
  );

  return modal;
}

function buildAdminPasswordModal() {
  const modal = new ModalBuilder()
    .setCustomId('admin_password_modal')
    .setTitle('Đổi mật khẩu Quản trị viên (Admin)');

  const passwordInput = new TextInputBuilder()
    .setCustomId('new_password')
    .setLabel('Mật khẩu quản trị mới (6–128 ký tự)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Nhập mật khẩu mới (sẽ được ẩn và mã hóa)')
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(128);

  modal.addComponents(new ActionRowBuilder().addComponents(passwordInput));
  return modal;
}

// Backwards-compatible botDashboard adapter for cross-engine tests and legacy callers
async function botDashboard(services, userId, role, notice = '') {
  let workers = [];
  if (services?.accessControl?.workersFor) {
    workers = await services.accessControl.workersFor(userId, await services.registry.list(), role);
  } else if (services?.registry?.list) {
    workers = await services.registry.list();
  }
  let user = { username: 'DiscordUser', role };
  if (services?.accessStore?.getUserByDiscordId) {
    user = (await services.accessStore.getUserByDiscordId(userId)) || user;
  }
  return renderBotsList({ user, workers, notice });
}

function renderBotLogs({ user, worker, logs = [] }) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const rawWorkerId = String(worker?.workerId || worker?.id || '');
  const fullBotId = safe(rawWorkerId || 'Toàn hệ thống');
  const botName = safe(worker?.name || (worker?.botNumber ? `BOT ${padId(worker.botNumber)}` : fullBotId));

  const sanitize = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text
      // 1. Private keys block
      .replace(/-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?(?:-----END[ A-Z0-9_-]*PRIVATE KEY-----|$)/gi, '[REDACTED PRIVATE KEY]')
      // 2. Database connection strings: postgres://user:password@host
      .replace(/([a-zA-Z0-9+.-]+:\/\/[^:]+:)[^@]+(@)/gi, '$1[REDACTED]$2')
      // 3. Authorization header with Bearer or Basic or token
      .replace(/(authorization\s*[:=]\s*)(Bearer\s+[A-Za-z0-9_\-\.]+|Basic\s+[A-Za-z0-9+/=]+|[^\s,;]+)/gi, '$1[REDACTED]')
      // 4. Standalone Bearer token
      .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]+/gi, '$1[REDACTED]')
      // 5. Standard key-value secret fields
      .replace(/(password|token|secret|apikey|access_token|refresh_token)\s*[:=]\s*[^\s,;]+/gi, '$1: [REDACTED]')
      // 6. Word boundary key: / key=
      .replace(/\b(key)\s*[:=]\s*[^\s,;]+/gi, '$1: [REDACTED]')
      // 7. Minecraft auth commands (/login, /dn, /register, /dk, /changepassword)
      .replace(/(\/(?:[a-z0-9_-]+:)?(?:login|l|register|reg|dn|dk|changepassword|changepass)\s+).+$/gim, '$1[REDACTED]')
      // 8. Neutralize Discord markdown code-block breakout
      .replace(/```/g, '`\u200b`\u200b`');
  };

  const formattedLogs = safeLogs.map((l) => {
    if (!l) return '';
    if (typeof l === 'string') return sanitize(l);
    const timeStr = l.time ? `[${String(l.time).slice(11, 19)}] ` : '';
    const levelStr = (l.type || l.level) ? `[${String(l.type || l.level).toUpperCase()}] ` : '';
    const msg = l.message || l.text || JSON.stringify(l);
    return sanitize(`${timeStr}${levelStr}${msg}`);
  }).filter(Boolean);

  const logContent = formattedLogs.length > 0
    ? formattedLogs.join('\n')
    : 'Không có nhật ký nào được ghi nhận.';

  const logEmbed = embed(
    `📜 NHẬT KÝ HOẠT ĐỘNG: ${String(botName).toUpperCase()}`,
    `Bot ID: \`${fullBotId}\`\n\`\`\`text\n${logContent.slice(-3500)}\n\`\`\``,
    COLOR_BRAND
  );

  const components = [];
  if (rawWorkerId) {
    components.push(
      new ActionRowBuilder().addComponents(
        button('Làm mới', `bot:refresh:${rawWorkerId}`, ButtonStyle.Secondary, false, '🔄'),
        button('Chi tiết bot', `bot:view:${rawWorkerId}`, ButtonStyle.Primary, false, 'ℹ️'),
        button('Quay lại danh sách', 'bots:list', ButtonStyle.Secondary, false, '◀')
      )
    );
  }

  return {
    embeds: [logEmbed],
    components
  };
}

function maskCookieDisplay(cookie) {
  if (!cookie || typeof cookie !== 'string') return '—';
  if (cookie.length <= 8) return '********';
  return cookie.slice(0, 4) + '****' + cookie.slice(-4);
}

function renderWispbyteList({ accounts = [], notice = '' }) {
  let desc = `### 🛰️ DANH SÁCH TÀI KHOẢN WISPBYTE AUTO-KEEPALIVE\n` +
             `Hệ thống tự động truy cập Client Panel **24h/lần** để duy trì quy tắc 14 ngày của Wispbyte.\n\n`;

  if (notice) desc += `${notice}\n\n`;

  if (!Array.isArray(accounts) || accounts.length === 0) {
    desc += `ℹ️ *Chưa có tài khoản Wispbyte nào được cấu hình trong hệ thống.*\n\n` +
            `**Hướng dẫn thêm tài khoản:**\n` +
            `Dùng lệnh: \`/wispbyte add id:<id> cookie:<chuỗi_cookie> [name:<tên>] [panel_url:<url>]\`\n\n` +
            `> 💡 *Lấy chuỗi cookie từ Request Header \`Cookie:\` khi đăng nhập https://wispbyte.com/client trên trình duyệt.*`;
  } else {
    desc += `Tổng số tài khoản: **${accounts.length}**\n\n`;
    accounts.forEach((acc, idx) => {
      const isOk = acc.lastStatus === 'ok';
      const isExpired = acc.lastStatus === 'expired';
      const icon = isOk ? '🟢' : (isExpired ? '🔴' : '⚪');
      const statusLabel = isOk ? 'Hoạt động (OK)' : (isExpired ? 'Hết hạn Cookie' : 'Chưa chạy');
      const lastPing = acc.lastPingAt
        ? new Date(acc.lastPingAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
        : 'Chưa có';
      const renewCount = acc.renewCount || 0;
      const maskedCookie = maskCookieDisplay(acc.cookie);
      const panelUrl = acc.panelUrl || 'https://wispbyte.com/client';

      desc += `**${idx + 1}. ${icon} ${safe(acc.name || acc.id)}** (\`${acc.id}\`)\n` +
              `> • Trạng thái: **${statusLabel}** | Lần giữ hạn: **${renewCount}** lần\n` +
              `> • Truy cập cuối: \`${lastPing}\`\n` +
              `> • Panel: \`${panelUrl}\` | Cookie: \`${maskedCookie}\`\n`;
      if (acc.lastMessage && acc.lastMessage !== 'Saved, ready for ping' && acc.lastMessage !== '—') {
        desc += `> • Ghi chú: *${safe(acc.lastMessage, 120)}*\n`;
      }
      desc += `\n`;
    });
    desc += `> 💡 *Dùng nút bên dưới hoặc lệnh \`/wispbyte check\` để kích hoạt truy cập Client Panel ngay lập tức.*`;
  }

  const wispEmbed = embed('QUẢN LÝ ĐA TÀI KHOẢN WISPBYTE — ADMIN', desc, COLOR_BRAND);

  const btnRow = new ActionRowBuilder().addComponents(
    button('Kiểm tra / Gia hạn ngay', 'wispbyte:check', ButtonStyle.Primary, false, '🔄'),
    button('Làm mới danh sách', 'wispbyte:list', ButtonStyle.Secondary, false, '📋'),
    button('Tổng quan Admin', 'admin:status', ButtonStyle.Secondary, false, '🛡️')
  );

  return { embeds: [wispEmbed], components: [btnRow] };
}

function renderWispbyteCheckResult({ results = [], total = 0, okCount = 0, expiredCount = 0, errorCount = 0, notice = '' }) {
  const allOk = okCount === total && total > 0;
  const statusColor = allOk ? COLOR_ONLINE : (expiredCount > 0 ? COLOR_OFFLINE : COLOR_WARN);

  let desc = `### 🛰️ KẾT QUẢ TRUY CẬP CLIENT PANEL WISPBYTE\n\n`;
  if (notice) desc += `${notice}\n\n`;

  desc += `• **Tổng số tài khoản:** \`${total}\`\n` +
          `• **Thành công:** **${okCount}** ✅\n` +
          `• **Hết hạn / Lỗi:** **${(expiredCount || 0) + (errorCount || 0)}** ⚠️\n\n`;

  if (Array.isArray(results) && results.length > 0) {
    results.forEach((r, idx) => {
      const icon = r.success ? '🟢' : (r.status === 'expired' ? '🔴' : '🟡');
      desc += `**${idx + 1}. ${icon} ${safe(r.name || r.id)}** (\`${r.id}\`)\n` +
              `> • Trạng thái: ${r.success ? '**OK**' : `**${(r.status || 'ERROR').toUpperCase()}**`}\n` +
              `> • Chi tiết: *${safe(r.message || '—', 160)}*\n` +
              `> • Tổng lần giữ hạn: **${r.renewCount || 0}**\n\n`;
    });
  } else {
    desc += `ℹ️ *Chưa có tài khoản Wispbyte nào được cấu hình trong hệ thống.*\n\n`;
  }

  if (expiredCount > 0) {
    desc += `⚠️ **CẢNH BÁO:** Phát hiện **${expiredCount}** tài khoản bị hết hạn Cookie!\n` +
            `Vui lòng lấy Cookie mới từ trình duyệt và cập nhật lại bằng:\n` +
            `\`/wispbyte add id:<id> cookie:<cookie_mới>\`\n\n`;
  }

  desc += `*Hệ thống tự động lặp lại kiểm tra mỗi 24 giờ.*`;

  const checkEmbed = embed('KẾT QUẢ GIA HẠN WISPBYTE — ADMIN', desc, statusColor);

  const btnRow = new ActionRowBuilder().addComponents(
    button('Kiểm tra lại', 'wispbyte:check', ButtonStyle.Primary, false, '🔄'),
    button('Xem danh sách tài khoản', 'wispbyte:list', ButtonStyle.Secondary, false, '📋'),
    button('Tổng quan Admin', 'admin:status', ButtonStyle.Secondary, false, '🛡️')
  );

  return { embeds: [checkEmbed], components: [btnRow] };
}

module.exports = {
  renderBotsList,
  renderBotDetail,
  renderAdminStatus,
  renderAdminBots,
  renderBotLogs,
  renderWispbyteList,
  renderWispbyteCheckResult,
  buildLoginModal,
  buildAdminPasswordModal,
  getWorkerState,
  uptimeText,
  padId,
  safe,
  embed,
  button,
  botDashboard,
  overview: botDashboard,
  workersPage: botDashboard,
  workerDetail: renderBotDetail,
  handleStaleWorkerInteraction: async () => {}
};
