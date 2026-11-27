'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  TextInputStyle,
  ModalBuilder,
  TextInputBuilder,
  StringSelectMenuBuilder
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

function formatBotLocationVi(worker, state = getWorkerState(worker)) {
  const locState = String(worker?.status?.locationState || worker?.status?.locationKind || '').trim().toLowerCase();
  if (locState === 'login') return 'Khu đăng nhập';
  if (locState === 'lobby') return 'Sảnh chờ';

  let rawDim = worker?.status?.dimension;
  if (typeof rawDim === 'object' && rawDim !== null) {
    rawDim = rawDim.name || rawDim.effects || rawDim.id || '';
  }
  const dim = String(rawDim || '').trim().replace(/^minecraft:/i, '').toLowerCase();
  const isInGame = Boolean(
    state?.isOnline ||
    locState === 'game' ||
    locState === 'afk' ||
    locState === 'afk_locked'
  );

  if ((dim === 'the_nether' || dim === 'nether') && (isInGame || !locState)) {
    return 'Khu AFK · Địa ngục';
  }
  if ((dim === 'the_end' || dim === 'end') && (isInGame || !locState)) {
    return 'Khu AFK · The End';
  }
  if (isInGame) {
    return 'Khu sinh tồn / AFK';
  }
  return '';
}

function formatNetworkHealthBadge(pingMs, tpsVal, isOnline) {
  if (!isOnline) return '';
  const hasPing = Number.isFinite(pingMs) && pingMs >= 0;
  const hasTps = Number.isFinite(tpsVal) && tpsVal > 0;
  if (!hasPing && !hasTps) return '';
  if ((hasPing && pingMs >= 300) || (hasTps && tpsVal < 14)) return '🔴 Lag cao';
  if ((hasPing && pingMs >= 150) || (hasTps && tpsVal < 18)) return '🟡 Trung bình';
  return '🟢 Ổn định';
}

function resolveFrozenExpiryState(rawExp, maintenance = null, nowMs = Date.now()) {
  if (!rawExp) {
    return { expMs: NaN, effectiveExpMs: NaN, effectiveIso: rawExp, frozen: false };
  }
  const expMs = Date.parse(rawExp);
  if (!Number.isFinite(expMs)) {
    return { expMs: NaN, effectiveExpMs: NaN, effectiveIso: rawExp, frozen: false };
  }
  if (!maintenance?.enabled) {
    return { expMs, effectiveExpMs: expMs, effectiveIso: rawExp, frozen: false };
  }
  const rawAnchor = maintenance.lastCompensatedAt || maintenance.startedAt || maintenance.updatedAt || '';
  const anchorMs = rawAnchor ? Date.parse(rawAnchor) : NaN;
  if (Number.isFinite(anchorMs)) {
    if (expMs > anchorMs) {
      const effectiveExpMs = nowMs > anchorMs ? expMs + (nowMs - anchorMs) : expMs;
      return {
        expMs,
        effectiveExpMs,
        effectiveIso: new Date(effectiveExpMs).toISOString(),
        frozen: true
      };
    }
    return { expMs, effectiveExpMs: expMs, effectiveIso: rawExp, frozen: false };
  }
  if (expMs > nowMs) {
    return { expMs, effectiveExpMs: expMs, effectiveIso: rawExp, frozen: true };
  }
  return { expMs, effectiveExpMs: expMs, effectiveIso: rawExp, frozen: false };
}

function resolveEffectiveExpiresAt(rawExp, maintenance = null, nowMs = Date.now()) {
  return resolveFrozenExpiryState(rawExp, maintenance, nowMs).effectiveIso;
}

const GRACE_PERIOD_MS = 6 * 3600 * 1000;

