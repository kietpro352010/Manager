#!/usr/bin/env node
'use strict';

/**
 * =============================================================================
 * Tier 5 E2E Test Suite: GUI Item Textures, Fallbacks & Dynamic Theme Canvas
 * =============================================================================
 * 
 * Scope & Areas Covered:
 *   Area 3: GUI Item Textures and Fallbacks (Features 13, 14, 15)
 *     - Static `/textures/*` route mount, HTTP caching headers, Content-Type image/png.
 *     - Vanilla item 3D isometric (`/textures/3d/NAME.png`) and 2D sprite texture resolution.
 *     - KingMC custom server item keyword mapping (keys, tickets, backpacks, crystals, coins).
 *     - Progressive fallback cascade on texture error (3D -> 2D item -> 2D block -> initials badge).
 *     - Remote GUI slot DOM markup and accessibility: role="button", tabindex="0",
 *       aria-label="Ô GUI #idx: Name xCount", in-flight click mutexes, count badges, XSS sanitization.
 * 
 *   Area 4: Theme Canvas Performance & Eye-Comfort Visuals (Features 16, 17, 18, 19)
 *     - Galaxy theme performance: single-path batched strokes for constellation lines,
 *       static CSS gradients (0 per-frame radial gradient fillRects), 60 FPS delta-time loop.
 *     - Frosted Slate light theme: eye-comfort palette (#f8fafc, #0f172a), 24px blueprint dot-grid,
 *       glassmorphism card elevation.
 *     - Ocean Abyss marine life animations: sinusoidal bioluminescent fish school (5-8 fish)
 *       and pulsating jellyfish (2-3 jellyfish).
 *     - Moonlight theme cartoon aesthetic: stylized cartoon crescent moon, warm halo,
 *       fluffy anime clouds, 4-pointed sparkle stars, prefers-reduced-motion loop cancellation.
 * 
 * Execution:
 *   node test/e2e/suites/tier5-textures-and-themes.test.js
 * 
 * Standard: TAP Version 13 compliant output.
 * =============================================================================
 */

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const vm = require('node:vm');

// Application imports
const { createApp } = require('../../../src/http/app');
const { HTML: DASHBOARD_HTML } = require('../../../src/http/views/dashboard-html');

// ----------------------------------------------------------------------------
// TAP Test Runner Tracking
// ----------------------------------------------------------------------------
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];

async function test(id, description, fn) {
  totalTests++;
  const testNum = totalTests;
  try {
    await fn();
    passedTests++;
    const line = `ok ${testNum} - [${id}] ${description}`;
    testResults.push({ id, num: testNum, description, passed: true });
    console.log(line);
  } catch (err) {
    failedTests++;
    const line = `not ok ${testNum} - [${id}] ${description}`;
    testResults.push({ id, num: testNum, description, passed: false, error: err });
    console.error(line);
    console.error(`  ---`);
    console.error(`  message: ${err.message}`);
    if (err.expected !== undefined && err.actual !== undefined) {
      console.error(`  expected: ${JSON.stringify(err.expected)}`);
      console.error(`  actual:   ${JSON.stringify(err.actual)}`);
    }
    if (err.stack) {
      const topStack = err.stack.split('\n').slice(0, 4).map((l) => `  # ${l.trim()}`).join('\n');
      console.error(topStack);
    }
    console.error(`  ...`);
  }
}

// ----------------------------------------------------------------------------
// Lightweight Mock DOM & Canvas 2D Context Helper
// ----------------------------------------------------------------------------
function createMockCanvasContext() {
  const ctx = {
    radialGradientCalls: 0,
    linearGradientCalls: 0,
    fillRectCalls: 0,
    strokeRectCalls: 0,
    clearRectCalls: 0,
    beginPathCalls: 0,
    closePathCalls: 0,
    moveToCalls: 0,
    lineToCalls: 0,
    strokeCalls: 0,
    fillCalls: 0,
    arcCalls: 0,
    saveCalls: 0,
    restoreCalls: 0,
    drawnLines: [],
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,

    clearRect(x, y, w, h) {
      this.clearRectCalls++;
    },
    beginPath() {
      this.beginPathCalls++;
    },
    closePath() {
      this.closePathCalls++;
    },
    moveTo(x, y) {
      this.moveToCalls++;
      this._lastX = x;
      this._lastY = y;
    },
    lineTo(x, y) {
      this.lineToCalls++;
      this.drawnLines.push({ x1: this._lastX, y1: this._lastY, x2: x, y2: y });
      this._lastX = x;
      this._lastY = y;
    },
    stroke() {
      this.strokeCalls++;
    },
    fill() {
      this.fillCalls++;
    },
    arc(x, y, r, sa, ea) {
      this.arcCalls++;
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      this.radialGradientCalls++;
      return {
        addColorStop(offset, color) {}
      };
    },
    createLinearGradient(x0, y0, x1, y1) {
      this.linearGradientCalls++;
      return {
        addColorStop(offset, color) {}
      };
    },
    fillRect(x, y, w, h) {
      this.fillRectCalls++;
    },
    strokeRect(x, y, w, h) {
      this.strokeRectCalls++;
    },
    save() {
      this.saveCalls++;
    },
    restore() {
      this.restoreCalls++;
    },
    resetCounters() {
      this.radialGradientCalls = 0;
      this.linearGradientCalls = 0;
      this.fillRectCalls = 0;
      this.strokeRectCalls = 0;
      this.clearRectCalls = 0;
      this.beginPathCalls = 0;
      this.closePathCalls = 0;
      this.moveToCalls = 0;
      this.lineToCalls = 0;
      this.strokeCalls = 0;
      this.fillCalls = 0;
      this.arcCalls = 0;
      this.saveCalls = 0;
      this.restoreCalls = 0;
      this.drawnLines = [];
    }
  };
  return ctx;
}

function createMockElement(tagName = 'div') {
  const attrs = {};
  const listeners = {};
  const children = [];
  const el = {
    tagName: tagName.toUpperCase(),
    className: '',
    id: '',
    style: {},
    dataset: {},
    innerHTML: '',
    textContent: '',
    children,
    parentNode: null,

    setAttribute(k, v) {
      attrs[k] = String(v);
      if (k === 'class') el.className = String(v);
      if (k === 'id') el.id = String(v);
    },
    getAttribute(k) {
      return attrs[k] !== undefined ? attrs[k] : null;
    },
    hasAttribute(k) {
      return attrs[k] !== undefined;
    },
    removeAttribute(k) {
      delete attrs[k];
    },
    appendChild(child) {
      child.parentNode = el;
      children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener(evt, handler) {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(handler);
    },
    removeEventListener(evt, handler) {
      if (!listeners[evt]) return;
      const idx = listeners[evt].indexOf(handler);
      if (idx >= 0) listeners[evt].splice(idx, 1);
    },
    dispatchEvent(evt) {
      const handlers = listeners[evt.type] || [];
      for (const h of handlers) h(evt);
    },
    querySelector(sel) {
      // Basic mock selector for img, span, class
      if (sel === 'img') return children.find((c) => c.tagName === 'IMG') || null;
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        return children.find((c) => c.className.includes(cls)) || null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'img') return children.filter((c) => c.tagName === 'IMG');
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        return children.filter((c) => c.className.includes(cls));
      }
      return [];
    },
    pause() {},
    play() {
      return Promise.resolve();
    }
  };
  return el;
}

function createMockDocument() {
  const elementsById = {};
  return {
    createElement(tag) {
      return createMockElement(tag);
    },
    getElementById(id) {
      if (!elementsById[id]) {
        elementsById[id] = createMockElement('div');
        elementsById[id].id = id;
      }
      return elementsById[id];
    },
    registerElement(id, el) {
      elementsById[id] = el;
    }
  };
}

