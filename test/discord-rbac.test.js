'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getEffectiveRoleIds,
  addMemberRole,
  removeMemberRole,
  hasAuthorizedRole,
  handlePanelInteraction
} = require('../src/discord/handlers/panel-handler');
const { attachInteractionHandler } = require('../src/discord/handlers/interaction-handler');
const logoutCommand = require('../src/discord/commands/logout');
const loginCommand = require('../src/discord/commands/login');

test('DISCORD-RBAC-01: hasAuthorizedRole correctly identifies role status', async () => {
  const mockServices = {
    config: { discordGuildId: 'guild_rbac_1', adminRoleId: '111111111111111111', userRoleId: '222222222222222222', adminUserId: '999999999999999999' },
    accessControl: { adminRoleId: '111111111111111111', userRoleId: '222222222222222222' }
  };

  // 1. Unprivileged user without roles -> FALSE
  const unprivInteraction = {
    guildId: 'guild_rbac_1',
    user: { id: '333333333333333333' },
    member: { roles: { cache: new Map() } },
    guild: { id: 'guild_rbac_1', ownerId: '888888888888888888' }
  };
  assert.strictEqual(await hasAuthorizedRole(unprivInteraction, mockServices), false);

  // 2. User with user_role -> TRUE
  const userInteraction = {
    guildId: 'guild_rbac_1',
    user: { id: '333333333333333333' },
    member: { roles: { cache: new Map([['222222222222222222', {}]]) } },
    guild: { id: 'guild_rbac_1', ownerId: '888888888888888888' }
  };
  assert.strictEqual(await hasAuthorizedRole(userInteraction, mockServices), true);

  // 3. User with admin_role -> TRUE
  const adminInteraction = {
    guildId: 'guild_rbac_1',
    user: { id: '444444444444444444' },
    member: { roles: { cache: new Map([['111111111111111111', {}]]) } },
    guild: { id: 'guild_rbac_1', ownerId: '888888888888888888' }
  };
  assert.strictEqual(await hasAuthorizedRole(adminInteraction, mockServices), true);

  // 4. Guild Owner WITHOUT configured role or adminUserId -> FALSE (strict RBAC: only configured role & env ID)
  const ownerInteraction = {
    guildId: 'guild_rbac_1',
    user: { id: '888888888888888888' },
    member: { roles: { cache: new Map() } },
    guild: { id: 'guild_rbac_1', ownerId: '888888888888888888' }
  };
  assert.strictEqual(await hasAuthorizedRole(ownerInteraction, mockServices), false);

  // 5. Configured adminUserId -> TRUE
  const configuredAdminInteraction = {
    guildId: 'guild_rbac_1',
    user: { id: '999999999999999999' },
    member: { roles: { cache: new Map() } },
    guild: { id: 'guild_rbac_1', ownerId: '888888888888888888' }
  };
  assert.strictEqual(await hasAuthorizedRole(configuredAdminInteraction, mockServices), true);
});

