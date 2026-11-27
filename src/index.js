'use strict';

require('dotenv').config();

// Kích hoạt V8 Garbage Collection nội bộ (Trụ cột 1.1)
const v8 = require('node:v8');
const vm = require('node:vm');
try {
  v8.setFlagsFromString('--expose_gc');
  if (typeof global.gc !== 'function') {
    global.gc = vm.runInNewContext('gc');
  }
} catch (_) {}

function runGarbageCollection() {
  if (typeof global.gc === 'function') {
    try {
      global.gc();
      return true;
    } catch (_) {}
  }
  return false;
}

const http = require('node:http');
const crypto = require('node:crypto');
const { Client, GatewayIntentBits, Events, Options } = require('discord.js');
const { loadConfig } = require('./config/env');
const { detectHostPlatformAndPort, detectHostRuntime, listenHttpServer } = require('./config/host-runtime');
const { createLogger } = require('./utils/logger');
const { configureGlobalHttpDispatcher, closeGlobalHttpDispatcher } = require('./utils/http');

const SupabaseWorkerStore = require('./storage/supabase-worker-store');
const SupabaseDashboardStore = require('./storage/supabase-dashboard-store');
const SupabaseCommandStore = require('./storage/supabase-command-store');
const { createSupabaseClient } = require('./storage/supabase-client');

const RenderApi = require('./services/render-api');
const { AccessControl } = require('./services/access-control');
const AsyncKeyLock = require('./services/async-key-lock');
const { WorkerRegistry } = require('./services/worker-registry');
const CommandBroker = require('./services/command-broker');
const FleetOperations = require('./services/fleet-operations');
const { EntitlementService } = require('./services/entitlement-service');
const { Link4mService } = require('./services/link4m-service');
const { ManagerRuntimeSettings } = require('./services/manager-runtime-settings');
const WispbyteKeepAliveManager = require('./services/wispbyte-keepalive');
const { AdminNotifier } = require('./services/admin-notifier');
const { StatusMonitorService } = require('./discord/status-monitor');
const { DiscordPointsService } = require('./services/discord-points-service');

const { createApp } = require('./http/app');
const { attachInteractionHandler } = require('./discord/handlers/interaction-handler');
const { attachMessagePointsHandler } = require('./discord/handlers/points-message-handler');
const { registerCommands } = require('./discord/register-commands');

