'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const checkCommand = require('../src/discord/commands/check');
const adminCommand = require('../src/discord/commands/admin');
const { collectSystemStatus, StatusMonitorService } = require('../src/discord/status-monitor');
const { renderStatusMonitorPanel, renderProgressBar } = require('../src/discord/panels/renderer');
const { handlePanelInteraction } = require('../src/discord/handlers/panel-handler');

test('STATUS-MONITOR-01: /admin subcommands status, health, and bots are removed', () => {
  const json = adminCommand.data.toJSON();
  const subcommands = (json.options || []).map((opt) => opt.name);
  
  assert.ok(!subcommands.includes('status'), '/admin status must be removed');
  assert.ok(!subcommands.includes('health'), '/admin health must be removed');
  assert.ok(!subcommands.includes('bots'), '/admin bots must be removed');
  assert.ok(subcommands.includes('setup'), '/admin setup must be retained');
  assert.ok(subcommands.includes('password'), '/admin password must be retained');
});

test('STATUS-MONITOR-02: renderProgressBar computes percentages and visual blocks correctly', () => {
  assert.strictEqual(renderProgressBar(0, 0), '`[⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜]` **0%**');
  assert.strictEqual(renderProgressBar(0, 10), '`[⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜]` **0%**');
  assert.strictEqual(renderProgressBar(5, 10), '`[🟩🟩🟩🟩🟩⬜⬜⬜⬜⬜]` **50%**');
  assert.strictEqual(renderProgressBar(10, 10), '`[🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩]` **100%**');
  assert.strictEqual(renderProgressBar(8, 10), '`[🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜]` **80%**');
});

test('STATUS-MONITOR-03: collectSystemStatus collects bot counts and system health metrics', async () => {
  const mockServices = {
    registry: {
      list: async () => [
        { workerId: '01', status: { online: true, state: 'online' } },
        { workerId: '02', status: { online: true, state: 'afk' } },
        { workerId: '03', status: { online: false, state: 'offline' } }
      ]
    },
    accessStore: {
      adapter: {
        testConnection: async () => ({ ok: true })
      }
    },
    discordClient: {
      isReady: () => true,
      ws: { ping: 35 }
    },
    config: {
      publicBaseUrl: 'https://manager.kingmc.test'
    }
  };

  const status = await collectSystemStatus(mockServices);
  assert.strictEqual(status.managerOk, true);
  assert.strictEqual(status.totalWorkers, 3);
  assert.strictEqual(status.onlineWorkers, 2);
  assert.strictEqual(status.offlineWorkers, 1);
  assert.strictEqual(status.totalUsers, 0);
  assert.strictEqual(status.activeUsers, 0);
  assert.strictEqual(status.expiredUsers, 0);
  assert.strictEqual(status.dbOk, true);
  assert.ok(status.dbLatencyMs >= 0);
  assert.strictEqual(status.discordReady, true);
  assert.strictEqual(status.discordPing, 35);
  assert.strictEqual(status.publicBaseUrl, 'https://manager.kingmc.test');
  assert.ok(status.uptimeFormatted);
  assert.ok(status.rssMb >= 0);
  assert.ok(status.checkedAt);
  assert.ok(status.nextCheckAtUnix > status.checkedAtUnix);
});