test('DISCORD-RBAC-02: /login grants role and /logout revokes role', async () => {
  const addedRoles = [];
  const removedRoles = [];

  const mockServices = {
    config: { discordGuildId: 'guild_1', adminUsername: 'admin', adminPassword: 'admin_pass_123', adminRoleId: '111', userRoleId: '222' },
    registry: { getAdminPassword: () => null },
    accessControl: { adminRoleId: '111', userRoleId: '222' },
    accessStore: {
      getUser: async () => ({
        id: 'usr_test1',
        username: 'test_client',
        password: 'ClientPass123!',
        role: 'user',
        status: 'active',
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      }),
      linkDiscord: async () => ({ ok: true }),
      unlinkDiscord: async () => ({ ok: true })
    }
  };

  const loginInteraction = {
    isModalSubmit: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    customId: 'login_modal',
    guildId: 'guild_1',
    user: { id: '555555555555555555' },
    guild: {
      id: 'guild_1',
      members: {
        fetch: async () => ({
          roles: {
            add: async (rId) => { addedRoles.push(rId); },
            remove: async (rId) => { removedRoles.push(rId); }
          }
        })
      }
    },
    member: {
      roles: {
        add: async (rId) => { addedRoles.push(rId); },
        remove: async (rId) => { removedRoles.push(rId); }
      }
    },
    fields: {
      getTextInputValue: (field) => (field === 'login_username' ? 'test_client' : 'ClientPass123!')
    },
    deferred: false,
    replied: false,
    deferReply: async function() { this.deferred = true; },
    editReply: async (p) => p,
    reply: async (p) => p
  };

  // 1. Submit login modal -> Grants user role '222'
  await handlePanelInteraction(loginInteraction, mockServices);
  assert.ok(addedRoles.includes('222'), 'Successful user login must assign userRoleId to member');

  // 2. Submit logout -> Revokes user role '222'
  const logoutInteraction = {
    guildId: 'guild_1',
    user: { id: '555555555555555555' },
    guild: loginInteraction.guild,
    member: {
      roles: {
        cache: new Map([['222', {}]]),
        remove: async (rIds) => {
          const list = Array.isArray(rIds) ? rIds : [rIds];
          removedRoles.push(...list);
          return true;
        }
      }
    }
  };

  const logoutRes = await logoutCommand.execute(logoutInteraction, mockServices);
  assert.ok(removedRoles.includes('222'), '/logout must remove userRoleId from member');
  assert.ok(logoutRes.embeds[0].data.description.includes('Đã thu hồi Role'));
});

test('DISCORD-RBAC-03: Commands other than /login are blocked for users without role', async () => {
  let replyPayload = null;

  const mockServices = {
    config: { discordGuildId: 'guild_1', adminRoleId: '111', userRoleId: '222' },
    accessControl: { adminRoleId: '111', userRoleId: '222' },
    accessStore: { getUserByDiscordId: async () => null }
  };

  let registeredHandler = null;
  const mockClient = {
    on: (evt, fn) => { if (evt === 'interactionCreate') registeredHandler = fn; }
  };

  attachInteractionHandler(mockClient, { config: mockServices.config, services: mockServices, logger: null });

  // Unprivileged user runs /bots -> BLOCKED
  const botsInteraction = {
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    commandName: 'bots',
    user: { id: '666666666666666666' },
    member: { roles: { cache: new Map() } },
    guild: { id: 'guild_1', ownerId: '999' },
    guildId: 'guild_1',
    deferred: false,
    replied: false,
    deferReply: async function() { this.deferred = true; },
    editReply: async (p) => { replyPayload = p; },
    reply: async (p) => { replyPayload = p; }
  };

  await registeredHandler(botsInteraction);
  assert.ok(replyPayload?.embeds?.[0]?.data?.title?.includes('CHƯA CÓ ROLE SỬ DỤNG BOT'), 'Non-login command must be blocked for user without role');
});

test('DISCORD-RBAC-04: User management lists include discordUserId', async () => {
  const { createAdminApi } = require('../src/http/routes/admin-api');
  const express = require('express');

  const mockUsers = [
    {
      userId: 'usr_1',
      username: 'gamer1',
      role: 'user',
      status: 'active',
      discordUserId: '123456789012345678',
      workerIds: ['01']
    },
    {
      userId: 'usr_2',
      username: 'gamer2',
      role: 'user',
      status: 'active',
      discord_user_id: '',
      workerIds: []
    }
  ];

  const app = express();
  app.use(express.json());
  // Mock requireAdmin middleware
  app.use((req, _res, next) => {
    req.managerAuthSession = { username: 'admin', role: 'admin' };
    next();
  });

  const router = createAdminApi({
    store: {
      listAccess: async () => mockUsers
    },
    registry: {
      list: async () => []
    },
    config: {},
    logger: null
  });

  app.use('/api/manager', router);

  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/manager/users`);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.users.length, 2);
    assert.strictEqual(data.users[0].discordUserId, '123456789012345678');
    assert.strictEqual(data.users[1].discordUserId, '');
  } finally {
    server.close();
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  }
});