function formatAccountPlanBadge(user, maintenance = null) {
  if (!user) return '';
  if (String(user.role || '').toLowerCase() === 'admin') {
    return '🛡️ `Admin`';
  }
  const status = String(user.status || 'active').toLowerCase();
  if (status === 'disabled') return '⛔ `Đã khóa`';
  if (user.isPermanent) return '♾️ `Vĩnh viễn`';
  if (user.inGracePeriod === true) {
    return '⏳ `Ân hạn · Gia hạn ngay`';
  }
  const rawExp = user.expiresAt || user.expiresAtRental;
  if (!rawExp) return '';
  const nowMs = Date.now();
  const { expMs, effectiveExpMs, frozen } = resolveFrozenExpiryState(rawExp, maintenance, nowMs);
  if (!Number.isFinite(expMs)) return '';
  const diffMs = effectiveExpMs - nowMs;
  if (diffMs <= 0) {
    if (status === 'grace_period') {
      const rawAnchor = maintenance?.enabled
        ? (maintenance.lastCompensatedAt || maintenance.startedAt || maintenance.updatedAt || '')
        : '';
      const anchorMs = rawAnchor ? Date.parse(rawAnchor) : NaN;
      const baseGraceEndMs = expMs + GRACE_PERIOD_MS;
      const effectiveGraceEndMs = (maintenance?.enabled && Number.isFinite(anchorMs) && nowMs > anchorMs && baseGraceEndMs > anchorMs)
        ? baseGraceEndMs + (nowMs - anchorMs)
        : baseGraceEndMs;
      if (effectiveGraceEndMs > nowMs) {
        return '⏳ `Ân hạn · Gia hạn ngay`';
      }
    }
    return '⚠️ `Hết hạn`';
  }
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.max(1, Math.floor((diffMs % 86400000) / 3600000));
  if (frozen) {
    return days > 0
      ? `⏸️ \`Bảo trì · Giữ nguyên ${days}d ${hours}h\``
      : `⏸️ \`Bảo trì · Giữ nguyên ${hours}h\``;
  }
  return days > 0 ? `⏳ \`Còn ${days}d ${hours}h\`` : `⏳ \`Còn ${hours}h\``;
}

// ----------------------------------------------------------------------------
// 1. MAIN BOTS LIST PANEL (/bots)
// ----------------------------------------------------------------------------
function renderBotsList({ user, workers = [], page = 0, pageSize = 5, notice = '', maintenance = null }) {
  const totalBots = workers.length;
  const onlineCount = workers.filter((w) => getWorkerState(w).isOnline).length;
  const offlineCount = Math.max(0, totalBots - onlineCount);
  const totalPages = Math.max(1, Math.ceil(totalBots / pageSize));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const startIndex = currentPage * pageSize;
  const currentWorkers = workers.slice(startIndex, startIndex + pageSize);

  const planBadge = formatAccountPlanBadge(user, maintenance);
  const badgeSegment = planBadge ? `  ·  ${planBadge}` : '';
  let desc = `👤 **Tài khoản:** \`${plainCode(user?.username || 'Khách')}\`${badgeSegment}  ·  🤖 **Bot:** **${totalBots}** (🟢 **${onlineCount}** / 🔴 **${offlineCount}**)`;
  if (maintenance?.enabled) {
    const maintMsg = safe(maintenance.message || 'Hệ thống đang bảo trì nâng cấp máy chủ.', 220);
    desc += `\n\n🛠️ **Đang bảo trì:** *${maintMsg}*\n> ⏸️ *Thời gian sử dụng bot được giữ nguyên, không bị trừ trong lúc bảo trì.*`;
  }
  if (notice) {
    desc += `\n\n${notice}`;
  }
  desc += '\n\n';

  if (totalBots === 0) {
    desc += 'ℹ️ *Tài khoản của bạn hiện chưa được cấp bot nào. Hãy nạp mã kích hoạt trên Web Manager hoặc liên hệ Admin để nhận bot.*';
  } else {
    for (const worker of currentWorkers) {
      const state = getWorkerState(worker);
      const rawName = safe(worker.name || `BOT ${padId(worker.botNumber || 1)}`);
      const botLabel = rawName.toLowerCase().startsWith('bot #') ? rawName : `Bot #${padId(worker.botNumber || 1)} · ${rawName}`;
      const fullBotId = plainCode(worker.workerId);
      const rawMcUsername = String(worker.status?.username || worker.settings?.account?.username || '').trim();
      const mcUsername = rawMcUsername ? plainCode(rawMcUsername) : 'Chưa đặt';
      const pingVal = Number(worker.status?.pingMs);
      const rawTps = worker.status?.tps;
      const tpsVal = rawTps !== null && rawTps !== undefined ? Number(rawTps) : NaN;
      const rawTotem = worker.status?.totemCount ?? worker.status?.inventory?.totemCount;
      const hasExplicitTotem = rawTotem !== null && rawTotem !== undefined && rawTotem !== '';
      const liveExtras = [];
      if (state.isOnline && Number.isFinite(pingVal) && pingVal >= 0) {
        liveExtras.push(`⚡ \`${Math.round(pingVal)}ms\``);
      }
      if (state.isOnline && Number.isFinite(tpsVal) && tpsVal > 0) {
        liveExtras.push(`⏱️ \`${tpsVal.toFixed(1)} TPS\``);
      }
      if (state.isOnline && Number.isFinite(Number(worker.status?.health))) {
        liveExtras.push(`❤️ \`${Math.round(Number(worker.status.health))}/20\``);
      }
      if (state.isOnline && hasExplicitTotem && Number(rawTotem) === 0) {
        liveExtras.push('🛡️ `0 Totem`');
      }
      const extraSuffix = liveExtras.length > 0 ? ` · ${liveExtras.join(' · ')}` : '';
      const locLabel = formatBotLocationVi(worker, state);
      const locSuffix = locLabel ? ` · 📍 ${safe(locLabel, 48)}` : '';
      const mcHintLine = !rawMcUsername
        ? `> 💡 *Chưa đặt tài khoản MC — hãy vào Web Dashboard cài tài khoản MC để bot khởi chạy.*\n`
        : '';
      desc += `${state.emoji} **${botLabel}** — \`${state.label}\`${extraSuffix}\n` +
              `> • Bot ID: \`${fullBotId}\` · Nhân vật: \`${mcUsername}\`${locSuffix}\n` +
              `${mcHintLine}\n`;
    }
  }

  const hasOnline = onlineCount > 0;
  const mainEmbed = embed('🎮 KINGMC CLOUD 24/7 — DANH SÁCH BOT', desc.trimEnd(), hasOnline ? COLOR_ONLINE : COLOR_BRAND)
    .setFooter({ text: `Trang ${currentPage + 1}/${totalPages} • Bấm vào tên bot bên dưới để Bật / Tắt / Xem chi tiết` });

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

  // Row 2 (+ Row 3 when paginated): Navigation & Refresh
  const navRow = new ActionRowBuilder();
  if (totalPages > 1) {
    navRow.addComponents(
      button('⏮ Trang đầu', 'bots:first', ButtonStyle.Secondary, currentPage <= 0),
      button('◀ Trang trước', `bots:page:${currentPage - 1}`, ButtonStyle.Secondary, currentPage <= 0),
      button(`${currentPage + 1}/${totalPages}`, 'bots:noop', ButtonStyle.Secondary, true),
      button('Trang sau ▶', `bots:page:${currentPage + 1}`, ButtonStyle.Secondary, currentPage >= totalPages - 1),
      button('Trang cuối ⏭', 'bots:last', ButtonStyle.Secondary, currentPage >= totalPages - 1)
    );
    components.push(navRow);

    const refreshRow = new ActionRowBuilder().addComponents(
      button('Làm mới', 'bots:refresh', ButtonStyle.Success, false, '🔄')
    );
    components.push(refreshRow);
  } else {
    navRow.addComponents(
      button('Làm mới', 'bots:refresh', ButtonStyle.Success, false, '🔄')
    );
    components.push(navRow);
  }

  return { embeds: [mainEmbed], components };
}