test('STATUS-MONITOR-04: renderStatusMonitorPanel renders Online/Offline only, user stats, timestamps, and core-service health', () => {
  const panel = renderStatusMonitorPanel({
    managerOk: true,
    totalWorkers: 10,
    onlineWorkers: 0,
    offlineWorkers: 10,
    totalUsers: 15,
    activeUsers: 11,
    expiredUsers: 4,
    permanentUsers: 2,
    dbOk: true,
    dbLatencyMs: 12,
    discordReady: true,
    discordPing: 25,
    uptimeFormatted: '2d 04h 10m',
    rssMb: 110,
    heapUsedMb: 55,
    platform: 'linux',
    nodeVersion: 'v20.0.0',
    publicBaseUrl: 'https://manager.kingmc.test'
  });

  assert.ok(panel.embeds && panel.embeds.length === 1);
  const embed = panel.embeds[0].data;
  assert.strictEqual(embed.title, '📊 BẢNG THEO DÕI TRẠNG THÁI HỆ THỐNG — KINGMC 24/7');
  assert.strictEqual(embed.color, 0x22c55e, 'Healthy Manager + Supabase + Discord must be green even if all bots are offline');
  assert.ok(embed.description.includes('TỐT'), 'Core-healthy status must say TỐT');
  assert.ok(embed.description.includes('Kiểm tra lúc:'), 'Must show check timestamp');

  const allFieldText = (embed.fields || []).map((f) => `${f.name}\n${f.value}`).join('\n');
  assert.ok(!allFieldText.includes('AFK'), 'Must NOT display AFK label');
  assert.ok(!allFieldText.includes('Lỗi'), 'Must NOT display Lỗi label on bot status');
  assert.ok(!allFieldText.toUpperCase().includes('FLEET'), 'Must NOT display FLEET');
  assert.ok(allFieldText.includes('Online: 🟢 **0**'), 'Must show Online count');
  assert.ok(allFieldText.includes('Offline: 🔴 **10**'), 'Must show Offline count');
  assert.ok(allFieldText.includes('Còn hạn: 🟢 **11**'), 'Must show active user count');
  assert.ok(allFieldText.includes('Hết hạn: 🔴 **4**'), 'Must show expired user count');
  assert.ok(allFieldText.includes('Cơ sở dữ liệu (Supabase): 🟢 Kết nối tốt'), 'Must show Supabase healthy status');
  assert.ok(allFieldText.includes('Discord Gateway: 🟢 Kết nối tốt'), 'Must show Discord healthy status');

  const degradedPanel = renderStatusMonitorPanel({
    managerOk: true,
    totalWorkers: 5,
    onlineWorkers: 5,
    offlineWorkers: 0,
    dbOk: false,
    discordReady: true
  });
  assert.strictEqual(degradedPanel.embeds[0].data.color, 0xef4444, 'Must turn red when Supabase fails even if all bots are online');

  assert.ok(panel.components && panel.components.length === 1);
  const rowButtons = panel.components[0].components;
  assert.strictEqual(rowButtons[0].data.custom_id, 'status_monitor:refresh');
  assert.strictEqual(rowButtons[1].data.url, 'https://manager.kingmc.test');
});

test('STATUS-MONITOR-05: /check command restricts access to Admin only', async () => {
  const mockServices = {
    config: { adminUserId: 'admin_user_123' },
    accessControl: { roleFor: () => 'user' },
    accessStore: { getUserByDiscordId: async () => ({ role: 'user' }) }
  };

  // 1. Non-admin execution -> Denied
  const nonAdminInteraction = {
    user: { id: 'random_user_456' },
    guild: { ownerId: 'other_owner' },
    memberPermissions: { has: () => false },
    deferred: false
  };
  const deniedRes = await checkCommand.execute(nonAdminInteraction, mockServices);
  assert.ok(deniedRes?.embeds?.[0]?.data?.title?.includes('TỪ CHỐI TRUY CẬP'));

  // 2. Admin execution -> Saves tracking and returns panel
  let savedSettingKey = null;
  let savedSettingVal = null;
  const adminServices = {
    ...mockServices,
    registry: { list: async () => [] },
    accessStore: {
      adapter: { testConnection: async () => ({ ok: true }) },
      getUserByDiscordId: async () => ({ role: 'admin' }),
      setSetting: async (key, val) => {
        savedSettingKey = key;
        savedSettingVal = val;
      }
    },
    discordClient: { isReady: () => true, ws: { ping: 20 } }
  };

  let editedPayload = null;
  const adminInteraction = {
    user: { id: 'admin_user_123' },
    guildId: 'guild_001',
    channelId: 'channel_001',
    guild: { ownerId: 'admin_user_123' },
    deferred: true,
    editReply: async (payload) => {
      editedPayload = payload;
      return { id: 'msg_999999' };
    },
    fetchReply: async () => ({ id: 'msg_999999' })
  };

  await checkCommand.execute(adminInteraction, adminServices);
  assert.ok(editedPayload?.embeds?.[0]?.data?.title?.includes('BẢNG THEO DÕI TRẠNG THÁI HỆ THỐNG'));
  assert.strictEqual(savedSettingKey, 'discord_status_monitor');
  assert.strictEqual(savedSettingVal?.messageId, 'msg_999999');
  assert.strictEqual(savedSettingVal?.channelId, 'channel_001');
});

