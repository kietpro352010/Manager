'use strict';

const {
  renderPointsLeaderboard,
  renderCombinedPointsLeaderboard
} = require('./panels/points-renderer');

const DEFAULT_BXH_INTERVAL_MS = 15 * 60 * 1000;
const BXH_MONITOR_SETTING_KEY = 'discord_bxh_monitor';
const MAX_TRACKED_BXH_MESSAGES = 5;
const VALID_BXH_TYPES = new Set(['tatca', 'diem', 'chuoi', 'tinnhan']);

function normalizeBxhType(type) {
  const clean = String(type || 'tatca').trim().toLowerCase();
  return VALID_BXH_TYPES.has(clean) ? clean : 'tatca';
}

function normalizeBxhLimit(limit) {
  const parsed = Math.floor(Number(limit) || 10);
  return Math.max(5, Math.min(20, parsed));
}

function normalizeTrackedEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const channelId = String(raw.channelId || '').trim();
  const messageId = String(raw.messageId || '').trim();
  if (!channelId || !messageId) return null;
  return {
    guildId: raw.guildId ? String(raw.guildId).trim() : null,
    guildName: raw.guildName ? String(raw.guildName).trim() : 'Server',
    channelId,
    messageId,
    type: normalizeBxhType(raw.type),
    limit: normalizeBxhLimit(raw.limit),
    updatedAt: raw.updatedAt || null
  };
}

async function buildBxhPanel(services, {
  guildId = null,
  guildName = 'Server',
  type = 'tatca',
  limit = 10,
  viewerUserId = null,
  updatedAtMs = Date.now(),
  intervalMs = DEFAULT_BXH_INTERVAL_MS,
  hasViewer = Boolean(viewerUserId)
} = {}) {
  const pointsService = services?.discordPoints;
  if (!pointsService) {
    throw new Error('Hệ thống điểm tích lũy chưa được khởi tạo.');
  }
  const safeType = normalizeBxhType(type);
  const safeLimit = normalizeBxhLimit(limit);

  if (safeType === 'tatca') {
    const combined = await pointsService.getCombinedLeaderboards({
      guildId,
      limit: safeLimit,
      viewerUserId
    });
    const panel = renderCombinedPointsLeaderboard({
      guildName,
      combined,
      updatedAtMs,
      intervalMs,
      hasViewer
    });
    return { ...panel, type: safeType, limit: safeLimit, updatedAtMs, intervalMs };
  }

  const leaderboard = await pointsService.getLeaderboard({
    guildId,
    type: safeType,
    limit: safeLimit,
    viewerUserId
  });
  const panel = renderPointsLeaderboard({
    guildName,
    leaderboard,
    updatedAtMs,
    intervalMs,
    hasViewer
  });
  return { ...panel, type: safeType, limit: safeLimit, updatedAtMs, intervalMs };
}

class BxhMonitorService {
  constructor({
    services,
    intervalMs = DEFAULT_BXH_INTERVAL_MS,
    maxTracked = MAX_TRACKED_BXH_MESSAGES
  } = {}) {
    this.services = services;
    this.intervalMs = Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_BXH_INTERVAL_MS;
    this.maxTracked = Math.max(1, Math.min(20, Math.floor(Number(maxTracked) || MAX_TRACKED_BXH_MESSAGES)));
    this.timer = null;
    this.trackedList = [];
    this.isUpdating = false;
    this.stopped = false;
  }

  ensureScheduled() {
    this.stopped = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.timer = setInterval(() => {
      if (this.stopped) return;
      this.updateAllMessages().catch((err) => {
        this.services?.logger?.warn?.('bxh_monitor_periodic_update_failed', { error: err.message });
      });
    }, this.intervalMs);
    if (typeof this.timer?.unref === 'function') {
      this.timer.unref();
    }
  }

