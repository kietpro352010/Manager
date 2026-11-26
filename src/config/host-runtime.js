'use strict';

const net = require('node:net');
const { isTrustedProxyRequest } = require('../services/captcha');

function validPort(value) {
  const text = String(value || '').trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function cliPort(args = process.argv.slice(2)) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index] || '');
    const equals = argument.match(/^--(?:port|server[_-]port|web[_-]port)=(\d{2,5})$/i);
    if (equals) return validPort(equals[1]);
    if (/^--(?:port|server[_-]port|web[_-]port)$/i.test(argument) || argument === '-p') {
      const next = validPort(args[index + 1]);
      if (next) return next;
    }
  }
  return args.map(validPort).find(Boolean) || null;
}

const DEFAULT_PUBLIC_MANAGER_URL = 'https://kbotmanager.onrender.com';

function normalizePublicUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function isPublicHttpsUrl(value) {
  const normalized = normalizePublicUrl(value);
  if (!normalized || !normalized.startsWith('https://')) return false;
  try {
    const { hostname } = new URL(normalized);
    const lower = String(hostname || '').toLowerCase();
    const bareIp = lower.replace(/^\[|\]$/g, '');
    if (
      !lower ||
      !lower.includes('.') ||
      lower === 'localhost' ||
      lower.endsWith('.local') ||
      lower.endsWith('.localhost') ||
      lower.endsWith('.internal')
    ) {
      return false;
    }
    if (net.isIP(bareIp) !== 0) return false;
    return true;
  } catch {
    return false;
  }
}

function firstForwardedValue(headerValue) {
  if (Array.isArray(headerValue)) headerValue = headerValue[0];
  return String(headerValue || '').split(',')[0].trim();
}

function resolveRequestOrigin(req, fallbackUrl = DEFAULT_PUBLIC_MANAGER_URL) {
  const fallback = fallbackUrl === null ? '' : (normalizePublicUrl(fallbackUrl) || DEFAULT_PUBLIC_MANAGER_URL);
  if (!req || typeof req !== 'object') return fallback;
  const readHeader = (name) => {
    if (typeof req.get === 'function') return req.get(name);
    if (req.headers && typeof req.headers === 'object') {
      return req.headers[name] ?? req.headers[name.toLowerCase()];
    }
    return '';
  };
  const trustForwarded = !req?.socket?.remoteAddress || isTrustedProxyRequest(req);
  const forwardedHost = trustForwarded ? firstForwardedValue(readHeader('x-forwarded-host')) : '';
  const directHost = firstForwardedValue(readHeader('host'));
  const rawHost = (forwardedHost || directHost).replace(/[\s/\\@]/g, '');
  if (rawHost && !rawHost.includes('..')) {
    const rawProto = trustForwarded ? firstForwardedValue(readHeader('x-forwarded-proto')).toLowerCase() : '';
    const reqProto = String(req.protocol || '').trim().toLowerCase();
    const isLoopback = /^(?:localhost|127\.0\.0\.1|\[::1\]|::1)(?::\d+)?$/i.test(rawHost);
    const proto = (rawProto === 'https' || rawProto === 'http')
      ? rawProto
      : (reqProto === 'http' && isLoopback ? 'http' : (reqProto === 'https' || !isLoopback ? 'https' : 'http'));
    const candidate = normalizePublicUrl(`${proto}://${rawHost}`);
    if (candidate) return candidate;
  }
  return fallback;
}

