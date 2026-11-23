'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const kbotCommand = require('../src/discord/commands/kbot');
const { handlePanelInteraction } = require('../src/discord/handlers/panel-handler');

test('KBOT-COMMAND-01: command definition and permissions check', async () => {
  assert.strictEqual(kbotCommand.data.name, 'kbot');
  assert.ok(kbotCommand.data.description.includes('máy chủ'));
  assert.strictEqual(kbotCommand.ephemeral, true, '/kbot must default to ephemeral to protect sensitive guild data');
});

test('KBOT-COMMAND-02: getGuildInvite respects vanity URL and channel permissions', async () => {
  // 1. Vanity URL
  const vanityGuild = {
    vanityURLCode: 'kingmc-pro'
  };
  const vanityUrl = await kbotCommand.getGuildInvite(vanityGuild);
  assert.strictEqual(vanityUrl, 'https://discord.gg/kingmc-pro');

  // 2. Channel createInvite permission
  let inviteCreatedWith = null;
  const channelGuild = {
    channels: {
      cache: [
        {
          isTextBased: () => true,
          permissionsFor: () => ({ has: () => true }),
          createInvite: async (opts) => {
            inviteCreatedWith = opts;
            return { url: 'https://discord.gg/test-invite-abc' };
          }
        }
      ]
    },
    members: { me: { id: 'bot_me' } }
  };
  const channelUrl = await kbotCommand.getGuildInvite(channelGuild);
  assert.strictEqual(channelUrl, 'https://discord.gg/test-invite-abc');
  assert.strictEqual(inviteCreatedWith?.maxAge, 3600);
  assert.strictEqual(inviteCreatedWith?.maxUses, 1);

  // 3. No permission
  const noPermGuild = {
    channels: {
      cache: [
        {
          isTextBased: () => true,
          permissionsFor: () => ({ has: () => false }),
          createInvite: async () => { throw new Error('Missing Permissions'); }
        }
      ]
    },
    members: { me: { id: 'bot_me' } }
  };
  const noPermUrl = await kbotCommand.getGuildInvite(noPermGuild);
  assert.strictEqual(noPermUrl, '*(Không có quyền tạo link mời)*');
});

test('KBOT-COMMAND-03: renderKbotServerList formats guilds, members, and invites', async () => {
  const mockGuilds = new Map([
    ['g1', {
      id: '111111111111111111',
      name: 'Server Cộng Đồng KingMC',
      memberCount: 5200,
      ownerId: '999999999999999999',
      vanityURLCode: 'kingmc',
      channels: { cache: [] }
    }],
    ['g2', {
      id: '222222222222222222',
      name: 'KingMC Private Testing',
      memberCount: 15,
      ownerId: '888888888888888888',
      vanityURLCode: null,
      channels: { cache: [] }
    }]
  ]);

  const mockClient = {
    guilds: {
      fetch: async () => mockGuilds,
      cache: mockGuilds
    }
  };

  const panel = await kbotCommand.renderKbotServerList(mockClient);
  assert.ok(panel.embeds && panel.embeds.length === 1);
  const embed = panel.embeds[0].data;
  assert.strictEqual(embed.title, '🌐 DANH SÁCH MÁY CHỦ DISCORD — KBOT SYSTEM');
  assert.ok(embed.description.includes('**Tổng số máy chủ:** **2** server'));
  assert.ok(embed.description.includes('Server Cộng Đồng KingMC'));
  assert.ok(embed.description.includes('https://discord.gg/kingmc'));
  assert.ok(embed.description.includes('KingMC Private Testing'));
  assert.ok(embed.description.includes('`222222222222222222`'));

  assert.ok(panel.components && panel.components.length === 1);
  assert.strictEqual(panel.components[0].components[0].data.custom_id, 'kbot:refresh_servers');
});

