'use strict';

const crypto = require('node:crypto');

function generateWorkerSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function encryptSecret(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
}

function decryptSecret(record, key) {
  const [ivPart, tagPart, ciphertextPart] = String(record || '').split('.');
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error('Stored worker credential is malformed.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64')), decipher.final()]).toString('utf8');
}

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ''), 'utf8');
  const right = Buffer.from(String(rightValue || ''), 'utf8');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = { generateWorkerSecret, encryptSecret, decryptSecret, safeEqual };