function detectHostRuntime(env = process.env) {
  const render = String(env.RENDER || '').toLowerCase() === 'true'
    || Boolean(env.RENDER_SERVICE_ID || env.RENDER_INSTANCE_ID || env.RENDER_SERVICE_NAME || env.RENDER_EXTERNAL_URL || env.RENDER_EXTERNAL_HOSTNAME);
  const wispbyte = Boolean(env.WISPBYTE || env.WISP || env.WISPBAY || env.DEPLEXO || env.PTERODACTYL
    || env.P_SERVER_UUID || env.P_SERVER_ALLOCATION_LIMIT || env.P_SERVER_PORT || env.SERVER_PORT || env.ALLOCATION_PORT || env.STARTUP);
  const platform = render ? 'render' : (wispbyte ? 'wispbyte' : 'generic-node');

  let port = cliPort(env.__ARGV || process.argv.slice(2));
  let portSource = port ? 'command-line' : 'default';
  const portCandidates = ['SERVER_PORT', 'P_SERVER_PORT', 'ALLOCATION_PORT', 'PORT', 'APP_PORT', 'WEB_PORT'];
  if (!port) {
    for (const key of portCandidates) {
      const candidate = validPort(env[key]);
      if (candidate) {
        port = candidate;
        portSource = key;
        break;
      }
    }
  }
  if (!port && render) {
    port = 10000;
    portSource = 'render-default';
  }
  if (!port) {
    port = (platform === 'generic-node' ? 3000 : 10000);
    portSource = 'application-default';
  }

  let publicBaseUrl = '';
  let publicUrlSource = 'unset';
  for (const key of ['RENDER_EXTERNAL_URL', 'PUBLIC_BASE_URL', 'WISPBYTE_PUBLIC_URL', 'PUBLIC_URL', 'APP_URL', 'SERVICE_URL', 'RENDER_EXTERNAL_HOSTNAME']) {
    const candidate = normalizePublicUrl(env[key]);
    if (candidate) {
      publicBaseUrl = candidate;
      publicUrlSource = key;
      break;
    }
  }

  return Object.freeze({ platform, port, portSource, publicBaseUrl, publicUrlSource });
}

async function listenHttpServer(server, portOrOptions, maybeHost, maybeOptions) {
  let port;
  let host = '0.0.0.0';
  let maxRetries = 10;
  let retryDelayMs = 1000;
  let logger = console;

  if (typeof portOrOptions === 'object' && portOrOptions !== null) {
    port = portOrOptions.port;
    if (portOrOptions.host) host = portOrOptions.host;
    if (portOrOptions.maxRetries) maxRetries = portOrOptions.maxRetries;
    if (portOrOptions.retryDelayMs) retryDelayMs = portOrOptions.retryDelayMs;
    if (portOrOptions.logger) logger = portOrOptions.logger;
  } else {
    port = portOrOptions;
    if (typeof maybeHost === 'string' && maybeHost) host = maybeHost;
    const opts = (typeof maybeHost === 'object' && maybeHost !== null) ? maybeHost : (maybeOptions || {});
    if (opts.maxRetries) maxRetries = opts.maxRetries;
    if (opts.retryDelayMs) retryDelayMs = opts.retryDelayMs;
    if (opts.logger) logger = opts.logger;
  }

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 40000;

  let currentPort = Number(port) || 3000;
  let attempts = 0;

  while (attempts < maxRetries) {
    attempts++;
    try {
      await new Promise((resolve, reject) => {
        const errorHandler = (err) => {
          server.removeListener('listening', successHandler);
          reject(err);
        };
        const successHandler = () => {
          server.removeListener('error', errorHandler);
          resolve();
        };
        server.once('error', errorHandler);
        server.once('listening', successHandler);
        server.listen(currentPort, host);
      });
      if (logger && typeof logger.info === 'function') {
        logger.info(`[HTTP] Server listening on ${host}:${currentPort}`);
      }
      return { host, port: currentPort };
    } catch (err) {
      if (err.code === 'EADDRINUSE' && attempts < maxRetries) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`[HTTP] Cổng ${currentPort} đang bận (EADDRINUSE). Thử lại lần ${attempts}/${maxRetries} sau ${retryDelayMs}ms...`);
        }
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Không thể khởi động HTTP server trên ${host}:${currentPort} sau ${maxRetries} lần thử.`);
}

module.exports = {
  DEFAULT_PUBLIC_MANAGER_URL,
  detectHostRuntime,
  detectHostPlatformAndPort: detectHostRuntime,
  normalizePublicUrl,
  isPublicHttpsUrl,
  resolveRequestOrigin,
  validPort,
  cliPort,
  listenHttpServer
};
