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
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { loadConfig } = require('./config/env');
const { detectHostPlatformAndPort, detectHostRuntime, listenHttpServer } = require('./config/host-runtime');
const { createLogger } = require('./utils/logger');

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

const { createApp } = require('./http/app');
const { attachInteractionHandler } = require('./discord/handlers/interaction-handler');
const { registerCommands } = require('./discord/register-commands');

async function main() {
  const config = loadConfig();
  const hostDetector = typeof detectHostPlatformAndPort === 'function' ? detectHostPlatformAndPort : detectHostRuntime;
  const hostPlatform = typeof hostDetector === 'function' ? hostDetector() : { port: config.port, platform: config.platform };
  const logger = createLogger(config.logLevel);

  // 1. Storage & Database Setup
  const supabase = createSupabaseClient({ url: config.supabaseUrl, secretKey: config.supabaseSecretKey });
  const store = new SupabaseWorkerStore(supabase);
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
    initial: {
      publicBaseUrl: config.publicBaseUrl,
      renderApiKey: config.renderApiKey,
      link4mApiToken: config.link4mApiToken,
      link4mSecretKey: config.link4mSecretKey
    }
  });
  const integrationSettings = await managerRuntimeSettings.initialize();

  // 3. Discord Access Control & Setup
  let roleSettings = await accessStore.getSetting('discord_access');
  if (roleSettings?.guildId && roleSettings.guildId !== config.discordGuildId) {
    logger.warn('discord_guild_mismatch', { configGuild: config.discordGuildId, storedGuild: roleSettings.guildId });
  }

  let adminRoleId = roleSettings?.adminRoleId || config.adminRoleId;
  let userRoleId = roleSettings?.userRoleId || config.userRoleId;
  let adminUserId = roleSettings?.adminUserId || config.adminUserId;

  const accessControl = new AccessControl({ store: accessStore, adminUserId });
  if (adminRoleId || userRoleId) {
    accessControl.setRoleIds(adminRoleId, userRoleId);
    if (!roleSettings?.guildId || !roleSettings?.adminRoleId || !roleSettings?.userRoleId) {
      roleSettings = { guildId: config.discordGuildId, adminRoleId, userRoleId, configuredBy: 'environment-compat' };
      await accessStore.setSetting('discord_access', roleSettings);
    }
  }

  // 4. Discord Client & Admin Notifier
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const adminNotifier = new AdminNotifier({
    client,
    adminUserId: roleSettings?.adminUserId || config.adminUserId,
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
    link4mSecretKey: integrationSettings.link4mSecretKey || config.link4mSecretKey || ''
  };

  const userLock = new AsyncKeyLock();
  const renderApi = new RenderApi({ apiKey: integrationSettings.renderApiKey, baseUrl: config.renderApiBaseUrl });
  const registry = new WorkerRegistry({ store, accessStore, encryptionKey: config.encryptionKey, renderApi, adminNotifier });
  await registry.load().catch(() => {});

  const savedAdminCreds = await accessStore.getSetting('admin_credentials').catch(() => null);
  if (savedAdminCreds?.passwordHash && typeof registry.setAdminPassword === 'function') {
    registry.setAdminPassword(savedAdminCreds.passwordHash);
  }
  const savedAnnouncement = await accessStore.getSetting('system_announcement').catch(() => null);
  if (savedAnnouncement?.message) {
    accessStore.cachedAnnouncement = savedAnnouncement.message;
  }

  const broker = new CommandBroker({ registry, commandStore, config: runtimeConfig, logger });
  const fleetOperations = new FleetOperations({ registry, broker, renderApi, logger });
  const entitlementService = new EntitlementService({ store: accessStore, registry, accessControl, userLock });
  const link4mService = new Link4mService({ store: accessStore, accessControl, userLock, config: runtimeConfig, logger });
  await link4mService.initialize().catch((err) => {
    logger?.error?.('link4m_initialization_failed', {
      degraded: true,
      error: err?.message || String(err)
    });
  });
  const wispbyteKeepAlive = new WispbyteKeepAliveManager({ store: accessStore, config: runtimeConfig, logger, adminNotifier });

  // Start background workers
  broker.startOutboxProcessor({ intervalMs: 5000 });

  // Định kỳ kiểm tra khách hết hạn và dừng bot êm ái (Graceful Expire Stop)
  const expiredCheckInterval = setInterval(async () => {
    try {
      await entitlementService.checkExpiredUsersAndGracefulStop({ broker, fleetOperations });
    } catch (err) {
      logger.warn('expired_users_check_failed', { error: err.message });
    }
  }, 60000);
  expiredCheckInterval.unref();

  // 5. Adaptive Memory Sweeper (Trụ cột 1.1)
  const memorySweepInterval = setInterval(() => {
    const memory = process.memoryUsage();
    const rssMb = Math.round(memory.rss / (1024 * 1024));
    const heapUsedMb = Math.round(memory.heapUsed / (1024 * 1024));
    const heapTotalMb = Math.round(memory.heapTotal / (1024 * 1024));

    if (rssMb > (config.rssWarningThresholdMb || 280) || heapUsedMb > 0.75 * heapTotalMb) {
      registry.pruneStaleMemory();
      const collected = runGarbageCollection();
      logger.info('adaptive_memory_sweep', { rssMb, heapUsedMb, heapTotalMb, collected });
    }
  }, 30000);
  memorySweepInterval.unref();

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
    discordClient: client
  };

  // 6. HTTP Application & Server
  const app = createApp({
    store: accessStore,
    entitlementService,
    link4mService,
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

  const server = http.createServer(app);
  await listenHttpServer(server, runtimeConfig.port, config.host || '0.0.0.0', { logger });

  logger.info('manager_http_started', {
    platform: runtimeConfig.platform,
    port: runtimeConfig.port,
    publicUrlConfigured: Boolean(integrationSettings.publicBaseUrl)
  });

  // 7. Discord Gateway & Slash Commands
  if (config.discordToken) {
    attachInteractionHandler(client, { config: runtimeConfig, services, logger });

    if (config.discordClientId) {
      try {
        const commandRegistration = await registerCommands({
          token: config.discordToken,
          clientId: config.discordClientId,
          guildId: config.discordGuildId
        });
        logger.info('discord_commands_registered', commandRegistration);
      } catch (regErr) {
        logger.warn('discord_commands_registration_failed', { error: regErr.message });
      }
    }

    client.once(Events?.ClientReady || 'clientReady', () => {
      logger.info('discord_bot_ready', { botUserId: client.user?.id || 'unknown' });
      wispbyteKeepAlive.start({ discordClient: client, adminRoleId: accessControl.adminRoleId });
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

    try {
      await client.login(config.discordToken);
    } catch (loginErr) {
      logger.warn('discord_login_failed', { error: loginErr.message });
    }
  }

  // Process safety handlers
  process.on('uncaughtException', (err) => {
    logger.error('uncaught_exception', { message: err.message, stack: err.stack });
    void adminNotifier.sendAlert({
      source: 'Manager Process',
      event: 'uncaught_exception',
      message: `Sự cố nghiêm trọng không được bắt: ${err.message}`,
      error: err,
      level: 'error'
    });
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.error('unhandled_rejection', { message: msg });
  });

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('manager_shutdown', { signal });
    broker.stopOutboxProcessor();
    wispbyteKeepAlive.stop();
    if (client && typeof client.isReady === 'function' && client.isReady()) client.destroy();
    await new Promise((resolve) => server.close(resolve));
    await store.close?.();
    process.exitCode = 0;
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  const message = error?.message || String(error);
  console.error('\n❌ [MANAGER STARTUP FAILED]:', message);
  process.exitCode = 1;
});
