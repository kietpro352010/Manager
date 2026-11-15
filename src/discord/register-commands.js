'use strict';

const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./command-registry');

async function registerCommands({ token, clientId, guildId }) {
  if (!clientId || !/^\d{17,20}$/.test(String(clientId))) {
    throw new Error('A valid clientId is required to register Discord slash commands.');
  }
  const body = loadCommands().map((command) => command.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(token);

  if (guildId && /^\d{17,20}$/.test(String(guildId))) {
    // Single-guild registration: clean global commands and register to target guild
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    await rest.put(Routes.applicationGuildCommands(clientId, String(guildId)), { body });
    return { count: body.length, scope: 'single-guild', guildId: String(guildId) };
  }

  // Global registration: registers across servers the bot is in (no DISCORD_GUILD_ID needed)
  await rest.put(Routes.applicationCommands(clientId), { body });
  return { count: body.length, scope: 'global' };
}

module.exports = { registerCommands };
