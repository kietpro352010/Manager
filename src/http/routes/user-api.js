'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const express = require('express');
const { validateProxyUrl, resolveAndValidateHost } = require('../../services/proxy-validation');
const { resolveClientIp } = require('../../services/captcha');
const { resolveRequestOrigin, DEFAULT_PUBLIC_MANAGER_URL } = require('../../config/host-runtime');
const { decryptSecret } = require('../../utils/secrets');
const {
  getMaintenanceState,
  sanitizeMaintenanceForSession,
  computeEffectiveExpiresAt
} = require('../../utils/maintenance');

const MAX_SSE_CLIENTS = 60;
const MAX_SSE_PER_ACTOR = 3;
const SSE_HEARTBEAT_MS = 25000;
const SSE_PULSE_THROTTLE_MS = 400;
const activeSseHubs = new Set();

function broadcastSystemSseEvent(eventName, payload) {
  let delivered = 0;
  for (const hub of activeSseHubs) {
    delivered += hub.broadcastSystemSseEvent(eventName, payload);
  }
  return delivered;
}

function closeAllSseClients() {
  let closed = 0;
  for (const hub of activeSseHubs) {
    closed += hub.closeAllSseClients();
  }
  return closed;
}

function getSseClientCount() {
  let total = 0;
  for (const hub of activeSseHubs) {
    total += hub.getSseClientCount();
  }
  return total;
}

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
    if (/[/?#@]/.test(host) || (host.includes(':') && net.isIPv6(host) === 0)) {
      throw new Error('Địa chỉ host Proxy không được chứa các ký tự đặc biệt (/ ? # @ :).');
    }
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

async function probeProxyTcpLatency(proxyUrl, timeoutMs = 3500) {
  let parsed;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    return { ok: false, latencyMs: null, error: 'URL Proxy không hợp lệ.' };
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const port = Number(parsed.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, latencyMs: null, error: 'Host hoặc port Proxy không hợp lệ.' };
  }

  let verified;
  try {
    verified = await resolveAndValidateHost(host, { allowLocal: false });
  } catch (ssrfErr) {
    return { ok: false, latencyMs: null, error: ssrfErr?.message || 'Địa chỉ Proxy bị chặn (SSRF).' };
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const socket = net.createConnection({ host: verified.ip, port });

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
    'provider', 'platform', 'renderServiceId', 'serviceId'
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
      if (verifyRateLimiter.size > 1000) {
        for (const [k, v] of verifyRateLimiter.entries()) {
          if (now > v.resetAt) verifyRateLimiter.delete(k);
        }
        if (verifyRateLimiter.size > 1000) {
          const oldestKey = verifyRateLimiter.keys().next().value;
          if (oldestKey) verifyRateLimiter.delete(oldestKey);
        }
      }
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
      INVALID_WORKER_URL: 422,
      WORKER_AUTH_FAILED: 502,
      WORKER_UPSTREAM_ERROR: 502,
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

  const DISCONNECTED_BOT_STATES = new Set([
    'stopped', 'offline', 'registered', 'disconnected', 'error', 'kicked', 'maintenance', 'ip_limited', 'banned'
  ]);

  function buildEmptyInventoryPayload(revision = 0) {
    return {
      slots: {},
      armor: { head: null, torso: null, legs: null, feet: null },
      offhand: null,
      health: null,
      food: null,
      totemCount: 0,
      goldenAppleCount: 0,
      foodCount: 0,
      selectedHotbar: 0,
      revision: Number.isInteger(revision) && revision >= 0 ? revision : 0,
      items: []
    };
  }

  function isWorkerDisconnectedForInventory(worker) {
    if (!worker || typeof worker !== 'object') return true;
    const status = worker.status || {};
    const state = String(status.state || worker.state || 'offline').trim().toLowerCase();
    return Boolean(status.manuallyStopped && !status.online) || DISCONNECTED_BOT_STATES.has(state);
  }

  function isWorkerOnlineInGame(worker) {
    if (!worker || typeof worker !== 'object') return false;
    if (isWorkerDisconnectedForInventory(worker)) return false;
    const status = worker.status || {};
    if (status.online === true) return true;
    const state = String(status.state || worker.state || '').trim().toLowerCase();
    return state === 'online' || state === 'afk' || state === 'afk_locked';
  }

  function humanizeWorkerErrorVi(failure, { isAdmin = false, worker = null, actionLabel = 'thao tác' } = {}) {
    const code = String(failure?.code || failure?.error || '').trim().toUpperCase();
    const rawMsg = String(failure?.detail || failure?.message || failure?.error || '').trim();
    const lower = rawMsg.toLowerCase();
    const botNum = worker?.botNumber || worker?.workerId || '';
    const botLabel = botNum ? `Bot #${botNum}` : 'Bot';
    const provider = String(worker?.provider || 'wispbyte').toLowerCase();

    if (code === 'WORKER_UNAVAILABLE' || lower.includes('has not checked in recently')) {
      if (!isAdmin) {
        return 'Bot đang tạm ngoại tuyến, vui lòng thử lại sau ít phút.';
      }
      if (provider === 'render' && String(worker?.serviceUrl || '').trim()) {
        return `Máy chủ Cloud (Render) của ${botLabel} đang ngủ đông hoặc khởi động lại. Vui lòng đợi khoảng 30 giây rồi thử lại.`;
      }
      return `${botLabel} hiện chưa kết nối với Manager — container trên Wispbyte đang tắt (Stopped) hoặc vừa tự dừng do chạm giới hạn CPU/RAM. Hãy bật lại container trên Wispbyte rồi thử lại.`;
    }
    if (code === 'CREDENTIALS_MISSING' || lower.includes('credentials are not configured') || lower.includes('credentials_missing')) {
      return 'Bot chưa được cài đặt tài khoản Minecraft. Vui lòng nhập Tên nhân vật trong phần Chi tiết Bot trước khi chạy.';
    }
    if (code === 'LIFECYCLE_CONFLICT' || lower.includes('already in progress')) {
      return 'Bot đang xử lý một lệnh bật/tắt khác, vui lòng đợi vài giây rồi thử lại.';
    }
    if (code === 'WORKER_RESTRICTED' || lower.includes('worker_restricted')) {
      return 'Bot đang tạm khóa kết nối do máy chủ Minecraft giới hạn IP hoặc khóa tài khoản.';
    }
    if (code === 'INVALID_PROXY' || lower.includes('invalid_proxy')) {
      return 'Cấu hình Proxy SOCKS5 của bot không hợp lệ, vui lòng kiểm tra lại.';
    }
    if (code === 'QUEUE_BUSY' || lower.includes('queue is busy')) {
      return 'Bot đang bận xử lý nhiều lệnh liên tiếp, vui lòng thử lại sau ít giây.';
    }
    if (code === 'BOT_NOT_ONLINE' || lower.includes('not connected to minecraft')) {
      return 'Bot hiện chưa vào trong máy chủ Minecraft nên chưa thể thực hiện thao tác này.';
    }
    if (['ETIMEDOUT', 'EXECUTION_TIMEOUT', 'RESULT_TIMEOUT', 'COMMAND_EXPIRED'].includes(code) || lower.includes('timed out')) {
      return 'Bot phản hồi quá thời gian chờ. Hãy kiểm tra container có đang quá tải hoặc khởi động lại không.';
    }
    if (!isAdmin) {
      return `Chưa thể ${String(actionLabel || 'thực hiện lệnh').toLowerCase()} lúc này, vui lòng thử lại sau.`;
    }
    return rawMsg || 'Không thể thực thi lệnh.';
  }

  function commandErrorResponse(res, error, opts = {}) {
    return res.status(commandErrorStatus(error)).json({
      ok: false,
      error: humanizeWorkerErrorVi(error, opts),
      code: error?.code || null
    });
  }

  // Helper: Evaluate command broker dispatch result for consistent HTTP status mapping
  function evaluateCommandDispatch(dispatchResult, defaultErrorMessage = 'Thao tác không hoàn tất', opts = {}) {
    if (!dispatchResult || dispatchResult.timedOut || dispatchResult.delivered === false) {
      return {
        success: false,
        status: 504,
        payload: {
          ok: false,
          error: 'Bot phản hồi quá thời gian chờ. Hãy kiểm tra container có đang quá tải hoặc khởi động lại không.',
          timedOut: true
        }
      };
    }

    const innerResult = dispatchResult.result;
    if (innerResult && typeof innerResult === 'object' && innerResult.ok === false) {
      const code = innerResult.code || innerResult.error || null;
      const humanized = humanizeWorkerErrorVi(innerResult, { ...opts, isAdmin: opts.isAdmin ?? true });
      return {
        success: false,
        status: commandErrorStatus({ code, status: innerResult.status }),
        payload: {
          ok: false,
          error: humanized || defaultErrorMessage,
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

  // Memoize non-secret Minecraft username by ciphertext to avoid N AES-256-GCM decryptions per /bots poll
  const decryptedUsernameCache = new Map();
  const MAX_DECRYPTED_USERNAME_CACHE = 512;

  // Helper: Extract decrypted Minecraft username from worker credentials if configured
  function getBotUsername(worker) {
    if (!worker) return '';
    const ciphertext = worker.settings?.mcCredentialsCiphertext;
    if (ciphertext && registry.encryptionKey) {
      const cacheKey = `${String(registry.encryptionKey).slice(0, 8)}:${ciphertext}`;
      const cached = decryptedUsernameCache.get(cacheKey);
      if (cached !== undefined) return cached;
      const creds = safeDecryptJson(ciphertext, registry.encryptionKey);
      if (creds && creds.username) {
        const uname = String(creds.username);
        if (decryptedUsernameCache.size >= MAX_DECRYPTED_USERNAME_CACHE) {
          const oldest = decryptedUsernameCache.keys().next().value;
          if (oldest !== undefined) decryptedUsernameCache.delete(oldest);
        }
        decryptedUsernameCache.set(cacheKey, uname);
        return uname;
      }
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
    let conflictOwner = null;
    const botNum = Number(worker.botNumber);
    const workerIdLower = String(worker.workerId || '').trim().toLowerCase();
    const matchedLiteralId = workerIdLower && assigned.some((id) => String(id || '').trim().toLowerCase() === workerIdLower);
    if (!matchedLiteralId && Number.isInteger(botNum) && botNum > 0) {
      const literalOwner = await registry.find(String(botNum));
      if (literalOwner) conflictOwner = [literalOwner];
    }
    if (!isWorkerAssignedToSession(worker, assigned, conflictOwner)) {
      return { allowed: false, status: 403, error: 'Bạn không có quyền quản lý bot này.' };
    }

    const method = String(req.method || 'GET').toUpperCase();
    const routePath = String(req.path || '').split('?')[0].toLowerCase();
    const isReadRequest = method === 'GET' || method === 'HEAD';
    const isRenewRequest = routePath === '/renew' ||
      routePath === '/redeem' ||
      routePath === '/manager/renew' ||
      routePath === '/keys/redeem';

    const maintenance = await getMaintenanceState(store);
    if (maintenance.enabled && !isReadRequest && !isRenewRequest) {
      return {
        allowed: false,
        status: 503,
        code: 'SYSTEM_MAINTENANCE',
        error: `Hệ thống đang bảo trì: ${maintenance.message}`
      };
    }

    const isExpired = session.status === 'expired' ||
      session.status === 'grace_period' ||
      session.inGracePeriod === true ||
      (!session.isPermanent && session.expiresAtRental && Date.now() > Date.parse(session.expiresAtRental));

    if (isExpired) {
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
    const isDisconnectedInv = isWorkerDisconnectedForInventory(worker);
    const isOnline = isWorkerOnlineInGame(worker);
    const isReachable = Boolean(worker.reachable || isOnline);
    const botNum = Number(worker.botNumber || worker.workerId || 1);
    let summaryData = summary?.data || null;
    if (summaryData && typeof summaryData === 'object') {
      if (compact || isDisconnectedInv) {
        summaryData = { ...summaryData };
        delete summaryData.inventory;
        delete summaryData.currentWindow;
        if (isDisconnectedInv) {
          summaryData.totemCount = 0;
          summaryData.goldenAppleCount = 0;
        }
      }
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
      health: isDisconnectedInv ? null : (worker.status?.health ?? 20),
      food: isDisconnectedInv ? null : (worker.status?.food ?? 20),
      totemCount: isDisconnectedInv ? 0 : (worker.status?.totemCount ?? 0),
      goldenAppleCount: isDisconnectedInv ? 0 : (worker.status?.goldenAppleCount ?? 0),
      inventory: compact ? [] : (isDisconnectedInv ? buildEmptyInventoryPayload(worker.status?.inventory?.revision || 0) : (worker.status?.inventory || [])),
      pos: worker.status?.position || { x: 0, y: 0, z: 0 },
      position: worker.status?.position || { x: 0, y: 0, z: 0 },
      ping: isDisconnectedInv ? null : (worker.status?.pingMs ?? worker.status?.ping ?? 0),
      tps: isDisconnectedInv ? null : (typeof worker.status?.tps === 'number' ? worker.status.tps : null),
      serverTps: isDisconnectedInv ? null : (typeof worker.status?.tps === 'number' ? worker.status.tps : null),
      uptime: isDisconnectedInv ? 0 : (worker.status?.uptimeSeconds ?? worker.status?.uptime ?? 0),
      uptimeSeconds: isDisconnectedInv ? 0 : (worker.status?.uptimeSeconds ?? worker.status?.uptime ?? 0),
      connectedAt: isDisconnectedInv
        ? null
        : (worker.status?.connectedAt || (isOnline && Number(worker.status?.uptimeSeconds) > 0
          ? new Date(Date.now() - Number(worker.status.uptimeSeconds) * 1000).toISOString()
          : null)),
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
      renderServiceId: worker.renderServiceId || '',
      proxy: worker.proxy || null,
      currentWindow: (compact || isDisconnectedInv) ? null : (worker.status?.currentWindow || null),
      history: {
        ping: worker.status?.pingHistory || [],
        ram: worker.status?.ramHistory || []
      },
      hostHardware: (() => {
        const effectiveProvider = String(worker.provider || worker.platform || 'wispbyte').toLowerCase();
        const ramTotalMb = effectiveProvider === 'wispbyte' ? 400 : 512;
        const ramUsedMb = worker.status?.rssMb || 0;
        const rawRxKb = isDisconnectedInv
          ? 0
          : (worker.status?.netDownKb !== undefined
            ? Number(worker.status.netDownKb)
            : ((Number(worker.status?.bandwidthRxBps) || 0) / 1024));
        const rawTxKb = isDisconnectedInv
          ? 0
          : (worker.status?.netUpKb !== undefined
            ? Number(worker.status.netUpKb)
            : ((Number(worker.status?.bandwidthTxBps) || 0) / 1024));
        const netDownKb = Number.isFinite(rawRxKb) && rawRxKb > 0 ? Math.round(rawRxKb * 10) / 10 : 0;
        const netUpKb = Number.isFinite(rawTxKb) && rawTxKb > 0 ? Math.round(rawTxKb * 10) / 10 : 0;
        return {
          ramUsedMb,
          ramTotalMb,
          ramPercent: ramUsedMb ? Math.round((ramUsedMb / ramTotalMb) * 100) : 0,
          cpuPercent: isDisconnectedInv ? 0 : (worker.status?.cpuPercent || 0),
          cpuCores: 1,
          botRssMb: ramUsedMb,
          botHeapMb: worker.status?.heapUsedMb || 0,
          netDownKb,
          netUpKb
        };
      })()
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
      const allBots = await registry.list({ omitHeavyFields: true });
      const assignmentMap = session.role === 'admin' ? await getUserAssignmentsMap() : null;
      const selfAssignment = session.role === 'admin' ? null : { username: session.username || null, planName: session.planName || null };
      const assigned = session.role === 'admin'
        ? null
        : (Array.isArray(session.assignedBotIds) ? session.assignedBotIds.map(String) : []);
      if (session.role === 'admin' || !assigned || assigned.length === 0) {
        let globalOrder = [];
        if (session.role === 'admin' && typeof store?.getSetting === 'function') {
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
      }

      let visibleBots = [];
      if (session.role === 'admin') {
        visibleBots = allBots;
      } else {
        visibleBots = allBots.filter((b) => isWorkerAssignedToSession(b, assigned, allBots));
        if (assigned.length > 0) {
          const userOrderMap = new Map(assigned.map((id, idx) => [String(id).toLowerCase(), idx]));
          visibleBots.sort((a, b) => {
            const aId = String(a.workerId || '').toLowerCase();
            const bId = String(b.workerId || '').toLowerCase();
            const aNum = String(a.botNumber || '').toLowerCase();
            const bNum = String(b.botNumber || '').toLowerCase();
            const aPos = userOrderMap.has(aId) ? userOrderMap.get(aId) : (userOrderMap.has(aNum) ? userOrderMap.get(aNum) : Number.MAX_SAFE_INTEGER);
            const bPos = userOrderMap.has(bId) ? userOrderMap.get(bId) : (userOrderMap.has(bNum) ? userOrderMap.get(bNum) : Number.MAX_SAFE_INTEGER);
            return aPos - bPos || Number(a.botNumber || 0) - Number(b.botNumber || 0);
          });
        }
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
      const maintenance = await getMaintenanceState(store);
      const isAdminOrPerm = session.role === 'admin' || Boolean(session.isPermanent);
      const rawUserExpiresAt = isAdminOrPerm
        ? null
        : (session.rawExpiresAtRental !== undefined ? session.rawExpiresAtRental : (session.expiresAtRental || null));
      const effectiveUserExpiresAt = isAdminOrPerm
        ? null
        : computeEffectiveExpiresAt(rawUserExpiresAt, maintenance);
      const currentUserSnapshot = {
        status: session.status || 'active',
        expiresAt: effectiveUserExpiresAt,
        rawExpiresAt: rawUserExpiresAt,
        isPermanent: Boolean(session.isPermanent),
        planName: session.planName || '',
        assignedBotIds: Array.isArray(session.assignedBotIds) ? session.assignedBotIds : [],
        inGracePeriod: Boolean(session.inGracePeriod)
      };
      // Compute stable signature excluding per-second volatile fields without cloning every bot object
      const sigHash = crypto.createHash('sha1');
      sigHash.update(JSON.stringify({
        currentUser: {
          ...currentUserSnapshot,
          expiresAt: maintenance.enabled ? rawUserExpiresAt : currentUserSnapshot.expiresAt
        },
        maintenance: {
          enabled: maintenance.enabled,
          message: maintenance.message,
          startedAt: maintenance.startedAt,
          lastCompensatedAt: maintenance.lastCompensatedAt
        }
      }));
      for (let i = 0; i < payload.length; i += 1) {
        const b = payload[i];
        const widLower = String(b.workerId || b.id || '').toLowerCase();
        const revNum = registry.workerStateRev ? (registry.workerStateRev.get(widLower) || 0) : 0;
        const uptimeMin = Math.floor(Number(b.uptime || 0) / 60);
        const pingBucket = Math.round(Number(b.ping || 0) / 25) * 25;
        sigHash.update(
          `\n${b.id}|${revNum}|${b.label}|${b.username}|${b.available ? 1 : 0}|${b.enabled ? 1 : 0}|` +
          `${b.status}|${b.online ? 1 : 0}|${b.manuallyStopped ? 1 : 0}|${b.lastKickReason || ''}|${b.lastError || ''}|` +
          `${b.server || ''}|${b.dimension || ''}|${b.locationState || ''}|${b.health ?? ''}|${b.food ?? ''}|` +
          `${b.totemCount ?? 0}|${b.goldenAppleCount ?? 0}|${b.pos?.x ?? 0},${b.pos?.y ?? 0},${b.pos?.z ?? 0}|` +
          `${pingBucket}|${b.tps ?? ''}|${uptimeMin}|${b.reconnectAttempts ?? 0}|${b.reconnectCount ?? 0}|` +
          `${b.rentable ? 1 : 0}|${b.assignedUsername || ''}|${b.assignedPlan || ''}|${b.ipAddress || ''}|${b.url || ''}|` +
          `${Array.isArray(b.tags) ? b.tags.join(',') : ''}|${b.hostHardware?.botRssMb ?? ''}|${b.hostHardware?.cpuPercent ?? ''}`
        );
      }
      const sig = sigHash.digest('hex').slice(0, 16);

      const sanitizedMaintenance = sanitizeMaintenanceForSession(maintenance, session);
      if (typeof req.query?.sig === 'string' && req.query.sig === sig) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({
          ok: true,
          unchanged: true,
          sig,
          maintenance: sanitizedMaintenance,
          ...(managerRamMb !== undefined ? { managerRamMb } : {})
        }));
      }

      return res.json({
        ok: true,
        sig,
        bots: payload,
        currentUser: currentUserSnapshot,
        maintenance: sanitizedMaintenance,
        ...(managerRamMb !== undefined ? { managerRamMb } : {})
      });
    } catch (error) {
      logger?.error?.('Failed to get bots', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
    }
  };

  router.get('/bots', requireSession, getBotsHandler);
  router.get('/registry', requireSession, getBotsHandler);

  // 1.5. REALTIME SERVER-SENT EVENTS (SSE) STREAM (/api/manager/stream)
  const sseClients = new Set();
  let sseWorkersCache = { at: 0, list: null, inflight: null };

  async function getCachedWorkersForSse() {
    const now = Date.now();
    if (sseWorkersCache.list && (now - sseWorkersCache.at < 1000)) {
      return sseWorkersCache.list;
    }
    if (sseWorkersCache.inflight) return sseWorkersCache.inflight;
    sseWorkersCache.inflight = Promise.resolve(
      typeof registry?.list === 'function' ? registry.list({ omitHeavyFields: true }) : []
    )
      .then((list) => {
        const arr = Array.isArray(list) ? list : [];
        sseWorkersCache = { at: Date.now(), list: arr, inflight: null };
        return arr;
      })
      .catch(() => {
        sseWorkersCache.inflight = null;
        return sseWorkersCache.list || [];
      });
    return sseWorkersCache.inflight;
  }

  function writeRawSse(res, frame) {
    if (!res || res.writableEnded || res.destroyed) return false;
    try {
      res.write(frame);
      return true;
    } catch (_) {
      return false;
    }
  }

  function cleanupSseClient(client) {
    if (!client || client.closed) return false;
    client.closed = true;
    sseClients.delete(client);
    if (client.heartbeatTimer) {
      clearInterval(client.heartbeatTimer);
      client.heartbeatTimer = null;
    }
    if (client.pulseTimer) {
      clearTimeout(client.pulseTimer);
      client.pulseTimer = null;
    }
    if (typeof client.unsubscribe === 'function') {
      try { client.unsubscribe(); } catch (_) {}
      client.unsubscribe = null;
    }
    try {
      if (client.res && !client.res.writableEnded && !client.res.destroyed) {
        client.res.end();
      }
    } catch (_) {}
    return true;
  }

  function sendClientSseEvent(client, eventName, payload, eventId = null) {
    if (!client || client.closed) return false;
    if (client.session?.status === 'disabled') {
      cleanupSseClient(client);
      return false;
    }
    const safeEvent = String(eventName || 'message').replace(/[\r\n]+/g, '').trim() || 'message';
    const hasEventId = eventId !== null && eventId !== undefined && String(eventId).trim() !== '';
    const idPrefix = hasEventId
      ? `id: ${String(eventId).replace(/[\r\n]+/g, '').trim()}\n`
      : '';
    let serialized = '{}';
    try {
      serialized = JSON.stringify(payload ?? {});
    } catch (_) {}
    const ok = writeRawSse(client.res, `${idPrefix}event: ${safeEvent}\ndata: ${serialized}\n\n`);
    if (!ok) cleanupSseClient(client);
    return ok;
  }

  function routerBroadcastSystemSseEvent(eventName, payload) {
    let delivered = 0;
    for (const client of [...sseClients]) {
      if (sendClientSseEvent(client, eventName, payload)) {
        delivered += 1;
      }
    }
    return delivered;
  }

  function routerCloseAllSseClients() {
    let closed = 0;
    for (const client of [...sseClients]) {
      if (cleanupSseClient(client)) closed += 1;
    }
    return closed;
  }

  function routerCloseUserSseClients(identifier) {
    const raw = String(identifier || '').trim().toLowerCase();
    if (!raw) return 0;
    const bare = raw.startsWith('usr_') ? raw.slice(4) : raw;
    let closed = 0;
    for (const client of [...sseClients]) {
      if (!client || client.session?.role === 'admin') continue;
      const uid = String(client.session?.userId || '').trim().toLowerCase();
      const uname = String(client.session?.username || '').trim().toLowerCase();
      const uidBare = uid.startsWith('usr_') ? uid.slice(4) : uid;
      if (uid === raw || uname === raw || (bare && (uid === `usr_${bare}` || uidBare === bare || uname === bare))) {
        if (cleanupSseClient(client)) closed += 1;
      }
    }
    return closed;
  }

  function routerCloseAdminSseClients(excludeTokenHash = null) {
    let closed = 0;
    for (const client of [...sseClients]) {
      if (!client || client.session?.role !== 'admin') continue;
      if (excludeTokenHash && client.session?.tokenHash === excludeTokenHash) continue;
      if (cleanupSseClient(client)) closed += 1;
    }
    return closed;
  }

  function routerGetSseClientCount() {
    return sseClients.size;
  }

  const hubHandle = {
    broadcastSystemSseEvent: routerBroadcastSystemSseEvent,
    closeAllSseClients: routerCloseAllSseClients,
    getSseClientCount: routerGetSseClientCount
  };
  activeSseHubs.add(hubHandle);

  router.get('/stream', requireSession, async (req, res) => {
    const session = req.managerAuthSession;
    const userKey = String(session?.userId || session?.username || 'anon').trim().toLowerCase();
    const ipKey = String(req.clientIp || resolveClientIp(req) || 'unknown').trim().toLowerCase();
    const rawLastRev = typeof req.headers?.['last-event-id'] === 'string' && req.headers['last-event-id'].trim() !== ''
      ? req.headers['last-event-id'].trim()
      : (typeof req.query?.lastRev === 'string' && req.query.lastRev.trim() !== ''
          ? req.query.lastRev.trim()
          : '');
    const parsedLastRev = rawLastRev !== '' && /^\d+$/.test(rawLastRev) ? Number(rawLastRev) : NaN;
    const lastRev = Number.isSafeInteger(parsedLastRev) && parsedLastRev >= 0 ? parsedLastRev : NaN;

    const maintenance = await getMaintenanceState(store).catch(() => null);
    if (res.writableEnded || res.destroyed) return undefined;

    if (sseClients.size >= MAX_SSE_CLIENTS) {
      return res.status(429).json({
        ok: false,
        error: 'Máy chủ đang đạt giới hạn kết nối trực tiếp (SSE). Hệ thống sẽ tự dùng chế độ đồng bộ định kỳ.'
      });
    }

    let sameUserCount = 0;
    let sameIpCount = 0;
    for (const existing of sseClients) {
      if (existing.closed) continue;
      if (userKey && existing.userKey === userKey) sameUserCount += 1;
      if (ipKey && existing.ipKey === ipKey) sameIpCount += 1;
    }
    if (sameUserCount >= MAX_SSE_PER_ACTOR || sameIpCount >= MAX_SSE_PER_ACTOR) {
      return res.status(429).json({
        ok: false,
        error: 'Đã đạt giới hạn tối đa 3 kết nối trực tiếp (SSE) đồng thời cho tài khoản hoặc địa chỉ IP này.'
      });
    }

    req.socket?.setTimeout?.(0);
    req.socket?.setNoDelay?.(true);
    req.socket?.setKeepAlive?.(true, 30000);
    res.setTimeout?.(0);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const currentRev = typeof registry?.snapshotRevision === 'number' ? registry.snapshotRevision : 0;

    const client = {
      res,
      session,
      userKey,
      ipKey,
      closed: false,
      heartbeatTimer: null,
      pulseTimer: null,
      unsubscribe: null,
      lastPulseSentAt: 0,
      pendingWorkerIds: new Set(),
      hasWildcardPulse: false,
      latestRev: currentRev,
      latestReason: 'state_changed'
    };

    const flushQueuedPulse = () => {
      client.pulseTimer = null;
      if (client.closed) return;
      const workerIds = [...client.pendingWorkerIds];
      const soleWorkerId = (!client.hasWildcardPulse && workerIds.length === 1) ? workerIds[0] : null;
      const reason = client.latestReason || 'state_changed';
      const rev = client.latestRev || 0;
      client.pendingWorkerIds.clear();
      client.hasWildcardPulse = false;
      client.lastPulseSentAt = Date.now();
      sendClientSseEvent(client, 'fleet_pulse', {
        rev,
        workerId: soleWorkerId,
        reason,
        ts: client.lastPulseSentAt
      }, rev);
    };

    const schedulePulseFlush = (pulse) => {
      if (client.closed) return;
      if (Number.isFinite(pulse?.rev)) client.latestRev = pulse.rev;
      if (pulse?.reason) client.latestReason = String(pulse.reason);
      if (pulse?.workerId) {
        client.pendingWorkerIds.add(String(pulse.workerId));
      } else {
        client.hasWildcardPulse = true;
      }
      if (client.pulseTimer) return;
      const elapsed = Date.now() - client.lastPulseSentAt;
      const delay = elapsed >= SSE_PULSE_THROTTLE_MS ? 15 : Math.max(15, SSE_PULSE_THROTTLE_MS - elapsed);
      client.pulseTimer = setTimeout(flushQueuedPulse, delay);
      client.pulseTimer.unref?.();
    };

    if (typeof registry?.onPulse === 'function') {
      client.unsubscribe = registry.onPulse((pulse) => {
        if (client.closed) return;
        if (client.session?.status === 'disabled') {
          cleanupSseClient(client);
          return;
        }
        // Invalidate 1s worker list cache on register/remove so ownership checks see fresh topology
        if (pulse?.reason === 'register' || pulse?.reason === 'remove') {
          sseWorkersCache.at = 0;
          sseWorkersCache.list = null;
        }
        if (client.session?.role === 'admin') {
          schedulePulseFlush(pulse);
          return;
        }
        const assigned = Array.isArray(client.session?.assignedBotIds)
          ? client.session.assignedBotIds.map(String)
          : [];
        if (assigned.length === 0) return;

        void (async () => {
          try {
            const allWorkers = await getCachedWorkersForSse();
            if (client.closed) return;
            if (!pulse?.workerId) {
              const hasAnyOwned = allWorkers.some((w) => isWorkerAssignedToSession(w, assigned, allWorkers));
              if (hasAnyOwned) schedulePulseFlush(pulse);
              return;
            }
            const targetIdLower = String(pulse.workerId).trim().toLowerCase();
            let targetWorker = allWorkers.find((w) => w && String(w.workerId || '').trim().toLowerCase() === targetIdLower) || null;
            if (!targetWorker && pulse.reason !== 'remove' && typeof registry.find === 'function') {
              targetWorker = await registry.find(targetIdLower).catch(() => null);
            }
            if (targetWorker && isWorkerAssignedToSession(targetWorker, assigned, allWorkers)) {
              schedulePulseFlush(pulse);
            }
          } catch (_) {}
        })();
      });
    }

    client.heartbeatTimer = setInterval(() => {
      if (client.closed || res.writableEnded || res.destroyed) {
        cleanupSseClient(client);
        return;
      }
      if (!writeRawSse(res, ': keepalive\n\n')) {
        cleanupSseClient(client);
      }
    }, SSE_HEARTBEAT_MS);
    client.heartbeatTimer.unref?.();

    sseClients.add(client);

    const onClose = () => {
      cleanupSseClient(client);
    };
    req.on('close', onClose);
    res.on('close', onClose);
    res.on('error', onClose);

    const missed = Number.isFinite(lastRev) && lastRev > 0 && lastRev !== currentRev;
    writeRawSse(
      res,
      `id: ${currentRev}\nevent: connected\ndata: ${JSON.stringify({ ok: true, rev: currentRev, missed, maintenance: sanitizeMaintenanceForSession(maintenance, session), ts: Date.now() })}\n\n`
    );
  });

  // 2. REORDER BOTS (Drag and drop in UI)
  router.post('/bots/reorder', requireSession, async (req, res) => {
    const session = req.managerAuthSession;
    if (session?.role !== 'admin') {
      const maintenance = await getMaintenanceState(store);
      if (maintenance.enabled) {
        return res.status(503).json({
          ok: false,
          code: 'SYSTEM_MAINTENANCE',
          error: `Hệ thống đang bảo trì: ${maintenance.message}`
        });
      }
    }
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
      logger?.error?.('Failed to reorder bots', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
    }
  });

  // 3. GET SYSTEM ANNOUNCEMENT
  router.get('/announcement', requireSession, async (_req, res) => {
    const cacheFresh = store?.cachedAnnouncement !== undefined && (
      store?.cachedAnnouncementAt && (Date.now() - Number(store.cachedAnnouncementAt) < 5000)
    );
    let rawAnnouncement = cacheFresh ? store.cachedAnnouncement : undefined;
    if (rawAnnouncement === undefined && typeof store?.getSetting === 'function') {
      try {
        rawAnnouncement = await store.getSetting('system_announcement', { bypassCache: true });
        store.cachedAnnouncement = rawAnnouncement || null;
        store.cachedAnnouncementAt = Date.now();
      } catch (_) {
        rawAnnouncement = store?.cachedAnnouncement ?? null;
      }
    }
    const announcement = normalizeAnnouncementValue(rawAnnouncement);
    return res.json({
      ok: true,
      announcement: announcement && announcement.enabled ? announcement : (announcement || null)
    });
  });

  // 3.5. GET SYSTEM MAINTENANCE STATE
  router.get('/maintenance', requireSession, async (_req, res) => {
    try {
      const maintenance = await getMaintenanceState(store);
      return res.json({ ok: true, maintenance });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 4. GET BOT SNAPSHOT (Complete state for Detail drawer/modal)
  router.get('/bot/:id/snapshot', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

    const worker = perm.worker;
    const session = req.managerAuthSession;
    await registry.refreshLogsFromStore?.(worker.workerId, { kind: 'all', maxAgeMs: 3000 }).catch(() => {});
    const summary = registry.summary(worker.workerId);
    const inventory = isWorkerDisconnectedForInventory(worker)
      ? buildEmptyInventoryPayload(worker.status?.inventory?.revision || 0)
      : (worker.status?.inventory || buildEmptyInventoryPayload(0));

    const rev = typeof registry.getSnapshotRevision === 'function'
      ? registry.getSnapshotRevision(worker, { inventory })
      : String(
          worker.updatedAt
            ? new Date(worker.updatedAt).getTime()
            : `${worker.status?.state || ''}:${inventory.revision || 0}:${(typeof registry.getLogs === 'function' ? registry.getLogs(worker.workerId) : []).length}`
        );

    const maintenance = await getMaintenanceState(store);
    const reqRev = typeof req.query?.rev === 'string' ? req.query.rev : '';
    if (reqRev && reqRev === rev) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok: true, unchanged: true, rev, maintenance }));
    }

    const logs = typeof registry.getLogs === 'function' ? registry.getLogs(worker.workerId) : [];

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
      botSchedules: worker.settings?.botSchedules || [],
      maintenance
    });
  });

  // 5. GET SPECIFIC BOT STATE (Fallback for Detail drawer)
  router.get('/bot/:id/state', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

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
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });
    const worker = perm.worker;
    const inventory = isWorkerDisconnectedForInventory(worker)
      ? buildEmptyInventoryPayload(worker.status?.inventory?.revision || 0)
      : (worker.status?.inventory || buildEmptyInventoryPayload(0));
    return res.json({
      ok: true,
      inventory
    });
  });

  router.get('/bot/:id/settings', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });
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
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });
    return res.json({
      ok: true,
      autoChatSchedules: perm.worker.settings?.autoChatSchedules || []
    });
  });

  router.get(['/bot/:id/botSchedules', '/bot/:id/bot-schedules'], requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });
    return res.json({
      ok: true,
      botSchedules: perm.worker.settings?.botSchedules || []
    });
  });

  router.get('/bot/:id/logs', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });
    await registry.refreshLogsFromStore?.(perm.worker.workerId, { kind: 'event', maxAgeMs: 3000 }).catch(() => {});
    return res.json({
      ok: true,
      logs: typeof registry.getSystemLogs === 'function'
        ? registry.getSystemLogs(perm.worker.workerId)
        : registry.getLogs(perm.worker.workerId, { systemOnly: true })
    });
  });

  router.get('/bot/:id/chat-logs', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });
    await registry.refreshLogsFromStore?.(perm.worker.workerId, { kind: 'chat', maxAgeMs: 3000 }).catch(() => {});
    return res.json({
      ok: true,
      logs: typeof registry.getChatLogs === 'function'
        ? registry.getChatLogs(perm.worker.workerId)
        : registry.getLogs(perm.worker.workerId, { chatOnly: true })
    });
  });

  router.get('/bot/:id/position-logs', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });
    return res.json({ ok: true, logs: [] });
  });

  // 7. GET & SAVE MINECRAFT CREDENTIALS
  router.get('/bot/:id/account', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

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
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

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
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

    const worker = perm.worker;
    const rawMessage = req.body?.text ?? req.body?.message;
    const message = (typeof rawMessage === 'string' || typeof rawMessage === 'number') ? String(rawMessage).trim() : '';
    if (!message) return res.status(400).json({ ok: false, error: 'Nội dung tin nhắn không được để trống.' });
    if (/[\r\n]/.test(message)) {
      return res.status(400).json({ ok: false, error: 'Nội dung tin nhắn không được chứa ký tự xuống dòng.' });
    }
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
      return commandErrorResponse(res, error, {
        isAdmin: req.managerAuthSession?.role === 'admin',
        worker,
        actionLabel: 'gửi tin nhắn'
      });
    }
  });

  // 9. SCHEDULE CONFIGURATION
  router.post(['/bot/:id/auto-chat', '/bot/:id/autoChat'], requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });
    if (req.managerAuthSession?.role !== 'admin' && req.managerAuthSession?.allowAccountChange === false) {
      return res.status(403).json({ ok: false, error: 'Tài khoản của bạn bị hạn chế thay đổi cấu hình lịch Auto Chat của bot.' });
    }

    if (!Array.isArray(req.body?.autoChatSchedules)) {
      return res.status(400).json({ ok: false, error: 'Schedules must be an array.' });
    }
    if (req.body.autoChatSchedules.length > 50) {
      return res.status(400).json({ ok: false, error: 'Số lượng lịch Auto Chat tối đa là 50.' });
    }

    const worker = perm.worker;
    const schedules = req.body.autoChatSchedules;

    try {
      await registry.updateSettings(worker.workerId, { autoChatSchedules: schedules });
      return res.json({ ok: true, message: 'Đã lưu lịch Auto Chat thành công.' });
    } catch (error) {
      logger?.error?.('Failed to update autoChatSchedules', { workerId: worker.workerId, error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
    }
  });

  router.post(['/bot/:id/bot-schedules', '/bot/:id/botSchedules'], requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });
    if (req.managerAuthSession?.role !== 'admin' && req.managerAuthSession?.allowAccountChange === false) {
      return res.status(403).json({ ok: false, error: 'Tài khoản của bạn bị hạn chế thay đổi lịch hoạt động Bot.' });
    }

    if (!Array.isArray(req.body?.botSchedules)) {
      return res.status(400).json({ ok: false, error: 'Schedules must be an array.' });
    }
    if (req.body.botSchedules.length > 50) {
      return res.status(400).json({ ok: false, error: 'Số lượng lịch hoạt động Bot tối đa là 50.' });
    }

    const worker = perm.worker;
    const schedules = req.body.botSchedules;

    try {
      await registry.updateSettings(worker.workerId, { botSchedules: schedules });
      return res.json({ ok: true, message: 'Đã lưu lịch hoạt động Bot thành công.' });
    } catch (error) {
      logger?.error?.('Failed to update botSchedules', { workerId: worker.workerId, error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
    }
  });

  // 10. CLEAR LOGS
  router.post(['/bot/:id/logs/clear', '/bot/:id/chat-logs/clear'], requireSession, async (req, res) => {
    if (req.managerAuthSession?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ quản trị viên mới được xóa lịch sử bot.' });
    }

    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

    const normId = String(perm.worker.workerId || '').trim().toLowerCase();
    const isChatClear = req.path.includes('chat-logs');
    if (typeof registry.clearLogs === 'function') {
      await registry.clearLogs(normId, isChatClear ? 'chat' : 'event');
    } else if (isChatClear) {
      if (registry.botChatLogsCache) registry.botChatLogsCache.set(normId, []);
      if (registry.botChatLogRev) registry.botChatLogRev.set(normId, (registry.botChatLogRev.get(normId) || 0) + 1);
      registry.bumpRevision?.(normId);
    } else {
      if (registry.botLogsCache) registry.botLogsCache.set(normId, []);
      if (registry.botLogRev) registry.botLogRev.set(normId, (registry.botLogRev.get(normId) || 0) + 1);
      registry.bumpRevision?.(normId);
    }
    return res.json({ ok: true, message: isChatClear ? 'Đã xóa nhật ký chat.' : 'Đã xóa nhật ký sự kiện.' });
  });

  // 11. REMOTE WINDOW GUI ACTIONS
  router.post('/bot/:id/window/click', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

    try {
      const dispatchResult = await broker.dispatch(perm.worker.workerId, 'window_click', req.body || {});
      const evaluated = evaluateCommandDispatch(dispatchResult, 'Thao tác click giao diện không thành công', {
        isAdmin: req.managerAuthSession?.role === 'admin',
        worker: perm.worker,
        actionLabel: 'click giao diện'
      });
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
      return commandErrorResponse(res, error, {
        isAdmin: req.managerAuthSession?.role === 'admin',
        worker: perm.worker,
        actionLabel: 'click giao diện'
      });
    }
  });

  router.post('/bot/:id/window/close', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

    try {
      const dispatchResult = await broker.dispatch(perm.worker.workerId, 'window_close', req.body || {});
      const evaluated = evaluateCommandDispatch(dispatchResult, 'Thao tác đóng giao diện không thành công', {
        isAdmin: req.managerAuthSession?.role === 'admin',
        worker: perm.worker,
        actionLabel: 'đóng giao diện'
      });
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
      return commandErrorResponse(res, error, {
        isAdmin: req.managerAuthSession?.role === 'admin',
        worker: perm.worker,
        actionLabel: 'đóng giao diện'
      });
    }
  });

  // 12. INVENTORY SUB-ACTIONS
  router.post('/bot/:id/inventory/:invAction', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

    const invAction = req.params.invAction;
    try {
      const invPayload = (req.body && typeof req.body === 'object' && !Array.isArray(req.body))
        ? { ...req.body, action: invAction }
        : { action: invAction };
      const dispatchResult = await broker.dispatch(perm.worker.workerId, 'inventory', invPayload);
      const evaluated = evaluateCommandDispatch(dispatchResult, `Thao tác ${invAction} kho đồ không thành công`, {
        isAdmin: req.managerAuthSession?.role === 'admin',
        worker: perm.worker,
        actionLabel: `thao tác ${invAction} kho đồ`
      });
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
      return commandErrorResponse(res, error, {
        isAdmin: req.managerAuthSession?.role === 'admin',
        worker: perm.worker,
        actionLabel: `thao tác ${invAction} kho đồ`
      });
    }
  });

  // 13. PROXY TEST & SETTINGS (ADMIN-ONLY, SEC-02 & F-09)
  router.post('/bot/:id/proxy/test', requireSession, async (req, res) => {
    if (req.managerAuthSession?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (ADMIN) mới được kiểm tra cấu hình Proxy.' });
    }
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

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
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

    return res.json({ ok: true, proxy: resolveAdminProxyObject(perm.worker) });
  });

  router.post('/bot/:id/proxy', requireSession, async (req, res) => {
    if (req.managerAuthSession?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (ADMIN) mới được thay đổi cấu hình Proxy.' });
    }
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

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
          actorIp: resolveClientIp(req) || '127.0.0.1',
          details: { enabled: Boolean(proxyUrl) }
        }).catch(() => {});
      }
      return res.json({
        ok: true,
        proxy: parseProxyUrlToObject(proxyUrl),
        message: proxyUrl ? 'Đã lưu cấu hình Proxy cho bot.' : 'Đã tắt Proxy cho bot.'
      });
    } catch (error) {
      logger?.error?.('Failed to update bot proxy', { workerId: perm.worker.workerId, error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
    }
  });

  // 14. UPDATE BOT SETTINGS
  router.post('/bot/:id/settings', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

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
      if (!isRestrictedUser && patch.autoChatSchedules !== undefined) {
        if (!Array.isArray(patch.autoChatSchedules) || patch.autoChatSchedules.length > 50) {
          return res.status(400).json({ ok: false, error: 'autoChatSchedules phải là mảng tối đa 50 phần tử.' });
        }
        settingsPatch.autoChatSchedules = patch.autoChatSchedules;
      }
      if (!isRestrictedUser && patch.botSchedules !== undefined) {
        if (!Array.isArray(patch.botSchedules) || patch.botSchedules.length > 50) {
          return res.status(400).json({ ok: false, error: 'botSchedules phải là mảng tối đa 50 phần tử.' });
        }
        settingsPatch.botSchedules = patch.botSchedules;
      }

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
        if (patch.serverPort !== undefined) {
          const parsedPort = Number(patch.serverPort);
          if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
            return res.status(400).json({ ok: false, error: 'Port máy chủ phải là số nguyên từ 1 đến 65535.' });
          }
          settingsPatch.serverPort = parsedPort;
        }
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
        actorIp: resolveClientIp(req) || '127.0.0.1',
        details: {
          ecoMode: savedSettings.ecoMode,
          autoTotem: savedSettings.autoTotem,
          antiHungry: savedSettings.antiHungry,
          autoReconnect: savedSettings.autoReconnect,
          antiAfkKick: savedSettings.antiAfkKick
        }
      });

      const rawSaved = savedSettings && typeof savedSettings === 'object' ? savedSettings : {};
      const responseSettings = {};
      const ALLOWED_RESPONSE_KEYS = [
        'afkMode', 'proxyEnabled', 'alias', 'tags', 'rentable',
        'ecoMode', 'autoTotem', 'antiHungry', 'autoReconnect', 'antiAfkKick',
        'userNotifyEnabled', 'notifyOnAfkKick', 'notifyOnAfkRecover', 'notifyOnReconnectExhausted',
        'spawnCommands', 'autoChatSchedules', 'botSchedules'
      ];
      for (const k of ALLOWED_RESPONSE_KEYS) {
        if (rawSaved[k] !== undefined) responseSettings[k] = rawSaved[k];
      }
      if (isAdmin) {
        for (const adminKey of ['serviceUrl', 'serverHost', 'serverPort', 'version', 'username']) {
          if (rawSaved[adminKey] !== undefined) responseSettings[adminKey] = rawSaved[adminKey];
        }
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
      const isBadRequest = /Proxy|không hợp lệ|array|mảng|Port/i.test(error.message || '');
      if (!isBadRequest) {
        logger?.error?.('Failed to update bot settings', { workerId: perm.worker.workerId, error: error.message });
      }
      return res.status(isBadRequest ? 400 : 500).json({
        ok: false,
        error: isBadRequest ? error.message : 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.'
      });
    }
  });

  // 15. UPDATE BOT ALIAS & TAGS
  router.post('/bot/:id/alias', requireSession, async (req, res) => {
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });
    if (perm.user?.role !== 'admin' && perm.user?.allowAccountChange === false) {
      return res.status(403).json({ ok: false, error: 'Tài khoản của bạn bị hạn chế thay đổi thông tin bot.' });
    }

    const alias = String(req.body?.alias || '').trim().slice(0, 32);
    try {
      await registry.updateAlias(perm.worker.workerId, alias);
      return res.json({ ok: true, alias, message: 'Đã đổi biệt danh bot thành công.' });
    } catch (error) {
      logger?.error?.('Failed to update bot alias', { workerId: perm.worker.workerId, error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
    }
  });

  router.post('/bot/:id/tags', requireSession, async (req, res) => {
    if (req.managerAuthSession?.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (ADMIN) mới được chỉnh sửa nhãn bot.' });
    }
    const perm = await checkBotPermissionAsync(req, req.params.id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

    const tags = Array.isArray(req.body?.tags) ? req.body.tags.map((t) => String(t).trim().slice(0, 20)).slice(0, 5) : [];
    try {
      await registry.updateTags(perm.worker.workerId, tags);
      return res.json({ ok: true, tags, message: 'Đã cập nhật nhãn bot.' });
    } catch (error) {
      logger?.error?.('Failed to update bot tags', { workerId: perm.worker.workerId, error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
    }
  });

  // 16. EXECUTE LIFECYCLE ACTION ON BOT (start, stop, restart, reconnect, respawn, look, toss, reset)
  router.post('/bot/:id/:action', requireSession, async (req, res, next) => {
    const { id, action } = req.params;
    if (['send', 'settings', 'alias', 'tags', 'proxy', 'account', 'window', 'inventory', 'logs', 'chat-logs', 'auto-chat', 'autoChat', 'bot-schedules', 'botSchedules', 'reset-customer'].includes(action)) {
      return next();
    }
    const perm = await checkBotPermissionAsync(req, id);
    if (!perm.allowed) return res.status(perm.status).json({ ok: false, error: perm.error, ...(perm.code ? { code: perm.code } : {}) });

    const allowedActions = ['start', 'stop', 'restart', 'reconnect', 'respawn', 'inventory', 'look', 'toss', 'status', 'reset'];
    if (!allowedActions.includes(action)) {
      return res.status(400).json({ ok: false, error: `Hành động "${action}" không được hỗ trợ.` });
    }
    if (action === 'reset' && req.managerAuthSession.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Chỉ Quản trị viên (ADMIN) mới được phép đặt lại (reset) bot.' });
    }

    const isAdminSession = req.managerAuthSession?.role === 'admin';
    const actionLabels = {
      start: 'Chạy',
      stop: 'Dừng',
      restart: 'Khởi động lại',
      reconnect: 'Kết nối lại',
      respawn: 'Hồi sinh',
      inventory: 'Kiểm tra túi đồ',
      look: 'Quay góc nhìn',
      toss: 'Vứt vật phẩm',
      status: 'Kiểm tra trạng thái',
      reset: 'Đặt lại'
    };
    const actionLabel = actionLabels[action] || action;

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
          error: isAdminSession
            ? `Bot #${worker.botNumber || id} phản hồi lệnh "${actionLabel}" quá thời gian chờ. Hãy kiểm tra container có đang quá tải hoặc khởi động lại không.`
            : 'Bot phản hồi chậm, vui lòng thử lại sau ít giây.',
          timedOut: true
        });
      }

      if (result?.result && typeof result.result === 'object' && result.result.ok === false) {
        const code = result.result.code || result.result.error || null;
        const status = commandErrorStatus({ code, status: result.result.status });
        const logPayload = {
          botId: worker.workerId,
          action,
          error: code,
          detail: result.result.detail || null,
          status
        };
        if ([400, 404, 409, 422, 429, 503, 504].includes(status)) {
          logger?.warn?.('Bot action rejected or unavailable', logPayload);
        } else {
          logger?.error?.('Bot action state sync or execution failed', logPayload);
        }
        return res.status(status).json({
          ok: false,
          error: humanizeWorkerErrorVi(result.result, { isAdmin: isAdminSession, worker, actionLabel }),
          code,
          result: result.result
        });
      }

      // API-07: Worker confirmed execution -> now safely update manuallyStopped flag
      if (action === 'stop') {
        await registry.updateStatus(
          worker.workerId,
          { state: 'stopped', online: false, manuallyStopped: true, currentWindow: null },
          'user-stop'
        );
      } else if (action === 'start' || action === 'restart' || action === 'reconnect') {
        await registry.updateStatus(worker.workerId, { manuallyStopped: false }, 'user-start');
      }

      await store.addAudit({
        action: `BOT_${action.toUpperCase()}`,
        targetId: worker.workerId,
        actorId: req.managerAuthSession.username,
        details: { result: result?.result || 'confirmed' }
      });

      return res.json({
        ok: true,
        message: isAdminSession
          ? `Đã gửi lệnh ${actionLabel.toLowerCase()} tới Bot #${worker.botNumber || worker.workerId}.`
          : `Đã gửi lệnh ${actionLabel.toLowerCase()} cho Bot #${worker.botNumber || worker.workerId}.`,
        result: result?.result || null
      });
    } catch (error) {
      if (action === 'stop' && error?.code === 'WORKER_UNAVAILABLE') {
        const offlineWorker = perm.worker;
        const marked = await registry.markOfflineStopped(offlineWorker.workerId, { source: 'user-offline-stop' });
        await store.addAudit({
          action: 'BOT_STOP',
          targetId: offlineWorker.workerId,
          actorId: req.managerAuthSession.username,
          details: { result: 'offline_marked_stopped', reason: error.message }
        });
        logger?.info?.('Bot marked stopped locally while Wispbyte worker unavailable', {
          botId: offlineWorker.workerId,
          workerNumber: offlineWorker.botNumber || null
        });
        return res.json({
          ok: true,
          offlineStopped: true,
          message: isAdminSession
            ? `Đã chuyển Bot #${offlineWorker.botNumber || offlineWorker.workerId} sang trạng thái Dừng (container hiện đang tắt nên bot sẽ giữ trạng thái nghỉ khi bật lại).`
            : `Đã dừng Bot #${offlineWorker.botNumber || offlineWorker.workerId}.`,
          bot: marked || registry.publicView(offlineWorker),
          result: { ok: true, state: 'stopped', manuallyStopped: true, offlineStopped: true }
        });
      }
      const status = commandErrorStatus(error);
      if ([400, 404, 409, 422, 429, 503, 504].includes(status)) {
        logger?.warn?.('Bot action rejected or unavailable', { botId: id, action, error: error.message, code: error.code || null, status });
      } else {
        logger.error('Bot action failed', { botId: id, action, error: error.message, code: error.code || null, status });
      }
      const errorMessage = humanizeWorkerErrorVi(error, {
        isAdmin: isAdminSession,
        worker: perm.worker,
        actionLabel
      });
      return res.status(status).json({
        ok: false,
        error: errorMessage,
        code: error.code || null
      });
    }
  });

  // 17. GIFTCODE / RENTAL RENEWAL (Web-only, requires active Discord link for non-admin users)
  async function resolveSessionDiscordLink(user) {
    if (!user || !store) return null;
    const primaryId = String(user.userId || user.username || '').trim();
    const ownUserIdLower = primaryId.toLowerCase();
    const ownUsernameLower = String(user.username || '').trim().toLowerCase();

    let link = null;
    if (typeof store.getDiscordLink === 'function') {
      if (primaryId && !/^\d{17,20}$/.test(primaryId)) {
        link = await store.getDiscordLink(primaryId).catch(() => null);
      }
      if (!link && ownUsernameLower && ownUsernameLower !== ownUserIdLower && !/^\d{17,20}$/.test(ownUsernameLower)) {
        const candidate = await store.getDiscordLink(user.username).catch(() => null);
        if (candidate) {
          const linkOwnerId = String(candidate.manager_user_id || candidate.managerUserId || '').trim().toLowerCase();
          const linkUsername = String(candidate.username || '').trim().toLowerCase();
          if (
            (!linkOwnerId && !linkUsername) ||
            linkOwnerId === ownUserIdLower ||
            linkUsername === ownUsernameLower
          ) {
            link = candidate;
          }
        }
      }
    }

    if (!link && typeof store.getAccess === 'function' && primaryId) {
      const acc = await store.getAccess(primaryId, { bypassCache: true }).catch(() => null);
      const rawDiscordId = String(acc?.discordUserId || acc?.discord_user_id || '').trim();
      const accStatus = String(acc?.discordLinkStatus || 'active').trim().toLowerCase();
      if (rawDiscordId && accStatus !== 'revoked') {
        link = {
          discord_user_id: rawDiscordId,
          manager_user_id: acc?.id || acc?.userId || primaryId,
          username: acc?.username || user.username,
          linked_at: acc?.discordLinkedAt || acc?.updatedAt || null,
          status: 'active'
        };
      }
    }

    if (!link || String(link.status || 'active').toLowerCase() === 'revoked') {
      return null;
    }
    const discordUserId = String(link.discord_user_id || link.discordUserId || '').trim();
    if (!discordUserId) return null;
    return link;
  }

  const handleKeyRedemption = async (req, res) => {
    const session = req.managerAuthSession;
    if (!session) return res.status(401).json({ ok: false, error: 'Chưa đăng nhập.' });

    const rawKey = req.body?.key || req.body?.code || req.body?.licenseKey;
    const key = String(rawKey || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: 'Vui lòng nhập mã Giftcode / Khóa kích hoạt.' });

    if (session.role !== 'admin') {
      const activeDiscordLink = await resolveSessionDiscordLink(session);
      if (!activeDiscordLink) {
        return res.status(403).json({
          ok: false,
          code: 'DISCORD_LINK_REQUIRED',
          requiresDiscordLink: true,
          error: 'Bắt buộc liên kết tài khoản Discord trước khi nhập mã kích hoạt / gia hạn. Vui lòng vào mục Liên kết Discord (dùng lệnh /login trên Discord) rồi thử lại.'
        });
      }
    }

    try {
      const result = await entitlementService.redeem(session.userId, key, session.role);
      const maintenance = await getMaintenanceState(store);
      const rawRentalExpiresAt = result.isPermanent ? null : (result.expiresAt || null);
      const effectiveExpiresAt = result.isPermanent
        ? null
        : computeEffectiveExpiresAt(rawRentalExpiresAt, maintenance);

      // Refresh session assigned bots and expiry in memory
      session.assignedBotIds = (Array.isArray(result.workerIds) ? result.workerIds : []).map((id) => String(id).trim()).filter(Boolean);
      session.isPermanent = result.isPermanent;
      session.status = 'active';
      session.inGracePeriod = false;
      session.rawExpiresAtRental = rawRentalExpiresAt;
      session.expiresAtRental = effectiveExpiresAt;
      if (result.planName) {
        session.planName = result.planName;
      }
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
        planName: result.planName || session.planName || null,
        expiresAt: effectiveExpiresAt,
        rawExpiresAt: rawRentalExpiresAt,
        assignedBotIds: session.assignedBotIds,
        ...(result.partial ? { partial: true } : {}),
        ...(result.warning ? { warning: result.warning } : {})
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  };

  router.post(['/renew', '/redeem', '/keys/redeem', '/rental/redeem-key'], requireSession, handleKeyRedemption);

  // 18. LINK4M REWARDS
  router.get(['/rewards/link4m/status', '/status'], requireSession, async (req, res) => {
    try {
      const requestOrigin = resolveRequestOrigin(req, config?.publicBaseUrl || DEFAULT_PUBLIC_MANAGER_URL);
      const status = await link4mService.getDailyQuotaStatus(req.managerAuthSession.userId, { requestOrigin });
      return res.json({ ok: true, ...status });
    } catch (error) {
      logger?.error?.('Failed to get Link4M status', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
    }
  });

  router.post(['/rewards/link4m/start', '/start'], requireSession, async (req, res) => {
    try {
      const clientIp = resolveClientIp(req) || '127.0.0.1';
      const returnOrigin = resolveRequestOrigin(req, config?.publicBaseUrl || DEFAULT_PUBLIC_MANAGER_URL);
      const result = await link4mService.createLinkAttempt(req.managerAuthSession.userId, clientIp, { returnOrigin });
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
        <html lang="vi">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
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
                  if (data.permanent || data.supportAdmin) {
                    alert('Cảm ơn bạn đã vượt link ủng hộ Admin! Tài khoản của bạn là VIP Vĩnh Viễn nên không cộng thêm thời gian.');
                  } else {
                    alert('Chúc mừng! Bạn đã nhận thêm ' + (data.addedHours || data.rewardHours || 12) + ' giờ sử dụng Bot thành công.');
                  }
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
      logger?.error?.('Failed to render Link4M return page', { error: error.message });
      return res.status(500).send('Đã xảy ra lỗi hệ thống khi xử lý xác nhận.');
    }
  });

  router.post(['/rewards/link4m/verify', '/verify'], async (req, res) => {
    try {
      const clientIp = resolveClientIp(req) || '127.0.0.1';
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
        const attemptUserId = String(attempt.userId || '').trim().toLowerCase();
        const attemptUsername = String(attempt.username || '').trim().toLowerCase();
        const sessionUserId = String(session.userId || '').trim().toLowerCase();
        const sessionUsername = String(session.username || '').trim().toLowerCase();
        const isOwner = session.role === 'admin' ||
          (attemptUserId && sessionUserId && attemptUserId === sessionUserId) ||
          (attemptUsername && sessionUsername && attemptUsername === sessionUsername);
        if (!isOwner) {
          return res.status(403).json({ ok: false, error: 'Không có quyền kiểm tra phiên vượt link này.' });
        }
        const isRewarded = attempt.status === 'rewarded' || attempt.status === 'completed';
        const isPermanent = Boolean(session.isPermanent === true || Number(attempt.rewardHours) === 0);
        return res.json({
          ok: true,
          isRewarded,
          status: attempt.status,
          permanent: isPermanent,
          supportAdmin: isPermanent,
          rewardHours: isPermanent ? 0 : (attempt.rewardHours || 12)
        });
      }

      const result = await link4mService.verifyAndClaimReward(token, attemptId);
      if (req.managerAuthSession?.userId && typeof invalidateUserSessions === 'function') {
        req.managerAuthSession._authVerifiedAt = 0;
      }
      if (typeof store.invalidateUserCache === 'function') {
        store.invalidateUserCache(req.managerAuthSession?.userId, req.managerAuthSession?.username);
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
      const link = await resolveSessionDiscordLink(user);
      const discordNotifyEnabled = await readUserDiscordNotifyEnabled(user);
      if (!link) {
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
      logger?.error?.('Failed to fetch Discord link', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
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
          actorIp: resolveClientIp(req) || '127.0.0.1',
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
      logger?.error?.('Failed to toggle Discord notify', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
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
      logger?.error?.('Failed to unlink Discord account', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
    }
  });

  async function buildPublicSystemInfo() {
    const [bots, persistedSys] = await Promise.all([
      registry.list(),
      typeof store?.getSetting === 'function' ? store.getSetting('system_settings').catch(() => null) : null
    ]);
    const onlineCount = bots.filter((b) => isWorkerOnlineInGame(b)).length;
    const trialGiftEnabled = persistedSys?.trialGiftEnabled !== undefined
      ? Boolean(persistedSys.trialGiftEnabled)
      : Boolean(config?.trialGiftEnabled ?? false);
    const trialDays = Number(persistedSys?.trialDays || config?.trialDays || 1);

    return {
      ok: true,
      service: 'KingMC AFK Bot Cloud 24/7',
      version: '12.1.1-Modular-Enterprise',
      uptime: Math.floor(process.uptime()),
      totalBots: bots.length,
      onlineBots: onlineCount,
      trialGiftEnabled,
      trialDays,
      time: new Date().toISOString()
    };
  }

  async function getCachedBootstrapPayload() {
    const now = Date.now();
    if (publicBootstrapCache && (now - publicBootstrapCache.at < 10000)) {
      return publicBootstrapCache.payload;
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
    return payload;
  }

  // 19. PUBLIC SYSTEM INFO & COMBINED BOOTSTRAP (BW-01, SEC-05, API-19)
  router.get(['/public/system-info', '/system-info'], async (_req, res) => {
    try {
      const bootstrapPayload = await getCachedBootstrapPayload();
      return res.json(bootstrapPayload.systemInfo);
    } catch (error) {
      logger?.error?.('Failed to build public system info', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
    }
  });

  router.get(['/public/bootstrap', '/bootstrap'], async (_req, res) => {
    try {
      return res.json(await getCachedBootstrapPayload());
    } catch (error) {
      logger?.error?.('Failed to build public bootstrap payload', { error: error.message });
      return res.status(500).json({ ok: false, error: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.' });
    }
  });

  router.broadcastSystemSseEvent = routerBroadcastSystemSseEvent;
  router.closeAllSseClients = () => {
    activeSseHubs.delete(hubHandle);
    return routerCloseAllSseClients();
  };
  router.closeUserSseClients = routerCloseUserSseClients;
  router.closeAdminSseClients = routerCloseAdminSseClients;
  router.getSseClientCount = routerGetSseClientCount;

  return router;
}

module.exports = {
  createUserApi,
  broadcastSystemSseEvent,
  closeAllSseClients,
  getSseClientCount
};