  async start() {
    this.stopped = false;
    await this.loadTrackedMessages();
    if (this.stopped) return;
    this.ensureScheduled();
    if (this.trackedList.length > 0) {
      void this.updateAllMessages().catch((err) => {
        this.services?.logger?.warn?.('bxh_monitor_initial_update_failed', { error: err.message });
      });
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async loadTrackedMessages() {
    try {
      const stored = await this.services?.accessStore?.getSetting?.(BXH_MONITOR_SETTING_KEY);
      const rawEntries = Array.isArray(stored?.entries)
        ? stored.entries
        : (stored && typeof stored === 'object' && stored.channelId ? [stored] : []);
      const deduped = new Map();
      for (const item of rawEntries) {
        const clean = normalizeTrackedEntry(item);
        if (clean) {
          deduped.delete(clean.channelId);
          deduped.set(clean.channelId, clean);
        }
      }
      const list = Array.from(deduped.values());
      this.trackedList = list.length > this.maxTracked ? list.slice(list.length - this.maxTracked) : list;
    } catch (_) {}
  }

  async saveTrackedMessages() {
    if (!this.services?.accessStore?.setSetting) return;
    await this.services.accessStore.setSetting(BXH_MONITOR_SETTING_KEY, {
      entries: this.trackedList,
      updatedAt: new Date().toISOString()
    }).catch(() => null);
  }

  async trackMessage(entry) {
    const clean = normalizeTrackedEntry(entry);
    if (!clean) return null;
    const filtered = this.trackedList.filter((item) => item.channelId !== clean.channelId);
    filtered.push(clean);
    if (filtered.length > this.maxTracked) {
      filtered.splice(0, filtered.length - this.maxTracked);
    }
    this.trackedList = filtered;
    this.ensureScheduled();
    await this.saveTrackedMessages();
    return clean;
  }

  setTrackedMessage(entry) {
    return this.trackMessage(entry);
  }

  getTrackedMessage(channelId = null) {
    if (channelId) {
      const cleanId = String(channelId).trim();
      return this.trackedList.find((item) => item.channelId === cleanId) || null;
    }
    return this.trackedList.length > 0 ? this.trackedList[this.trackedList.length - 1] : null;
  }

  getTrackedMessages() {
    return [...this.trackedList];
  }

  async updateMessage() {
    return this.updateAllMessages();
  }

  async updateAllMessages() {
    if (this.isUpdating || this.stopped) return;
    this.isUpdating = true;
    try {
      if (this.trackedList.length === 0) {
        await this.loadTrackedMessages();
      }
      if (this.trackedList.length === 0 || this.stopped) return;

      const client = this.services?.discordClient || this.services?.client;
      if (!client || !client.isReady?.()) return;
      if (!this.services?.discordPoints) return;

      const nextList = [];
      let changed = false;

      for (const item of [...this.trackedList]) {
        if (this.stopped) {
          nextList.push(item);
          continue;
        }
        try {
          const channel = await client.channels.fetch(item.channelId);
          if (!channel) {
            changed = true;
            continue;
          }
          const resolvedGuildName = channel.guild?.name || item.guildName || 'Server';
          const view = await buildBxhPanel(this.services, {
            guildId: item.guildId || channel.guild?.id || null,
            guildName: resolvedGuildName,
            type: item.type,
            limit: item.limit,
            viewerUserId: null,
            updatedAtMs: Date.now(),
            intervalMs: this.intervalMs,
            hasViewer: false
          });
          const payload = {
            embeds: view.embeds,
            components: view.components,
            allowedMentions: { parse: [] }
          };

          let edited = false;
          if (typeof channel.messages?.edit === 'function') {
            await channel.messages.edit(item.messageId, payload);
            edited = true;
          } else if (typeof channel.messages?.fetch === 'function') {
            const message = await channel.messages.fetch(item.messageId);
            if (!message || typeof message.edit !== 'function') {
              changed = true;
              continue;
            }
            await message.edit(payload);
            edited = true;
          }

          if (edited) {
            changed = true;
            nextList.push({
              ...item,
              guildName: resolvedGuildName,
              updatedAt: new Date(view.updatedAtMs).toISOString()
            });
          } else {
            nextList.push(item);
          }
        } catch (err) {
          const code = err?.code ?? err?.rawError?.code;
          if (code === 10008 || code === 10003 || Number(err?.status) === 404) {
            this.services?.logger?.warn?.('bxh_monitor_target_missing_cleared', {
              code,
              channelId: item.channelId,
              messageId: item.messageId,
              error: err.message
            });
            changed = true;
          } else {
            this.services?.logger?.warn?.('bxh_monitor_update_error', {
              channelId: item.channelId,
              messageId: item.messageId,
              error: err.message
            });
            nextList.push(item);
          }
        }
      }

      if (changed) {
        this.trackedList = nextList;
        await this.saveTrackedMessages();
      }
    } finally {
      this.isUpdating = false;
    }
  }
}

module.exports = {
  DEFAULT_BXH_INTERVAL_MS,
  BXH_MONITOR_SETTING_KEY,
  MAX_TRACKED_BXH_MESSAGES,
  normalizeBxhType,
  normalizeBxhLimit,
  buildBxhPanel,
  BxhMonitorService
};
