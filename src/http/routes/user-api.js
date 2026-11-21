'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const express = require('express');
const { validateProxyUrl } = require('../../services/proxy-validation');
const { decryptSecret } = require('../../utils/secrets');

function parseProxyInputToUrl(rawInput, { ignoreEnabledFlag = false } = {}) {
  if (rawInput === null || rawInput === undefined || rawInput === '') return '';
  if (typeof rawInput === 'string') return rawInput.trim();
  if (typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    if (!ignoreEnabledFlag && rawInput.enabled === false) return '';
    if (typeof rawInput.url === 'string' && rawInput.url.trim()) return rawInput.url.trim();
    const protocol = String(rawInput.protocol || 'socks5').trim().toLowerCase().replace(/:$/, '');
    if (protocol !== 'socks5') {
      throw new Error('Hiện tại Worker chỉ hỗ trợ giao thức socks5.');
    }
    const host = String(rawInput.host || '').trim().replace(/^\[|\]$/g, '');
    const port = Number(rawInput.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Vui lòng nhập Host và Port (1–65535) hợp lệ cho Proxy.');
    }
    const username = String(rawInput.username || '').trim();
    const password = String(rawInput.password || '');
    const authPart = username
      ? `${encodeURIComponent(username)}${password ? ':' + encodeURIComponent(password) : ''}@`
      : '';
    const hostPart = host.includes(':') ? `[${host}]` : host;
    return `socks5://${authPart}${hostPart}:${port}`;
  }
  throw new Error('Định dạng cấu hình Proxy không hợp lệ.');
}

function parseProxyUrlToObject(proxyUrl) {
  const raw = String(proxyUrl || '').trim();
  if (!raw) {
    return { enabled: false, protocol: 'socks5', host: '', port: '', username: '', password: '' };
  }
  try {
    const parsed = new URL(raw);
    return {
      enabled: true,
      protocol: parsed.protocol.replace(/:$/, '') || 'socks5',
      host: parsed.hostname.replace(/^\[|\]$/g, ''),
      port: Number(parsed.port) || '',
      username: decodeURIComponent(parsed.username || ''),
      hasPassword: Boolean(parsed.password)
    };
  } catch (_) {
    return { enabled: true, protocol: 'socks5', host: '', port: '', username: '', hasPassword: false };
  }
}

function probeProxyTcpLatency(proxyUrl, timeoutMs = 3500) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(proxyUrl);
    } catch {
      return resolve({ ok: false, latencyMs: null, error: 'URL Proxy không hợp lệ.' });
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const port = Number(parsed.port);
    const startedAt = Date.now();
    let settled = false;
    const socket = net.createConnection({ host, port });

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (_) {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({ ok: false, latencyMs: null, error: `Kết nối quá thời gian chờ (${timeoutMs}ms)` });
    }, timeoutMs);
    timer.unref?.();

    socket.once('connect', () => {
      done({ ok: true, latencyMs: Math.max(1, Date.now() - startedAt), error: null });
    });
    socket.once('error', (err) => {
      done({ ok: false, latencyMs: null, error: err?.code || err?.message || 'connection_failed' });
    });
  });
}

function normalizeAnnouncementValue(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    return { id: 'legacy', enabled: true, title: 'Thông báo hệ thống', content: text, mode: 'banner', startDate: '', endDate: '' };
  }
  if (typeof raw === 'object') {
    const content = String(raw.content ?? raw.message ?? '').trim();
    const title = String(raw.title || '').trim();
    const enabled = raw.enabled !== undefined ? Boolean(raw.enabled) : Boolean(content || title);
    return {
      id: String(raw.id || raw.updatedAt || 'sys_ann'),
      enabled,
      title,
      content,
      mode: ['daily', 'every_login', 'time_range', 'banner', 'modal', 'toast'].includes(String(raw.mode || '').toLowerCase())
        ? String(raw.mode).toLowerCase()
        : 'daily',
      startDate: raw.startDate ? String(raw.startDate) : '',
      endDate: raw.endDate ? String(raw.endDate) : '',
      updatedAt: raw.updatedAt || null
    };
  }
  return null;
}

