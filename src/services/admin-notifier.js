'use strict';

const { EmbedBuilder } = require('discord.js');

function escapeTelegramHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

class AdminNotifier {
  constructor({ client, adminUserId = '', telegramBotToken = '', telegramChatId = '', logger } = {}) {
    this.client = client;
    this.adminUserId = String(adminUserId || '').trim();
    this.telegramBotToken = String(telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    this.telegramChatId = String(telegramChatId || process.env.TELEGRAM_CHAT_ID || '').trim();
    this.logger = logger;
    this.alertCache = new Map();
    this.cooldownMs = 60000; // 1 minute deduplication cooldown
    this.isSending = false;
    this.queue = [];
    this.pendingBatch = [];
    this.batchTimer = null;
    this.batchWaitMs = 3500; // 3.5s debounced alert batching

    // Exponential Backoff Retry Queue
    this.retryQueue = [];
    this.retryTimer = null;
    this.maxRetries = 3;
    this.baseRetryDelayMs = 1000;
    this.maxRetryDelayMs = 30000;

    // Outage Rate Limiting: Sliding window (max 15 alerts / 60s)
    this.rateLimitWindowMs = 60000;
    this.maxAlertsPerWindow = 15;
    this.alertTimestamps = [];
    this.throttledBuffer = [];
    this.rateLimitNoticeEmitted = false;
    this.throttleTimer = null;
    this.sentAlerts = [];
  }

  setAdminUserId(id) {
    const cleaned = String(id || '').trim();
    if (/^\d{17,20}$/.test(cleaned)) {
      this.adminUserId = cleaned;
      this.logger?.info('admin_notifier_user_updated', { adminUserId: this.adminUserId });
    }
  }

  getAdminUserId() {
    return this.adminUserId;
  }

  setTelegramConfig(token, chatId) {
    this.telegramBotToken = String(token || '').trim();
    this.telegramChatId = String(chatId || '').trim();
  }

  async sendAlert({ source = 'Manager', event = 'error', message = '', error = null, details = {}, level = 'error' } = {}) {
    // Filter out ordinary in-game events
    const filterHaystack = `${event} ${message} ${details?.lastKickReason || ''} ${details?.state || ''}`.toLowerCase();
    if (
      filterHaystack.includes('kick') ||
      filterHaystack.includes('banned') ||
      filterHaystack.includes('bị ban') ||
      filterHaystack.includes('bị kick') ||
      filterHaystack.includes('ip_limited') ||
      filterHaystack.includes('server_restriction') ||
      filterHaystack.includes('disconnect.quitting')
    ) {
      return;
    }

    const dedupKey = `${source}:${event}:${details?.workerId || details?.id || ''}:${message.slice(0, 80)}`;
    const now = Date.now();
    const cached = this.alertCache.get(dedupKey);

    if (cached && now - cached.lastSent < this.cooldownMs) {
      cached.suppressedCount = (cached.suppressedCount || 0) + 1;
      return;
    }

    const repeatNote = cached?.suppressedCount ? `\n*(Lặp lại ${cached.suppressedCount} lần trong 60s qua)*` : '';
    this.alertCache.set(dedupKey, { lastSent: now, suppressedCount: 0 });

    if (this.alertCache.size > 200) {
      for (const [k, v] of this.alertCache.entries()) {
        if (now - v.lastSent > this.cooldownMs * 3) this.alertCache.delete(k);
      }
    }

    // Sliding window rate limit check to prevent alert flooding during mass worker failures or cluster outages
    this.alertTimestamps = this.alertTimestamps.filter((t) => now - t < this.rateLimitWindowMs);

    if (this.alertTimestamps.length >= this.maxAlertsPerWindow) {
      this.throttledBuffer.push({ source, event, message: `${message}${repeatNote}`, error, details, level, timestamp: now });

      if (!this.rateLimitNoticeEmitted) {
        this.rateLimitNoticeEmitted = true;
        const noticeItem = {
          source: 'System Monitor',
          event: 'alert_rate_limiting_active',
          message: `⚠️ BÁO ĐỘNG HẠN CHẾ: Tần suất cảnh báo vượt ngưỡng an toàn (${this.maxAlertsPerWindow} alerts/60s). Hệ thống đang tạm thời gom các cảnh báo tiếp theo để tránh làm nghẽn kênh thông báo.`,
          level: 'warn',
          details: {
            limit: `${this.maxAlertsPerWindow} alerts/min`,
            activeWindowCount: this.alertTimestamps.length
          },
          timestamp: now
        };
        this.pendingBatch.push(noticeItem);
        if (this.batchTimer) clearTimeout(this.batchTimer);
        this.batchTimer = setTimeout(() => {
          this.batchTimer = null;
          void this.flushBatch();
        }, this.batchWaitMs);
        this.batchTimer.unref?.();
      }

      this.scheduleThrottleCheck();
      return;
    }

    this.alertTimestamps.push(now);

    const item = { source, event, message: `${message}${repeatNote}`, error, details, level, timestamp: now };
    this.pendingBatch.push(item);

    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      void this.flushBatch();
    }, this.batchWaitMs);
    this.batchTimer.unref?.();
  }

  scheduleThrottleCheck() {
    if (this.throttleTimer) return;
    const now = Date.now();
    const earliest = this.alertTimestamps[0] || now;
    const delay = Math.max(100, (earliest + this.rateLimitWindowMs) - now);
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      this.checkThrottledBuffer();
    }, delay);
    this.throttleTimer.unref?.();
  }

  checkThrottledBuffer() {
    const now = Date.now();
    this.alertTimestamps = this.alertTimestamps.filter((t) => now - t < this.rateLimitWindowMs);

    if (this.alertTimestamps.length < this.maxAlertsPerWindow && this.throttledBuffer.length > 0) {
      const buffered = this.throttledBuffer.splice(0, this.throttledBuffer.length);
      this.rateLimitNoticeEmitted = false;
      const summaryItem = {
        source: 'System Monitor',
        event: 'rate_limit_cleared_summary',
        message: `Hệ thống đã phục hồi lưu lượng bình thường. Tổng hợp ${buffered.length} cảnh báo được giữ lại trong thời gian nghẽn:`,
        level: 'info',
        isBatch: true,
        batchCount: buffered.length,
        items: buffered,
        details: { suppressedAlerts: buffered.length }
      };
      this.pendingBatch.push(summaryItem);
      void this.flushBatch();
    } else if (this.throttledBuffer.length === 0) {
      this.rateLimitNoticeEmitted = false;
    } else {
      this.scheduleThrottleCheck();
    }
  }

  async flushBatch() {
    if (this.pendingBatch.length === 0) return;
    const items = this.pendingBatch.splice(0, this.pendingBatch.length);

    if (items.length === 1) {
      this.queue.push(items[0]);
      return this.processQueue();
    }

    // Nhiều cảnh báo dồn dập -> Gom thành 1 thông báo tổng hợp duy nhất
    const highestLevel = items.some((i) => i.level === 'error') ? 'error' : (items.some((i) => i.level === 'warn') ? 'warn' : 'info');
    const sources = [...new Set(items.map((i) => i.source))].join(', ');
    const events = [...new Set(items.map((i) => i.event))].join(', ');
    const batchItem = {
      isBatch: true,
      batchCount: items.length,
      items,
      source: sources,
      event: `Tổng hợp ${items.length} sự cố dồn dập`,
      message: `Hệ thống ghi nhận ${items.length} sự cố xảy ra liên tiếp trong 3.5 giây vừa qua.`,
      level: highestLevel,
      details: {
        totalAlerts: items.length,
        sources,
        events
      }
    };

    this.queue.push(batchItem);
    return this.processQueue();
  }

  async processQueue() {
    if (this.isSending || this.queue.length === 0) return;
    this.isSending = true;

    try {
      while (this.queue.length > 0) {
        const queueEntry = this.queue.shift();
        const item = queueEntry.item || queueEntry;
        const channels = queueEntry.channels || ['dm', 'telegram'];
        const retries = queueEntry.retries || 0;

        this.sentAlerts.push(item);
        if (this.sentAlerts.length > 100) this.sentAlerts.shift();

        const failedChannels = [];

        if (channels.includes('dm')) {
          try {
            await this.dispatchDm(item);
          } catch (err) {
            if (err.code !== 50007) {
              this.logger?.warn?.('admin_dm_dispatch_failed', { adminUserId: this.adminUserId, error: err.message });
              failedChannels.push('dm');
            }
          }
        }

        if (channels.includes('telegram')) {
          try {
            await this.dispatchTelegram(item);
          } catch (err) {
            this.logger?.warn?.('telegram_alert_dispatch_failed', { error: err.message });
            failedChannels.push('telegram');
          }
        }

        if (failedChannels.length > 0) {
          this.enqueueRetry(item, failedChannels, retries);
        }

        await new Promise((r) => setTimeout(r, 600));
      }
    } finally {
      this.isSending = false;
    }
  }

  enqueueRetry(item, failedChannels, retries) {
    if (retries >= this.maxRetries) {
      this.logger?.error?.('admin_alert_max_retries_exceeded', {
        source: item.source,
        event: item.event,
        failedChannels,
        retries
      });
      return;
    }

    const nextRetry = retries + 1;
    const delayMs = Math.min(this.baseRetryDelayMs * Math.pow(2, retries), this.maxRetryDelayMs);
    const scheduledAt = Date.now() + delayMs;

    const retryEntry = {
      item,
      channels: failedChannels,
      retries: nextRetry,
      delayMs,
      scheduledAt
    };

    this.retryQueue.push(retryEntry);
    this.scheduleRetry();
  }

  scheduleRetry() {
    if (this.retryTimer || this.retryQueue.length === 0) return;
    const now = Date.now();
    let minDelay = Infinity;
    for (const entry of this.retryQueue) {
      const diff = entry.scheduledAt - now;
      if (diff < minDelay) minDelay = diff;
    }
    const timerDelay = Math.max(0, minDelay === Infinity ? this.baseRetryDelayMs : minDelay);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.processRetryQueue();
    }, timerDelay);
    this.retryTimer.unref?.();
  }

  async processRetryQueue() {
    if (this.retryQueue.length === 0) return;
    const now = Date.now();
    const readyEntries = [];
    const remaining = [];

    for (const entry of this.retryQueue) {
      if (entry.scheduledAt <= now) {
        readyEntries.push(entry);
      } else {
        remaining.push(entry);
      }
    }

    this.retryQueue = remaining;

    for (const entry of readyEntries) {
      this.queue.push(entry);
    }

    if (readyEntries.length > 0) {
      await this.processQueue();
    }

    if (this.retryQueue.length > 0) {
      this.scheduleRetry();
    }
  }

  async dispatchDm(item) {
    if (!this.adminUserId || !this.client) return;
    const { source, event, message, error, details, level, isBatch, batchCount, items } = item;

    const user = await this.client.users.fetch(this.adminUserId).catch(() => null);
    if (!user) return;

    const now = new Date();
    const timeStr = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const unix = Math.floor(now.getTime() / 1000);

    const color = level === 'error' ? 0xef4444 : level === 'warn' ? 0xf59e0b : 0x3b82f6;
    const icon = level === 'error' ? '🚨' : level === 'warn' ? '⚠️' : 'ℹ️';

    if (isBatch && Array.isArray(items)) {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${icon} [BÁO ĐỘNG HỆ THỐNG] Tổng hợp ${batchCount} sự cố dồn dập`)
        .setDescription(`Hệ thống ghi nhận **${batchCount}** sự cố dồn dập trong 3.5 giây vừa qua:`)
        .setTimestamp();

      const lines = items.slice(0, 10).map((it, idx) => {
        const itemIcon = it.level === 'error' ? '🚨' : it.level === 'warn' ? '⚠️' : 'ℹ️';
        return `${idx + 1}. ${itemIcon} **[${it.source}]** \`${it.event}\`: ${String(it.message).slice(0, 80)}`;
      });
      if (items.length > 10) lines.push(`*...và ${items.length - 10} cảnh báo khác.*`);

      embed.addFields([
        { name: '📋 Danh sách sự cố', value: lines.join('\n').slice(0, 1024), inline: false },
        { name: '⏰ Thời gian', value: `${timeStr}\n(<t:${unix}:R>)`, inline: true },
        { name: '📍 Nguồn liên quan', value: `\`${String(source).slice(0, 500)}\``, inline: true }
      ]);
      embed.setFooter({ text: 'KingMC AFK System Monitor • Gom cảnh báo tự động' });
      return await user.send({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${icon} [BÁO ĐỘNG: ${source.toUpperCase()}] ${event}`)
      .setDescription(message ? `**Nội dung:** ${message.slice(0, 1000)}` : 'Đã phát hiện sự cố hệ thống.')
      .setTimestamp();

    const fields = [
      { name: '📍 Nguồn / Hệ thống', value: `\`${source}\``, inline: true },
      { name: '⏰ Thời gian', value: `${timeStr}\n(<t:${unix}:R>)`, inline: true },
      { name: '🏷️ Phân loại', value: `\`${event}\``, inline: true }
    ];

    if (details && typeof details === 'object' && Object.keys(details).length > 0) {
      const detailLines = [];
      for (const [k, v] of Object.entries(details)) {
        if (v !== undefined && v !== null && v !== '') {
          detailLines.push(`• **${k}:** \`${String(v).slice(0, 120)}\``);
        }
      }
      if (detailLines.length > 0) {
        fields.push({
          name: '🔍 Chi tiết & Thông số',
          value: detailLines.slice(0, 8).join('\n').slice(0, 1024),
          inline: false
        });
      }
    }

    let stackText = '';
    if (error) {
      if (typeof error === 'string') stackText = error;
      else if (error.stack) stackText = error.stack;
      else if (error.message) stackText = error.message;
    }

    if (stackText) {
      const safeStack = stackText.replace(/(?:token|secret|password|key)=([^\s&]+)/gi, '$1=[REDACTED]');
      fields.push({
        name: '📄 Chi tiết lỗi kỹ thuật',
        value: `\`\`\`js\n${safeStack.slice(0, 950)}\n\`\`\``,
        inline: false
      });
    }

    embed.addFields(fields);
    embed.setFooter({ text: 'KingMC AFK System Monitor • Báo lỗi tự động đa kênh' });

    return await user.send({ embeds: [embed] });
  }

  async dispatchTelegram(item) {
    if (!this.telegramBotToken || !this.telegramChatId) return;
    const { source, event, message, details, level, isBatch, batchCount, items } = item;

    const icon = level === 'error' ? '🚨' : level === 'warn' ? '⚠️' : 'ℹ️';
    let text = '';

    if (isBatch && Array.isArray(items)) {
      text = `${icon} <b>[KINGMC AFK BATCH ALERT]</b>\n`;
      text += `Tổng hợp <b>${batchCount}</b> sự cố dồn dập trong 3.5 giây:\n\n`;
      items.slice(0, 10).forEach((it, idx) => {
        const itemIcon = it.level === 'error' ? '🚨' : it.level === 'warn' ? '⚠️' : 'ℹ️';
        text += `${idx + 1}. ${itemIcon} [${escapeTelegramHtml(it.source)}] <code>${escapeTelegramHtml(it.event)}</code>: ${escapeTelegramHtml(String(it.message).slice(0, 70))}\n`;
      });
      if (items.length > 10) text += `<i>...và ${items.length - 10} cảnh báo khác.</i>\n`;
    } else {
      text = `${icon} <b>[KINGMC AFK ALERT: ${escapeTelegramHtml(String(source || '').toUpperCase())}]</b>\n\n`;
      text += `<b>Sự kiện:</b> <code>${escapeTelegramHtml(event)}</code>\n`;
      if (message) text += `<b>Chi tiết:</b> ${escapeTelegramHtml(message)}\n`;

      if (details && typeof details === 'object') {
        text += `\n<b>Thông số:</b>\n`;
        for (const [k, v] of Object.entries(details)) {
          if (v !== undefined && v !== null && v !== '') {
            text += `• <i>${escapeTelegramHtml(k)}:</i> <code>${escapeTelegramHtml(String(v).slice(0, 80))}</code>\n`;
          }
        }
      }
    }

    const url = `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.telegramChatId,
        text: text.slice(0, 4000),
        parse_mode: 'HTML'
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      throw new Error(`Telegram API responded with HTTP ${res.status}`);
    }
    return res;
  }

  // --------------------------------------------------------------------------
  // IN-GAME SURVIVAL NOTIFICATION SHORTCUTS
  // --------------------------------------------------------------------------
  notifyOfflineBot(botId, botName, offlineMinutes = 5) {
    return this.sendAlert({
      source: 'BotWorker Fleet',
      event: 'bot_offline_warning',
      message: `Bot **${botName || botId}** (#${botId}) đã offline quá ${offlineMinutes} phút!`,
      details: { botId, botName, offlineMinutes },
      level: 'warn'
    });
  }

  notifyLowTotem(botId, botName, totemCount) {
    return this.sendAlert({
      source: 'KingMC Game Survival',
      event: 'low_totem_warning',
      message: `Bot **${botName || botId}** (#${botId}) sắp cạn Totem! Hiện chỉ còn **${totemCount}** cái!`,
      details: { botId, botName, totemCount },
      level: 'warn'
    });
  }

  notifyBotDeath(botId, botName, deathCoords) {
    const coordsStr = deathCoords ? `X:${deathCoords.x}, Y:${deathCoords.y}, Z:${deathCoords.z}` : 'Không rõ';
    return this.sendAlert({
      source: 'KingMC Game Survival',
      event: 'bot_death_alert',
      message: `Bot **${botName || botId}** (#${botId}) đã bị tiêu diệt tại tọa độ: \`${coordsStr}\`!`,
      details: { botId, botName, deathCoords: coordsStr },
      level: 'error'
    });
  }

  notifyBotRecovered(botId, botName) {
    return this.sendAlert({
      source: 'BotWorker Fleet',
      event: 'bot_recovered',
      message: `Bot **${botName || botId}** (#${botId}) đã phục hồi kết nối thành công!`,
      details: { botId, botName },
      level: 'info'
    });
  }

  hookLogger(logger) {
    if (!logger || typeof logger !== 'object') return;
    try {
      const originalError = logger.error;
      if (typeof originalError === 'function') {
        logger.error = (event, fields = {}) => {
          originalError(event, fields);
          try {
            const strEvent = String(event || '').toLowerCase();
            const strMsg = String(fields?.message || fields?.error || '').toLowerCase();
            let source = fields?.source;
            if (!source) {
              if (strEvent.includes('supabase') || strMsg.includes('supabase') || strMsg.includes('postgrest') || strMsg.includes('pgrst')) {
                source = 'Supabase';
              } else if (strEvent.includes('worker') || strEvent.includes('bot') || strMsg.includes('worker')) {
                source = 'Worker';
              } else if (strEvent.includes('discord') || strEvent.includes('interaction')) {
                source = 'Discord';
              } else if (strEvent.includes('wispbyte')) {
                source = 'Wispbyte';
              } else if (strEvent.includes('link4m')) {
                source = 'Link4M';
              } else {
                source = 'Manager';
              }
            }
            const message = fields?.message || fields?.reason || fields?.error || String(event);
            const errorObj = fields?.error || (fields?.stack ? { message, stack: fields.stack } : null);
            void this.sendAlert({
              source,
              event: String(event),
              message: String(message),
              error: errorObj,
              details: fields,
              level: 'error'
            });
          } catch (_) {}
        };
      }
    } catch (_) {}
  }
}

module.exports = { AdminNotifier, escapeTelegramHtml };
