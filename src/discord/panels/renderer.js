'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, TextInputStyle, ModalBuilder, TextInputBuilder
} = require('discord.js');
const { escapeMarkdown } = require('discord.js');
const { redactStringSecrets } = require('../../utils/logger');

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

function plainCode(value, max = 250) {
  const limit = Math.min(max, 1024);
  const raw = value === undefined || value === null || value === '' ? '—' : String(value);
  return raw.replace(/[\r\n\t`]/g, ' ').slice(0, limit).replace(/@/g, '@\u200b');
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
    label = 'ONLINE';
    emoji = '🟢';
    color = COLOR_ONLINE;
  } else if (rawState === 'connecting' || rawState === 'reconnecting' || rawState === 'stopping' || rawState === 'starting') {
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
  const onlineCount = workers.filter((w) => getWorkerState(w).isOnline).length;
  const offlineCount = Math.max(0, totalBots - onlineCount);
  const totalPages = Math.max(1, Math.ceil(totalBots / pageSize));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const startIndex = currentPage * pageSize;
  const currentWorkers = workers.slice(startIndex, startIndex + pageSize);

  let desc = `👤 **Tài khoản:** \`${plainCode(user?.username || 'Khách')}\`  ·  🤖 **Bot:** **${totalBots}** (🟢 **${onlineCount}** / 🔴 **${offlineCount}**)`;
  if (notice) {
    desc += `\n\n${notice}`;
  }
  desc += '\n\n';

  if (totalBots === 0) {
    desc += 'ℹ️ *Bạn chưa sở hữu bot nào. Vui lòng liên hệ Admin hoặc truy cập Web Manager để đăng ký bot.*';
  } else {
    for (const worker of currentWorkers) {
      const state = getWorkerState(worker);
      const rawName = safe(worker.name || `BOT ${padId(worker.botNumber || 1)}`);
      const botLabel = rawName.toLowerCase().startsWith('bot #') ? rawName : `Bot #${padId(worker.botNumber || 1)} · ${rawName}`;
      const fullBotId = plainCode(worker.workerId);
      const rawMcUsername = worker.status?.username || worker.settings?.account?.username || '';
      const mcUsername = rawMcUsername ? plainCode(rawMcUsername) : 'Chưa đặt';
      desc += `${state.emoji} **${botLabel}** — \`${state.label}\`\n` +
              `> • Bot ID: \`${fullBotId}\` · Nhân vật: \`${mcUsername}\`\n\n`;
    }
  }

  const hasOnline = onlineCount > 0;
  const mainEmbed = embed('🎮 KINGMC CLOUD 24/7 — DANH SÁCH BOT', desc.trimEnd(), hasOnline ? COLOR_ONLINE : COLOR_BRAND)
    .setFooter({ text: `Trang ${currentPage + 1}/${totalPages} • Chọn nút bên dưới để điều khiển bot` });

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
  const fullBotId = plainCode(rawWorkerId);
  const mcUsername = plainCode(worker.status?.username || worker.settings?.account?.username || 'Chưa thiết lập');
  const pingMs = Number(worker.status?.pingMs);
  const ping = state.isOnline && Number.isFinite(pingMs) ? `${pingMs} ms` : '—';
  const tpsValue = worker.status?.tps;
  const tps = tpsValue !== null && tpsValue !== undefined && Number.isFinite(Number(tpsValue))
    ? `${Number(tpsValue).toFixed(1)}`
    : '—';
  const uptime = state.isOnline ? uptimeText(worker.status?.uptimeSeconds) : '—';
  const reconnects = worker.status?.reconnectCount || worker.status?.reconnectAttempts || 0;
  const server = plainCode(
    worker.status?.server ||
    worker.status?.serverHost ||
    worker.settings?.serverHost ||
    worker.serverHost ||
    worker.server ||
    'kingmc.vn'
  );
  const provider = plainCode(worker.provider || 'wispbyte', 40).toUpperCase();
  const position = worker.status?.position;
  const hasPosition = position &&
    [position.x, position.y, position.z].every((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const coordinates = hasPosition
    ? `X: ${Math.round(Number(position.x))}, Y: ${Math.round(Number(position.y))}, Z: ${Math.round(Number(position.z))}`
    : '';

  const locState = String(worker.status?.locationState || worker.status?.locationKind || '').trim().toLowerCase();
  let placeName = '';
  if (locState === 'login') {
    placeName = 'Login';
  } else if (locState === 'lobby') {
    placeName = 'Sảnh';
  } else {
    let rawDim = worker.status?.dimension;
    if (typeof rawDim === 'object' && rawDim !== null) {
      rawDim = rawDim.name || rawDim.effects || rawDim.id || '';
    }
    const dim = String(rawDim || '').trim().replace(/^minecraft:/i, '').toLowerCase();
    if (dim === 'the_nether' || dim === 'nether') {
      placeName = 'Nether';
    } else if (dim === 'the_end' || dim === 'end') {
      placeName = 'The End';
    } else if (dim === 'overworld' || dim === 'world') {
      placeName = 'World';
    } else if (dim) {
      placeName = dim.charAt(0).toUpperCase() + dim.slice(1);
    } else if (locState) {
      placeName = locState.charAt(0).toUpperCase() + locState.slice(1);
    }
  }
  const location = [coordinates, placeName].filter(Boolean).join(' · ') || 'Chưa có dữ liệu vị trí';

  let descText = notice ? `${notice}\n\n` : '';
  descText +=
    `━━ **THÔNG TIN BOT** ━━\n` +
    `• **Bot ID:** \`${fullBotId}\`\n` +
    `• **Nhân vật:** \`${mcUsername}\` · **Server:** \`${server}\`\n` +
    `• **Trạng thái:** ${state.emoji} **${state.label}**\n\n` +
    `━━ **HIỆU NĂNG & VỊ TRÍ** ━━\n` +
    `• **Ping:** \`${ping}\` · **TPS:** \`${tps}\`\n` +
    `• **Uptime:** \`${uptime}\` · **Reconnects:** \`${reconnects}\`\n` +
    `• **Vị trí:** \`${plainCode(location, 180)}\``;

  const detailEmbed = embed(
    `${state.emoji} ${botName.toUpperCase()} — CHI TIẾT BOT`,
    descText,
    state.color
  ).setFooter({ text: 'KBOT Cloud 24/7 • Sử dụng các nút bên dưới để điều khiển' });

  if (user?.role === 'admin') {
    detailEmbed.addFields({ name: '🖥️ Nền tảng lưu trữ', value: '`' + provider + '`', inline: true });
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
  let desc = notice ? `${notice}\n\n` : '';

  const totalWorkers = stats?.totalWorkers ?? 0;
  const onlineWorkers = stats?.onlineWorkers ?? 0;
  const memoryRss = systemInfo?.memory?.rssMb ?? Math.round(process.memoryUsage().rss / (1024 * 1024));
  const memoryHeap = systemInfo?.memory?.heapUsedMb ?? Math.round(process.memoryUsage().heapUsed / (1024 * 1024));
  const uptime = uptimeText(systemInfo?.uptime ?? process.uptime());
  const dbStatus = systemInfo?.checks?.database?.ok ? '🟢 Kết nối ổn định' : '🔴 Mất kết nối';
  const dbLatency = systemInfo?.checks?.database?.latencyMs ? `${systemInfo.checks.database.latencyMs} ms` : '—';
  const discordStatus = systemInfo?.checks?.discord?.ok ? '🟢 Sẵn sàng' : '🟡 Đang kết nối';

  desc += `Tổng quan trạng thái hoạt động của hệ thống **KingMC Cloud**.`;

  const adminEmbed = embed('🛡️ BẢNG ĐIỀU KHIỂN HỆ THỐNG — ADMIN', desc, COLOR_BRAND)
    .addFields(
      {
        name: '🤖 Trạng thái Bot',
        value: `Tổng: **${totalWorkers}** bot\n🟢 Online: **${onlineWorkers}** · 🔴 Offline: **${totalWorkers - onlineWorkers}**`,
        inline: true
      },
      {
        name: '🖥️ Host Manager',
        value: `Uptime: \`${uptime}\`\nRSS \`${memoryRss} MB\` · Heap \`${memoryHeap} MB\``,
        inline: true
      },
      {
        name: '📡 Kết nối Dịch vụ',
        value: `Supabase: ${dbStatus} (\`${dbLatency}\`)\nDiscord: ${discordStatus}`,
        inline: false
      }
    )
    .setFooter({ text: 'KBOT Enterprise Admin Panel' });

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

  let desc = `Tổng số bot: **${totalBots}**  ·  Trang **${currentPage + 1}/${totalPages}**\n\n`;
  if (notice) desc += `${notice}\n\n`;

  for (const worker of currentWorkers) {
    const state = getWorkerState(worker);
    const botName = safe(worker.name || `BOT ${padId(worker.botNumber || 1)}`);
    const fullBotId = plainCode(worker.workerId);
    const mcUser = plainCode(worker.status?.username || '—');
    const provider = plainCode(worker.provider || 'wispbyte', 40);

    desc += `${state.emoji} **${botName.toUpperCase()}** (\`${fullBotId}\`) — **${state.label}**\n` +
            `> • Nhân vật: \`${mcUser}\` · Host: \`${provider}\`\n\n`;
  }

  const adminEmbed = embed('🌐 DANH SÁCH TOÀN BỘ BOT — ADMIN', desc.trimEnd(), COLOR_BRAND)
    .setFooter({ text: `KBOT Admin • Trang ${currentPage + 1}/${totalPages}` });
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
    .setPlaceholder('Mật khẩu tài khoản Web')
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(256);

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
    .setLabel('Mật khẩu quản trị mới (6–256 ký tự)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Nhập mật khẩu mới (sẽ được ẩn và mã hóa)')
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(256);

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
  const fullBotId = plainCode(rawWorkerId || 'Toàn hệ thống');
  const botName = safe(worker?.name || (worker?.botNumber ? `BOT ${padId(worker.botNumber)}` : fullBotId));

  const sanitize = (text) => {
    if (!text || typeof text !== 'string') return '';
    return redactStringSecrets(text)
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
  if (cookie.length < 24) return '********';
  return cookie.slice(0, 4) + '****' + cookie.slice(-4);
}

function renderWispbyteList({ accounts = [], notice = '' }) {
  let desc = `Tự động truy cập Client Panel **24h/lần** để duy trì quy tắc 14 ngày của Wispbyte.\n\n`;

  if (notice) desc += `${notice}\n\n`;

  if (!Array.isArray(accounts) || accounts.length === 0) {
    desc += `ℹ️ *Chưa có tài khoản Wispbyte nào được cấu hình trong hệ thống.*\n\n` +
            `**Hướng dẫn thêm tài khoản:**\n` +
            `Dùng lệnh: \`/wispbyte add id:<id> cookie:<chuỗi_cookie> [name:<tên>] [panel_url:<url>]\`\n\n` +
            `> 💡 *Lấy chuỗi cookie từ Request Header \`Cookie:\` khi đăng nhập https://wispbyte.com/client trên trình duyệt.*`;
  } else {
    desc += `Tổng số tài khoản: **${accounts.length}**\n\n`;
    const footerHint = `> 💡 *Dùng nút bên dưới hoặc \`/wispbyte check\` để kích hoạt giữ hạn ngay.*`;
    const maxDescBudget = 3800 - footerHint.length;
    let omittedCount = 0;
    for (let idx = 0; idx < accounts.length; idx++) {
      const acc = accounts[idx];
      const isOk = acc.lastStatus === 'ok';
      const isExpired = acc.lastStatus === 'expired';
      const icon = isOk ? '🟢' : (isExpired ? '🔴' : '⚪');
      const statusLabel = isOk ? 'Hoạt động (OK)' : (isExpired ? 'Hết hạn Cookie' : 'Chưa chạy');
      const lastPing = acc.lastPingAt
        ? new Date(acc.lastPingAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
        : 'Chưa có';
      const renewCount = acc.renewCount || 0;
      const maskedCookie = maskCookieDisplay(acc.cookie);
      const panelUrl = plainCode(acc.panelUrl || 'https://wispbyte.com/client', 120);

      let entry = `**${idx + 1}. ${icon} ${safe(acc.name || acc.id)}** (\`${plainCode(acc.id)}\`)\n` +
                  `> • Trạng thái: **${statusLabel}** · Lần giữ hạn: **${renewCount}**\n` +
                  `> • Truy cập cuối: \`${lastPing}\`\n` +
                  `> • Panel: \`${panelUrl}\` · Cookie: \`${maskedCookie}\`\n`;
      if (acc.lastMessage && acc.lastMessage !== 'Saved, ready for ping' && acc.lastMessage !== '—') {
        entry += `> • Ghi chú: *${safe(acc.lastMessage, 120)}*\n`;
      }
      entry += `\n`;
      if (desc.length + entry.length > maxDescBudget) {
        omittedCount = accounts.length - idx;
        break;
      }
      desc += entry;
    }
    if (omittedCount > 0) {
      desc += `*...và ${omittedCount} tài khoản khác (đã rút gọn theo giới hạn Discord Embed).*\n\n`;
    }
    desc += footerHint;
  }

  const wispEmbed = embed('🛰️ QUẢN LÝ WISPBYTE AUTO-KEEPALIVE — ADMIN', desc, COLOR_BRAND)
    .setFooter({ text: 'Wispbyte KeepAlive • Kiểm tra tự động mỗi 24 giờ' });

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

  let desc = notice ? `${notice}\n\n` : '';

  desc += `• **Tổng số tài khoản:** \`${total}\`\n` +
          `• **Thành công:** **${okCount}** ✅\n` +
          `• **Hết hạn / Khác:** **${(expiredCount || 0) + (errorCount || 0)}** ⚠️\n\n`;

  const footerText = '';
  const expiredWarning = expiredCount > 0
    ? `⚠️ **CẢNH BÁO:** Phát hiện **${expiredCount}** tài khoản bị hết hạn Cookie!\n` +
      `Vui lòng lấy Cookie mới từ trình duyệt và cập nhật lại bằng:\n` +
      `\`/wispbyte add id:<id> cookie:<cookie_mới>\`\n\n`
    : '';
  const maxDescBudget = 3850 - expiredWarning.length;

  if (Array.isArray(results) && results.length > 0) {
    let omittedCount = 0;
    for (let idx = 0; idx < results.length; idx++) {
      const r = results[idx];
      const icon = r.success ? '🟢' : (r.status === 'expired' ? '🔴' : '🟡');
      const entry = `**${idx + 1}. ${icon} ${safe(r.name || r.id)}** (\`${plainCode(r.id)}\`)\n` +
                    `> • Trạng thái: ${r.success ? '**OK**' : `**${(r.status || 'ERROR').toUpperCase()}**`}\n` +
                    `> • Chi tiết: *${safe(r.message || '—', 160)}*\n` +
                    `> • Tổng lần giữ hạn: **${r.renewCount || 0}**\n\n`;
      if (desc.length + entry.length > maxDescBudget) {
        omittedCount = results.length - idx;
        break;
      }
      desc += entry;
    }
    if (omittedCount > 0) {
      desc += `*...và ${omittedCount} kết quả khác (đã rút gọn theo giới hạn Discord Embed).*\n\n`;
    }
  } else {
    desc += `ℹ️ *Chưa có tài khoản Wispbyte nào được cấu hình trong hệ thống.*\n\n`;
  }

  desc += expiredWarning;

  const checkEmbed = embed('🛰️ KẾT QUẢ GIA HẠN WISPBYTE — ADMIN', desc.trimEnd(), statusColor)
    .setFooter({ text: 'Hệ thống tự động lặp lại kiểm tra mỗi 24 giờ' });

  const btnRow = new ActionRowBuilder().addComponents(
    button('Kiểm tra lại', 'wispbyte:check', ButtonStyle.Primary, false, '🔄'),
    button('Xem danh sách tài khoản', 'wispbyte:list', ButtonStyle.Secondary, false, '📋'),
    button('Tổng quan Admin', 'admin:status', ButtonStyle.Secondary, false, '🛡️')
  );

  return { embeds: [checkEmbed], components: [btnRow] };
}

// ----------------------------------------------------------------------------
// 6. ALL-IN-ONE SYSTEM STATUS MONITOR PANEL (/check & Auto-Monitor)
// ----------------------------------------------------------------------------
function renderProgressBar(current, total, length = 10) {
  if (total <= 0) return '`[⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜]` **0%**';
  const ratio = Math.max(0, Math.min(1, current / total));
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  const percent = Math.round(ratio * 100);
  return `\`[${'🟩'.repeat(filled)}${'⬜'.repeat(empty)}]\` **${percent}%**`;
}

function renderStatusMonitorPanel(data = {}) {
  const {
    managerOk = true,
    totalWorkers = 0,
    onlineWorkers = 0,
    offlineWorkers = 0,
    totalUsers = 0,
    activeUsers = 0,
    expiredUsers = 0,
    permanentUsers = 0,
    disabledUsers = 0,
    dbOk = true,
    dbLatencyMs = 0,
    discordReady = true,
    discordPing = 0,
    uptimeFormatted = '—',
    rssMb = 0,
    heapUsedMb = 0,
    platform = process.platform,
    nodeVersion = process.version,
    publicBaseUrl = '',
    checkedAtMs = Date.now(),
    checkedAtUnix = Math.floor(Date.now() / 1000),
    intervalMinutes = 15,
    nextCheckAtUnix = Math.floor(Date.now() / 1000) + (15 * 60)
  } = data;

  const coreHealthy = managerOk !== false && Boolean(dbOk) && Boolean(discordReady);
  const degradedServices = [];
  if (managerOk === false) degradedServices.push('Manager');
  if (!dbOk) degradedServices.push('Supabase');
  if (!discordReady) degradedServices.push('Discord');

  const overallStatusText = coreHealthy
    ? 'TỐT (MÁY CHỦ & DỊCH VỤ ỔN ĐỊNH)'
    : `SỰ CỐ (${degradedServices.join(', ').toUpperCase()})`;
  const overallStatusEmoji = coreHealthy ? '🟢' : '🔴';
  const embedColor = coreHealthy ? COLOR_ONLINE : COLOR_OFFLINE;

  const progressBar = renderProgressBar(onlineWorkers, totalWorkers);
  const managerStatus = managerOk !== false ? '🟢 Hoạt động tốt' : '🔴 Gián đoạn';
  const dbStatus = dbOk ? '🟢 Kết nối tốt' : '🔴 Mất kết nối';
  const dbLatencyText = dbLatencyMs >= 0 ? `${dbLatencyMs} ms` : 'N/A';
  const discordStatus = discordReady ? '🟢 Kết nối tốt' : '🔴 Mất kết nối';
  const discordPingText = discordPing >= 0 ? `${discordPing} ms` : 'N/A';

  const checkedTimeFormatted = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(checkedAtMs));

  const userSummaryExtra = [];
  if (permanentUsers > 0) userSummaryExtra.push(`Vĩnh viễn: **${permanentUsers}**`);
  if (disabledUsers > 0) userSummaryExtra.push(`Bị khóa: **${disabledUsers}**`);
  const extraUserLine = userSummaryExtra.length > 0 ? `\n• ${userSummaryExtra.join(' · ')}` : '';

  const desc =
    `${overallStatusEmoji} **Tình trạng hệ thống:** **${overallStatusText}**\n` +
    `🕒 **Kiểm tra lúc:** \`${checkedTimeFormatted}\` (<t:${checkedAtUnix}:R>)\n` +
    `⏱️ **Tự động cập nhật tiếp theo:** <t:${nextCheckAtUnix}:R> (mỗi **${intervalMinutes} phút**)`;

  const statusEmbed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('📊 BẢNG THEO DÕI TRẠNG THÁI HỆ THỐNG — KINGMC 24/7')
    .setDescription(desc)
    .addFields(
      {
        name: '🤖 Trạng thái Bot',
        value:
          `• Tổng số bot: **${totalWorkers}**\n` +
          `• Online: 🟢 **${onlineWorkers}**  ·  Offline: 🔴 **${offlineWorkers}**\n` +
          `• Tỉ lệ online: ${progressBar}`,
        inline: true
      },
      {
        name: '👥 Thống kê Người dùng',
        value:
          `• Tổng tài khoản: **${totalUsers}**\n` +
          `• Còn hạn: 🟢 **${activeUsers}**\n` +
          `• Hết hạn: 🔴 **${expiredUsers}**${extraUserLine}`,
        inline: true
      },
      {
        name: '🖥️ Máy chủ Manager & Kết nối',
        value:
          `• Manager: ${managerStatus} (Uptime \`${uptimeFormatted}\` · RSS \`${rssMb} MB\` / Heap \`${heapUsedMb} MB\` · \`${platform}\` \`${nodeVersion}\`)\n` +
          `• Cơ sở dữ liệu (Supabase): ${dbStatus} (\`${dbLatencyText}\`)\n` +
          `• Discord Gateway: ${discordStatus} (Ping: \`${discordPingText}\`)`,
        inline: false
      }
    )
    .setFooter({ text: `Tự động kiểm tra mỗi ${intervalMinutes} phút • KBOT Cloud 24/7` })
    .setTimestamp(new Date(checkedAtMs));

  const row = new ActionRowBuilder().addComponents(
    button('Làm mới (Admin)', 'status_monitor:refresh', ButtonStyle.Success, false, '🔄')
  );

  if (publicBaseUrl && typeof publicBaseUrl === 'string' && publicBaseUrl.startsWith('http')) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Web Dashboard')
        .setStyle(ButtonStyle.Link)
        .setURL(publicBaseUrl)
        .setEmoji('🌐')
    );
  }

  return {
    embeds: [statusEmbed],
    components: [row]
  };
}

module.exports = {
  renderBotsList,
  renderBotDetail,
  renderAdminStatus,
  renderAdminBots,
  renderBotLogs,
  renderWispbyteList,
  renderWispbyteCheckResult,
  renderStatusMonitorPanel,
  renderProgressBar,
  buildLoginModal,
  buildAdminPasswordModal,
  getWorkerState,
  uptimeText,
  padId,
  safe,
  plainCode,
  maskCookieDisplay,
  embed,
  button,
  botDashboard,
  overview: botDashboard,
  workersPage: botDashboard,
  workerDetail: renderBotDetail,
  handleStaleWorkerInteraction: async () => {}
};
