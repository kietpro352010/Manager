'use strict';

const { EmbedBuilder } = require('discord.js');

class AdminNotifier {
  constructor({ client, adminUserId = '', logger } = {}) {
    this.client = client;
    this.adminUserId = String(adminUserId || '').trim();
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

  /**
   * Send an error or warning alert directly to the designated admin via Discord DM.
   *
   * @param {Object} params
   * @param {string} params.source - Source system: 'Supabase', 'Worker', 'Manager', 'Discord', 'Wispbyte', 'Link4M'
   * @param {string} params.event - Event / Error identifier (e.g. 'worker_error', 'database_failure')
   * @param {string} params.message - Short human-readable summary of the error
   * @param {Error|string} [params.error] - Original error object or stack string
   * @param {Object} [params.details] - Additional contextual fields (workerId, command, user, etc.)
   * @param {'error'|'warn'|'info'} [params.level] - Severity level
   */
  async sendAlert({ source = 'Manager', event = 'error', message = '', error = null, details = {}, level = 'error' } = {}) {
    if (!this.adminUserId || !this.client) return;

    // Filter out in-game kicks, bans, and temporary server restrictions (Only report SYSTEM errors)
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

    // Deduplication check
    const dedupKey = `${source}:${event}:${details.workerId || details.id || ''}:${message.slice(0, 80)}`;
    const now = Date.now();
    const cached = this.alertCache.get(dedupKey);

    if (cached && now - cached.lastSent < this.cooldownMs) {
      cached.suppressedCount = (cached.suppressedCount || 0) + 1;
      return;
    }

    const repeatNote = cached?.suppressedCount ? `\n*(Lỗi tương tự đã lặp lại ${cached.suppressedCount} lần trong 60s qua)*` : '';
    this.alertCache.set(dedupKey, { lastSent: now, suppressedCount: 0 });

    // Clean up old cache entries periodically
    if (this.alertCache.size > 200) {
      for (const [k, v] of this.alertCache.entries()) {
        if (now - v.lastSent > this.cooldownMs * 3) this.alertCache.delete(k);
      }
    }

    const item = { source, event, message: `${message}${repeatNote}`, error, details, level };
    this.queue.push(item);
    void this.processQueue();
  }

  async processQueue() {
    if (this.isSending || this.queue.length === 0) return;
    this.isSending = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        await this.dispatchDm(item).catch(() => {});
        // Safe spacing between DMs to respect Discord rate limits
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
      if (!user) {
        this.logger?.warn?.('admin_dm_user_not_found', { adminUserId: this.adminUserId });
        return;
      }

      const now = new Date();
      const timeStr = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const unix = Math.floor(now.getTime() / 1000);

      const color = level === 'error' ? 0xef4444 : level === 'warn' ? 0xf59e0b : 0x3b82f6;
      const icon = level === 'error' ? '🚨' : level === 'warn' ? '⚠️' : 'ℹ️';

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${icon} [BÁO LỖI: ${source.toUpperCase()}] ${event}`)
        .setDescription(message ? `**Nội dung:** ${message.slice(0, 1000)}` : 'Đã phát hiện sự cố hệ thống.')
        .setTimestamp();

      const fields = [
        { name: '📍 Nguồn / Hệ thống', value: `\`${source}\``, inline: true },
        { name: '⏰ Thời gian xảy ra', value: `${timeStr}\n(<t:${unix}:R>)`, inline: true },
        { name: '🏷️ Phân loại sự kiện', value: `\`${event}\``, inline: true }
      ];

      // Format details
      if (details && typeof details === 'object' && Object.keys(details).length > 0) {
        const detailLines = [];
        for (const [k, v] of Object.entries(details)) {
          if (v !== undefined && v !== null && v !== '') {
            detailLines.push(`• **${k}:** \`${String(v).slice(0, 120)}\``);
          }
        }
        if (detailLines.length > 0) {
          fields.push({
            name: '🔍 Ngữ cảnh & Thông số',
            value: detailLines.slice(0, 8).join('\n').slice(0, 1024),
            inline: false
          });
        }
      }

      // Format error stack / details
      let stackText = '';
      if (error) {
        if (typeof error === 'string') stackText = error;
        else if (error.stack) stackText = error.stack;
        else if (error.message) stackText = error.message;
      }

      if (stackText) {
        // Redact potential secrets or long tokens
        const safeStack = stackText.replace(/(?:token|secret|password|key)=([^\s&]+)/gi, '$1=[REDACTED]');
        fields.push({
          name: '📄 Chi tiết lỗi kỹ thuật',
          value: `\`\`\`js\n${safeStack.slice(0, 950)}\n\`\`\``,
          inline: false
        });
      }

      embed.addFields(fields);
      embed.setFooter({ text: 'KingMC AFK System Monitor • Báo lỗi tự động qua DM' });

      await user.send({ embeds: [embed] });
    } catch (err) {
      // Avoid logging loop if DM fails
      if (err.code !== 50007) { // 50007: Cannot send messages to this user (DMs disabled)
        this.logger?.warn?.('admin_dm_dispatch_failed', { adminUserId: this.adminUserId, error: err.message });
      }
    }
  }

  /**
   * Attach an error listener to the application logger so any logger.error() calls
   * automatically dispatch a DM alert to the admin.
   */
  hookLogger(logger) {
    if (!logger || typeof logger !== 'object') return;
    try {
      const originalError = logger.error;
      if (typeof originalError === 'function') {
        logger.error = (event, fields = {}) => {
          originalError(event, fields);
          // Dispatch alert without awaiting or crashing
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
