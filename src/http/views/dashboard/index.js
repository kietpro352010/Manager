'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STYLE_FILES = [
  'styles/01-tokens-and-base.css',
  'styles/02-shell-and-fleet.css',
  'styles/03-modals-and-profile.css',
  'styles/04-detail-and-inventory.css',
  'styles/05-admin-and-landing.css',
  'styles/06-responsive-and-themes.css'
];

const PARTIAL_FILES = [
  'partials/01-overlays-and-login.html',
  'partials/02-shell-sidebar-header.html',
  'partials/03-fleet-and-detail.html',
  'partials/04-admin-pages.html',
  'partials/05-modals-core.html',
  'partials/06-modals-extra.html'
];

const SCRIPT_FILES = [
  'scripts/01-core-and-cards.js',
  'scripts/02-auth-theme-canvas.js',
  'scripts/03-navigation-and-users.js',
  'scripts/04-fleet-and-admin-modals.js',
  'scripts/05-detail-gui-and-logs.js',
  'scripts/06-detail-inventory-sched.js',
  'scripts/07-rewards-supabase-boot.js'
];

function readAsset(relPath) {
  return fs.readFileSync(path.join(__dirname, relPath), 'utf8').replace(/\s+$/, '');
}

function minifyCssSafe(cssText) {
  // Strip CSS block comments outside strings and trim redundant leading indentation / blank lines
  let out = '';
  let i = 0;
  let quote = '';
  const len = cssText.length;
  while (i < len) {
    const ch = cssText[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < len) {
        out += cssText[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && cssText[i + 1] === '*') {
      const end = cssText.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const HEAD = readAsset('head.html');
const STYLES = minifyCssSafe(STYLE_FILES.map(readAsset).join('\n'));
const BODY = PARTIAL_FILES.map(readAsset).join('\n');
const SCRIPTS = SCRIPT_FILES.map(readAsset).join('\n');

const CSS_HASH = crypto.createHash('sha256').update(STYLES).digest('hex').slice(0, 12);
const JS_HASH = crypto.createHash('sha256').update(SCRIPTS).digest('hex').slice(0, 12);
const CSS_PATH = `/assets/dashboard.${CSS_HASH}.css`;
const JS_PATH = `/assets/dashboard.${JS_HASH}.js`;

// Full inline bundle built lazily only when requested (e.g. static analysis / tests)
let cachedFullHtml = null;
function getFullHtml() {
  if (cachedFullHtml === null) {
    cachedFullHtml = `${HEAD}
<style>
${STYLES}
</style>
</head>
${BODY}
<script>
${SCRIPTS}
</script>
</body>
</html>`;
  }
  return cachedFullHtml;
}

// Lightweight HTML shell referencing content-hashed immutable static CSS/JS assets (BW-01)
const SHELL_HTML = `${HEAD}
<link rel="preload" href="${CSS_PATH}" as="style">
<link rel="preload" href="${JS_PATH}" as="script">
<link rel="stylesheet" href="${CSS_PATH}">
</head>
${BODY}
<script src="${JS_PATH}"></script>
</body>
</html>`;

const dashboardExports = {
  SHELL_HTML,
  HEAD,
  STYLES,
  BODY,
  SCRIPTS,
  CSS_HASH,
  JS_HASH,
  CSS_PATH,
  JS_PATH,
  STYLE_FILES,
  PARTIAL_FILES,
  SCRIPT_FILES
};

Object.defineProperty(dashboardExports, 'HTML', {
  enumerable: true,
  configurable: true,
  get: getFullHtml
});

module.exports = dashboardExports;
