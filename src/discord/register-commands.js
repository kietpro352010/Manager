'use strict';

const crypto = require('node:crypto');
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./command-registry');

async function registerCommands({ token, clientId, guildId, store = null }) {
  if (!clientId || !/^\d{17,20}$/.test(String(clientId))) {
    throw new Error('A valid clientId is required to register Discord slash commands.');
  }
  const body = loadCommands().map((command) => command.data.toJSON());
  const isSingleGuild = Boolean(guildId && /^\d{17,20}$/.test(String(guildId)));
  const scope = isSingleGuild ? 'single-guild' : 'global';
  const normalizedGuildId = isSingleGuild ? String(guildId) : null;

  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ clientId: String(clientId), scope, guildId: normalizedGuildId, body }))
    .digest('hex');

  if (store && typeof store.getSetting === 'function') {
    try {
      const cached = await store.getSetting('discord_commands_hash');
      if (cached && typeof cached === 'object' && cached.hash === payloadHash) {
        return {
          count: body.length,
          scope,
          ...(normalizedGuildId ? { guildId: normalizedGuildId } : {}),
          skippedUnchanged: true
        };
      }
    } catch (_) {}
  }

  const rest = new REST({ version: '10' }).setToken(token);

  if (isSingleGuild) {
    // Single-guild registration: clean global commands and register to target guild
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    await rest.put(Routes.applicationGuildCommands(clientId, normalizedGuildId), { body });
  } else {
    // Global registration: registers across servers the bot is in (no DISCORD_GUILD_ID needed)
    await rest.put(Routes.applicationCommands(clientId), { body });
  }

  if (store && typeof store.setSetting === 'function') {
    await store.setSetting('discord_commands_hash', {
      hash: payloadHash,
      count: body.length,
      scope,
      guildId: normalizedGuildId,
      updatedAt: new Date().toISOString()
    }).catch(() => null);
  }

  return isSingleGuild
    ? { count: body.length, scope: 'single-guild', guildId: normalizedGuildId }
    : { count: body.length, scope: 'global' };
}

module.exports = { registerCommands };
