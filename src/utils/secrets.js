'use strict';

const crypto = require('node:crypto');

function generateWorkerSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function toKeyBuffer(key) {
  if (Buffer.isBuffer(key)) {
    if (key.length === 32) return key;
    return crypto.createHash('sha256').update(key).digest();
  }
  if (typeof key === 'string') {
    const trimmed = key.trim();
    if (trimmed.length === 44 && /^[A-Za-z0-9+/=]+$/.test(trimmed)) {
      try {
        const buf = Buffer.from(trimmed, 'base64');
        if (buf.length === 32) return buf;
      } catch (_) {}
    }
    if (trimmed.length === 64 && /^[a-fA-F0-9]+$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }
    return crypto.createHash('sha256').update(trimmed).digest();
  }
  throw new Error('Khóa mã hóa không hợp lệ (phải là Buffer hoặc chuỗi ký tự).');
}

function isStoredCredentialCiphertext(value) {
  return typeof value === 'string' && (
    value.startsWith('aes256$gcm$') ||
    value.startsWith('enc:v1:') ||
    value.startsWith('enc:v2:') ||
    value.startsWith('enc$')
  );
}

function isUnsupportedCredentialCiphertext(value) {
  return typeof value === 'string' && /^enc:v[0-9]+:/i.test(value) && !isStoredCredentialCiphertext(value);
}

function getLegacyCredentialKeys(primaryKey, previousKey) {
  const allowLegacyStaticKeys = process.env.KBOT_LEGACY_SECRET_WINDOW === '1' || (process.env.NODE_ENV !== 'production' && !process.env.KBOT_STRICT_PRODUCTION);
  const sources = [
    primaryKey,
    process.env.MANAGER_MASTER_KEY,
    process.env.MANAGER_ENCRYPTION_KEY,
    process.env.BOT_CREDENTIALS_ENCRYPTION_KEY,
    previousKey,
    process.env.MANAGER_MASTER_KEY_PREVIOUS,
    process.env.ENCRYPTION_KEY,
    process.env.BOT_SECRET_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_KEY,
    (process.env.SUPABASE_SERVICE_ROLE_KEY ? 'kbot-cred-v1:' + String(process.env.SUPABASE_SERVICE_ROLE_KEY).trim() : ''),
    (process.env.SUPABASE_KEY ? 'kbot-cred-v1:' + String(process.env.SUPABASE_KEY).trim() : ''),
    'kbot_enterprise_stable_encryption_key_v11',
    ...(allowLegacyStaticKeys ? [
      'kbot_default_key',
      'KingMC_Master_Secret_Key_32Byte!'
    ] : [])
  ];

  const seen = new Set();
  const keys = [];
  for (const src of sources) {
    if (!src) continue;
    try {
      const keyBuf = toKeyBuffer(src);
      const hex = keyBuf.toString('hex');
      if (!seen.has(hex)) {
        seen.add(hex);
        keys.push(keyBuf);
      }
    } catch (_) {}
  }
  return keys;
}

// ----------------------------------------------------------------------------
// 1. Worker Secret Encryption (Dot-separated base64)
// ----------------------------------------------------------------------------
function encryptSecret(plaintext, key) {
  const keyBuf = toKeyBuffer(key);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext || ''), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
}

function decryptSecret(record, key) {
  const keyBuf = toKeyBuffer(key);
  const [ivPart, tagPart, ciphertextPart] = String(record || '').split('.');
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error('Stored worker credential is malformed.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, Buffer.from(ivPart, 'base64'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64')), decipher.final()]).toString('utf8');
}

