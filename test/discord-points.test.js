'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  DiscordPointsService,
  DAILY_CHECKIN_POINTS,
  STREAK_MILESTONE_BONUS,
  MESSAGE_POINTS,
  getVietnamDateKey
} = require('../src/services/discord-points-service');
const {
  handleGuildMessage,
  attachMessagePointsHandler,
  clearMessagePointsLoginCache
} = require('../src/discord/handlers/points-message-handler');
const { attachInteractionHandler } = require('../src/discord/handlers/interaction-handler');
const { handlePanelInteraction } = require('../src/discord/handlers/panel-handler');

const diemCmd = require('../src/discord/commands/diem');
const bxhCmd = require('../src/discord/commands/bxh');
const diemadminCmd = require('../src/discord/commands/diemadmin');

function makeMemoryStore(initialLinks = []) {
  const settings = new Map();
  const audits = [];
  const linkedUsers = new Map(initialLinks.map((u) => [String(u.discordUserId), { ...u }]));
  return {
    settings,
    audits,
    linkedUsers,
    async getSetting(k) {
      return settings.has(k) ? JSON.parse(JSON.stringify(settings.get(k))) : null;
    },
    async setSetting(k, v) {
      settings.set(k, JSON.parse(JSON.stringify(v)));
      return v;
    },
    async addAudit(entry) {
      audits.push(entry);
      return entry;
    },
    async getUserByDiscordId(discordUserId) {
      return linkedUsers.get(String(discordUserId)) || null;
    },
    async linkDiscord(discordUserId, username, userId) {
      linkedUsers.set(String(discordUserId), {
        id: userId || username,
        userId: userId || username,
        username,
        role: username === 'admin' ? 'admin' : 'user',
        status: 'active',
        discordUserId: String(discordUserId)
      });
    },
    async unlinkDiscord(discordUserId) {
      linkedUsers.delete(String(discordUserId));
    }
  };
}

test('1. Daily check-in +10d, UTC+7 rollover, 7/14/21 milestone +30d, and points can NEVER go negative', async () => {
  const store = makeMemoryStore();
  let fakeNowMs = Date.parse('2026-11-24T09:00:00.000Z'); // 16:00 VN (2026-11-24)
  const svc = new DiscordPointsService({ store, nowFn: () => fakeNowMs });
  await svc.initialize();

  // Day 1 check-in -> +10d
  const d1 = await svc.checkin({ guildId: 'g1', userId: 'u1', username: 'Alice' });
  assert.equal(d1.ok, true);
  assert.equal(d1.pointsEarned, DAILY_CHECKIN_POINTS);
  assert.equal(d1.streak, 1);
  assert.equal(d1.todayKey, '2026-11-24');

  // Same VN calendar day at 23:59:59 UTC+7 -> blocked
  fakeNowMs = Date.parse('2026-11-24T16:59:59.000Z');
  assert.equal(getVietnamDateKey(fakeNowMs), '2026-11-24');
  const dup = await svc.checkin({ guildId: 'g1', userId: 'u1', username: 'Alice' });
  assert.equal(dup.ok, false);
  assert.equal(dup.alreadyCheckedIn, true);
  assert.equal(dup.record.points, 10);

  // One second later: 00:00:00 UTC+7 -> Day 2
  fakeNowMs = Date.parse('2026-11-24T17:00:00.000Z');
  assert.equal(getVietnamDateKey(fakeNowMs), '2026-11-25');
  const d2 = await svc.checkin({ guildId: 'g1', userId: 'u1', username: 'Alice' });
  assert.equal(d2.ok, true);
  assert.equal(d2.streak, 2);

  // Days 3..21 -> milestones on 7, 14, 21 grant +40d
  for (let day = 3; day <= 21; day++) {
    fakeNowMs += 24 * 60 * 60 * 1000;
    const res = await svc.checkin({ guildId: 'g1', userId: 'u1', username: 'Alice' });
    assert.equal(res.ok, true);
    assert.equal(res.streak, day);
    if (day % 7 === 0) {
      assert.equal(res.isMilestone, true);
      assert.equal(res.milestoneBonus, STREAK_MILESTONE_BONUS);
      assert.equal(res.pointsEarned, 40);
    } else {
      assert.equal(res.isMilestone, false);
      assert.equal(res.pointsEarned, 10);
    }
  }
  const profAfter21 = await svc.getProfile({ guildId: 'g1', userId: 'u1' });
  assert.equal(profAfter21.points, 300);

  // Miss a day -> active streak resets to 0, longestStreak keeps 21
  fakeNowMs += 2 * 24 * 60 * 60 * 1000;
  const expiredProf = await svc.getProfile({ guildId: 'g1', userId: 'u1' });
  assert.equal(expiredProf.effectiveStreak, 0);
  assert.equal(expiredProf.longestStreak, 21);

  // Non-negative points invariant: subtracting more than balance clamps to 0; negative values ignored
  const subClamp = await svc.adminAdjustPoints({ guildId: 'g1', userId: 'u1', mode: 'subtract', amount: 9999 });
  assert.equal(subClamp.afterPoints, 0);
  assert.equal(subClamp.clampedToZero, true);

  const negSet = await svc.adminAdjustPoints({ guildId: 'g1', userId: 'u1', mode: 'set', amount: -500 });
  assert.equal(negSet.afterPoints, 0);
  const negAdd = await svc.adminAdjustPoints({ guildId: 'g1', userId: 'u1', mode: 'add', amount: -25 });
  assert.equal(negAdd.afterPoints, 0);

  svc.stop();
});

