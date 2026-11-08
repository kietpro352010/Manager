'use strict';

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new Error(`Remote server returned invalid JSON (${response.status}).`); }
}

module.exports = { readJson };
