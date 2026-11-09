'use strict';

function cleanText(input) {
  return String(input || '')
    .replace(/§x(§[0-9a-f]){6}/gi, '')
    .replace(/&x(&[0-9a-f]){6}/gi, '')
    .replace(/&#[0-9a-f]{6}/gi, '')
    .replace(/§#[0-9a-f]{6}/gi, '')
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/&[0-9a-fk-or]/gi, '')
    .replace(/§./g, '')
    .replace(/[\u00a0\u200b\ufeff]/g, ' ')
    .normalize('NFC')
    .trim();
}

function extractChatMessage(raw) {
  if (!raw) return '';
  if (typeof raw === 'object' && typeof raw.toPlainText === 'function') {
    return cleanText(raw.toPlainText());
  }
  let str = typeof raw === 'string' ? raw : '';
  if (!str && typeof raw === 'object') {
    try {
      str = JSON.stringify(raw);
    } catch (_) {
      str = String(raw);
    }
  }
  if (typeof str === 'string' && (str.startsWith('{') || str.startsWith('['))) {
    try {
      const parsed = JSON.parse(str);
      const parts = [];
      const walk = (node) => {
        if (!node) return;
        if (typeof node === 'string') { parts.push(node); return; }
        if (typeof node.text === 'string') parts.push(node.text);
        if (Array.isArray(node.extra)) {
          for (const item of node.extra) walk(item);
        }
      };
      walk(parsed);
      const combined = cleanText(parts.join(''));
      if (combined.length > 0) return combined;
    } catch (_) {}
  }
  return cleanText(str);
}

module.exports = { cleanText, extractChatMessage };