// ----------------------------------------------------------------------------
// 2. PER-BOT DETAIL PANEL (bot:view:{workerId})
// ----------------------------------------------------------------------------
function renderBotDetail({ user, worker, notice = '', isExecuting = false, maintenance = null }) {
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
  const rawMcUsername = String(worker.status?.username || worker.settings?.account?.username || '').trim();
  const mcUsername = rawMcUsername ? plainCode(rawMcUsername) : 'Chưa đặt';
  const mcSetupHintLine = !rawMcUsername
    ? `\n• 💡 *Chưa đặt tài khoản MC — hãy vào **Web Dashboard** cài tài khoản MC để bot khởi chạy.*`
    : '';
  const pingMs = Number(worker.status?.pingMs);
  const ping = state.isOnline && Number.isFinite(pingMs) && pingMs >= 0 ? `${Math.round(pingMs)} ms` : '—';
  const tpsValue = worker.status?.tps;
  const tpsNum = tpsValue !== null && tpsValue !== undefined ? Number(tpsValue) : NaN;
  const tps = state.isOnline && Number.isFinite(tpsNum) && tpsNum > 0
    ? `${tpsNum.toFixed(1)}`
    : '—';
  const netHealth = formatNetworkHealthBadge(pingMs, tpsNum, state.isOnline);
  const netHealthSuffix = netHealth ? `  ·  ${netHealth}` : '';
  const rawUptimeSec = Number(worker.status?.uptimeSeconds);
  const uptime = state.isOnline
    ? ((!Number.isFinite(rawUptimeSec) || rawUptimeSec < 1) ? '< 1m' : uptimeText(Math.floor(rawUptimeSec)))
    : '—';
  const reconnects = worker.status?.reconnectCount || worker.status?.reconnectAttempts || 0;
  const isAdminViewer = String(user?.role || '').toLowerCase() === 'admin';
  const server = isAdminViewer
    ? plainCode(
        worker.status?.server ||
        worker.status?.serverHost ||
        worker.settings?.serverHost ||
        worker.serverHost ||
        worker.server ||
        'kingmc.vn'
      )
    : 'kingmc.vn';
  const provider = plainCode(worker.provider || 'wispbyte', 40).toUpperCase();
  const position = worker.status?.position;
  const hasPosition = position &&
    [position.x, position.y, position.z].every((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const coordinates = hasPosition
    ? `X: ${Math.round(Number(position.x))}, Y: ${Math.round(Number(position.y))}, Z: ${Math.round(Number(position.z))}`
    : '';

  const placeName = formatBotLocationVi(worker, state);
  const locationLabel = placeName ? safe(placeName, 80) : 'Chưa có dữ liệu vị trí';
  const locationLine = placeName
    ? `📍 **${locationLabel}**${coordinates ? ` · \`${plainCode(coordinates, 80)}\`` : ''}`
    : (coordinates ? `\`${plainCode(coordinates, 80)}\`` : '`Chưa có dữ liệu vị trí`');

  const healthVal = Number(worker.status?.health);
  const foodVal = Number(worker.status?.food);
  const rawTotem = worker.status?.totemCount ?? worker.status?.inventory?.totemCount;
  const hasExplicitTotem = rawTotem !== null && rawTotem !== undefined && rawTotem !== '';
  const totemVal = hasExplicitTotem ? Number(rawTotem) : NaN;
  const liveExtras = [];
  if (state.isOnline && Number.isFinite(healthVal)) liveExtras.push(`❤️ \`${Math.round(healthVal)}/20\``);
  if (state.isOnline && Number.isFinite(foodVal)) liveExtras.push(`🍖 \`${Math.round(foodVal)}/20\``);
  if (state.isOnline && Number.isFinite(totemVal)) {
    if (totemVal === 0) {
      liveExtras.push('🛡️ `0 Totem`');
    } else {
      liveExtras.push(`🛡️ Totem: \`${Math.max(0, Math.floor(totemVal))}\``);
    }
  }
  const vitalsLine = liveExtras.length > 0 ? `\n• **Sinh tồn:** ${liveExtras.join(' · ')}` : '';

  const rawReason = String(worker.status?.lastKickReason || worker.status?.lastError || '').trim();
  const reasonLine = (!state.isOnline && rawReason)
    ? `\n• **Ghi chú dừng:** *${safe(redactStringSecrets(rawReason), 140)}*`
    : '';

  const planBadge = maintenance?.enabled ? formatAccountPlanBadge(user, maintenance) : '';
  const maintBanner = maintenance?.enabled
    ? `🛠️ **Hệ thống đang bảo trì**${planBadge ? `  ·  ${planBadge}` : ''}\n> ⏸️ *Thời gian sử dụng bot được giữ nguyên, không bị trừ trong lúc bảo trì.*\n\n`
    : '';
  let descText = `${maintBanner}${notice ? `${notice}\n\n` : ''}`;
  descText +=
    `━━ **THÔNG TIN BOT** ━━\n` +
    `• **Bot ID:** \`${fullBotId}\`\n` +
    `• **Nhân vật:** \`${mcUsername}\` · **Server:** \`${server}\`${mcSetupHintLine}\n` +
    `• **Trạng thái:** ${state.emoji} **${state.label}**${vitalsLine}${reasonLine}\n\n` +
    `━━ **HIỆU NĂNG & VỊ TRÍ** ━━\n` +
    `• **Ping:** \`${ping}\` · **TPS:** \`${tps}\`${netHealthSuffix}\n` +
    `• **Uptime:** \`${uptime}\` · **Reconnects:** \`${reconnects}\`\n` +
    `• **Vị trí:** ${locationLine}`;

  const detailEmbed = embed(
    `${state.emoji} ${botName.toUpperCase()} — CHI TIẾT BOT`,
    descText,
    state.color
  ).setFooter({ text: 'KBOT Cloud 24/7 • Đổi nick Minecraft / Proxy / Lịch treo trên Web Manager' });

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
    button('Nhật ký', `logs:view:${rawWorkerId}`, ButtonStyle.Secondary, isExecuting, '📜'),
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
  if (totalPages > 2) {
    navRow.addComponents(
      button('⏮ Đầu', 'admin:bots:0', ButtonStyle.Secondary, currentPage <= 0),
      button('◀ Trước', `admin:bots:${currentPage - 1}`, ButtonStyle.Secondary, currentPage <= 0),
      button('Sau ▶', `admin:bots:${currentPage + 1}`, ButtonStyle.Secondary, currentPage >= totalPages - 1),
      button('Cuối ⏭', `admin:bots:${totalPages - 1}`, ButtonStyle.Secondary, currentPage >= totalPages - 1)
    );
    components.push(navRow);
    const ctrlRow = new ActionRowBuilder().addComponents(
      button('Tổng quan Admin', 'admin:status', ButtonStyle.Primary, false, '🛡️'),
      button('Làm mới', `admin:bots:${currentPage}`, ButtonStyle.Success, false, '🔄')
    );
    components.push(ctrlRow);
  } else {
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
  }

  return { embeds: [adminEmbed], components };
}

