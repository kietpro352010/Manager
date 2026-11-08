'use strict';

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

function normalizePublicUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
    return url.origin;
  } catch { return ''; }
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
      if (candidate) { port = candidate; portSource = key; break; }
    }
  }
  if (!port && render) { port = 10000; portSource = 'render-default'; }
  if (!port) { port = 10000; portSource = 'application-default'; }

  let publicBaseUrl = '';
  let publicUrlSource = 'unset';
  for (const key of ['RENDER_EXTERNAL_URL', 'PUBLIC_BASE_URL', 'WISPBYTE_PUBLIC_URL', 'PUBLIC_URL', 'APP_URL', 'SERVICE_URL', 'RENDER_EXTERNAL_HOSTNAME']) {
    const candidate = normalizePublicUrl(env[key]);
    if (candidate) { publicBaseUrl = candidate; publicUrlSource = key; break; }
  }

  return Object.freeze({ platform, port, portSource, publicBaseUrl, publicUrlSource });
}

module.exports = { detectHostRuntime, normalizePublicUrl, validPort };
