'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, TextInputStyle
} = require('discord.js');
const { escapeMarkdown } = require('discord.js');

const COLOR = 0x0f766e;

function safe(value, max = 180) {
  return escapeMarkdown(String(value || '—').replace(/[\r\n\t]/g, ' ').slice(0, max)).replace(/@/g, '@\u200b');
}

function can(role, required) { return required === 'user' ? ['user', 'admin'].includes(role) : role === 'admin'; }
function button(label, customId, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setLabel(label).setCustomId(customId).setStyle(style).setDisabled(disabled);
}
function embed(title, description = '') {
  return new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(description).setTimestamp(new Date());
}
function pageNavigation(role, page = 'overview') {
  const row = new ActionRowBuilder().addComponents(
    button('Overview', 'km:page:overview', page === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    button('Workers', 'km:page:workers', page === 'workers' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ...(can(role, 'admin') ? [button('Members', 'km:page:access', page === 'access' ? ButtonStyle.Primary : ButtonStyle.Secondary)] : []),
    ...(can(role, 'admin') ? [button('Activity', 'km:page:audit', page === 'audit' ? ButtonStyle.Primary : ButtonStyle.Secondary)] : []),
    button('Refresh', 'km:page:refresh', ButtonStyle.Success)
  );
  return row;
}

function uptimeText(value) {
  const seconds = Math.max(0, Number(value) || 0);
  if (!seconds) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatRate(value) {
  if (value === null || value === undefined || value === '') return '—';
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0) return '—';
  return rate >= 1024 ? `${(rate / 1024).toFixed(1)} KB/s` : `${Math.round(rate)} B/s`;
}

function workerState(worker) {
  if (!worker.reachable) return 'offline';
  const status = worker.status || {};
  if (status.online && ['online', 'entering'].includes(status.state)) return 'AFK';
  return status.state || 'unknown';
}

async function botDashboard({ registry, accessControl }, userId, role, notice = '') {
  const workers = await accessControl.workersFor(userId, await registry.list(), role);
  const lines = workers.slice(0, 22).map((worker) => {
    const status = worker.status || {};
    const gamePing = Number.isFinite(status.pingMs) ? `${status.pingMs}ms` : 'ping —';
    const managerLatency = Number.isFinite(status.managerLatencyMs) ? `mgr ${status.managerLatencyMs}ms` : 'mgr —';
    const uptime = status.online ? uptimeText(status.uptimeSeconds) : '—';
    return `**#${worker.botNumber} ${safe(worker.name, 40)}** · ${workerState(worker)} · ping ${gamePing} · TPS≈${Number.isFinite(status.tps) ? status.tps.toFixed(1) : '—'} · CPU ${Number.isFinite(status.cpuPercent) ? `${status.cpuPercent.toFixed(0)}%` : '—'} · RAM ${Number.isFinite(status.rssMb) ? `${Math.round(status.rssMb)}MB` : '—'} · ${uptime} · ↻${Number(status.reconnectCount) || 0} · ${managerLatency}`;
  });
  if (workers.length > 22) lines.push(`… ${workers.length - 22} more. Use \`/bot number\` to open a specific worker.`);
  if (!workers.length) lines.push(role === 'admin' ? 'No workers are registered.' : 'No workers are assigned to your Discord account. Redeem a code or ask an admin to assign one.');

  const components = [];
  if (workers.length) {
    const options = workers.slice(0, 25).map((worker) => ({
      label: `#${worker.botNumber} ${String(worker.name || worker.workerId).slice(0, 88)}`,
      description: `${workerState(worker)} · ${worker.provider}`.slice(0, 100),
      value: worker.workerId
    }));
    const select = new StringSelectMenuBuilder().setCustomId('km:worker:select')
      .setPlaceholder('Open worker details').addOptions(options);
    components.push(new ActionRowBuilder().addComponents(select));
  }
  components.push(pageNavigation(role, 'overview'));
  return { embeds: [embed('Your KingMC workers', `${notice ? `**${safe(notice, 220)}**\n\n` : ''}${lines.join('\n')}`)
    .setFooter({ text: `Access: ${role === 'admin' ? 'Admin · all workers' : 'User · assigned workers only'} · /bot number opens details` })], components };
}

async function overview({ registry, accessControl }, userId, role, notice = '') {
  const workers = await accessControl.workersFor(userId, await registry.list(), role);
  const member = await accessControl.memberFor(userId);
  const lines = workers.slice(0, 8).map((worker) => {
    const state = worker.reachable ? safe(worker.status?.state || 'ready', 32) : 'offline';
    const game = worker.status?.online ? 'in game' : 'not in game';
    return `• **${safe(worker.name, 48)}** · ${safe(worker.workerId, 40)} · ${state} · ${game}`;
  });
  if (workers.length > 8) lines.push(`…and ${workers.length - 8} more. Open **Workers** to manage them.`);
  if (!workers.length) lines.push(role === 'admin' ? 'No workers registered yet.' : 'No workers are assigned to your Discord account.');
  const accessText = `${role[0].toUpperCase()}${role.slice(1)}`;
  const entitlement = role === 'user'
    ? (accessControl.isEntitled(member) ? (member.isPermanent ? 'Permanent' : `Until ${new Date(member.expiresAt).toLocaleDateString('en-GB')}`) : 'Expired / disabled')
    : 'Full access';
  const body = [notice ? `**${safe(notice, 220)}**` : '', lines.join('\n')].filter(Boolean).join('\n\n');
  const panel = embed('KingMC · Worker Manager', body)
    .addFields({ name: 'Your access', value: `${accessText} · ${entitlement}`, inline: true })
    .setFooter({ text: `Panel for ${userId}` });
  return { embeds: [panel], components: [pageNavigation(role)] };
}

async function workersPage({ registry, accessControl }, userId, role, notice = '') {
  const workers = await accessControl.workersFor(userId, await registry.list(), role);
  const lines = workers.slice(0, 20).map((worker) => {
    const status = worker.reachable ? safe(worker.status?.state || 'ready', 28) : 'offline';
    return `• **${safe(worker.name, 48)}** · \`${safe(worker.workerId, 40)}\` · ${status} · ${safe(worker.provider, 20)}`;
  });
  if (!workers.length) lines.push('No workers registered yet.');
  if (workers.length > 20) lines.push(`Showing 20 of ${workers.length}; worker selection supports the first 25.`);
  const components = [];
  if (workers.length) {
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId('km:worker:select')
      .setPlaceholder('Choose a worker to manage')
      .addOptions(workers.slice(0, 25).map((worker) => ({
        label: String(worker.name || worker.workerId).slice(0, 100),
        description: `${worker.workerId} · ${worker.reachable ? worker.status?.state || 'reachable' : 'offline'}`.slice(0, 100),
        value: worker.workerId
      })))));
  }
  const tools = [];
  if (can(role, 'admin')) tools.push(
    button('Register', 'km:workers:add', ButtonStyle.Success),
    button('Stop all', 'km:fleet:stop-all', ButtonStyle.Danger),
    button('Reconnect errors', 'km:fleet:reconnect-errors', ButtonStyle.Primary),
    button('Clean dead', 'km:fleet:clean-dead', ButtonStyle.Secondary)
  );
  tools.push(button('Back', 'km:page:overview'));
  components.push(new ActionRowBuilder().addComponents(tools));
  return { embeds: [embed('Workers', `${notice ? `**${safe(notice, 220)}**\n\n` : ''}${lines.join('\n')}`)], components };
}