// Modal helper for /login
function buildLoginModal() {
  const modal = new ModalBuilder()
    .setCustomId('login_modal')
    .setTitle('Đăng nhập KBot Web Manager');

  const usernameInput = new TextInputBuilder()
    .setCustomId('login_username')
    .setLabel('Tên đăng nhập (Username trên Web)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Ví dụ: kietmc123')
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(32);

  const passwordInput = new TextInputBuilder()
    .setCustomId('login_password')
    .setLabel('Mật khẩu (Password trên Web)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Nhập mật khẩu tài khoản Web của bạn')
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(256);

  modal.addComponents(
    new ActionRowBuilder().addComponents(usernameInput),
    new ActionRowBuilder().addComponents(passwordInput)
  );

  return modal;
}

function renderUnauthenticatedPanel({ discordUserId = '', title = '⚠️ BẠN CHƯA ĐĂNG NHẬP', reason = '', publicBaseUrl = '' } = {}) {
  const uid = String(discordUserId || '').trim();
  const body = reason || (
    'Tài khoản Discord của bạn hiện **chưa liên kết** với tài khoản Web Manager.\n\n' +
    '👉 Bấm nút **Đăng nhập ngay** bên dưới (hoặc gõ `/login`) để nhập Username & Mật khẩu tài khoản Web và nhận Role tự động.'
  );
  const warnEmbed = embed(title, body, COLOR_WARN);
  const components = [];
  if (uid) {
    const row = new ActionRowBuilder().addComponents(
      button('Đăng nhập ngay', `login:prompt:${uid}`, ButtonStyle.Primary, false, '🔐')
    );
    if (publicBaseUrl && typeof publicBaseUrl === 'string' && publicBaseUrl.startsWith('http')) {
      row.addComponents(
        new ButtonBuilder()
          .setLabel('Mở trang Web')
          .setStyle(ButtonStyle.Link)
          .setURL(publicBaseUrl)
          .setEmoji('🌐')
      );
    }
    components.push(row);
  }
  return { embeds: [warnEmbed], components };
}

