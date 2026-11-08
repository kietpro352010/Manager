'use strict';

const { SlashCommandBuilder, escapeMarkdown } = require('discord.js');

const definition = new SlashCommandBuilder()
  .setName('wispbyte')
  .setDescription('Manage Wispbyte 14-day Keep-Alive accounts and panel renewals')
  .addSubcommand((sub) => sub.setName('status').setDescription('View Wispbyte keepalive accounts status'))
  .addSubcommand((sub) => sub.setName('check').setDescription('Trigger immediate renewal check for all Wispbyte accounts'))
  .addSubcommand((sub) => sub.setName('add').setDescription('Register or update a Wispbyte account cookie')
    .addStringOption((opt) => opt.setName('id').setDescription('Account identifier (e.g. host1)').setRequired(true))
    .addStringOption((opt) => opt.setName('name').setDescription('Friendly account name').setRequired(true))
    .addStringOption((opt) => opt.setName('cookie').setDescription('Session cookie from wispbyte.com/client').setRequired(true))
    .addStringOption((opt) => opt.setName('url').setDescription('Custom panel URL (default: https://wispbyte.com/client)').setRequired(false)))
  .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a Wispbyte keepalive account')
    .addStringOption((opt) => opt.setName('id').setDescription('Account identifier').setRequired(true)));

function clean(value) {
  return escapeMarkdown(String(value || '—').replace(/[\r\n]/g, ' ').slice(0, 180)).replace(/@/g, '@\u200b');
}

async function execute(interaction, { wispbyteKeepAlive, accessStore, logger }) {
  const subcommand = interaction.options.getSubcommand();

  const audit = async (action, details = {}) => {
    if (accessStore && typeof accessStore.addAudit === 'function') {
      await accessStore.addAudit({ actorId: interaction.user.id, action: `wispbyte.${action}`, details }).catch(() => {});
    }
  };

  if (!wispbyteKeepAlive) {
    return 'Wispbyte Keep-Alive service is not available on this manager.';
  }

  if (subcommand === 'status') {
    const accounts = await wispbyteKeepAlive.getStatus();
    await audit('status', { count: accounts.length });
    if (accounts.length === 0) {
      return 'No Wispbyte keep-alive accounts configured. Use `/wispbyte add` to register an account.';
    }

    const lines = accounts.map((acc, index) => {
      const icon = acc.lastStatus === 'ok' ? '🟢' : (acc.lastStatus === 'expired' ? '🔴' : '🟡');
      const pingText = acc.lastPingAt ? `<t:${Math.floor(new Date(acc.lastPingAt).getTime() / 1000)}:R>` : 'Never';
      return [
        `**${index + 1}. ${icon} ${clean(acc.name)}** (\`${clean(acc.id)}\`)`,
        `   └ Status: \`${clean(acc.lastStatus.toUpperCase())}\` · Renews: **${acc.renewCount}** · Last ping: ${pingText}`,
        `   └ Detail: ${clean(acc.lastMessage)}`
      ].join('\n');
    });

    return [
      `🛰️ **Wispbyte 14-Day Keep-Alive Accounts (${accounts.length})**`,
      ...lines
    ].join('\n\n');
  }

  if (subcommand === 'check') {
    const result = await wispbyteKeepAlive.checkAll({ notifyDiscord: false });
    await audit('check', { total: result.total, okCount: result.okCount });

    if (!result.success && result.message) {
      return result.message;
    }
    if (result.total === 0) {
      return 'No Wispbyte accounts configured. Use `/wispbyte add` to add one.';
    }

    const lines = result.results.map((r, index) => {
      const icon = r.status === 'ok' ? '🟢' : (r.status === 'expired' ? '🔴' : '🟡');
      return `**${index + 1}. ${icon} ${clean(r.name)}** (\`${clean(r.id)}\`): \`${clean(r.status.toUpperCase())}\` — ${clean(r.message)} *(Renews: ${r.renewCount})*`;
    });

    const summary = result.expiredCount > 0
      ? `\n\n⚠️ **Warning:** ${result.expiredCount} account(s) have expired cookies! Update them with \`/wispbyte add\`.`
      : '';

    return [
      `🛰️ **Wispbyte Renewal Check Complete**`,
      `• Total accounts: **${result.total}** | Successful: **${result.okCount}** ✅ | Expired/Errors: **${result.expiredCount + result.errorCount}** ⚠️`,
      '',
      ...lines,
      summary
    ].join('\n');
  }

  if (subcommand === 'add') {
    const id = interaction.options.getString('id').trim();
    const name = interaction.options.getString('name').trim();
    const cookie = interaction.options.getString('cookie').trim();
    const url = interaction.options.getString('url')?.trim();

    const account = await wispbyteKeepAlive.addOrUpdateAccount({ id, name, cookie, panelUrl: url });
    await audit('add', { id: account.id, name: account.name });
    logger.info?.('wispbyte_account_added', { id: account.id, name: account.name });

    return `✅ Saved Wispbyte account **${clean(account.name)}** (\`${clean(account.id)}\`). Use \`/wispbyte check\` to verify connection to the client panel.`;
  }

  if (subcommand === 'remove') {
    const id = interaction.options.getString('id').trim();
    const removed = await wispbyteKeepAlive.deleteAccount(id);
    await audit('remove', { id });
    return removed
      ? `🗑️ Removed Wispbyte account \`${clean(id)}\`.`
      : `Account \`${clean(id)}\` was not found.`;
  }

  return 'Unknown subcommand.';
}

module.exports = { data: definition, execute };
