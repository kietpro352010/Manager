'use strict';

const { EmbedBuilder } = require('discord.js');
const { decryptSecret } = require('../utils/secrets');

function escapeTelegramHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const SENSITIVE_KEY_REGEX = /((?:token|secret|password|key|apiKey|authorization|cookie|session)\s*[:=]\s*)([^\s&"']+)/gi;

function redactSensitiveText(text) {
  if (text === undefined || text === null) return '';
  return String(text).replace(SENSITIVE_KEY_REGEX, '$1[REDACTED]');
}

function redactSensitiveValue(key, val) {
  if (val === null || val === undefined) return val;
  const k = String(key).toLowerCase();
  if (/password|secret|token|key|cookie|session|credential|auth/i.test(k)) {
    return '[REDACTED]';
  }
  if (typeof val === 'string') {
    return redactSensitiveText(val);
  }
  if (typeof val === 'object') {
    return redactSensitiveObject(val);
  }
  return val;
}

function redactSensitiveObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => redactSensitiveValue('', item));
  const redacted = {};
  for (const [k, v] of Object.entries(obj)) {
    redacted[k] = redactSensitiveValue(k, v);
  }
  return redacted;
}

class AdminNotifier {
  constructor({ client, store = null, adminUserId = '', telegramBotToken = '', telegramChatId = '', encryptionKey = '', logger } = {}) {
    this.client = client;
    this.store = store || null;
    this.adminUserId = String(adminUserId || '').trim();
    this.encryptionKey = String(encryptionKey || '').trim();
    this.userAlertCache = new Map();
    this.sentUserAlerts = [];
    this._persistingAudit = false;
    this.telegramBotToken = String(telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    this.telegramChatId = String(telegramChatId || process.env.TELEGRAM_CHAT_ID || '').trim();
    this.discordWebhookUrl = String(process.env.DISCORD_WEBHOOK_URL || '').trim();
    this.webhookEnabled = true;
    this.webhookRules = {
      notifyOnOffline: true,
      notifyOnRecover: true,
      notifyOnLowTotem: true,
      notifyOnLowHealth: true,
      notifyOnDeath: true,
      offlineThresholdMinutes: 5
    };
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

  setStore(store) {
    this.store = store || null;
  }

  setTelegramConfig(token, chatId) {
    this.telegramBotToken = String(token || '').trim();
    this.telegramChatId = String(chatId || '').trim();
  }

  configureWebhook(webhookCfg = {}) {
    if (!webhookCfg || typeof webhookCfg !== 'object') return;
    const hasDiscordField = webhookCfg.discordUrl !== undefined || webhookCfg.webhookUrl !== undefined || webhookCfg.discordUrlCiphertext !== undefined;
    if (hasDiscordField) {
      let resolvedDiscordUrl = String(webhookCfg.discordUrl ?? webhookCfg.webhookUrl ?? '').trim();
      const hasCiphertext = Boolean(webhookCfg.discordUrlCiphertext && typeof webhookCfg.discordUrlCiphertext === 'string');
      if (!resolvedDiscordUrl && hasCiphertext && this.encryptionKey) {
        try {
          resolvedDiscordUrl = String(decryptSecret(webhookCfg.discordUrlCiphertext, this.encryptionKey) || '').trim();
        } catch (_) {}
      }
      if (resolvedDiscordUrl || !hasCiphertext) {
        this.discordWebhookUrl = resolvedDiscordUrl;
      }
    }
    if (webhookCfg.enabled !== undefined) {
      this.webhookEnabled = Boolean(webhookCfg.enabled);
    }
    const hasTelegramField = webhookCfg.telegramToken !== undefined || webhookCfg.telegramTokenCiphertext !== undefined || webhookCfg.telegramChatId !== undefined;
    if (hasTelegramField) {
      let nextToken = this.telegramBotToken;
      if (webhookCfg.telegramToken !== undefined || webhookCfg.telegramTokenCiphertext !== undefined) {
        let resolvedToken = String(webhookCfg.telegramToken ?? '').trim();
        const hasTokenCipher = Boolean(webhookCfg.telegramTokenCiphertext && typeof webhookCfg.telegramTokenCiphertext === 'string');
        if (!resolvedToken && hasTokenCipher && this.encryptionKey) {
          try {
            resolvedToken = String(decryptSecret(webhookCfg.telegramTokenCiphertext, this.encryptionKey) || '').trim();
          } catch (_) {}
        }
        if (resolvedToken || !hasTokenCipher) {
          nextToken = resolvedToken;
        }
      }
      this.setTelegramConfig(
        nextToken,
        webhookCfg.telegramChatId !== undefined ? webhookCfg.telegramChatId : this.telegramChatId
      );
    }
    this.webhookRules = {
      ...this.webhookRules,
      ...(webhookCfg.notifyOnOffline !== undefined ? { notifyOnOffline: Boolean(webhookCfg.notifyOnOffline) } : {}),
      ...(webhookCfg.notifyOnRecover !== undefined ? { notifyOnRecover: Boolean(webhookCfg.notifyOnRecover) } : {}),
      ...(webhookCfg.notifyOnLowTotem !== undefined ? { notifyOnLowTotem: Boolean(webhookCfg.notifyOnLowTotem) } : {}),
      ...(webhookCfg.notifyOnLowHealth !== undefined ? { notifyOnLowHealth: Boolean(webhookCfg.notifyOnLowHealth) } : {}),
      ...(webhookCfg.notifyOnDeath !== undefined ? { notifyOnDeath: Boolean(webhookCfg.notifyOnDeath) } : {}),
      ...(webhookCfg.offlineThresholdMinutes !== undefined && Number.isFinite(Number(webhookCfg.offlineThresholdMinutes))
        ? { offlineThresholdMinutes: Math.max(1, Math.min(1440, Math.round(Number(webhookCfg.offlineThresholdMinutes)))) }
        : {})
    };
  }

  shouldNotifyEvent(event) {
    if (!this.webhookEnabled) return false;
    if (event === 'bot_offline_warning') return this.webhookRules.notifyOnOffline !== false;
    if (event === 'bot_recovered') return this.webhookRules.notifyOnRecover !== false;
    if (event === 'low_totem_warning') return this.webhookRules.notifyOnLowTotem !== false;
    if (event === 'low_health_warning') return this.webhookRules.notifyOnLowHealth !== false;
    if (event === 'bot_death_alert') return this.webhookRules.notifyOnDeath !== false;
    return true;
  }

  async sendAlert({ source = 'Manager', event = 'error', message = '', error = null, details = {}, level = 'error', bypassInGameFilter = false, skipDm = false } = {}) {
    // Filter out ordinary in-game events unless explicitly flagged as a verified AFK lifecycle alert
    if (!bypassInGameFilter) {
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

    // Persist system/database/discord/manager alert to Web Dashboard Audit Trail (Nhật Ký Hệ Thống)
    if (this.store && typeof this.store.addAudit === 'function') {
      const safeSourceKey = String(source || 'MANAGER').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'MANAGER';
      void Promise.resolve().then(() => this.store.addAudit({
        action: `SYSTEM_ALERT_${safeSourceKey}`,
        actionLabel: `[${source}] ${event}`,
        category: 'SYSTEM',
        logType: 'SYSTEM',
        status: level === 'warn' ? 'WARNING' : (level === 'info' ? 'SUCCESS' : 'FAILED'),
        actorId: `system:${String(source || 'manager').toLowerCase()}`,
        actorRole: 'system',
        targetId: String(details?.workerId || details?.botId || details?.userId || source || 'system'),
        message: redactSensitiveText(message).slice(0, 500),
        details: redactSensitiveObject({
          source,
          event,
          level,
          message: String(message || '').slice(0, 500),
          ...(details && typeof details === 'object' ? details : {}),
          ...(error ? { error: typeof error === 'string' ? error : (error.message || String(error)) } : {})
        })
      })).catch(() => null);
    }

    // Sliding window rate limit check to prevent alert flooding during mass worker failures or cluster outages
    this.alertTimestamps = this.alertTimestamps.filter((t) => now - t < this.rateLimitWindowMs);

    if (this.alertTimestamps.length >= this.maxAlertsPerWindow) {
      if (this.throttledBuffer.length >= 200) this.throttledBuffer.shift();
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

    const item = { source, event, message: `${message}${repeatNote}`, error, details, level, skipDm: Boolean(skipDm), timestamp: now };
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
      skipDm: items.every((i) => i.skipDm === true),
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
        const defaultChannels = ['dm', 'telegram'];
        if (this.discordWebhookUrl && this.webhookEnabled !== false) {
          defaultChannels.push('webhook');
        }
        const channels = queueEntry.channels || defaultChannels;
        const retries = queueEntry.retries || 0;

        this.sentAlerts.push(item);
        if (this.sentAlerts.length > 100) this.sentAlerts.shift();

        const failedChannels = [];

        if (channels.includes('dm') && !item.skipDm) {
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

        if (channels.includes('webhook')) {
          try {
            await this.dispatchDiscordWebhook(item);
          } catch (err) {
            this.logger?.warn?.('discord_webhook_dispatch_failed', { error: err.message });
            failedChannels.push('webhook');
          }
        }

        if (failedChannels.length > 0) {
          this.enqueueRetry(item, failedChannels, retries);
        }

        await new Promise((r) => {
          const t = setTimeout(r, 600);
          t.unref?.();
        });
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

  async resolveEffectiveAdminDiscordId(targetStore = this.store) {
    if (this.adminUserId && /^\d{17,20}$/.test(this.adminUserId)) {
      return this.adminUserId;
    }
    if (targetStore && typeof targetStore.getDiscordLink === 'function') {
      const adminLink = await targetStore.getDiscordLink('admin').catch(() => null);
      const adminCandidate = String(adminLink?.discord_user_id || adminLink?.discordUserId || '').trim();
      if (adminLink && String(adminLink.status || 'active').toLowerCase() !== 'revoked' && /^\d{17,20}$/.test(adminCandidate)) {
        return adminCandidate;
      }
    }
    return '';
  }

  async isAdminDmEnabled(targetStore = this.store) {
    if (targetStore && typeof targetStore.getSetting === 'function') {
      const adminPref = await targetStore.getSetting('user_discord_notify:admin').catch(() => null);
      if ((adminPref && typeof adminPref === 'object' && adminPref.enabled === false) || adminPref === false) {
        return false;
      }
    }
    return true;
  }

  async dispatchDm(item) {
    if (!this.client) return;
    const targetAdminId = await this.resolveEffectiveAdminDiscordId(this.store);
    if (!targetAdminId) return;
    if (!(await this.isAdminDmEnabled(this.store))) return;
    const { source, event, message, error, details, level, isBatch, batchCount, items } = item;

    const user = await this.client.users.fetch(targetAdminId).catch(() => null);
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
        return `${idx + 1}. ${itemIcon} **[${it.source}]** \`${it.event}\`: ${redactSensitiveText(String(it.message)).slice(0, 80)}`;
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
      .setDescription(message ? `**Nội dung:** ${redactSensitiveText(message).slice(0, 1000)}` : 'Đã phát hiện sự cố hệ thống.')
      .setTimestamp();

    const fields = [
      { name: '📍 Nguồn / Hệ thống', value: `\`${source}\``, inline: true },
      { name: '⏰ Thời gian', value: `${timeStr}\n(<t:${unix}:R>)`, inline: true },
      { name: '🏷️ Phân loại', value: `\`${event}\``, inline: true }
    ];

    const safeDetails = redactSensitiveObject(details);
    if (safeDetails && typeof safeDetails === 'object' && Object.keys(safeDetails).length > 0) {
      const detailLines = [];
      for (const [k, v] of Object.entries(safeDetails)) {
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
      const safeStack = redactSensitiveText(stackText);
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
        text += `${idx + 1}. ${itemIcon} [${escapeTelegramHtml(it.source)}] <code>${escapeTelegramHtml(it.event)}</code>: ${escapeTelegramHtml(redactSensitiveText(String(it.message)).slice(0, 70))}\n`;
      });
      if (items.length > 10) text += `<i>...và ${items.length - 10} cảnh báo khác.</i>\n`;
    } else {
      text = `${icon} <b>[KINGMC AFK ALERT: ${escapeTelegramHtml(String(source || '').toUpperCase())}]</b>\n\n`;
      text += `<b>Sự kiện:</b> <code>${escapeTelegramHtml(event)}</code>\n`;
      if (message) text += `<b>Chi tiết:</b> ${escapeTelegramHtml(redactSensitiveText(message))}\n`;

      const safeDetails = redactSensitiveObject(details);
      if (safeDetails && typeof safeDetails === 'object') {
        text += `\n<b>Thông số:</b>\n`;
        for (const [k, v] of Object.entries(safeDetails)) {
          if (v !== undefined && v !== null && v !== '') {
            text += `• <i>${escapeTelegramHtml(k)}:</i> <code>${escapeTelegramHtml(String(v).slice(0, 80))}</code>\n`;
          }
        }
      }
    }

    const url = `https://api.telegram.org/bot${encodeURIComponent(this.telegramBotToken)}/sendMessage`;
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

  async dispatchDiscordWebhook(item) {
    if (!this.discordWebhookUrl || this.webhookEnabled === false) return;
    const { source, event, message, details, level, isBatch, batchCount, items } = item;
    const color = level === 'error' ? 0xef4444 : level === 'warn' ? 0xf59e0b : 0x3b82f6;
    const icon = level === 'error' ? '🚨' : level === 'warn' ? '⚠️' : 'ℹ️';

    let embedPayload;
    if (isBatch && Array.isArray(items)) {
      const lines = items.slice(0, 10).map((it, idx) => {
        const itemIcon = it.level === 'error' ? '🚨' : it.level === 'warn' ? '⚠️' : 'ℹ️';
        return `${idx + 1}. ${itemIcon} **[${it.source}]** \`${it.event}\`: ${redactSensitiveText(String(it.message)).slice(0, 80)}`;
      });
      if (items.length > 10) lines.push(`*...và ${items.length - 10} cảnh báo khác.*`);
      embedPayload = {
        color,
        title: `${icon} [BÁO ĐỘNG HỆ THỐNG] Tổng hợp ${batchCount} sự cố dồn dập`,
        description: lines.join('\n').slice(0, 3900),
        timestamp: new Date().toISOString()
      };
    } else {
      const safeDetails = redactSensitiveObject(details);
      const fields = [];
      if (safeDetails && typeof safeDetails === 'object') {
        const lines = [];
        for (const [k, v] of Object.entries(safeDetails)) {
          if (v !== undefined && v !== null && v !== '') {
            lines.push(`• **${k}:** \`${String(v).slice(0, 120)}\``);
          }
        }
        if (lines.length > 0) {
          fields.push({ name: 'Chi tiết', value: lines.slice(0, 8).join('\n').slice(0, 1024), inline: false });
        }
      }
      embedPayload = {
        color,
        title: `${icon} [${String(source || 'Manager').toUpperCase()}] ${String(event || 'alert')}`.slice(0, 250),
        description: redactSensitiveText(message || 'Cảnh báo hệ thống.').slice(0, 3900),
        fields,
        timestamp: new Date().toISOString()
      };
    }

    const res = await fetch(this.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embedPayload] }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      throw new Error(`Discord Webhook responded with HTTP ${res.status}`);
    }
    return res;
  }

  // --------------------------------------------------------------------------
  // IN-GAME SURVIVAL NOTIFICATION SHORTCUTS
  // --------------------------------------------------------------------------
  notifyOfflineBot(botId, botName, offlineMinutes = 5) {
    if (!this.shouldNotifyEvent('bot_offline_warning')) return;
    return this.sendAlert({
      source: 'BotWorker Fleet',
      event: 'bot_offline_warning',
      message: `Bot **${botName || botId}** (#${botId}) đã offline quá ${offlineMinutes} phút!`,
      details: { botId, botName, offlineMinutes },
      level: 'warn'
    });
  }

  notifyLowTotem(botId, botNameOrCount, totemCount) {
    if (!this.shouldNotifyEvent('low_totem_warning')) return;
    let botName = botNameOrCount;
    let count = totemCount;
    if (count === undefined && typeof botNameOrCount === 'number') {
      count = botNameOrCount;
      botName = botId;
    }
    const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
    return this.sendAlert({
      source: 'KingMC Game Survival',
      event: 'low_totem_warning',
      message: `Bot **${botName || botId}** (#${botId}) sắp cạn Totem! Hiện chỉ còn **${safeCount}** cái!`,
      details: { botId, botName: botName || botId, totemCount: safeCount },
      level: 'warn'
    });
  }

  notifyBotDeath(botId, botNameOrCoords, deathCoords) {
    if (!this.shouldNotifyEvent('bot_death_alert')) return;
    let botName = botNameOrCoords;
    let coords = deathCoords;
    if (coords === undefined && botNameOrCoords !== undefined && typeof botNameOrCoords !== 'string') {
      coords = botNameOrCoords;
      botName = botId;
    }
    let coordsStr = 'Không rõ';
    if (coords && typeof coords === 'object' && (coords.x !== undefined || coords.y !== undefined || coords.z !== undefined)) {
      const rx = Number.isFinite(Number(coords.x)) ? Math.round(Number(coords.x)) : '?';
      const ry = Number.isFinite(Number(coords.y)) ? Math.round(Number(coords.y)) : '?';
      const rz = Number.isFinite(Number(coords.z)) ? Math.round(Number(coords.z)) : '?';
      coordsStr = `X:${rx}, Y:${ry}, Z:${rz}`;
    } else if (typeof coords === 'string' && coords.trim()) {
      coordsStr = coords.trim();
    }
    return this.sendAlert({
      source: 'KingMC Game Survival',
      event: 'bot_death_alert',
      message: `Bot **${botName || botId}** (#${botId}) đã bị tiêu diệt (${coordsStr})!`,
      details: { botId, botName: botName || botId, deathCoords: coordsStr },
      level: 'error'
    });
  }

  notifyBotRecovered(botId, botName) {
    if (!this.shouldNotifyEvent('bot_recovered')) return;
    return this.sendAlert({
      source: 'BotWorker Fleet',
      event: 'bot_recovered',
      message: `Bot **${botName || botId}** (#${botId}) đã phục hồi kết nối thành công!`,
      details: { botId, botName },
      level: 'info'
    });
  }

  async dispatchUserDm({ discordUserId, title, description, color = 0x3b82f6, fields = [] } = {}) {
    const targetId = String(discordUserId || '').trim();
    if (!targetId || !this.client || typeof this.client.users?.fetch !== 'function') return false;
    try {
      const user = await this.client.users.fetch(targetId).catch(() => null);
      if (!user || typeof user.send !== 'function') return false;
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(String(title || '🔔 Thông Báo Trạng Thái Bot').slice(0, 250))
        .setDescription(String(description || '').slice(0, 3900))
        .setTimestamp()
        .setFooter({ text: 'KingMC AFK Bot Cloud • Thông báo riêng tự động cho chủ Bot' });
      if (Array.isArray(fields) && fields.length > 0) {
        embed.addFields(fields.slice(0, 8));
      }
      await user.send({ embeds: [embed] });
      return true;
    } catch (err) {
      if (err?.code !== 50007) {
        this.logger?.debug?.('user_dm_dispatch_failed', { discordUserId: targetId, error: err?.message });
      }
      return false;
    }
  }

  async notifyBotLifecycleEvent({ workerId, workerMeta = null, event = {}, registry = null, store = null, skipAdminAlert = false } = {}) {
    const id = String(workerId || '').trim().toLowerCase();
    const eventType = String(event?.type || '').trim().toLowerCase();
    if (!id || !['afk_kicked', 'bot_death', 'afk_recovered', 'reconnect_exhausted'].includes(eventType)) {
      return { ok: false, skipped: true };
    }

    // Deduplicate rapid duplicate events per bot + eventType within 15 seconds
    const dedupKey = `lifecycle:${id}:${eventType}`;
    const now = Date.now();
    const lastSentAt = this.userAlertCache.get(dedupKey) || 0;
    if (now - lastSentAt < 15000) {
      return { ok: true, deduplicated: true };
    }
    this.userAlertCache.set(dedupKey, now);
    if (this.userAlertCache.size > 300) {
      for (const [k, ts] of this.userAlertCache.entries()) {
        if (now - ts > 60000) this.userAlertCache.delete(k);
      }
    }

    const targetStore = store || this.store;
    const worker = workerMeta
      || (registry && typeof registry.find === 'function' ? await registry.find(id).catch(() => null) : null);
    const botLabel = worker?.alias || worker?.name || (worker?.botNumber ? `Bot #${worker.botNumber}` : id);
    const botNumber = worker?.botNumber || id;
    const mcUsername = worker?.status?.username || worker?.settings?.username || '';
    const settings = worker?.settings || {};

    // Read user notification toggles on this bot (all default to true)
    const userNotifyEnabled = settings.userNotifyEnabled !== false;
    let eventToggleAllowed = true;
    if (eventType === 'afk_kicked' || eventType === 'bot_death') {
      eventToggleAllowed = settings.notifyOnAfkKick !== false;
    } else if (eventType === 'afk_recovered') {
      eventToggleAllowed = settings.notifyOnAfkRecover !== false;
    } else if (eventType === 'reconnect_exhausted') {
      eventToggleAllowed = settings.notifyOnReconnectExhausted !== false;
    }

    // Look up the assigned user and verify an ACTIVE Web <-> Discord link (strictly linked accounts only)
    let assignedUserId = '';
    let assignedUsername = '';
    let targetDiscordUserId = '';
    let userMasterDiscordNotifyEnabled = true;

    const isValidSnowflake = (val) => /^\d{17,20}$/.test(String(val || '').trim());

    if (targetStore) {
      if (typeof targetStore.assignedUser === 'function') {
        const assignment = await targetStore.assignedUser(id).catch(() => null);
        if (assignment?.userId) {
          assignedUserId = String(assignment.userId).trim();
        }
      }
      if (assignedUserId) {
        if (typeof targetStore.getAccess === 'function') {
          const userRec = await targetStore.getAccess(assignedUserId).catch(() => null);
          if (userRec) {
            assignedUsername = String(userRec.username || assignedUserId);
          }
        }
        // Strictly resolve active Web <-> Discord link via getDiscordLink
        if (typeof targetStore.getDiscordLink === 'function') {
          let link = await targetStore.getDiscordLink(assignedUserId).catch(() => null);
          if (!link && assignedUsername && assignedUsername !== assignedUserId) {
            link = await targetStore.getDiscordLink(assignedUsername).catch(() => null);
          }
          if (link && String(link.status || 'active').toLowerCase() !== 'revoked') {
            const candidateId = String(link.discord_user_id || link.discordUserId || '').trim();
            if (isValidSnowflake(candidateId)) {
              targetDiscordUserId = candidateId;
            }
            if (!assignedUsername && link.username) {
              assignedUsername = String(link.username);
            }
          }
        }
        // Check User's master Discord DM notification toggle (default: enabled)
        if (typeof targetStore.getSetting === 'function') {
          let pref = await targetStore.getSetting(`user_discord_notify:${assignedUserId}`).catch(() => null);
          if (pref === null && assignedUsername && assignedUsername.toLowerCase() !== assignedUserId.toLowerCase()) {
            pref = await targetStore.getSetting(`user_discord_notify:${assignedUsername.toLowerCase()}`).catch(() => null);
          }
          if (pref && typeof pref === 'object' && pref.enabled === false) {
            userMasterDiscordNotifyEnabled = false;
          } else if (pref === false) {
            userMasterDiscordNotifyEnabled = false;
          }
        }
      }
    }

    // Check Admin's master Discord DM notification toggle & dynamically resolve Admin's active Web-linked Discord ID
    const effectiveAdminDiscordId = await this.resolveEffectiveAdminDiscordId(targetStore);
    const adminDiscordNotifyEnabled = await this.isAdminDmEnabled(targetStore);

    const reasonText = redactSensitiveText(event?.reason || event?.message || event?.coords || 'Không rõ chi tiết').slice(0, 300);
    const attempts = Number(event?.attempts) || 0;
    const timeStr = new Date(now).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    let title = '';
    let description = '';
    let color = 0x3b82f6;
    let level = 'warn';

    if (eventType === 'afk_kicked') {
      title = `⚠️ [BÁO ĐỘNG AFK] ${botLabel} bị kick / văng khi đang treo AFK!`;
      description = `Bot **${botLabel}** (#${botNumber}) đang ở khu vực treo AFK thì bị kick hoặc văng khỏi máy chủ.\n• **Lý do:** \`${reasonText}\`\n• **Trạng thái:** Hệ thống đang tự động thử kết nối lại (anti-cheat delay)...`;
      color = 0xf59e0b;
      level = 'warn';
    } else if (eventType === 'bot_death') {
      title = `💀 [BÁO ĐỘNG BOT DIE] ${botLabel} vừa bị chết trong game!`;
      description = `Bot **${botLabel}** (#${botNumber}) vừa bị tiêu diệt trong máy chủ!\n• **Tọa độ / Chi tiết:** \`${reasonText}\``;
      color = 0xef4444;
      level = 'error';
    } else if (eventType === 'afk_recovered') {
      title = `✅ [KẾT NỐI LẠI THÀNH CÔNG] ${botLabel} đã vào lại khu vực AFK!`;
      description = `Bot **${botLabel}** (#${botNumber}) đã tự động kết nối lại, vượt sảnh và vào lại cụm AFK thành công${attempts > 0 ? ` sau **${attempts} lần thử**` : ''}.`;
      color = 0x22c55e;
      level = 'info';
    } else if (eventType === 'reconnect_exhausted') {
      title = `🛑 [DỪNG RECONNECT] ${botLabel} kết nối lại thất bại quá nhiều lần!`;
      description = `Bot **${botLabel}** (#${botNumber}) đã thử kết nối lại **${attempts || 'nhiều'} lần** liên tiếp (thời gian chờ tăng dần) nhưng không thành công nên hệ thống đã **tự động dừng kết nối**.\n• **Lý do cuối:** \`${reasonText}\`\n• **Hành động:** Vui lòng mở Web Dashboard kiểm tra và bấm **Chạy** khi máy chủ ổn định.`;
      color = 0xef4444;
      level = 'error';
    }

    const dmFields = [
      { name: '🤖 Bot được gán', value: `\`${botLabel}\` (#${botNumber})`, inline: true },
      ...(mcUsername ? [{ name: '🎮 Nhân vật MC', value: `\`${mcUsername}\``, inline: true }] : []),
      { name: '⏰ Thời gian', value: timeStr, inline: true }
    ];

    let userNotified = false;
    const alreadyNotifiedAsAdmin = Boolean(
      skipAdminAlert &&
      eventType === 'bot_death' &&
      adminDiscordNotifyEnabled &&
      effectiveAdminDiscordId &&
      targetDiscordUserId &&
      targetDiscordUserId === effectiveAdminDiscordId
    );
    const canNotifyAssignedUser = Boolean(
      assignedUserId &&
      targetDiscordUserId &&
      userMasterDiscordNotifyEnabled &&
      userNotifyEnabled &&
      eventToggleAllowed &&
      !alreadyNotifiedAsAdmin
    );
    if (canNotifyAssignedUser) {
      userNotified = await this.dispatchUserDm({
        discordUserId: targetDiscordUserId,
        title,
        description,
        color,
        fields: dmFields
      });
    }

    this.sentUserAlerts.push({
      workerId: id,
      botLabel,
      eventType,
      assignedUserId: assignedUserId || null,
      assignedUsername: assignedUsername || null,
      discordUserId: targetDiscordUserId || null,
      userMasterDiscordNotifyEnabled,
      userNotifyEnabled,
      eventToggleAllowed,
      userNotified,
      timestamp: now
    });
    if (this.sentUserAlerts.length > 100) this.sentUserAlerts.shift();

    // Always notify Admin as well (and persist to Web Dashboard System Logs via sendAlert)
    // Skip duplicate Admin DM if Admin already received the User DM on the same Discord ID, or if Admin muted Discord DMs
    const skipAdminDm = !adminDiscordNotifyEnabled || (userNotified && targetDiscordUserId && targetDiscordUserId === effectiveAdminDiscordId);
    if (!skipAdminAlert) {
      await this.sendAlert({
        source: 'KingMC AFK Monitor',
        event: eventType,
        message: `${description}${assignedUsername ? `\n• **Khách thuê:** \`${assignedUsername}\` (${userNotified ? 'Đã nhắn DM Discord' : (!targetDiscordUserId ? 'Chưa liên kết Discord với Web' : 'Đã tắt thông báo Discord')})` : '\n• **Khách thuê:** `Chưa gán`'}`,
        details: {
          workerId: id,
          botNumber,
          botLabel,
          mcUsername: mcUsername || undefined,
          assignedUser: assignedUsername || assignedUserId || 'unassigned',
          userNotified,
          ...(attempts > 0 ? { attempts } : {}),
          reason: reasonText
        },
        level,
        bypassInGameFilter: true,
        skipDm: skipAdminDm
      });
    }

    return {
      ok: true,
      eventType,
      assignedUserId: assignedUserId || null,
      userNotified
    };
  }

  _resolveLogSource(strEvent, strMsg, explicitSource) {
    if (explicitSource) return explicitSource;
    if (strEvent.includes('supabase') || strMsg.includes('supabase') || strMsg.includes('postgrest') || strMsg.includes('pgrst') || strEvent.includes('db_') || strEvent.includes('rpc_')) {
      return 'Supabase Database';
    }
    if (strEvent.includes('discord') || strEvent.includes('interaction')) {
      return 'Discord';
    }
    if (strEvent.includes('wispbyte')) {
      return 'Wispbyte';
    }
    if (strEvent.includes('link4m')) {
      return 'Link4M';
    }
    if (strEvent.includes('outbox') || strEvent.includes('state_sync') || strEvent.includes('broker')) {
      return 'CommandBroker';
    }
    if (strEvent.includes('worker') || strEvent.includes('bot') || strMsg.includes('worker')) {
      return 'Worker System';
    }
    return 'Manager';
  }

  hookLogger(logger) {
    if (!logger || typeof logger !== 'object') return;
    const isInternalAlertEvent = (strEvent) => (
      strEvent.startsWith('admin_alert_') ||
      strEvent.startsWith('admin_dm_') ||
      strEvent.startsWith('user_dm_') ||
      strEvent.startsWith('telegram_alert_') ||
      strEvent.startsWith('discord_webhook_')
    );
    try {
      const originalError = logger.error;
      if (typeof originalError === 'function') {
        logger.error = (event, fields = {}) => {
          originalError(event, fields);
          try {
            const strEvent = String(event || '').toLowerCase();
            if (isInternalAlertEvent(strEvent)) return;
            const strMsg = String(fields?.message || fields?.error || '').toLowerCase();
            const source = this._resolveLogSource(strEvent, strMsg, fields?.source);
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

      const originalWarn = logger.warn;
      if (typeof originalWarn === 'function') {
        logger.warn = (event, fields = {}) => {
          originalWarn(event, fields);
          try {
            const strEvent = String(event || '').toLowerCase();
            if (isInternalAlertEvent(strEvent)) return;
            const strMsg = String(fields?.message || fields?.error || '').toLowerCase();
            // Forward infrastructure / database / discord / manager system warnings (exclude ordinary Minecraft gameplay events)
            const isInfraWarning = /supabase|postgrest|pgrst|database|db_|rpc_|outbox|state_sync|discord|wispbyte|link4m|worker_registration_lost|worker_system/i.test(`${strEvent} ${strMsg}`);
            const isMinecraftNoise = /minecraft_|totem|food|lobby|window|chunk|kick|banned|ip_limited/i.test(`${strEvent} ${strMsg}`);
            if (!isInfraWarning || isMinecraftNoise) return;
            const source = this._resolveLogSource(strEvent, strMsg, fields?.source);
            const message = fields?.message || fields?.reason || fields?.error || String(event);
            void this.sendAlert({
              source,
              event: String(event),
              message: String(message),
              details: fields,
              level: 'warn'
            });
          } catch (_) {}
        };
      }
    } catch (_) {}
  }
}

module.exports = { AdminNotifier, escapeTelegramHtml, redactSensitiveText, redactSensitiveObject };