async function workerDetail({ registry, accessControl }, userId, workerId, role, notice = '') {
  const worker = await registry.find(workerId);
  if (!worker) return { embeds: [embed('Worker not found', 'It may have been removed. Refresh the worker list.')], components: [pageNavigation(role, 'workers')] };
  if (!(await accessControl.canUseWorker(userId, worker, role))) throw new Error('You do not have access to this worker, or your user role, access, or assignment is inactive.');
  const status = worker.status || {};
  const privateSettings = await registry.privateSettings(workerId);
  const events = (worker.events || []).slice(-5).reverse();
  const logLines = events.map((event) => {
    const date = new Date(event.occurredAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
    return `\`${date}\` **${safe(event.type, 20)}** ${safe(event.message, 140)}`;
  });
  const description = [notice ? `**${safe(notice, 220)}**\n` : '', `**#${worker.botNumber} ${safe(worker.name, 64)}** · \`${safe(worker.workerId, 40)}\` · ${safe(worker.provider, 24)} · ${worker.reachable ? 'reachable' : 'offline'}`].filter(Boolean).join('\n');
  const panel = embed('Worker control', description).addFields(
    { name: 'State', value: `${workerState(worker)} · ${status.online ? 'connected' : 'not connected'}${status.restriction ? ` · hold: ${safe(status.restriction, 30)}` : ''}`, inline: true },
    { name: 'Latency', value: `Game ${Number.isFinite(status.pingMs) ? `${status.pingMs}ms` : '—'} · Manager ${Number.isFinite(status.managerLatencyMs) ? `${status.managerLatencyMs}ms` : '—'}`, inline: true },
    { name: 'Session', value: `Uptime ${uptimeText(status.uptimeSeconds)} · reconnects ${Number(status.reconnectCount) || 0} (streak ${Number(status.reconnectAttempts) || 0})`, inline: true },
    { name: 'Game account', value: privateSettings?.credentialsConfigured ? `Configured · ${safe(privateSettings.username, 40)}` : 'Not configured · set before starting', inline: true },
    { name: 'Game', value: `TPS≈ ${Number.isFinite(status.tps) ? status.tps.toFixed(1) : '—'} (worker tick estimate) · AFK still (fixed) · proxy ${status.proxyEnabled ? 'on' : 'off'}`, inline: false },
    { name: 'Host process resources', value: `CPU ${Number.isFinite(status.cpuPercent) ? `${status.cpuPercent.toFixed(1)}%` : '—'} · RAM ${Number.isFinite(status.rssMb) ? `${Math.round(status.rssMb)} MB` : '—'} · Net ↓${formatRate(status.bandwidthRxBps)} ↑${formatRate(status.bandwidthTxBps)}`, inline: false },
    { name: '💬 Chat in-game', value: 'Bấm nút **"💬 Gửi chat game"** bên dưới để mở popup nhập tin nhắn gửi thẳng vào Minecraft.', inline: false },
    { name: 'Maintenance', value: `${status.maintenanceWindow ? 'Paused now' : 'Daily pause'} · 04:30–05:30 Vietnam time (UTC+7, fixed)`, inline: false },
    { name: 'Recent events & chat', value: logLines.join('\n').slice(0, 1000) || 'No events yet.', inline: false }
  );

  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    button('Start', `km:worker:action:start:${workerId}`, ButtonStyle.Success),
    button('Stop', `km:worker:action:stop:${workerId}`, ButtonStyle.Danger),
    button('Restart', `km:worker:action:restart:${workerId}`, ButtonStyle.Primary),
    button('Refresh status', `km:worker:action:status:${workerId}`)
  ));
  const management = [
    button('💬 Gửi chat game', `km:worker:chat:${workerId}`, ButtonStyle.Primary),
    button('Game account', `km:worker:credentials:${workerId}`, ButtonStyle.Secondary),
    button('Proxy', `km:worker:proxy:${workerId}`, ButtonStyle.Secondary),
    button('Workers', 'km:page:workers')
  ];
  rows.push(new ActionRowBuilder().addComponents(management));
  const adminTools = [];
  if (can(role, 'admin')) {
    adminTools.push(button('Reset data', `km:worker:reset:${workerId}`, ButtonStyle.Danger), button('Rotate secret', `km:worker:rotate:${workerId}`, ButtonStyle.Secondary), button('Remove', `km:worker:remove:${workerId}`, ButtonStyle.Danger));
    rows.push(new ActionRowBuilder().addComponents(adminTools));
  }
  return { embeds: [panel], components: rows };
}

