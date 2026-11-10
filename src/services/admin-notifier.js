'use strict';

const { EmbedBuilder } = require('discord.js');

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

    const dedupKey = `${source}:${event}:${details.workerId || details.id || ''}:${message.slice(0, 80)}`;
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

    const item = { source, event, message: `${message}${repeatNote}`, error, details, level };
    this.queue.push(item);
    return this.processQueue();
  }

  async processQueue() {
    if (this.isSending || this.queue.length === 0) return;
    this.isSending = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        await Promise.allSettled([
          this.dispatchDm(item),
          this.dispatchTelegram(item)
        ]);
        await new Promise((r) => setTimeout(r, 600));
      }
    } finally {
      this.isSending = false;
    }
  }

  async dispatchDm({ source, event, message, error, details, level }) {
    if (!this.adminUserId || !this.client) return;

    try {
      const user = await this.client.users.fetch(this.adminUserId).catch(() => null);
      if (!user) return;

      const now = new Date();
      const timeStr = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const unix = Math.floor(now.getTime() / 1000);

      const color = level === 'error' ? 0xef4444 : level === 'warn' ? 0xf59e0b : 0x3b82f6;
      const icon = level === 'error' ? '🚨' : level === 'warn' ? '⚠️' : 'ℹ️';

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

      await user.send({ embeds: [embed] });
    } catch (err) {
      if (err.code !== 50007) {
        this.logger?.warn?.('admin_dm_dispatch_failed', { adminUserId: this.adminUserId, error: err.message });
      }
    }
  }

  async dispatchTelegram({ source, event, message, details, level }) {
    if (!this.telegramBotToken || !this.telegramChatId) return;

    try {
      const icon = level === 'error' ? '🚨' : level === 'warn' ? '⚠️' : 'ℹ️';
      let text = `${icon} <b>[KINGMC AFK ALERT: ${source.toUpperCase()}]</b>\n\n`;
      text += `<b>Sự kiện:</b> <code>${event}</code>\n`;
      if (message) text += `<b>Chi tiết:</b> ${message}\n`;

      if (details && typeof details === 'object') {
        text += `\n<b>Thông số:</b>\n`;
        for (const [k, v] of Object.entries(details)) {
          if (v !== undefined && v !== null && v !== '') {
            text += `• <i>${k}:</i> <code>${String(v).slice(0, 80)}</code>\n`;
          }
        }
      }

      const url = `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.telegramChatId,
          text: text.slice(0, 4000),
          parse_mode: 'HTML'
        }),
        signal: AbortSignal.timeout(8000)
      });
    } catch (err) {
      this.logger?.warn?.('telegram_alert_dispatch_failed', { error: err.message });
    }
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

module.exports = { AdminNotifier };