test('2. Message listener only awards +1d for logged-in active users and stops immediately on logout/disable', async () => {
  clearMessagePointsLoginCache();
  const store = makeMemoryStore([
    { discordUserId: 'u-logged', id: 'usr_1', username: 'alice', role: 'user', status: 'active' },
    { discordUserId: 'u-disabled', id: 'usr_2', username: 'banned', role: 'user', status: 'disabled' }
  ]);
  const svc = new DiscordPointsService({ store, flushIntervalMs: 60000 });
  await svc.initialize();

  const client = new EventEmitter();
  const services = { config: { discordGuildId: 'guild-ok' }, accessStore: store, discordPoints: svc };
  attachMessagePointsHandler(client, { config: services.config, services, logger: { warn() {} } });

  const makeMsg = (userId, channelId = 'chan-1', extra = {}) => ({
    guildId: 'guild-ok',
    channelId,
    author: { id: userId, bot: false, username: userId },
    member: { displayName: `Nick-${userId}` },
    ...extra
  });

  // Logged-in user earns across any channel
  assert.equal(await handleGuildMessage(makeMsg('u-logged', 'chan-1'), { config: services.config, services }), true);
  assert.equal(await handleGuildMessage(makeMsg('u-logged', 'chan-99'), { config: services.config, services }), true);

  // Guest (not logged in) & disabled user & bots/webhooks/DMs/foreign guilds earn NOTHING
  assert.equal(await handleGuildMessage(makeMsg('u-guest', 'chan-1'), { config: services.config, services }), false);
  assert.equal(await handleGuildMessage(makeMsg('u-disabled', 'chan-1'), { config: services.config, services }), false);
  assert.equal(await handleGuildMessage(makeMsg('u-logged', 'chan-1', { author: { id: 'u-logged', bot: true } }), { config: services.config, services }), false);
  assert.equal(await handleGuildMessage(makeMsg('u-logged', 'chan-1', { webhookId: 'wh1' }), { config: services.config, services }), false);
  assert.equal(await handleGuildMessage(makeMsg('u-logged', 'chan-1', { guildId: null }), { config: services.config, services }), false);
  assert.equal(await handleGuildMessage(makeMsg('u-logged', 'chan-1', { guildId: 'guild-other' }), { config: services.config, services }), false);

  // Unlink (/logout) + cache clear -> immediately stops earning chat points
  await store.unlinkDiscord('u-logged');
  clearMessagePointsLoginCache('u-logged');
  assert.equal(await handleGuildMessage(makeMsg('u-logged', 'chan-1'), { config: services.config, services }), false);

  const pLogged = await svc.getProfile({ guildId: 'guild-ok', userId: 'u-logged' });
  assert.equal(pLogged.points, 2 * MESSAGE_POINTS);
  assert.equal(pLogged.totalMessages, 2);
  const pGuest = await svc.getProfile({ guildId: 'guild-ok', userId: 'u-guest' });
  assert.equal(pGuest.points, 0);
  assert.equal(pGuest.totalMessages, 0);

  await svc.flush();
  svc.stop();

  const reloaded = new DiscordPointsService({ store });
  await reloaded.initialize();
  assert.equal((await reloaded.getProfile({ guildId: 'guild-ok', userId: 'u-logged' })).points, 2);
  reloaded.stop();
  clearMessagePointsLoginCache();
});