// ----------------------------------------------------------------------------
// 2. Database User Password Encryption (Hex Dollar Format aes256$gcm$iv$tag$ct)
// ----------------------------------------------------------------------------
function encryptUserPassword(value, key = null) {
  if (value === null || value === undefined || value === '') return '';
  let plaintext = String(value);
  if (isUnsupportedCredentialCiphertext(plaintext)) throw new Error('Định dạng ciphertext credential không được hỗ trợ.');
  if (isStoredCredentialCiphertext(plaintext)) {
    const decrypted = decryptUserPassword(plaintext, key);
    if (decrypted === null || decrypted === '') throw new Error('Không thể xác minh ciphertext credential hiện có.');
    plaintext = decrypted;
  }
  let activeKey = key ? toKeyBuffer(key) : null;
  if (!activeKey) {
    const primary = String(process.env.MANAGER_MASTER_KEY || process.env.MANAGER_ENCRYPTION_KEY || '').trim();
    if (primary) {
      activeKey = toKeyBuffer(primary);
    } else {
      activeKey = toKeyBuffer('kbot_enterprise_stable_encryption_key_v11');
    }
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', activeKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['aes256', 'gcm', iv.toString('hex'), cipher.getAuthTag().toString('hex'), ciphertext.toString('hex')].join('$');
}

function decryptUserPassword(value, key = null, previousKey = null) {
  if (value === null || value === undefined || value === '') return '';
  const stored = String(value);
  if (isUnsupportedCredentialCiphertext(stored)) return null;
  if (!isStoredCredentialCiphertext(stored)) return stored;

  let iv, tag, ciphertext;
  if (stored.startsWith('aes256$gcm$')) {
    const parts = stored.split('$');
    if (parts.length !== 5) return null;
    iv = parts[2];
    tag = parts[3];
    ciphertext = parts[4];
  } else if (stored.startsWith('enc:v1:') || stored.startsWith('enc:v2:')) {
    const parts = stored.split(':');
    if (parts.length !== 5) return null;
    iv = parts[2];
    tag = parts[3];
    ciphertext = parts[4];
  } else {
    const parts = stored.split('$');
    if (parts.length < 4) return null;
    iv = parts[1];
    tag = parts[2];
    ciphertext = parts[3];
  }

  if (!/^[a-f0-9]{24}$/i.test(iv || '') || !/^[a-f0-9]{32}$/i.test(tag || '') || !/^(?:[a-f0-9]{2})*$/i.test(ciphertext || '')) {
    return null;
  }

  const candidateKeys = getLegacyCredentialKeys(key, previousKey);
  for (const candidateKey of candidateKeys) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', candidateKey, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(tag, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString('utf8');
    } catch (_) {}
  }
  return null;
}

// ----------------------------------------------------------------------------
// 3. Password Hashing & Timing-Safe Verification (Scrypt)
// ----------------------------------------------------------------------------
function hashPassword(password, salt = null) {
  const actualSalt = salt && typeof salt === 'string' && salt.length >= 8
    ? salt
    : crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), actualSalt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$N=16384,r=8,p=1$${actualSalt}$${derived.toString('hex')}`;
}

function verifyPassword(password, storedValue) {
  const stored = String(storedValue || '').trim();
  const candidate = String(password || '');
  if (!stored || !candidate) return false;

  if (isStoredCredentialCiphertext(stored)) {
    const plain = decryptUserPassword(stored);
    return plain !== null && timingSafeStringEquals(candidate, plain);
  }

  if (!stored.startsWith('scrypt$')) {
    return timingSafeStringEquals(candidate, stored);
  }

  const parts = stored.split('$');
  let salt;
  let expectedHex;
  let options = { N: 16384, r: 8, p: 1 };

  if (parts.length === 4 && /^N=\d+,r=\d+,p=\d+$/i.test(parts[1])) {
    const params = Object.fromEntries(parts[1].split(',').map((part) => part.split('=')));
    options = { N: Number(params.N), r: Number(params.r), p: Number(params.p) };
    salt = parts[2];
    expectedHex = parts[3];
  } else if (parts.length === 6 && /^N=\d+,r=\d+,p=\d+$/i.test(parts[1])) {
    const params = Object.fromEntries(parts[1].split(',').map((part) => part.split('=')));
    options = { N: Number(params.N), r: Number(params.r), p: Number(params.p) };
    salt = parts[4];
    expectedHex = parts[5];
  } else {
    return false;
  }

  if (!Number.isSafeInteger(options.N) || options.N < 1024 || options.N > 262144 ||
      !Number.isSafeInteger(options.r) || options.r < 1 || options.r > 16 ||
      !Number.isSafeInteger(options.p) || options.p < 1 || options.p > 4 ||
      !salt || !/^[a-f0-9]+$/i.test(expectedHex || '') || expectedHex.length % 2 !== 0) {
    return false;
  }

  try {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = crypto.scryptSync(candidate, salt, expected.length, options);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

function timingSafeStringEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function safeEqual(leftValue, rightValue) {
  return timingSafeStringEquals(String(leftValue || ''), String(rightValue || ''));
}

module.exports = {
  generateWorkerSecret,
  generateToken,
  toKeyBuffer,
  encryptSecret,
  decryptSecret,
  encryptUserPassword,
  decryptUserPassword,
  hashPassword,
  hashAdminPassword: hashPassword,
  verifyPassword,
  verifyAdminPassword: verifyPassword,
  verifyUserPassword: verifyPassword,
  timingSafeStringEquals,
  safeEqual,
  isStoredCredentialCiphertext,
  isUnsupportedCredentialCiphertext
};
