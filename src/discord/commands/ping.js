'use strict';

const { SlashCommandBuilder } = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check Discord, manager, and your worker status');

async function execute(interaction, { registry, accessControl }) {
  const startedAt = Date.now();
  const allWorkers = await registry.list();
  const role = accessControl.roleFor(interaction.member, interaction);
  const workers = await accessControl.workersFor(interaction.user.id, allWorkers, role);
  const databaseMs = Date.now() - startedAt;
  const gamePings = workers.map((worker) => worker.status?.pingMs).filter(Number.isFinite);
  const averagePing = gamePings.length
    ? `${Math.round(gamePings.reduce((sum, ping) => sum + ping, 0) / gamePings.length)}ms avg`
    : '—';
  const discordWs = Number.isFinite(interaction.client.ws.ping) && interaction.client.ws.ping >= 0
    ? `${Math.round(interaction.client.ws.ping)}ms` : 'connecting';
  const requestMs = Math.max(0, Date.now() - interaction.createdTimestamp);
  const uptime = Math.floor(process.uptime());
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  return [
    `Discord gateway: **${discordWs}** · command response: **${requestMs}ms**`,
    `Manager storage read: **${databaseMs}ms** · uptime: **${hours}h ${minutes}m**`,
    `Your worker game ping: **${averagePing}**`
  ].join('\n');
}

module.exports = { data, execute };