test('3. Combined leaderboards return Top 10 for points, streak, and messages with local persistence', async () => {
  const tmpFile = path.join(os.tmpdir(), `kbot-points-test-${Date.now()}.json`);
  try {
    const fakeNowMs = Date.parse('2026-11-24T05:00:00.000Z');
    const svc = new DiscordPointsService({ localFilePath: tmpFile, nowFn: () => fakeNowMs });
    await svc.initialize();

    for (let i = 1; i <= 12; i++) {
      await svc.adminAdjustPoints({ guildId: 'g1', userId: `u${i}`, username: `U${i}`, mode: 'add', amount: i * 10 });
    }
    await svc.checkin({ guildId: 'g1', userId: 'u1', username: 'U1' });
    await svc.recordMessage({ guildId: 'g1', userId: 'u2', username: 'U2' });

    const combined = await svc.getCombinedLeaderboards({ guildId: 'g1', limit: 10, viewerUserId: 'u2' });
    assert.equal(combined.diem.entries.length, 10, 'Top points must cap at 10');
    assert.equal(combined.diem.entries[0].userId, 'u12');
    assert.equal(combined.chuoi.entries[0].userId, 'u1');
    assert.equal(combined.tinnhan.entries[0].userId, 'u2');
    assert.equal(combined.tinnhan.viewerRank, 1);

    await svc.flush({ force: true });
    svc.stop();

    assert.equal(fs.existsSync(tmpFile), true);
    const svc2 = new DiscordPointsService({ localFilePath: tmpFile, nowFn: () => fakeNowMs });
    await svc2.initialize();
    assert.equal((await svc2.getProfile({ guildId: 'g1', userId: 'u12' })).points, 120);
    svc2.stop();
  } finally {
    await fs.promises.rm(tmpFile, { force: true }).catch(() => {});
  }
});

