'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { overview } = require('../panels/renderer');

module.exports = {
  data: new SlashCommandBuilder().setName('panel').setDescription('Open the worker management dashboard'),
  async execute(interaction, services) {
    const role = services.accessControl.roleFor(interaction.member);
    return overview(services, interaction.user.id, role);
  }
};
