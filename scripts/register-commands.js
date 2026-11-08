'use strict';

require('dotenv').config();
const { registerCommands } = require('../src/discord/register-commands');

async function main() {
  const token = String(process.env.DISCORD_TOKEN || '').trim();
  const clientId = String(process.env.DISCORD_CLIENT_ID || '').trim();
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  if (!token || !clientId || !guildId) throw new Error('DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID are required.');
  const result = await registerCommands({ token, clientId, guildId });
  process.stdout.write(`Registered ${result.count} slash commands (${result.scope}).\n`);
}

main().catch((error) => {
  process.stderr.write(`Slash command registration failed: ${error.message}\n`);
  process.exitCode = 1;
});
