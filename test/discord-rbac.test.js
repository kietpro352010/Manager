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

test('DISCORD-RBAC-05: /login detects already-logged-in user, provides working Logout button (even when unroled/expired), guards ownership, and cleans orphan links', async () => {
  const { MockDiscordClient, SyntheticInteraction } = require('./e2e/harness/mock-discord');
  const discordClient = new MockDiscordClient();

  let currentLinkedUser = null;
  let currentRawLink = null;
  let unlinkCalls = 0;
  const removedRoles = [];
  const audits = [];

  const mockServices = {
    config: {
      discordGuildId: 'guild_login_flow',
      adminUsername: 'admin',
      adminPassword: 'admin_pass_123',
      adminRoleId: '111111111111111111',
      userRoleId: '222222222222222222'
    },
    registry: { getAdminPassword: () => null },
    accessControl: { adminRoleId: '111111111111111111', userRoleId: '222222222222222222' },
    accessStore: {
      getUserByDiscordId: async (uid) => (uid === '555555555555555555' ? currentLinkedUser : null),
      getDiscordLink: async (uid) => (uid === '555555555555555555' ? currentRawLink : null),
      getUser: async (uname) => (currentLinkedUser && currentLinkedUser.username === uname ? currentLinkedUser : null),
      linkDiscord: async (uid, uname, mid) => {
        currentLinkedUser = {
          id: mid || `usr_${uname}`,
          userId: mid || `usr_${uname}`,
          username: uname,
          role: 'user',
          status: 'expired',
          planName: 'VIP 30 Ngày',
          isPermanent: false,
          expiresAt: new Date(Date.now() - 86400000).toISOString()
        };
        currentRawLink = { discord_user_id: uid, username: uname, status: 'active' };
        return { ok: true };
      },
      unlinkDiscord: async () => {
        unlinkCalls += 1;
        currentLinkedUser = null;
        currentRawLink = null;
        return true;
      },
      addAudit: async (entry) => { audits.push(entry); }
    }
  };

  attachInteractionHandler(discordClient, {
    config: mockServices.config,
    services: mockServices,
    logger: { warn: () => {}, info: () => {}, error: () => {} }
  });

  const makeMember = (roleIds = []) => ({
    roles: {
      cache: new Map(roleIds.map((r) => [r, {}])),
      add: async () => true,
      remove: async (rId) => {
        removedRoles.push(rId);
        return true;
      }
    }
  });

  const waitForSettled = async (inter, timeoutMs = 1500) => {
    await inter.waitForResponse(timeoutMs);
    const deadline = Date.now() + timeoutMs;
    while (
      Date.now() < deadline &&
      inter.responses.length === 1 &&
      (inter.responses[0].type === 'deferUpdate' || inter.responses[0].type === 'deferReply')
    ) {
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  // 1. Unlinked user calls /login -> Opens login_modal cleanly without sending a text reply
  const firstLoginCmd = new SyntheticInteraction({
    type: 'chat_input',
    commandName: 'login',
    guildId: 'guild_login_flow',
    userId: '555555555555555555',
    member: makeMember()
  });
  discordClient.emit('interactionCreate', firstLoginCmd);
  await firstLoginCmd.waitForResponse();
  assert.ok(firstLoginCmd.modal, 'Unlinked user running /login must open login_modal');
  assert.strictEqual(firstLoginCmd.getLastReply(), null, 'Showing modal must not also emit a duplicate reply');

  // 2. Orphaned link row (Web user deleted) -> auto-cleaned so /login still opens modal cleanly
  currentRawLink = { discord_user_id: '555555555555555555', username: 'deleted_ghost_user', status: 'active' };
  const orphanLoginCmd = new SyntheticInteraction({
    type: 'chat_input',
    commandName: 'login',
    guildId: 'guild_login_flow',
    userId: '555555555555555555',
    member: makeMember()
  });
  discordClient.emit('interactionCreate', orphanLoginCmd);
  await orphanLoginCmd.waitForResponse();
  assert.strictEqual(unlinkCalls, 1, 'Orphaned Discord link row must be auto-cleaned');
  assert.ok(orphanLoginCmd.modal, 'After auto-cleaning orphan link, /login must open login_modal');

  // 3. Now user IS logged in (even with expired plan / no userRoleId on Discord!)
  await mockServices.accessStore.linkDiscord('555555555555555555', 'kiet_vip', 'usr_kiet');

  const secondLoginCmd = new SyntheticInteraction({
    type: 'chat_input',
    commandName: 'login',
    guildId: 'guild_login_flow',
    userId: '555555555555555555',
    member: makeMember()
  });
  discordClient.emit('interactionCreate', secondLoginCmd);
  await secondLoginCmd.waitForResponse();

  assert.strictEqual(secondLoginCmd.modal, null, 'Already-logged-in user running /login must NOT open modal');
  const alreadyReply = secondLoginCmd.getLastReply();
  assert.strictEqual(alreadyReply?.ephemeral, true, 'Already-logged-in notice must be ephemeral');
  const alreadyEmbed = alreadyReply?.embeds?.[0]?.data || alreadyReply?.embeds?.[0];
  assert.ok(alreadyEmbed?.title?.includes('BẠN ĐÃ ĐĂNG NHẬP'), 'Embed must state user is already logged in');
  assert.ok(alreadyEmbed?.description?.includes('kiet_vip'), 'Embed must display linked Web username');
  const logoutBtn = secondLoginCmd.getComponents().find((c) => (c.data?.custom_id || c.customId) === 'login:logout:555555555555555555');
  assert.ok(logoutBtn, 'Already-logged-in response must include Logout button bound to actor Discord ID');

  // 4. Duplicate login_modal submit while already logged in also returns Already-Logged-In + Logout button
  const dupModal = new SyntheticInteraction({
    type: 'modal',
    customId: 'login_modal',
    guildId: 'guild_login_flow',
    userId: '555555555555555555',
    fields: { login_username: 'other_acc', login_password: 'wrong_password' },
    member: makeMember()
  });
  discordClient.emit('interactionCreate', dupModal);
  await waitForSettled(dupModal);
  const dupEmbed = dupModal.getEmbeds()[0]?.data || dupModal.getEmbeds()[0];
  assert.ok(dupEmbed?.title?.includes('BẠN ĐÃ ĐĂNG NHẬP'), 'Submitting stale login_modal while logged in must report already logged in');

  // 5. Another user trying to click this user's Logout button is blocked
  const spoofLogoutClick = new SyntheticInteraction({
    type: 'button',
    customId: 'login:logout:555555555555555555',
    guildId: 'guild_login_flow',
    userId: '777777777777777777',
    member: makeMember()
  });
  discordClient.emit('interactionCreate', spoofLogoutClick);
  await waitForSettled(spoofLogoutClick);
  assert.ok(String(spoofLogoutClick.getLastReply()?.content || '').includes('Chỉ chính bạn'), 'Foreign user must not trigger another user logout button');
  assert.ok(currentLinkedUser !== null, 'Account must remain linked after rejected spoof click');

  // 6. Owner clicks Logout button (even without userRoleId!) -> Unlinks DB, revokes roles, shows Logged Out + Re-login button
  const ownerLogoutClick = new SyntheticInteraction({
    type: 'button',
    customId: 'login:logout:555555555555555555',
    guildId: 'guild_login_flow',
    userId: '555555555555555555',
    member: makeMember() // Zero roles on member (expired plan!) — must still be allowed to log out!
  });
  discordClient.emit('interactionCreate', ownerLogoutClick);
  await waitForSettled(ownerLogoutClick);
  assert.strictEqual(currentLinkedUser, null, 'Clicking Logout button must unlink Discord account in store');
  const outEmbed = ownerLogoutClick.getEmbeds()[0]?.data || ownerLogoutClick.getEmbeds()[0];
  assert.ok(outEmbed?.title?.includes('ĐÃ ĐĂNG XUẤT'), 'Logout button click must update embed to ĐÃ ĐĂNG XUẤT');
  assert.ok(outEmbed?.description?.includes('kiet_vip'), 'Logged-out embed should confirm which Web account was unlinked');
  assert.ok(audits.some((a) => a.action === 'DISCORD_LOGOUT' && a.details?.username === 'kiet_vip'), 'Must audit DISCORD_LOGOUT');

  const reloginBtn = ownerLogoutClick.getComponents().find((c) => (c.data?.custom_id || c.customId) === 'login:prompt:555555555555555555');
  assert.ok(reloginBtn, 'Logged-out panel should provide 1-click Đăng nhập lại button');

  // 7. Clicking Đăng nhập lại opens login_modal directly!
  const reloginClick = new SyntheticInteraction({
    type: 'button',
    customId: 'login:prompt:555555555555555555',
    guildId: 'guild_login_flow',
    userId: '555555555555555555',
    member: makeMember()
  });
  discordClient.emit('interactionCreate', reloginClick);
  await waitForSettled(reloginClick);
  assert.ok(reloginClick.modal, 'Clicking Đăng nhập lại button must open login_modal');

  // 8. Calling /logout when already logged out reports BẠN CHƯA ĐĂNG NHẬP cleanly with 1-click login button and without fake unlink/audit
  const prevUnlinks = unlinkCalls;
  const redundantLogoutRes = await logoutCommand.execute({
    guildId: 'guild_login_flow',
    user: { id: '555555555555555555' },
    member: { roles: { cache: new Map() } }
  }, mockServices);
  assert.ok(redundantLogoutRes.embeds[0].data.title.includes('CHƯA ĐĂNG NHẬP'), '/logout while unlinked must report CHƯA ĐĂNG NHẬP');
  assert.ok(
    redundantLogoutRes.components?.[0]?.components?.some((c) => c.data?.custom_id === 'login:prompt:555555555555555555'),
    '/logout while unlinked must attach 1-click Đăng nhập ngay button'
  );
  assert.strictEqual(unlinkCalls, prevUnlinks, 'Redundant /logout when unlinked must not hit DB unlink unnecessarily');
});

test('DISCORD-RBAC-06: 1:1 link conflict grace, role self-healing on /login, public /help, smart /logs & quick check-in', async () => {
  const { MockDiscordClient, SyntheticInteraction } = require('./e2e/harness/mock-discord');
  const { DiscordPointsService } = require('../src/services/discord-points-service');
  const { renderBotDetail } = require('../src/discord/panels/renderer');
  const logsCommand = require('../src/discord/commands/logs');
  const discordClient = new MockDiscordClient();

  const addedRoles = [];
  const removedRoles = [];
  let activeLinkUser = null;

  const pointsStore = {
    data: new Map(),
    async getSetting(k) { return this.data.get(k) || null; },
    async setSetting(k, v) { this.data.set(k, v); return v; }
  };
  const pointsService = new DiscordPointsService({ store: pointsStore });
  await pointsService.initialize();

  const mockWorkers = [
    {
      workerId: 'bot-alpha',
      botNumber: 1,
      name: 'King Alpha',
      status: { state: 'online', online: true, username: 'AlphaMC', pingMs: 28, health: 20, food: 18, totemCount: 2 }
    },
    {
      workerId: 'bot-bravo',
      botNumber: 2,
      name: 'King Bravo',
      status: { state: 'offline', online: false, username: 'BravoMC', lastKickReason: 'Server restarting' }
    }
  ];

  const mockServices = {
    config: {
      discordGuildId: 'guild_ux_1',
      publicBaseUrl: 'https://kbot.example.com',
      adminUsername: 'admin',
      adminPassword: 'admin_pass_123',
      adminRoleId: '111111111111111111',
      userRoleId: '222222222222222222',
      adminUserId: '999999999999999999'
    },
    discordPoints: pointsService,
    registry: {
      getAdminPassword: () => null,
      list: async () => mockWorkers,
      find: async (id) => mockWorkers.find((w) => w.workerId === id) || null,
      getLogs: async (id) => [{ time: '2026-11-26T08:30:00.000Z', type: 'info', message: `Joined lobby on ${id}` }]
    },
    accessControl: { adminRoleId: '111111111111111111', userRoleId: '222222222222222222' },
    accessStore: {
      getUserByDiscordId: async (uid) => (uid === '444444444444444444' ? activeLinkUser : null),
      getDiscordLink: async () => null,
      getUser: async (uname) => (uname === 'taken_web_user'
        ? {
          id: 'usr_taken',
          username: 'taken_web_user',
          password: 'CorrectPassword123',
          role: 'user',
          status: 'active',
          isPermanent: true
        }
        : null),
      linkDiscord: async () => {
        throw new Error('Tài khoản Web này đã được liên kết với một tài khoản Discord khác.');
      },
      unlinkDiscord: async () => { activeLinkUser = null; return true; },
      addAudit: async () => {}
    }
  };

  attachInteractionHandler(discordClient, {
    config: mockServices.config,
    services: mockServices,
    logger: { warn: () => {}, info: () => {}, error: () => {} }
  });

  const waitForSettled = async (inter, timeoutMs = 1500) => {
    await inter.waitForResponse(timeoutMs);
    const deadline = Date.now() + timeoutMs;
    while (
      Date.now() < deadline &&
      inter.responses.length === 1 &&
      (inter.responses[0].type === 'deferUpdate' || inter.responses[0].type === 'deferReply')
    ) {
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  const makeMember = (roleIds = []) => ({
    roles: {
      cache: new Map(roleIds.map((r) => [r, {}])),
      add: async (rId) => { addedRoles.push(rId); return true; },
      remove: async (rId) => { removedRoles.push(rId); return true; }
    }
  });

  // 1. 1:1 link conflict in login_modal returns friendly warning embed instead of throwing 500
  const conflictModal = new SyntheticInteraction({
    type: 'modal',
    customId: 'login_modal',
    guildId: 'guild_ux_1',
    userId: '444444444444444444',
    fields: { login_username: 'taken_web_user', login_password: 'CorrectPassword123' },
    member: makeMember()
  });
  discordClient.emit('interactionCreate', conflictModal);
  await waitForSettled(conflictModal);
  const conflictEmbed = conflictModal.getEmbeds()[0]?.data || conflictModal.getEmbeds()[0];
  assert.ok(conflictEmbed?.title?.includes('KHÔNG THỂ LIÊN KẾT TÀI KHOẢN'), '1:1 link conflict must return clean warning embed');
  assert.ok(conflictEmbed?.description?.includes('Discord khác'), 'Conflict embed must explain account is linked elsewhere');

  // 2. Role self-healing when already-logged-in entitled user runs /login without userRoleId (e.g. rejoined server or renewed on Web)
  activeLinkUser = {
    id: 'usr_vip',
    userId: 'usr_vip',
    username: 'vip_member',
    role: 'user',
    status: 'active',
    isPermanent: false,
    expiresAtRental: new Date(Date.now() + 5 * 86400000).toISOString(),
    assignedBotIds: ['bot-alpha', 'bot-bravo']
  };
  const healLogin = new SyntheticInteraction({
    type: 'chat_input',
    commandName: 'login',
    guildId: 'guild_ux_1',
    userId: '444444444444444444',
    member: makeMember([]) // Missing role 222222222222222222
  });
  discordClient.emit('interactionCreate', healLogin);
  await waitForSettled(healLogin);
  assert.ok(addedRoles.includes('222222222222222222'), 'Running /login while entitled & linked must self-heal missing userRoleId');
  const healBtns = healLogin.getComponents().map((c) => c.data?.custom_id || c.customId).filter(Boolean);
  assert.ok(healBtns.includes('bots:list'), 'Entitled already-logged-in panel must include Mở danh sách Bot button');
  assert.ok(healBtns.includes('login:logout:444444444444444444'), 'Must include Logout button');

  // 3. Unlinked member without role can run /help and sees 3-step Quick Start + Đăng nhập ngay button (without Admin commands clutter)
  const guestHelp = new SyntheticInteraction({
    type: 'chat_input',
    commandName: 'help',
    guildId: 'guild_ux_1',
    userId: '888888888888888888',
    member: makeMember([])
  });
  discordClient.emit('interactionCreate', guestHelp);
  await waitForSettled(guestHelp);
  const helpEmbed = guestHelp.getEmbeds()[0]?.data || guestHelp.getEmbeds()[0];
  assert.ok(helpEmbed?.title?.includes('HƯỚNG DẪN SỬ DỤNG'), 'Unlinked user in allowed guild must be able to read /help');
  const helpFieldsJson = JSON.stringify(helpEmbed?.fields || []);
  assert.ok(helpFieldsJson.includes('Bắt Đầu Nhanh'), '/help must include Quick Start guide');
  assert.ok(!helpFieldsJson.includes('Lệnh Quản Trị Hệ Thống'), '/help must hide Admin commands section from non-admin users');
  assert.ok(
    guestHelp.getComponents().some((c) => (c.data?.custom_id || c.customId) === 'login:prompt:888888888888888888'),
    '/help for unlinked user must provide 1-click Đăng nhập ngay button'
  );

  // 4. Bot Detail includes vitals & Nhật ký button; /logs smart-matches '#02' -> botNumber 2 and includes multi-bot select menu
  const detailOnline = renderBotDetail({ user: activeLinkUser, worker: mockWorkers[0] });
  assert.ok(detailOnline.embeds[0].data.description.includes('20/20'), 'Bot detail must display live health vitals');
  const detailNavIds = detailOnline.components[1].components.map((c) => c.data.custom_id);
  assert.ok(detailNavIds.includes('logs:view:bot-alpha'), 'Bot detail must include 1-click Nhật ký button');

  const logsOut = await logsCommand.execute({
    guildId: 'guild_ux_1',
    user: { id: '444444444444444444' },
    member: makeMember(['222222222222222222']),
    guild: { id: 'guild_ux_1' },
    options: { getString: (k) => (k === 'bot_id' ? '#02' : null), getInteger: () => 20 }
  }, mockServices);
  assert.ok(logsOut.embeds[0].data.description.includes('bot-bravo'), '/logs must smart-match #02 to botNumber 2');
  assert.strictEqual(logsOut.components[0].components[0].data.custom_id, 'logs:select', '/logs with >1 bots must include logs:select dropdown');

  // 5. 1-Click Quick Check-in button enforces actor ownership & awards +10 points
  const spoofCheckin = new SyntheticInteraction({
    type: 'button',
    customId: 'points:quick_checkin:444444444444444444',
    guildId: 'guild_ux_1',
    userId: '777777777777777777',
    member: makeMember([])
  });
  discordClient.emit('interactionCreate', spoofCheckin);
  await waitForSettled(spoofCheckin);
  assert.ok(String(spoofCheckin.getLastReply()?.content || '').includes('Chỉ chính bạn'), 'Foreign user must not click quick check-in');

  const ownerCheckin = new SyntheticInteraction({
    type: 'button',
    customId: 'points:quick_checkin:444444444444444444',
    guildId: 'guild_ux_1',
    userId: '444444444444444444',
    member: makeMember(['222222222222222222'])
  });
  discordClient.emit('interactionCreate', ownerCheckin);
  await waitForSettled(ownerCheckin);
  const checkinEmbed = ownerCheckin.getEmbeds()[0]?.data || ownerCheckin.getEmbeds()[0];
  assert.ok(checkinEmbed?.title?.includes('ĐIỂM DANH THÀNH CÔNG'), 'Owner clicking quick check-in must earn daily points');
  assert.strictEqual((await pointsService.getProfile({ guildId: 'guild_ux_1', userId: '444444444444444444' })).points, 10);

  pointsService.stop();
});