test('4. Login-only gate, combined /bxh Top 10 display, tab buttons, and /diemadmin work end-to-end', async () => {
  clearMessagePointsLoginCache();
  const store = makeMemoryStore([
    { discordUserId: 'u-member', id: 'usr_m', username: 'minh', role: 'user', status: 'active' },
    { discordUserId: 'adm-1', id: 'admin', username: 'admin', role: 'admin', status: 'active' }
  ]);
  const pointsService = new DiscordPointsService({ store });
  await pointsService.initialize();

  const client = new EventEmitter();
  const config = { discordGuildId: 'g1', adminUserId: 'adm-1' };
  const services = {
    config,
    accessStore: store,
    accessControl: {
      adminUserId: 'adm-1',
      adminRoleId: 'role-admin',
      userRoleId: 'role-user',
      roleFor: () => 'user'
    },
    discordPoints: pointsService
  };
  attachInteractionHandler(client, { config, services, logger: { warn() {}, info() {} } });

  const makeChatInteraction = ({ commandName, subcommand = null, optionsMap = {}, userId = 'u-member', username = 'Member' }) => ({
    deferred: false,
    replied: false,
    replyPayload: null,
    guildId: 'g1',
    guild: { id: 'g1', name: 'KingMC Community', ownerId: 'adm-1' },
    user: { id: userId, username, globalName: username, bot: false },
    member: { displayName: username, roles: { cache: new Map() } },
    commandName,
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    options: {
      getSubcommand: () => subcommand,
      getUser: (k) => optionsMap[k] || null,
      getInteger: (k) => (optionsMap[k] !== undefined ? optionsMap[k] : null),
      getString: (k) => (optionsMap[k] !== undefined ? optionsMap[k] : null)
    },
    async deferReply() { this.deferred = true; },
    async editReply(payload) { this.replyPayload = payload; return payload; },
    async reply(payload) { this.replied = true; this.replyPayload = payload; return payload; },
    async followUp(payload) { this.replyPayload = payload; return payload; }
  });

  // Unlogged-in guest CANNOT run /diemdanh, /diem, /bxh, or click leaderboard buttons
  const guestCheckin = makeChatInteraction({ commandName: 'diemdanh', userId: 'u-guest', username: 'Guest' });
  client.emit('interactionCreate', guestCheckin);
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(guestCheckin.replyPayload?.embeds?.[0]?.data?.title?.includes('CHƯA ĐĂNG NHẬP'));
  assert.equal((await pointsService.getProfile({ guildId: 'g1', userId: 'u-guest' })).points, 0);

  const guestBxh = await bxhCmd.execute(makeChatInteraction({ commandName: 'bxh', userId: 'u-guest' }), services);
  assert.ok(guestBxh.embeds[0].data.title.includes('CHƯA ĐĂNG NHẬP'));

  let guestBtnReply = null;
  await handlePanelInteraction({
    guildId: 'g1',
    guild: { id: 'g1', name: 'KingMC Community', ownerId: 'adm-1' },
    user: { id: 'u-guest', username: 'Guest' },
    customId: 'points:lb:tatca',
    deferred: false,
    replied: false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferUpdate: async function () { this.deferred = true; },
    editReply: async (p) => { guestBtnReply = p; },
    reply: async (p) => { guestBtnReply = p; },
    update: async (p) => { guestBtnReply = p; }
  }, services);
  assert.ok(guestBtnReply?.embeds?.[0]?.data?.title?.includes('CHƯA ĐĂNG NHẬP'));

  // Logged-in member runs /diemdanh (+10d) and sends a message (+1d => 11d)
  const iCheckin = makeChatInteraction({ commandName: 'diemdanh', userId: 'u-member', username: 'Minh' });
  client.emit('interactionCreate', iCheckin);
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(iCheckin.replyPayload?.embeds?.[0]?.data?.title?.includes('ĐIỂM DANH THÀNH CÔNG'));

  await handleGuildMessage({
    guildId: 'g1',
    channelId: 'c1',
    author: { id: 'u-member', bot: false, username: 'minh' },
    member: { displayName: 'Minh' }
  }, { config, services });

  // Logged-in admin checks Minh's points with /diem, and checks unlogged-in guest with /diem
  const diemMinh = await diemCmd.execute(makeChatInteraction({
    commandName: 'diem',
    userId: 'adm-1',
    optionsMap: { nguoidung: { id: 'u-member', username: 'Minh', bot: false } }
  }), services);
  assert.ok(JSON.stringify(diemMinh.embeds[0].data.fields).includes('11 đ'));

  const diemGuest = await diemCmd.execute(makeChatInteraction({
    commandName: 'diem',
    userId: 'adm-1',
    optionsMap: { nguoidung: { id: 'u-guest', username: 'Guest', bot: false } }
  }), services);
  assert.ok(diemGuest.embeds[0].data.title.includes('CHƯA THAM GIA'));

  // Default /bxh (no options) returns ALL THREE Top-10 sections together + 4 tab buttons
  const bxhDefault = await bxhCmd.execute(makeChatInteraction({ commandName: 'bxh', userId: 'u-member' }), services);
  const fieldsText = JSON.stringify(bxhDefault.embeds[0].data.fields);
  assert.ok(fieldsText.includes('Top 10 Điểm tích lũy'));
  assert.ok(fieldsText.includes('Top 10 Chuỗi điểm danh'));
  assert.ok(fieldsText.includes('Top 10 Tin nhắn'));
  assert.ok(fieldsText.includes('<@u-member>'));
  const btnIds = bxhDefault.components[0].components.map((c) => c.data.custom_id);
  assert.deepEqual(btnIds, ['points:lb:tatca', 'points:lb:diem', 'points:lb:chuoi', 'points:lb:tinnhan']);

  // Clicking points:lb:chuoi updates panel for logged-in user
  let updatedLeaderboard = null;
  await handlePanelInteraction({
    guildId: 'g1',
    guild: { id: 'g1', name: 'KingMC Community', ownerId: 'adm-1' },
    user: { id: 'u-member', username: 'Minh' },
    customId: 'points:lb:chuoi',
    deferred: false,
    replied: false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferUpdate: async function () { this.deferred = true; },
    editReply: async (p) => { updatedLeaderboard = p; },
    update: async (p) => { updatedLeaderboard = p; }
  }, services);
  assert.ok(updatedLeaderboard?.embeds?.[0]?.data?.title?.includes('CHUỖI ĐIỂM DANH'));
  assert.ok(updatedLeaderboard.embeds[0].data.description.includes('<@u-member>'));

  // Non-admin CANNOT use /diemadmin (even with user role)
  const memberRoleCmd = makeChatInteraction({
    commandName: 'diemadmin',
    subcommand: 'cong',
    userId: 'u-member',
    optionsMap: { nguoidung: { id: 'u-member', username: 'Minh', bot: false }, so_diem: 500 }
  });
  memberRoleCmd.member = { displayName: 'Minh', roles: ['role-user'] };
  client.emit('interactionCreate', memberRoleCmd);
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(String(memberRoleCmd.replyPayload?.content || '').includes('không có quyền'));

  // Admin /diemadmin cong, tru (with non-negative floor), dat, reset
  await diemadminCmd.execute(makeChatInteraction({
    commandName: 'diemadmin',
    subcommand: 'cong',
    userId: 'adm-1',
    optionsMap: { nguoidung: { id: 'u-member', username: 'Minh', bot: false }, so_diem: 50, ly_do: 'Thưởng event' }
  }), services);
  assert.equal((await pointsService.getProfile({ guildId: 'g1', userId: 'u-member' })).points, 61);

  const adminSubOver = await diemadminCmd.execute(makeChatInteraction({
    commandName: 'diemadmin',
    subcommand: 'tru',
    userId: 'adm-1',
    optionsMap: { nguoidung: { id: 'u-member', username: 'Minh', bot: false }, so_diem: 999 }
  }), services);
  assert.equal((await pointsService.getProfile({ guildId: 'g1', userId: 'u-member' })).points, 0);
  assert.ok(adminSubOver.embeds[0].data.description.includes('điểm không thể âm'));

  await diemadminCmd.execute(makeChatInteraction({
    commandName: 'diemadmin',
    subcommand: 'dat',
    userId: 'adm-1',
    optionsMap: { nguoidung: { id: 'u-member', username: 'Minh', bot: false }, so_diem: 100 }
  }), services);
  assert.equal((await pointsService.getProfile({ guildId: 'g1', userId: 'u-member' })).points, 100);

  await diemadminCmd.execute(makeChatInteraction({
    commandName: 'diemadmin',
    subcommand: 'reset',
    userId: 'adm-1',
    optionsMap: { nguoidung: { id: 'u-member', username: 'Minh', bot: false }, pham_vi: 'diem' }
  }), services);
  const afterPartialReset = await pointsService.getProfile({ guildId: 'g1', userId: 'u-member' });
  assert.equal(afterPartialReset.points, 0);
  assert.equal(afterPartialReset.effectiveStreak, 1);

  assert.ok(store.audits.some((a) => a.action === 'DISCORD_POINTS_ADMIN_ADJUST'));
  assert.ok(store.audits.some((a) => a.action === 'DISCORD_POINTS_ADMIN_RESET'));

  // Verify /diemdanh embed displays current points and 10-day upcoming roadmap
  const checkinFields = JSON.stringify(iCheckin.replyPayload?.embeds?.[0]?.data?.fields || []);
  assert.ok(checkinFields.includes('Điểm hiện tại'));
  assert.ok(checkinFields.includes('Hành trình 10 ngày tiếp theo'));
  assert.ok(checkinFields.includes('MỐC 7 NGÀY (+30đ)'));

  pointsService.stop();
  clearMessagePointsLoginCache();
});

