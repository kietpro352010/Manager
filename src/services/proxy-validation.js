'use strict';

const { isIP } = require('node:net');

function isLocalOrPrivateHost(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (['localhost', 'localhost.localdomain'].includes(host) || /\.(?:localhost|local|internal|lan)$/.test(host)) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(host) === 6) {
    return host === '::' || host === '::1' || /^(?:fc|fd|fe8|fe9|fea|feb|ff)/.test(host)
      || /^::ffff:(?:127\.|10\.|192\.168\.|169\.254\.)/.test(host);
  }
  return false;
}

module.exports = { isLocalOrPrivateHost };