test('KBOT-COMMAND-04: /kbot command restricts execution to Admin only', async () => {
  const mockServices = {
    config: { adminUserId: 'admin_master_1', discordGuildId: '111' },
    accessControl: { roleFor: () => 'user' },
    accessStore: { getUserByDiscordId: async () => ({ role: 'user' }) }
  };

  // 1. Non-admin execution -> Denied
  const nonAdminInteraction = {
    user: { id: 'stranger_user' },
    guild: { ownerId: 'other_owner' },
    memberPermissions: { has: () => false },
    deferred: false
  };
  const deniedRes = await kbotCommand.execute(nonAdminInteraction, mockServices);
  assert.ok(deniedRes?.embeds?.[0]?.data?.title?.includes('TỪ CHỐI TRUY CẬP'));

  // 2. Admin execution -> Returns server list
  const mockGuilds = new Map([
    ['g1', { id: '111', name: 'Admin Test Guild', memberCount: 10, vanityURLCode: 'test' }]
  ]);
  const adminServices = {
    ...mockServices,
    accessStore: { getUserByDiscordId: async () => ({ role: 'admin' }) },
    discordClient: {
      guilds: {
        fetch: async () => mockGuilds,
        cache: mockGuilds
      }
    }
  };
  const adminInteraction = {
    guildId: '111',
    user: { id: 'admin_master_1' },
    guild: { id: '111', ownerId: 'admin_master_1' },
    memberPermissions: { has: () => true },
    client: adminServices.discordClient
  };

  const allowedRes = await kbotCommand.execute(adminInteraction, adminServices);
  assert.ok(allowedRes?.embeds?.[0]?.data?.description?.includes('Admin Test Guild'));
});

test('KBOT-COMMAND-05: kbot:refresh_servers button enforces Admin permissions', async () => {
  let repliedEphemeral = null;
  let updatedMessage = null;
  let deferredUpdate = false;

  const mockGuilds = new Map([
    ['g1', { id: 'g1', name: 'Refreshed Guild', memberCount: 100, vanityURLCode: 'ref' }]
  ]);
  const mockServices = {
    config: { adminUserId: 'super_admin', discordGuildId: 'g1' },
    accessControl: { roleFor: () => 'user' },
    accessStore: {
      getUserByDiscordId: async (id) => (id === 'super_admin' ? { role: 'admin' } : { role: 'user' })
    },
    discordClient: {
      guilds: {
        fetch: async () => mockGuilds,
        cache: mockGuilds
      }
    }
  };

  // 1. Non-admin clicks -> Ephemeral rejection
  const nonAdminInteraction = {
    guildId: 'g1',
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    customId: 'kbot:refresh_servers',
    user: { id: 'normal_user' },
    memberPermissions: { has: () => false },
    guild: { id: 'g1', ownerId: 'other_owner' },
    deferred: false,
    replied: false,
    reply: async (payload) => { repliedEphemeral = payload; },
    deferUpdate: async () => { deferredUpdate = true; },
    update: async (payload) => { updatedMessage = payload; }
  };

  await handlePanelInteraction(nonAdminInteraction, mockServices);
  assert.ok(repliedEphemeral?.content?.includes('Chỉ Quản trị viên (Admin) mới có quyền'));
  assert.strictEqual(deferredUpdate, false);
  assert.strictEqual(updatedMessage, null);

  // 2. Admin clicks -> Defer update & refresh
  deferredUpdate = false;
  const adminInteraction = {
    guildId: 'g1',
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    customId: 'kbot:refresh_servers',
    user: { id: 'super_admin' },
    memberPermissions: { has: () => true },
    guild: { id: 'g1', ownerId: 'super_admin' },
    deferred: false,
    replied: false,
    reply: async () => {},
    deferUpdate: async () => { deferredUpdate = true; },
    update: async (payload) => { updatedMessage = payload; }
  };

  await handlePanelInteraction(adminInteraction, mockServices);
  assert.strictEqual(deferredUpdate, true);
  assert.ok(updatedMessage?.embeds?.[0]?.data?.description?.includes('Refreshed Guild'));
});