function renderEntitlementBlockedPanel({ user, discordUserId = '', publicBaseUrl = '' } = {}) {
  const uid = String(discordUserId || '').trim();
  const uname = plainCode(user?.username || 'unknown', 64);
  const isLocked = String(user?.status || 'active').toLowerCase() === 'disabled';
  const title = isLocked ? '⛔ TÀI KHOẢN BỊ KHÓA' : '⛔ TÀI KHOẢN HẾT HẠN HOẶC BỊ KHÓA';
  const rawExp = user?.expiresAt || user?.expiresAtRental;
  const expText = rawExp && Number.isFinite(Date.parse(rawExp))
    ? ` (hết hạn ngày **${new Date(rawExp).toLocaleDateString('vi-VN')}**)`
    : '';
  const desc = isLocked
    ? `Tài khoản Web **\`${uname}\`** của bạn đã bị vô hiệu hóa bởi Quản trị viên.${user?.lockReason ? `\n• **Lý do:** *${safe(user.lockReason, 160)}*` : ''}\n\nNếu muốn chuyển sang tài khoản Web khác, bấm nút **Đăng xuất** bên dưới.`
    : `Tài khoản Web **\`${uname}\`** của bạn hiện đã hết hạn thuê bot${expText}.\n\n👉 Vui lòng gia hạn trên **Web Manager** để tiếp tục điều khiển bot, hoặc bấm **Đăng xuất** nếu bạn muốn đổi sang tài khoản khác.`;

  const row = new ActionRowBuilder();
  if (publicBaseUrl && typeof publicBaseUrl === 'string' && publicBaseUrl.startsWith('http')) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Gia hạn trên Web')
        .setStyle(ButtonStyle.Link)
        .setURL(publicBaseUrl)
        .setEmoji('🌐')
    );
  }
  if (uid) {
    row.addComponents(
      button('Đổi tài khoản (Đăng xuất)', `login:logout:${uid}`, ButtonStyle.Danger, false, '🚪')
    );
  }

  return {
    embeds: [embed(title, desc, COLOR_OFFLINE)],
    components: row.components.length > 0 ? [row] : []
  };
}