async function main() {
  configureGlobalHttpDispatcher();
  const config = loadConfig();
  const hostDetector = typeof detectHostPlatformAndPort === 'function' ? detectHostPlatformAndPort : detectHostRuntime;
  const hostPlatform = typeof hostDetector === 'function' ? hostDetector() : { port: config.port, platform: config.platform };
  const logger = createLogger(config.logLevel);

  // 1. Storage & Database Setup
  const supabase = createSupabaseClient({ url: config.supabaseUrl, secretKey: config.supabaseSecretKey });
  const store = new SupabaseWorkerStore(supabase, {
    cacheTtlMs: Number(process.env.WORKER_STORE_CACHE_TTL_MS) || 5000
  });
  const accessStore = new SupabaseDashboardStore(supabase);
  const commandStore = new SupabaseCommandStore(supabase);

  await store.initialize();
  await accessStore.initialize();
  await commandStore.initialize();
  const initialCommandSyncHealth = typeof commandStore.health === 'function' ? commandStore.health() : null;
  if (initialCommandSyncHealth?.degraded) {
    logger.error('command_reset_atomic_rpc_missing', {
      missingRpcs: initialCommandSyncHealth.missingRpcs,
      error: initialCommandSyncHealth.error,
      message: initialCommandSyncHealth.message
    });
  }

  // 2. Dynamic Runtime Settings
  const managerRuntimeSettings = new ManagerRuntimeSettings({
    store: accessStore,
    encryptionKey: config.encryptionKey,
    previousEncryptionKey: config.previousEncryptionKey,
    initial: {
      publicBaseUrl: config.publicBaseUrl,
      managerUrls: config.managerUrls,
      renderApiKey: config.renderApiKey,
      link4mApiToken: config.link4mApiToken,
      link4mSecretKey: config.link4mSecretKey
    }
  });
  const integrationSettings = await managerRuntimeSettings.initialize();
  managerRuntimeSettings.startHeartbeat?.();

  // 3. Discord Access Control & Setup
  let roleSettings = await accessStore.getSetting('discord_access');
  if (roleSettings?.guildId && config.discordGuildId && roleSettings.guildId !== config.discordGuildId) {
    logger.warn('discord_guild_mismatch', { configGuild: config.discordGuildId, storedGuild: roleSettings.guildId });
  }

  let adminRoleId = roleSettings?.adminRoleId || config.adminRoleId;
  let userRoleId = roleSettings?.userRoleId || config.userRoleId;
  let adminUserId = config.adminUserId || roleSettings?.adminUserId || '';

  const accessControl = new AccessControl({ store: accessStore, adminUserId });
  if (adminRoleId && userRoleId) {
    accessControl.setRoleIds(adminRoleId, userRoleId);
    if (!roleSettings?.guildId || !roleSettings?.adminRoleId || !roleSettings?.userRoleId) {
      roleSettings = {
        ...(roleSettings && typeof roleSettings === 'object' ? roleSettings : {}),
        guildId: roleSettings?.guildId || config.discordGuildId,
        adminRoleId,
        userRoleId,
        ...(adminUserId ? { adminUserId } : {}),
        configuredBy: roleSettings?.configuredBy || 'environment-compat'
      };
      await accessStore.setSetting('discord_access', roleSettings);
    }
  } else if (adminRoleId || userRoleId) {
    logger.warn('discord_roles_partial_config', {
      hasAdminRoleId: Boolean(adminRoleId),
      hasUserRoleId: Boolean(userRoleId)
    });
  }

  // 4. Discord Client & Admin Notifier (bounded caches + periodic sweepers for 384MB container stability)
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    makeCache: typeof Options?.cacheWithLimits === 'function'
      ? Options.cacheWithLimits({
          ...Options.DefaultMakeCacheSettings,
          MessageManager: 10,
          PresenceManager: 0,
          ReactionManager: 0,
          VoiceStateManager: 0,
          StageInstanceManager: 0,
          GuildScheduledEventManager: 0,
          AutoModerationRuleManager: 0,
          GuildStickerManager: 0,
          BaseGuildEmojiManager: 25,
          ThreadManager: 10,
          UserManager: 200,
          GuildMemberManager: {
            maxSize: 200,
            keepOverLimit: (member) => member.id === member.client?.user?.id
          }
        })
      : undefined,
    sweepers: Options?.DefaultSweeperSettings
      ? {
          ...Options.DefaultSweeperSettings,
          messages: { interval: 900, lifetime: 900 },
          users: {
            interval: 1800,
            filter: () => (user) => user.id !== user.client?.user?.id && !user.bot
          },
          threads: { interval: 1800, lifetime: 3600 }
        }
      : undefined
  });
  if (config.discordToken && config.discordEnabled !== false) {
    try {
      client.rest?.setToken?.(config.discordToken);
    } catch (_) {}
  }
  const adminNotifier = new AdminNotifier({
    client,
    store: accessStore,
    adminUserId: roleSettings?.adminUserId || config.adminUserId,
    telegramBotToken: config.telegramBotToken,
    telegramChatId: config.telegramChatId,
    encryptionKey: config.encryptionKey,
    logger
  });
  adminNotifier.hookLogger(logger);

  const runtimeConfig = {
    ...config,
    port: hostPlatform.port,
    platform: hostPlatform.platform,
    adminRoleId: accessControl.adminRoleId,
    userRoleId: accessControl.userRoleId,
    adminUserId: adminNotifier.getAdminUserId(),
    publicBaseUrl: integrationSettings.publicBaseUrl,
    renderApiKey: integrationSettings.renderApiKey,
    link4mApiToken: integrationSettings.link4mApiToken || config.link4mApiToken || '',
    link4mSecretKey: integrationSettings.link4mSecretKey || config.link4mSecretKey || '',
    link4mMode: integrationSettings.link4mMode || 'api',
    link4mUrl: integrationSettings.link4mUrl || ''
  };

  const userLock = new AsyncKeyLock();
  const renderApi = new RenderApi({ apiKey: integrationSettings.renderApiKey, baseUrl: config.renderApiBaseUrl });
  const registry = new WorkerRegistry({ store, accessStore, encryptionKey: config.encryptionKey, renderApi, adminNotifier });
  await registry.load();

  const savedAdminCreds = await accessStore.getSetting('admin_credentials');
  if (savedAdminCreds?.passwordHash && typeof registry.setAdminPassword === 'function') {
    registry.setAdminPassword(savedAdminCreds.passwordHash);
  }
  const savedAnnouncement = await accessStore.getSetting('system_announcement');
  if (savedAnnouncement) {
    accessStore.cachedAnnouncement = (typeof savedAnnouncement === 'object')
      ? savedAnnouncement
      : { enabled: Boolean(savedAnnouncement), content: String(savedAnnouncement), title: '', mode: 'banner' };
    accessStore.cachedAnnouncementAt = Date.now();
  }
  const savedWebhook = await accessStore.getSetting('webhook_settings').catch(() => null);
  if (savedWebhook && typeof savedWebhook === 'object' && typeof adminNotifier.configureWebhook === 'function') {
    adminNotifier.configureWebhook(savedWebhook);
  }

  const broker = new CommandBroker({ registry, commandStore, managerRuntimeSettings, config: runtimeConfig, logger });
  const fleetOperations = new FleetOperations({ registry, broker, renderApi, logger });
  const entitlementService = new EntitlementService({
    store: accessStore,
    registry,
    accessControl,
    userLock,
    logger,
    config: runtimeConfig
  });
  const link4mService = new Link4mService({ store: accessStore, accessControl, userLock, config: runtimeConfig, logger });
  await link4mService.initialize().catch((err) => {
    logger?.error?.('link4m_initialization_failed', {
      degraded: true,
      error: err?.message || String(err)
    });
  });
  const wispbyteKeepAlive = new WispbyteKeepAliveManager({ store: accessStore, config: runtimeConfig, logger, adminNotifier });
  const discordPointsService = new DiscordPointsService({ store: accessStore, logger });
  await discordPointsService.initialize().catch((err) => {
    logger?.warn?.('discord_points_init_failed', { error: err?.message || String(err) });
  });

  // Start background workers (optimized intervals to reduce idle Supabase/Render usage)
  broker.startOutboxProcessor({ intervalMs: Number(process.env.OUTBOX_POLL_INTERVAL_MS) || 30000 });
  let isDiscordStandbyInstance = () => false;

  // Định kỳ kiểm tra khách hết hạn và dừng bot êm ái (Graceful Expire Stop)
  const expiredCheckInterval = setInterval(async () => {
    if (isDiscordStandbyInstance()) return;
    try {
      await entitlementService.checkExpiredUsersAndGracefulStop({ broker, fleetOperations });
    } catch (err) {
      logger.warn('expired_users_check_failed', { error: err.message });
    }
  }, 180000);
  expiredCheckInterval.unref();

  // 5. Adaptive Memory Sweeper (Trụ cột 1.1: so sánh theo V8 heap_size_limit, tránh GC liên tục khi heap idle nhỏ)
  const ramThresholdMb = config.ramWarningMb || config.rssWarningThresholdMb || 280;
  const managerHeapLimitMb = Math.max(256, Math.round((v8.getHeapStatistics()?.heap_size_limit || 0) / (1024 * 1024)) || 512);
  const managerHeapThresholdMb = Math.max(128, Math.round(managerHeapLimitMb * 0.7));
  const managerEmergencyHeapMb = Math.round(managerHeapLimitMb * 0.85);
  let lastManagerGcAt = 0;
  const memorySweepInterval = setInterval(() => {
    const memory = process.memoryUsage();
    const rssMb = Math.round(memory.rss / (1024 * 1024));
    const heapUsedMb = Math.round(memory.heapUsed / (1024 * 1024));
    const heapTotalMb = Math.round(memory.heapTotal / (1024 * 1024));

    if (rssMb > ramThresholdMb || heapUsedMb > managerHeapThresholdMb) {
      registry.pruneStaleMemory();
      const now = Date.now();
      const shouldGc = now - lastManagerGcAt >= 180000 || heapUsedMb > managerEmergencyHeapMb || rssMb >= 380;
      const collected = shouldGc
        ? (() => { lastManagerGcAt = now; return runGarbageCollection(); })()
        : false;
      if (collected || rssMb > ramThresholdMb) {
        logger.info('adaptive_memory_sweep', {
          rssMb,
          heapUsedMb,
          heapTotalMb,
          heapLimitMb: managerHeapLimitMb,
          collected
        });
      }
    }
  }, config.gcIntervalMs || 30000);
  memorySweepInterval.unref();

  // Định kỳ 12h dọn bản ghi cũ trên Supabase để giữ dung lượng nhẹ
  const maintenanceCleanupInterval = setInterval(async () => {
    if (isDiscordStandbyInstance()) return;
    try {
      await Promise.allSettled([
        accessStore.runMaintenanceCleanup?.(),
        commandStore.runMaintenanceCleanup?.(),
        accessStore.adapter?.pruneHistoricalData?.(),
        accessStore.adapter?.pruneBackups?.(20)
      ]);
    } catch (err) {
      logger.warn('maintenance_cleanup_failed', { error: err.message });
    }
  }, 12 * 60 * 60 * 1000);
  maintenanceCleanupInterval.unref();

  const services = {
    config: runtimeConfig,
    logger,
    store,
    accessStore,
    commandStore,
    registry,
    broker,
    renderApi,
    fleetOperations,
    accessControl,
    entitlementService,
    link4mService,
    managerRuntimeSettings,
    wispbyteKeepAlive,
    adminNotifier,
    discordPoints: discordPointsService,
    discordClient: client
  };
  const statusMonitor = new StatusMonitorService({ services, intervalMs: 15 * 60 * 1000 });
  services.statusMonitor = statusMonitor;

  // 6. HTTP Application & Server
  const app = createApp({
    store: accessStore,
    entitlementService,
    link4mService,
    managerRuntimeSettings,
    registry,
    broker,
    commandStore,
    workerStore: store,
    fleetOperations,
    adminNotifier,
    discordClient: client,
    config: runtimeConfig,
    logger
  });
  services.invalidateAdminSessions = app.invalidateAdminSessions;
  services.invalidateUserSessions = app.invalidateUserSessions;

  const server = http.createServer(app);
  // Align HTTP keep-alive above Render/Cloudflare 60s upstream idle timeout to prevent 502 races
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  await listenHttpServer(server, runtimeConfig.port, config.host || '0.0.0.0', { logger });

  logger.info('manager_http_started', {
    platform: runtimeConfig.platform,
    port: runtimeConfig.port,
    publicUrlConfigured: Boolean(integrationSettings.publicBaseUrl)
  });

  // Start Wispbyte keepalive independently of Discord gateway so web-only / Discord outages still keep panels alive
  wispbyteKeepAlive.start({ discordClient: client, adminRoleId: accessControl.adminRoleId });

  // 7. Discord Gateway & Slash Commands (Single-active Supabase leader election)
  const discordLeaderOwnerId = `mgr_${process.pid}_${crypto.randomUUID().slice(0, 8)}`;
  const DISCORD_LOCK_KEY = 'discord_gateway_leader';
  const DISCORD_LEASE_SECONDS = 90;
  let discordLeaderHeld = false;
  let discordLeaderStarted = false;
  let discordStandbyInterval = null;
  let discordRenewInterval = null;
  let discordShuttingDown = false;
  isDiscordStandbyInstance = () => Boolean(
    config.discordToken && config.discordEnabled !== false && !discordLeaderHeld && client._standbyMode === true
  );

  const isMissingLockRpc = (err) => {
    const code = String(err?.code || '').toUpperCase();
    const msg = String(err?.message || '').toLowerCase();
    return code === 'PGRST202' || code === '42883' || msg.includes('could not find the function') || msg.includes('does not exist');
  };

  async function tryAcquireDiscordLeader() {
    if (typeof supabase?.rpc !== 'function') return true;
    try {
      const { data, error } = await supabase.rpc('acquire_manager_lock', {
        p_lock_key: DISCORD_LOCK_KEY,
        p_owner_id: discordLeaderOwnerId,
        p_lease_seconds: DISCORD_LEASE_SECONDS
      });
      if (error) {
        if (isMissingLockRpc(error)) return true;
        logger.warn('discord_leader_acquire_rpc_failed', { error: error.message });
        return false;
      }
      if (typeof data === 'object' && data !== null) return data.ok === true;
      return data === true || (typeof data === 'number' && data > 0);
    } catch (err) {
      if (isMissingLockRpc(err)) return true;
      logger.warn('discord_leader_acquire_error', { error: err?.message || String(err) });
      return false;
    }
  }

  async function renewDiscordLeader() {
    if (typeof supabase?.rpc !== 'function') return true;
    try {
      const { data, error } = await supabase.rpc('renew_manager_lock', {
        p_lock_key: DISCORD_LOCK_KEY,
        p_owner_id: discordLeaderOwnerId,
        p_lease_seconds: DISCORD_LEASE_SECONDS
      });
      if (error) {
        if (isMissingLockRpc(error)) return true;
        return null; // transient error; keep running unless explicitly lost
      }
      const renewed = data === true || (typeof data === 'object' && data !== null && data.ok === true) || (Array.isArray(data) && data[0] === true);
      return Boolean(renewed);
    } catch (_) {
      return null;
    }
  }

  async function releaseDiscordLeader() {
    if (!discordLeaderHeld || typeof supabase?.rpc !== 'function') return;
    discordLeaderHeld = false;
    try {
      await supabase.rpc('release_manager_lock', {
        p_lock_key: DISCORD_LOCK_KEY,
        p_owner_id: discordLeaderOwnerId
      });
    } catch (_) {}
  }

  if (config.discordToken && config.discordEnabled !== false) {
    attachInteractionHandler(client, { config: runtimeConfig, services, logger });
    attachMessagePointsHandler(client, { config: runtimeConfig, services, logger });

    const targetGuildId = config.discordGuildId || roleSettings?.guildId || '';
    let commandsRegistered = false;
    const registerSlash = async (gId = targetGuildId) => {
      const cId = config.discordClientId || client.user?.id;
      if (!cId || commandsRegistered) return;
      commandsRegistered = true;
      try {
        const commandRegistration = await registerCommands({
          token: config.discordToken,
          clientId: cId,
          guildId: gId || null,
          store: accessStore
        });
        logger.info('discord_commands_registered', commandRegistration);
      } catch (regErr) {
        commandsRegistered = false;
        logger.warn('discord_commands_registration_failed', { error: regErr.message });
      }
    };

    client.on(Events?.ClientReady || 'clientReady', async () => {
      try {
        logger.info('discord_bot_ready', { botUserId: client.user?.id || 'unknown', leader: discordLeaderOwnerId });
        if (!config.discordClientId || !targetGuildId) {
          const autoGuildId = targetGuildId || client.guilds?.cache?.first()?.id || null;
          await registerSlash(autoGuildId);
        }
        wispbyteKeepAlive.start({ discordClient: client, adminRoleId: accessControl.adminRoleId });
        await statusMonitor.start().catch((err) => {
          logger.warn('status_monitor_start_failed', { error: err.message });
        });
      } catch (readyErr) {
        logger.error('discord_ready_handler_failed', { error: readyErr?.message || String(readyErr) });
      }
    });

    client.on('error', (err) => {
      logger.error('discord_client_error', { message: err.message, stack: err.stack });
      void adminNotifier.sendAlert({
        source: 'Discord Gateway',
        event: 'discord_client_error',
        message: `Lỗi kết nối Discord Gateway: ${err.message}`,
        error: err,
        level: 'error'
      });
    });

    const syncSharedStateFromStore = async () => {
      try {
        const latestRoleSettings = await accessStore.getSetting('discord_access', { bypassCache: true }).catch(() => null);
        if (latestRoleSettings && typeof latestRoleSettings === 'object') {
          if (latestRoleSettings.adminRoleId && latestRoleSettings.userRoleId) {
            try {
              accessControl.setRoleIds(latestRoleSettings.adminRoleId, latestRoleSettings.userRoleId);
              runtimeConfig.adminRoleId = accessControl.adminRoleId;
              runtimeConfig.userRoleId = accessControl.userRoleId;
            } catch (_) {}
          }
          if (latestRoleSettings.adminUserId) {
            accessControl.setAdminUserId(latestRoleSettings.adminUserId);
            adminNotifier.setAdminUserId(latestRoleSettings.adminUserId);
            runtimeConfig.adminUserId = adminNotifier.getAdminUserId();
          }
        }
        const latestAdminCreds = await accessStore.getSetting('admin_credentials', { bypassCache: true }).catch(() => null);
        if (latestAdminCreds?.passwordHash && typeof registry.setAdminPassword === 'function') {
          registry.setAdminPassword(latestAdminCreds.passwordHash);
        }
        const latestWebhook = await accessStore.getSetting('webhook_settings', { bypassCache: true }).catch(() => null);
        if (latestWebhook && typeof latestWebhook === 'object' && typeof adminNotifier.configureWebhook === 'function') {
          adminNotifier.configureWebhook(latestWebhook);
        }
      } catch (_) {}
    };

    const startDiscordAsLeader = async () => {
      if (discordShuttingDown || discordLeaderStarted) return;
      discordLeaderStarted = true;
      discordLeaderHeld = true;
      client._standbyMode = false;
      if (discordStandbyInterval) {
        clearInterval(discordStandbyInterval);
        discordStandbyInterval = null;
      }
      await syncSharedStateFromStore();
      if (config.discordClientId) {
        await registerSlash();
      }
      try {
        await client.login(config.discordToken);
      } catch (loginErr) {
        logger.warn('discord_login_failed', { error: loginErr.message });
        discordLeaderStarted = false;
        client._standbyMode = true;
        statusMonitor.stop();
        try { client.destroy(); } catch (_) {}
        await releaseDiscordLeader();
        if (!discordStandbyInterval && !discordShuttingDown) {
          discordStandbyInterval = setInterval(() => { void pollStandbyLeader(); }, 15000);
          discordStandbyInterval.unref?.();
        }
        return;
      }
      if (!discordRenewInterval && !discordShuttingDown) {
        discordRenewInterval = setInterval(async () => {
          if (discordShuttingDown || !discordLeaderHeld) return;
          const renewed = await renewDiscordLeader();
          if (renewed === false) {
            const reacquired = await tryAcquireDiscordLeader();
            if (!reacquired) {
              logger.warn('discord_leader_lost_demoting_to_standby', { owner: discordLeaderOwnerId });
              discordLeaderHeld = false;
              discordLeaderStarted = false;
              client._standbyMode = true;
              clearInterval(discordRenewInterval);
              discordRenewInterval = null;
              statusMonitor.stop();
              try { client.destroy(); } catch (_) {}
              if (!discordStandbyInterval && !discordShuttingDown) {
                discordStandbyInterval = setInterval(() => { void pollStandbyLeader(); }, 15000);
                discordStandbyInterval.unref?.();
              }
            }
          }
        }, 30000);
        discordRenewInterval.unref?.();
      }
    };

    const pollStandbyLeader = async () => {
      if (discordShuttingDown || discordLeaderHeld) return;
      const won = await tryAcquireDiscordLeader();
      if (won) {
        logger.info('discord_leader_acquired_failover', { owner: discordLeaderOwnerId });
        await startDiscordAsLeader();
      }
    };

    const initiallyWon = await tryAcquireDiscordLeader();
    if (initiallyWon) {
      await startDiscordAsLeader();
    } else {
      client._standbyMode = true;
      logger.info('discord_gateway_standby', {
        owner: discordLeaderOwnerId,
        reason: 'another_manager_holds_discord_gateway_leader_lock'
      });
      discordStandbyInterval = setInterval(() => { void pollStandbyLeader(); }, 15000);
      discordStandbyInterval.unref?.();
    }
  } else {
    logger.info('discord_gateway_disabled_on_instance');
  }

  // Graceful shutdown and fatal process handlers.
  let shutdownPromise = null;
  const shutdown = (signal, exitCode = 0) => {
    if (shutdownPromise) {
      if (exitCode !== 0) process.exitCode = exitCode;
      return shutdownPromise;
    }
    process.exitCode = exitCode;
    shutdownPromise = (async () => {
      discordShuttingDown = true;
      app.setShuttingDown?.(true);
      logger.info('manager_shutdown', { signal, exitCode });
      if (discordStandbyInterval) {
        clearInterval(discordStandbyInterval);
        discordStandbyInterval = null;
      }
      if (discordRenewInterval) {
        clearInterval(discordRenewInterval);
        discordRenewInterval = null;
      }
      clearInterval(expiredCheckInterval);
      clearInterval(memorySweepInterval);
      clearInterval(maintenanceCleanupInterval);
      broker.stopOutboxProcessor();
      managerRuntimeSettings.stopHeartbeat?.();
      wispbyteKeepAlive.stop();
      statusMonitor.stop();
      discordPointsService.stop();
      await discordPointsService.flush().catch(() => {});
      await releaseDiscordLeader();
      try { client?.destroy?.(); } catch (_) {}

      server.closeIdleConnections?.();
      let forceCloseTimer = null;
      try {
        await Promise.race([
          new Promise((resolve) => server.close(resolve)),
          new Promise((resolve) => {
            forceCloseTimer = setTimeout(() => {
              server.closeAllConnections?.();
              resolve();
            }, 10000);
            forceCloseTimer.unref?.();
          })
        ]);
      } catch (error) {
        logger.error('manager_http_shutdown_failed', { error: error?.message || String(error) });
        process.exitCode = 1;
      } finally {
        if (forceCloseTimer) clearTimeout(forceCloseTimer);
      }

      try { await store.close?.(); }
      catch (error) {
        logger.error('manager_storage_shutdown_failed', { error: error?.message || String(error) });
        process.exitCode = 1;
      }
      await closeGlobalHttpDispatcher().catch(() => {});
    })();
    return shutdownPromise;
  };

  const flushCrashAlert = async (eventName, message, errorObj) => {
    let alertTimer = null;
    try {
      await Promise.race([
        Promise.resolve().then(() => adminNotifier.sendAlert({
          source: 'Manager Process',
          event: eventName,
          message,
          error: errorObj,
          level: 'error'
        })).catch(() => {}),
        new Promise((resolve) => {
          alertTimer = setTimeout(resolve, 1500);
          alertTimer.unref?.();
        })
      ]);
    } catch (_) {
    } finally {
      if (alertTimer) clearTimeout(alertTimer);
    }
  };

  process.on('uncaughtException', async (err) => {
    logger.error('uncaught_exception', { message: err.message, stack: err.stack });
    await flushCrashAlert('uncaught_exception', `Sự cố nghiêm trọng không được bắt: ${err.message}`, err);
    await shutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', async (reason) => {
    const errObj = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('unhandled_rejection', { message: errObj.message });
    await flushCrashAlert('unhandled_rejection', `Lỗi promise chưa xử lý: ${errObj.message}`, errObj);
    await shutdown('unhandledRejection', 1);
  });

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  const message = error?.message || String(error);
  console.error('\n❌ [MANAGER STARTUP FAILED]:', message);
  process.exitCode = 1;
});
