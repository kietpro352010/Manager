'use strict';

const SECRET_KEY = /password|secret|token|cookie|authorization|api.?key|credential|proxy.?url/i;

const URL_CREDENTIAL_REGEX = /(:\/\/[^\s:@]+:)[^\s@]+(@)/g;

function redactStringSecrets(str) {
  if (typeof str !== 'string') return str;
  if (str.includes('://') && str.includes('@')) {
    return str.replace(URL_CREDENTIAL_REGEX, '$1***$2');
  }
  return str;
}

function redact(value, key = '', visited = new WeakSet(), depth = 0) {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (depth > 8) return '[MAX_DEPTH]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactStringSecrets(value.message),
      stack: redactStringSecrets(value.stack),
      code: value.code
    };
  }
  if (Array.isArray(value)) {
    if (visited.has(value)) return '[CIRCULAR]';
    visited.add(value);
    return value.map((item) => redact(item, key, visited, depth + 1));
  }
  if (value && typeof value === 'object') {
    if (visited.has(value)) return '[CIRCULAR]';
    visited.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey, visited, depth + 1)])
    );
  }
  if (typeof value === 'string') {
    return redactStringSecrets(value);
  }
  return value;
}

function createLogger(level = 'info') {
  const priorities = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = priorities[level] || priorities.info;
  return Object.fromEntries(Object.entries(priorities).map(([name, priority]) => [name, (event, fields = {}) => {
    if (priority < threshold) return;
    const safeFields = fields && typeof fields === 'object' && !Array.isArray(fields)
      ? redact(fields)
      : { data: redact(fields) };
    const record = {
      ...safeFields,
      time: new Date().toISOString(),
      level: name,
      event: String(event)
    };
    let line;
    try {
      line = JSON.stringify(record);
    } catch (err) {
      line = JSON.stringify({
        time: new Date().toISOString(),
        level: 'error',
        event: 'logger_serialization_failed',
        originalEvent: String(event),
        error: String(err?.message || err)
      });
    }
    const writer = name === 'error' ? console.error : name === 'warn' ? console.warn : console.log;
    writer(line);
  }]));
}

module.exports = { createLogger };