test('STATUS-MONITOR-06: status_monitor:refresh button enforces Admin permissions', async () => {
  let repliedEphemeral = null;
  let updatedMessage = null;
  let deferredUpdate = false;

  const mockServices = {
    config: { adminUserId: 'admin_999', discordGuildId: 'guild_mon_1' },
    accessControl: { roleFor: () => 'user' },
    accessStore: {
      adapter: { testConnection: async () => ({ ok: true }) },
      getUserByDiscordId: async (id) => (id === 'admin_999' ? { role: 'admin' } : { role: 'user' })
    },
    registry: { list: async () => [] },
    discordClient: { isReady: () => true, ws: { ping: 15 } }
  };

  // 1. Non-admin clicks status_monitor:refresh -> Ephemeral error, message NOT updated
  const nonAdminInteraction = {
    guildId: 'guild_mon_1',
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    customId: 'status_monitor:refresh',
    user: { id: 'stranger_111' },
    memberPermissions: { has: () => false },
    guild: { id: 'guild_mon_1', ownerId: 'owner_222' },
    deferred: false,
    replied: false,
    reply: async (payload) => { repliedEphemeral = payload; },
    deferUpdate: async () => { deferredUpdate = true; },
    update: async (payload) => { updatedMessage = payload; }
  };

  await handlePanelInteraction(nonAdminInteraction, mockServices);
  assert.ok(repliedEphemeral?.content?.includes('Chỉ Quản trị viên (Admin) mới có quyền làm mới'));
  assert.strictEqual(deferredUpdate, false);
  assert.strictEqual(updatedMessage, null);

  // 2. Admin clicks status_monitor:refresh -> Defer update & update message
  deferredUpdate = false;
  const adminInteraction = {
    guildId: 'guild_mon_1',
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    customId: 'status_monitor:refresh',
    user: { id: 'admin_999' },
    memberPermissions: { has: () => true },
    guild: { id: 'guild_mon_1', ownerId: 'admin_999' },
    deferred: false,
    replied: false,
    reply: async () => {},
    deferUpdate: async () => { deferredUpdate = true; },
    update: async (payload) => { updatedMessage = payload; }
  };

  await handlePanelInteraction(adminInteraction, mockServices);
  assert.strictEqual(deferredUpdate, true);
  assert.ok(updatedMessage?.embeds?.[0]?.data?.title?.includes('BẢNG THEO DÕI TRẠNG THÁI HỆ THỐNG'));
});

test('STATUS-MONITOR-07: StatusMonitorService loads tracking, updates message, and stops cleanly', async () => {
  let messageEdited = null;
  const mockMessage = {
    edit: async (payload) => { messageEdited = payload; }
  };
  const mockChannel = {
    messages: {
      fetch: async (id) => (id === 'msg_auto_1' ? mockMessage : null)
    }
  };
  const mockClient = {
    isReady: () => true,
    ws: { ping: 25 },
    channels: {
      fetch: async (id) => (id === 'chan_auto_1' ? mockChannel : null)
    }
  };

  const mockServices = {
    accessStore: {
      getSetting: async (key) => {
        if (key === 'discord_status_monitor') {
          return { channelId: 'chan_auto_1', messageId: 'msg_auto_1' };
        }
        return null;
      },
      adapter: { testConnection: async () => ({ ok: true }) }
    },
    registry: { list: async () => [] },
    discordClient: mockClient
  };

  const monitor = new StatusMonitorService({ services: mockServices, intervalMs: 50 });
  await monitor.loadTrackedMessage();
  assert.deepStrictEqual(monitor.getTrackedMessage(), {
    guildId: null,
    channelId: 'chan_auto_1',
    messageId: 'msg_auto_1'
  });

  await monitor.updateMessage();
  assert.ok(messageEdited?.embeds?.[0]?.data?.title?.includes('BẢNG THEO DÕI TRẠNG THÁI HỆ THỐNG'));

  monitor.stop();
  assert.strictEqual(monitor.timer, null);
});
