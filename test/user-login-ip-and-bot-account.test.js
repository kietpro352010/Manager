'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { resolveClientIp } = require('../src/services/captcha');
const { createAdminApi } = require('../src/http/routes/admin-api');

test('IP-RESOLUTION-01: resolveClientIp prioritizes headers correctly', () => {
  // 1. Cloudflare cf-connecting-ip takes precedence over req.ip
  const reqCf = {
    headers: {
      'cf-connecting-ip': '113.161.45.88',
      'x-real-ip': '10.0.0.1',
      'x-forwarded-for': '172.68.1.2, 10.0.0.1'
    },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' }
  };
  assert.strictEqual(resolveClientIp(reqCf), '113.161.45.88');

  // 2. X-Real-IP takes precedence when cf-connecting-ip is absent
  const reqReal = {
    headers: {
      'x-real-ip': '14.232.88.99',
      'x-forwarded-for': '10.0.0.2'
    },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' }
  };
  assert.strictEqual(resolveClientIp(reqReal), '14.232.88.99');

  // 3. X-Forwarded-For takes first comma-separated client IP
  const reqXff = {
    headers: {
      'x-forwarded-for': '42.112.55.66, 172.68.22.33, 10.0.0.5'
    },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' }
  };
  assert.strictEqual(resolveClientIp(reqXff), '42.112.55.66');

  // 4. Fallback to req.ip when no proxy headers present
  const reqDirect = {
    headers: {},
    ip: '171.244.10.20',
    socket: { remoteAddress: '171.244.10.20' }
  };
  assert.strictEqual(resolveClientIp(reqDirect), '171.244.10.20');

  // 5. Fallback to 127.0.0.1 on invalid/empty request
  assert.strictEqual(resolveClientIp({}), '127.0.0.1');
});

test('ADMIN-API-02: GET /users includes lastLoginIp and botMinecraftUser', async () => {
  const mockStoredUsers = [
    {
      userId: 'usr_alpha',
      username: 'alpha_player',
      role: 'user',
      status: 'active',
      registrationIp: '127.0.0.1',
      lastLoginIp: '14.232.100.200',
      lastLoginAt: '2026-11-21T18:00:00.000Z',
      discordUserId: '123456789012345678',
      workerIds: ['worker_01']
    },
    {
      userId: 'usr_beta',
      username: 'beta_player',
      role: 'user',
      status: 'active',
      registrationIp: '42.112.33.44',
      // lastLoginIp not set -> should fallback to registrationIp
      workerIds: []
    }
  ];

  const mockWorkers = [
    {
      workerId: 'worker_01',
      botNumber: 1,
      alias: 'KingMC Bot 1',
      name: 'bot-1',
      status: { username: 'KingMC_Alpha123' },
      enabled: true,
      rentable: true
    }
  ];

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.managerAuthSession = { username: 'admin', role: 'admin' };
    next();
  });

  const router = createAdminApi({
    store: {
      listAccess: async () => mockStoredUsers
    },
    registry: {
      list: async () => mockWorkers
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

    // Verify user list mappings
    assert.strictEqual(data.users.length, 2);
    assert.strictEqual(data.users[0].lastLoginIp, '14.232.100.200');
    assert.strictEqual(data.users[0].registrationIp, '127.0.0.1');
    assert.strictEqual(data.users[1].lastLoginIp, '42.112.33.44');

    // Verify availableBots includes Minecraft account name
    assert.strictEqual(data.availableBots.length, 1);
    assert.strictEqual(data.availableBots[0].botMinecraftUser, 'KingMC_Alpha123');
    assert.strictEqual(data.availableBots[0].label, 'KingMC Bot 1');
  } finally {
    server.close();
  }
});
