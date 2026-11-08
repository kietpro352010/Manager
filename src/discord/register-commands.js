'use strict';

const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./command-registry');

async function registerCommands({ token, clientId, guildId }) {
  if (!/^\d{17,20}$/.test(String(guildId || ''))) {
    throw new Error('DISCORD_GUILD_ID is required; this manager registers commands in one Discord server only.');
  }
  const body = loadCommands().map((command) => command.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(token);
  // Remove legacy global commands so they do not appear in other servers.
  await rest.put(Routes.applicationCommands(clientId), { body: [] });
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  return { count: body.length, scope: 'single-guild', guildId };
}

module.exports = { registerCommands };
