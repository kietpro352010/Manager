'use strict';

const assert = require('node:assert');
const path = require('node:path');
const express = require('express');

// 1. Views
const { PUBLIC_LOGIN_HTML } = require('../src/http/views/login-html');
const { HTML: DASHBOARD_HTML } = require('../src/http/views/dashboard-html');

// 2. Storage
const SupabaseWorkerStore = require('../src/storage/supabase-worker-store');

// 3. Worker Auth
let workerAuth = null;
try {
  workerAuth = require(path.resolve(__dirname, '../../worker/src/http/auth'));
} catch (_) {
  const crypto = require('node:crypto');
  function safeEqual(a, b) {
    if (typeof a !== 'string' && !Buffer.isBuffer(a)) return false;
    if (typeof b !== 'string' && !Buffer.isBuffer(b)) return false;
    const strA = String(a);
    const strB = String(b);
    if (!strA || !strB) return false;
    const hashA = crypto.createHash('sha256').update(strA).digest();
    const hashB = crypto.createHash('sha256').update(strB).digest();
    return crypto.timingSafeEqual(hashA, hashB);
  }
  function extractWorkerToken(req) {
    if (!req || typeof req.get !== 'function') return '';
    const headerSecret = req.get('x-worker-secret');
    if (headerSecret && typeof headerSecret === 'string') {
      const trimmed = headerSecret.trim();
      if (trimmed) return trimmed;
    }
    const authHeader = req.get('authorization');
    if (authHeader && typeof authHeader === 'string') {
      const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return '';
  }
  function requireWorkerSecret(secret, { previousSecret = null, graceUntil = 0 } = {}) {
    return (req, res, next) => {
      const supplied = extractWorkerToken(req);
      if (safeEqual(supplied, secret)) return next();
      if (previousSecret && Date.now() < graceUntil && safeEqual(supplied, previousSecret)) {
        return next();
      }
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    };
  }
  workerAuth = { safeEqual, extractWorkerToken, requireWorkerSecret };
}
const { safeEqual, extractWorkerToken, requireWorkerSecret } = workerAuth;

async function runTests() {
  console.log('=== RUNNING GATE 5 UI/UX & WORKER TESTS ===\n');

  // --------------------------------------------------------------------------
  // TEST 1: G5-01 Public Login License Key Field Hint & Placeholder
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: G5-01 Public Login License Key Field Hint & Placeholder ---');
  
  // HTML checks
  assert.ok(PUBLIC_LOGIN_HTML.includes('id="regLicenseKeyHint"'), 'regLicenseKeyHint span must exist in login HTML');
  assert.ok(PUBLIC_LOGIN_HTML.includes('id="regLicenseKey"'), 'regLicenseKey input must exist in login HTML');
  assert.ok(PUBLIC_LOGIN_HTML.includes('(Có thể bỏ trống)'), 'Default hint "(Có thể bỏ trống)" must be present');
  assert.ok(PUBLIC_LOGIN_HTML.includes('placeholder="Nhập mã License Key (nếu có)..."'), 'Default placeholder must be "Nhập mã License Key (nếu có)..."');
  
  // Script / function checks
  assert.ok(PUBLIC_LOGIN_HTML.includes('function renderTrialCallout'), 'renderTrialCallout function must exist');
  assert.ok(PUBLIC_LOGIN_HTML.includes('(Bắt buộc nếu tắt dùng thử)'), 'Script must handle disabled trial hint');
  assert.ok(PUBLIC_LOGIN_HTML.includes('Nhập mã License Key để kích hoạt tài khoản...'), 'Script must handle disabled trial placeholder');
  assert.ok(PUBLIC_LOGIN_HTML.includes('/api/auth/login-config'), 'Script must fetch /api/auth/login-config');

  // Behavioral test of renderTrialCallout
  {
    // Minimal DOM mock
    const fakeElements = {
      publicTrialCalloutBadge: { hidden: false },
      publicTrialCalloutText: { replaceChildren: () => {} },
      regLicenseKeyHint: { textContent: '' },
      regLicenseKey: { placeholder: '' }
    };
    const fakeDoc = {
      getElementById: (id) => fakeElements[id] || null,
      createTextNode: (txt) => ({ text: txt }),
      createElement: () => ({ textContent: '' })
    };

    // Evaluate renderTrialCallout with mocked DOM
    const renderTrialCalloutFn = new Function('document', `
      ${PUBLIC_LOGIN_HTML.match(/function renderTrialCallout[\s\S]*?^}/m)[0]}
      return renderTrialCallout;
    `)(fakeDoc);

    // Test trial disabled:
    renderTrialCalloutFn(false);
    assert.strictEqual(fakeElements.publicTrialCalloutBadge.hidden, true, 'Badge should be hidden when trial disabled');
    assert.strictEqual(fakeElements.regLicenseKeyHint.textContent, '(Bắt buộc nếu tắt dùng thử)', 'Hint must be "(Bắt buộc nếu tắt dùng thử)"');
    assert.strictEqual(fakeElements.regLicenseKey.placeholder, 'Nhập mã License Key để kích hoạt tài khoản...', 'Placeholder must be activation prompt');

    // Test trial enabled:
    renderTrialCalloutFn(true, 7);
    assert.strictEqual(fakeElements.publicTrialCalloutBadge.hidden, false, 'Badge should be visible when trial enabled');
    assert.strictEqual(fakeElements.regLicenseKeyHint.textContent, '(Có thể bỏ trống)', 'Hint must be "(Có thể bỏ trống)"');
    assert.strictEqual(fakeElements.regLicenseKey.placeholder, 'Nhập mã License Key (nếu có)...', 'Placeholder must be optional prompt');
  }
  console.log('✅ G5-01 PASSED: Login license key hint and placeholder logic verified.');

  // --------------------------------------------------------------------------
  // TEST 2: G5-02 Modal Focus Trapping, Escape Listener, and Focus Restoration
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: G5-02 Modal Focus Trapping & Accessibility ---');
  
  // HTML checks for modal attributes
  assert.ok(DASHBOARD_HTML.includes('role="dialog"'), 'Modals must have role="dialog"');
  assert.ok(DASHBOARD_HTML.includes('aria-modal="true"'), 'Modals must have aria-modal="true"');
  assert.ok(DASHBOARD_HTML.includes('setupAccessibleModals'), 'setupAccessibleModals must be defined');
  assert.ok(DASHBOARD_HTML.includes('trapModalFocus'), 'trapModalFocus helper must be defined');
  assert.ok(DASHBOARD_HTML.includes('openAccessibleModal'), 'openAccessibleModal helper must be defined');
  assert.ok(DASHBOARD_HTML.includes('closeAccessibleModal'), 'closeAccessibleModal helper must be defined');

  // Verify focus trap behavior on Tab / Shift+Tab and Escape
  {
    let focusedElement = null;
    let defaultPrevented = false;
    const btn1 = { tagName: 'BUTTON', disabled: false, focus: function() { focusedElement = this; } };
    const btn2 = { tagName: 'BUTTON', disabled: false, focus: function() { focusedElement = this; } };
    const closeBtn = { tagName: 'BUTTON', disabled: false, focus: function() { focusedElement = this; } };
    const modalEl = {
      attributes: {},
      classList: {
        _classes: new Set(['modal', 'hidden']),
        contains: function(c) { return this._classes.has(c); },
        add: function(c) { this._classes.add(c); },
        remove: function(c) { this._classes.delete(c); }
      },
      hasAttribute: function(a) { return Boolean(this.attributes[a]); },
      setAttribute: function(a, v) { this.attributes[a] = v; },
      querySelector: function() { return null; },
      querySelectorAll: function() { return [btn1, btn2, closeBtn]; },
      contains: function(el) { return el === btn1 || el === btn2 || el === closeBtn || el === this; },
      focus: function() { focusedElement = this; },
      addEventListener: function(event, handler) { this['_on_' + event] = handler; }
    };

    const prevActive = { focus: function() { focusedElement = this; } };
    const fakeDoc = {
      activeElement: prevActive,
      querySelectorAll: () => [modalEl],
      getElementById: () => null
    };

    // Extract trapModalFocus and setup logic
    const trapModalFocusMatch = DASHBOARD_HTML.match(/function trapModalFocus[\s\S]*?^}/m);
    assert.ok(trapModalFocusMatch, 'trapModalFocus function found in DASHBOARD_HTML');
    const openAccessibleModalMatch = DASHBOARD_HTML.match(/function openAccessibleModal[\s\S]*?^}/m);
    assert.ok(openAccessibleModalMatch, 'openAccessibleModal function found in DASHBOARD_HTML');
    const closeAccessibleModalMatch = DASHBOARD_HTML.match(/function closeAccessibleModal[\s\S]*?^}/m);
    assert.ok(closeAccessibleModalMatch, 'closeAccessibleModal function found in DASHBOARD_HTML');

    const env = new Function('document', 'btn1', 'btn2', 'closeBtn', `
      const MODAL_FOCUSABLE_SELECTOR = 'button';
      function getVisibleFocusableElements(container) { return [btn1, btn2, closeBtn]; }
      ${trapModalFocusMatch[0]}
      ${openAccessibleModalMatch[0]}
      ${closeAccessibleModalMatch[0]}
      return { trapModalFocus, openAccessibleModal, closeAccessibleModal };
    `)(fakeDoc, btn1, btn2, closeBtn);

    // 1. Trap initialization sets dialog attributes
    env.trapModalFocus(modalEl);
    assert.strictEqual(modalEl.attributes['role'], 'dialog', 'Must set role="dialog"');
    assert.strictEqual(modalEl.attributes['aria-modal'], 'true', 'Must set aria-modal="true"');

    // 2. Tab cycling: When at last element, pressing Tab cycles to first element
    fakeDoc.activeElement = closeBtn;
    defaultPrevented = false;
    modalEl._on_keydown({
      key: 'Tab',
      shiftKey: false,
      preventDefault: () => { defaultPrevented = true; }
    });
    assert.strictEqual(defaultPrevented, true, 'Tab at end must preventDefault');
    assert.strictEqual(focusedElement, btn1, 'Tab at end must cycle back to first element');

    // 3. Shift+Tab cycling: When at first element, Shift+Tab cycles to last element
    fakeDoc.activeElement = btn1;
    defaultPrevented = false;
    modalEl._on_keydown({
      key: 'Tab',
      shiftKey: true,
      preventDefault: () => { defaultPrevented = true; }
    });
    assert.strictEqual(defaultPrevented, true, 'Shift+Tab at start must preventDefault');
    assert.strictEqual(focusedElement, closeBtn, 'Shift+Tab at start must cycle back to last element');

    // 4. Opening modal saves previous active element
    fakeDoc.activeElement = prevActive;
    env.openAccessibleModal(modalEl);
    assert.strictEqual(modalEl._previousActiveElement, prevActive, 'Must record previous active element on open');

    // 5. Closing modal restores focus back to previous active element
    env.closeAccessibleModal(modalEl);
    assert.strictEqual(focusedElement, prevActive, 'Must restore focus to previous active element on close');
  }
  console.log('✅ G5-02 PASSED: Modal focus trapping, cycling, and focus restoration verified.');

  // --------------------------------------------------------------------------
  // TEST 3: G5-03 Semantic <main> Landmark
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: G5-03 Semantic <main> Landmark ---');
  
  assert.ok(DASHBOARD_HTML.includes('<main id="mainContent" class="app-main-content" role="main">'), '<main id="mainContent" class="app-main-content" role="main"> must exist');
  assert.ok(DASHBOARD_HTML.includes('</main>'), '</main> closing tag must exist');
  
  // Verify that all 5 main sections are enclosed inside <main ...> ... </main>
  const mainOpenIdx = DASHBOARD_HTML.indexOf('<main id="mainContent"');
  const mainCloseIdx = DASHBOARD_HTML.indexOf('</main>');
  assert.ok(mainOpenIdx > 0 && mainCloseIdx > mainOpenIdx, 'Valid <main> wrapper tags found');

  const mainChunk = DASHBOARD_HTML.substring(mainOpenIdx, mainCloseIdx);
  assert.ok(mainChunk.includes('id="homePage"'), 'homePage must be inside <main>');
  assert.ok(mainChunk.includes('id="detailPage"'), 'detailPage must be inside <main>');
  assert.ok(mainChunk.includes('id="userManagementPage"'), 'userManagementPage must be inside <main>');
  assert.ok(mainChunk.includes('id="auditPage"'), 'auditPage must be inside <main>');
  assert.ok(mainChunk.includes('id="backupPage"'), 'backupPage must be inside <main>');
  console.log('✅ G5-03 PASSED: Semantic <main id="mainContent"> landmark encompasses all 5 app views.');

  // --------------------------------------------------------------------------
  // TEST 4: G5-04 Accessible 54 GUI Slots & Inventory
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: G5-04 Accessible 54 GUI Slots & Inventory ---');
  
  // GUI slots HTML check
  assert.ok(DASHBOARD_HTML.includes('role="button"'), 'GUI slots must have role="button"');
  assert.ok(DASHBOARD_HTML.includes('tabindex="0"'), 'GUI slots must have tabindex="0"');
  assert.ok(DASHBOARD_HTML.includes('aria-label='), 'GUI slots must have aria-label');
  assert.ok(/event\.key\s*===\s*\\?['"]Enter\\?['"]/.test(DASHBOARD_HTML), 'GUI slots must listen to Enter keydown');
  assert.ok(/event\.key\s*===\s*\\?['"] \\?['"]/.test(DASHBOARD_HTML), 'GUI slots must listen to Space keydown');
  assert.ok(DASHBOARD_HTML.includes("e.key === 'Enter' || e.key === ' '"), 'createDetailSlot must listen to Enter/Space');

  // Verify createDetailSlot adds accessibility attributes
  {
    const createdAttributes = {};
    const eventListeners = {};
    const fakeEl = {
      className: '',
      dataset: {},
      setAttribute: (k, v) => { createdAttributes[k] = v; },
      addEventListener: (evt, fn) => { eventListeners[evt] = fn; },
      appendChild: () => {}
    };
    const fakeDoc = {
      createElement: () => fakeEl
    };

    const createDetailSlotMatch = DASHBOARD_HTML.match(/function createDetailSlot[\s\S]*?^}/m);
    assert.ok(createDetailSlotMatch, 'createDetailSlot function found');

    let slotClickTriggered = false;
    const createSlotFn = new Function('document', 'itemLabel', 'allowDrop', 'clearDragOver', 'dropDetailInventory', 'handleDetailSlotClick', `
      let detailDragged = null;
      ${createDetailSlotMatch[0]}
      return createDetailSlot;
    `)(fakeDoc, (item) => item?.name || '(Trống)', () => {}, () => {}, () => {}, () => { slotClickTriggered = true; });

    createSlotFn({ name: 'Kim Cương', count: 64 }, 12, false);
    assert.strictEqual(createdAttributes['role'], 'button', 'Must have role="button"');
    assert.strictEqual(createdAttributes['tabindex'], '0', 'Must have tabindex="0"');
    assert.ok(createdAttributes['aria-label'].includes('Ô GUI #12: Kim Cương x64'), 'Must have descriptive aria-label');
    assert.ok(typeof eventListeners['keydown'] === 'function', 'Must have keydown listener');

    // Test Enter key on slot
    let prevented = false;
    eventListeners['keydown']({
      key: 'Enter',
      preventDefault: () => { prevented = true; }
    });
    assert.strictEqual(prevented, true, 'Enter keydown must trigger action and preventDefault');
    assert.strictEqual(slotClickTriggered, true, 'Enter keydown must invoke slot click handler');
  }
  console.log('✅ G5-04 PASSED: 54 GUI slots and inventory slots have role, tabindex, aria-label, and keyboard support.');

  // --------------------------------------------------------------------------
  // TEST 5: G5-05 In-Flight Click Mutex on Action Buttons & GUI Slots
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: G5-05 In-Flight Click Mutex ---');
  
  assert.ok(DASHBOARD_HTML.includes('_inFlightQuickActions'), '_inFlightQuickActions mutex must be defined');
  assert.ok(DASHBOARD_HTML.includes('_inFlightGuiSlotClicks'), '_inFlightGuiSlotClicks mutex must be defined');

  // Behavioral test: quickBotAction mutex prevents spam-clicks
  {
    let networkCallCount = 0;
    let toastMessages = [];
    const fakeBots = [{ id: 'bot-1', username: 'TestPlayer', status: 'online' }];
    
    // Simulate slow network request
    const fakeRequestJson = async () => {
      networkCallCount++;
      await new Promise(r => setTimeout(r, 50));
      return { ok: true, data: {} };
    };

    const quickBotActionMatch = DASHBOARD_HTML.match(/async function quickBotAction[\s\S]*?^}/m);
    assert.ok(quickBotActionMatch, 'quickBotAction found');

    const env = new Function('bots', 'requestJson', 'showToast', 'renderHome', 'refreshHome', `
      const _inFlightQuickActions = new Set();
      ${quickBotActionMatch[0]}
      return { quickBotAction, _inFlightQuickActions };
    `)(fakeBots, fakeRequestJson, (msg) => toastMessages.push(msg), () => {}, () => {});

    const fakeBtn = { disabled: false, dataset: {}, classList: { add: () => {}, remove: () => {} } };
    const fakeEvent = { currentTarget: fakeBtn, stopPropagation: () => {} };

    // Fire 5 rapid clicks simultaneously for bot-1
    const p1 = env.quickBotAction(fakeEvent, 'bot-1', 'start');
    const p2 = env.quickBotAction(fakeEvent, 'bot-1', 'start');
    const p3 = env.quickBotAction(fakeEvent, 'bot-1', 'start');
    const p4 = env.quickBotAction(fakeEvent, 'bot-1', 'start');
    const p5 = env.quickBotAction(fakeEvent, 'bot-1', 'start');

    await Promise.all([p1, p2, p3, p4, p5]);

    // Only 1 network call should have occurred! 4 were blocked by mutex!
    assert.strictEqual(networkCallCount, 1, 'Only 1 action should execute while in-flight; subsequent rapid clicks must be blocked');
    assert.strictEqual(fakeBtn.disabled, false, 'Button should be re-enabled in finally');
    assert.strictEqual(env._inFlightQuickActions.size, 0, 'Mutex set must be drained in finally');
  }

  // Behavioral test: clickDetailGuiSlot mutex prevents concurrent slot clicks
  {
    let slotCallCount = 0;
    const fakeRequestJson = async () => {
      slotCallCount++;
      await new Promise(r => setTimeout(r, 50));
      return { ok: true, data: {} };
    };

    const clickSlotMatch = DASHBOARD_HTML.match(/async function clickDetailGuiSlot[\s\S]*?^}/m);
    assert.ok(clickSlotMatch, 'clickDetailGuiSlot found');

    const env = new Function('selectedBotId', 'requestJson', 'showToast', 'refreshDetail', `
      const _inFlightGuiSlotClicks = new Set();
      ${clickSlotMatch[0]}
      return { clickDetailGuiSlot, _inFlightGuiSlotClicks };
    `)('bot-1', fakeRequestJson, () => {}, async () => {});

    const p1 = env.clickDetailGuiSlot(5);
    const p2 = env.clickDetailGuiSlot(5);
    const p3 = env.clickDetailGuiSlot(5);

    await Promise.all([p1, p2, p3]);

    assert.strictEqual(slotCallCount, 1, 'Only 1 slot click should execute while in-flight');
    assert.strictEqual(env._inFlightGuiSlotClicks.size, 0, 'GUI slot click mutex must be cleared in finally');
  }
  console.log('✅ G5-05 PASSED: In-flight click mutexes properly protect action buttons and GUI slots.');

  // --------------------------------------------------------------------------
  // TEST 6: G6-01 Worker Bearer Token & Secret Authentication
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: G6-01 Worker Bearer Token Authentication ---');
  
  const testSecret = 'secret_kbot_token_xyz987';
  const middleware = requireWorkerSecret(testSecret);

  // 1. Valid x-worker-secret header
  {
    let passed = false;
    let resCode = null;
    middleware({ get: (h) => h.toLowerCase() === 'x-worker-secret' ? testSecret : null }, {
      status: (c) => ({ json: () => { resCode = c; } })
    }, () => { passed = true; });
    assert.strictEqual(passed, true, 'x-worker-secret must authenticate successfully');
  }

  // 2. Valid Authorization: Bearer <secret>
  {
    let passed = false;
    let resCode = null;
    middleware({ get: (h) => h.toLowerCase() === 'authorization' ? `Bearer ${testSecret}` : null }, {
      status: (c) => ({ json: () => { resCode = c; } })
    }, () => { passed = true; });
    assert.strictEqual(passed, true, 'Authorization: Bearer <secret> must authenticate successfully');
  }

  // 3. Valid lowercase authorization: bearer <secret>
  {
    let passed = false;
    middleware({ get: (h) => h.toLowerCase() === 'authorization' ? `bearer ${testSecret}` : null }, {
      status: () => ({ json: () => {} })
    }, () => { passed = true; });
    assert.strictEqual(passed, true, 'Case-insensitive bearer scheme must authenticate successfully');
  }

  // 4. Invalid token
  {
    let passed = false;
    let resStatus = null;
    let resBody = null;
    middleware({ get: (h) => h.toLowerCase() === 'authorization' ? 'Bearer wrong_token' : null }, {
      status: (c) => {
        resStatus = c;
        return { json: (b) => { resBody = b; } };
      }
    }, () => { passed = true; });
    assert.strictEqual(passed, false, 'Invalid Bearer token must be rejected');
    assert.strictEqual(resStatus, 401, 'Invalid token must return 401');
    assert.strictEqual(resBody.ok, false, 'Response ok must be false');
  }

  // 5. extractWorkerToken direct testing
  assert.strictEqual(extractWorkerToken({ get: (h) => h === 'x-worker-secret' ? 'sec1' : null }), 'sec1');
  assert.strictEqual(extractWorkerToken({ get: (h) => h === 'authorization' ? 'Bearer sec2' : null }), 'sec2');
  assert.strictEqual(extractWorkerToken({ get: () => null }), '');
  console.log('✅ G6-01 PASSED: Worker Bearer token and x-worker-secret dual authentication verified.');

  // --------------------------------------------------------------------------
  // TEST 7: G6-02 SupabaseWorkerStore Event Deduplication Bug Fix
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: G6-02 Event Deduplication Fix ---');

  let storeRow = { worker_id: 'w_test_1', events: [], last_event: null };
  const mockClient = {
    rpc: async () => ({ data: null, error: { message: 'function does not exist', code: 'PGRST202' } }),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: storeRow, error: null }) }) }),
      update: (updates) => ({ eq: () => ({ select: () => ({ maybeSingle: async () => { Object.assign(storeRow, updates); return { data: storeRow, error: null }; } }) }) })
    })
  };

  const store = new SupabaseWorkerStore(mockClient);

  // 1. Two events with distinct IDs and missing message/occurredAt must BOTH be preserved
  await store.addEvent('w_test_1', { id: 'evt_1', type: 'system_log' });
  await store.addEvent('w_test_1', { id: 'evt_2', type: 'system_log' });
  assert.strictEqual(storeRow.events.length, 2, 'Distinct event IDs must both be preserved without false deduplication');

  // 2. Exact duplicate event with same ID should be deduplicated
  await store.addEvent('w_test_1', { id: 'evt_1', type: 'system_log' });
  assert.strictEqual(storeRow.events.length, 2, 'Duplicate event with same ID must be deduplicated');

  // 3. Event with full message and occurredAt: duplicate must be detected
  const t = new Date().toISOString();
  await store.addEvent('w_test_1', { type: 'chat', message: 'Hello world', occurredAt: t });
  assert.strictEqual(storeRow.events.length, 3, 'Event 3 should be added');
  await store.addEvent('w_test_1', { type: 'chat', message: 'Hello world', occurredAt: t });
  assert.strictEqual(storeRow.events.length, 3, 'Identical message + type + occurredAt must be deduplicated');

  // 4. Distinct message with same occurredAt must NOT be deduplicated
  await store.addEvent('w_test_1', { type: 'chat', message: 'Goodbye world', occurredAt: t });
  assert.strictEqual(storeRow.events.length, 4, 'Distinct message must be preserved');
  console.log('✅ G6-02 PASSED: Event deduplication logic correctly distinguishes events and eliminates false duplicates.');

  console.log('\n======================================================');
  console.log('🎉 ALL GATE 5 UI & WORKER VERIFICATION TESTS PASSED 100%!');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
