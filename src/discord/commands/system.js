'use strict';

const { SlashCommandBuilder } = require('discord.js');

const definition = new SlashCommandBuilder().setName('system').setDescription('Show manager health');

async function execute(_interaction, { accessStore }) {
  const startedAt = Date.now();
  await accessStore.listAccess();
  const storageMs = Date.now() - startedAt;
  return `Manager is running.\nSupabase access read: **${storageMs}ms**\nUptime: **${Math.floor(process.uptime() / 60)} minutes**.`;
}

module.exports = { data: definition, execute };