function renderAlreadyLoggedInPanel({ user, discordUserId, roleSyncNote = '', publicBaseUrl = '', maintenance = null }) {
  const uid = String(discordUserId || '').trim();
  const uname = plainCode(user?.username || 'unknown', 64);
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const rawStatus = String(user?.status || 'active').toLowerCase();
  const rawExp = user?.expiresAt || user?.expiresAtRental;
  const nowMs = Date.now();
  const { effectiveExpMs: expiryMs, frozen: isFrozen } = resolveFrozenExpiryState(rawExp, maintenance, nowMs);
  const isExpired = !isAdmin && !user?.isPermanent && (rawStatus === 'expired' || (Number.isFinite(expiryMs) && expiryMs <= nowMs) || (!rawExp && rawStatus !== 'active'));
  const isDisabled = rawStatus === 'disabled';
  const canOpenBots = isAdmin || (!isDisabled && (user?.isPermanent === true || (Number.isFinite(expiryMs) && expiryMs > nowMs)));

  let statusLine = '';
  if (isAdmin) {
    statusLine = `• **Phân quyền:** \`Enterprise Administrator\``;
  } else {
    const planText = safe(user?.planName || 'Gói tiêu chuẩn', 64);
    let expiryText = '—';
    if (isDisabled) {
      expiryText = '⛔ Đã bị khóa';
    } else if (user?.isPermanent) {
      expiryText = '♾️ Vĩnh viễn';
    } else if (Number.isFinite(expiryMs)) {
      const dateStr = new Date(expiryMs).toLocaleDateString('vi-VN');
      const remDays = Math.floor((expiryMs - nowMs) / 86400000);
      if (isFrozen && expiryMs > nowMs) {
        const frozenBadge = formatAccountPlanBadge(user, maintenance);
        expiryText = `${frozenBadge} *(tạm đóng băng khi bảo trì)*`;
      } else {
        expiryText = expiryMs <= nowMs
          ? `${dateStr} *(Đã hết hạn)*`
          : (remDays > 0 ? `Còn **${remDays} ngày** *(đến ${dateStr})*` : `Đến **${dateStr}** *(dưới 24h)*`);
      }
    }
    statusLine = `• **Gói dịch vụ:** ${planText}\n• **Hạn sử dụng:** ${expiryText}`;
  }

  const syncLine = roleSyncNote ? `\n${roleSyncNote}` : '';
  const color = isDisabled ? COLOR_OFFLINE : (isExpired ? COLOR_WARN : COLOR_BRAND);
  const infoEmbed = embed(
    'ℹ️ BẠN ĐÃ ĐĂNG NHẬP',
    `Tài khoản Discord <@${uid}> hiện **đã được đăng nhập** với hệ thống Web Manager.\n\n` +
    `• **Tài khoản Web:** \`${uname}\`\n` +
    `${statusLine}${syncLine}\n\n` +
    `👉 Bấm **Mở danh sách Bot** để điều khiển nhanh, hoặc bấm nút **Đăng xuất** nếu bạn muốn hủy liên kết / đổi sang tài khoản khác.`,
    color
  );

  const row = new ActionRowBuilder();
  if (canOpenBots) {
    row.addComponents(
      button('Mở danh sách Bot', 'bots:list', ButtonStyle.Primary, false, '🤖')
    );
  }
  if (publicBaseUrl && typeof publicBaseUrl === 'string' && publicBaseUrl.startsWith('http')) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Web Dashboard')
        .setStyle(ButtonStyle.Link)
        .setURL(publicBaseUrl)
        .setEmoji('🌐')
    );
  }
  row.addComponents(
    button('Đăng xuất', `login:logout:${uid}`, ButtonStyle.Danger, false, '🚪')
  );

  return { embeds: [infoEmbed], components: [row] };
}

function renderLoggedOutPanel({ discordUserId, unlinkedUsername = '', removedRoles = [], includeReloginButton = false }) {
  const uid = String(discordUserId || '').trim();
  const accountText = unlinkedUsername
    ? ` khỏi tài khoản Web **\`${plainCode(unlinkedUsername, 64)}\`**`
    : ' khỏi Web Manager';
  const roleNote = Array.isArray(removedRoles) && removedRoles.length > 0
    ? `\n\n🛡️ Đã thu hồi Role: ${removedRoles.join(', ')}`
    : '';
  const nextHint = includeReloginButton
    ? 'Bạn có thể bấm nút **Đăng nhập lại** bên dưới để kết nối tài khoản khác, hoặc dùng `/login` bất kỳ lúc nào.'
    : 'Bạn có thể sử dụng lại lệnh `/login` bất kỳ lúc nào để đăng nhập lại và nhận lại Role.';

  const outEmbed = embed(
    '🚪 ĐÃ ĐĂNG XUẤT',
    `Tài khoản Discord của bạn đã được hủy liên kết${accountText} thành công.${roleNote}\n\n${nextHint}`,
    COLOR_BRAND
  );

  const components = [];
  if (includeReloginButton && uid) {
    components.push(
      new ActionRowBuilder().addComponents(
        button('Đăng nhập lại', `login:prompt:${uid}`, ButtonStyle.Primary, false, '🔐')
      )
    );
  }

  return { embeds: [outEmbed], components };
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
  let maintenance = null;
  try {
    const { getMaintenanceState } = require('../../utils/maintenance');
    maintenance = await getMaintenanceState(services?.accessStore || services?.store);
  } catch (_) {}
  return renderBotsList({ user, workers, notice, maintenance });
}

