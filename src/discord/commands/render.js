'use strict';

const { SlashCommandBuilder, escapeMarkdown } = require('discord.js');

const definition = new SlashCommandBuilder()
  .setName('render')
  .setDescription('Inspect and deploy Render services')
  .addSubcommand((command) => command.setName('services').setDescription('List Render services'))
  .addSubcommand((command) => command.setName('status').setDescription('Show a Render service status')
    .addStringOption((option) => option.setName('service_id').setDescription('Render service ID').setRequired(true)))
  .addSubcommand((command) => command.setName('deploy').setDescription('Trigger a Render deploy')
    .addStringOption((option) => option.setName('service_id').setDescription('Render service ID').setRequired(true)));

function clean(value) { return escapeMarkdown(String(value || '—').replace(/[\r\n]/g, ' ').slice(0, 180)).replace(/@/g, '@\u200b'); }

async function execute(interaction, { renderApi, accessStore, logger }) {
  const subcommand = interaction.options.getSubcommand();
  const audit = async (target, details = {}) => {
    await accessStore.addAudit({ actorId: interaction.user.id, action: `render.${subcommand}`, target, details }).catch((error) => {
      logger.warn('render_audit_write_failed', { action: subcommand, message: error.message });
    });
  };
  if (subcommand === 'services') {
    const services = await renderApi.listServices();
    await audit('all', { count: services.length });
    if (!services.length) return 'No Render services found.';
    return services.slice(0, 20).map((service) => `• **${clean(service.name)}** · ${clean(service.id)} · ${clean(service.type)} · ${clean(service.suspended || 'active')}`).join('\n');
  }
  const serviceId = interaction.options.getString('service_id').trim();
  if (subcommand === 'status') {
    const service = await renderApi.getService(serviceId);
    await audit(serviceId);
    return `**${clean(service.name)}** (\`${clean(service.id)}\`)\nType: ${clean(service.type)} · state: ${clean(service.suspended || 'active')}\n${service.dashboardUrl ? `Dashboard: ${clean(service.dashboardUrl)}` : ''}`;
  }
  const deploy = await renderApi.deploy(serviceId);
  await audit(serviceId, { deployId: deploy.id, status: deploy.status });
  return `Deploy triggered for ${clean(serviceId)}. Deploy ID: ${clean(deploy.id)}, state: ${clean(deploy.status)}.`;
}

module.exports = { data: definition, execute };
