'use strict';

const fs = require('node:fs');
const path = require('node:path');

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

const HEAD = readAsset('head.html');
const STYLES = STYLE_FILES.map(readAsset).join('\n');
const BODY = PARTIAL_FILES.map(readAsset).join('\n');
const SCRIPTS = SCRIPT_FILES.map(readAsset).join('\n');

const HTML = `${HEAD}
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

module.exports = {
  HTML,
  HEAD,
  STYLES,
  BODY,
  SCRIPTS,
  STYLE_FILES,
  PARTIAL_FILES,
  SCRIPT_FILES
};