async function accessPage({ accessStore, config }, role, notice = '') {
  const entries = await accessStore.listAccess();
  const grants = entries.slice(0, 12).map((entry) => {
    const bots = Array.isArray(entry.workerIds) && entry.workerIds.length ? entry.workerIds.join(', ') : 'no workers';
    const access = entry.isPermanent ? 'permanent' : `expires ${entry.expiresAt ? new Date(entry.expiresAt).toLocaleDateString('en-GB') : 'unset'}`;
    return `• <@${entry.userId}> · ${entry.role} · ${entry.status || 'active'} · ${access} · ${safe(bots, 100)}`;
  });
  const text = [grants.length ? grants.join('\n') : 'No member access has been assigned.', entries.length > 15 ? `…and ${entries.length - 15} more.` : '']
    .filter(Boolean).join('\n');
  const controls = [
    button('Add / update user', 'km:access:grant', ButtonStyle.Success),
    button('Disable user', 'km:access:disable', ButtonStyle.Danger),
    button('Remove user', 'km:access:revoke', ButtonStyle.Danger),
    button('Back', 'km:page:overview')
  ];
  return { embeds: [embed('Users & access', `${notice ? `**${safe(notice, 220)}**\n\n` : ''}${text}\n\nDiscord roles determine Admin/User access. User role: <@&${config.userRoleId}> · Admin role: <@&${config.adminRoleId}>. Supabase stores each user’s expiry and worker assignments.`)], components: [new ActionRowBuilder().addComponents(controls)] };
}

async function auditPage({ accessStore }, role) {
  const entries = await accessStore.listAudit(12);
  const lines = entries.map((entry) => {
    const time = new Date(entry.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' });
    return `• ${time} · <@${entry.actorId}> · **${safe(entry.action, 40)}**${entry.target ? ` · ${safe(entry.target, 60)}` : ''}`;
  });
  return { embeds: [embed('Recent activity', lines.join('\n') || 'No activity recorded yet.')], components: [pageNavigation(role, 'audit')] };
}

function textModal(customId, title, fields) {
  const { ModalBuilder, ActionRowBuilder, TextInputBuilder } = require('discord.js');
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  for (const field of fields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setStyle(field.style || TextInputStyle.Short)
      .setRequired(field.required !== false)
      .setMaxLength(field.maxLength || 100)
      .setPlaceholder(field.placeholder || '');
    if (field.value) input.setValue(field.value);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

module.exports = { overview, workersPage, workerDetail, botDashboard, accessPage, auditPage, textModal, can, safe, uptimeText, workerState };
