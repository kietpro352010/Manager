'use strict';

const crypto = require('node:crypto');

function required(env, key, fallbackAlternatives = []) {
  const candidates = [key, ...fallbackAlternatives];
  for (const candidateKey of candidates) {
    const value = String(env[candidateKey] || '').trim();
    if (value && !/replace-with|example|changeme/i.test(value)) {
      return value;
    }
  }
  throw new Error(`${key} must be configured.`);
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
  const text = String(value || '').trim();
  if (text.startsWith('sb_secret_')) return true;
  const parts = text.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

function parseEncryptionKey(env) {
  const primary = String(env.MANAGER_MASTER_KEY || env.MANAGER_ENCRYPTION_KEY || '').trim();
  if (primary && !/replace-with|example|changeme/i.test(primary)) {
    if (primary.length === 44 && /^[A-Za-z0-9+/=]+$/.test(primary)) {
      try {
        const decoded = Buffer.from(primary, 'base64');
        if (decoded.length === 32) return decoded;
      } catch (_) {}
    }
    return crypto.createHash('sha256').update(primary).digest();
  }

  const fallback = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || '').trim();
  if (fallback && !/replace-with|example|changeme/i.test(fallback)) {
    return crypto.createHash('sha256').update('kbot-cred-v1:' + fallback).digest();
  }

  throw new Error('MANAGER_MASTER_KEY or MANAGER_ENCRYPTION_KEY must be configured.');
}

function parsePreviousEncryptionKey(env) {
  const prev = String(env.MANAGER_MASTER_KEY_PREVIOUS || '').trim();
  if (!prev) return null;
  if (prev.length === 44 && /^[A-Za-z0-9+/=]+$/.test(prev)) {
    try {
      const decoded = Buffer.from(prev, 'base64');
      if (decoded.length === 32) return decoded;
    } catch (_) {}
  }
  return crypto.createHash('sha256').update(prev).digest();
}

function loadConfig(env = process.env) {
  const { detectHostRuntime } = require('./host-runtime');
  const hostRuntime = detectHostRuntime(env);

  const encryptionKey = parseEncryptionKey(env);
  const previousEncryptionKey = parsePreviousEncryptionKey(env);

  const sessionSecret = String(env.MANAGER_SESSION_SECRET || '').trim() ||
    crypto.createHash('sha256').update(Buffer.concat([encryptionKey, Buffer.from(':kbot_session_v11')])).digest('hex');

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
  const isLocalOrTest = (env.NODE_ENV !== 'production') || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(supabaseUrl);
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(supabaseUrl) && !isLocalOrTest) {
    throw new Error('SUPABASE_URL must be a valid HTTPS project URL.');
  }

  const supabaseSecretKey = required(env, 'SUPABASE_SECRET_KEY', ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_KEY']);
  if (!isServerSupabaseKey(supabaseSecretKey) && process.env.NODE_ENV === 'production' && !env.KBOT_ALLOW_ANON_KEY) {
    throw new Error('Configure a server-only SUPABASE_SECRET_KEY or legacy SUPABASE_SERVICE_ROLE_KEY; publishable/anon keys are not accepted in production.');
  }

  return Object.freeze({
    nodeEnv: env.NODE_ENV || 'production',
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
    previousEncryptionKey,
    sessionSecret,
    masterKey: String(env.MANAGER_MASTER_KEY || env.MANAGER_ENCRYPTION_KEY || '').trim(),
    masterKeyPrevious: String(env.MANAGER_MASTER_KEY_PREVIOUS || '').trim(),
    renderApiKey: String(env.RENDER_API_KEY || '').trim(),
    renderApiBaseUrl: String(env.RENDER_API_BASE_URL || 'https://api.render.com/v1').replace(/\/+$/, ''),
    workerPollWaitMs: positiveInt(env.WORKER_POLL_WAIT_MS, 25000, 1000, 30000),
    commandResultTimeoutMs: positiveInt(env.COMMAND_RESULT_TIMEOUT_MS, 35000, 5000, 120000),
    publicBaseUrl: hostRuntime.publicBaseUrl,
    publicUrlSource: hostRuntime.publicUrlSource,
    link4mApiToken: String(env.LINK4M_API_KEY || env.LINK4M_API_TOKEN || '').trim(),
    link4mSecretKey: String(env.LINK4M_SECRET_KEY || '').trim(),
    link4mRewardEnabled: bool(env.LINK4M_REWARD_ENABLED, false),
    link4mRewardHours: positiveInt(env.LINK4M_REWARD_HOURS, 12, 1, 48),
    link4mDailyLimit: positiveInt(env.LINK4M_DAILY_LIMIT, 2, 1, 10),
    wispbyteCookie: String(env.WISPBYTE_COOKIE || '').trim(),
    wispbytePanelUrl: String(env.WISPBYTE_PANEL_URL || 'https://wispbyte.com/client').trim(),
    wispbyteAccountsJson: String(env.WISPBYTE_ACCOUNTS || '').trim(),
    wispbyteIntervalMs: positiveInt(env.WISPBYTE_KEEPALIVE_INTERVAL_MS, 86400000, 60000, 604800000),
    telegramBotToken: String(env.TELEGRAM_BOT_TOKEN || '').trim(),
    telegramChatId: String(env.TELEGRAM_CHAT_ID || '').trim(),
    webSessionTtlHours: positiveInt(env.WEB_SESSION_TTL_HOURS, 24, 1, 720),
    maxLoginAttempts: positiveInt(env.MAX_LOGIN_ATTEMPTS, 5, 3, 20),
    loginWindowMs: positiveInt(env.LOGIN_WINDOW_MS, 15 * 60 * 1000, 60000, 3600000),
    gcIntervalMs: positiveInt(env.GC_INTERVAL_MS, 30000, 10000, 120000),
    ramWarningMb: positiveInt(env.RAM_WARNING_MB, 280, 100, 500),
    ramWatchdogLimitMb: positiveInt(env.RAM_WATCHDOG_LIMIT_MB, 450, 200, 510),
    logLevel: env.LOG_LEVEL || 'info'
  });
}

module.exports = { loadConfig };
