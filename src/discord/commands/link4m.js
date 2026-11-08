'use strict';

const { SlashCommandBuilder } = require('discord.js');

const definition = new SlashCommandBuilder()
  .setName('link4m')
  .setDescription('View or configure Link4M rewards')
  .addSubcommand((command) => command.setName('status').setDescription('View Link4M configuration and your quota'))
  .addSubcommand((command) => command.setName('configure').setDescription('Configure reward availability (admin)')
    .addBooleanOption((option) => option.setName('enabled').setDescription('Enable reward links').setRequired(true))
    .addIntegerOption((option) => option.setName('hours').setDescription('Hours granted per completed link').setMinValue(1).setMaxValue(48))
    .addIntegerOption((option) => option.setName('daily_limit').setDescription('Maximum rewards per user per Vietnam day').setMinValue(1).setMaxValue(10)));

async function execute(interaction, { link4m, accessStore, logger }) {
  const action = interaction.options.getSubcommand();
  if (action === 'configure') {
    const current = link4m.publicConfig();
    const config = await link4m.configure({
      enabled: interaction.options.getBoolean('enabled', true),
      rewardHours: interaction.options.getInteger('hours') || current.rewardHours,
      dailyLimit: interaction.options.getInteger('daily_limit') || current.dailyLimit
    });
    await accessStore.addAudit({
      actorId: interaction.user.id, action: 'link4m.configure', target: 'link4m_runtime',
      details: { enabled: config.enabled, rewardHours: config.rewardHours, dailyLimit: config.dailyLimit }
    }).catch((error) => logger.warn('link4m_audit_write_failed', { message: error.message }));
    return `Link4M ${config.enabled ? 'enabled' : 'disabled'} · ${config.rewardHours} hours per reward · ${config.dailyLimit} per Vietnam day · API key ${config.providerConfigured ? 'set' : 'missing'} · webhook secret ${config.webhookConfigured ? 'set' : 'missing'} · public HTTPS callback ${config.callbackConfigured ? 'set' : 'missing'}.`;
  }
  const result = await link4m.status(interaction.user.id);
  const cooldown = result.cooldownRemainingMs ? `${Math.ceil(result.cooldownRemainingMs / 60000)} minute(s)` : 'ready';
  return `Link4M ${result.enabled ? 'enabled' : 'disabled'} · reward ${result.rewardHours}h · daily limit ${result.dailyLimit} · API ${result.providerConfigured ? 'configured' : 'missing'} · HTTPS callback ${result.callbackConfigured ? 'configured' : 'missing'}\nYour quota: ${result.usedToday ?? 0}/${result.dailyLimit} used · cooldown ${cooldown}${result.reason ? `\n${result.reason}` : ''}`;
}

module.exports = { data: definition, execute };
