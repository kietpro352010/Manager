'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { overview, workersPage, workerDetail, accessPage, auditPage, textModal, safe, padId } = require('../panels/renderer');

const PANEL_PREFIX = 'km:';

async function audit(services, actorId, action, target = '', details = {}) {
  await services.accessStore.addAudit({ actorId, action, target, details }).catch((error) => {
    services.logger.warn('dashboard_audit_write_failed', { action, message: error.message });
  });
}

function isAdmin(role) { return role === 'admin'; }
function hasWorkerAccess(services, actorId, worker, role) { return services.accessControl.canUseWorker(actorId, worker, role); }
function pagePayload(services, userId, role, page, notice = '') {
  if (page === 'workers') return workersPage(services, userId, role);
  if (page === 'access') return accessPage(services, role, notice);
  if (page === 'audit') return auditPage(services, role);
  return overview(services, userId, role, notice);
}

async function deny(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}

async function safeUpdate(interaction, payload) {
  return interaction.update({ ...payload, allowedMentions: { parse: [] } });
}

async function showWorker(interaction, services, role, workerId, notice = '') {
  return safeUpdate(interaction, await workerDetail(services, interaction.user.id, workerId, role, notice));
}

function removeConfirmation(workerId) {
  const confirm = new ButtonBuilder().setCustomId(`km:worker:remove-confirm:${workerId}`).setLabel('Confirm removal').setStyle(ButtonStyle.Danger);
  const cancel = new ButtonBuilder().setCustomId(`km:worker:remove-cancel:${workerId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary);
  return {
    embeds: [new EmbedBuilder().setColor(0xb91c1c).setTitle('Remove worker?').setDescription(`This removes **${safe(workerId)}** from the manager registry and cancels pending commands. The worker process itself is not deleted.`)],
    components: [new ActionRowBuilder().addComponents(confirm, cancel)]
  };
}

function resetConfirmation(workerId) {
  return {
    embeds: [new EmbedBuilder().setColor(0xb91c1c).setTitle('Reset worker data?')
      .setDescription(`This stops **${safe(workerId)}**, clears its saved Minecraft account, recent events, and session counters. AFK and proxy settings stay saved.`)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`km:worker:reset-confirm:${workerId}`).setLabel('Reset data').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`km:worker:reset-cancel:${workerId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    )]
  };
}

const FLEET_CONFIRMATIONS = {
  'stop-all': ['Stop every registered worker?', 'All worker slots will receive a stop command.'],
  'reconnect-errors': ['Reconnect workers in error state?', 'Only reachable workers in error state without a restriction hold are restarted.'],
  'clean-dead': ['Clean deleted Render services?', 'Only registrations whose Render API lookup returns 404 are removed. Wispbyte and uncertain results are retained.']
};