test('5. Missed 1-day streak restore prompt (Yes: -50d & streak+1 without daily pts; No: lose streak & +10d), 2+ days skip restore, and silent message points', async () => {
  clearMessagePointsLoginCache();
  let fakeNowMs = Date.parse('2026-11-10T05:00:00.000Z');
  const store = makeMemoryStore([
    { discordUserId: 'u-yes', id: 'usr_yes', username: 'yesuser', role: 'user', status: 'active' },
    { discordUserId: 'u-no', id: 'usr_no', username: 'nouser', role: 'user', status: 'active' },
    { discordUserId: 'u-poor', id: 'usr_poor', username: 'pooruser', role: 'user', status: 'active' }
  ]);
  const pointsService = new DiscordPointsService({ store, nowFn: () => fakeNowMs });
  await pointsService.initialize();

  // Build 6-day streak for u-yes (earned 60d), 5-day streak for u-no (earned 50d), 3-day streak for u-poor (earned 30d)
  for (let d = 1; d <= 6; d++) {
    await pointsService.checkin({ guildId: 'g1', userId: 'u-yes', username: 'YesUser' });
    if (d <= 5) await pointsService.checkin({ guildId: 'g1', userId: 'u-no', username: 'NoUser' });
    if (d <= 3) await pointsService.checkin({ guildId: 'g1', userId: 'u-poor', username: 'PoorUser' });
    if (d < 6) fakeNowMs += 24 * 60 * 60 * 1000;
  }
  // u-yes = 60d, streak 6 (checked in day 6); u-no = 50d, streak 5 (last day 5); u-poor = 30d, streak 3 (last day 3)
  // Jump +2 days from day 6 -> day 8 (u-yes missed EXACTLY 1 day: day 7; u-no missed 2 days; u-poor missed 4 days!)
  fakeNowMs += 2 * 24 * 60 * 60 * 1000;

  const services = {
    config: { discordGuildId: 'g1' },
    accessStore: store,
    discordPoints: pointsService
  };

  // 5a. Message listener must remain 100% silent (zero reply/send/react calls)
  let chatSpoke = false;
  await handleGuildMessage({
    guildId: 'g1',
    channelId: 'c1',
    author: { id: 'u-yes', bot: false, username: 'YesUser' },
    member: { displayName: 'YesUser' },
    reply: () => { chatSpoke = true; },
    react: () => { chatSpoke = true; },
    channel: { send: () => { chatSpoke = true; } }
  }, { config: services.config, services });
  assert.equal(chatSpoke, false, 'Message points listener must silently award +1d without sending replies');
  assert.equal((await pointsService.getProfile({ guildId: 'g1', userId: 'u-yes' })).points, 61);

  // 5b. u-yes calls /diemdanh after missing 1 day -> gets restore prompt (no points deducted yet!)
  const diemdanhCmd = require('../src/discord/commands/diemdanh');
  const promptPayload = await diemdanhCmd.execute({
    guildId: 'g1',
    user: { id: 'u-yes', username: 'YesUser' },
    member: { displayName: 'YesUser' }
  }, services);
  assert.ok(promptPayload.embeds[0].data.title.includes('BỎ LỠ 1 NGÀY'));
  const restoreBtnIds = promptPayload.components[0].components.map((c) => c.data.custom_id);
  assert.deepEqual(restoreBtnIds, ['points:restore:yes:u-yes', 'points:restore:no:u-yes']);
  assert.equal((await pointsService.getProfile({ guildId: 'g1', userId: 'u-yes' })).points, 61);

  // Another user trying to click u-yes's button is blocked
  let hijackReply = null;
  await handlePanelInteraction({
    guildId: 'g1',
    guild: { id: 'g1', name: 'KingMC' },
    user: { id: 'u-no', username: 'NoUser' },
    customId: 'points:restore:yes:u-yes',
    deferred: false,
    replied: false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    reply: async (p) => { hijackReply = p; }
  }, services);
  assert.ok(String(hijackReply?.content || '').includes('Chỉ chủ nhân'));
  assert.equal((await pointsService.getProfile({ guildId: 'g1', userId: 'u-yes' })).points, 61);

  // u-yes clicks YES -> -50d (61 -> 11), streak becomes 7 (NO daily/milestone pts added!), buttons cleared, 10-day roadmap shown
  let yesReply = null;
  await handlePanelInteraction({
    guildId: 'g1',
    guild: { id: 'g1', name: 'KingMC' },
    user: { id: 'u-yes', username: 'YesUser' },
    member: { displayName: 'YesUser' },
    customId: 'points:restore:yes:u-yes',
    deferred: false,
    replied: false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferUpdate: async function () { this.deferred = true; },
    editReply: async (p) => { yesReply = p; },
    update: async (p) => { yesReply = p; }
  }, services);
  assert.ok(yesReply.embeds[0].data.title.includes('KHÔI PHỤC CHUỖI THÀNH CÔNG'));
  assert.deepEqual(yesReply.components, []);
  const yesFieldsText = JSON.stringify(yesReply.embeds[0].data.fields);
  assert.ok(yesFieldsText.includes('11 đ'));
  assert.ok(yesFieldsText.includes('7 ngày'));
  assert.ok(yesFieldsText.includes('MỐC 14 NGÀY (+30đ)'));
  const profYesAfter = await pointsService.getProfile({ guildId: 'g1', userId: 'u-yes' });
  assert.equal(profYesAfter.points, 11, 'Restore must deduct 50d and NOT add daily/milestone points today');
  assert.equal(profYesAfter.effectiveStreak, 7);

  // Double-clicking YES same day (after UI button cooldown) returns already-checked-in and does NOT deduct another 50d
  await new Promise((r) => setTimeout(r, 850));
  let dupYesReply = null;
  await handlePanelInteraction({
    guildId: 'g1',
    guild: { id: 'g1', name: 'KingMC' },
    user: { id: 'u-yes', username: 'YesUser' },
    member: { displayName: 'YesUser' },
    customId: 'points:restore:yes:u-yes',
    deferred: false,
    replied: false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferUpdate: async function () { this.deferred = true; },
    editReply: async (p) => { dupYesReply = p; },
    update: async (p) => { dupYesReply = p; }
  }, services);
  assert.ok(dupYesReply?.embeds?.[0]?.data?.title?.includes('ĐÃ ĐIỂM DANH HÔM NAY'));
  assert.equal((await pointsService.getProfile({ guildId: 'g1', userId: 'u-yes' })).points, 11);

  // 5c. u-poor (< 50d) checks in after missing 4 days (2+ days missed) -> NO restore offered, starts at streak 1 with +10d
  const poorRes = await pointsService.checkin({ guildId: 'g1', userId: 'u-poor', username: 'PoorUser' });
  assert.equal(poorRes.ok, true);
  assert.equal(poorRes.streak, 1);
  assert.equal(poorRes.record.points, 40);

  // Give u-poor a missed 1-day state with only 40d and test insufficient_points restore rejection
  fakeNowMs += 2 * 24 * 60 * 60 * 1000;
  const poorPrompt = await pointsService.checkin({ guildId: 'g1', userId: 'u-poor', username: 'PoorUser' });
  assert.equal(poorPrompt.needsRestoreChoice, true);
  assert.equal(poorPrompt.canAffordRestore, false);
  const poorRestoreAttempt = await pointsService.restoreCheckin({ guildId: 'g1', userId: 'u-poor' });
  assert.equal(poorRestoreAttempt.ok, false);
  assert.equal(poorRestoreAttempt.reason, 'insufficient_points');
  assert.equal((await pointsService.getProfile({ guildId: 'g1', userId: 'u-poor' })).points, 40);

  // 5d. u-no had missed 2 days on Day 8; reset u-no cleanly on Day 8 (streak 1 -> Day 9 skip -> Day 10 missed 1 day) and test NO button
  // On Day 10 (currently fakeNowMs is Day 10): u-no missed Day 6..9, check u-no on Day 10 -> streak 1 (60d), jump +2d to Day 12 -> missed Day 11 (1 day)!
  await pointsService.checkin({ guildId: 'g1', userId: 'u-no', username: 'NoUser' }); // Day 10: streak 1, 60d
  fakeNowMs += 2 * 24 * 60 * 60 * 1000; // Day 12 -> missed Day 11 (1 day)
  const noPrompt = await pointsService.checkin({ guildId: 'g1', userId: 'u-no', username: 'NoUser' });
  assert.equal(noPrompt.needsRestoreChoice, true);

  let noReply = null;
  await handlePanelInteraction({
    guildId: 'g1',
    guild: { id: 'g1', name: 'KingMC' },
    user: { id: 'u-no', username: 'NoUser' },
    member: { displayName: 'NoUser' },
    customId: 'points:restore:no:u-no',
    deferred: false,
    replied: false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferUpdate: async function () { this.deferred = true; },
    editReply: async (p) => { noReply = p; },
    update: async (p) => { noReply = p; }
  }, services);
  assert.ok(noReply.embeds[0].data.title.includes('ĐIỂM DANH THÀNH CÔNG'));
  assert.deepEqual(noReply.components, []);
  const profNoAfter = await pointsService.getProfile({ guildId: 'g1', userId: 'u-no' });
  assert.equal(profNoAfter.effectiveStreak, 1, 'Clicking No loses previous streak and starts at day 1');
  assert.equal(profNoAfter.points, 70, 'Clicking No still grants +10d normal daily points');

  // 5e. Expired restore window if user waits another midnight (now Day 14, last check-in Day 10)
  fakeNowMs += 1 * 24 * 60 * 60 * 1000;
  const expiredRestore = await pointsService.restoreCheckin({ guildId: 'g1', userId: 'u-poor' });
  assert.equal(expiredRestore.ok, false);
  assert.equal(expiredRestore.reason, 'expired_window');

  pointsService.stop();
  clearMessagePointsLoginCache();
});

