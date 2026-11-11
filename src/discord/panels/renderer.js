'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, TextInputStyle, ModalBuilder, TextInputBuilder
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
    .setCustomId(customId)
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

function sanitizeLogMessage(message) {
  if (!message || typeof message !== 'string') return '';
  return message
    .replace(/(password|secret|token|key|pwd)\s*[:=]\s*[^\s,]+/gi, '$1: ***')
    .replace(/socks5:\/\/[^@]+@/gi, 'socks5://***:***@')
    .replace(/https?:\/\/[^@]+@/gi, 'http://***:***@')
    .slice(0, 200);
}

function getWorkerState(worker) {
  const rawState = String(worker?.status?.state || (worker?.status?.online ? 'online' : 'offline')).toLowerCase();
  const isOnline = Boolean(worker?.status?.online || rawState === 'online');
  const isBusy = ['connecting', 'reconnecting', 'starting', 'stopping'].includes(rawState);

  let label = 'OFFLINE';
  let emoji = '🔴';
  let color = COLOR_OFFLINE;

  if (isOnline) {
    label = 'ONLINE';
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

  let desc = `Tài khoản: **${safe(user?.username || 'Khách')}**\nTổng số bot: **${totalBots}**`;
  if (notice) {
    desc += `\n\n${notice}`;
  }
  desc += '\n\n';

  if (totalBots === 0) {
    desc += '⚠️ *Bạn chưa sở hữu bot nào. Vui lòng liên hệ Admin hoặc truy cập Web Manager để đăng ký bot.*';
  } else {
    for (const worker of currentWorkers) {
      const state = getWorkerState(worker);
      const rawName = safe(worker.name || `BOT ${padId(worker.botNumber || 1)}`);
      const botLabel = rawName.toLowerCase().startsWith('bot #') ? rawName : `Bot #${padId(worker.botNumber || 1)} · ${rawName}`;
      const fullBotId = worker.workerId;
      const mcUser = safe(worker.status?.username || worker.settings?.account?.username || 'Chưa thiết lập');

      desc += `${state.emoji} **${botLabel}**\n` +
              `> **Bot ID:** \`${fullBotId}\`\n` +
              `> **Minecraft:** \`${mcUser}\`\n` +
              `> **Trạng thái:** \`${state.label}\`\n\n`;
    }
  }

  const hasOnline = workers.some((w) => w.status?.online);
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
function renderBotDetail({ user, worker, logs = [], notice = '', isExecuting = false }) {
  if (!worker) {
    return {
      embeds: [embed('❌ LỖI', 'Không tìm thấy thông tin bot này hoặc bot đã bị xóa.', COLOR_OFFLINE)],
      components: [new ActionRowBuilder().addComponents(button('Quay lại danh sách', 'bots:list', ButtonStyle.Secondary))]
    };
  }

  const state = getWorkerState(worker);
  const botName = safe(worker.name || `BOT ${padId(worker.botNumber || 1)}`);
  const fullBotId = worker.workerId;
  const mcUsername = safe(worker.status?.username || worker.settings?.account?.username || 'Chưa thiết lập');
  const ping = worker.status?.online && worker.status?.pingMs !== null ? `${worker.status.pingMs} ms` : '—';
  const uptime = worker.status?.online ? uptimeText(worker.status?.uptimeSeconds) : '—';
  const reconnects = worker.status?.reconnectCount ?? worker.status?.reconnectAttempts ?? 0;
  const provider = safe(worker.provider || 'wispbyte').toUpperCase();
  const lastActiveSec = worker.lastHeartbeat ? Math.floor(new Date(worker.lastHeartbeat).getTime() / 1000) : null;
  const lastActiveText = lastActiveSec ? `<t:${lastActiveSec}:R>` : '—';

  let desc = '';
  if (notice) {
    desc += `${notice}\n\n`;
  }

  desc += `### 📋 THÔNG TIN CƠ BẢN\n` +
          `• **Bot ID:** \`${fullBotId}\`\n` +
          `• **Tên Minecraft:** \`${mcUsername}\`\n` +
          `• **Trạng thái:** ${state.emoji} **${state.label}**\n` +
          `• **Máy chủ / Host:** \`${provider}\`\n` +
          `• **Hoạt động lần cuối:** ${lastActiveText}\n\n`;

  desc += `### ⚡ HIỆU NĂNG & KẾT NỐI\n` +
          `• **Độ trễ Ping:** \`${ping}\`\n` +
          `• **Thời gian chạy (Uptime):** \`${uptime}\`\n` +
          `• **Số lần kết nối lại:** \`${reconnects}\`\n` +
          `• **Trạng thái Engine:** \`${state.rawState}\`\n`;

  if (worker.status?.lastError) {
    desc += `• **Lỗi gần nhất:** \`${safe(worker.status.lastError, 120)}\`\n`;
  }

  desc += `\n### 📜 NHẬT KÝ GẦN NHẤT (10 sự kiện)\n`;
  const recentLogs = Array.isArray(logs) ? logs.slice(-10).reverse() : [];
  if (recentLogs.length === 0) {
    desc += `*Chưa có bản ghi hoạt động nào.*\n`;
  } else {
    for (const item of recentLogs) {
      const timeStr = item.time ? new Date(item.time).toLocaleTimeString('vi-VN', { hour12: false }) : '--:--:--';
      const type = (item.type || item.event || 'info').toUpperCase();
      const msg = sanitizeLogMessage(item.message || item.text || item.error || '');
      desc += `\`[${timeStr}]\` **[${type}]** ${safe(msg, 90)}\n`;
    }
  }

  const detailEmbed = embed(`${state.emoji} ${botName.toUpperCase()} — CHI TIẾT ĐIỀU KHIỂN`, desc, state.color);

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
    button('BẬT (START)', `bot:start:${fullBotId}`, ButtonStyle.Success, disableStart, '▶️'),
    button('TẮT (STOP)', `bot:stop:${fullBotId}`, ButtonStyle.Danger, disableStop, '⏹️'),
    button('KHỞI ĐỘNG LẠI', `bot:restart:${fullBotId}`, ButtonStyle.Primary, disableRestart, '🔄')
  );

  const navRow = new ActionRowBuilder().addComponents(
    button('Làm mới', `bot:refresh:${fullBotId}`, ButtonStyle.Secondary, isExecuting, '🔄'),
    button('Xem toàn bộ Log', `logs:open:${fullBotId}`, ButtonStyle.Secondary, false, '📜'),
    button('Quay lại danh sách', 'bots:list', ButtonStyle.Secondary, false, '◀')
  );

  return { embeds: [detailEmbed], components: [controlRow, navRow] };
}

// ----------------------------------------------------------------------------
// 3. LOGS PANEL (/logs)
// ----------------------------------------------------------------------------
function renderBotLogs({ user, worker, logs = [], userBots = [], notice = '' }) {
  if (!worker) {
    return {
      embeds: [embed('📜 NHẬT KÝ HOẠT ĐỘNG', 'Không tìm thấy bot được chỉ định.', COLOR_OFFLINE)],
      components: [new ActionRowBuilder().addComponents(button('Quay lại danh sách', 'bots:list', ButtonStyle.Secondary))]
    };
  }

  const state = getWorkerState(worker);
  const botName = safe(worker.name || `BOT ${padId(worker.botNumber || 1)}`);
  const fullBotId = worker.workerId;
  const mcUsername = safe(worker.status?.username || worker.settings?.account?.username || 'Chưa thiết lập');

  let desc = `### ${state.emoji} ${botName.toUpperCase()} (\`${fullBotId}\`)\n` +
             `Minecraft: \`${mcUsername}\` | Trạng thái: **${state.label}**\n\n`;

  if (notice) {
    desc += `${notice}\n\n`;
  }

  const recentLogs = Array.isArray(logs) ? logs.slice(-10).reverse() : [];
  if (recentLogs.length === 0) {
    desc += `*Chưa có nhật ký hoạt động nào được ghi nhận cho bot này.*\n`;
  } else {
    for (const item of recentLogs) {
      const timeStr = item.time ? new Date(item.time).toLocaleTimeString('vi-VN', { hour12: false }) : '--:--:--';
      const type = (item.type || item.event || 'info').toUpperCase();
      const msg = sanitizeLogMessage(item.message || item.text || item.error || '');
      desc += `\`[${timeStr}]\` **[${type}]** ${safe(msg, 110)}\n`;
    }
  }

  const logsEmbed = embed(`📜 NHẬT KÝ HOẠT ĐỘNG — ${botName.toUpperCase()}`, desc, COLOR_BRAND);

  const components = [];

  // If user has multiple bots, allow selecting bot via Select Menu
  if (userBots && userBots.length > 1) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('logs:select')
      .setPlaceholder('Chọn bot khác để xem nhật ký...');

    for (const b of userBots.slice(0, 25)) {
      const bState = getWorkerState(b);
      const bName = safe(b.name || `Bot ${padId(b.botNumber || 1)}`, 25);
      select.addOptions({
        label: `${bName} (${b.workerId})`,
        value: b.workerId,
        description: `Minecraft: ${b.status?.username || '—'} | ${bState.label}`,
        default: b.workerId === worker.workerId
      });
    }
    components.push(new ActionRowBuilder().addComponents(select));
  }

  const btnRow = new ActionRowBuilder().addComponents(
    button('Làm mới Log', `logs:refresh:${fullBotId}`, ButtonStyle.Success, false, '🔄'),
    button('Chi tiết & Điều khiển', `bot:view:${fullBotId}`, ButtonStyle.Primary, false, '🎮'),
    button('Quay lại danh sách', 'bots:list', ButtonStyle.Secondary, false, '◀')
  );
  components.push(btnRow);

  return { embeds: [logsEmbed], components };
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

module.exports = {
  renderBotsList,
  renderBotDetail,
  renderBotLogs,
  renderAdminStatus,
  renderAdminBots,
  buildLoginModal,
  getWorkerState,
  uptimeText,
  sanitizeLogMessage,
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