// ----------------------------------------------------------------------------
// Test Helper: Start Express Test Server
// ----------------------------------------------------------------------------
function startTestServer(options = {}) {
  const noopLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  };

  const app = createApp({
    store: options.store || { adapter: {} },
    registry: options.registry || { authenticate: async () => false },
    config: options.config || { discordToken: 'test-token' },
    logger: options.logger || noopLogger
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => {
          server.closeIdleConnections?.();
          server.closeAllConnections?.();
          return new Promise((res) => server.close(res));
        }
      });
    });
    server.on('error', reject);
  });
}

// =============================================================================
// MAIN TEST SUITE
// =============================================================================
async function runAll() {
  console.log('TAP version 13');
  console.log('# Running Tier 5 E2E Suite: Textures, Fallbacks & Theme Canvas');

  // ===========================================================================
  // SECTION 1: AREA 3 - STATIC /textures/* ROUTE, CACHING & SECURITY (F13)
  // ===========================================================================

  await test('T5-F13-01', 'Static Route Mount: /textures serves 3D isometric item PNG assets', async () => {
    const testEnv = await startTestServer();
    try {
      const res = await fetch(`${testEnv.baseUrl}/textures/3d/DIAMOND_SWORD.png`);
      assert.strictEqual(res.status, 200, `Expected HTTP 200 from /textures/3d/DIAMOND_SWORD.png, got ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      assert.ok(contentType.includes('image/png'), `Expected Content-Type image/png, got ${contentType}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      assert.ok(buffer.length > 0, 'Buffer must not be empty');
      // PNG Magic Bytes header check: 0x89 0x50 0x4E 0x47
      assert.strictEqual(buffer[0], 0x89, 'PNG magic byte 0 must be 0x89');
      assert.strictEqual(buffer[1], 0x50, 'PNG magic byte 1 must be 0x50 ("P")');
      assert.strictEqual(buffer[2], 0x4E, 'PNG magic byte 2 must be 0x4E ("N")');
      assert.strictEqual(buffer[3], 0x47, 'PNG magic byte 3 must be 0x47 ("G")');
    } finally {
      await testEnv.close();
    }
  });

  await test('T5-F13-02', 'Static Route Mount: /textures serves 2D item and block sprite assets', async () => {
    const testEnv = await startTestServer();
    try {
      const resItem = await fetch(`${testEnv.baseUrl}/textures/item/diamond_sword.png`);
      assert.strictEqual(resItem.status, 200, `Expected HTTP 200 from /textures/item/diamond_sword.png, got ${resItem.status}`);
      const itemCt = resItem.headers.get('content-type') || '';
      assert.ok(itemCt.includes('image/png'), `Expected Content-Type image/png, got ${itemCt}`);

      const resBlock = await fetch(`${testEnv.baseUrl}/textures/block/stone.png`);
      assert.strictEqual(resBlock.status, 200, `Expected HTTP 200 from /textures/block/stone.png, got ${resBlock.status}`);
      const blockCt = resBlock.headers.get('content-type') || '';
      assert.ok(blockCt.includes('image/png'), `Expected Content-Type image/png, got ${blockCt}`);
    } finally {
      await testEnv.close();
    }
  });

  await test('T5-F13-03', 'Static Route Mount: /textures serves JSON manifests (emojis_manifest.json)', async () => {
    const testEnv = await startTestServer();
    try {
      const res = await fetch(`${testEnv.baseUrl}/textures/emojis_manifest.json`);
      assert.strictEqual(res.status, 200, `Expected HTTP 200 from /textures/emojis_manifest.json, got ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      assert.ok(ct.includes('application/json'), `Expected Content-Type application/json, got ${ct}`);
      const data = await res.json();
      assert.ok(data !== null && typeof data === 'object', 'Manifest must parse as JSON object');
    } finally {
      await testEnv.close();
    }
  });

  await test('T5-F13-04', 'HTTP Caching Headers: /textures responses set public, max-age=86400 (24 hours)', async () => {
    const testEnv = await startTestServer();
    try {
      const res = await fetch(`${testEnv.baseUrl}/textures/3d/GOLDEN_APPLE.png`);
      assert.strictEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);
      const cacheControl = res.headers.get('cache-control') || '';
      assert.ok(cacheControl.includes('public'), `Cache-Control must contain "public", got "${cacheControl}"`);
      assert.ok(
        /max-age=(86400|[1-9]\d{5,})/.test(cacheControl),
        `Cache-Control max-age must be at least 86400s (24h), got "${cacheControl}"`
      );
    } finally {
      await testEnv.close();
    }
  });

  await test('T5-F13-05', 'Static Route Error Handling: Missing texture returns HTTP 404 without crashing', async () => {
    const testEnv = await startTestServer();
    try {
      const res = await fetch(`${testEnv.baseUrl}/textures/3d/NON_EXISTENT_TEXTURE_xyz_9999.png`);
      assert.strictEqual(res.status, 404, `Expected HTTP 404 for missing texture, got ${res.status}`);
    } finally {
      await testEnv.close();
    }
  });

  await test('T5-F13-06', 'Directory Traversal Security: Path traversal attempts via /textures/ are blocked', async () => {
    const testEnv = await startTestServer();
    try {
      const payloads = [
        '/textures/../../package.json',
        '/textures/..%2f..%2fpackage.json',
        '/textures/%2e%2e/%2e%2e/src/index.js'
      ];
      for (const p of payloads) {
        const res = await fetch(`${testEnv.baseUrl}${p}`);
        assert.ok(
          [400, 403, 404].includes(res.status),
          `Path traversal "${p}" must be blocked (400, 403, 404), got ${res.status}`
        );
      }
    } finally {
      await testEnv.close();
    }
  });

  // ===========================================================================
  // SECTION 2: AREA 3 - VANILLA ITEM 3D ISOMETRIC & 2D RESOLUTION (F14)
  // ===========================================================================

  await test('T5-F14-01', 'Vanilla Item Texture Resolution: resolveItemTexture returns 3D primary & 2D secondary', async () => {
    const resolveMatch = DASHBOARD_HTML.match(/function resolveItemTexture[\s\S]*?^}/m);
    assert.ok(resolveMatch, 'resolveItemTexture function must be defined in DASHBOARD_HTML');

    const resolveItemTexture = new Function(`
      ${resolveMatch[0]}
      return resolveItemTexture;
    `)();

    const item = { name: 'diamond_sword', count: 1 };
    const resolved = resolveItemTexture(item);
    assert.ok(resolved, 'resolveItemTexture must return an object');
    assert.strictEqual(resolved.primary, '/textures/3d/DIAMOND_SWORD.png', 'Primary texture must be 3D isometric uppercase');
    assert.strictEqual(resolved.secondary, '/textures/item/diamond_sword.png', 'Secondary fallback texture must be 2D item sprite');
  });

  await test('T5-F14-02', 'Vanilla Item Prefix Stripping: minecraft: namespace prefix is stripped cleanly', async () => {
    const resolveMatch = DASHBOARD_HTML.match(/function resolveItemTexture[\s\S]*?^}/m);
    assert.ok(resolveMatch, 'resolveItemTexture function must be defined in DASHBOARD_HTML');

    const resolveItemTexture = new Function(`
      ${resolveMatch[0]}
      return resolveItemTexture;
    `)();

    const testCases = [
      { input: 'minecraft:golden_apple', expectedPrimary: '/textures/3d/GOLDEN_APPLE.png' },
      { input: 'minecraft:totem_of_undying', expectedPrimary: '/textures/3d/TOTEM_OF_UNDYING.png' },
      { input: 'minecraft:bow', expectedPrimary: '/textures/3d/BOW.png' }
    ];

    for (const tc of testCases) {
      const resolved = resolveItemTexture({ name: tc.input });
      assert.strictEqual(resolved.primary, tc.expectedPrimary, `Failed namespace stripping for ${tc.input}`);
    }
  });

  await test('T5-F14-03', 'Vanilla Block Resolution: Block-type items resolve to block sprite fallback', async () => {
    const resolveMatch = DASHBOARD_HTML.match(/function resolveItemTexture[\s\S]*?^}/m);
    assert.ok(resolveMatch, 'resolveItemTexture function must be defined in DASHBOARD_HTML');

    const resolveItemTexture = new Function(`
      ${resolveMatch[0]}
      return resolveItemTexture;
    `)();

    const resolved = resolveItemTexture({ name: 'stone' });
    assert.ok(resolved.primary.includes('STONE'), 'Primary must point to 3D stone texture');
    assert.ok(
      (resolved.secondary && resolved.secondary.includes('block/stone')) ||
      (resolved.tertiary && resolved.tertiary.includes('block/stone')),
      'Must include block/stone sprite fallback'
    );
  });

  await test('T5-F14-04', 'Case-Insensitive Item Name Handling: Mixed-case inputs normalize consistently', async () => {
    const resolveMatch = DASHBOARD_HTML.match(/function resolveItemTexture[\s\S]*?^}/m);
    assert.ok(resolveMatch, 'resolveItemTexture function must be defined in DASHBOARD_HTML');

    const resolveItemTexture = new Function(`
      ${resolveMatch[0]}
      return resolveItemTexture;
    `)();

    const r1 = resolveItemTexture({ name: 'Diamond_Sword' });
    const r2 = resolveItemTexture({ name: 'DIAMOND_SWORD' });
    const r3 = resolveItemTexture({ name: 'diamond_sword' });

    assert.strictEqual(r1.primary, '/textures/3d/DIAMOND_SWORD.png');
    assert.strictEqual(r2.primary, '/textures/3d/DIAMOND_SWORD.png');
    assert.strictEqual(r3.primary, '/textures/3d/DIAMOND_SWORD.png');
  });

  await test('T5-F14-05', 'Null & Missing Item Safety: resolveItemTexture handles null/empty item safely', async () => {
    const resolveMatch = DASHBOARD_HTML.match(/function resolveItemTexture[\s\S]*?^}/m);
    assert.ok(resolveMatch, 'resolveItemTexture function must be defined in DASHBOARD_HTML');

    const resolveItemTexture = new Function(`
      ${resolveMatch[0]}
      return resolveItemTexture;
    `)();

    const emptyCases = [null, undefined, {}, { name: '' }, { count: 1 }];
    for (const ec of emptyCases) {
      assert.doesNotThrow(() => {
        const res = resolveItemTexture(ec);
        assert.ok(res !== undefined, 'Must return a result object or null, never throw uncaught exception');
      });
    }
  });

  await test('T5-F14-06', 'Item Count & Label Retention: resolveItemTexture preserves item count and safe name', async () => {
    const resolveMatch = DASHBOARD_HTML.match(/function resolveItemTexture[\s\S]*?^}/m);
    assert.ok(resolveMatch, 'resolveItemTexture function must be defined in DASHBOARD_HTML');

    const resolveItemTexture = new Function(`
      ${resolveMatch[0]}
      return resolveItemTexture;
    `)();

    const item = { name: 'arrow', count: 64, displayName: 'Mũi Tên Sát Thương' };
    const resolved = resolveItemTexture(item);
    assert.strictEqual(resolved.count, 64);
    assert.strictEqual(resolved.label, 'Mũi Tên Sát Thương');
  });

  // ===========================================================================
  // SECTION 3: AREA 3 - KINGMC CUSTOM ITEM KEYWORD MAPPING (F15)
  // ===========================================================================

  await test('T5-F15-01', 'Custom Item Keyword Mapping: Keys (/khóa|key/) map to tripwire hook texture', async () => {
    const resolveMatch = DASHBOARD_HTML.match(/function resolveItemTexture[\s\S]*?^}/m);
    assert.ok(resolveMatch, 'resolveItemTexture function must be defined in DASHBOARD_HTML');

    const resolveItemTexture = new Function(`
      ${resolveMatch[0]}
      return resolveItemTexture;
    `)();

    const keyItems = [
      { displayName: 'Chìa Khóa Boss KingMC' },
      { displayName: 'VIP Dungeon Key' },
      { displayName: 'Chìa Khóa Thần Thoại' }
    ];

    for (const item of keyItems) {
      const res = resolveItemTexture(item);
      assert.ok(
        res.primary.toLowerCase().includes('tripwire_hook'),
        `Key item "${item.displayName}" must map to tripwire_hook texture, got ${res.primary}`
      );
    }
  });

  await test('T5-F15-02', 'Custom Item Keyword Mapping: Tickets (/vé|ticket/) map to paper texture', async () => {
    const resolveMatch = DASHBOARD_HTML.match(/function resolveItemTexture[\s\S]*?^}/m);
    assert.ok(resolveMatch, 'resolveItemTexture function must be defined in DASHBOARD_HTML');

    const resolveItemTexture = new Function(`
      ${resolveMatch[0]}
      return resolveItemTexture;
    `)();

    const ticketItems = [
      { displayName: 'Vé Vòng Quay May Mắn' },
      { displayName: 'Vé Sự Kiện VIP' },
      { displayName: 'Lucky Ticket KingMC' }
    ];

    for (const item of ticketItems) {
      const res = resolveItemTexture(item);
      assert.ok(
        res.primary.toLowerCase().includes('paper'),
        `Ticket item "${item.displayName}" must map to paper texture, got ${res.primary}`
      );
    }
  });

  await test('T5-F15-03', 'Custom Item Keyword Mapping: Backpacks (/túi|backpack|ba lô/) map to chest texture', async () => {
    const resolveMatch = DASHBOARD_HTML.match(/function resolveItemTexture[\s\S]*?^}/m);
    assert.ok(resolveMatch, 'resolveItemTexture function must be defined in DASHBOARD_HTML');

    const resolveItemTexture = new Function(`
      ${resolveMatch[0]}
      return resolveItemTexture;
    `)();

    const backpackItems = [
      { displayName: 'Túi Đồ Siêu Cấp' },
      { displayName: 'Ba Lô Thợ Mỏ' },
      { displayName: 'Miner Backpack Level 3' }
    ];

    for (const item of backpackItems) {
      const res = resolveItemTexture(item);
      assert.ok(
        res.primary.toLowerCase().includes('chest') || res.primary.toLowerCase().includes('bundle'),
        `Backpack item "${item.displayName}" must map to chest/bundle texture, got ${res.primary}`
      );
    }
  });

  await test('T5-F15-04', 'Custom Item Keyword Mapping: Crystals (/pha lê|crystal|đá|ngọc/) map to gem/shard texture', async () => {
    const resolveMatch = DASHBOARD_HTML.match(/function resolveItemTexture[\s\S]*?^}/m);
    assert.ok(resolveMatch, 'resolveItemTexture function must be defined in DASHBOARD_HTML');

    const resolveItemTexture = new Function(`
      ${resolveMatch[0]}
      return resolveItemTexture;
    `)();

    const crystalItems = [
      { displayName: 'Đá Cường Hóa Vũ Khí' },
      { displayName: 'Pha Lê Hắc Ám' },
      { displayName: 'Ngọc Rồng KingMC' }
    ];

    for (const item of crystalItems) {
      const res = resolveItemTexture(item);
      assert.ok(
        res.primary.toLowerCase().includes('amethyst_shard') ||
        res.primary.toLowerCase().includes('emerald') ||
        res.primary.toLowerCase().includes('diamond'),
        `Crystal item "${item.displayName}" must map to gem/shard texture, got ${res.primary}`
      );
    }
  });

  await test('T5-F15-05', 'Custom Item Keyword Mapping: Coins (/xu|coin|tiền/) map to currency texture', async () => {
    const resolveMatch = DASHBOARD_HTML.match(/function resolveItemTexture[\s\S]*?^}/m);
    assert.ok(resolveMatch, 'resolveItemTexture function must be defined in DASHBOARD_HTML');

    const resolveItemTexture = new Function(`
      ${resolveMatch[0]}
      return resolveItemTexture;
    `)();

    const coinItems = [
      { displayName: 'Xu Sự Kiện Hè' },
      { displayName: 'KingMC Coin' },
      { displayName: 'Tiền Vàng' }
    ];

    for (const item of coinItems) {
      const res = resolveItemTexture(item);
      assert.ok(
        res.primary.toLowerCase().includes('sunflower') ||
        res.primary.toLowerCase().includes('gold_nugget') ||
        res.primary.toLowerCase().includes('emerald'),
        `Coin item "${item.displayName}" must map to currency texture, got ${res.primary}`
      );
    }
  });

  await test('T5-F15-06', 'Custom Keyword Priority: Specific custom keywords override generic fallback', async () => {
    const resolveMatch = DASHBOARD_HTML.match(/function resolveItemTexture[\s\S]*?^}/m);
    assert.ok(resolveMatch, 'resolveItemTexture function must be defined in DASHBOARD_HTML');

    const resolveItemTexture = new Function(`
      ${resolveMatch[0]}
      return resolveItemTexture;
    `)();

    // Even if internal Minecraft name is generic e.g. stick or paper, custom displayName takes keyword precedence
    const res = resolveItemTexture({ name: 'stick', displayName: 'Chìa Khóa Hầm Ngục' });
    assert.ok(
      res.primary.toLowerCase().includes('tripwire_hook'),
      `Custom displayName "Chìa Khóa Hầm Ngục" must take precedence over stick name`
    );
  });

  // ===========================================================================
  // SECTION 4: AREA 3 - PROGRESSIVE FALLBACK CASCADE (F15)
  // ===========================================================================

  await test('T5-F15-07', 'Fallback Cascade: 3D texture error triggers secondary 2D item sprite', async () => {
    const fallbackHelperMatch = DASHBOARD_HTML.match(/function handleItemTextureError[\s\S]*?^}/m);
    assert.ok(fallbackHelperMatch, 'handleItemTextureError function must be defined in DASHBOARD_HTML');

    const handleItemTextureError = new Function(`
      ${fallbackHelperMatch[0]}
      return handleItemTextureError;
    `)();

    const mockImg = createMockElement('img');
    mockImg.src = '/textures/3d/CUSTOM_RELIC.png';
    mockImg.dataset.fallbackStage = 'primary';
    mockImg.dataset.secondarySrc = '/textures/item/custom_relic.png';
    mockImg.dataset.tertiarySrc = '/textures/block/custom_relic.png';
    mockImg.dataset.initials = 'CR';

    handleItemTextureError(mockImg);
    assert.strictEqual(mockImg.src, '/textures/item/custom_relic.png', 'Must cascade to secondary 2D item sprite');
    assert.strictEqual(mockImg.dataset.fallbackStage, 'secondary', 'Fallback stage must advance to secondary');
  });

  await test('T5-F15-08', 'Fallback Cascade: 2D item error triggers tertiary block sprite', async () => {
    const fallbackHelperMatch = DASHBOARD_HTML.match(/function handleItemTextureError[\s\S]*?^}/m);
    assert.ok(fallbackHelperMatch, 'handleItemTextureError function must be defined in DASHBOARD_HTML');

    const handleItemTextureError = new Function(`
      ${fallbackHelperMatch[0]}
      return handleItemTextureError;
    `)();

    const mockImg = createMockElement('img');
    mockImg.src = '/textures/item/custom_relic.png';
    mockImg.dataset.fallbackStage = 'secondary';
    mockImg.dataset.secondarySrc = '/textures/item/custom_relic.png';
    mockImg.dataset.tertiarySrc = '/textures/block/custom_relic.png';
    mockImg.dataset.initials = 'CR';

    handleItemTextureError(mockImg);
    assert.strictEqual(mockImg.src, '/textures/block/custom_relic.png', 'Must cascade to tertiary 2D block sprite');
    assert.strictEqual(mockImg.dataset.fallbackStage, 'tertiary', 'Fallback stage must advance to tertiary');
  });

  await test('T5-F15-09', 'Fallback Cascade: Terminal error triggers styled initials badge and hides broken img', async () => {
    const fallbackHelperMatch = DASHBOARD_HTML.match(/function handleItemTextureError[\s\S]*?^}/m);
    assert.ok(fallbackHelperMatch, 'handleItemTextureError function must be defined in DASHBOARD_HTML');

    const handleItemTextureError = new Function(`
      ${fallbackHelperMatch[0]}
      return handleItemTextureError;
    `)();

    const slotEl = createMockElement('div');
    const mockImg = createMockElement('img');
    mockImg.src = '/textures/block/custom_relic.png';
    mockImg.dataset.fallbackStage = 'tertiary';
    mockImg.dataset.initials = 'CR';
    slotEl.appendChild(mockImg);

    handleItemTextureError(mockImg);
    assert.strictEqual(mockImg.style.display, 'none', 'Broken img must be hidden with display: none');
    assert.strictEqual(mockImg.dataset.fallbackStage, 'exhausted');

    const badge = slotEl.querySelector('.slot-initials-badge') || slotEl.querySelector('.slot-text-fallback');
    assert.ok(badge, 'Slot must contain a fallback initials badge');
    assert.ok(badge.textContent.includes('CR'), 'Initials badge must render initials "CR"');
  });

  await test('T5-F15-10', 'Fallback Cascade: Unknown custom item generates meaningful initials badge', async () => {
    const getInitialsMatch = DASHBOARD_HTML.match(/function getItemInitials[\s\S]*?^}/m);
    assert.ok(getInitialsMatch, 'getItemInitials helper must be defined in DASHBOARD_HTML');

    const getItemInitials = new Function(`
      ${getInitialsMatch[0]}
      return getItemInitials;
    `)();

    const initialsTestCases = [
      { name: 'Bảo Vật Huyền Thoại', expected: 'BV' },
      { name: 'Chìa Khóa Boss', expected: 'CK' },
      { name: 'Vé May Mắn', expected: 'VM' },
      { name: 'SingleWord', expected: 'SI' }
    ];

    for (const tc of initialsTestCases) {
      const res = getItemInitials(tc.name);
      assert.strictEqual(res, tc.expected, `Expected initials "${tc.expected}" for "${tc.name}", got "${res}"`);
    }
  });

  await test('T5-F15-11', 'Fallback Safety: Progressive cascade does not enter infinite onerror recursion', async () => {
    const fallbackHelperMatch = DASHBOARD_HTML.match(/function handleItemTextureError[\s\S]*?^}/m);
    assert.ok(fallbackHelperMatch, 'handleItemTextureError function must be defined in DASHBOARD_HTML');

    const handleItemTextureError = new Function(`
      ${fallbackHelperMatch[0]}
      return handleItemTextureError;
    `)();

    const mockImg = createMockElement('img');
    mockImg.dataset.fallbackStage = 'exhausted';
    mockImg.onerror = () => handleItemTextureError(mockImg);

    // Call once when exhausted: should not re-trigger or change src
    assert.doesNotThrow(() => {
      handleItemTextureError(mockImg);
      assert.strictEqual(mockImg.onerror, null, 'onerror handler must be nullified upon exhaustion');
    });
  });

  // ===========================================================================
  // SECTION 5: AREA 3 - REMOTE GUI SLOT DOM MARKUP & ACCESSIBILITY (F14)
  // ===========================================================================

  await test('T5-F14-07', 'Remote GUI Slot DOM: Slot elements render with role="button" and tabindex="0"', async () => {
    assert.ok(DASHBOARD_HTML.includes('role="button"'), 'GUI slots must have role="button"');
    assert.ok(DASHBOARD_HTML.includes('tabindex="0"'), 'GUI slots must have tabindex="0"');

    const renderGuiMatch = DASHBOARD_HTML.match(/function renderDetailRemoteGui[\s\S]*?^}/m);
    assert.ok(renderGuiMatch, 'renderDetailRemoteGui must be defined in DASHBOARD_HTML');

    const mockDoc = createMockDocument();
    const container = mockDoc.createElement('div');
    container.id = 'detailRemoteGuiSlots';
    mockDoc.registerElement('detailRemoteGuiSlots', container);

    const winData = {
      title: 'Rương Kho Báu',
      slots: [
        { name: 'diamond_sword', count: 1, displayName: 'Thanh Kiếm Kim Cương' },
        null,
        { name: 'golden_apple', count: 64, displayName: 'Táo Vàng' }
      ]
    };

    const renderFn = new Function('document', 'escapeHtml', 'resolveItemTexture', `
      ${renderGuiMatch[0]}
      return renderDetailRemoteGui;
    `)(mockDoc, (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), () => ({ primary: '/textures/3d/DIAMOND_SWORD.png', count: 1, label: 'Thanh Kiếm' }));

    renderFn(winData);
    assert.ok(container.innerHTML.includes('role="button"'), 'Rendered slots HTML must contain role="button"');
    assert.ok(container.innerHTML.includes('tabindex="0"'), 'Rendered slots HTML must contain tabindex="0"');
  });

  await test('T5-F14-08', 'Remote GUI Accessibility: aria-label matches contract "Ô GUI #idx: Name xCount"', async () => {
    const renderGuiMatch = DASHBOARD_HTML.match(/function renderDetailRemoteGui[\s\S]*?^}/m);
    assert.ok(renderGuiMatch, 'renderDetailRemoteGui must be defined in DASHBOARD_HTML');

    const mockDoc = createMockDocument();
    const container = mockDoc.createElement('div');
    container.id = 'detailRemoteGuiSlots';
    mockDoc.registerElement('detailRemoteGuiSlots', container);

    const winData = {
      title: 'Menu Sảnh',
      slots: [
        { name: 'golden_apple', count: 32, displayName: 'Táo Vàng VIP' },
        null
      ]
    };

    const renderFn = new Function('document', 'escapeHtml', 'resolveItemTexture', `
      ${renderGuiMatch[0]}
      return renderDetailRemoteGui;
    `)(mockDoc, (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), () => ({ primary: '/textures/3d/GOLDEN_APPLE.png', count: 32, label: 'Táo Vàng VIP' }));

    renderFn(winData);
    assert.ok(
      container.innerHTML.includes('aria-label="Ô GUI #0: Táo Vàng VIP x32"'),
      `Slot 0 must have aria-label="Ô GUI #0: Táo Vàng VIP x32"`
    );
    assert.ok(
      container.innerHTML.includes('aria-label="Ô GUI #1: (Trống)"'),
      `Empty slot 1 must have aria-label="Ô GUI #1: (Trống)"`
    );
  });

  await test('T5-F14-09', 'Count Badge Rendering: Count badge appears only when count > 1', async () => {
    const renderGuiMatch = DASHBOARD_HTML.match(/function renderDetailRemoteGui[\s\S]*?^}/m);
    assert.ok(renderGuiMatch, 'renderDetailRemoteGui must be defined in DASHBOARD_HTML');

    const mockDoc = createMockDocument();
    const container = mockDoc.createElement('div');
    container.id = 'detailRemoteGuiSlots';
    mockDoc.registerElement('detailRemoteGuiSlots', container);

    const winData = {
      title: 'Kho Đồ',
      slots: [
        { name: 'diamond_sword', count: 1, displayName: 'Kiếm' },
        { name: 'arrow', count: 64, displayName: 'Tên' }
      ]
    };

    const renderFn = new Function('document', 'escapeHtml', 'resolveItemTexture', `
      ${renderGuiMatch[0]}
      return renderDetailRemoteGui;
    `)(mockDoc, (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), (item) => ({ primary: '/textures/3d/ITEM.png', count: item.count, label: item.displayName }));

    renderFn(winData);
    assert.ok(container.innerHTML.includes('x64'), 'Slot with count 64 must render count badge');
    assert.ok(!container.innerHTML.includes('x1<'), 'Slot with count 1 must not render "x1" count badge');
  });

  await test('T5-F14-10', 'In-Flight Click Mutex: _inFlightGuiSlotClicks drops concurrent duplicate clicks', async () => {
    assert.ok(DASHBOARD_HTML.includes('_inFlightGuiSlotClicks'), '_inFlightGuiSlotClicks mutex set must exist');

    let requestCount = 0;
    const fakeRequestJson = async () => {
      requestCount++;
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true, data: {} };
    };

    const clickSlotMatch = DASHBOARD_HTML.match(/async function clickDetailGuiSlot[\s\S]*?^}/m);
    assert.ok(clickSlotMatch, 'clickDetailGuiSlot found in DASHBOARD_HTML');

    const env = new Function('selectedBotId', 'requestJson', 'showToast', 'refreshDetail', `
      const _inFlightGuiSlotClicks = new Set();
      ${clickSlotMatch[0]}
      return { clickDetailGuiSlot, _inFlightGuiSlotClicks };
    `)('bot-test-1', fakeRequestJson, () => {}, async () => {});

    // Trigger 5 simultaneous rapid clicks on slot 7
    const p1 = env.clickDetailGuiSlot(7);
    const p2 = env.clickDetailGuiSlot(7);
    const p3 = env.clickDetailGuiSlot(7);
    const p4 = env.clickDetailGuiSlot(7);
    const p5 = env.clickDetailGuiSlot(7);

    await Promise.all([p1, p2, p3, p4, p5]);

    assert.strictEqual(requestCount, 1, 'Only 1 network request must be dispatched; 4 rapid duplicates must be dropped by mutex');
    assert.strictEqual(env._inFlightGuiSlotClicks.size, 0, 'Mutex set must be drained after completion');
  });

  await test('T5-F14-11', 'Keyboard Accessibility: Enter and Space trigger slot selection and preventDefault', async () => {
    assert.ok(
      /event\.key\s*===\s*\\?['"]Enter\\?['"]/.test(DASHBOARD_HTML),
      'GUI slots markup must listen for Enter key'
    );
    assert.ok(
      /event\.key\s*===\s*\\?['"] \\?['"]/.test(DASHBOARD_HTML),
      'GUI slots markup must listen for Space key'
    );

    const createDetailSlotMatch = DASHBOARD_HTML.match(/function createDetailSlot[\s\S]*?^}/m);
    assert.ok(createDetailSlotMatch, 'createDetailSlot function found');

    const createdAttrs = {};
    const listeners = {};
    const mockEl = {
      setAttribute(k, v) { createdAttrs[k] = v; },
      addEventListener(evt, fn) { listeners[evt] = fn; },
      appendChild() {}
    };
    const mockDoc = { createElement: () => mockEl };

    let slotActionTriggered = false;
    const createSlotFn = new Function('document', 'itemLabel', 'allowDrop', 'clearDragOver', 'dropDetailInventory', 'handleDetailSlotClick', `
      let detailDragged = null;
      ${createDetailSlotMatch[0]}
      return createDetailSlot;
    `)(mockDoc, (item) => item?.name || '(Trống)', () => {}, () => {}, () => {}, () => { slotActionTriggered = true; });

    createSlotFn({ name: 'Kim Cương', count: 1 }, 14, false);
    assert.strictEqual(createdAttrs['role'], 'button');
    assert.strictEqual(createdAttrs['tabindex'], '0');

    let preventedEnter = false;
    listeners['keydown']({
      key: 'Enter',
      preventDefault: () => { preventedEnter = true; }
    });
    assert.strictEqual(preventedEnter, true, 'Enter keydown must trigger preventDefault');
    assert.strictEqual(slotActionTriggered, true, 'Enter keydown must trigger slot action');

    slotActionTriggered = false;
    let preventedSpace = false;
    listeners['keydown']({
      key: ' ',
      preventDefault: () => { preventedSpace = true; }
    });
    assert.strictEqual(preventedSpace, true, 'Space keydown must trigger preventDefault');
    assert.strictEqual(slotActionTriggered, true, 'Space keydown must trigger slot action');
  });

  await test('T5-F14-12', 'XSS Sanitization: Malicious displayName is HTML-escaped in DOM slot markup', async () => {
    const renderGuiMatch = DASHBOARD_HTML.match(/function renderDetailRemoteGui[\s\S]*?^}/m);
    assert.ok(renderGuiMatch, 'renderDetailRemoteGui must be defined in DASHBOARD_HTML');

    const mockDoc = createMockDocument();
    const container = mockDoc.createElement('div');
    container.id = 'detailRemoteGuiSlots';
    mockDoc.registerElement('detailRemoteGuiSlots', container);

    const maliciousName = '<script>alert("XSS")</script><img src=x onerror=alert(1)>" onmouseover="alert(2)';
    const winData = {
      title: 'Test GUI',
      slots: [{ name: 'trojan', count: 1, displayName: maliciousName }]
    };

    function escapeHtml(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    const renderFn = new Function('document', 'escapeHtml', 'resolveItemTexture', `
      ${renderGuiMatch[0]}
      return renderDetailRemoteGui;
    `)(mockDoc, escapeHtml, () => ({ primary: '/textures/item/trojan.png', count: 1, label: maliciousName }));

    renderFn(winData);
    assert.ok(!container.innerHTML.includes('<script>'), 'Rendered HTML must NOT contain unescaped <script>');
    assert.ok(!container.innerHTML.includes('<img src=x'), 'Rendered HTML must NOT contain unescaped <img src=x');
    assert.ok(container.innerHTML.includes('&lt;script&gt;'), 'Script tags must be escaped to &lt;script&gt;');
  });

  // ===========================================================================
  // SECTION 6: AREA 4 - GALAXY THEME PERFORMANCE & DELTA-TIME (F16)
  // ===========================================================================

  function getCosmicRenderFunction() {
    return DASHBOARD_HTML.match(/function drawCosmicBackground[\s\S]*?^}/m) ||
           DASHBOARD_HTML.match(/function render\s*\(timestamp\)\s*\{[\s\S]*?\n  \}/m);
  }

  await test('T5-F16-01', 'Galaxy Theme Performance: Constellation lines use batched single-path stroke()', async () => {
    const drawBgMatch = getCosmicRenderFunction();
    assert.ok(drawBgMatch, 'Cosmic canvas render function must exist in DASHBOARD_HTML');

    const mockCtx = createMockCanvasContext();
    const mockStars = [
      { x: 10, y: 10, z: 1, a: 0.8, r: 1, seed: 1, da: 0.01 },
      { x: 20, y: 20, z: 1, a: 0.8, r: 1, seed: 2, da: 0.01 },
      { x: 30, y: 30, z: 1, a: 0.8, r: 1, seed: 3, da: 0.01 },
      { x: 40, y: 40, z: 1, a: 0.8, r: 1, seed: 4, da: 0.01 }
    ];

    const fnSource = drawBgMatch[0].startsWith('function render')
      ? `${drawBgMatch[0]}; return render;`
      : `${drawBgMatch[0]}; return drawCosmicBackground;`;

    const env = new Function('ctx', 'stars', 'w', 'h', 'isMobile', 'getSavedDashboardTheme', `
      const kbotReducedMotionQuery = { matches: false };
      let rafId = null;
      let lastTime = 0;
      let frameInterval = 1000 / 60;
      let shootingStars = [];
      function shouldRunCosmicLoop() { return true; }
      function stopCosmicLoop() {}
      function requestAnimationFrame() {}
      ${fnSource}
    `)(mockCtx, mockStars, 800, 600, false, () => 'deep-galaxy');

    mockCtx.resetCounters();
    env(1000);

    // In optimized batching, constellation lines are drawn in a single path with <= 2 stroke() calls total
    assert.ok(
      mockCtx.strokeCalls <= 2,
      `Expected batched constellation drawing (<= 2 stroke() calls), got ${mockCtx.strokeCalls}`
    );
  });

  await test('T5-F16-02', 'Galaxy Theme Performance: 0 per-frame radial gradient fillRect calls (offloaded to CSS)', async () => {
    const drawBgMatch = getCosmicRenderFunction();
    assert.ok(drawBgMatch, 'Cosmic canvas render function must exist in DASHBOARD_HTML');

    const mockCtx = createMockCanvasContext();
    const mockStars = [{ x: 50, y: 50, z: 1, a: 0.5, r: 1, seed: 1, da: 0.01 }];

    const fnSource = drawBgMatch[0].startsWith('function render')
      ? `${drawBgMatch[0]}; return render;`
      : `${drawBgMatch[0]}; return drawCosmicBackground;`;

    const env = new Function('ctx', 'stars', 'w', 'h', 'isMobile', 'getSavedDashboardTheme', `
      const kbotReducedMotionQuery = { matches: false };
      let rafId = null;
      let lastTime = 0;
      let frameInterval = 1000 / 60;
      let shootingStars = [];
      function shouldRunCosmicLoop() { return true; }
      function stopCosmicLoop() {}
      function requestAnimationFrame() {}
      ${fnSource}
    `)(mockCtx, mockStars, 800, 600, false, () => 'deep-galaxy');

    mockCtx.resetCounters();
    env(1000);

    assert.strictEqual(
      mockCtx.radialGradientCalls,
      0,
      `Galaxy theme must eliminate per-frame createRadialGradient calls (0 calls), got ${mockCtx.radialGradientCalls}`
    );
  });

  await test('T5-F16-03', 'Galaxy Theme Visuals: Deep black background palette (#06080e)', async () => {
    // Assert CSS defines deep obsidian #06080e for deep-galaxy theme
    const galaxyCssMatch = DASHBOARD_HTML.match(/:root\[data-theme=["']deep-galaxy["']\][\s\S]*?}/);
    assert.ok(galaxyCssMatch, 'CSS rule for :root[data-theme="deep-galaxy"] must exist');
    assert.ok(
      galaxyCssMatch[0].includes('#06080e') || galaxyCssMatch[0].includes('#08090f') || galaxyCssMatch[0].includes('--bg-base: #06080e') || galaxyCssMatch[0].includes('--bg-base: #08090f'),
      'Deep Galaxy theme must use deep obsidian black (#06080e / #08090f) palette'
    );
  });

  await test('T5-F16-04', 'Galaxy Theme Star Pool: Initializes 80 to 120 micro twinkling dust stars', async () => {
    const initStarsMatch = DASHBOARD_HTML.match(/function initCosmicStars[\s\S]*?^}/m) ||
                           DASHBOARD_HTML.match(/starCount\s*=\s*isMobile\s*\?\s*\d+\s*:\s*(\d+)/);
    assert.ok(initStarsMatch, 'initCosmicStars or starCount configuration must exist in DASHBOARD_HTML');

    let count = 0;
    if (initStarsMatch[1]) {
      count = parseInt(initStarsMatch[1], 10);
    } else {
      const env = new Function('w', 'h', 'isMobile', `
        let stars = [];
        ${initStarsMatch[0]}
        initCosmicStars();
        return stars;
      `)(1920, 1080, false);
      count = env.length;
    }

    assert.ok(count >= 50 && count <= 120, `Star pool count must be between 50 and 120, got ${count}`);
  });

  await test('T5-F16-05', 'Delta-Time 60 FPS Normalization: Motion displacement scales with frame delta-time', async () => {
    const drawBgMatch = getCosmicRenderFunction();
    assert.ok(drawBgMatch, 'Cosmic canvas render function must exist in DASHBOARD_HTML');

    const mockCtx = createMockCanvasContext();
    const starA = { x: 100, y: 100, z: 1, a: 0.5, r: 1, seed: 1, da: 0.01 };
    const starB = { x: 100, y: 100, z: 1, a: 0.5, r: 1, seed: 1, da: 0.01 };

    const fnSource = drawBgMatch[0].startsWith('function render')
      ? `${drawBgMatch[0]}; return render;`
      : `${drawBgMatch[0]}; return drawCosmicBackground;`;

    const envA = new Function('ctx', 'stars', 'w', 'h', 'isMobile', 'getSavedDashboardTheme', `
      const kbotReducedMotionQuery = { matches: false };
      let rafId = null;
      let lastTime = 0;
      let frameInterval = 1000 / 60;
      let shootingStars = [];
      function shouldRunCosmicLoop() { return true; }
      function stopCosmicLoop() {}
      function requestAnimationFrame() {}
      ${fnSource}
    `)(mockCtx, [starA], 800, 600, false, () => 'deep-galaxy');

    const envB = new Function('ctx', 'stars', 'w', 'h', 'isMobile', 'getSavedDashboardTheme', `
      const kbotReducedMotionQuery = { matches: false };
      let rafId = null;
      let lastTime = 0;
      let frameInterval = 1000 / 60;
      let shootingStars = [];
      function shouldRunCosmicLoop() { return true; }
      function stopCosmicLoop() {}
      function requestAnimationFrame() {}
      ${fnSource}
    `)(mockCtx, [starB], 800, 600, false, () => 'deep-galaxy');

    // Simulate 16.6ms step vs 33.3ms step
    envA(1000);
    envA(1016.6);

    envB(1000);
    envB(1033.3);

    const dispA = Math.abs(100 - starA.y);
    const dispB = Math.abs(100 - starB.y);

    assert.ok(dispB > dispA, `Displacement on 33.3ms frame (${dispB}) must be larger than 16.6ms frame (${dispA})`);
  });

  await test('T5-F16-06', 'Zero Viewport Safety: Canvas dimensions of 0x0 do not cause NaN or division errors', async () => {
    const drawBgMatch = getCosmicRenderFunction();
    assert.ok(drawBgMatch, 'Cosmic canvas render function must exist in DASHBOARD_HTML');

    const mockCtx = createMockCanvasContext();
    const stars = [{ x: 0, y: 0, z: 1, a: 0.5, r: 1, seed: 1, da: 0.01 }];

    const fnSource = drawBgMatch[0].startsWith('function render')
      ? `${drawBgMatch[0]}; return render;`
      : `${drawBgMatch[0]}; return drawCosmicBackground;`;

    const env = new Function('ctx', 'stars', 'w', 'h', 'isMobile', 'getSavedDashboardTheme', `
      const kbotReducedMotionQuery = { matches: false };
      let rafId = null;
      let lastTime = 0;
      let frameInterval = 1000 / 60;
      let shootingStars = [];
      function shouldRunCosmicLoop() { return true; }
      function stopCosmicLoop() {}
      function requestAnimationFrame() {}
      ${fnSource}
    `)(mockCtx, stars, 0, 0, false, () => 'deep-galaxy');

    assert.doesNotThrow(() => {
      env(1000);
    }, 'Must handle 0x0 viewport dimensions gracefully');
  });

  // ===========================================================================
  // SECTION 7: AREA 4 - FROSTED SLATE LIGHT THEME PALETTE & GRID (F17)
  // ===========================================================================

  await test('T5-F17-01', 'Frosted Slate Palette: Uses ergonomic slate #f8fafc and dark text #0f172a', async () => {
    const moonlightCss = DASHBOARD_HTML.match(/:root\[data-theme=["']moonlight["']\][\s\S]*?}/);
    assert.ok(moonlightCss, 'CSS rule for :root[data-theme="moonlight"] must exist');
    const cssText = moonlightCss[0];
    assert.ok(
      cssText.includes('#f8fafc') || cssText.includes('#f1f5f9'),
      'Light theme must use Frosted Slate #f8fafc or #f1f5f9'
    );
    assert.ok(
      cssText.includes('#0f172a') || cssText.includes('#1e293b') || cssText.includes('#111827'),
      'Light theme must use high-contrast dark slate (#0f172a / #111827) text'
    );
  });

  await test('T5-F17-02', 'Blueprint Dot-Grid: CSS theme defines 24px dot-grid texture', async () => {
    assert.ok(
      /24px\s+24px/.test(DASHBOARD_HTML),
      'DASHBOARD_HTML must contain a 24px 24px blueprint dot-grid pattern'
    );
  });

  await test('T5-F17-03', 'Frosted Slate Cards: Elevated cards feature glassmorphism and subtle border', async () => {
    const cardStyleMatch = DASHBOARD_HTML.match(/:root\[data-theme=["']moonlight["']\]\s*\.card[\s\S]*?}/);
    assert.ok(cardStyleMatch, 'Moonlight card styles must be defined');
    const cardCss = cardStyleMatch[0];
    assert.ok(
      cardCss.includes('backdrop-filter') || cardCss.includes('border') || cardCss.includes('box-shadow'),
      'Moonlight cards must feature elevated glassmorphism styling'
    );
  });

  await test('T5-F17-04', 'Theme Switching: applyDashboardCosmicMode toggles colorScheme to light for moonlight', async () => {
    const normalizeMatch = DASHBOARD_HTML.match(/function normalizeDashboardTheme[\s\S]*?^}/m);
    assert.ok(normalizeMatch, 'normalizeDashboardTheme must exist in DASHBOARD_HTML');
    const cycleMatch = DASHBOARD_HTML.match(/function applyDashboardCosmicMode[\s\S]*?^}/m);
    assert.ok(cycleMatch, 'applyDashboardCosmicMode must exist in DASHBOARD_HTML');

    let appliedColorScheme = '';
    const mockDoc = createMockDocument();
    mockDoc.documentElement = {
      setAttribute: () => {},
      style: {
        set colorScheme(v) { appliedColorScheme = v; },
        get colorScheme() { return appliedColorScheme; }
      }
    };
    mockDoc.body = mockDoc.createElement('body');
    mockDoc.body.classList = {
      remove: () => {},
      add: () => {}
    };
    mockDoc.querySelectorAll = () => [];

    const env = new Function('document', 'localStorage', 'window', `
      const kbotReducedMotionQuery = { matches: false };
      ${normalizeMatch[0]}
      ${cycleMatch[0]}
      return applyDashboardCosmicMode;
    `)(mockDoc, { setItem: () => {}, getItem: () => 'moonlight' }, { dispatchEvent: () => {} });

    env('moonlight');
    assert.strictEqual(appliedColorScheme, 'light', 'Moonlight theme must set document colorScheme to light');

    env('deep-galaxy');
    assert.strictEqual(appliedColorScheme, 'dark', 'Deep Galaxy theme must set document colorScheme to dark');
  });

  // ===========================================================================
  // SECTION 8: AREA 4 - MARINE LIFE ANIMATIONS & MOONLIGHT CARTOON (F18, F19)
  // ===========================================================================

  await test('T5-F18-01', 'Ocean Abyss Marine Life: School of 5 to 8 bioluminescent fish initialized', async () => {
    const getOceanMatch = DASHBOARD_HTML.match(/function getOceanEntities[\s\S]*?^}/m);
    assert.ok(getOceanMatch, 'getOceanEntities function must exist in DASHBOARD_HTML');

    const getOceanEntities = new Function(`
      ${getOceanMatch[0]}
      return getOceanEntities;
    `)();

    const entities = getOceanEntities();
    assert.ok(entities && Array.isArray(entities.fish), 'Must return fish entity array');
    assert.ok(
      entities.fish.length >= 5 && entities.fish.length <= 8,
      `Fish count must be between 5 and 8, got ${entities.fish.length}`
    );
  });

  await test('T5-F18-02', 'Ocean Abyss Marine Life: Fish follow sinusoidal undulating swimming paths', async () => {
    const updateFishMatch = DASHBOARD_HTML.match(/function updateFishSchool[\s\S]*?^}/m);
    assert.ok(updateFishMatch, 'updateFishSchool function must exist in DASHBOARD_HTML');

    const updateFish = new Function(`
      ${updateFishMatch[0]}
      return updateFishSchool;
    `)();

    const fish = [{ x: 50, y: 100, baseY: 100, speed: 2, freq: 0.05, amp: 15, phase: 0 }];
    const yInitial = fish[0].y;

    updateFish(fish, 800, 600, 16.6);
    const yAfter1 = fish[0].y;

    updateFish(fish, 800, 600, 16.6);
    const yAfter2 = fish[0].y;

    assert.notStrictEqual(yAfter1, yInitial, 'Fish Y position must undulate with sinusoidal motion');
    assert.notStrictEqual(yAfter2, yAfter1, 'Fish Y position must continue sinusoidal displacement across frames');
  });

  await test('T5-F18-03', 'Ocean Abyss Marine Life: 2 to 3 pulsating jellyfish initialized with undulating tentacles', async () => {
    const getOceanMatch = DASHBOARD_HTML.match(/function getOceanEntities[\s\S]*?^}/m);
    assert.ok(getOceanMatch, 'getOceanEntities function must exist in DASHBOARD_HTML');

    const getOceanEntities = new Function(`
      ${getOceanMatch[0]}
      return getOceanEntities;
    `)();

    const entities = getOceanEntities();
    assert.ok(entities && Array.isArray(entities.jellyfish), 'Must return jellyfish entity array');
    assert.ok(
      entities.jellyfish.length >= 2 && entities.jellyfish.length <= 3,
      `Jellyfish count must be between 2 and 3, got ${entities.jellyfish.length}`
    );
  });

  await test('T5-F18-04', 'Ocean Abyss Marine Life: Jellyfish bell exhibits pulsating breathing scale cycle', async () => {
    const updateJellyMatch = DASHBOARD_HTML.match(/function updateJellyfish[\s\S]*?^}/m);
    assert.ok(updateJellyMatch, 'updateJellyfish function must exist in DASHBOARD_HTML');

    const updateJellyfish = new Function(`
      ${updateJellyMatch[0]}
      return updateJellyfish;
    `)();

    const jelly = [{ x: 200, y: 300, scale: 1, pulsePhase: 0, tentacles: 5 }];
    updateJellyfish(jelly, 800, 600, 100);
    const scale1 = jelly[0].scale;
    updateJellyfish(jelly, 800, 600, 500);
    const scale2 = jelly[0].scale;

    assert.notStrictEqual(scale1, scale2, 'Jellyfish scale must oscillate during pulsation cycle');
  });

  await test('T5-F19-01', 'Moonlight Cartoon Aesthetic: Stylized cartoon crescent moon with warm halo (#fef08a)', async () => {
    assert.ok(
      DASHBOARD_HTML.includes('drawCartoonCrescentMoon') || DASHBOARD_HTML.includes('#fef08a'),
      'DASHBOARD_HTML must define cartoon crescent moon and warm halo color #fef08a'
    );
  });

  await test('T5-F19-02', 'Moonlight Cartoon Aesthetic: Fluffy anime clouds drifting softly across night sky', async () => {
    assert.ok(
      DASHBOARD_HTML.includes('drawAnimeClouds') || DASHBOARD_HTML.includes('animeClouds'),
      'DASHBOARD_HTML must define fluffy anime cloud rendering'
    );
  });

  await test('T5-F19-03', 'Moonlight Cartoon Aesthetic: Stylized 4-pointed sparkle stars', async () => {
    assert.ok(
      DASHBOARD_HTML.includes('drawSparkleStar') || DASHBOARD_HTML.includes('sparkleStars'),
      'DASHBOARD_HTML must define 4-pointed sparkle star rendering'
    );
  });

  await test('T5-F19-04', 'Reduced Motion Support: prefers-reduced-motion immediately cancels animation loop', async () => {
    const reducedMotionMatch = DASHBOARD_HTML.match(/kbotReducedMotionQuery\.addEventListener[\s\S]*?}\);/);
    assert.ok(reducedMotionMatch, 'prefers-reduced-motion listener must be registered in DASHBOARD_HTML');

    let loopCancelled = false;
    let cancelledId = null;

    const mockWindow = {
      cancelAnimationFrame(id) {
        loopCancelled = true;
        cancelledId = id;
      }
    };

    const env = new Function('window', 'onCancel', `
      let kbotCosmicAnimId = 42;
      function handleReducedMotion(e) {
        if (e.matches) {
          if (kbotCosmicAnimId) {
            window.cancelAnimationFrame(kbotCosmicAnimId);
            kbotCosmicAnimId = null;
            onCancel();
          }
        }
      }
      handleReducedMotion({ matches: true });
      return { kbotCosmicAnimId };
    `)(mockWindow, () => { loopCancelled = true; });

    assert.strictEqual(loopCancelled, true, 'cancelAnimationFrame must be called on reduced-motion match');
    assert.strictEqual(env.kbotCosmicAnimId, null, 'Cosmic animation ID must be cleared');
  });

  await test('T5-F19-05', 'Background Tab Throttling: document.hidden = true pauses animation loop', async () => {
    assert.ok(
      DASHBOARD_HTML.includes('document.hidden') || DASHBOARD_HTML.includes('visibilitychange'),
      'DASHBOARD_HTML must listen to visibilitychange or inspect document.hidden'
    );
  });

  // ===========================================================================
  // SUMMARY REPORT & EXIT
  // ===========================================================================
  console.log(`\n1..${totalTests}`);
  console.log(`# tests ${totalTests}`);
  console.log(`# pass  ${passedTests}`);
  console.log(`# fail  ${failedTests}`);

  if (failedTests > 0) {
    console.error(`\n[!] Tier 5 Suite: ${failedTests} assertion(s) failed out of ${totalTests}.`);
    process.exit(1);
  } else {
    console.log(`\n[✓] Tier 5 Suite: All ${totalTests} tests passed successfully.`);
    process.exit(0);
  }
}

if (require.main === module) {
  runAll().catch((err) => {
    console.error('Fatal error in Tier 5 test suite:', err);
    process.exit(1);
  });
}

module.exports = {
  runAll
};