function renderBotLogs({ user, worker, logs = [], workers = [] }) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const rawWorkerId = String(worker?.workerId || worker?.id || '');
  const fullBotId = plainCode(rawWorkerId || 'Toàn hệ thống');
  const botName = safe(worker?.name || (worker?.botNumber ? `BOT ${padId(worker.botNumber)}` : fullBotId));
  const state = worker ? getWorkerState(worker) : null;

  const sanitize = (text) => {
    if (!text || typeof text !== 'string') return '';
    return redactStringSecrets(text)
      .replace(/```/g, '`\u200b`\u200b`');
  };

  const LOG_TYPE_LABEL_MAP = {
    connecting: 'KẾT NỐI',
    spawn: 'VÀO SẢNH',
    online: 'VÀO GAME',
    connection_error: 'MẤT KẾT NỐI',
    kicked: 'NGẮT KẾT NỐI',
    afk_kicked: 'VĂNG AFK',
    afk_recovered: 'VÀO LẠI AFK',
    stopped: 'ĐÃ DỪNG',
    totem_popped: 'DÙNG TOTEM',
    bot_death: 'HẠ GỤC',
    respawn: 'HỒI SINH',
    window_open: 'MỞ MENU',
    window_close: 'ĐÓNG MENU',
    window_click: 'CHỌN MENU',
    maintenance: 'BẢO TRÌ',
    maintenance_window: 'BẢO TRÌ',
    credentials_missing: 'THIẾU TK',
    reconnect_exhausted: 'DỪNG THỬ LẠI',
    host_switch: 'ĐỔI MÁY CHỦ',
    auth_failed: 'ĐĂNG NHẬP',
    invalid_proxy: 'LỖI PROXY',
    ip_limited: 'GIỚI HẠN IP',
    banned: 'BỊ KHÓA',
    info: 'THÔNG TIN',
    warn: 'CẢNH BÁO',
    warning: 'CẢNH BÁO',
    error: 'LỖI'
  };
  const EMPTY_LOG_FALLBACK_MAP = {
    window_open: 'Mở cửa sổ menu trong game.',
    window_close: 'Đã đóng cửa sổ menu trong game.',
    window_click: 'Đã thao tác chọn ô trên menu GUI.',
    stopped: 'Bot đã dừng hoạt động.',
    connecting: 'Đang kết nối tới máy chủ Minecraft...',
    spawn: 'Bot đã xuất hiện trong máy chủ.',
    online: 'Đã vào khu vực chơi / AFK.',
    connection_error: 'Tạm mất kết nối tới máy chủ Minecraft.',
    kicked: 'Bot bị ngắt kết nối khỏi máy chủ.',
    maintenance: 'Máy chủ đang bảo trì.',
    maintenance_window: 'Tạm nghỉ khung giờ bảo trì định kỳ.'
  };

  const formattedLogs = safeLogs.map((l) => {
    if (!l) return '';
    if (typeof l === 'string') return sanitize(l);
    const rawTime = l.time || l.occurredAt || l.timestamp || '';
    let timeStr = '';
    if (rawTime) {
      const parsedMs = Date.parse(rawTime);
      if (Number.isFinite(parsedMs)) {
        const vn = new Date(parsedMs + 7 * 3600 * 1000);
        const hh = padId(vn.getUTCHours());
        const mm = padId(vn.getUTCMinutes());
        const ss = padId(vn.getUTCSeconds());
        timeStr = `[${hh}:${mm}:${ss}] `;
      } else {
        timeStr = `[${String(rawTime).slice(11, 19)}] `;
      }
    }
    const rawType = String(l.type || l.level || '').trim();
    const mappedLabel = LOG_TYPE_LABEL_MAP[rawType.toLowerCase()] || rawType.toUpperCase();
    const levelStr = mappedLabel ? `[${mappedLabel}] ` : '';
    const baseMsg = String(l.message || l.text || '').trim()
      || EMPTY_LOG_FALLBACK_MAP[rawType.toLowerCase()]
      || (l.reason ? String(l.reason).trim() : '')
      || (mappedLabel ? `Sự kiện ${mappedLabel.toLowerCase()}` : 'Sự kiện hệ thống');
    const repeatSuffix = Number(l.repeatCount) > 1 ? ` (×${Number(l.repeatCount)})` : '';
    return sanitize(`${timeStr}${levelStr}${baseMsg}${repeatSuffix}`);
  }).filter(Boolean);

  const logContent = formattedLogs.length > 0
    ? formattedLogs.join('\n')
    : 'Chưa có nhật ký hoạt động nào gần đây.';

  const stateHint = state ? `  ·  Trạng thái: ${state.emoji} \`${state.label}\`` : '';
  const logEmbed = embed(
    `📜 NHẬT KÝ HOẠT ĐỘNG: ${String(botName).toUpperCase()}`,
    `• **Bot ID:** \`${fullBotId}\`${stateHint}\n\`\`\`text\n${logContent.slice(-3500)}\n\`\`\``,
    state ? state.color : COLOR_BRAND
  ).setFooter({ text: `Hiển thị ${formattedLogs.length} dòng gần nhất (giờ VN)` });

  const components = [];
  if (Array.isArray(workers) && workers.length > 1) {
    const options = workers.slice(0, 25).map((w) => {
      const wid = String(w.workerId || w.id || '');
      const st = getWorkerState(w);
      const label = (w.name || `BOT ${padId(w.botNumber || 1)}`).slice(0, 80);
      const mcName = w.status?.username || w.settings?.account?.username || 'Chưa đặt';
      return {
        label: `${label} (${wid})`.slice(0, 100),
        value: wid.slice(0, 100),
        description: `${st.label} • Nhân vật: ${String(mcName).slice(0, 50)}`.slice(0, 100),
        emoji: st.emoji,
        default: wid === rawWorkerId
      };
    });
    if (options.length > 1) {
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('logs:select')
            .setPlaceholder('📋 Chuyển nhanh sang xem nhật ký bot khác...')
            .addOptions(options)
        )
      );
    }
  }

  if (rawWorkerId) {
    components.push(
      new ActionRowBuilder().addComponents(
        button('Làm mới', `logs:refresh:${rawWorkerId}`, ButtonStyle.Secondary, false, '🔄'),
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
    activeWebNodes = null,
    activeManagerUrls = null,
    maintenance = null,
    maintenanceStartedAt = null,
    maintenancePausedMinutes = null,
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

  const resolvedNodeCount = Number.isFinite(Number(activeWebNodes)) && Number(activeWebNodes) > 0
    ? Math.floor(Number(activeWebNodes))
    : (Array.isArray(activeManagerUrls) && activeManagerUrls.length > 0 ? activeManagerUrls.length : 1);

  let pausedMinutes = 0;
  if (maintenance?.enabled) {
    if (maintenancePausedMinutes !== null && maintenancePausedMinutes !== undefined && Number.isFinite(Number(maintenancePausedMinutes))) {
      pausedMinutes = Math.max(0, Math.floor(Number(maintenancePausedMinutes)));
    } else {
      const rawMaintStart = maintenanceStartedAt || maintenance?.startedAt || maintenance?.lastCompensatedAt || maintenance?.updatedAt || '';
      const maintStartMs = rawMaintStart ? Date.parse(rawMaintStart) : NaN;
      if (Number.isFinite(maintStartMs) && checkedAtMs > maintStartMs) {
        pausedMinutes = Math.max(0, Math.floor((checkedAtMs - maintStartMs) / 60000));
      }
    }
  }
  const maintenanceDetailText = maintenance?.enabled
    ? `Đang bật (tạm dừng trừ giờ ${pausedMinutes}m)`
    : 'Bình thường';

  const maintenanceLine = maintenance?.enabled
    ? `\n🛠️ **Chế độ bảo trì:** \`ĐANG BẬT\` · ⏸️ *Giữ nguyên thời gian sử dụng bot (không trừ giờ)*`
    : '';
  const desc =
    `${overallStatusEmoji} **Tình trạng hệ thống:** **${overallStatusText}**${maintenanceLine}\n` +
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
        value: (
          `• Manager: ${managerStatus} (Uptime \`${uptimeFormatted}\` · RSS \`${rssMb} MB\` / Heap \`${heapUsedMb} MB\` · \`${platform}\` \`${nodeVersion}\`)\n` +
          `• Dual-Web Sync: ${resolvedNodeCount} node  ·  Bảo trì: ${maintenanceDetailText}\n` +
          `• Cơ sở dữ liệu (Supabase): ${dbStatus} (\`${dbLatencyText}\`)\n` +
          `• Discord Gateway: ${discordStatus} (Ping: \`${discordPingText}\`)`
        ).slice(0, 1024),
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
  renderUnauthenticatedPanel,
  renderEntitlementBlockedPanel,
  renderAlreadyLoggedInPanel,
  renderLoggedOutPanel,
  buildAdminPasswordModal,
  formatAccountPlanBadge,
  resolveEffectiveExpiresAt,
  formatBotLocationVi,
  formatNetworkHealthBadge,
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
