'use strict';

const { uptimeText } = require('./panels/renderer');

async function collectSystemStatus(services) {
  // 1. Worker fleet statistics
  let allWorkers = [];
  try {
    if (services?.registry?.list) {
      allWorkers = await services.registry.list();
    }
  } catch (_) {
    allWorkers = [];
  }

  let onlineWorkers = 0;
  for (const w of allWorkers) {
    const rawState = String(w?.status?.state || (w?.status?.online ? 'online' : 'offline')).toLowerCase();
    const isAfkState = rawState === 'afk' || rawState === 'afk_locked';
    if (w?.status?.online || rawState === 'online' || isAfkState) {
      onlineWorkers++;
    }
  }
  const totalWorkers = allWorkers.length;
  const offlineWorkers = Math.max(0, totalWorkers - onlineWorkers);

  // 2. Database connection & latency probe
  let dbOk = false;
  let dbLatencyMs = -1;
  const store = services?.accessStore?.adapter ? services.accessStore : (services?.store || services?.supabaseClient);
  if (store?.adapter && typeof store.adapter.testConnection === 'function') {
    const start = Date.now();
    try {
      const testRes = await store.adapter.testConnection();
      dbOk = Boolean(testRes?.ok !== false);
      dbLatencyMs = Date.now() - start;
    } catch (_) {
      dbOk = false;
      dbLatencyMs = Date.now() - start;
    }
  } else if (typeof store?.testConnection === 'function') {
    const start = Date.now();
    try {
      const testRes = await store.testConnection();
      dbOk = Boolean(testRes?.ok !== false);
      dbLatencyMs = Date.now() - start;
    } catch (_) {
      dbOk = false;
      dbLatencyMs = Date.now() - start;
    }
  } else {
    dbOk = Boolean(store);
    dbLatencyMs = 0;
  }

  // 3. Discord Gateway client
  const client = services?.discordClient || services?.client;
  const discordReady = Boolean(client?.isReady?.());
  const discordPing = (typeof client?.ws?.ping === 'number' && client.ws.ping >= 0)
    ? Math.round(client.ws.ping)
    : -1;

  // 4. Host process memory & uptime
  const uptimeSec = process.uptime();
  const uptimeFormatted = uptimeText(uptimeSec);
  const mem = process.memoryUsage();
  const rssMb = Math.round(mem.rss / (1024 * 1024));
  const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));
  const platform = process.platform;
  const nodeVersion = process.version;

  // 5. Public Web Dashboard URL
  const publicBaseUrl = services?.config?.publicBaseUrl || '';

  return {
    totalWorkers,
    onlineWorkers,
    offlineWorkers,
    dbOk,
    dbLatencyMs,
    discordReady,
    discordPing,
    uptimeSec,
    uptimeFormatted,
    rssMb,
    heapUsedMb,
    platform,
    nodeVersion,
    publicBaseUrl
  };
}

class StatusMonitorService {
  constructor({ services, intervalMs = 15 * 60 * 1000 } = {}) {
    this.services = services;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.tracked = null;
    this.isUpdating = false;
  }

  async start() {
    await this.loadTrackedMessage();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.updateMessage().catch((err) => {
        this.services?.logger?.warn?.('status_monitor_periodic_update_failed', { error: err.message });
      });
    }, this.intervalMs);
    if (typeof this.timer?.unref === 'function') {
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async loadTrackedMessage() {
    try {
      const stored = await this.services?.accessStore?.getSetting?.('discord_status_monitor');
      if (stored?.channelId && stored?.messageId) {
        this.tracked = {
          guildId: stored.guildId || null,
          channelId: stored.channelId,
          messageId: stored.messageId
        };
      }
    } catch (_) {}
  }

  setTrackedMessage(tracked) {
    this.tracked = tracked;
  }

  getTrackedMessage() {
    return this.tracked;
  }

  async updateMessage() {
    if (this.isUpdating) return;
    this.isUpdating = true;
    try {
      if (!this.tracked?.channelId || !this.tracked?.messageId) {
        await this.loadTrackedMessage();
      }
      if (!this.tracked?.channelId || !this.tracked?.messageId) {
        return;
      }

      const client = this.services?.discordClient || this.services?.client;
      if (!client || !client.isReady?.()) return;

      const channel = await client.channels.fetch(this.tracked.channelId).catch(() => null);
      if (!channel || typeof channel.messages?.fetch !== 'function') return;

      const message = await channel.messages.fetch(this.tracked.messageId).catch(() => null);
      if (!message || typeof message.edit !== 'function') return;

      const statusData = await collectSystemStatus(this.services);
      const { renderStatusMonitorPanel } = require('./panels/renderer');
      const view = renderStatusMonitorPanel(statusData);

      await message.edit({
        embeds: view.embeds,
        components: view.components,
        allowedMentions: { parse: [] }
      });
    } catch (err) {
      this.services?.logger?.warn?.('status_monitor_update_error', { error: err.message });
    } finally {
      this.isUpdating = false;
    }
  }
}

module.exports = {
  collectSystemStatus,
  StatusMonitorService
};
