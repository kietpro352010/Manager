'use strict';

const SECRET_KEY = /password|secret|token|cookie|authorization|api.?key|credential|proxy.?url/i;

const PRIVATE_KEY_PEM_REGEX = /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?(?:-----END[ A-Z0-9_-]*PRIVATE KEY-----|$)/gi;
const URL_CREDENTIAL_REGEX = /([a-zA-Z0-9+.-]+:\/\/[^\s:@]+:)[^\s@]+(@)/g;
const TELEGRAM_BOT_URL_REGEX = /(\/bot\d{5,15}:)[A-Za-z0-9_-]+(\/?)/gi;
const DISCORD_WEBHOOK_URL_REGEX = /(\/(?:api(?:\/v\d+)?\/)?webhooks\/\d+\/)[A-Za-z0-9_.-]+/gi;
const JSON_SECRET_REGEX = /("(?:password|passwd|pass|token|access_?token|refresh_?token|secret|cookie|api_?key|authorization|session|credential|proxy_?url)"\s*:\s*")((?:[^"\\]|\\.)*)(")/gi;
const COOKIE_HEADER_REGEX = /(\b(?:set-)?cookie\s*:\s*)(?!\[REDACTED\])([^\r\n"]+)/gi;
const AUTH_HEADER_REGEX = /(\bauthorization\s*[:=]\s*)(?:(?:Bearer|Basic|Token)\s+)?(?!\[REDACTED\])[^\s\r\n,;"]+/gi;
const BEARER_TOKEN_REGEX = /(\bBearer\s+)(?!\[REDACTED\])[A-Za-z0-9_.\-+/=]{6,}/gi;
const JWT_TOKEN_REGEX = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const QUERY_SECRET_REGEX = /([?&](?:api(?:_?key)?|token|access_?token|refresh_?token|key|secret|password|passwd|auth|signature|sig)\s*=\s*)(?!\[REDACTED\])([^&\s\r\n"'#]+)/gi;
const KV_SECRET_REGEX = /(\b(?:token|secret|password|passwd|api_?key|access_?token|refresh_?token|authorization|cookie|session|key)\s*[:=]\s*)(?!\[REDACTED\])([^\s&"';,\r\n]+)/gi;
const MC_AUTH_CMD_REGEX = /(\/(?:[a-z0-9_-]+:)?(?:login|l|dn|register|reg|dk|changepassword|changepass|password|unregister|email)\s+)([^\r\n"`]+)/gim;
const FAST_SECRET_HINT_REGEX = /[:=/&?"']|eyJ|Bearer\s|-----BEGIN/i;

function redactStringSecrets(str) {
  if (typeof str !== 'string' || str.length < 4) return str;
  if (!FAST_SECRET_HINT_REGEX.test(str)) return str;
  return str
    .replace(PRIVATE_KEY_PEM_REGEX, '[REDACTED PRIVATE KEY]')
    .replace(URL_CREDENTIAL_REGEX, '$1***$2')
    .replace(TELEGRAM_BOT_URL_REGEX, '$1[REDACTED]$2')
    .replace(DISCORD_WEBHOOK_URL_REGEX, '$1[REDACTED]')
    .replace(JSON_SECRET_REGEX, '$1[REDACTED]$3')
    .replace(COOKIE_HEADER_REGEX, '$1[REDACTED]')
    .replace(AUTH_HEADER_REGEX, '$1[REDACTED]')
    .replace(BEARER_TOKEN_REGEX, '$1[REDACTED]')
    .replace(JWT_TOKEN_REGEX, '[REDACTED_JWT]')
    .replace(QUERY_SECRET_REGEX, '$1[REDACTED]')
    .replace(KV_SECRET_REGEX, '$1[REDACTED]')
    .replace(MC_AUTH_CMD_REGEX, '$1[REDACTED]');
}

function redact(value, key = '', visited = new WeakSet(), depth = 0) {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'bigint') return value.toString();
  if (depth > 8) return '[MAX_DEPTH]';
  if (value instanceof Error) {
    if (visited.has(value)) return '[CIRCULAR]';
    visited.add(value);
    try {
      const out = {
        name: value.name,
        message: redactStringSecrets(value.message),
        stack: redactStringSecrets(value.stack),
        code: value.code
      };
      if (value.status !== undefined) out.status = value.status;
      else if (value.statusCode !== undefined) out.status = value.statusCode;
      if (value.cause !== undefined) {
        out.cause = redact(value.cause, 'cause', visited, depth + 1);
      }
      return out;
    } finally {
      visited.delete(value);
    }
  }
  if (Array.isArray(value)) {
    if (visited.has(value)) return '[CIRCULAR]';
    visited.add(value);
    try {
      return value.map((item) => redact(item, key, visited, depth + 1));
    } finally {
      visited.delete(value);
    }
  }
  if (value && typeof value === 'object') {
    if (visited.has(value)) return '[CIRCULAR]';
    visited.add(value);
    try {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey, visited, depth + 1)])
      );
    } finally {
      visited.delete(value);
    }
  }
  if (typeof value === 'string') {
    return redactStringSecrets(value);
  }
  return value;
}

function jsonSafeReplacer(_k, v) {
  return typeof v === 'bigint' ? v.toString() : v;
}

function createLogger(level = 'info') {
  const priorities = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = priorities[level] || priorities.info;
  return Object.fromEntries(Object.entries(priorities).map(([name, priority]) => [name, (event, fields = {}) => {
    if (priority < threshold) return;
    const safeEvent = redactStringSecrets(String(event));
    let safeFields;
    try {
      safeFields = fields && typeof fields === 'object' && !Array.isArray(fields)
        ? redact(fields)
        : { data: redact(fields) };
    } catch (redactErr) {
      safeFields = { redactionError: redactStringSecrets(String(redactErr?.message || redactErr)) };
    }
    const record = {
      ...safeFields,
      time: new Date().toISOString(),
      level: name,
      event: safeEvent
    };
    let line;
    try {
      line = JSON.stringify(record, jsonSafeReplacer);
    } catch (err) {
      line = JSON.stringify({
        time: new Date().toISOString(),
        level: 'error',
        event: 'logger_serialization_failed',
        originalEvent: safeEvent,
        error: redactStringSecrets(String(err?.message || err))
      });
    }
    const writer = name === 'error' ? console.error : name === 'warn' ? console.warn : console.log;
    writer(line);
  }]));
}

module.exports = { createLogger, redactStringSecrets, redact };
