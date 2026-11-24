'use strict';

const { Events } = require('discord.js');
const { getEffectiveAllowedGuildId } = require('./interaction-handler');
const { resolveLoggedInPointsUser } = require('../../services/discord-points-service');

const GUILD_CACHE_TTL_MS = 30000;
const LOGIN_CACHE_TTL_MS = 30000;
const MAX_LOGIN_CACHE_SIZE = 2000;

const loginStatusCache = new Map();

function clearMessagePointsLoginCache(discordUserId = null) {
  if (discordUserId) {
    loginStatusCache.delete(String(discordUserId).trim());
    return;
  }
  loginStatusCache.clear();
}

async function isLoggedInCached(discordUserId, services, customCheck = null) {
  const uid = String(discordUserId || '').trim();
  if (!uid) return false;
  if (typeof customCheck === 'function') {
    return Boolean(await customCheck(uid, services));
  }

  const now = Date.now();
  const cached = loginStatusCache.get(uid);
  if (cached && now < cached.expiresAt) {
    return cached.loggedIn;
  }

  const linked = await resolveLoggedInPointsUser(uid, services);
  const loggedIn = Boolean(linked);

  if (!loginStatusCache.has(uid) && loginStatusCache.size >= MAX_LOGIN_CACHE_SIZE) {
    for (const [k, v] of loginStatusCache.entries()) {
      if (now >= v.expiresAt) loginStatusCache.delete(k);
    }
    while (loginStatusCache.size >= MAX_LOGIN_CACHE_SIZE) {
      const oldest = loginStatusCache.keys().next().value;
      if (oldest === undefined) break;
      loginStatusCache.delete(oldest);
    }
  }
  loginStatusCache.set(uid, { loggedIn, expiresAt: now + LOGIN_CACHE_TTL_MS });
  return loggedIn;
}

async function handleGuildMessage(message, { config, services, logger, resolveGuildId, checkLoggedIn } = {}) {
  try {
    if (!message || !message.guildId || !message.author) return false;
    if (message.author.bot || message.webhookId || message.system) return false;

    const pointsService = services?.discordPoints;
    if (!pointsService || typeof pointsService.recordMessage !== 'function') return false;

    const allowedGuildId = typeof resolveGuildId === 'function'
      ? await resolveGuildId()
      : await getEffectiveAllowedGuildId(config, services);

    if (!allowedGuildId || String(message.guildId) !== String(allowedGuildId)) {
      return false;
    }

    const loggedIn = await isLoggedInCached(message.author.id, services, checkLoggedIn);
    if (!loggedIn) {
      return false;
    }

    const displayName =
      message.member?.displayName ||
      message.author.globalName ||
      message.author.username ||
      '';

    await pointsService.recordMessage({
      guildId: String(message.guildId),
      userId: String(message.author.id),
      username: String(displayName).slice(0, 64)
    });
    return true;
  } catch (err) {
    logger?.warn?.('discord_message_points_failed', {
      guildId: message?.guildId || null,
      userId: message?.author?.id || null,
      error: err?.message || String(err)
    });
    return false;
  }
}

function attachMessagePointsHandler(client, { config, services, logger } = {}) {
  if (!client || typeof client.on !== 'function' || client._pointsMessageAttached) return;
  client._pointsMessageAttached = true;

  let cachedGuildId = '';
  let cachedAt = 0;

  const resolveGuildId = async () => {
    const now = Date.now();
    if (now - cachedAt < GUILD_CACHE_TTL_MS) {
      return cachedGuildId;
    }
    const resolved = await getEffectiveAllowedGuildId(config, services);
    cachedGuildId = String(resolved || '').trim();
    cachedAt = now;
    return cachedGuildId;
  };

  const eventName = Events?.MessageCreate || 'messageCreate';
  client.on(eventName, (message) => {
    void handleGuildMessage(message, { config, services, logger, resolveGuildId });
  });
}

module.exports = {
  attachMessagePointsHandler,
  handleGuildMessage,
  clearMessagePointsLoginCache
};
