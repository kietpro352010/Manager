'use strict';

require('dotenv').config();

const http = require('node:http');
const { Client, GatewayIntentBits } = require('discord.js');
const { loadConfig } = require('./config/env');
const { createLogger } = require('./utils/logger');
const SupabaseWorkerStore = require('./storage/supabase-worker-store');
const SupabaseDashboardStore = require('./storage/supabase-dashboard-store');
const SupabaseCommandStore = require('./storage/supabase-command-store');
const { createSupabaseClient } = require('./storage/supabase-client');
const RenderApi = require('./services/render-api');
const { AccessControl } = require('./services/access-control');
const { EntitlementService } = require('./services/entitlement-service');
const AsyncKeyLock = require('./services/async-key-lock');
const { Link4mService } = require('./services/link4m-service');
const { WorkerRegistry } = require('./services/worker-registry');
const CommandBroker = require('./services/command-broker');
const FleetOperations = require('./services/fleet-operations');
const { ManagerRuntimeSettings } = require('./services/manager-runtime-settings');
const WispbyteKeepAliveManager = require('./services/wispbyte-keepalive');
const { AdminNotifier } = require('./services/admin-notifier');
const { createApp } = require('./http/app');
const { attachInteractionHandler } = require('./discord/handlers/interaction-handler');
const { registerCommands } = require('./discord/register-commands');

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const supabase = createSupabaseClient({ url: config.supabaseUrl, secretKey: config.supabaseSecretKey });
  const store = new SupabaseWorkerStore(supabase);
  const accessStore = new SupabaseDashboardStore(supabase);
  const commandStore = new SupabaseCommandStore(supabase);
  await store.initialize();
  await accessStore.initialize();
  await commandStore.initialize();
  const managerRuntimeSettings = new ManagerRuntimeSettings({
    store: accessStore, encryptionKey: config.encryptionKey,
    initial: {
      publicBaseUrl: config.publicBaseUrl,
      renderApiKey: config.renderApiKey,
      link4mApiToken: config.link4mApiToken,
      link4mSecretKey: config.link4mSecretKey
    }
  });
  const integrationSettings = await managerRuntimeSettings.initialize();

  let roleSettings = await accessStore.getSetting('discord_access');
  if (roleSettings?.guildId && roleSettings.guildId !== config.discordGuildId) {
    throw new Error('Supabase Discord access settings are pinned to a different DISCORD_GUILD_ID. Refusing to start in another server.');
  }
  let adminRoleId = roleSettings?.adminRoleId || config.adminRoleId;
  let userRoleId = roleSettings?.userRoleId || config.userRoleId;
  const accessControl = new AccessControl({ store: accessStore });
  if (adminRoleId || userRoleId) {
    accessControl.setRoleIds(adminRoleId, userRoleId);
    if (!roleSettings?.guildId || !roleSettings?.adminRoleId || !roleSettings?.userRoleId) {
      roleSettings = { guildId: config.discordGuildId, adminRoleId, userRoleId, configuredBy: 'environment-compat' };
      await accessStore.setSetting('discord_access', roleSettings);
    }
  }
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const adminNotifier = new AdminNotifier({
    client,
    adminUserId: roleSettings?.adminUserId || config.adminUserId,
    logger
  });
  adminNotifier.hookLogger(logger);

  const runtimeConfig = { ...config, adminRoleId: accessControl.adminRoleId, userRoleId: accessControl.userRoleId,
    adminUserId: adminNotifier.getAdminUserId(),
    publicBaseUrl: integrationSettings.publicBaseUrl, renderApiKey: integrationSettings.renderApiKey,
    link4mApiToken: integrationSettings.link4mApiToken, link4mSecretKey: integrationSettings.link4mSecretKey };
  const userLock = new AsyncKeyLock();

  const renderApi = new RenderApi({ apiKey: integrationSettings.renderApiKey, baseUrl: config.renderApiBaseUrl });
  const registry = new WorkerRegistry({ store, accessStore, encryptionKey: config.encryptionKey, renderApi, adminNotifier });
  const entitlements = new EntitlementService({ store: accessStore, registry, accessControl, logger, userLock });
  const link4m = new Link4mService({
    store: accessStore, accessControl, userLock, logger,
    config: {
      apiToken: integrationSettings.link4mApiToken, secretKey: integrationSettings.link4mSecretKey, publicBaseUrl: integrationSettings.publicBaseUrl,
      enabled: config.link4mRewardEnabled, rewardHours: config.link4mRewardHours, dailyLimit: config.link4mDailyLimit
    }
  });
  await link4m.initialize();
  const broker = new CommandBroker({ registry, commandStore, config: runtimeConfig, logger });
  const fleetOperations = new FleetOperations({ registry, broker, renderApi, logger });
  const wispbyteKeepAlive = new WispbyteKeepAliveManager({ store: accessStore, config: runtimeConfig, logger, adminNotifier });
  const services = { config: runtimeConfig, logger, store, commandStore, registry, broker, renderApi, fleetOperations, accessStore, accessControl, entitlements, link4m, managerRuntimeSettings, wispbyteKeepAlive, adminNotifier };
  const app = createApp({ registry, broker, config: runtimeConfig, logger, link4m });
  const server = http.createServer(app);
  server.requestTimeout = 40000;
  server.headersTimeout = 10000;

  attachInteractionHandler(client, { config, services, logger });
  const commandRegistration = await registerCommands({
    token: config.discordToken, clientId: config.discordClientId, guildId: config.discordGuildId
  });
  logger.info('discord_commands_registered', commandRegistration);
  client.once('ready', () => {
    logger.info('discord_bot_ready', { botUserId: client.user.id });
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
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.error('unhandled_rejection', { message: msg, stack });
    void adminNotifier.sendAlert({
      source: 'Manager Process',
      event: 'unhandled_rejection',
      message: `Promise Rejection chưa được xử lý: ${msg}`,
      error: reason,
      level: 'error'
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, resolve);
    });
  } catch (error) {
    client.destroy();
    await store.close();
    throw error;
  }
  logger.info('manager_http_started', {
    platform: config.platform, port: config.port, portSource: config.portSource,
    publicUrlConfigured: Boolean(integrationSettings.publicBaseUrl), publicUrlSource: config.publicUrlSource
  });
  try { await client.login(config.discordToken); }
  catch (error) {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
    throw error;
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('manager_shutdown', { signal });
    wispbyteKeepAlive.stop();
    client.destroy();
    await new Promise((resolve) => server.close(resolve));
    await store.close();
    process.exitCode = 0;
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  const message = error?.message || String(error);
  const stack = error?.stack || '';
  console.error('\n❌ [MANAGER STARTUP FAILED]:', message);
  if (stack) console.error(stack);
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'error', event: 'manager_startup_failed', name: error?.name || 'Error', message })}\n`);
  process.exitCode = 1;
});