function safeDecryptJson(ciphertext, key) {
  if (!ciphertext || !key) return null;
  try {
    const raw = decryptSecret(ciphertext, key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

// Helper: Sanitize Bot DTO according to session permissions (Hiding IP/URL/Proxy for rental clients)
function sanitizeBotForSession(botData, session) {
  if (!botData) return botData;
  const copy = { ...botData };
  delete copy.secretKey;
  delete copy.secretCiphertext;
  if (session && session.role === 'admin') return copy;

  copy.url = '';
  copy.serviceUrl = '';
  delete copy.sourceUrl;
  delete copy.registryFile;
  copy.ipAddress = '';
  copy.host = '';
  copy.proxy = null;
  copy.proxyCiphertext = null;

  for (const key of [
    'cpuPercent', 'rssMb', 'heapUsedMb', 'ramRss', 'ramHeap', 'ramPercent',
    'netDownKb', 'netUpKb', 'netTotalRxMb', 'memory', 'hostHardware',
    'provider', 'platform'
  ]) {
    delete copy[key];
  }
  if (copy.history && typeof copy.history === 'object') {
    copy.history = { ...copy.history };
    delete copy.history.ram;
  }
  if (copy.summary && typeof copy.summary === 'object') {
    copy.summary = { ...copy.summary };
    for (const key of [
      'cpuPercent', 'rssMb', 'heapUsedMb', 'ramUsedMb', 'ramTotalMb', 'ramPercent',
      'botRssMb', 'botHeapMb', 'netDownKb', 'netUpKb', 'netTotalRxMb', 'ramHistory',
      'memory', 'hostHardware', 'hardware'
    ]) {
      delete copy.summary[key];
    }
  }

  if (session && session.allowAccountChange === false) {
    if (copy.settings && typeof copy.settings === 'object') {
      copy.settings = { ...copy.settings };
      if (copy.settings.spawnCommands) copy.settings.spawnCommands = '********';
    }
  }
  return copy;
}

function createUserApi({
  store,
  entitlementService,
  link4mService,
  registry,
  broker,
  fleetOperations,
  config,
  logger,
  invalidateUserSessions
}) {
  const router = express.Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
    const orig = router[method].bind(router);
    router[method] = (path, ...handlers) => orig(
      path,
      ...handlers.map((fn) => (typeof fn === 'function' && fn.length < 4
        ? (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
        : fn))
    );
  }
  const verifyRateLimiter = new Map();
  let publicBootstrapCache = null;

  function checkVerifyRateLimit(ip) {
    const now = Date.now();
    const key = String(ip || 'unknown');
    let entry = verifyRateLimiter.get(key);
    if (!entry || now > entry.resetAt) {
      if (verifyRateLimiter.size > 1000) verifyRateLimiter.clear();
      entry = { count: 0, resetAt: now + 60000 };
    }
    entry.count += 1;
    verifyRateLimiter.set(key, entry);
    return entry.count <= 20;
  }

  function resolveAdminProxyObject(worker) {
    if (!worker) return parseProxyUrlToObject('');
    if (worker.settings?.proxyCiphertext && registry.encryptionKey) {
      try {
        const decrypted = decryptSecret(worker.settings.proxyCiphertext, registry.encryptionKey);
        if (decrypted) return parseProxyUrlToObject(decrypted);
      } catch (_) {}
    }
    if (typeof worker.proxy === 'string' && worker.proxy.trim()) {
      return parseProxyUrlToObject(worker.proxy);
    }
    if (worker.proxy && typeof worker.proxy === 'object') {
      return worker.proxy;
    }
    return parseProxyUrlToObject('');
  }

  function resolveProxyInputWithSavedPassword(rawProxy, worker, options = {}) {
    if (rawProxy && typeof rawProxy === 'object' && !Array.isArray(rawProxy)) {
      const providedPass = String(rawProxy.password || '');
      const providedUser = String(rawProxy.username || '').trim();
      const providedHost = String(rawProxy.host || '').trim().toLowerCase();
      if (!providedPass && !rawProxy.clearPassword && providedUser && worker?.settings?.proxyCiphertext && registry?.encryptionKey) {
        try {
          const existingUrl = decryptSecret(worker.settings.proxyCiphertext, registry.encryptionKey);
          if (existingUrl) {
            const parsedExisting = new URL(existingUrl);
            const existingUser = decodeURIComponent(parsedExisting.username || '');
            const existingPass = decodeURIComponent(parsedExisting.password || '');
            const existingHost = parsedExisting.hostname.replace(/^\[|\]$/g, '').toLowerCase();
            if (existingPass && existingUser === providedUser && (!providedHost || existingHost === providedHost)) {
              return parseProxyInputToUrl({ ...rawProxy, password: existingPass }, options);
            }
          }
        } catch (_) {}
      }
    }
    return parseProxyInputToUrl(rawProxy, options);
  }

  // Helper: Resolve worker by workerId (string) or botNumber (number/string)
  async function resolveWorker(targetId) {
    if (!targetId && targetId !== 0) return null;
    const strId = String(targetId).trim().toLowerCase();
    let worker = await registry.find(strId);
    if (worker) return worker;
    const num = Number(strId);
    if (Number.isInteger(num) && num > 0) {
      worker = await registry.findByNumber(num);
      if (worker) return worker;
    }
    return null;
  }

  function commandErrorStatus(failure) {
    const code = String(failure?.code || failure?.error || '').trim().toUpperCase();
    const statusByCode = {
      CREDENTIALS_MISSING: 422,
      UNSUPPORTED_ACTION: 400,
      INVALID_PAYLOAD: 400,
      PAYLOAD_TOO_LARGE: 413,
      WORKER_NOT_FOUND: 404,
      LIFECYCLE_CONFLICT: 409,
      INVENTORY_STALE: 409,
      WINDOW_STALE: 409,
      REVISION_MISMATCH: 409,
      BOT_NOT_ONLINE: 409,
      WORKER_DISABLED: 409,
      WORKER_RESTRICTED: 409,
      RATE_LIMIT: 429,
      QUEUE_BUSY: 503,
      WORKER_UNAVAILABLE: 503,
      ETIMEDOUT: 504,
      EXECUTION_TIMEOUT: 504,
      RESULT_TIMEOUT: 504,
      COMMAND_EXPIRED: 504
    };
    if (statusByCode[code]) return statusByCode[code];

    const upstreamStatus = Number(failure?.status);
    return [400, 404, 409, 422, 429, 502, 503, 504].includes(upstreamStatus) ? upstreamStatus : 500;
  }

  function commandErrorResponse(res, error) {
    return res.status(commandErrorStatus(error)).json({
      ok: false,
      error: error?.message || 'Không thể thực thi lệnh.',
      code: error?.code || null
    });
  }

  // Helper: Evaluate command broker dispatch result for consistent HTTP status mapping
  function evaluateCommandDispatch(dispatchResult, defaultErrorMessage = 'Thao tác không hoàn tất') {
    if (!dispatchResult || dispatchResult.timedOut || dispatchResult.delivered === false) {
      return {
        success: false,
        status: 504,
        payload: {
          ok: false,
          error: 'Lệnh tới Bot quá thời gian chờ phản hồi (Gateway Timeout).',
          timedOut: true
        }
      };
    }

    const innerResult = dispatchResult.result;
    if (innerResult && typeof innerResult === 'object' && innerResult.ok === false) {
      const code = innerResult.code || innerResult.error || null;
      const reason = innerResult.detail || innerResult.message || innerResult.error || defaultErrorMessage;
      return {
        success: false,
        status: commandErrorStatus({ code, status: innerResult.status }),
        payload: {
          ok: false,
          error: `${defaultErrorMessage}: ${reason}`,
          code,
          result: innerResult
        }
      };
    }

    return {
      success: true,
      result: innerResult || null
    };
  }

  // Helper: Extract decrypted Minecraft username from worker credentials if configured
  function getBotUsername(worker) {
    if (!worker) return '';
    const ciphertext = worker.settings?.mcCredentialsCiphertext;
    if (ciphertext && registry.encryptionKey) {
      const creds = safeDecryptJson(ciphertext, registry.encryptionKey);
      if (creds && creds.username) return creds.username;
    }
    if (worker.username) return worker.username;
    if (worker.status?.username) return worker.status.username;
    return '';
  }

  // Middleware: Require Authenticated User Session
  function requireSession(req, res, next) {
    const session = req.managerAuthSession;
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Chưa đăng nhập hệ thống.' });
    }
    if (session.status === 'disabled') {
      return res.status(403).json({ ok: false, error: 'Tài khoản của bạn đã bị vô hiệu hóa bởi Quản trị viên.' });
    }
    return next();
  }

  // Helper: Safe worker ownership matching (prevents cross-tenant botNumber collision / IDOR)
  function isWorkerAssignedToSession(worker, assignedList, allWorkers = null) {
    if (!worker || !Array.isArray(assignedList) || assignedList.length === 0) return false;
    const assignedLower = assignedList.map((id) => String(id).trim().toLowerCase()).filter(Boolean);
    const workerIdLower = String(worker.workerId || '').trim().toLowerCase();
    if (workerIdLower && assignedLower.includes(workerIdLower)) return true;

    const botNum = Number(worker.botNumber);
    if (!Number.isInteger(botNum) || botNum <= 0) return false;
    const botNumStr = String(botNum);
    if (!assignedLower.includes(botNumStr)) return false;

    // Never match numeric botNumber if this worker has a DIFFERENT numeric workerId (e.g. workerId '11' vs botNumber 10)
    if (/^\d+$/.test(workerIdLower) && Number(workerIdLower) !== botNum) return false;
    // Never match botNumber if another worker literally owns workerId === botNumStr
    if (Array.isArray(allWorkers) && allWorkers.some((w) => w && String(w.workerId || '').trim().toLowerCase() === botNumStr && String(w.workerId || '').trim().toLowerCase() !== workerIdLower)) {
      return false;
    }
    return true;
  }

  // Helper: Verify User Access to Target Bot
  async function checkBotPermissionAsync(req, targetId) {
    const session = req.managerAuthSession;
    if (!session) return { allowed: false, status: 401, error: 'Chưa đăng nhập hệ thống.' };

    const worker = await resolveWorker(targetId);
    if (!worker) return { allowed: false, status: 404, error: 'Không tìm thấy bot.' };

    if (session.role === 'admin') return { allowed: true, user: session, worker };

    const assigned = Array.isArray(session.assignedBotIds) ? session.assignedBotIds.map(String) : [];
    if (!isWorkerAssignedToSession(worker, assigned)) {
      return { allowed: false, status: 403, error: 'Bạn không có quyền quản lý bot này.' };
    }

    const isExpired = session.status === 'expired' ||
      session.status === 'grace_period' ||
      session.inGracePeriod === true ||
      (!session.isPermanent && session.expiresAtRental && Date.now() > Date.parse(session.expiresAtRental));

    if (isExpired) {
      const method = String(req.method || 'GET').toUpperCase();
      const routePath = String(req.path || '').split('?')[0].toLowerCase();
      const isReadRequest = method === 'GET' || method === 'HEAD';
      const isRenewRequest = routePath === '/renew' ||
        routePath === '/redeem' ||
        routePath === '/manager/renew' ||
        routePath === '/keys/redeem';

      if (!isReadRequest && !isRenewRequest) {
        return {
          allowed: false,
          status: 403,
          error: 'Gói bot của bạn đã hết hạn, tính năng điều khiển bị vô hiệu hóa. Vui lòng gia hạn để tiếp tục sử dụng.'
        };
      }
    }

    return { allowed: true, user: session, worker };
  }

  // Helper: Build standardized safe bot payload for API responses
  function buildBotPayload(worker, session, summary = null, assignment = null, { compact = false } = {}) {
    const username = getBotUsername(worker);
    const configured = Boolean(worker.settings?.mcCredentialsCiphertext || (username && username !== 'Chưa đặt'));
    const isOnline = worker.status?.state === 'online';
    const isReachable = Boolean(worker.reachable || isOnline);
    const botNum = Number(worker.botNumber || worker.workerId || 1);
    let summaryData = summary?.data || null;
    if (compact && summaryData && typeof summaryData === 'object') {
      summaryData = { ...summaryData };
      delete summaryData.inventory;
      delete summaryData.currentWindow;
    }

    const safeBot = sanitizeBotForSession({
      id: worker.workerId,
      botNumber: botNum,
      workerId: worker.workerId,
      name: worker.name || worker.alias || `KingMC Bot ${botNum}`,
      alias: worker.alias || worker.name || `KingMC Bot ${botNum}`,
      label: worker.alias || worker.name || `KingMC Bot ${botNum}`,
      username: username || 'Chưa đặt',
      configured,
      available: isReachable,
      ipAddress: worker.status?.clientIp || worker.status?.hostIp || worker.status?.ip || worker.clientIp || worker.hostIp || worker.host || '',
      host: worker.status?.clientIp || worker.status?.hostIp || worker.status?.ip || worker.clientIp || worker.hostIp || worker.host || '',
      platform: worker.platform || worker.provider || 'wispbyte',
      provider: worker.provider || 'wispbyte',
      enabled: worker.enabled,
      status: worker.status?.state || 'offline',
      state: worker.status?.state || 'offline',
      online: isOnline,
      lastKickReason: worker.status?.lastKickReason || '',
      lastError: worker.status?.lastError || '',
      server: worker.status?.server || worker.status?.serverHost || worker.settings?.serverHost || worker.serverHost || worker.server || 'kingmc.vn',
      dimension: worker.status?.dimension || 'unknown',
      locationState: worker.status?.locationState || 'unknown',
      health: worker.status?.health ?? 20,
      food: worker.status?.food ?? 20,
      totemCount: worker.status?.totemCount ?? 0,
      goldenAppleCount: worker.status?.goldenAppleCount ?? 0,
      inventory: compact ? [] : (worker.status?.inventory || []),
      pos: worker.status?.position || { x: 0, y: 0, z: 0 },
      position: worker.status?.position || { x: 0, y: 0, z: 0 },
      ping: worker.status?.pingMs ?? worker.status?.ping ?? 0,
      tps: typeof worker.status?.tps === 'number' ? worker.status.tps : null,
      serverTps: typeof worker.status?.tps === 'number' ? worker.status.tps : null,
      uptime: worker.status?.uptimeSeconds ?? worker.status?.uptime ?? 0,
      uptimeSeconds: worker.status?.uptimeSeconds ?? worker.status?.uptime ?? 0,
      connectedAt: worker.status?.connectedAt || (isOnline && Number(worker.status?.uptimeSeconds) > 0
        ? new Date(Date.now() - Number(worker.status.uptimeSeconds) * 1000).toISOString()
        : null),
      reconnectAttempts: worker.status?.reconnectAttempts ?? 0,
      reconnectCount: worker.status?.reconnectCount ?? 0,
      lastSeen: worker.lastHeartbeat || null,
      manuallyStopped: Boolean(worker.status?.manuallyStopped),
      tags: worker.tags || [],
      rentable: worker.rentable !== false,
      assignedUsername: assignment?.username || null,
      assignedPlan: assignment?.planName || null,
      summary: summaryData,
      url: worker.serviceUrl || '',
      proxy: worker.proxy || null,
      currentWindow: compact ? null : (worker.status?.currentWindow || null),
      history: {
        ping: worker.status?.pingHistory || [],
        ram: worker.status?.ramHistory || []
      },
      hostHardware: {
        ramUsedMb: worker.status?.rssMb || 0,
        ramTotalMb: 512,
        ramPercent: worker.status?.rssMb ? Math.round((worker.status.rssMb / 512) * 100) : 0,
        cpuPercent: worker.status?.cpuPercent || 0,
        cpuCores: 1,
        botRssMb: worker.status?.rssMb || 0,
        botHeapMb: worker.status?.heapUsedMb || 0,
        netDownKb: 0,
        netUpKb: 0
      }
    }, session);

    return safeBot;
  }

  // Helper to fetch user assignments map
  async function getUserAssignmentsMap() {
    const map = new Map();
    try {
      if (typeof store.listAccess === 'function') {
        const users = await store.listAccess();
        if (Array.isArray(users)) {
          for (const u of users) {
            const botIds = Array.isArray(u.workerIds) && u.workerIds.length
              ? u.workerIds
              : (Array.isArray(u.assignedBotIds) ? u.assignedBotIds : []);
            for (const bId of botIds) {
              map.set(String(bId), { username: u.username, planName: u.planName });
            }
          }
        }
      }
    } catch (_) {}
    return map;
  }

  // 1. GET ALL ACCESSIBLE BOTS (used by dashboard home & table)
  const getBotsHandler = async (req, res) => {
    try {
      const session = req.managerAuthSession;
      const allBots = await registry.list();
      const assignmentMap = session.role === 'admin' ? await getUserAssignmentsMap() : null;
      const selfAssignment = session.role === 'admin' ? null : { username: session.username || null, planName: session.planName || null };
      let globalOrder = [];
      if (typeof store?.getSetting === 'function') {
        const configuredOrder = await Promise.resolve(store.getSetting('bot_display_order')).catch(() => null);
        if (Array.isArray(configuredOrder)) globalOrder = configuredOrder.map(String);
      }
      if (globalOrder.length) {
        const position = new Map(globalOrder.map((workerId, index) => [workerId, index]));
        allBots.sort((a, b) => {
          const aPosition = position.has(String(a.workerId)) ? position.get(String(a.workerId)) : Number.MAX_SAFE_INTEGER;
          const bPosition = position.has(String(b.workerId)) ? position.get(String(b.workerId)) : Number.MAX_SAFE_INTEGER;
          return aPosition - bPosition || Number(a.botNumber || 0) - Number(b.botNumber || 0);
        });
      }

      let visibleBots = [];
      if (session.role === 'admin') {
        visibleBots = allBots;
      } else {
        const assigned = Array.isArray(session.assignedBotIds) ? session.assignedBotIds.map(String) : [];
        visibleBots = allBots.filter((b) => isWorkerAssignedToSession(b, assigned, allBots));
      }

      const payload = visibleBots.map((bot) => {
        const summary = registry.summary(bot.workerId) || {};
        const assignment = assignmentMap
          ? (assignmentMap.get(String(bot.workerId)) || assignmentMap.get(String(bot.botNumber)) || null)
          : selfAssignment;
        return buildBotPayload(bot, session, summary, assignment, { compact: true });
      });

      const managerRamMb = session.role === 'admin'
        ? Math.round(process.memoryUsage().rss / (1024 * 1024))
        : undefined;
      const currentUserSnapshot = {
        status: session.status || 'active',
        expiresAt: session.expiresAtRental || null,
        isPermanent: Boolean(session.isPermanent),
        planName: session.planName || '',
        assignedBotIds: Array.isArray(session.assignedBotIds) ? session.assignedBotIds : [],
        inGracePeriod: Boolean(session.inGracePeriod)
      };
      // Compute stable signature excluding per-second volatile fields (lastSeen, raw uptimeSeconds, connectedAt)
      const sigBots = payload.map((b) => {
        const copy = { ...b };
        delete copy.lastSeen;
        delete copy.connectedAt;
        copy._rev = registry.workerStateRev
          ? (registry.workerStateRev.get(String(b.workerId || b.id || '').toLowerCase()) || 0)
          : 0;
        copy.uptime = Math.floor(Number(copy.uptime || 0) / 60);
        copy.uptimeSeconds = copy.uptime;
        copy.ping = Math.round(Number(copy.ping || 0) / 25) * 25;
        if (copy.summary && typeof copy.summary === 'object') {
          const sCopy = { ...copy.summary };
          delete sCopy.updatedAt;
          delete sCopy.lastStateAt;
          delete sCopy.uptimeSeconds;
          delete sCopy.connectedAt;
          copy.summary = sCopy;
        }
        return copy;
      });
      const sig = crypto
        .createHash('sha1')
        .update(JSON.stringify({ bots: sigBots, currentUser: currentUserSnapshot }))
        .digest('hex')
        .slice(0, 16);

      if (typeof req.query?.sig === 'string' && req.query.sig === sig) {
        return res.json({
          ok: true,
          unchanged: true,
          sig,
          ...(managerRamMb !== undefined ? { managerRamMb } : {})
        });
      }

      return res.json({
        ok: true,
        sig,
        bots: payload,
        currentUser: currentUserSnapshot,
        ...(managerRamMb !== undefined ? { managerRamMb } : {})
      });
    } catch (error) {
      logger.error('Failed to get bots', { error: error.message });
      return res.status(500).json({ ok: false, error: error.message });
    }
  };

  router.get('/bots', requireSession, getBotsHandler);
  router.get('/registry', requireSession, getBotsHandler);

  // 2. REORDER BOTS (Drag and drop in UI)
  router.post('/bots/reorder', requireSession, async (req, res) => {
    const session = req.managerAuthSession;
    const isExpired = session?.status === 'expired' ||
      session?.status === 'grace_period' ||
      session?.inGracePeriod === true ||
      (!session?.isPermanent && session?.expiresAtRental && Date.now() > Date.parse(session.expiresAtRental));
    if (isExpired && session?.role !== 'admin') {
      return res.status(403).json({
        ok: false,
        error: 'Gói bot của bạn đã hết hạn, tính năng điều khiển bị vô hiệu hóa. Vui lòng gia hạn để tiếp tục sử dụng.'
      });
    }

    const rawOrder = req.body?.botIds || req.body?.order;
    if (
      !Array.isArray(rawOrder) ||
      rawOrder.length === 0 ||
      !rawOrder.every((id) => typeof id === 'string' && id.trim().length > 0)
    ) {
      return res.status(400).json({ ok: false, error: 'Danh sách thứ tự bot không hợp lệ (phải là mảng chuỗi ID không rỗng).' });
    }

    const updatedOrder = rawOrder.map((id) => String(id).trim());

    try {
      if (session?.role === 'admin') {
        const allIds = (await registry.list()).map((worker) => String(worker.workerId));
        const uniqueOrder = new Set(updatedOrder);
        if (uniqueOrder.size !== updatedOrder.length || updatedOrder.length !== allIds.length || allIds.some((id) => !uniqueOrder.has(id))) {
          return res.status(400).json({ ok: false, error: 'Thứ tự mới phải chứa chính xác mỗi bot đã đăng ký một lần.' });
        }
        if (typeof store?.setSetting !== 'function') {
          return res.status(503).json({ ok: false, error: 'Chưa có bộ lưu thứ tự bot dùng chung.' });
        }
        await store.setSetting('bot_display_order', updatedOrder);
        return res.json({ ok: true, message: 'Đã lưu thứ tự bot.', order: updatedOrder });
      }

      const assigned = Array.isArray(session?.assignedBotIds) ? session.assignedBotIds.map((id) => String(id).trim()).filter(Boolean) : [];
      const uniqueAssigned = new Set(assigned);
      const uniqueOrder = new Set(updatedOrder);

      // Verify submitted bot IDs are an exact permutation of session.assignedBotIds (no unauthorized, duplicate, or dropped bots)
      const unauthorized = updatedOrder.some((id) => !uniqueAssigned.has(id));
      if (unauthorized) {
        return res.status(403).json({ ok: false, error: 'Chứa bot ID không thuộc quyền quản lý của bạn.' });
      }
      if (uniqueOrder.size !== updatedOrder.length || uniqueOrder.size !== uniqueAssigned.size) {
        return res.status(400).json({ ok: false, error: 'Danh sách sắp xếp phải chứa đầy đủ và không trùng lặp tất cả các bot được gán cho bạn.' });
      }

      const userId = session.userId || session.id || session.username;
      if (store && typeof store.setAccess === 'function') {
        await store.setAccess(userId, { workerIds: updatedOrder }, session.username || 'user');
      } else if (store && typeof store.updateUser === 'function') {
        await store.updateUser(userId, { assigned_bot_ids: updatedOrder });
      }

      session.assignedBotIds = updatedOrder;
      return res.json({ ok: true, message: 'Đã lưu thứ tự bot.', order: updatedOrder });
    } catch (error) {
      logger?.error('Failed to reorder bots', { error: error.message });
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 3. GET SYSTEM ANNOUNCEMENT
  router.get('/announcement', requireSession, async (_req, res) => {
    let rawAnnouncement = store?.cachedAnnouncement;
    if (rawAnnouncement === undefined && typeof store?.getSetting === 'function') {
      try {
        rawAnnouncement = await store.getSetting('system_announcement');
        store.cachedAnnouncement = rawAnnouncement || null;
      } catch (_) {
        rawAnnouncement = null;
      }
    }
    const announcement = normalizeAnnouncementValue(rawAnnouncement);
    return res.json({
      ok: true,
      announcement: announcement && announcement.enabled ? announcement : (announcement || null)
    });
  });

  // 4. GET BOT SNAPSHOT (Complete state for Detail drawer/modal)
  router.get('/bot/:id/snapshot', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const worker = perm.worker;
    const session = req.managerAuthSession;
    const summary = registry.summary(worker.workerId);
    const inventory = worker.status?.inventory || { items: [], slots: {}, revision: 0 };
    const logs = typeof registry.getLogs === 'function' ? registry.getLogs(worker.workerId) : [];

    const rev = typeof registry.getSnapshotRevision === 'function'
      ? registry.getSnapshotRevision(worker, { inventory, logs })
      : String(
          worker.updatedAt
            ? new Date(worker.updatedAt).getTime()
            : `${worker.status?.state || ''}:${inventory.revision || 0}:${logs.length}`
        );

    const reqRev = typeof req.query?.rev === 'string' ? req.query.rev : '';
    if (reqRev && reqRev === rev) {
      return res.json({ ok: true, unchanged: true, rev });
    }

    const assignmentMap = session.role === 'admin' ? await getUserAssignmentsMap() : null;
    const assignment = assignmentMap
      ? (assignmentMap.get(String(worker.workerId)) || assignmentMap.get(String(worker.botNumber)) || null)
      : { username: session.username || null, planName: session.planName || null };
    const safeBot = buildBotPayload(worker, session, summary, assignment);
    const canRevealMcAccount = session.role === 'admin' || session.allowAccountChange !== false;
    const decryptedCreds = canRevealMcAccount && worker.settings?.mcCredentialsCiphertext && registry.encryptionKey
      ? safeDecryptJson(worker.settings.mcCredentialsCiphertext, registry.encryptionKey)
      : null;

    if (canRevealMcAccount && decryptedCreds) {
      safeBot.mcUsername = decryptedCreds.username || safeBot.username || '';
      safeBot.mcPassword = decryptedCreds.password || '';
    }

    const settings = {
      ecoMode: worker.settings?.ecoMode !== false,
      autoTotem: worker.settings?.autoTotem !== false,
      antiHungry: worker.settings?.antiHungry !== false,
      autoReconnect: worker.settings?.autoReconnect !== false,
      antiAfkKick: worker.settings?.antiAfkKick !== false,
      userNotifyEnabled: worker.settings?.userNotifyEnabled !== false,
      notifyOnAfkKick: worker.settings?.notifyOnAfkKick !== false,
      notifyOnAfkRecover: worker.settings?.notifyOnAfkRecover !== false,
      notifyOnReconnectExhausted: worker.settings?.notifyOnReconnectExhausted !== false,
      spawnCommands: canRevealMcAccount ? (worker.settings?.spawnCommands || '') : (worker.settings?.spawnCommands ? '********' : ''),
      proxy: { enabled: Boolean(worker.settings?.proxyManaged && worker.settings?.proxyCiphertext) },
      ...(canRevealMcAccount ? {
        mcUsername: decryptedCreds?.username || getBotUsername(worker) || '',
        mcPassword: decryptedCreds?.password || ''
      } : {})
    };

    const logRevs = typeof registry.getLogRevisions === 'function'
      ? registry.getLogRevisions(worker.workerId)
      : { logRevision: logs.length, chatLogRevision: logs.length };

    return res.json({
      ok: true,
      rev,
      logRevision: logRevs.logRevision,
      chatLogRevision: logRevs.chatLogRevision,
      bot: safeBot,
      inventory,
      settings,
      autoChatSchedules: worker.settings?.autoChatSchedules || [],
      botSchedules: worker.settings?.botSchedules || []
    });
  });

  // 5. GET SPECIFIC BOT STATE (Fallback for Detail drawer)
  router.get('/bot/:id/state', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const worker = perm.worker;
    const session = req.managerAuthSession;
    const summary = registry.summary(worker.workerId);
    const assignmentMap = session.role === 'admin' ? await getUserAssignmentsMap() : null;
    const assignment = assignmentMap
      ? (assignmentMap.get(String(worker.workerId)) || assignmentMap.get(String(worker.botNumber)) || null)
      : { username: session.username || null, planName: session.planName || null };
    const safeBot = buildBotPayload(worker, session, summary, assignment);

    return res.json({
      ok: true,
      bot: safeBot,
      ...safeBot
    });
  });

  // 6. DETAIL SUB-GETTERS (Fallbacks)
  router.get('/bot/:id/inventory', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    return res.json({
      ok: true,
      inventory: perm.worker.status?.inventory || { items: [], slots: {}, revision: 0 }
    });
  });

  router.get('/bot/:id/settings', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    const worker = perm.worker;
    const session = req.managerAuthSession;
    const canRevealMcAccount = session.role === 'admin' || session.allowAccountChange !== false;
    const decryptedCreds = canRevealMcAccount && worker.settings?.mcCredentialsCiphertext && registry.encryptionKey
      ? safeDecryptJson(worker.settings.mcCredentialsCiphertext, registry.encryptionKey)
      : null;
    return res.json({
      ok: true,
      settings: {
        ecoMode: worker.settings?.ecoMode !== false,
        autoTotem: worker.settings?.autoTotem !== false,
        antiHungry: worker.settings?.antiHungry !== false,
        autoReconnect: worker.settings?.autoReconnect !== false,
        antiAfkKick: worker.settings?.antiAfkKick !== false,
        userNotifyEnabled: worker.settings?.userNotifyEnabled !== false,
        notifyOnAfkKick: worker.settings?.notifyOnAfkKick !== false,
        notifyOnAfkRecover: worker.settings?.notifyOnAfkRecover !== false,
        notifyOnReconnectExhausted: worker.settings?.notifyOnReconnectExhausted !== false,
        spawnCommands: canRevealMcAccount ? (worker.settings?.spawnCommands || '') : (worker.settings?.spawnCommands ? '********' : ''),
        proxy: session.role === 'admin'
          ? resolveAdminProxyObject(worker)
          : { enabled: Boolean(worker.settings?.proxyManaged && worker.settings?.proxyCiphertext) },
        ...(canRevealMcAccount ? {
          mcUsername: decryptedCreds?.username || getBotUsername(worker) || '',
          mcPassword: decryptedCreds?.password || ''
        } : {})
      }
    });
  });

  router.get(['/bot/:id/autoChat', '/bot/:id/auto-chat'], requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    return res.json({
      ok: true,
      autoChatSchedules: perm.worker.settings?.autoChatSchedules || []
    });
  });

  router.get(['/bot/:id/botSchedules', '/bot/:id/bot-schedules'], requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    return res.json({
      ok: true,
      botSchedules: perm.worker.settings?.botSchedules || []
    });
  });

  router.get('/bot/:id/logs', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    return res.json({
      ok: true,
      logs: typeof registry.getSystemLogs === 'function'
        ? registry.getSystemLogs(perm.worker.workerId)
        : registry.getLogs(perm.worker.workerId, { systemOnly: true })
    });
  });

  router.get('/bot/:id/chat-logs', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    return res.json({
      ok: true,
      logs: typeof registry.getChatLogs === 'function'
        ? registry.getChatLogs(perm.worker.workerId)
        : registry.getLogs(perm.worker.workerId, { chatOnly: true })
    });
  });

  router.get('/bot/:id/position-logs', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    return res.json({ ok: true, logs: [] });
  });

  // 7. GET & SAVE MINECRAFT CREDENTIALS
  router.get('/bot/:id/account', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    if (req.managerAuthSession.role !== 'admin' && req.managerAuthSession.allowAccountChange === false) {
      return res.status(403).json({ ok: false, error: 'Gói dịch vụ của bạn không cho phép xem tài khoản Minecraft.' });
    }

    const worker = perm.worker;
    let priv = null;
    if (typeof registry.privateSettings === 'function') {
      priv = await registry.privateSettings(worker.workerId).catch(() => null);
    }
    const creds = !priv && worker.settings?.mcCredentialsCiphertext && registry.encryptionKey
      ? safeDecryptJson(worker.settings.mcCredentialsCiphertext, registry.encryptionKey)
      : null;

    return res.json({
      ok: true,
      username: priv?.username ?? creds?.username ?? getBotUsername(worker) ?? '',
      password: priv?.password ?? creds?.password ?? ''
    });
  });

  router.post('/bot/:id/account', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    if (req.managerAuthSession.role !== 'admin' && req.managerAuthSession.allowAccountChange === false) {
      return res.status(403).json({ ok: false, error: 'Gói dịch vụ của bạn không cho phép tự đổi tài khoản Minecraft.' });
    }

    const { username, password } = req.body || {};
    const cleanUser = String(username || '').trim();
    if (!cleanUser) {
      return res.status(400).json({ ok: false, error: 'Tên nhân vật Minecraft không được để trống.' });
    }

    try {
      const worker = perm.worker;
      await registry.updateCredentials(worker.workerId, { username: cleanUser, password });
      await store.addAudit({
        action: 'BOT_CREDENTIALS_SET',
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        details: { username: cleanUser }
      });
      return res.json({
        ok: true,
        message: 'Đã lưu tài khoản Minecraft thành công.',
        username: cleanUser
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 8. SEND CHAT MESSAGE VIA BOT (accepts both message and text)
  const RESTRICTED_MC_CHAT_CMD_RE = /^\/\s*(?:[a-z0-9_-]+:)?(?:register|reg|login|l|dn|dk|changepassword|changepass|password|unregister|email)\b/i;
  const redactChatCommandForAudit = (msg) => String(msg || '').replace(
    /(\/(?:[a-z0-9_-]+:)?(?:login|l|register|reg|dn|dk|changepassword|changepass|password|unregister|email)\s+).+$/gim,
    '$1[REDACTED]'
  );

  router.post('/bot/:id/send', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const worker = perm.worker;
    const rawMessage = req.body?.text ?? req.body?.message;
    const message = (typeof rawMessage === 'string' || typeof rawMessage === 'number') ? String(rawMessage).trim() : '';
    if (!message) return res.status(400).json({ ok: false, error: 'Nội dung tin nhắn không được để trống.' });
    if (req.managerAuthSession?.role !== 'admin' && req.managerAuthSession?.allowAccountChange === false && RESTRICTED_MC_CHAT_CMD_RE.test(message)) {
      return res.status(403).json({ ok: false, error: 'Tài khoản thuê bị giới hạn không được gửi lệnh đăng nhập / đổi mật khẩu Minecraft.' });
    }

    try {
      const dispatchResult = await broker.dispatch(worker.workerId, 'chat', { message });
      const evaluated = evaluateCommandDispatch(dispatchResult, 'Không thể gửi tin nhắn chat');
      if (!evaluated.success) {
        return res.status(evaluated.status).json(evaluated.payload);
      }

      const safeAuditMsg = redactChatCommandForAudit(message);
      await store.addAudit({
        action: 'BOT_CHAT_SENT',
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        details: { message: safeAuditMsg.slice(0, 100) }
      });

      return res.json({
        ok: true,
        message: `Đã gửi tin nhắn tới server: "${safeAuditMsg}"`,
        result: evaluated.result
      });
    } catch (error) {
      return commandErrorResponse(res, error);
    }
  });

  // 9. SCHEDULE CONFIGURATION
  router.post(['/bot/:id/auto-chat', '/bot/:id/autoChat'], requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    if (req.managerAuthSession?.role !== 'admin' && req.managerAuthSession?.allowAccountChange === false) {
      return res.status(403).json({ ok: false, error: 'Tài khoản của bạn bị hạn chế thay đổi cấu hình lịch Auto Chat của bot.' });
    }

    if (!Array.isArray(req.body?.autoChatSchedules)) {
      return res.status(400).json({ ok: false, error: 'Schedules must be an array.' });
    }

    const worker = perm.worker;
    const schedules = req.body.autoChatSchedules;

    try {
      await registry.updateSettings(worker.workerId, { autoChatSchedules: schedules });
      return res.json({ ok: true, message: 'Đã lưu lịch Auto Chat thành công.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post(['/bot/:id/bot-schedules', '/bot/:id/botSchedules'], requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });
    if (req.managerAuthSession?.role !== 'admin' && req.managerAuthSession?.allowAccountChange === false) {
      return res.status(403).json({ ok: false, error: 'Tài khoản của bạn bị hạn chế thay đổi lịch hoạt động Bot.' });
    }

    if (!Array.isArray(req.body?.botSchedules)) {
      return res.status(400).json({ ok: false, error: 'Schedules must be an array.' });
    }

    const worker = perm.worker;
    const schedules = req.body.botSchedules;

    try {
      await registry.updateSettings(worker.workerId, { botSchedules: schedules });
      return res.json({ ok: true, message: 'Đã lưu lịch hoạt động Bot thành công.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 10. CLEAR LOGS
  router.post(['/bot/:id/logs/clear', '/bot/:id/chat-logs/clear'], requireSession, async (req, res) => {
    if (req.managerAuthSession?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ quản trị viên mới được xóa lịch sử bot.' });
    }

    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const normId = String(perm.worker.workerId || '').trim().toLowerCase();
    const isChatClear = req.path.includes('chat-logs');
    if (isChatClear) {
      if (registry.botChatLogsCache) {
        registry.botChatLogsCache.set(normId, []);
      }
      if (registry.botChatLogRev) registry.botChatLogRev.set(normId, (registry.botChatLogRev.get(normId) || 0) + 1);
    } else {
      if (registry.botLogsCache) {
        registry.botLogsCache.set(normId, []);
      }
      if (registry.botLogRev) registry.botLogRev.set(normId, (registry.botLogRev.get(normId) || 0) + 1);
    }
    registry.bumpRevision?.(normId);
    return res.json({ ok: true, message: isChatClear ? 'Đã xóa nhật ký chat.' : 'Đã xóa nhật ký sự kiện.' });
  });

  // 11. REMOTE WINDOW GUI ACTIONS
  router.post('/bot/:id/window/click', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    try {
      const dispatchResult = await broker.dispatch(perm.worker.workerId, 'window_click', req.body || {});
      const evaluated = evaluateCommandDispatch(dispatchResult, 'Thao tác click giao diện không thành công');
      if (!evaluated.success) {
        const errPayload = { ...evaluated.payload };
        if (evaluated.payload?.result?.inventory) errPayload.inventory = evaluated.payload.result.inventory;
        if (evaluated.payload?.result && Object.prototype.hasOwnProperty.call(evaluated.payload.result, 'currentWindow')) {
          errPayload.currentWindow = evaluated.payload.result.currentWindow;
        }
        return res.status(evaluated.status).json(errPayload);
      }
      const r = evaluated.result || {};
      return res.json({
        ok: true,
        message: 'Đã gửi thao tác click giao diện.',
        ...(r.inventory ? { inventory: r.inventory } : {}),
        ...(Object.prototype.hasOwnProperty.call(r, 'currentWindow') ? { currentWindow: r.currentWindow } : {}),
        result: evaluated.result
      });
    } catch (error) {
      return commandErrorResponse(res, error);
    }
  });

  router.post('/bot/:id/window/close', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    try {
      const dispatchResult = await broker.dispatch(perm.worker.workerId, 'window_close', req.body || {});
      const evaluated = evaluateCommandDispatch(dispatchResult, 'Thao tác đóng giao diện không thành công');
      if (!evaluated.success) {
        return res.status(evaluated.status).json(evaluated.payload);
      }
      return res.json({
        ok: true,
        message: 'Đã gửi thao tác đóng giao diện.',
        currentWindow: null,
        result: evaluated.result
      });
    } catch (error) {
      return commandErrorResponse(res, error);
    }
  });

  // 12. INVENTORY SUB-ACTIONS
  router.post('/bot/:id/inventory/:invAction', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const invAction = req.params.invAction;
    try {
      const invPayload = (req.body && typeof req.body === 'object' && !Array.isArray(req.body))
        ? { ...req.body, action: invAction }
        : { action: invAction };
      const dispatchResult = await broker.dispatch(perm.worker.workerId, 'inventory', invPayload);
      const evaluated = evaluateCommandDispatch(dispatchResult, `Thao tác ${invAction} kho đồ không thành công`);
      if (!evaluated.success) {
        const errPayload = { ...evaluated.payload };
        if (evaluated.payload?.result?.inventory) {
          errPayload.inventory = evaluated.payload.result.inventory;
        }
        return res.status(evaluated.status).json(errPayload);
      }
      const r = evaluated.result || {};
      return res.json({
        ok: true,
        message: `Đã thực hiện thao tác ${invAction} kho đồ.`,
        ...(r.inventory ? { inventory: r.inventory } : {}),
        ...(r.unequippedToSlot !== undefined ? { unequippedToSlot: r.unequippedToSlot } : {}),
        result: evaluated.result
      });
    } catch (error) {
      return commandErrorResponse(res, error);
    }
  });

  // 13. PROXY TEST & SETTINGS (ADMIN-ONLY, SEC-02 & F-09)
  router.post('/bot/:id/proxy/test', requireSession, async (req, res) => {
    if (req.managerAuthSession?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (ADMIN) mới được kiểm tra cấu hình Proxy.' });
    }
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    let proxyUrl = '';
    try {
      const rawProxy = req.body?.proxy !== undefined ? req.body.proxy : req.body?.proxyUrl;
      proxyUrl = resolveProxyInputWithSavedPassword(rawProxy, perm.worker, { ignoreEnabledFlag: true });
      if (!proxyUrl) {
        return res.status(400).json({ ok: false, error: 'Vui lòng nhập đầy đủ Host và Port Proxy.' });
      }
      await validateProxyUrl(proxyUrl);
    } catch (validationErr) {
      return res.status(400).json({ ok: false, error: 'Proxy không hợp lệ: ' + validationErr.message });
    }

    if (req.body?.skipTcpProbe === true) {
      return res.json({ ok: true, latencyMs: 0, message: 'Cấu hình Proxy hợp lệ.' });
    }
    const probe = await probeProxyTcpLatency(proxyUrl, 3500);
    if (!probe.ok) {
      return res.status(400).json({ ok: false, latencyMs: null, error: `Không thể kết nối tới Proxy (${probe.error}).` });
    }
    return res.json({
      ok: true,
      latencyMs: probe.latencyMs,
      message: `Kết nối Proxy thành công! Độ trễ TCP: ${probe.latencyMs}ms.`
    });
  });

  router.get('/bot/:id/proxy', requireSession, async (req, res) => {
    if (req.managerAuthSession?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (ADMIN) mới được xem cấu hình Proxy.' });
    }
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    return res.json({ ok: true, proxy: resolveAdminProxyObject(perm.worker) });
  });

  router.post('/bot/:id/proxy', requireSession, async (req, res) => {
    if (req.managerAuthSession?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (ADMIN) mới được thay đổi cấu hình Proxy.' });
    }
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    let proxyUrl = '';
    try {
      const rawProxy = req.body?.proxy !== undefined ? req.body.proxy : req.body?.proxyUrl;
      proxyUrl = resolveProxyInputWithSavedPassword(rawProxy, perm.worker);
      if (proxyUrl) {
        await validateProxyUrl(proxyUrl);
      }
    } catch (validationErr) {
      return res.status(400).json({ ok: false, error: 'Proxy không hợp lệ hoặc bị từ chối: ' + validationErr.message });
    }

    try {
      await registry.updateProxy(perm.worker.workerId, proxyUrl || null);
      if (store && typeof store.addAudit === 'function') {
        await store.addAudit({
          action: 'ADMIN_UPDATE_BOT_PROXY',
          targetId: perm.worker.workerId,
          actorId: req.managerAuthSession.username,
          actorRole: 'admin',
          actorIp: req.ip || '127.0.0.1',
          details: { enabled: Boolean(proxyUrl) }
        }).catch(() => {});
      }
      return res.json({
        ok: true,
        proxy: parseProxyUrlToObject(proxyUrl),
        message: proxyUrl ? 'Đã lưu cấu hình Proxy cho bot.' : 'Đã tắt Proxy cho bot.'
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 14. UPDATE BOT SETTINGS
  router.post('/bot/:id/settings', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const isAdmin = req.managerAuthSession.role === 'admin';
    const rawPatch = req.body || {};
    const nested = (rawPatch.settings && typeof rawPatch.settings === 'object' && !Array.isArray(rawPatch.settings))
      ? rawPatch.settings
      : {};
    const patch = { ...nested, ...rawPatch };
    const isRestrictedUser = !isAdmin && req.managerAuthSession.allowAccountChange === false;
    const notifyKeys = ['userNotifyEnabled', 'notifyOnAfkKick', 'notifyOnAfkRecover', 'notifyOnReconnectExhausted'];
    const restrictedPatchKeys = [
      'alias', 'ecoMode', 'autoTotem', 'antiHungry', 'autoReconnect', 'antiAfkKick',
      'autoChatSchedules', 'botSchedules', 'username', 'serverHost', 'serverPort', 'version'
    ];
    const hasNotifyChanges = notifyKeys.some((k) => patch[k] !== undefined);
    const hasRestrictedChange = (patch.spawnCommands !== undefined && patch.spawnCommands !== '********') ||
      restrictedPatchKeys.some((k) => patch[k] !== undefined);

    if (isRestrictedUser && (!hasNotifyChanges || hasRestrictedChange)) {
      return res.status(403).json({ ok: false, error: 'Gói dịch vụ của bạn không cho phép tự đổi cài đặt bot.' });
    }

    try {
      const worker = perm.worker;

      const settingsPatch = {};
      if (!isRestrictedUser && patch.alias !== undefined) settingsPatch.alias = String(patch.alias).trim().slice(0, 32);
      const allowedBoolKeys = isRestrictedUser
        ? notifyKeys
        : ['ecoMode', 'autoTotem', 'antiHungry', 'autoReconnect', 'antiAfkKick', ...notifyKeys];
      for (const boolKey of allowedBoolKeys) {
        if (patch[boolKey] !== undefined) settingsPatch[boolKey] = Boolean(patch[boolKey]);
      }
      if (!isRestrictedUser && patch.spawnCommands !== undefined && patch.spawnCommands !== '********') {
        settingsPatch.spawnCommands = String(patch.spawnCommands || '').slice(0, 1000);
      }
      if (!isRestrictedUser && Array.isArray(patch.autoChatSchedules)) settingsPatch.autoChatSchedules = patch.autoChatSchedules;
      if (!isRestrictedUser && Array.isArray(patch.botSchedules)) settingsPatch.botSchedules = patch.botSchedules;

      if (patch.proxy !== undefined || patch.proxyUrl !== undefined) {
        if (!isAdmin) {
          return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (ADMIN) mới được thay đổi cấu hình Proxy.' });
        }
        const rawProxy = patch.proxy !== undefined ? patch.proxy : patch.proxyUrl;
        const parsedProxyUrl = resolveProxyInputWithSavedPassword(rawProxy, worker);
        if (parsedProxyUrl) {
          await validateProxyUrl(parsedProxyUrl);
        }
        settingsPatch.proxyUrl = parsedProxyUrl || null;
      }

      if (isAdmin) {
        if (patch.serverHost !== undefined) settingsPatch.serverHost = String(patch.serverHost).trim();
        if (patch.serverPort !== undefined) settingsPatch.serverPort = Number(patch.serverPort);
        if (patch.version !== undefined) settingsPatch.version = String(patch.version).trim();
      }
      if (!isRestrictedUser && patch.username !== undefined) settingsPatch.username = String(patch.username).trim();

      const savedSettings = await registry.updateSettings(worker.workerId, settingsPatch);
      const updatedWorker = await registry.find(worker.workerId);

      await store.addAudit({
        action: 'BOT_SETTINGS_UPDATED',
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        actorRole: req.managerAuthSession.role,
        actorIp: req.ip || '127.0.0.1',
        details: {
          ecoMode: savedSettings.ecoMode,
          autoTotem: savedSettings.autoTotem,
          antiHungry: savedSettings.antiHungry,
          autoReconnect: savedSettings.autoReconnect,
          antiAfkKick: savedSettings.antiAfkKick
        }
      });

      const responseSettings = savedSettings && typeof savedSettings === 'object' ? { ...savedSettings } : {};
      if (!isAdmin) {
        delete responseSettings.serviceUrl;
        delete responseSettings.proxyUrl;
        delete responseSettings.proxyCiphertext;
        delete responseSettings.mcCredentialsCiphertext;
      }
      if (isRestrictedUser && responseSettings.spawnCommands) {
        responseSettings.spawnCommands = '********';
      }

      return res.json({
        ok: true,
        message: 'Đã cập nhật cài đặt bot thành công.',
        settings: responseSettings,
        bot: buildBotPayload(updatedWorker || worker, req.managerAuthSession)
      });
    } catch (error) {
      const status = /Proxy|không hợp lệ|array/i.test(error.message) ? 400 : 500;
      return res.status(status).json({ ok: false, error: error.message });
    }
  });

  // 15. UPDATE BOT ALIAS & TAGS
  router.post('/bot/:id/alias', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const alias = String(req.body?.alias || '').trim().slice(0, 32);
    try {
      await registry.updateAlias(perm.worker.workerId, alias);
      return res.json({ ok: true, alias, message: 'Đã đổi biệt danh bot thành công.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post('/bot/:id/tags', requireSession, async (req, res) => {
    if (req.managerAuthSession?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (ADMIN) mới được chỉnh sửa nhãn bot.' });
    }
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const tags = Array.isArray(req.body?.tags) ? req.body.tags.map((t) => String(t).trim().slice(0, 20)).slice(0, 5) : [];
    try {
      await registry.updateTags(perm.worker.workerId, tags);
      return res.json({ ok: true, tags, message: 'Đã cập nhật nhãn bot.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 16. EXECUTE LIFECYCLE ACTION ON BOT (start, stop, restart, reconnect, respawn, look, toss, reset)
  router.post('/bot/:id/:action', requireSession, async (req, res, next) => {
    const { id, action } = req.params;
    if (['send', 'settings', 'alias', 'tags', 'proxy', 'account', 'window', 'inventory', 'logs', 'chat-logs', 'auto-chat', 'autoChat', 'bot-schedules', 'botSchedules', 'reset-customer'].includes(action)) {
      return next();
    }
    const perm = await checkBotPermissionAsync(req, id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error });

    const allowedActions = ['start', 'stop', 'restart', 'reconnect', 'respawn', 'inventory', 'look', 'toss', 'status', 'reset'];
    if (!allowedActions.includes(action)) {
      return res.status(400).json({ ok: false, error: `Hành động "${action}" không được hỗ trợ.` });
    }
    if (action === 'reset' && req.managerAuthSession.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (ADMIN) mới được phép đặt lại (reset) bot.' });
    }

    try {
      const worker = perm.worker;
      const resolvedAction = action === 'reconnect' ? 'restart' : action;

      // API-07: Defer manuallyStopped flag mutation until worker execution is confirmed
      const result = await broker.dispatch(worker.workerId, resolvedAction, req.body || {});

      // API-08: Check timeout and unconfirmed delivery first
      if (!result || result.timedOut || result.delivered === false) {
        logger?.warn?.('Bot action timed out or undelivered', { botId: worker.workerId, action });
        return res.status(504).json({
          ok: false,
          error: `Thực thi lệnh ${action} quá thời gian chờ (Gateway Timeout).`,
          timedOut: true
        });
      }

      if (result?.result && typeof result.result === 'object' && result.result.ok === false) {
        const code = result.result.code || result.result.error || null;
        const reason = result.result.detail || result.result.message || result.result.error || 'UNKNOWN_ERROR';
        logger?.error?.('Bot action state sync or execution failed', {
          botId: worker.workerId,
          action,
          error: code,
          detail: result.result.detail || null
        });
        return res.status(commandErrorStatus({ code, status: result.result.status })).json({
          ok: false,
          error: `Thực thi lệnh ${action} không hoàn tất: ${reason}`,
          code,
          result: result.result
        });
      }

      // API-07: Worker confirmed execution -> now safely update manuallyStopped flag
      if (action === 'stop') {
        const currentWorker = await registry.find(worker.workerId);
        const currentStatus = currentWorker?.status || worker.status || {};
        await registry.updateStatus(worker.workerId, { ...currentStatus, manuallyStopped: true }, 'user-stop');
      } else if (action === 'start' || action === 'restart' || action === 'reconnect') {
        const currentWorker = await registry.find(worker.workerId);
        const currentStatus = currentWorker?.status || worker.status || {};
        await registry.updateStatus(worker.workerId, { ...currentStatus, manuallyStopped: false }, 'user-start');
      }

      await store.addAudit({
        action: `BOT_${action.toUpperCase()}`,
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        details: { result: result?.result || 'confirmed' }
      });

      return res.json({
        ok: true,
        message: `Đã gửi lệnh ${action} tới Bot #${worker.botNumber || worker.workerId}.`,
        result: result?.result || null
      });
    } catch (error) {
      logger.error('Bot action failed', { botId: id, action, error: error.message, code: error.code || null });
      return res.status(commandErrorStatus(error)).json({
        ok: false,
        error: 'Không thể thực thi lệnh: ' + error.message,
        code: error.code || null
      });
    }
  });

  // 17. GIFTCODE / RENTAL RENEWAL
  const handleKeyRedemption = async (req, res) => {
    const session = req.managerAuthSession;
    if (!session) return res.status(401).json({ ok: false, error: 'Chưa đăng nhập.' });

    const rawKey = req.body?.key || req.body?.code;
    const key = String(rawKey || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: 'Vui lòng nhập mã Giftcode / Khóa kích hoạt.' });

    try {
      const result = await entitlementService.redeem(session.userId, key, session.role);

      // Refresh session assigned bots and expiry in memory
      session.assignedBotIds = (Array.isArray(result.workerIds) ? result.workerIds : []).map((id) => String(id).trim()).filter(Boolean);
      session.isPermanent = result.isPermanent;
      session.status = 'active';
      session.inGracePeriod = false;
      session.expiresAtRental = result.expiresAt;
      if (result.allowAccountChange !== undefined) {
        session.allowAccountChange = result.allowAccountChange !== false;
      }
      session._authVerifiedAt = 0;
      store?.invalidateUserCache?.(session.userId, session.username);

      await store.addAudit({
        action: 'KEY_REDEEMED',
        targetId: session.userId,
        actorId: session.username,
        details: { keySuffix: key.slice(-4), isPermanent: result.isPermanent, expiresAt: result.expiresAt }
      });

      return res.json({
        ok: true,
        message: 'Kích hoạt / Gia hạn Giftcode thành công!',
        isPermanent: result.isPermanent,
        expiresAt: result.expiresAt,
        assignedBotIds: session.assignedBotIds
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  };

  router.post('/renew', requireSession, handleKeyRedemption);
  router.post('/rental/redeem-key', requireSession, handleKeyRedemption);

  // 18. LINK4M REWARDS
  router.get(['/rewards/link4m/status', '/status'], requireSession, async (req, res) => {
    try {
      const status = await link4mService.getDailyQuotaStatus(req.managerAuthSession.userId);
      return res.json({ ok: true, ...status });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post(['/rewards/link4m/start', '/start'], requireSession, async (req, res) => {
    try {
      const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
      const result = await link4mService.createLinkAttempt(req.managerAuthSession.userId, clientIp);
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.get(['/rewards/link4m/return', '/return'], async (req, res) => {
    try {
      const { token, attempt } = req.query;
      const rawToken = String(token || '');
      const rawAttempt = String(attempt || '');
      const encodedToken = encodeURIComponent(rawToken);
      const encodedAttempt = encodeURIComponent(rawAttempt);
      const safeDataJson = JSON.stringify({ token: rawToken, attemptId: rawAttempt })
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>KingMC - Đang xác nhận phần thưởng...</title>
          <!-- metadata: token: '${encodedToken}', attempt: '${encodedAttempt}' -->
        </head>
        <body style="font-family:sans-serif;text-align:center;padding:50px;background:#0d1117;color:#fff;">
          <h2>Đang xác thực vượt link hoàn tất...</h2>
          <p>Hệ thống đang cộng giờ sử dụng bot cho tài khoản của bạn. Vui lòng chờ...</p>
          <script id="link4m-init" type="application/json">${safeDataJson}</script>
          <script>
            (function() {
              const payload = JSON.parse(document.getElementById('link4m-init').textContent || '{}');
              fetch('/api/rewards/link4m/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              }).then(r => r.json()).then(data => {
                if (data.ok) {
                  alert('Chúc mừng! Bạn đã nhận thêm ' + (data.addedHours || data.rewardHours || 12) + ' giờ sử dụng Bot thành công.');
                  window.location.href = '/';
                } else {
                  alert('Xác thực thất bại: ' + (data.error || 'Token không hợp lệ.'));
                  window.location.href = '/';
                }
              }).catch(() => {
                window.location.href = '/';
              });
            })();
          </script>
        </body>
        </html>
      `);
    } catch (error) {
      return res.status(500).send('Lỗi xử lý xác nhận: ' + error.message);
    }
  });

  router.post(['/rewards/link4m/verify', '/verify'], async (req, res) => {
    try {
      const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
      if (!checkVerifyRateLimit(clientIp)) {
        return res.status(429).json({ ok: false, error: 'Thao tác quá nhanh. Vui lòng thử lại sau 1 phút.' });
      }
      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : null;
      const attemptId = typeof (req.body?.attemptId || req.body?.attempt) === 'string'
        ? String(req.body.attemptId || req.body.attempt).trim()
        : null;

      if (!token && !attemptId) {
        return res.status(400).json({ ok: false, error: 'Thiếu token hoặc mã phiên xác nhận.' });
      }

      // Allow authenticated status polling by attemptId when waiting on background Link4M postback
      if (!token && attemptId) {
        const session = req.managerAuthSession;
        if (!session) {
          return res.status(401).json({ ok: false, error: 'Vui lòng đăng nhập để kiểm tra trạng thái phiên vượt link.' });
        }
        const attempt = typeof store.getLinkAttempt === 'function' ? await store.getLinkAttempt(attemptId) : null;
        if (!attempt) {
          return res.status(404).json({ ok: false, error: 'Phiên vượt link không tồn tại hoặc đã hết hạn.' });
        }
        const isOwner = session.role === 'admin' ||
          String(attempt.userId || '').toLowerCase() === String(session.userId || '').toLowerCase() ||
          String(attempt.username || '').toLowerCase() === String(session.username || '').toLowerCase();
        if (!isOwner) {
          return res.status(403).json({ ok: false, error: 'Không có quyền kiểm tra phiên vượt link này.' });
        }
        const isRewarded = attempt.status === 'rewarded' || attempt.status === 'completed';
        return res.json({ ok: true, isRewarded, status: attempt.status, rewardHours: attempt.rewardHours || 12 });
      }

      const result = await link4mService.verifyAndClaimReward(token, attemptId);
      if (req.managerAuthSession?.userId && typeof invalidateUserSessions === 'function') {
        req.managerAuthSession._authVerifiedAt = 0;
      }
      return res.json({ ...result, isRewarded: result?.isRewarded !== undefined ? Boolean(result.isRewarded) : !result?.processing });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 18b. DISCORD LINKING STATUS, DM NOTIFICATION TOGGLE & UNLINK
  async function readUserDiscordNotifyEnabled(user) {
    if (!store || typeof store.getSetting !== 'function') return true;
    const primaryKey = String(user.userId || user.username || '').trim();
    const fallbackKey = String(user.username || '').trim().toLowerCase();
    let pref = primaryKey ? await store.getSetting(`user_discord_notify:${primaryKey}`).catch(() => null) : null;
    if (pref === null && fallbackKey && fallbackKey !== primaryKey.toLowerCase()) {
      pref = await store.getSetting(`user_discord_notify:${fallbackKey}`).catch(() => null);
    }
    if (pref === null && user.role === 'admin') {
      pref = await store.getSetting('user_discord_notify:admin').catch(() => null);
    }
    if (pref === false || (pref && typeof pref === 'object' && pref.enabled === false)) {
      return false;
    }
    return true;
  }

  router.get(['/user/discord-link', '/discord-link'], requireSession, async (req, res) => {
    try {
      const user = req.managerAuthSession;
      let link = await store.getDiscordLink(user.userId || user.username);
      if (!link && user.username && user.username !== user.userId) {
        link = await store.getDiscordLink(user.username);
      }
      const discordNotifyEnabled = await readUserDiscordNotifyEnabled(user);
      if (!link || String(link.status || 'active').toLowerCase() === 'revoked') {
        return res.json({ ok: true, linked: false, discordNotifyEnabled });
      }
      return res.json({
        ok: true,
        linked: true,
        discordUserId: link.discord_user_id || link.discordUserId,
        username: link.username || user.username,
        linkedAt: link.linked_at || link.linkedAt || null,
        discordNotifyEnabled
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post(['/user/discord-notify', '/discord-notify'], requireSession, async (req, res) => {
    try {
      const user = req.managerAuthSession;
      const rawEnabled = req.body?.enabled;
      if (typeof rawEnabled !== 'boolean') {
        return res.status(400).json({ ok: false, error: 'Tham số enabled phải là true hoặc false.' });
      }
      const enabled = rawEnabled;
      const userKey = String(user.userId || user.username || '').trim();
      const record = {
        enabled,
        userId: userKey,
        username: user.username || userKey,
        role: user.role || 'user',
        updatedAt: new Date().toISOString()
      };
      if (store && typeof store.setSetting === 'function') {
        if (userKey) {
          await store.setSetting(`user_discord_notify:${userKey}`, record);
        }
        const unameKey = String(user.username || '').trim().toLowerCase();
        if (unameKey && unameKey !== userKey.toLowerCase()) {
          await store.setSetting(`user_discord_notify:${unameKey}`, record);
        }
        if (user.role === 'admin') {
          await store.setSetting('user_discord_notify:admin', record);
        }
      }
      if (store && typeof store.addAudit === 'function') {
        await store.addAudit({
          action: 'USER_DISCORD_NOTIFY_TOGGLED',
          targetId: userKey,
          actorId: user.username || userKey,
          actorRole: user.role || 'user',
          actorIp: req.ip || '127.0.0.1',
          details: { enabled }
        }).catch(() => null);
      }
      return res.json({
        ok: true,
        discordNotifyEnabled: enabled,
        message: enabled
          ? 'Đã BẬT nhận tin nhắn thông báo riêng qua Discord (DM).'
          : 'Đã TẮT nhận tin nhắn thông báo riêng qua Discord (DM).'
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.post(['/user/discord-unlink', '/discord-unlink'], requireSession, async (req, res) => {
    try {
      const user = req.managerAuthSession;
      const primaryId = String(user.userId || user.username || '').trim();
      const ownUserIdLower = primaryId.toLowerCase();
      const ownUsernameLower = String(user.username || '').trim().toLowerCase();
      // Guard against username resembling another user's Discord snowflake ID
      if (!/^\d{17,20}$/.test(primaryId)) {
        await store.unlinkDiscord(primaryId);
      }
      if (ownUsernameLower && ownUsernameLower !== ownUserIdLower && !/^\d{17,20}$/.test(ownUsernameLower)) {
        const remainingLink = typeof store.getDiscordLink === 'function'
          ? await store.getDiscordLink(user.username).catch(() => null)
          : null;
        if (remainingLink) {
          const linkOwnerId = String(remainingLink.manager_user_id || remainingLink.managerUserId || '').trim().toLowerCase();
          const linkUsername = String(remainingLink.username || '').trim().toLowerCase();
          if (linkOwnerId === ownUserIdLower || linkUsername === ownUsernameLower) {
            await store.unlinkDiscord(user.username);
          }
        }
      }
      return res.json({ ok: true, message: 'Đã hủy liên kết tài khoản Discord thành công.' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  async function buildPublicSystemInfo() {
    const [bots, persistedSys] = await Promise.all([
      registry.list(),
      typeof store?.getSetting === 'function' ? store.getSetting('system_settings').catch(() => null) : null
    ]);
    const onlineCount = bots.filter((b) => b.status?.state === 'online').length;
    const trialGiftEnabled = persistedSys?.trialGiftEnabled !== undefined
      ? Boolean(persistedSys.trialGiftEnabled)
      : Boolean(config?.trialGiftEnabled ?? false);
    const trialDays = Number(persistedSys?.trialDays || config?.trialDays || 1);

    return {
      ok: true,
      service: 'KingMC AFK Bot Cloud 24/7',
      version: '12.1-Modular-Enterprise',
      uptime: Math.floor(process.uptime()),
      totalBots: bots.length,
      onlineBots: onlineCount,
      trialGiftEnabled,
      trialDays,
      time: new Date().toISOString()
    };
  }

  // 19. PUBLIC SYSTEM INFO & COMBINED BOOTSTRAP (BW-01, SEC-05)
  router.get(['/public/system-info', '/system-info'], async (_req, res) => {
    try {
      return res.json(await buildPublicSystemInfo());
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  router.get(['/public/bootstrap', '/bootstrap'], async (_req, res) => {
    try {
      const now = Date.now();
      if (publicBootstrapCache && (now - publicBootstrapCache.at < 10000)) {
        return res.json(publicBootstrapCache.payload);
      }
      const sysInfo = await buildPublicSystemInfo();
      const payload = {
        ok: true,
        systemInfo: sysInfo,
        loginConfig: {
          ok: true,
          trialGiftEnabled: sysInfo.trialGiftEnabled,
          trialDays: sysInfo.trialDays
        },
        health: {
          ok: true,
          status: 'healthy',
          uptime: sysInfo.uptime
        }
      };
      publicBootstrapCache = { at: now, payload };
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

module.exports = { createUserApi };