function fleetConfirmation(action) {
  const [title, description] = FLEET_CONFIRMATIONS[action];
  return {
    embeds: [new EmbedBuilder().setColor(0xb45309).setTitle(title).setDescription(description)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`km:fleet:confirm:${action}`).setLabel('Confirm').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('km:fleet:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    )]
  };
}

function fleetNotice(action, result) {
  if (action === 'clean-dead') return `Cleaned ${result.removed.length} deleted Render registration(s); retained ${result.retained.length}.`;
  const confirmed = result.results.filter((item) => item.ok).length;
  const pending = result.results.filter((item) => item.pending).length;
  const failed = result.results.filter((item) => !item.ok && !item.pending).length;
  return `${action === 'stop-all' ? 'Stop all' : 'Reconnect errors'}: ${confirmed} confirmed · ${pending} pending · ${failed} failed (${result.total} checked).`;
}

function memberModal(action) {
  if (action === 'grant') {
    return textModal('km:modal:member-upsert', 'Add or update user', [
      { id: 'user_id', label: 'Discord user ID', placeholder: 'Right-click user → Copy User ID', maxLength: 20 },
      { id: 'worker_ids', label: 'Assigned worker IDs (comma separated)', placeholder: 'afk-01, afk-02', required: false, maxLength: 250 },
      { id: 'duration', label: 'Access duration in days or permanent', placeholder: '30', maxLength: 16 },
      { id: 'plan_name', label: 'Plan name', placeholder: 'Standard', required: false, maxLength: 64 }
    ]);
  }
  return textModal(`km:modal:member-${action}`, `${action === 'disable' ? 'Disable' : 'Remove'} user`, [
    { id: 'user_id', label: 'Discord user ID', placeholder: 'Right-click user → Copy User ID', maxLength: 20 }
  ]);
}

async function submitMemberModal(interaction, services, actorRole) {
  const action = interaction.customId;
  const userId = interaction.fields.getTextInputValue('user_id').trim();
  if (action === 'km:modal:member-upsert') {
    const rawIds = interaction.fields.getTextInputValue('worker_ids').trim();
    const workerIds = rawIds ? rawIds.split(',').map((id) => id.trim().toLowerCase()).filter(Boolean) : [];
    const duration = interaction.fields.getTextInputValue('duration').trim().toLowerCase();
    const planName = interaction.fields.getTextInputValue('plan_name').trim() || 'Standard';
    const isPermanent = duration === 'permanent';
    const days = Number(duration);
    if (!isPermanent && (!Number.isInteger(days) || days < 1 || days > 36500)) throw new Error('Duration must be 1–36500 days or permanent.');
    const knownWorkers = new Set((await services.registry.list()).map((worker) => worker.workerId));
    const unknown = workerIds.filter((id) => !knownWorkers.has(id));
    if (unknown.length) throw new Error(`Unknown worker ID(s): ${unknown.join(', ')}`);
    const expiresAt = isPermanent ? null : new Date(Date.now() + days * 86400000).toISOString();
    const member = await services.accessControl.grant(interaction.user.id, userId, {
      role: 'user', workerIds, status: 'active', isPermanent, expiresAt, planName
    }, actorRole);
    await audit(services, interaction.user.id, 'user.upsert', userId, { workerIds, planName, isPermanent, expiresAt });
    return `Saved access for <@${userId}> · ${workerIds.length} worker(s) · ${isPermanent ? 'permanent' : `expires ${new Date(expiresAt).toLocaleDateString('en-GB')}`}. Confirm they hold the configured Discord user role.`;
  }
  if (action === 'km:modal:member-disable') {
    await services.accessControl.updateMember(interaction.user.id, userId, { status: 'disabled' }, actorRole);
    await audit(services, interaction.user.id, 'user.disable', userId);
    return `Disabled access for <@${userId}>.`;
  }
  await services.accessControl.revoke(interaction.user.id, userId, actorRole);
  await audit(services, interaction.user.id, 'user.remove', userId);
  return `Removed <@${userId}> from manager access.`;
}

async function handlePanelInteraction(interaction, services) {
  const customId = interaction.customId || '';
  if (!customId.startsWith(PANEL_PREFIX)) return false;
  const role = services.accessControl.roleFor(interaction.member, interaction);
  const setupSecretAction = customId === 'km:setup:secrets' || customId === 'km:modal:setup-secrets';
  if (!role && !setupSecretAction) {
    await deny(interaction, 'No configured Discord Admin/User role was found. Ask a server admin for the correct role; a User also needs an active grant and worker assignment.');
    return true;
  }
  if (setupSecretAction && role !== 'admin') {
    await deny(interaction, 'Integration secrets can only be changed by the configured manager Admin role.');
    return true;
  }

  try {
    if (customId === 'km:setup:secrets') {
      if (interaction.guildId !== services.config.discordGuildId) return deny(interaction, 'Setup is available only in the configured Discord server.'), true;
      return interaction.showModal(textModal('km:modal:setup-secrets', 'Integration secrets', [
        { id: 'render_api_key', label: 'Render API key (CLEAR removes it)', placeholder: 'Leave blank to keep current value', required: false, maxLength: 4000 },
        { id: 'link4m_api_key', label: 'Link4M API key (CLEAR removes it)', placeholder: 'Leave blank to keep current value', required: false, maxLength: 4000 },
        { id: 'link4m_secret_key', label: 'Link4M webhook secret (CLEAR removes it)', placeholder: 'Leave blank to keep current value', required: false, maxLength: 4000 }
      ])), true;
    }
    if (interaction.isModalSubmit()) {
      if (customId === 'km:modal:setup-secrets') {
        await interaction.deferUpdate();
        const fields = [
          ['render_api_key', 'renderApiKey'],
          ['link4m_api_key', 'link4mApiToken'],
          ['link4m_secret_key', 'link4mSecretKey']
        ];
        const patch = {};
        const changed = [];
        for (const [field, key] of fields) {
          const raw = interaction.fields.getTextInputValue(field).trim();
          if (!raw) continue;
          patch[key] = raw.toUpperCase() === 'CLEAR' ? '' : raw;
          changed.push(key);
        }
        if (!changed.length) return interaction.editReply({ content: 'No integration secret was changed.', components: [], allowedMentions: { parse: [] } }), true;
        const runtime = await services.managerRuntimeSettings.update(patch);
        services.renderApi.apiKey = runtime.renderApiKey;
        services.link4m.config.apiToken = runtime.link4mApiToken;
        services.link4m.config.secretKey = runtime.link4mSecretKey;
        services.config.renderApiKey = runtime.renderApiKey;
        services.config.link4mApiToken = runtime.link4mApiToken;
        services.config.link4mSecretKey = runtime.link4mSecretKey;
        await audit(services, interaction.user.id, 'manager.integration_secrets.update', services.config.discordGuildId, {
          changed, status: services.managerRuntimeSettings.publicStatus()
        });
        return interaction.editReply({
          content: `Updated encrypted integration settings in Supabase. Render API ${runtime.renderApiKey ? 'configured' : 'not set'} · Link4M API ${runtime.link4mApiToken ? 'configured' : 'not set'} · Link4M webhook ${runtime.link4mSecretKey ? 'configured' : 'not set'}.`,
          components: [], allowedMentions: { parse: [] }
        }), true;
      }
      if (customId.startsWith('km:modal:member-')) {
        if (!isAdmin(role)) return deny(interaction, 'Only admins can manage users.'), true;
        await interaction.deferUpdate();
        const notice = await submitMemberModal(interaction, services, role);
        return interaction.editReply({ ...await accessPage(services, role, notice), allowedMentions: { parse: [] } }), true;
      }
      if (customId.startsWith('km:modal:worker-add')) {
        if (!isAdmin(role)) return deny(interaction, 'Only admins can register workers.'), true;
        await interaction.deferUpdate();
        let workerId = '';
        try { workerId = (interaction.fields.getTextInputValue('worker_id') || '').trim().toLowerCase(); } catch (_) {}
        const name = interaction.fields.getTextInputValue('name').trim();
        let provider = 'wispbyte';
        try { provider = (interaction.fields.getTextInputValue('provider') || 'wispbyte').trim().toLowerCase(); } catch (_) {}
        let serviceUrl = '';
        try { serviceUrl = (interaction.fields.getTextInputValue('service_url') || '').trim(); } catch (_) {}
        const result = await services.registry.add({ workerId, name, provider, serviceUrl });
        await audit(services, interaction.user.id, 'worker.register', result.worker.workerId, { provider });
        const embed = new EmbedBuilder().setColor(0x15803d).setTitle('✅ Đã đăng ký Bot thành công')
          .setDescription(`**${safe(result.worker.name)}** (\`#${padId(result.worker.botNumber)}\`) đã sẵn sàng.\n\nKhóa bí mật kết nối (chỉ hiển thị 1 lần):\n\`\`\`\n${result.secret}\n\`\`\`\nNhập giá trị này vào biến \`WORKER_SECRET_1\` hoặc \`WORKER_SECRET_2\` trên host.`);
        return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('km:page:workers').setLabel('Danh sách Bot').setStyle(ButtonStyle.Secondary))] }), true;
      }
      const credentialsSubmit = customId.match(/^km:modal:credentials:(save|start):([a-z0-9_-]{2,40})$/);
      if (credentialsSubmit) {
        const [, mode, workerId] = credentialsSubmit;
        const worker = await services.registry.find(workerId);
        if (!worker || !(await hasWorkerAccess(services, interaction.user.id, worker, role))) return deny(interaction, 'You do not have access to this worker.'), true;
        await interaction.deferUpdate();
        const username = interaction.fields.getTextInputValue('username').trim();
        const password = interaction.fields.getTextInputValue('password');
        const saved = await services.registry.updateCredentials(workerId, { username, password });
        await audit(services, interaction.user.id, 'worker.credentials.update', workerId, {
          usernameChanged: true, passwordChanged: Boolean(password)
        });
        let notice = `Minecraft account saved for ${safe(saved.username, 48)}.`;
        if (mode === 'start') {
          try {
            const result = await services.broker.dispatch(workerId, 'start');
            await audit(services, interaction.user.id, 'worker.start', workerId, { timedOut: Boolean(result.timedOut) });
            notice += result.timedOut ? ' Start was sent; the worker has not reported a result yet.' : ' Start was sent to the worker.';
          } catch (error) {
            notice += ` Start could not be sent: ${safe(error.message, 160)}.`;
          }
        }
        return interaction.editReply({ ...await workerDetail(services, interaction.user.id, workerId, role, notice), allowedMentions: { parse: [] } }), true;
      }

      if (customId.startsWith('km:modal:chat:')) {
        const workerId = customId.slice('km:modal:chat:'.length);
        const worker = await services.registry.find(workerId);
        if (!worker || !(await hasWorkerAccess(services, interaction.user.id, worker, role))) return deny(interaction, 'You do not have access to this worker.'), true;
        await interaction.deferUpdate();
        const message = interaction.fields.getTextInputValue('message').trim();
        const result = await services.broker.dispatch(workerId, 'chat', { message });
        await audit(services, interaction.user.id, 'worker.chat', workerId, { messageLength: message.length });
        const notice = result.timedOut ? 'Tin nhắn đã được xếp hàng gửi.' : `💬 Đã gửi vào game: "${safe(message, 60)}"`;
        return interaction.editReply({ ...await workerDetail(services, interaction.user.id, workerId, role, notice), allowedMentions: { parse: [] } }), true;
      }
      if (customId.startsWith('km:modal:worker-proxy:')) {
        const workerId = customId.slice('km:modal:worker-proxy:'.length);
        const worker = await services.registry.find(workerId);
        if (!worker || !(await hasWorkerAccess(services, interaction.user.id, worker, role))) return deny(interaction, 'You do not have access to this worker.'), true;
        await interaction.deferUpdate();
        const proxyUrl = interaction.fields.getTextInputValue('proxy_url').trim();
        if (proxyUrl && worker.status?.restriction) throw new Error('Proxy changes are paused while this worker is on a server restriction hold.');
        const previous = await services.registry.privateSettings(workerId);
        await services.registry.updateSettings(workerId, { proxyUrl });
        let result;
        try { result = await services.broker.dispatch(workerId, 'set-proxy', { url: proxyUrl }); }
        catch (error) { await services.registry.updateSettings(workerId, { proxyUrl: previous?.proxyUrl || '', proxyManaged: previous?.proxyManaged }); throw error; }
        if (result.result?.ok === false || result.result?.detail?.ok === false) {
          await services.registry.updateSettings(workerId, { proxyUrl: previous?.proxyUrl || '', proxyManaged: previous?.proxyManaged });
          throw new Error(result.result?.error || result.result?.detail?.error || 'Worker rejected the proxy setting.');
        }
        await audit(services, interaction.user.id, 'worker.proxy', workerId, { enabled: Boolean(proxyUrl) });
        const notice = result.timedOut ? `Proxy setting saved; worker sync is pending (${proxyUrl ? 'enabled' : 'disabled'}).` : `Proxy ${proxyUrl ? 'enabled' : 'disabled'}.`;
        return interaction.editReply({ ...await workerDetail(services, interaction.user.id, workerId, role, notice), allowedMentions: { parse: [] } }), true;
      }
      return true;
    }

    if (interaction.isStringSelectMenu() && customId === 'km:worker:select') {
      const workerId = interaction.values[0];
      return showWorker(interaction, services, role, workerId), true;
    }

    if (!interaction.isButton()) return true;
    if (customId === 'km:page:overview' || customId === 'km:page:refresh') return safeUpdate(interaction, await overview(services, interaction.user.id, role)), true;
    if (customId === 'km:page:workers') return safeUpdate(interaction, await workersPage(services, interaction.user.id, role)), true;
    if (customId === 'km:page:access') {
      if (!isAdmin(role)) return deny(interaction, 'Only admins can view member access.'), true;
      return safeUpdate(interaction, await accessPage(services, role)), true;
    }
    if (customId === 'km:page:audit') {
      if (!isAdmin(role)) return deny(interaction, 'Only admins can view activity logs.'), true;
      return safeUpdate(interaction, await auditPage(services, role)), true;
    }
    if (customId === 'km:workers:add') {
      if (!isAdmin(role)) return deny(interaction, 'Only admins can register workers.'), true;
      return interaction.showModal(textModal('km:modal:worker-add', 'Đăng ký Bot mới', [
        { id: 'name', label: 'Tên hiển thị bot (VD: KingMC Bot 1)', placeholder: 'KingMC Bot 1', maxLength: 64 },
        { id: 'worker_id', label: 'Mã Bot (để trống tự gán 01, 02...)', placeholder: '01', required: false, maxLength: 40 },
        { id: 'provider', label: 'Nền tảng (wispbyte hoặc render)', placeholder: 'wispbyte', required: false, maxLength: 12 },
        { id: 'service_url', label: 'URL Render HTTPS (tùy chọn)', placeholder: 'https://worker.example.com', required: false, maxLength: 200 }
      ])), true;
    }
    if (customId === 'km:fleet:stop-all' || customId === 'km:fleet:reconnect-errors' || customId === 'km:fleet:clean-dead') {
      if (!isAdmin(role)) return deny(interaction, 'Only admins can run fleet operations.'), true;
      const action = customId.slice('km:fleet:'.length);
      return safeUpdate(interaction, fleetConfirmation(action)), true;
    }
    if (customId.startsWith('km:fleet:confirm:')) {
      if (!isAdmin(role)) return deny(interaction, 'Only admins can run fleet operations.'), true;
      const action = customId.slice('km:fleet:confirm:'.length);
      if (!Object.hasOwn(FLEET_CONFIRMATIONS, action)) return deny(interaction, 'Unknown fleet operation.'), true;
      await interaction.deferUpdate();
      const result = action === 'stop-all' ? await services.fleetOperations.stopAll()
        : action === 'reconnect-errors' ? await services.fleetOperations.reconnectErrors() : await services.fleetOperations.cleanDead();
      const notice = fleetNotice(action, result);
      await audit(services, interaction.user.id, `worker.${action}`, '', result);
      return interaction.editReply({ ...await workersPage(services, interaction.user.id, role, notice), allowedMentions: { parse: [] } }), true;
    }
    if (customId === 'km:fleet:cancel') return safeUpdate(interaction, await workersPage(services, interaction.user.id, role, 'Fleet action cancelled.')), true;
    if (customId === 'km:access:grant' || customId === 'km:access:disable' || customId === 'km:access:revoke') {
      if (!isAdmin(role)) return deny(interaction, 'Only admins can manage users.'), true;
      const action = customId.slice('km:access:'.length);
      return interaction.showModal(memberModal(action)), true;
    }

    const chatMatch = customId.match(/^km:worker:chat:([a-z0-9_-]{2,40})$/);
    if (chatMatch) {
      const worker = await services.registry.find(chatMatch[1]);
      if (!worker || !(await hasWorkerAccess(services, interaction.user.id, worker, role))) return deny(interaction, 'Bạn không có quyền truy cập bot này.'), true;
      return interaction.showModal(textModal(`km:modal:chat:${chatMatch[1]}`, `💬 Gửi chat (#${worker.botNumber} ${worker.name})`, [
        { id: 'message', label: 'Tin nhắn hoặc lệnh (/spawn, /pay, hello...)', placeholder: 'Nhập tin nhắn để bot gửi vào server game...', maxLength: 256 }
      ])), true;
    }
    const proxyMatch = customId.match(/^km:worker:proxy:([a-z0-9_-]{2,40})$/);
    if (proxyMatch) {
      const workerId = proxyMatch[1];
      const worker = await services.registry.find(workerId);
      if (!worker || !(await hasWorkerAccess(services, interaction.user.id, worker, role))) return deny(interaction, 'You do not have access to this worker.'), true;
      return interaction.showModal(textModal(`km:modal:worker-proxy:${workerId}`, 'Set SOCKS5 proxy', [
        { id: 'proxy_url', label: 'SOCKS5 URL (blank clears it)', placeholder: 'socks5://user:password@host:1080', required: false, maxLength: 512 }
      ])), true;
    }
    const credentialsMatch = customId.match(/^km:worker:credentials:([a-z0-9_-]{2,40})$/);
    if (credentialsMatch) {
      const workerId = credentialsMatch[1];
      const worker = await services.registry.find(workerId);
      if (!worker || !(await hasWorkerAccess(services, interaction.user.id, worker, role))) return deny(interaction, 'You do not have access to this worker.'), true;
      const privateSettings = await services.registry.privateSettings(workerId);
      return interaction.showModal(textModal(`km:modal:credentials:save:${workerId}`, 'Minecraft account', [
        { id: 'username', label: 'Minecraft username', value: privateSettings?.username || '', maxLength: 64 },
        { id: 'password', label: 'Password (blank keeps saved value)', placeholder: 'Enter a new password only to change it', required: false, maxLength: 256 }
      ])), true;
    }
    const actionMatch = customId.match(/^km:worker:action:(start|stop|restart|status):([a-z0-9_-]{2,40})$/);
    if (actionMatch) {
      const [, action, workerId] = actionMatch;
      const worker = await services.registry.find(workerId);
      if (!worker || !(await hasWorkerAccess(services, interaction.user.id, worker, role))) return deny(interaction, 'You do not have access to this worker, or your user access is inactive.'), true;
      if (action === 'start') {
        const privateSettings = await services.registry.privateSettings(workerId);
        if (!privateSettings?.credentialsConfigured) {
          return interaction.showModal(textModal(`km:modal:credentials:start:${workerId}`, 'Set account, then start', [
            { id: 'username', label: 'Minecraft username', maxLength: 64 },
            { id: 'password', label: 'Minecraft password', maxLength: 256 }
          ])), true;
        }
      }
      await interaction.deferUpdate();
      if (action === 'status') {
        if (worker.provider === 'render') await services.broker.status(worker);
        return interaction.editReply({ ...await workerDetail(services, interaction.user.id, workerId, role, '🔄 Đã làm mới trạng thái.'), allowedMentions: { parse: [] } }), true;
      }
      const result = await services.broker.dispatch(workerId, action);
      await audit(services, interaction.user.id, `worker.${action}`, workerId, { timedOut: Boolean(result.timedOut) });
      const actionLabels = { start: 'Bật bot', stop: 'Tắt bot', restart: 'Khởi động lại' };
      const actionName = actionLabels[action] || action;
      const notice = result.timedOut ? `⏳ Lệnh ${actionName} đã gửi nhưng bot phản hồi chậm. Vui lòng làm mới sau giây lát.`
        : result.result?.ok === false ? `❌ Lệnh ${actionName} thất bại: ${safe(result.result.error || 'worker error', 120)}`
          : `✅ Đã thực hiện ${actionName} thành công.`;
      return interaction.editReply({ ...await workerDetail(services, interaction.user.id, workerId, role, notice), allowedMentions: { parse: [] } }), true;
    }

    const resetMatch = customId.match(/^km:worker:reset:([a-z0-9_-]{2,40})$/);
    if (resetMatch) {
      if (!isAdmin(role)) return deny(interaction, 'Only admins can reset worker data.'), true;
      return safeUpdate(interaction, resetConfirmation(resetMatch[1])), true;
    }
    const resetConfirmMatch = customId.match(/^km:worker:reset-confirm:([a-z0-9_-]{2,40})$/);
    if (resetConfirmMatch) {
      if (!isAdmin(role)) return deny(interaction, 'Only admins can reset worker data.'), true;
      const workerId = resetConfirmMatch[1];
      await interaction.deferUpdate();
      const result = await services.broker.dispatch(workerId, 'reset');
      await audit(services, interaction.user.id, 'worker.reset', workerId, { timedOut: Boolean(result.timedOut) });
      const detail = result.result?.detail || result.result || {};
      const notice = result.timedOut ? 'Reset command queued; waiting for the worker acknowledgement.'
        : detail.ok === false ? `Reset failed: ${safe(detail.error || 'worker error', 160)}`
          : 'Reset acknowledged; account credentials, recent events, and counters were cleared. AFK and proxy settings were kept.';
      return interaction.editReply({ ...await workerDetail(services, interaction.user.id, workerId, role, notice), allowedMentions: { parse: [] } }), true;
    }
    const resetCancelMatch = customId.match(/^km:worker:reset-cancel:([a-z0-9_-]{2,40})$/);
    if (resetCancelMatch) return showWorker(interaction, services, role, resetCancelMatch[1], 'Reset cancelled.'), true;

    const rotateMatch = customId.match(/^km:worker:rotate:([a-z0-9_-]{2,40})$/);
    if (rotateMatch) {
      if (!isAdmin(role)) return deny(interaction, 'Only admins can rotate worker secrets.'), true;
      const workerId = rotateMatch[1];
      await interaction.deferUpdate();
      const secret = await services.registry.rotateSecret(workerId);
      await audit(services, interaction.user.id, 'worker.rotate-secret', workerId);
      const panel = new EmbedBuilder().setColor(0xd97706).setTitle('Worker secret rotated')
        .setDescription(`Set this new value as the matching \`WORKER_SECRET_1\` or \`WORKER_SECRET_2\` on ${safe(workerId)}. The old secret stopped working.\n\n\`\`\`\n${secret}\n\`\`\`\nThis value is shown once.`);
      return interaction.editReply({ embeds: [panel], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`km:worker:action:status:${workerId}`).setLabel('Return to worker').setStyle(ButtonStyle.Secondary))] }), true;
    }

    const removeMatch = customId.match(/^km:worker:remove:([a-z0-9_-]{2,40})$/);
    if (removeMatch) {
      if (!isAdmin(role)) return deny(interaction, 'Only admins can remove workers.'), true;
      return safeUpdate(interaction, removeConfirmation(removeMatch[1])), true;
    }
    const confirmMatch = customId.match(/^km:worker:remove-confirm:([a-z0-9_-]{2,40})$/);
    if (confirmMatch) {
      if (!isAdmin(role)) return deny(interaction, 'Only admins can remove workers.'), true;
      const workerId = confirmMatch[1];
      await interaction.deferUpdate();
      let stopConfirmed = false;
      try {
        const result = await services.broker.dispatch(workerId, 'stop');
        stopConfirmed = !result.timedOut && result.result?.ok !== false && result.result?.detail?.ok !== false;
      } catch (error) { services.logger.warn('worker_stop_before_remove_failed', { workerId, name: error.name || 'Error' }); }
      services.broker.cancelWorker(workerId);
      await services.registry.remove(workerId);
      await audit(services, interaction.user.id, 'worker.remove', workerId, { stopConfirmed });
      return interaction.editReply({ ...await workersPage(services, interaction.user.id, role), allowedMentions: { parse: [] } }), true;
    }
    const cancelMatch = customId.match(/^km:worker:remove-cancel:([a-z0-9_-]{2,40})$/);
    if (cancelMatch) return showWorker(interaction, services, role, cancelMatch[1]), true;
    return true;
  } catch (error) {
    services.logger.warn('dashboard_interaction_failed', { actorId: interaction.user.id, customId: customId.slice(0, 80), message: error.message });
    const response = { content: `Action failed: ${String(error.message || 'unknown error').slice(0, 800)}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(() => {});
    else await interaction.reply(response).catch(() => {});
    return true;
  }
}

module.exports = { handlePanelInteraction };
