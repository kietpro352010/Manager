'use strict';

const SECRET_KEY = /token|password|secret|authorization|cookie|api.?key/i;

function redact(value, key = '') {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return value;
}

function createLogger(level = 'info') {
  const priorities = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = priorities[level] || priorities.info;
  return Object.freeze(Object.fromEntries(Object.entries(priorities).map(([name, priority]) => [name, (event, fields = {}) => {
    if (priority < threshold) return;
    const line = { time: new Date().toISOString(), level: name, event, ...redact(fields) };
    const writer = name === 'error' ? console.error : name === 'warn' ? console.warn : console.log;
    writer(JSON.stringify(line));
  }])));
}

module.exports = { createLogger };
