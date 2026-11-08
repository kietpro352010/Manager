'use strict';

function required(env, key) {
  const value = String(env[key] || '').trim();
  if (!value || /replace-with|example|changeme/i.test(value)) throw new Error(`${key} must be configured.`);
  return value;
}

function positiveInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function isServerSupabaseKey(value) {
  if (value.startsWith('sb_secret_')) return true;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === 'service_role';
  } catch { return false; }
}

function loadConfig(env = process.env) {
  const { detectHostRuntime } = require('./host-runtime');
  const hostRuntime = detectHostRuntime(env);
  const encryptionKey = Buffer.from(required(env, 'MANAGER_ENCRYPTION_KEY'), 'base64');
  if (encryptionKey.length !== 32) throw new Error('MANAGER_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  const adminRoleId = String(env.ADMIN_ROLE_ID || '').trim();
  const userRoleId = String(env.USER_ROLE_ID || '').trim();
  const adminUserId = String(env.ADMIN_DISCORD_USER_ID || env.ADMIN_USER_ID || '').trim();
  if ((adminRoleId || userRoleId) && (![adminRoleId, userRoleId].every((id) => /^\d{17,20}$/.test(id)) || adminRoleId === userRoleId)) {
    throw new Error('If role IDs are set in the environment, ADMIN_ROLE_ID and USER_ROLE_ID must both be valid and different.');
  }
  const discordClientId = required(env, 'DISCORD_CLIENT_ID');
  const discordGuildId = required(env, 'DISCORD_GUILD_ID');
  if (!/^\d{17,20}$/.test(discordClientId)) throw new Error('DISCORD_CLIENT_ID must be a Discord application ID.');
  if (!/^\d{17,20}$/.test(discordGuildId)) throw new Error('DISCORD_GUILD_ID must be the Discord server ID where this manager is allowed to operate.');
  const supabaseUrl = required(env, 'SUPABASE_URL').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(supabaseUrl)) throw new Error('SUPABASE_URL must be a valid HTTPS project URL.');
  const supabaseSecretKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseSecretKey || /replace-with|example|changeme/i.test(supabaseSecretKey) || !isServerSupabaseKey(supabaseSecretKey)) {
    throw new Error('Configure a server-only SUPABASE_SECRET_KEY or legacy SUPABASE_SERVICE_ROLE_KEY; publishable/anon keys are not accepted.');
  }

  return Object.freeze({
    nodeEnv: env.NODE_ENV || 'development',
    host: env.HOST || '0.0.0.0',
    port: hostRuntime.port,
    platform: hostRuntime.platform,
    portSource: hostRuntime.portSource,
    discordToken: required(env, 'DISCORD_TOKEN'),
    discordClientId,
    discordGuildId,
    adminRoleId,
    userRoleId,
    adminUserId,
    supabaseUrl,
    supabaseSecretKey,
    encryptionKey,
    renderApiKey: String(env.RENDER_API_KEY || '').trim(),
    renderApiBaseUrl: String(env.RENDER_API_BASE_URL || 'https://api.render.com/v1').replace(/\/+$/, ''),
    workerPollWaitMs: positiveInt(env.WORKER_POLL_WAIT_MS, 25000, 1000, 30000),
    commandResultTimeoutMs: positiveInt(env.COMMAND_RESULT_TIMEOUT_MS, 35000, 5000, 120000),
    publicBaseUrl: hostRuntime.publicBaseUrl,
    publicUrlSource: hostRuntime.publicUrlSource,
    link4mApiToken: String(env.LINK4M_API_KEY || '').trim(),
    link4mSecretKey: String(env.LINK4M_SECRET_KEY || '').trim(),
    link4mRewardEnabled: bool(env.LINK4M_REWARD_ENABLED, false),
    link4mRewardHours: positiveInt(env.LINK4M_REWARD_HOURS, 12, 1, 48),
    link4mDailyLimit: positiveInt(env.LINK4M_DAILY_LIMIT, 2, 1, 10),
    wispbyteCookie: String(env.WISPBYTE_COOKIE || '').trim(),
    wispbytePanelUrl: String(env.WISPBYTE_PANEL_URL || 'https://wispbyte.com/client').trim(),
    wispbyteAccountsJson: String(env.WISPBYTE_ACCOUNTS || '').trim(),
    wispbyteIntervalMs: positiveInt(env.WISPBYTE_KEEPALIVE_INTERVAL_MS, 86400000, 60000, 604800000),
    logLevel: env.LOG_LEVEL || 'info'
  });
}

module.exports = { loadConfig };