test('6. /tinnhan shows all-time message count & rank for self/others and enforces /login gate', async () => {
  clearMessagePointsLoginCache();
  const tinnhanCmd = require('../src/discord/commands/tinnhan');
  const store = makeMemoryStore([
    { discordUserId: 'u-a', id: 'usr_a', username: 'usera', role: 'user', status: 'active' },
    { discordUserId: 'u-b', id: 'usr_b', username: 'userb', role: 'user', status: 'active' }
  ]);
  const pointsService = new DiscordPointsService({ store });
  await pointsService.initialize();

  const client = new EventEmitter();
  const config = { discordGuildId: 'g1', adminUserId: 'adm-1' };
  const services = {
    config,
    accessStore: store,
    accessControl: { adminUserId: 'adm-1', adminRoleId: 'ra', userRoleId: 'ru', roleFor: () => 'user' },
    discordPoints: pointsService
  };
  attachInteractionHandler(client, { config, services, logger: { warn() {}, info() {} } });

  await handleGuildMessage({
    guildId: 'g1',
    channelId: 'c1',
    author: { id: 'u-a', bot: false, username: 'UserA' },
    member: { displayName: 'UserA' }
  }, { config, services });
  await handleGuildMessage({
    guildId: 'g1',
    channelId: 'c2',
    author: { id: 'u-a', bot: false, username: 'UserA' },
    member: { displayName: 'UserA' }
  }, { config, services });
  await handleGuildMessage({
    guildId: 'g1',
    channelId: 'c1',
    author: { id: 'u-b', bot: false, username: 'UserB' },
    member: { displayName: 'UserB' }
  }, { config, services });

  const makeTinnhanInteraction = ({ userId, username, targetUser = null }) => ({
    deferred: false,
    replied: false,
    replyPayload: null,
    guildId: 'g1',
    guild: { id: 'g1', name: 'KingMC' },
    user: { id: userId, username, globalName: username, bot: false },
    member: { displayName: username, roles: { cache: new Map() } },
    commandName: 'tinnhan',
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    options: {
      getUser: (k) => (k === 'nguoidung' ? targetUser : null)
    },
    async deferReply() { this.deferred = true; },
    async editReply(payload) { this.replyPayload = payload; return payload; },
    async reply(payload) { this.replied = true; this.replyPayload = payload; return payload; }
  });

  // Unlogged-in guest cannot use /tinnhan
  const guestReq = makeTinnhanInteraction({ userId: 'u-guest', username: 'Guest' });
  client.emit('interactionCreate', guestReq);
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(guestReq.replyPayload?.embeds?.[0]?.data?.title?.includes('CHƯA ĐĂNG NHẬP'));

  // Logged-in UserA checks own messages through interactionCreate -> 2 tin nhắn, rank #1, 2 đ
  const selfReq = makeTinnhanInteraction({ userId: 'u-a', username: 'UserA' });
  client.emit('interactionCreate', selfReq);
  await new Promise((r) => setTimeout(r, 40));
  const selfEmbed = selfReq.replyPayload?.embeds?.[0]?.data;
  assert.ok(selfEmbed?.title?.includes('THỐNG KÊ TIN NHẮN'));
  const selfFields = JSON.stringify(selfEmbed?.fields || []);
  assert.ok(selfFields.includes('2 tin nhắn'));
  assert.ok(selfFields.includes('#1'));
  assert.ok(selfFields.includes('2 đ'));

  // Logged-in UserA checks UserB's messages -> 1 tin nhắn, rank #2
  const otherRes = await tinnhanCmd.execute(makeTinnhanInteraction({
    userId: 'u-a',
    username: 'UserA',
    targetUser: { id: 'u-b', username: 'UserB', globalName: 'UserB', bot: false }
  }), services);
  const otherFields = JSON.stringify(otherRes.embeds[0].data.fields);
  assert.ok(otherFields.includes('1 tin nhắn'));
  assert.ok(otherFields.includes('#2'));

  // Unlogged target & Discord bot target rejected cleanly
  const unlinkedTargetRes = await tinnhanCmd.execute(makeTinnhanInteraction({
    userId: 'u-a',
    username: 'UserA',
    targetUser: { id: 'u-guest', username: 'Guest', bot: false }
  }), services);
  assert.ok(unlinkedTargetRes.embeds[0].data.title.includes('CHƯA THAM GIA'));

  const botTargetRes = await tinnhanCmd.execute(makeTinnhanInteraction({
    userId: 'u-a',
    username: 'UserA',
    targetUser: { id: 'bot-9', username: 'KBot', bot: true }
  }), services);
  assert.ok(botTargetRes.embeds[0].data.title.includes('KHÔNG ÁP DỤNG'));

  pointsService.stop();
  clearMessagePointsLoginCache();
});
