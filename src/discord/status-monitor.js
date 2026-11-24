'use strict';

const { uptimeText } = require('./panels/renderer');

async function collectSystemStatus(services, { intervalMs = 15 * 60 * 1000 } = {}) {
  // 1. Worker Online/Offline statistics
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

  // 2. User subscription statistics (active vs expired)
  let totalUsers = 0;
  let activeUsers = 0;
  let expiredUsers = 0;
  let permanentUsers = 0;
  let disabledUsers = 0;
  const userStore = services?.accessStore?.listAccess ? services.accessStore : services?.store;
  if (typeof userStore?.listAccess === 'function') {
    try {
      const users = await userStore.listAccess();
      const nowMs = Date.now();
      if (Array.isArray(users)) {
        for (const u of users) {
          if (!u) continue;
          const role = String(u.role || 'user').trim().toLowerCase();
          const uname = String(u.username || '').trim().toLowerCase();
          if (role === 'admin' || uname === 'admin') continue;
          totalUsers++;
          const st = String(u.status || 'active').trim().toLowerCase();
          if (st === 'disabled') {
            disabledUsers++;
            continue;
          }
          if (u.isPermanent === true) {
            permanentUsers++;
            activeUsers++;
            continue;
          }
          const expMs = u.expiresAt ? Date.parse(u.expiresAt) : NaN;
          if (st === 'expired' || st === 'grace_period' || (Number.isFinite(expMs) && expMs <= nowMs)) {
            expiredUsers++;
          } else if (Number.isFinite(expMs) && expMs > nowMs) {
            activeUsers++;
          }
        }
      }
    } catch (_) {}
  }

  // 3. Database connection & latency probe
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

  // 4. Discord Gateway client
  const client = services?.discordClient || services?.client;
  const discordReady = Boolean(client?.isReady?.());
  const discordPing = (typeof client?.ws?.ping === 'number' && client.ws.ping >= 0)
    ? Math.round(client.ws.ping)
    : -1;

  // 5. Host process memory & uptime
  const uptimeSec = process.uptime();
  const uptimeFormatted = uptimeText(uptimeSec);
  const mem = process.memoryUsage();
  const rssMb = Math.round(mem.rss / (1024 * 1024));
  const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));
  const platform = process.platform;
  const nodeVersion = process.version;

  // 6. Check timestamps & schedule metadata
  const checkedAtMs = Date.now();
  const checkedAt = new Date(checkedAtMs).toISOString();
  const checkedAtUnix = Math.floor(checkedAtMs / 1000);
  const intervalSec = Math.max(60, Math.round((Number(intervalMs) || (15 * 60 * 1000)) / 1000));
  const nextCheckAtUnix = checkedAtUnix + intervalSec;
  const intervalMinutes = Math.max(1, Math.round(intervalSec / 60));

  // 7. Public Web Dashboard URL
  const publicBaseUrl = services?.managerRuntimeSettings?.snapshot?.()?.publicBaseUrl || services?.config?.publicBaseUrl || '';

  return {
    managerOk: true,
    totalWorkers,
    onlineWorkers,
    offlineWorkers,
    totalUsers,
    activeUsers,
    expiredUsers,
    permanentUsers,
    disabledUsers,
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
    publicBaseUrl,
    checkedAt,
    checkedAtMs,
    checkedAtUnix,
    nextCheckAtUnix,
    intervalMinutes
  };
}

class StatusMonitorService {
  constructor({ services, intervalMs = 15 * 60 * 1000 } = {}) {
    this.services = services;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.tracked = null;
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
      this.updateMessage().catch((err) => {
        this.services?.logger?.warn?.('status_monitor_periodic_update_failed', { error: err.message });
      });
    }, this.intervalMs);
    if (typeof this.timer?.unref === 'function') {
      this.timer.unref();
    }
  }

  async start() {
    this.stopped = false;
    await this.loadTrackedMessage();
    if (this.stopped) return;
    this.ensureScheduled();
    if (this.tracked?.channelId && this.tracked?.messageId) {
      void this.updateMessage().catch((err) => {
        this.services?.logger?.warn?.('status_monitor_initial_update_failed', { error: err.message });
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

  async loadTrackedMessage() {
    try {
      const stored = await this.services?.accessStore?.getSetting?.('discord_status_monitor');
      if (stored?.channelId && stored?.messageId) {
        this.tracked = {
          guildId: stored.guildId || null,
          channelId: stored.channelId,
          messageId: stored.messageId,
          ...(stored.updatedAt ? { updatedAt: stored.updatedAt } : {})
        };
      }
    } catch (_) {}
  }

  setTrackedMessage(tracked) {
    this.tracked = tracked || null;
    if (this.tracked?.channelId && this.tracked?.messageId) {
      this.ensureScheduled();
    }
  }

  getTrackedMessage() {
    return this.tracked;
  }

  async updateMessage() {
    if (this.isUpdating || this.stopped) return;
    this.isUpdating = true;
    try {
      if (!this.tracked?.channelId || !this.tracked?.messageId) {
        await this.loadTrackedMessage();
      }
      if (!this.tracked?.channelId || !this.tracked?.messageId || this.stopped) {
        return;
      }

      const client = this.services?.discordClient || this.services?.client;
      if (!client || !client.isReady?.()) return;

      const channel = await client.channels.fetch(this.tracked.channelId);
      if (!channel || this.stopped) {
        if (!channel) {
          this.tracked = null;
        }
        return;
      }

      const statusData = await collectSystemStatus(this.services, { intervalMs: this.intervalMs });
      const { renderStatusMonitorPanel } = require('./panels/renderer');
      const view = renderStatusMonitorPanel(statusData);
      const payload = {
        embeds: view.embeds,
        components: view.components,
        allowedMentions: { parse: [] }
      };

      let edited = false;
      if (typeof channel.messages?.edit === 'function') {
        await channel.messages.edit(this.tracked.messageId, payload);
        edited = true;
      } else if (typeof channel.messages?.fetch === 'function') {
        const message = await channel.messages.fetch(this.tracked.messageId);
        if (!message || typeof message.edit !== 'function') {
          this.tracked = null;
          return;
        }
        await message.edit(payload);
        edited = true;
      }

      if (edited && this.tracked) {
        this.tracked = { ...this.tracked, updatedAt: statusData.checkedAt };
        await this.services?.accessStore?.setSetting?.('discord_status_monitor', this.tracked).catch(() => null);
      }
    } catch (err) {
      const code = err?.code ?? err?.rawError?.code;
      if (code === 10008 || code === 10003 || Number(err?.status) === 404) {
        this.services?.logger?.warn?.('status_monitor_target_missing_cleared', {
          code,
          channelId: this.tracked?.channelId || null,
          messageId: this.tracked?.messageId || null,
          error: err.message
        });
        this.tracked = null;
      } else {
        this.services?.logger?.warn?.('status_monitor_update_error', { error: err.message });
      }
    } finally {
      this.isUpdating = false;
    }
  }
}

module.exports = {
  collectSystemStatus,
  StatusMonitorService
};
