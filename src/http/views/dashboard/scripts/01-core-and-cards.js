window.__INITIAL_USER__ = null;
window.systemMaintenance = {
  enabled: false,
  message: 'Hệ thống đang bảo trì nâng cấp máy chủ. Tạm khóa thao tác điều khiển worker, vui lòng quay lại sau.',
  updatedAt: null,
  startedAt: null,
  lastCompensatedAt: null
};
let currentUser = window.__INITIAL_USER__ || null;
let userManagementList = [];
let userManagementAvailableBots = [];
let userPassPeekMap = {};
let bots = [];
let selectedBotId = null;
let detailBot = null;
let managerPollTimerId = null;
let detailInventory = null;
let detailDragged = null;
let detailInventoryBusy = false;
let homeRequestInFlight = false;
let routeResolving = false;
let detailRequestInFlight = false;
let lastEventRevision = -1;
let lastChatRevision = -1;
let lastPositionHistoryRevision = -1;
let lastPositionHistoryFetchedAt = 0;
let eventLoading = false;
let chatLoading = false;
let eventLoadingGen = 0;
let chatLoadingGen = 0;
let uptimeSyncAt = Date.now();
let detailRefreshQueued = false;
let draggedBotId = null;
let detailAutoChatSchedules = [];
let detailBotSchedules = [];
let detailSettingsDirty = false;
let detailAutoChatDirty = false;
let detailBotScheduleDirty = false;
let detailSettingsSaveInFlight = false;
let detailAutoChatSaveInFlight = false;
let detailBotScheduleSaveInFlight = false;
let detailAccountSaveInFlight = false;
let detailLifecycleActionInFlight = false;
let allLifecycleActionInFlight = false;
let detailRefreshGeneration = 0;

let _lastSyncSuccessAt = 0;
let _lastSyncState = 'connecting';
let _lastSyncCustomText = '';
const _botActionFeedbackMap = new Map();
const _botActionClearTimers = new Map();
let _fleetActionFeedback = null;
let _fleetActionClearTimer = null;
let _detailActionFeedback = null;
let _detailActionClearTimer = null;
const _detailSessionTrailMap = new Map();

function announceGlobalStatus(message) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('globalActionLiveRegion');
  if (!el) return;
  const clean = String(message || '').trim();
  if (!clean) return;
  el.textContent = '';
  el.textContent = clean;
}
window.announceGlobalStatus = announceGlobalStatus;

function formatRelativeSyncAge(timestampMs) {
  if (!timestampMs) return 'chưa đồng bộ';
  const sec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (sec < 4) return 'vừa xong';
  if (sec < 60) return sec + 's trước';
  const min = Math.floor(sec / 60);
  return min + 'm trước';
}

function formatRelativeAgeVi(dateOrIso) {
  if (!dateOrIso) return 'Chưa ghi nhận';
  const ms = dateOrIso instanceof Date ? dateOrIso.getTime() : Date.parse(dateOrIso);
  if (!Number.isFinite(ms)) return 'Chưa ghi nhận';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 5) return 'Vừa xong';
  if (diffSec < 60) return diffSec + ' giây trước';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin + ' phút trước';
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return diffHours + ' giờ trước';
  const diffDays = Math.floor(diffHours / 24);
  return diffDays + ' ngày trước';
}
window.formatRelativeAgeVi = formatRelativeAgeVi;

function humanizeBotLocationVi(locState, dimension) {
  const loc = String(locState || '').trim().toLowerCase();
  if (loc === 'login') return 'Khu đăng nhập';
  if (loc === 'lobby') return 'Sảnh chờ (Lobby)';
  let rawDim = dimension;
  if (rawDim && typeof rawDim === 'object') {
    rawDim = rawDim.name || rawDim.effects || rawDim.id || '';
  }
  const dim = String(rawDim || '').trim().replace(/^minecraft:/i, '').toLowerCase();
  if (loc === 'other' || loc === 'game' || loc === 'afk') {
    if (dim === 'the_nether' || dim === 'nether') return 'Khu AFK · Địa ngục (Nether)';
    if (dim === 'the_end' || dim === 'end') return 'Khu AFK · The End';
    return 'Khu sinh tồn / AFK';
  }
  if (dim === 'the_nether' || dim === 'nether') return 'Địa ngục (Nether)';
  if (dim === 'the_end' || dim === 'end') return 'The End';
  if (dim === 'overworld' || dim === 'world') return 'Cụm sinh tồn';
  if (dim && dim !== 'unknown' && dim !== 'other') return dim.charAt(0).toUpperCase() + dim.slice(1);
  return '';
}
window.humanizeBotLocationVi = humanizeBotLocationVi;

function humanizeStatusPillVi(status, label, available, manuallyStopped, errorType) {
  const st = String(status || '').trim().toLowerCase();
  if (errorType === 'stopped' || label === 'STOPPED') return 'STOPPED · Đã dừng';
  if (!available) return label;
  const subMap = {
    online: 'ONLINE · Trong game',
    afk: 'ONLINE · Treo AFK',
    waking: 'Đang đánh thức...',
    connecting: 'Đang kết nối...',
    authenticating: 'Đang đăng nhập...',
    entering: 'Đang vào cụm...',
    maintenance: 'Đang bảo trì',
    banned: 'Bị khóa (Ban)',
    ip_limited: 'Giới hạn IP',
    error: 'Lỗi kết nối',
    kicked: 'Vừa bị kick',
    offline: 'Ngoại tuyến'
  };
  return subMap[st] || label;
}
window.humanizeStatusPillVi = humanizeStatusPillVi;

function updateLiveSyncIndicators(state, customText) {
  if (state) _lastSyncState = state;
  if (state === 'ok') {
    _lastSyncSuccessAt = Date.now();
    _lastSyncCustomText = '';
  } else if (customText !== undefined) {
    _lastSyncCustomText = String(customText || '');
  }

  let dotClass = 'green';
  let pillExtra = '';
  let text = '';
  if (_lastSyncState === 'paused' || (typeof document !== 'undefined' && document.hidden)) {
    dotClass = 'yellow';
    pillExtra = 'is-paused';
    text = 'Tạm dừng khi ẩn tab';
  } else if (_lastSyncState === 'syncing') {
    dotClass = 'blue';
    text = customText || 'Đang đồng bộ...';
  } else if (_lastSyncState === 'error') {
    dotClass = 'red';
    pillExtra = 'is-error';
    text = _lastSyncCustomText || 'Mất đồng bộ — sẽ tự thử lại';
  } else if (_lastSyncSuccessAt > 0) {
    dotClass = 'green';
    text = 'Trực tiếp • ' + formatRelativeSyncAge(_lastSyncSuccessAt);
  } else {
    dotClass = 'yellow';
    text = _lastSyncCustomText || 'Đang kết nối dữ liệu...';
  }

  if (typeof document === 'undefined') return;
  [['homeSyncStatusPill', 'homeSyncStatusDot', 'homeSyncStatusText'], ['detailSyncStatusPill', 'detailSyncStatusDot', 'detailSyncStatusText']].forEach(([pillId, dotId, txtId]) => {
    const pill = document.getElementById(pillId);
    const dot = document.getElementById(dotId);
    const txt = document.getElementById(txtId);
    if (pill) pill.className = 'live-sync-pill' + (pillExtra ? (' ' + pillExtra) : '');
    if (dot) dot.className = 'pulse-status-dot ' + dotClass;
    if (txt) txt.textContent = text;
  });
}
window.updateLiveSyncIndicators = updateLiveSyncIndicators;

function renderActionFeedbackBanner(containerId, feedbackObj, dismissFnName) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!feedbackObj || !feedbackObj.title) {
    el.className = 'action-feedback-banner hidden';
    el.innerHTML = '';
    return;
  }
  const tone = feedbackObj.busy ? 'is-busy' : ('is-' + (feedbackObj.tone || 'info'));
  const iconHtml = feedbackObj.busy
    ? '<progress class="loading-spinner" aria-label="Đang thực hiện"></progress>'
    : '<span class="pulse-status-dot ' + (feedbackObj.tone === 'success' ? 'green' : feedbackObj.tone === 'warning' ? 'yellow' : feedbackObj.tone === 'error' ? 'red' : 'blue') + '" aria-hidden="true"></span>';
  const dismissHtml = !feedbackObj.busy && dismissFnName
    ? '<button type="button" class="small" onclick="' + dismissFnName + '()" aria-label="Đóng thông báo hành động">Đã hiểu</button>'
    : '';
  el.className = 'action-feedback-banner ' + tone;
  el.innerHTML =
    '<div class="action-feedback-main">' +
      iconHtml +
      '<div style="min-width:0;">' +
        '<div class="action-feedback-title">' + escapeHtml(feedbackObj.title) + '</div>' +
        (feedbackObj.detail ? ('<div class="action-feedback-sub">' + escapeHtml(feedbackObj.detail) + '</div>') : '') +
      '</div>' +
    '</div>' +
    (feedbackObj.actionHtml || '') +
    dismissHtml;
}

function setFleetActionFeedback(state) {
  if (_fleetActionClearTimer) {
    clearTimeout(_fleetActionClearTimer);
    _fleetActionClearTimer = null;
  }
  _fleetActionFeedback = state ? { ...state, updatedAt: Date.now() } : null;
  renderActionFeedbackBanner('fleetActionBanner', _fleetActionFeedback, 'clearFleetActionFeedback');
  if (state?.title) announceGlobalStatus(state.title + (state.detail ? '. ' + state.detail : ''));
  if (_fleetActionFeedback && !_fleetActionFeedback.busy && _fleetActionFeedback.tone === 'success') {
    _fleetActionClearTimer = setTimeout(() => {
      _fleetActionFeedback = null;
      renderActionFeedbackBanner('fleetActionBanner', null, 'clearFleetActionFeedback');
    }, 5000);
  }
}
function clearFleetActionFeedback() { setFleetActionFeedback(null); }
window.setFleetActionFeedback = setFleetActionFeedback;
window.clearFleetActionFeedback = clearFleetActionFeedback;

function setDetailActionFeedback(state) {
  if (_detailActionClearTimer) {
    clearTimeout(_detailActionClearTimer);
    _detailActionClearTimer = null;
  }
  _detailActionFeedback = state ? { ...state, updatedAt: Date.now() } : null;
  renderActionFeedbackBanner('detailActionBanner', _detailActionFeedback, 'clearDetailActionFeedback');
  if (state?.title) announceGlobalStatus(state.title + (state.detail ? '. ' + state.detail : ''));
  if (_detailActionFeedback && !_detailActionFeedback.busy && _detailActionFeedback.tone === 'success') {
    _detailActionClearTimer = setTimeout(() => {
      _detailActionFeedback = null;
      renderActionFeedbackBanner('detailActionBanner', null, 'clearDetailActionFeedback');
    }, 5000);
  }
}
function clearDetailActionFeedback() { setDetailActionFeedback(null); }
window.setDetailActionFeedback = setDetailActionFeedback;
window.clearDetailActionFeedback = clearDetailActionFeedback;

function setBotActionFeedback(botId, state) {
  const key = String(botId || '');
  if (!key) return;
  const oldTimer = _botActionClearTimers.get(key);
  if (oldTimer) {
    clearTimeout(oldTimer);
    _botActionClearTimers.delete(key);
  }
  if (!state) {
    _botActionFeedbackMap.delete(key);
  } else {
    const entry = { ...state, updatedAt: Date.now() };
    _botActionFeedbackMap.set(key, entry);
    if (!entry.busy && entry.tone === 'success') {
      const t = setTimeout(() => {
        _botActionFeedbackMap.delete(key);
        _botActionClearTimers.delete(key);
        if (typeof selectedBotId === 'undefined' || selectedBotId === null) {
          if (typeof filterBots === 'function') filterBots();
        }
      }, 4500);
      _botActionClearTimers.set(key, t);
    }
  }
  if (state?.title) announceGlobalStatus(state.title + (state.detail ? '. ' + state.detail : ''));
  if (typeof selectedBotId !== 'undefined' && String(selectedBotId) === key) {
    setDetailActionFeedback(state);
  }
}
window.setBotActionFeedback = setBotActionFeedback;

function summarizeBotProtections(bot) {
  const s = bot?.settings || {};
  const hasSettings = Boolean(bot && (bot.settings || bot.ecoMode !== undefined));
  return [
    { key: 'eco', label: 'Eco RAM', enabled: hasSettings ? (s.ecoMode !== false && bot?.ecoMode !== false) : true },
    { key: 'totem', label: 'Auto-Totem', enabled: s.autoTotem !== false },
    { key: 'eat', label: 'Auto-Eat', enabled: s.antiHungry !== false },
    { key: 'reconnect', label: 'Auto-Reconnect', enabled: s.autoReconnect !== false },
    { key: 'afk', label: 'Anti-AFK', enabled: s.antiAfkKick !== false }
  ];
}
window.summarizeBotProtections = summarizeBotProtections;

function describeBotOperationalStage(bot) {
  if (!bot) {
    return { stageIndex: 0, steps: [], headlineVi: 'Chưa có dữ liệu bot', hintVi: '', tone: 'warn', needsAccountSetup: false };
  }
  const isAdmin = Boolean(typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');
  const uname = String(bot.username || '').trim();
  const needsAccountSetup = !uname || uname === 'Chưa đặt';
  const rawStatus = String(bot.status || '').toLowerCase();
  const locState = String(bot.locationState || bot.locationKind || '').toLowerCase();
  const isStopped = Boolean(isBotIntentionallyStopped(bot));
  const rawErr = String(bot.lastError || bot.error || '');
  const cleanErr = isAdmin ? (rawErr.length > 90 ? (rawErr.slice(0, 87) + '...') : rawErr) : humanizeBotErrorForUser(rawErr);

  let stageIndex = 1;
  let tone = 'warn';
  let headlineVi = '';
  let hintVi = '';

  if (isStopped) {
    stageIndex = bot.available ? 1 : 0;
    tone = 'idle';
    headlineVi = needsAccountSetup
      ? 'Đang dừng • Chưa cài tài khoản Minecraft'
      : 'Đã chủ động dừng theo lệnh của bạn';
    hintVi = needsAccountSetup
      ? 'Bấm "Thiết lập tài khoản Minecraft" hoặc mở Chi tiết để nhập tên & mật khẩu ingame trước khi bật.'
      : 'Bấm "Bật" để khởi động lại bot và tự động vào khu vực AFK.';
  } else if (!bot.available) {
    stageIndex = 0;
    tone = 'error';
    headlineVi = bot.httpStatus === 503 || bot.httpStatus === 521 || rawStatus === 'waking'
      ? 'Máy chủ Bot đang thức dậy sau chế độ ngủ (~15-40s)'
      : 'Máy chủ Bot (Worker) hiện chưa phản hồi';
    hintVi = cleanErr || 'Đang chờ container worker khởi động hoặc kết nối lại Manager.';
  } else if (needsAccountSetup) {
    stageIndex = 1;
    tone = 'warn';
    headlineVi = 'Chưa cài tài khoản Minecraft để đăng nhập';
    hintVi = 'Nhập tên nhân vật và mật khẩu (/login) trong Chi tiết bot rồi bấm "Lưu & Chạy lại ngay".';
  } else if (rawStatus === 'online' || rawStatus === 'afk' || bot.online) {
    stageIndex = 4;
    tone = 'ok';
    headlineVi = locState === 'lobby'
      ? 'Đã vào Sảnh (Lobby) — đang chuẩn bị vào cụm chơi'
      : 'Đang treo AFK ổn định trong game';
    hintVi = locState === 'lobby'
      ? 'Nếu bot ở Sảnh quá lâu, bấm "Vào Server (Slot 24)" trong bảng Chat & Lệnh.'
      : 'Các cơ chế Auto-Totem, Auto-Eat, Anti-AFK và Watchdog RAM đang giám sát tự động.';
  } else if (rawStatus === 'authenticating' || rawStatus === 'entering') {
    stageIndex = 3;
    tone = 'warn';
    headlineVi = rawStatus === 'authenticating'
      ? 'Đang đăng nhập (/login) vào máy chủ KingMC...'
      : 'Đang mở Menu chọn cụm để vào khu vực AFK...';
    hintVi = 'Thường mất 5-15 giây. Bạn có thể theo dõi cửa sổ GUI trực tiếp ở bên phải.';
  } else if (rawStatus === 'waking' || rawStatus === 'connecting') {
    stageIndex = 2;
    tone = 'warn';
    headlineVi = 'Đang kết nối tới máy chủ Minecraft...';
    hintVi = 'Bot đang thiết lập phiên đăng nhập vào server.';
  } else if (rawStatus === 'maintenance') {
    stageIndex = 1;
    tone = 'warn';
    headlineVi = 'Đang tạm nghỉ trong khung bảo trì máy chủ';
    hintVi = 'Bot sẽ tự kết nối lại khi qua khung giờ bảo trì.';
  } else {
    stageIndex = 1;
    tone = 'error';
    headlineVi = cleanErr || 'Bot bị ngắt kết nối hoặc vừa bị kick khỏi server';
    hintVi = 'Bấm "Chạy" / "Reconnect lỗi" hoặc kiểm tra Nhật ký sự kiện để xem lý do chi tiết.';
  }

  const steps = [
    { key: 'worker', label: 'Máy chủ Bot', sub: bot.available ? 'Sẵn sàng' : (isStopped ? 'Tạm nghỉ' : 'Chờ kết nối') },
    { key: 'server', label: 'Kết nối Server', sub: stageIndex >= 2 ? (bot.server || 'kingmc.vn') : (needsAccountSetup ? 'Thiếu nick MC' : 'Chờ bật') },
    { key: 'auth', label: 'Đăng nhập & Menu', sub: stageIndex >= 3 ? (stageIndex >= 4 ? 'Đã hoàn tất' : 'Đang xử lý') : 'Chưa vào' },
    { key: 'afk', label: 'Treo AFK', sub: stageIndex >= 4 ? (locState === 'lobby' ? 'Tại Sảnh' : 'Hoạt động') : 'Chờ vào game' }
  ].map((step, idx) => {
    const stepNum = idx + 1;
    let state = 'idle';
    if (stageIndex >= stepNum && (stepNum < 4 || stageIndex === 4)) {
      if (stageIndex === stepNum && tone === 'warn') state = 'active';
      else state = 'done';
    } else if (tone === 'error' && stageIndex === idx) {
      state = 'error';
    }
    if (stageIndex === 0 && idx === 0 && tone === 'error') state = 'error';
    return { ...step, state, stepNum };
  });

  return { stageIndex, steps, headlineVi, hintVi, tone, needsAccountSetup };
}
window.describeBotOperationalStage = describeBotOperationalStage;

function syncFormDirtyBadges() {
  if (typeof document === 'undefined') return;
  const setBadge = (id, dirty, cleanLabel) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (dirty) {
      el.className = 'panel-sync-badge is-dirty';
      el.textContent = '● Có thay đổi chưa lưu';
    } else {
      el.className = 'panel-sync-badge is-saved';
      el.textContent = cleanLabel || '✓ Đã đồng bộ';
    }
    if (el.classList && typeof el.classList.toggle === 'function') {
      el.classList.toggle('panel-sync-badge', true);
      el.classList.toggle('is-dirty', Boolean(dirty));
      el.classList.toggle('is-saved', !dirty);
    }
  };
  setBadge('detailSettingsSyncBadge', Boolean(detailSettingsDirty), '✓ Đã đồng bộ');
  setBadge('detailAutoChatSyncBadge', Boolean(detailAutoChatDirty), '✓ Đã đồng bộ');
  setBadge('detailBotScheduleSyncBadge', Boolean(detailBotScheduleDirty), '✓ Đã đồng bộ');
  const uIn = document.getElementById('detailUsernameInput');
  const pIn = document.getElementById('detailPasswordInput');
  const accDirty = Boolean((uIn && uIn.getAttribute('data-dirty') === 'true') || (pIn && pIn.getAttribute('data-dirty') === 'true'));
  setBadge('detailAccountSyncBadge', accDirty, '✓ Đã lưu');
}
window.syncFormDirtyBadges = syncFormDirtyBadges;

function invalidateDetailReads() {
  detailRefreshGeneration++;
  return detailRefreshGeneration;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1000, Math.min(30000, Number(options.timeoutMs)))
    : 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { ...(options.headers || {}) };
  const requestOptions = { ...options, headers, cache: 'no-store', credentials: 'same-origin', signal: controller.signal };
  delete requestOptions.timeoutMs;
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData) && !(options.body instanceof URLSearchParams) && !(typeof Blob !== 'undefined' && options.body instanceof Blob)) {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    requestOptions.body = JSON.stringify(options.body);
  } else if (typeof options.body === 'string' && !headers['Content-Type'] && !headers['content-type']) {
    const trimmedBody = options.body.trim();
    if ((trimmedBody.startsWith('{') && trimmedBody.endsWith('}')) || (trimmedBody.startsWith('[') && trimmedBody.endsWith(']'))) {
      headers['Content-Type'] = 'application/json';
    }
  }
  try {
    const response = await fetch(url, requestOptions);
    if (response.status === 401) {
      return { ok: false, status: 401, data: { error: 'Phiên đăng nhập hết hạn hoặc chưa đăng nhập.' } };
    }
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch (_) { data = { raw: text }; }
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err && err.name === 'AbortError' ? 'Request web quá thời gian chờ.' : (err.message || 'Không thể kết nối web tổng.') } };
  } finally {
    clearTimeout(timer);
  }
}

function clampClientNumber(value, fallback, min, max) {
  const number = Number(value);
  if(!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeClientBotUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if(!['http:','https:'].includes(url.protocol)) return '';
    url.hash='';
    url.search='';
    return url.toString().replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function isDetailSettingsRestrictedUser() {
  return Boolean(typeof currentUser !== 'undefined' && currentUser && currentUser.role !== 'admin' && currentUser.allowAccountChange === false);
}

function setDetailSettingsDisabled(disabled) {
  const restricted = isDetailSettingsRestrictedUser();
  document.querySelectorAll('#detailSettingEcoMode, #detailSettingAutoTotem, #detailSettingAntiHungry, #detailSettingAutoReconnect, #detailSettingAntiAfkKick, #detailSpawnCommands')
    .forEach(el => { el.disabled = Boolean(disabled) || restricted; });
  document.querySelectorAll('#detailSettingUserNotifyEnabled, #detailSettingNotifyOnAfkKick, #detailSettingNotifyOnAfkRecover, #detailSettingNotifyOnReconnectExhausted, #saveDetailSettingsButton')
    .forEach(el => { el.disabled = !!disabled; });
}

// BUG-24: Detail settings giờ có field Spawn Commands; textarea input phải bật cờ dirty.
function markDetailSettingsDirty() {
  detailSettingsDirty = true;
  if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
}

function setDetailAutoChatDisabled(disabled) {
  document.querySelectorAll('#detailAutoChatPanel button, #detailAutoChatPanel input, #detailAutoChatPanel select, #detailAutoChatPanel textarea')
    .forEach(el => { el.disabled = !!disabled; });
}

function setDetailBotScheduleDisabled(disabled) {
  document.querySelectorAll('#detailBotSchedulePanel button, #detailBotSchedulePanel input, #detailBotSchedulePanel select, #detailBotSchedulePanel textarea')
    .forEach(el => { el.disabled = !!disabled; });
}

document.addEventListener('click', event => {
  if (!event.target?.closest?.('#globalUserProfileBtn') && !event.target?.closest?.('#globalUserProfileDropdown')) {
    closeUserProfileDropdown();
  }
  const copyIpBtn = event.target?.closest?.('.btn-copy-bot-ip');
  if (copyIpBtn && copyIpBtn.dataset.ip && copyIpBtn.dataset.ip !== '--') {
    event.stopPropagation();
    copyToClipboard(copyIpBtn.dataset.ip, 'IP Bot', copyIpBtn);
  }
});
document.addEventListener('input',event=>{
  if(event.target?.closest?.('#detailAutoChatSchedules')){
    detailAutoChatDirty=true;
    if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
    return;
  }
  if(event.target?.id==='detailBotScheduleEnabled' || event.target?.closest?.('#detailBotSchedules')){
    detailBotScheduleDirty=true;
    if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
    return;
  }
  if(['detailSettingEcoMode','detailSettingAutoTotem','detailSettingAntiHungry','detailSettingAutoReconnect','detailSettingAntiAfkKick','detailSettingUserNotifyEnabled','detailSettingNotifyOnAfkKick','detailSettingNotifyOnAfkRecover','detailSettingNotifyOnReconnectExhausted','detailSpawnCommands'].includes(event.target?.id)){
    detailSettingsDirty=true;
    if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
    return;
  }
  if(['detailUsernameInput','detailPasswordInput'].includes(event.target?.id)){
    if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
  }
});
document.addEventListener('change',event=>{
  if(event.target?.closest?.('#detailAutoChatSchedules')){
    detailAutoChatDirty=true;
    if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
    return;
  }
  if(event.target?.id==='detailBotScheduleEnabled' || event.target?.closest?.('#detailBotSchedules')){
    detailBotScheduleDirty=true;
    if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
    return;
  }
  if(['detailSettingEcoMode','detailSettingAutoTotem','detailSettingAntiHungry','detailSettingAutoReconnect','detailSettingAntiAfkKick','detailSettingUserNotifyEnabled','detailSettingNotifyOnAfkKick','detailSettingNotifyOnAfkRecover','detailSettingNotifyOnReconnectExhausted','detailSpawnCommands'].includes(event.target?.id)){
    detailSettingsDirty=true;
    if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
  }
});

function isBotIntentionallyStopped(bot) {
  if (!bot) return false;
  const status = String(bot.status || '').toLowerCase();
  return Boolean(bot.manuallyStopped) && (['stopped', 'offline', 'kicked'].includes(status) || !bot.available);
}
window.isBotIntentionallyStopped = isBotIntentionallyStopped;

function isBotUnreachable(bot) {
  if (!bot) return false;
  return bot.available !== true && !isBotIntentionallyStopped(bot);
}
window.isBotUnreachable = isBotUnreachable;

function isDetailBotOfflineOrStopped(bot) {
  if (!bot) return true;
  if (typeof isBotIntentionallyStopped === 'function' && isBotIntentionallyStopped(bot)) return true;
  const st = String(bot.status || bot.state || '').trim().toLowerCase();
  return !bot.available || ['stopped', 'offline', 'registered', 'disconnected', 'error', 'kicked', 'maintenance', 'ip_limited', 'banned'].includes(st);
}
window.isDetailBotOfflineOrStopped = isDetailBotOfflineOrStopped;

function statusMeta(status, available=true, manuallyStopped=false, bot=null) {
  const isStopped = Boolean(manuallyStopped || bot?.manuallyStopped);
  if (isStopped && (status === 'offline' || status === 'kicked' || status === 'stopped' || !available)) {
    return ['gray', 'STOPPED', 'stopped'];
  }
  if (!available) {
    const httpStatus = bot?.httpStatus;
    const isSecretMismatch = !!(bot?.secretMismatch || httpStatus === 409 || String(bot?.lastError || bot?.error || '').includes('409') || String(bot?.lastError || bot?.error || '').toLowerCase().includes('secret') || String(bot?.lastError || bot?.error || '').includes('khóa') || String(bot?.lastError || bot?.error || '').includes('lệch key'));
    if (isSecretMismatch) {
      return ['orange', 'Lệch Secret Key (409)', 'secret_mismatch'];
    }
    const isSleep = !!(httpStatus === 503 || httpStatus === 502 || httpStatus === 521 || bot?.status === 'waking' || String(bot?.lastError || bot?.error || '').includes('503') || String(bot?.lastError || bot?.error || '').includes('502') || String(bot?.lastError || bot?.error || '').includes('521') || String(bot?.lastError || bot?.error || '').toLowerCase().includes('sleep') || String(bot?.lastError || bot?.error || '').includes('ngủ') || String(bot?.lastError || bot?.error || '').toLowerCase().includes('timeout') || String(bot?.lastError || bot?.error || '').toLowerCase().includes('quá thời gian') || String(bot?.lastError || bot?.error || '').toLowerCase().includes('waking'));
    if (isSleep) {
      const isRender = bot?.url ? String(bot.url).includes('.onrender.com') : true;
      const is521 = httpStatus === 521 || String(bot?.lastError || bot?.error || '').includes('521');
      return ['purple', is521 ? 'Wispbyte Sleep / Waking (521)' : (isRender ? 'Render Sleep / Timeout (503)' : 'Đang kết nối lại / Timeout (503)'), 'render_sleep'];
    }
    const isNotFound = !!(httpStatus === 404 || String(bot?.lastError || bot?.error || '').includes('404') || String(bot?.lastError || bot?.error || '').toLowerCase().includes('not found') || String(bot?.lastError || bot?.error || '').includes('không tồn tại'));
    if (isNotFound) {
      return ['red', 'URL không tồn tại (404)', 'not_found'];
    }
    const isProbing = !!(bot?.status === 'probing' || String(bot?.lastError || bot?.error || '').indexOf('Đang kiểm tra') !== -1);
    if (isProbing) {
      return ['yellow', 'ĐANG KIỂM TRA...', 'probing'];
    }
    return ['red', 'Container tắt / Mất kết nối', 'unreachable'];
  }
  const map={
    online:['green','ONLINE','online'],
    afk:['green','ONLINE','online'],
    waking:['yellow','STARTING...','connecting'],
    connecting:['yellow','CONNECTING','connecting'],
    authenticating:['blue','AUTH','authenticating'],
    entering:['blue','ENTERING SERVER','entering'],
    maintenance:['yellow','MAINTENANCE','maintenance'],
    banned:['red','BANNED','banned'],
    ip_limited:['orange','IP LIMITED','ip_limited'],
    stopped:['gray','STOPPED','stopped'],
    error:['red','ERROR','error'],
    kicked:['red','KICKED','kicked'],
    offline:['red','OFFLINE','offline']
  };
  return map[status] || ['red','OFFLINE','offline'];
}

function humanizeBotErrorForUser(rawText) {
  const clean = String(rawText || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!clean) return '';
  const lower = clean.toLowerCase();
  if (lower.includes('has not checked in recently') || lower.includes('worker_unavailable')) {
    return 'Container bot đang tắt hoặc tạm mất kết nối.';
  }
  if (lower.includes('max_reconnects_reached') || lower.includes('reconnect_exhausted')) {
    return 'Đã dừng tự kết nối lại sau nhiều lần thử thất bại.';
  }
  if (lower.includes('server requires /login') || lower.includes('server requires /register')) {
    return 'Máy chủ yêu cầu mật khẩu (/login) nhưng bot chưa được cấu hình mật khẩu.';
  }
  if (lower.includes('authentication failed') || lower.includes('auth_failed')) {
    return 'Sai mật khẩu đăng nhập trong máy chủ Minecraft.';
  }
  if (lower.includes('lifecycle_conflict') || lower.includes('already in progress')) {
    return 'Bot đang xử lý một thao tác bật/tắt khác.';
  }
  if (lower.includes('minecraft connection timed out') || lower.includes('etimedout') || lower.includes('timed out')) {
    return 'Máy chủ phản hồi chậm, đang tự thử lại.';
  }
  if (
    lower.includes('minecraft connection error') ||
    lower.includes('connection_error') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('ehostunreach') ||
    lower.includes('enetunreach') ||
    lower.includes('epipe') ||
    lower.includes('socket hang up') ||
    lower.includes('connection refused')
  ) {
    return 'Tạm ngắt kết nối máy chủ, đang tự vào lại.';
  }
  if (lower.includes('credentials are not configured') || lower.includes('credentials_missing') || lower.includes('set this worker account')) {
    return 'Chưa cài tài khoản Minecraft.';
  }
  if (lower.includes('invalid_proxy') || lower.includes('socks')) {
    return 'Lỗi kết nối Proxy.';
  }
  if (lower.includes('ip_limited')) {
    return 'Máy chủ đang giới hạn IP vào game.';
  }
  if (lower.includes('reconnect is paused until 05:30') || lower.includes('scheduled stop 04:30')) {
    return 'Đang tạm nghỉ bảo trì định kỳ (04:30 - 05:30).';
  }
  if (lower.includes('already connected') || lower.includes('another location')) {
    return 'Tài khoản đang đăng nhập ở phiên khác.';
  }
  if (lower.includes('flying is not enabled')) {
    return 'Máy chủ nhắc lỗi đứng lơ lửng khi AFK.';
  }
  if (lower.includes('restarting') || lower.includes('server closed')) {
    return 'Máy chủ Minecraft đang khởi động lại.';
  }
  if (lower.includes('keepalive') || lower.includes('read timed out')) {
    return 'Mất phản hồi mạng tạm thời (timeout), đang tự vào lại.';
  }
  return clean.length > 90 ? (clean.slice(0, 87) + '...') : clean;
}
window.humanizeBotErrorForUser = humanizeBotErrorForUser;

function showToast(message, type = 'info', duration = 3200) {
  const container = document.getElementById('toast');
  if (!container) return;
  const dotColors = {
    success: 'var(--green)',
    error: 'var(--red)',
    warning: 'var(--yellow)',
    info: 'var(--accent)'
  };
  container.className = 'toast-stack';
  container.style.display = 'flex';

  const activeItems = Array.from(container.children || []).filter(el => !el.classList?.contains('is-leaving'));
  while (activeItems.length >= 3) {
    const oldest = activeItems.shift();
    if (oldest) oldest.remove();
  }

  const item = document.createElement('div');
  item.className = 'toast toast-item toast-' + type;
  item.style.display = 'block';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;';

  const leftWrap = document.createElement('div');
  leftWrap.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;flex:1;';
  const dotSpan = document.createElement('span');
  dotSpan.setAttribute('aria-hidden', 'true');
  dotSpan.style.cssText = 'width:7px;height:7px;border-radius:50%;flex-shrink:0;background:' + (dotColors[type] || 'var(--accent)') + ';';
  const textSpan = document.createElement('span');
  const cleanMsg = String(message || '').replace(/^(?:✅|❌|⚠️|ℹ️|🎉|✨|💤)\s*/u, '');
  textSpan.textContent = cleanMsg || String(message || '');
  leftWrap.appendChild(dotSpan);
  leftWrap.appendChild(textSpan);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Đóng';
  closeBtn.setAttribute('aria-label', 'Đóng thông báo');
  closeBtn.style.cssText = 'background:transparent;border:none;color:inherit;cursor:pointer;opacity:0.7;font-size:13px;padding:0 2px;line-height:1;min-height:24px;box-shadow:none;';

  let dismissed = false;
  const finalizeRemove = () => {
    item.remove();
    if (!container.children.length) {
      container.style.display = 'none';
    }
  };
  const removeItem = () => {
    if (dismissed) return;
    dismissed = true;
    const canAnimateExit = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (canAnimateExit && item.classList) {
      item.classList.add('is-leaving');
      setTimeout(finalizeRemove, 180);
    } else {
      finalizeRemove();
    }
  };
  closeBtn.addEventListener('click', removeItem);
  row.appendChild(leftWrap);
  row.appendChild(closeBtn);
  item.appendChild(row);
  container.appendChild(item);

  setTimeout(removeItem, Math.max(1200, Number(duration) || 3200));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function formatHardwareMetric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : '0.0';
}

const DEFAULT_SYSTEM_MAINTENANCE_MSG =
  'Hệ thống đang bảo trì nâng cấp máy chủ. Tạm khóa thao tác điều khiển worker, vui lòng quay lại sau.';
const MAINTENANCE_FREEZE_NOTE_VI =
  'Thời gian sử dụng bot đang được giữ nguyên, không bị trừ trong lúc bảo trì.';
let _localMaintFreezeAtMs = 0;

function getSystemMaintenanceInfo() {
  const m = window.systemMaintenance || {};
  const msg = String(m.message || '').trim() || DEFAULT_SYSTEM_MAINTENANCE_MSG;
  return {
    enabled: Boolean(m.enabled),
    message: msg,
    updatedAt: m.updatedAt || null,
    startedAt: m.startedAt || null,
    lastCompensatedAt: m.lastCompensatedAt || null
  };
}
window.getSystemMaintenanceInfo = getSystemMaintenanceInfo;

function getMaintenanceFreezeAnchorMs(maint) {
  const m = maint || getSystemMaintenanceInfo();
  if (!m || !m.enabled) return NaN;
  const rawAnchor = m.lastCompensatedAt || m.startedAt || m.updatedAt || '';
  return rawAnchor ? Date.parse(rawAnchor) : NaN;
}

function getEffectiveUserExpiresAt(rawExpiresAt) {
  if (!rawExpiresAt) return rawExpiresAt;
  const maint = getSystemMaintenanceInfo();
  if (!maint.enabled) return rawExpiresAt;
  const anchorMs = getMaintenanceFreezeAnchorMs(maint);
  const expMs = Date.parse(rawExpiresAt);
  const nowMs = Date.now();
  if (Number.isFinite(anchorMs) && Number.isFinite(expMs) && nowMs > anchorMs && expMs > anchorMs) {
    return new Date(expMs + (nowMs - anchorMs)).toISOString();
  }
  return rawExpiresAt;
}
window.getEffectiveUserExpiresAt = getEffectiveUserExpiresAt;

function normalizeCurrentUserMaintenanceExpiry(userObj, maintObj) {
  if (!userObj || typeof userObj !== 'object') return userObj;
  const m = maintObj && typeof maintObj === 'object' ? maintObj : getSystemMaintenanceInfo();
  if (!m || !m.enabled) {
    delete userObj.rawExpiresAt;
    delete userObj.effectiveExpiresAt;
    return userObj;
  }
  if (!userObj.rawExpiresAt && userObj.expiresAt && !userObj.isPermanent && userObj.role !== 'admin') {
    const anchorRaw = m.lastCompensatedAt || m.startedAt || m.updatedAt || '';
    const anchorMs = anchorRaw ? Date.parse(anchorRaw) : NaN;
    const srvExpMs = Date.parse(userObj.expiresAt);
    const nowMs = Date.now();
    if (Number.isFinite(anchorMs) && Number.isFinite(srvExpMs) && nowMs > anchorMs && srvExpMs > nowMs) {
      userObj.effectiveExpiresAt = userObj.expiresAt;
      userObj.rawExpiresAt = new Date(srvExpMs - (nowMs - anchorMs)).toISOString();
    }
  }
  return userObj;
}
window.normalizeCurrentUserMaintenanceExpiry = normalizeCurrentUserMaintenanceExpiry;

function formatMaintenanceBannerMessageVi(rawMsg) {
  const base = String(rawMsg || '').trim() || DEFAULT_SYSTEM_MAINTENANCE_MSG;
  if (/không bị trừ|tạm dừng trừ giờ/i.test(base)) return base;
  const sep = /[.!?]$/.test(base) ? ' ' : '. ';
  return base + sep + MAINTENANCE_FREEZE_NOTE_VI;
}

function getUserExpirationInfo() {
  const user = (typeof currentUser !== 'undefined') ? currentUser : null;
  if (!user || user.role === 'admin' || user.isPermanent) {
    return { isExpired: false, inGracePeriod: false, isGraceExpired: false, remainingGraceMs: 0 };
  }
  const status = String(user.status || 'active').toLowerCase();
  const baseExpiresAt = user.rawExpiresAt || user.expiresAt || user.effectiveExpiresAt || null;
  const maint = getSystemMaintenanceInfo();
  const anchorMs = getMaintenanceFreezeAnchorMs(maint);
  const rawExpMs = baseExpiresAt ? Date.parse(baseExpiresAt) : NaN;
  const now = Date.now();
  const GRACE_PERIOD_MS = 6 * 60 * 60 * 1000;

  if (maint.enabled && Number.isFinite(rawExpMs) && status !== 'expired' && status !== 'grace_period' && user.inGracePeriod !== true) {
    const validForFreeze = Number.isFinite(anchorMs) ? (rawExpMs > anchorMs) : (rawExpMs > now);
    if (validForFreeze) {
      const effIso = getEffectiveUserExpiresAt(baseExpiresAt);
      const effMs = effIso ? Date.parse(effIso) : rawExpMs;
      return {
        isExpired: false,
        inGracePeriod: false,
        isGraceExpired: false,
        remainingGraceMs: 0,
        frozenByMaintenance: true,
        effectiveExpiresAt: effIso || baseExpiresAt,
        expiryTime: Number.isFinite(effMs) ? effMs : rawExpMs
      };
    }
  }

  const effExpiresAt = getEffectiveUserExpiresAt(baseExpiresAt);
  const expiryTime = effExpiresAt ? Date.parse(effExpiresAt) : null;
  const isPastTime = Number.isFinite(expiryTime) && expiryTime <= now;
  const isGraceStatus = status === 'grace_period' || user.inGracePeriod === true;
  const isExpiredStatus = status === 'expired';

  if (!isPastTime && !isGraceStatus && !isExpiredStatus) {
    return { isExpired: false, inGracePeriod: false, isGraceExpired: false, remainingGraceMs: 0 };
  }

  let effectiveExpiry = Number.isFinite(expiryTime) ? expiryTime : (now - 1000);
  if (maint.enabled && !isExpiredStatus && Number.isFinite(anchorMs) && Number.isFinite(rawExpMs) && (rawExpMs + GRACE_PERIOD_MS) > anchorMs && now > anchorMs) {
    effectiveExpiry = rawExpMs + (now - anchorMs);
  }
  const graceEndTime = effectiveExpiry + GRACE_PERIOD_MS;
  const remainingGraceMs = Math.max(0, graceEndTime - now);

  const inGracePeriod = (isGraceStatus || isPastTime) && (now <= graceEndTime) && !isExpiredStatus;
  const isGraceExpired = isExpiredStatus || (now > graceEndTime);

  return {
    isExpired: true,
    inGracePeriod,
    isGraceExpired,
    remainingGraceMs,
    expiryTime: effectiveExpiry
  };
}
window.getUserExpirationInfo = getUserExpirationInfo;

function getWorkerLockInfo() {
  const isAdmin = Boolean(typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');
  const maint = getSystemMaintenanceInfo();
  const userExp = getUserExpirationInfo();
  if (isAdmin) {
    return { locked: false, reason: null, message: '', userExp, maintenance: maint };
  }
  if (maint.enabled) {
    return {
      locked: true,
      reason: 'maintenance',
      message: maint.message,
      userExp,
      maintenance: maint
    };
  }
  if (userExp.isExpired) {
    return {
      locked: true,
      reason: 'expired',
      message: 'Gói bot của bạn đã hết hạn, tính năng điều khiển bị vô hiệu hóa. Vui lòng gia hạn để tiếp tục sử dụng.',
      userExp,
      maintenance: maint
    };
  }
  return { locked: false, reason: null, message: '', userExp, maintenance: maint };
}
window.getWorkerLockInfo = getWorkerLockInfo;

function renderSystemMaintenanceBanner() {
  const maint = getSystemMaintenanceInfo();
  const isAdmin = Boolean(typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');

  const badge = document.getElementById('maintenanceStatusBadge');
  if (badge) {
    badge.textContent = maint.enabled ? 'ĐANG BẬT' : 'TẮT';
    badge.style.color = maint.enabled ? '#fbbf24' : '#94a3b8';
  }
  const grp = document.getElementById('maintenanceControlGroup');
  if (grp) {
    grp.style.borderColor = maint.enabled ? 'rgba(245,158,11,0.85)' : 'rgba(245,158,11,0.38)';
    grp.style.background = maint.enabled ? 'rgba(120,53,15,0.28)' : 'var(--card2)';
  }

  const isLoggedIn = Boolean(typeof currentUser !== 'undefined' && currentUser);

  const banner = document.getElementById('systemMaintenanceBanner');
  if (banner) {
    if (maint.enabled && isLoggedIn) {
      banner.classList.remove('hidden');
      const titleEl = document.getElementById('systemMaintenanceBannerTitle');
      const msgEl = document.getElementById('systemMaintenanceBannerMessage');
      const actionsEl = document.getElementById('systemMaintenanceAdminActions');
      if (titleEl) {
        titleEl.textContent = isAdmin
          ? 'CHẾ ĐỘ BẢO TRÌ ĐANG BẬT (NGƯỜI DÙNG BỊ KHÓA WORKER)'
          : 'HỆ THỐNG ĐANG BẢO TRÌ';
      }
      const displayMaintMsg = formatMaintenanceBannerMessageVi(maint.message);
      if (msgEl) {
        msgEl.textContent = isAdmin
          ? ('Thông báo đang hiển thị cho khách: ' + displayMaintMsg)
          : displayMaintMsg;
      }
      if (actionsEl) {
        actionsEl.style.display = isAdmin ? 'flex' : 'none';
      }
    } else {
      banner.classList.add('hidden');
    }
  }

  const detailBanner = document.getElementById('detailMaintenanceBanner');
  if (detailBanner) {
    if (maint.enabled && isLoggedIn && !isAdmin) {
      detailBanner.classList.remove('hidden');
      const dMsg = document.getElementById('detailMaintenanceBannerMessage');
      if (dMsg) dMsg.textContent = formatMaintenanceBannerMessageVi(maint.message);
    } else {
      detailBanner.classList.add('hidden');
    }
  }

  const lockInfo = getWorkerLockInfo();
  const inFlight = typeof allLifecycleActionInFlight !== 'undefined' && Boolean(allLifecycleActionInFlight);
  ['allStartButton', 'allStopButton', 'allRestartButton', 'allReconnectButton'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (!btn.dataset.defaultTitle) {
      btn.dataset.defaultTitle = btn.getAttribute('title') || '';
    }
    if (lockInfo.locked) {
      btn.disabled = true;
      btn.classList.add('locked-control-btn');
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      btn.title = lockInfo.message || 'Tạm khóa điều khiển';
    } else {
      btn.disabled = Boolean(inFlight && btn.id !== 'allReconnectButton');
      btn.classList.remove('locked-control-btn');
      btn.style.opacity = '';
      btn.style.cursor = '';
      btn.title = btn.dataset.defaultTitle || '';
    }
  });
}
window.renderSystemMaintenanceBanner = renderSystemMaintenanceBanner;

function syncSystemMaintenanceState(nextMaint, options = {}) {
  if (!nextMaint || typeof nextMaint !== 'object') return false;
  const prev = getSystemMaintenanceInfo();
  const cleanMsg = String(nextMaint.message || '').trim() || DEFAULT_SYSTEM_MAINTENANCE_MSG;
  const nextEnabled = Boolean(nextMaint.enabled);
  const nextStartedAt = nextMaint.startedAt || null;
  const nextLastCompensatedAt = nextMaint.lastCompensatedAt || null;
  const changed =
    prev.enabled !== nextEnabled ||
    prev.message !== cleanMsg ||
    prev.startedAt !== nextStartedAt ||
    prev.lastCompensatedAt !== nextLastCompensatedAt;
  if (nextEnabled && !prev.enabled) {
    _localMaintFreezeAtMs = Date.now();
  } else if (!nextEnabled) {
    _localMaintFreezeAtMs = 0;
    if (typeof currentUser !== 'undefined' && currentUser) {
      delete currentUser.rawExpiresAt;
      delete currentUser.effectiveExpiresAt;
    }
  }
  window.systemMaintenance = {
    enabled: nextEnabled,
    message: cleanMsg,
    updatedAt: nextMaint.updatedAt || null,
    startedAt: nextStartedAt,
    lastCompensatedAt: nextLastCompensatedAt
  };
  renderSystemMaintenanceBanner();
  if (changed && typeof updateUserHeaderCountdown === 'function') {
    updateUserHeaderCountdown();
  }
  if (changed && options && options.rerender !== false) {
    if (typeof renderHome === 'function') renderHome();
    if (typeof selectedBotId !== 'undefined' && selectedBotId !== null && typeof detailStatusHtml === 'function') {
      detailStatusHtml();
    }
  }
  return changed;
}
window.syncSystemMaintenanceState = syncSystemMaintenanceState;

function botCardHtml(bot) {
  if (!bot) return '';
  const [color, label, errorType] = statusMeta(bot.status, bot.available, !!bot.manuallyStopped, bot);
  const username = bot.username || 'Chưa đặt';
  const isOffline = !bot.available || ['offline', 'kicked', 'error', 'disconnected', 'stopped'].includes(String(bot.status || '').toLowerCase());
  const pingRaw = bot.ping;
  const pingVal = (pingRaw === null || pingRaw === undefined || String(pingRaw).trim() === '') ? NaN : Number(pingRaw);
  const ping = (Number.isFinite(pingVal) && pingVal >= 0) ? (pingVal + ' ms') : (isOffline ? '-- ms (Tắt)' : '--');
  const tpsRaw = bot.tps ?? bot.serverTps;
  const tpsVal = (tpsRaw === null || tpsRaw === undefined || String(tpsRaw).trim() === '') ? NaN : Number(tpsRaw);
  const hasTps = Number.isFinite(tpsVal) && tpsVal >= 0;
  const tpsText = hasTps ? (tpsVal.toFixed(1) + ' TPS') : (isOffline ? '-- TPS (Tắt)' : '-- TPS');
  const tpsColor = !hasTps ? 'var(--muted)' : (tpsVal >= 18.5 ? 'var(--green)' : (tpsVal >= 14.0 ? 'var(--yellow)' : 'var(--red)'));
  const posObj = bot.position || bot.roundedLocation;
  const pos = posObj && Number.isFinite(Number(posObj.x)) && Number.isFinite(Number(posObj.y)) && Number.isFinite(Number(posObj.z))
    ? (Math.round(Number(posObj.x)) + ' ' + Math.round(Number(posObj.y)) + ' ' + Math.round(Number(posObj.z)))
    : '-';
  const id = String(bot.workerId || bot.id);
  const idArg = JSON.stringify(id);
  const totems = Number(bot.totemCount || 0);
  const isEco = bot.settings?.ecoMode !== false && bot.ecoMode !== false;
  const hw = bot.hostHardware;
  const botRamMb = Number(hw?.botRssMb || bot.ramRss || bot.rssMb || bot.memory?.rssMb || 0);
  const botHeapMb = Number(hw?.botHeapMb || bot.ramHeap || bot.heapMb || bot.memory?.heapMb || 0);

  // Host RAM
  const hostRamUsedMb = hw ? Number(hw.ramUsedMb) : botRamMb;
  const hostRamTotalMb = hw ? Number(hw.ramTotalMb) : (isEco ? 220 : 380);
  const hostRamPercent = hw ? Number(hw.ramPercent) : (hostRamTotalMb > 0 ? Math.min(100, Math.round((botRamMb / hostRamTotalMb) * 100)) : 0);
  const ramColor = hostRamPercent > 85 ? 'var(--red)' : hostRamPercent > 70 ? 'var(--yellow)' : 'var(--green)';
  const botRamDisplay = formatHardwareMetric(botRamMb);
  const botHeapDisplay = formatHardwareMetric(botHeapMb);
  const hostRamUsedDisplay = formatHardwareMetric(hostRamUsedMb);
  const hostRamTotalDisplay = formatHardwareMetric(hostRamTotalMb);
  const hostRamPercentDisplay = formatHardwareMetric(hostRamPercent);

  // Host CPU & Net
  const hostCpuPercentDisplay = hw ? formatHardwareMetric(hw.cpuPercent) : '--';
  const cpuColor = hw && hw.cpuPercent > 85 ? 'var(--red)' : hw && hw.cpuPercent > 60 ? 'var(--yellow)' : '#38bdf8';
  const netText = isOffline ? '--' : (hw ? ('↓ ' + formatHardwareMetric(hw.netDownKb) + ' • ↑ ' + formatHardwareMetric(hw.netUpKb) + ' KB/s') : '--');

  const pingSpark = generateSparklineSvg(bot.history?.ping, '#38bdf8');
  const ramSpark = generateSparklineSvg(bot.history?.ram, ramColor);
  const isAdmin = Boolean(currentUser && currentUser.role === 'admin');
  const sec = Number(bot.uptimeSeconds || 0);
  const uptimeText = sec > 0 ? (Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm') : '--';

  // HP Calculation & Bar
  const hpVal = Number.isFinite(Number(bot.health)) ? Number(bot.health) : null;
  const hpText = hpVal !== null ? (Math.round(hpVal) + ' / 20 HP') : (isOffline ? '-- HP (Tắt)' : '--');
  const hpPercent = hpVal !== null ? Math.max(0, Math.min(100, Math.round((hpVal / 20) * 100))) : 0;
  const hpColor = hpVal === null ? '#94a3b8' : (hpVal <= 6 ? 'var(--red)' : hpVal <= 14 ? 'var(--yellow)' : 'var(--green)');

  const rawKickReason = bot.lastKickReason || bot.summary?.lastKickReason || '';
  const lastKickReason = isAdmin ? rawKickReason : humanizeBotErrorForUser(rawKickReason);
  const kickWarning = lastKickReason ? ('<div class="bot-kick-notice">⚠️ <strong>Bị kick:</strong> ' + escapeHtml(lastKickReason) + '</div>') : '';
  const rawIp = String(bot.ipAddress || '').trim();
  const isLoopback = rawIp === '127.0.0.1' || rawIp === 'localhost' || rawIp === '0.0.0.0' || rawIp === '::1';
  const ipDisplay = (!isLoopback && rawIp) ? rawIp : (bot.host ? bot.host : '--');

  // Ownership badge (Hỗ trợ click để lọc theo tag trạng thái thuê)
  let ownerBadgeHtml = '';
  if (bot.rentable === false) {
    ownerBadgeHtml = '<button type="button" class="bot-owner-pill blocked" onclick="event.stopPropagation(); filterByTag(\'sys:not-rentable\')" title="Bấm để lọc các bot Không Cho Thuê" style="background:rgba(148,163,184,0.15);color:var(--muted);border:1px solid rgba(148,163,184,0.3);font-size:11px;padding:2px 8px;border-radius:12px;cursor:pointer;">Không Cho Thuê</button>';
  } else if (bot.assignedUsername) {
    ownerBadgeHtml = '<button type="button" class="bot-owner-pill rented" onclick="event.stopPropagation(); filterByTag(\'sys:rented\')" title="Bấm để lọc các bot Đang Được Thuê (Thuộc: ' + escapeHtml(bot.assignedUsername) + ')" style="cursor:pointer;">' +
      'Thuộc: <strong>' + escapeHtml(bot.assignedUsername) + '</strong>' +
      (bot.assignedPlan ? ' <small>(' + escapeHtml(bot.assignedPlan) + ')</small>' : '') +
      '</button>';
  } else {
    ownerBadgeHtml = '<button type="button" class="bot-owner-pill free" onclick="event.stopPropagation(); filterByTag(\'sys:rentable\')" title="Bấm để lọc các bot Sẵn Sàng Cho Thuê" style="cursor:pointer;">' +
      'Sẵn Sàng Cho Thuê' +
      '</button>';
  }

  const stageInfo = typeof describeBotOperationalStage === 'function'
    ? describeBotOperationalStage(bot)
    : { stageIndex: 1, headlineVi: label, tone: 'warn', needsAccountSetup: username === 'Chưa đặt' };
  const liveAction = (typeof _botActionFeedbackMap !== 'undefined' && _botActionFeedbackMap)
    ? _botActionFeedbackMap.get(id)
    : null;
  const liveActionHtml = liveAction && liveAction.title
    ? ('<div class="bot-action-live-strip' + (liveAction.tone && !liveAction.busy ? (' is-' + escapeHtml(liveAction.tone)) : '') + '">' +
        (liveAction.busy ? '<progress class="loading-spinner" aria-label="Đang thực hiện"></progress>' : '') +
        '<span>' + escapeHtml(liveAction.title) + '</span>' +
      '</div>')
    : '';
  const foodVal = Number.isFinite(Number(bot.food)) ? Number(bot.food) : null;
  const foodSubText = foodVal !== null ? ('Độ no: ' + Math.round(foodVal) + ' / 20') : (isOffline ? 'Độ no: --' : 'Độ no: -- / 20');
  const protChipsHtml = (typeof summarizeBotProtections === 'function' ? summarizeBotProtections(bot) : [])
    .slice(0, 4)
    .map(p => '<span class="bot-prot-chip' + (p.enabled ? ' is-on' : '') + '">' + (p.enabled ? '✓ ' : '') + escapeHtml(p.label) + '</span>')
    .join('');

  const isOnlineIngame = bot.status === 'online' || bot.status === 'afk' || Boolean(bot.online);
  const isConnectingWaiting = ['waking', 'connecting', 'authenticating', 'entering'].includes(String(bot.status || '').toLowerCase());
  const statusGlowClass = isBotUnreachable(bot) ? 'status-unreachable' : (isOnlineIngame ? 'status-online' : (isConnectingWaiting ? 'status-waiting' : 'status-offline'));
  const displayNum = bot.displayIndex !== undefined ? bot.displayIndex : (bot.botNumber || id);
  const idStr = String(displayNum).padStart(2, '0');

  const botTags = Array.isArray(bot.tags) ? bot.tags : [];
  const tagsHtml = botTags.length > 0
    ? ('<div class="bot-tags-wrap" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">' +
        botTags.map(t => '<button type="button" class="bot-tag-chip" data-tag="' + escapeHtml(t) + '" onclick="event.stopPropagation(); filterByTag(this.dataset.tag)" title="Lọc bot theo tag #' + escapeHtml(t) + '" style="font-size:11px;padding:2px 6px;border-radius:4px;background:rgba(168,85,247,0.18);color:#c084fc;border:1px solid rgba(168,85,247,0.3);cursor:pointer;font-weight:600;">#' + escapeHtml(t) + '</button>').join('') +
        (isAdmin ? '<button type="button" class="bot-mini-btn" onclick="event.stopPropagation(); editBotTags(' + escapeHtml(idArg) + ')" title="Chỉnh sửa tags" style="padding:2px 6px;font-size:11px;">🏷️</button>' : '') +
      '</div>')
    : (isAdmin ? '<button type="button" class="bot-mini-btn" onclick="event.stopPropagation(); editBotTags(' + escapeHtml(idArg) + ')" title="Gắn tag phân loại bot (+tag)" style="padding:2px 6px;font-size:11px;opacity:0.7;">＋tag</button>' : '');

  let errorBannerHtml = '';
  if (!bot.available) {
    if (errorType === 'stopped') {
      errorBannerHtml = '';
    } else if (!isAdmin) {
      if (errorType === 'render_sleep' || errorType === 'probing') {
        errorBannerHtml = '<div class="bot-error-action-banner info">' +
          '<div class="bot-error-text">⏳ Máy chủ bot đang khởi động lại, vui lòng đợi ít giây...</div>' +
        '</div>';
      } else {
        errorBannerHtml = '<div class="bot-error-action-banner warning">' +
          '<div class="bot-error-text">⚠️ Hệ thống đang kết nối lại máy chủ bot, vui lòng thử lại sau ít phút.</div>' +
        '</div>';
      }
    } else if (errorType === 'secret_mismatch') {
      errorBannerHtml = '<div class="bot-error-action-banner warning">' +
        '<div class="bot-error-text">⚠️ <strong>Lệch Secret Key (409):</strong> Worker từ chối lệnh do khóa bí mật không khớp với Manager.</div>' +
        (isAdmin ? '<button type="button" class="bot-action-chip warning" onclick="event.stopPropagation(); openEditSecretModal(' + escapeHtml(idArg) + ')" title="Cập nhật Secret Key cho Bot #' + escapeHtml(idStr) + '">🔑 Sửa Secret Key</button>' : '') +
      '</div>';
    } else if (errorType === 'render_sleep') {
      const isRender = bot?.url ? String(bot.url).includes('.onrender.com') : true;
      const is521 = bot?.httpStatus === 521 || String(bot?.lastError || bot?.error || '').includes('521');
      const sleepLabel = is521 ? 'Wispbyte / Cloudflare Đang khởi động (521):' : (isRender ? 'Render Sleep / Timeout (503):' : 'Đang kết nối lại / Timeout (503):');
      const sleepMsg = is521 ? 'Máy chủ Wispbyte đang khởi động hoặc kết nối lại qua Cloudflare edge (~10-20s)...' : (isRender ? 'Máy chủ Cloud đang khởi động từ chế độ ngủ đông (~30-50s) hoặc timeout.' : 'Worker phản hồi chậm hoặc đang tải nặng, đang tự động kết nối lại...');
      errorBannerHtml = '<div class="bot-error-action-banner sleep">' +
        '<div class="bot-error-text">💤 <strong>' + sleepLabel + '</strong> ' + sleepMsg + '</div>' +
        '<button type="button" class="bot-action-chip info" onclick="event.stopPropagation(); quickBotAction(event,' + escapeHtml(idArg) + ',\'restart\')" title="Ping lại kết nối">⚡ Thử lại</button>' +
      '</div>';
    } else if (errorType === 'not_found') {
      errorBannerHtml = '<div class="bot-error-action-banner danger">' +
        '<div class="bot-error-text">❌ <strong>URL không tồn tại (404):</strong> URL worker bị sai hoặc app đã bị xoá khỏi Render.</div>' +
        '<div style="display:flex;gap:4px;">' +
          (isAdmin ? '<button type="button" class="bot-action-chip danger" onclick="event.stopPropagation(); deleteBot(event,' + escapeHtml(idArg) + ')" title="Xoá bot này khỏi registry">🗑 Xoá</button>' : '') +
          (isAdmin ? '<button type="button" class="bot-action-chip" onclick="event.stopPropagation(); editBot(event,' + escapeHtml(idArg) + ')" title="Sửa lại URL">✏️ Sửa URL</button>' : '') +
        '</div>' +
      '</div>';
    } else if (errorType === 'probing') {
      errorBannerHtml = '<div class="bot-error-action-banner info">' +
        '<div class="bot-error-text">⏳ <strong>Đang kết nối:</strong> Đang kiểm tra trạng thái máy chủ bot...</div>' +
      '</div>';
    } else {
      const isWispbyte = String(bot.provider || bot.platform || 'wispbyte').toLowerCase() === 'wispbyte' || !bot.url;
      const humanizedErr = humanizeBotErrorForUser(bot.lastError || bot.error || '');
      const unreachableHtml = isWispbyte
        ? '⚠️ <strong>Container Wispbyte đang tắt:</strong> Container đang ở trạng thái Stopped hoặc vừa tự dừng do chạm giới hạn CPU/RAM.'
        : ('⚠️ <strong>Mất kết nối:</strong> ' + escapeHtml(humanizedErr || 'Worker không phản hồi.'));
      errorBannerHtml = '<div class="bot-error-action-banner danger">' +
        '<div class="bot-error-text">' + unreachableHtml + '</div>' +
        (isAdmin ? '<button type="button" class="bot-action-chip danger" onclick="event.stopPropagation(); deleteBot(event,' + escapeHtml(idArg) + ')" title="Xoá bot này khỏi registry">🗑 Xoá bot</button>' : '') +
      '</div>';
    }
  }

  const lockInfo = getWorkerLockInfo();
  const userExp = lockInfo.userExp || { isExpired: false };
  const isMaintenanceLocked = lockInfo.locked && lockInfo.reason === 'maintenance';
  const isCardLocked = lockInfo.locked;

  const cardDisabledAttr = isCardLocked ? ' disabled="true"' : '';
  const cardDisabledStyle = isCardLocked ? ' style="opacity:0.45; cursor:not-allowed;"' : '';
  const cardDisabledTitle = isCardLocked
    ? (' title="' + escapeHtml(isMaintenanceLocked ? ('Hệ thống đang bảo trì: ' + lockInfo.message) : 'Tính năng điều khiển bị vô hiệu hóa do gói bot đã hết hạn. Hãy gia hạn key để sử dụng.') + '"')
    : '';

  let cardOverlayHtml = '';
  if (isMaintenanceLocked) {
    cardOverlayHtml = '<div class="bot-card-expire-overlay maintenance" onclick="event.stopPropagation()">' +
      '<div class="bot-card-expire-badge">🛠️ HỆ THỐNG ĐANG BẢO TRÌ</div>' +
      '<div class="bot-card-expire-title">TẠM KHÓA THAO TÁC WORKER</div>' +
      '<div class="bot-card-expire-desc">' + escapeHtml(lockInfo.message) + '</div>' +
      '<div class="bot-card-maintenance-note">Thời gian sử dụng bot đang được giữ nguyên, không bị trừ trong lúc bảo trì. Worker sẽ mở lại ngay khi hoàn tất.</div>' +
    '</div>';
  } else if (isCardLocked) {
    if (userExp.inGracePeriod) {
      const remainingMin = Math.max(1, Math.round(userExp.remainingGraceMs / 60000));
      const hours = Math.floor(remainingMin / 60);
      const mins = remainingMin % 60;
      const timeStr = (hours > 0 ? (hours + ' giờ ') : '') + mins + ' phút';

      cardOverlayHtml = '<div class="bot-card-expire-overlay amber" onclick="event.stopPropagation()">' +
        '<div class="bot-card-expire-badge">⏳ THỜI GIAN ÂN HẠN 6 GIỜ</div>' +
        '<div class="bot-card-expire-title">GÓI BOT ĐÃ HẾT HẠN</div>' +
        '<div class="bot-card-expire-desc">' +
          '🎮 <strong>Bot vẫn tiếp tục chạy trong game.</strong><br>' +
          'Thời gian ân hạn còn lại: <strong class="grace-countdown-timer" data-expiry="' + userExp.expiryTime + '">' + timeStr + '</strong>.<br>' +
          '<small style="color:var(--muted);">Sau khi hết 6 giờ ân hạn, bot sẽ tự động dừng an toàn.</small>' +
        '</div>' +
        '<div class="card-quick-redeem-row" onclick="event.stopPropagation()">' +
          '<input type="text" class="card-redeem-input" placeholder="Nhập Key gia hạn..." onclick="event.stopPropagation()" onkeydown="if(event.key===\'Enter\'){event.stopPropagation();quickRedeemKeyOnCard(this,' + escapeHtml(idArg) + ');}">' +
          '<button type="button" class="card-redeem-btn amber" onclick="event.stopPropagation();quickRedeemKeyOnCard(this,' + escapeHtml(idArg) + ')">⚡ Gia Hạn</button>' +
        '</div>' +
        '<div class="card-redeem-msg"></div>' +
      '</div>';
    } else {
      cardOverlayHtml = '<div class="bot-card-expire-overlay red" onclick="event.stopPropagation()">' +
        '<div class="bot-card-expire-badge">🛑 HẾT THỜI GIAN ÂN HẠN</div>' +
        '<div class="bot-card-expire-title">BOT ĐÃ DỪNG HOẠT ĐỘNG</div>' +
        '<div class="bot-card-expire-desc">' +
          'Bot đã được dừng an toàn do quá 6 tiếng chưa gia hạn.<br>' +
          '🔒 <strong>Bảo lưu dữ liệu 100%:</strong> Tài khoản Minecraft và cài đặt server của bạn được lưu giữ an toàn.' +
        '</div>' +
        '<div class="card-quick-redeem-row" onclick="event.stopPropagation()">' +
          '<input type="text" class="card-redeem-input" placeholder="Nhập Key mở khóa..." onclick="event.stopPropagation()" onkeydown="if(event.key===\'Enter\'){event.stopPropagation();quickRedeemKeyOnCard(this,' + escapeHtml(idArg) + ');}">' +
          '<button type="button" class="card-redeem-btn red" onclick="event.stopPropagation();quickRedeemKeyOnCard(this,' + escapeHtml(idArg) + ')">🔑 Mở Khóa</button>' +
        '</div>' +
        '<div class="card-redeem-msg"></div>' +
      '</div>';
    }
  }

  const lockedCardClasses = isMaintenanceLocked
    ? ' is-card-expired is-card-maintenance'
    : (isCardLocked ? (' is-card-expired ' + (userExp.inGracePeriod ? 'grace-period' : 'grace-expired')) : '');

  return '<div class="bot-card ' + statusGlowClass + lockedCardClasses + '" data-bot-id="' + escapeHtml(id) + '" tabindex="0" draggable="' + (isAdmin ? 'true' : 'false') + '" ' +
    (isAdmin ? 'ondragstart="startBotDrag(event,' + escapeHtml(idArg) + ')" ondragover="allowBotDrop(event)" ondrop="dropBot(event,' + escapeHtml(idArg) + ')" ondragend="endBotDrag(event)"' : '') +
    ' onkeydown="handleBotCardKeydown(event, this.dataset.botId)" onclick="openBot(this.dataset.botId)">' +
    cardOverlayHtml +

    '<div class="bot-card-topbar">' +
      '<div class="bot-card-title-group">' +
        '<span class="bot-id-chip">#' + escapeHtml(idStr) + '</span>' +
        '<h2 class="bot-card-name" title="' + escapeHtml(bot.label) + '">' + escapeHtml(bot.label) + '</h2>' +
        '<button type="button" class="bot-mini-btn btn-rename-alias" data-bot-id="' + escapeHtml(id) + '" data-bot-label="' + escapeHtml(bot.label) + '" ' + cardDisabledAttr + (isCardLocked ? cardDisabledStyle + cardDisabledTitle : 'title="Đổi tên / Ghi chú hiển thị"') + ' onclick="event.stopPropagation(); handleRenameClick(this)">✏️</button>' +
      '</div>' +
      (isAdmin ?
        '<div class="bot-card-admin-actions" onclick="event.stopPropagation()">' +
          '<button type="button" class="bot-mini-btn" onclick="editBot(event,' + escapeHtml(idArg) + ')" title="Cấu hình bot">⚙ Sửa</button>' +
          '<button type="button" class="bot-mini-btn danger" onclick="deleteBot(event,' + escapeHtml(idArg) + ')" title="Xóa bot khỏi hệ thống">🗑 Xóa</button>' +
        '</div>' : '') +
    '</div>' +

    '<div class="bot-status-strip">' +
      '<div class="bot-status-pill ' + color + '">' +
        '<span class="pulse-status-dot ' + color + '"></span>' +
        '<span>' + escapeHtml(humanizeStatusPillVi(bot.status, label, bot.available, !!bot.manuallyStopped, errorType)) + '</span>' +
      '</div>' +
      (isEco ? '<span class="eco-badge-glow" title="Eco Mode: Tiết kiệm CPU & khóa RAM < 220MB">ECO</span>' : '') +
      '<div class="bot-owner-wrap">' + ownerBadgeHtml + '</div>' +
      tagsHtml +
    '</div>' +
    '<div class="bot-card-stage-bar is-' + escapeHtml(stageInfo.tone) + '"><span>' + escapeHtml(stageInfo.headlineVi) + '</span></div>' +
    liveActionHtml +
    errorBannerHtml +
    (isOffline && errorType !== 'stopped' ? kickWarning : '') +
    ((stageInfo.needsAccountSetup && !isCardLocked)
      ? ('<button type="button" class="bot-setup-cta-btn" onclick="event.stopPropagation(); if(typeof openBotAndFocusAccount===\'function\'){openBotAndFocusAccount(event,' + escapeHtml(idArg) + ');}else{openBot(' + escapeHtml(idArg) + ');}">Thiết lập tài khoản Minecraft →</button>')
      : '') +

    '<div class="bot-ingame-row">' +
      '<div class="bot-ingame-user" title="Nhân vật Minecraft ingame">' +
        '<span class="ingame-name">Nhân vật: ' + escapeHtml(username) + '</span>' +
      '</div>' +
      (isAdmin ? ('<div class="bot-ip-pill btn-copy-bot-ip" data-ip="' + escapeHtml(ipDisplay) + '" title="Click để sao chép IP Bot: ' + escapeHtml(ipDisplay) + '" style="cursor:pointer;">' +
        '<span>IP: ' + escapeHtml(ipDisplay) + '</span>' +
        (ipDisplay !== '--' ? '<button type="button" class="btn-copy-bot-ip bot-mini-btn" data-ip="' + escapeHtml(ipDisplay) + '" title="Sao chép IP bot" style="padding:1px 5px;font-size:10px;margin-left:4px;cursor:pointer;">Chép</button>' : '') +
      '</div>') : '') +
    '</div>' +

    '<div class="bot-vitals-matrix">' +
      '<div class="vital-card hp-card">' +
        '<div class="vital-label-row">' +
          '<span class="vital-label">Sinh lực (HP)</span>' +
          '<span class="vital-val" style="color:' + hpColor + ';">' + hpText + '</span>' +
        '</div>' +
        '<div class="hp-bar-track">' +
          '<div class="hp-bar-fill" style="width:' + hpPercent + '%;background:' + hpColor + ';"></div>' +
        '</div>' +
        '<div class="vital-sub-info">' + escapeHtml(foodSubText) + '</div>' +
      '</div>' +

      '<div class="vital-card totem-card">' +
        '<div class="vital-label-row">' +
          '<span class="vital-label">Totem dự trữ</span>' +
          '<span class="vital-val" style="color:var(--gold);">' + totems + ' cái</span>' +
        '</div>' +
        (totems === 0 ?
          '<div class="totem-warning-badge">Hết Totem</div>' :
          '<div class="totem-ok-badge">An toàn</div>') +
      '</div>' +

      '<div class="vital-card ping-card">' +
        '<div class="vital-label-row">' +
          '<span class="vital-label">Ping / TPS</span>' +
          '<span class="vital-val" style="color:#38bdf8;">' + escapeHtml(ping) + ' <small style="color:' + tpsColor + ';font-weight:700;">(' + escapeHtml(tpsText) + ')</small></span>' +
        '</div>' +
        '<div class="sparkline-container">' + pingSpark + '</div>' +
      '</div>' +

      '<div class="vital-card uptime-card">' +
        '<div class="vital-label-row">' +
          '<span class="vital-label">Thời gian treo</span>' +
          '<span class="vital-val" style="color:var(--green);">' + uptimeText + '</span>' +
        '</div>' +
        '<div class="vital-sub-info">' + ((!isOffline && humanizeBotLocationVi(bot.locationState || bot.locationKind, bot.dimension)) ? (escapeHtml(humanizeBotLocationVi(bot.locationState || bot.locationKind, bot.dimension)) + ' • ') : 'Tọa độ: ') + escapeHtml(pos) + '</div>' +
      '</div>' +
    '</div>' +

    (protChipsHtml ? ('<div class="bot-protection-row" title="Các cơ chế bảo vệ tự động đang cấu hình">' + protChipsHtml + '</div>') : '') +

    (isAdmin && hostRamTotalMb > 0 ?
      '<div class="bot-ram-meter-box">' +
        '<div class="bot-ram-meter-labels" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;font-size:11px;">' +
          '<span>RAM: <strong style="color:' + ramColor + ';">' + botRamDisplay + ' MB</strong>' + (botHeapMb > 0 ? ' <small style="color:var(--muted);">(Heap: ' + botHeapDisplay + 'MB)</small>' : '') + '</span>' +
          '<span>CPU: <strong style="color:' + cpuColor + ';">' + (isOffline ? '--' : (hw ? hostCpuPercentDisplay + '%' : '--')) + '</strong></span>' +
          '<span>Net: <strong style="color:#a78bfa;">' + netText + '</strong></span>' +
        '</div>' +
        '<div class="ram-meter-track" style="margin-top:6px;">' +
          '<div class="ram-meter-bar-fill" style="width:' + Math.max(4, Math.min(100, hostRamPercent)) + '%;background:' + ramColor + ';" title="Host RAM: ' + hostRamUsedDisplay + '/' + hostRamTotalDisplay + ' MB (' + hostRamPercentDisplay + '%)"></div>' +
        '</div>' +
      '</div>' : '') +

    '<div class="card-quick-actions" onclick="event.stopPropagation()">' +
      '<button type="button" class="small card-btn" ' + cardDisabledAttr + (isCardLocked ? cardDisabledStyle + cardDisabledTitle : '') + ' onclick="quickBotAction(event,' + escapeHtml(idArg) + ',\'restart\')">↻ Restart</button>' +
      (isOffline ?
        '<button type="button" class="small card-btn primary" ' + cardDisabledAttr + (isCardLocked ? cardDisabledStyle + cardDisabledTitle : '') + ' onclick="quickBotAction(event,' + escapeHtml(idArg) + ',\'start\')">▶ Bật</button>' :
        '<button type="button" class="small card-btn danger" ' + cardDisabledAttr + (isCardLocked ? cardDisabledStyle + cardDisabledTitle : '') + ' onclick="quickBotAction(event,' + escapeHtml(idArg) + ',\'stop\')">■ Dừng</button>'
      ) +
      '<button type="button" class="small card-btn detail-link-btn" ' + (isMaintenanceLocked ? (cardDisabledAttr + cardDisabledStyle + cardDisabledTitle) : '') + ' onclick="openBot(' + escapeHtml(idArg) + ')">Chi tiết →</button>' +
    '</div>' +

  '</div>';
}

function startBotDrag(event,id){
  draggedBotId=String(id);
  try{event.dataTransfer.setData('text/plain',String(id));event.dataTransfer.effectAllowed='move';}catch(_){}
  event.currentTarget.classList.add('dragging');
}
function endBotDrag(){
  draggedBotId=null;
  document.querySelectorAll('.bot-card.dragging').forEach(el=>el.classList.remove('dragging'));
}
window.endBotDrag = endBotDrag;
function allowBotDrop(event){event.preventDefault();}
async function dropBot(event,targetId){
  event.preventDefault();
  const sourceId=String((()=>{try{return event.dataTransfer.getData('text/plain')||draggedBotId}catch(_){return draggedBotId}})());
  const destinationId=String(targetId);
  endBotDrag();
  if(!sourceId||sourceId===destinationId)return;
  const ids=bots.map(x=>String(x.workerId||x.id));
  const from=ids.indexOf(sourceId);const to=ids.indexOf(destinationId);
  if(from<0||to<0)return;
  const [item]=ids.splice(from,1);ids.splice(to,0,item);
  try{
    const result=await requestJson('/api/manager/bots/reorder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({botIds:ids})});
    const data=result.data||{};
    if(!result.ok)throw new Error(data.error||'Không thể sắp xếp bot.');
    await refreshHome();
  }catch(err){showToast(err.message||'Không thể sắp xếp bot.');}
}

async function quickRedeemKeyOnCard(btnOrInput, botId) {
  const card = btnOrInput.closest('.bot-card');
  const input = card ? card.querySelector('.card-redeem-input') : null;
  const msgEl = card ? card.querySelector('.card-redeem-msg') : null;
  const key = input ? input.value.trim() : '';
  if (!key) {
    if (msgEl) {
      msgEl.style.color = 'var(--red)';
      msgEl.textContent = 'Vui lòng nhập mã Key gia hạn.';
    }
    return;
  }
  const submitBtn = card ? card.querySelector('.card-redeem-btn') : null;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang xử lý...';
  }
  if (msgEl) {
    msgEl.style.color = '#38bdf8';
    msgEl.textContent = 'Đang kích hoạt Key...';
  }
  try {
    const res = await requestJson('/api/manager/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    if (res.ok) {
      if (input) {
        input.value = '';
        input.removeAttribute('data-dirty');
      }
      if (currentUser) {
        currentUser.status = 'active';
        currentUser.inGracePeriod = false;
        currentUser.isPermanent = Boolean(res.data.isPermanent);
        if (res.data.expiresAt !== undefined) currentUser.expiresAt = res.data.expiresAt;
        if (res.data.planName) currentUser.planName = res.data.planName;
        if (Array.isArray(res.data.assignedBotIds)) currentUser.assignedBotIds = res.data.assignedBotIds;
        applyUserRoleUI();
        updateUserHeaderCountdown();
      }
      showToast('🎉 Kích hoạt / Gia hạn Key thành công! Đã mở khóa toàn bộ tính năng.');
      lastHomeSig = '';
      await refreshHome();
      if (selectedBotId !== null) {
        await refreshDetail(true);
      }
    } else {
      if (msgEl) {
        msgEl.style.color = 'var(--red)';
        msgEl.textContent = res.data?.error || 'Kích hoạt thất bại.';
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '⚡ Gia Hạn';
      }
    }
  } catch (err) {
    if (msgEl) {
      msgEl.style.color = 'var(--red)';
      msgEl.textContent = err.message || 'Lỗi mạng.';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '⚡ Gia Hạn';
    }
  }
}
window.quickRedeemKeyOnCard = quickRedeemKeyOnCard;

let lastGraceExpireRefreshAt = 0;
function updateCardGraceCountdowns() {
  if (typeof currentUser === 'undefined' || !currentUser || currentUser.role === 'admin') return;
  const hasActiveGrace = Boolean(currentUser.inGracePeriod)
    || Boolean(typeof getUserExpirationInfo === 'function' && getUserExpirationInfo()?.inGracePeriod);
  if (!hasActiveGrace) return;
  const timers = document.querySelectorAll('.grace-countdown-timer[data-expiry]');
  if (!timers || timers.length === 0) return;
  const now = Date.now();
  const GRACE_PERIOD_MS = 6 * 60 * 60 * 1000;
  let hasTransitioned = false;

  timers.forEach(el => {
    const exp = parseInt(el.dataset.expiry, 10);
    if (!Number.isFinite(exp)) return;
    const remainingMs = (exp + GRACE_PERIOD_MS) - now;
    if (remainingMs <= 0) {
      hasTransitioned = true;
      el.textContent = '0 phút (Hết ân hạn)';
    } else {
      const remainingSec = Math.floor(remainingMs / 1000);
      const hours = Math.floor(remainingSec / 3600);
      const mins = Math.floor((remainingSec % 3600) / 60);
      const secs = remainingSec % 60;
      el.textContent = (hours > 0 ? (hours + 'h ') : '') + mins + 'm ' + String(secs).padStart(2, '0') + 's';
    }
  });

  if (hasTransitioned && (now - lastGraceExpireRefreshAt >= 20000)) {
    lastGraceExpireRefreshAt = now;
    lastHomeSig = '';
    void refreshHome();
  }
}
window.updateCardGraceCountdowns = updateCardGraceCountdowns;

function renderEditBotTagSuggestions() {
  const container = document.getElementById('editBotTagSuggestions');
  if (!container) return;
  const currentTags = String(document.getElementById('editBotTags')?.value || '')
    .split(/[,;\s]+/)
    .map(t => t.trim().toLowerCase().replace(/^#/, ''))
    .filter(Boolean);
  const currentTagSet = new Set(currentTags);

  const allTags = new Set();
  (bots || []).forEach(b => {
    if (Array.isArray(b.tags)) {
      b.tags.forEach(t => {
        const clean = String(t || '').trim().toLowerCase().replace(/^#/, '');
        if (clean) allTags.add(clean);
      });
    }
  });

  if (allTags.size === 0) {
    container.innerHTML = '<span style="font-size:11px;color:var(--muted);font-style:italic;">Chưa có tag riêng nào trong hệ thống. Gõ tag vào ô trên để thêm mới.</span>';
    return;
  }

  let html = '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;width:100%;">💡 <strong>Bấm chọn nhanh tag riêng đã có:</strong></div>';
  Array.from(allTags).sort().forEach(tag => {
    const isSelected = currentTagSet.has(tag);
    html += '<button type="button" data-tag="' + escapeHtml(tag) + '" onclick="toggleEditBotTag(this.dataset.tag)" style="padding:2px 8px;font-size:11px;border-radius:6px;cursor:pointer;transition:background-color 0.18s ease,border-color 0.18s ease,color 0.18s ease;font-weight:600;' +
      (isSelected
        ? 'background:rgba(56,189,248,0.25);color:#38bdf8;border:1px solid #38bdf8;'
        : 'background:rgba(255,255,255,0.05);color:var(--muted);border:1px solid var(--border);') +
      '">' + (isSelected ? '✓ ' : '＋ ') + '#' + escapeHtml(tag) + '</button>';
  });
  container.innerHTML = html;
}
window.renderEditBotTagSuggestions = renderEditBotTagSuggestions;

function toggleEditBotTag(tag) {
  const input = document.getElementById('editBotTags');
  if (!input) return;
  const cleanTag = String(tag || '').trim().toLowerCase().replace(/^#/, '');
  if (!cleanTag) return;

  const currentTags = input.value.split(/[,;\s]+/).map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
  const idx = currentTags.indexOf(cleanTag);
  if (idx >= 0) {
    currentTags.splice(idx, 1);
  } else {
    currentTags.push(cleanTag);
  }
  input.value = currentTags.join(', ');
  renderEditBotTagPreviews(input.value);
}
window.toggleEditBotTag = toggleEditBotTag;

function renderEditBotTagPreviews(raw) {
  const box = document.getElementById('editBotTagsPreview');
  if (!box) return;
  const tags = String(raw || '').split(/[,;\s]+/).map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
  if (!tags.length) {
    box.innerHTML = '<span style="font-size:11px;color:var(--muted);font-style:italic;">Chưa có tag nào</span>';
  } else {
    box.innerHTML = tags.map(t => '<span style="font-size:11px;padding:2px 8px;border-radius:12px;background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);font-weight:600;">#' + escapeHtml(t) + '</span>').join('');
  }
  renderEditBotTagSuggestions();
}
window.renderEditBotTagPreviews = renderEditBotTagPreviews;

function isClientWispbyteControlPanelUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'wispbyte.com' || host.endsWith('.wispbyte.com')) return true;
    return /^\/client\/servers\/[a-z0-9_-]+/i.test(parsed.pathname || '');
  } catch (_) {
    return false;
  }
}
window.isClientWispbyteControlPanelUrl = isClientWispbyteControlPanelUrl;

function handleEditBotProviderChange({ preserveUrl = false } = {}) {
  const provEl = document.getElementById('editBotProvider');
  const urlEl = document.getElementById('editBotUrl');
  const wispEnvRow = document.getElementById('editBotWispbyteEnvRow');
  if (!provEl || !urlEl) return;
  const provider = String(provEl.value || '').trim().toLowerCase();
  if (wispEnvRow) {
    wispEnvRow.style.display = provider === 'wispbyte' ? '' : 'none';
  }
  if (provider === 'wispbyte') {
    const currentVal = String(urlEl.value || '').trim();
    if (currentVal && !isClientWispbyteControlPanelUrl(currentVal)) {
      urlEl.dataset.prevRenderUrl = currentVal;
    }
    if (!preserveUrl || isClientWispbyteControlPanelUrl(currentVal)) {
      urlEl.value = '';
    }
    urlEl.placeholder = 'Để trống — Wispbyte dùng chế độ Pull (không cần URL)';
  } else {
    if (!String(urlEl.value || '').trim() && urlEl.dataset?.prevRenderUrl) {
      urlEl.value = urlEl.dataset.prevRenderUrl;
    }
    urlEl.placeholder = 'https://kbot-instance.onrender.com (hoặc để trống nếu có Service ID)';
  }
}
window.handleEditBotProviderChange = handleEditBotProviderChange;

function resetEditBotWispbyteEnvPreview() {
  const previewEl = document.getElementById('editBotWispbyteEnvPreview');
  if (previewEl) {
    previewEl.value = '';
    previewEl.style.display = 'none';
  }
}

async function copyEditBotWispbyteEnv() {
  const id = String(document.getElementById('editBotId')?.value || '').trim();
  const btn = document.getElementById('copyEditBotWispbyteEnvBtn');
  const previewEl = document.getElementById('editBotWispbyteEnvPreview');
  if (!id) {
    showToast('Không xác định được bot cần lấy ENV.');
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const result = await requestJson('/api/manager/bot/' + encodeURIComponent(id) + '/env');
    const data = result.data || {};
    if (!result.ok || !data.envText) {
      throw new Error(data.error || 'Không thể lấy cấu hình ENV của bot.');
    }
    if (previewEl) {
      previewEl.value = data.envText;
      previewEl.style.display = 'block';
    }
    await copyText(data.envText);
    showToast('Đã sao chép ENV Wispbyte (chỉ cần Worker ID, tự đồng bộ URL Manager)!', 'success');
  } catch (err) {
    showToast(err.message || 'Không thể lấy cấu hình ENV Wispbyte.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.copyEditBotWispbyteEnv = copyEditBotWispbyteEnv;

function editBot(event,id){
  if(event)event.stopPropagation();
  const requestedId=String(id);
  const bot=bots.find(x=>String(x.workerId||x.id)===requestedId);
  if(!bot)return;
  const workerId=String(bot.workerId||bot.id||id);
  document.getElementById('editBotId').value=workerId;
  const provEl = document.getElementById('editBotProvider');
  const urlEl = document.getElementById('editBotUrl');
  if (urlEl && urlEl.dataset) delete urlEl.dataset.prevRenderUrl;
  const looksWispPanel = isClientWispbyteControlPanelUrl(bot.url || '');
  const initialProvider = (() => {
    const pLower = String(bot.provider || '').trim().toLowerCase();
    return (pLower === 'wispbyte' || looksWispPanel || (!pLower && !bot.url)) ? 'wispbyte' : 'render';
  })();
  if (provEl) {
    provEl.value = initialProvider;
  }
  if (urlEl) {
    if (initialProvider === 'wispbyte') {
      if (!looksWispPanel && String(bot.url || '').trim()) {
        urlEl.dataset.prevRenderUrl = String(bot.url).trim();
      }
      urlEl.value = '';
    } else {
      urlEl.value = looksWispPanel ? '' : (bot.url || '');
    }
  }
  resetEditBotWispbyteEnvPreview();
  handleEditBotProviderChange({ preserveUrl: initialProvider === 'render' });
  document.getElementById('editBotLabel').value=bot.label||'';
  const secInput = document.getElementById('editBotSecretKey');
  if (secInput) {
    secInput.value = bot.secretKey || '';
    secInput.type = 'password';
  }
  const tagsVal = Array.isArray(bot.tags) ? bot.tags.join(', ') : '';
  const tagsInput = document.getElementById('editBotTags');
  if (tagsInput) tagsInput.value = tagsVal;
  renderEditBotTagPreviews(tagsVal);
  const rentChk = document.getElementById('editBotRentable');
  if (rentChk) rentChk.checked = bot.rentable !== false;
  const rentStatusEl = document.getElementById('editBotRentalStatus');
  if (rentStatusEl) {
    if (bot.assignedUsername) {
      rentStatusEl.innerHTML = '<span style="color:#d8b4fe;font-weight:600;">👤 Đang được thuê bởi: <strong>' + escapeHtml(bot.assignedUsername) + '</strong></span>';
    } else if (bot.rentable === false) {
      rentStatusEl.innerHTML = '<span style="color:var(--muted);font-weight:600;">🚫 Đang khóa cho thuê (Dùng nội bộ / riêng)</span>';
    } else {
      rentStatusEl.innerHTML = '<span style="color:#7dd3fc;font-weight:600;">✨ Đang sẵn sàng cho thuê (Chưa có người thuê)</span>';
    }
  }
  document.getElementById('editBotModal').classList.remove('hidden');
}
function closeEditBotModal(){
  resetEditBotWispbyteEnvPreview();
  document.getElementById('editBotModal').classList.add('hidden');
}
async function saveEditBot(){
  const id=String(document.getElementById('editBotId').value||'').trim();
  if(!id){showToast('Không xác định được bot cần sửa.');return;}
  let url=document.getElementById('editBotUrl').value.trim();
  const label=document.getElementById('editBotLabel').value.trim();
  const secInput = document.getElementById('editBotSecretKey');
  const secretKey = secInput ? secInput.value.trim() : undefined;
  const rawTags=document.getElementById('editBotTags')?.value || '';
  const tags = rawTags.split(/[,;\s]+/).map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
  const rentable = document.getElementById('editBotRentable') ? document.getElementById('editBotRentable').checked : true;
  const selectedProvider = String(document.getElementById('editBotProvider')?.value || '').trim().toLowerCase();
  const targetBotObj = bots.find(b => String(b.workerId || b.id) === id);
  const isPanelUrl = isClientWispbyteControlPanelUrl(url);
  const targetProvider = isPanelUrl
    ? 'wispbyte'
    : String(selectedProvider || targetBotObj?.provider || targetBotObj?.source || '').toLowerCase();
  const isRenderProvider = targetProvider === 'render';
  const hasRenderServiceId = Boolean(String(targetBotObj?.renderServiceId || targetBotObj?.serviceId || '').trim());
  if (targetProvider === 'wispbyte' || isPanelUrl) {
    url = '';
  }
  if (currentUser?.role !== 'user' && isRenderProvider && !url && !hasRenderServiceId) {
    showToast('Bot Render cần nhập Web URL (https://...) hoặc có sẵn Render Service ID.', 'warning');
    return;
  }
  try{
    let data;
    if (currentUser?.role === 'user') {
      const result = await requestJson('/api/manager/bot/' + encodeURIComponent(id) + '/alias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: label })
      });
      data = result.data || {};
      if (!result.ok) throw new Error(data.error || 'Không thể đổi tên bot.');
      const found = bots.find(b => String(b.workerId||b.id) === id);
      if (found) found.label = data.alias || label || ('bot' + id);
      if (detailBot && String(detailBot.workerId||detailBot.id) === id) {
        detailBot.label = data.alias || label || ('bot' + id);
        const titleEl = document.getElementById('detailTitle');
        if (titleEl) titleEl.textContent = detailBot.label;
      }
    } else {
      const payload = { url, label, tags, rentable };
      if (targetProvider === 'render' || targetProvider === 'wispbyte') {
        payload.provider = targetProvider;
      }
      if (secretKey) payload.secretKey = secretKey;
      const result=await requestJson('/api/manager/bot/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      data=result.data||{};
      if(!result.ok)throw new Error(data.error||'Không thể sửa bot.');
      const found = bots.find(b => String(b.workerId||b.id) === id);
      if (found && data.bot) {
        if (data.bot.label) found.label = data.bot.label;
        if (data.bot.tags) found.tags = data.bot.tags;
        found.rentable = data.bot.rentable !== false;
        if (data.bot.provider) found.provider = data.bot.provider;
        if (data.bot.url !== undefined) found.url = data.bot.url;
        if (data.bot.renderServiceId !== undefined) found.renderServiceId = data.bot.renderServiceId;
      }
      if (detailBot && String(detailBot.workerId||detailBot.id) === id && data.bot?.label) {
        detailBot.label = data.bot.label;
        const titleEl = document.getElementById('detailTitle');
        if (titleEl) titleEl.textContent = detailBot.label;
      }
    }
    closeEditBotModal();
    showToast(data.message||'Đã lưu thông tin bot.');
    lastHomeSig = '';
    updateTagPills();
    filterBots();
    await refreshHome();
  }catch(err){showToast(err.message||'Không thể sửa bot.');}
}

async function openAdminModal(){
  document.getElementById('adminModal').classList.remove('hidden');
  await loadAdminCredentials();
}
function closeAdminModal(){document.getElementById('adminModal').classList.add('hidden');}
async function loadAdminCredentials(){
  const box = document.getElementById('adminCredentialList');
  box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);">⏳ Đang tải thông tin tài khoản bot...</div>';
  try{
    const result=await requestJson('/api/manager/admin/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({}),timeoutMs:15000});
    const data=result.data||{};
    if(!result.ok)throw new Error(data.error||'Không thể mở thông tin bot.');
    box.innerHTML = '';
    if (!data.bots || data.bots.length === 0) {
      box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);">Chưa có bot nào trong danh sách.</div>';
      return;
    }
    (data.bots || []).forEach(bot => {
      const card = document.createElement('div');
      card.className = 'credential-card';
      const title = document.createElement('strong');
      title.textContent = bot.label || ('Bot ' + bot.id);
      card.appendChild(title);
      if (bot.ok) {
        const rowUser = document.createElement('div'); rowUser.className = 'credential-row';
        const valUser = document.createElement('div'); valUser.className = 'credential-value'; valUser.textContent = bot.username || '(Chưa đặt)';
        const btnUser = document.createElement('button'); btnUser.className = 'small'; btnUser.type = 'button'; btnUser.textContent = 'Copy User';
        btnUser.addEventListener('click', () => copyText(bot.username || ''));
        rowUser.appendChild(valUser); rowUser.appendChild(btnUser); card.appendChild(rowUser);

        const rowPass = document.createElement('div'); rowPass.className = 'credential-row';
        const valPass = document.createElement('div'); valPass.className = 'credential-value'; valPass.textContent = '••••••••';
        valPass.setAttribute('data-full-pass', bot.password || '');
        const btnToggle = document.createElement('button'); btnToggle.className = 'small'; btnToggle.type = 'button'; btnToggle.textContent = '👁 Hiện';
        btnToggle.addEventListener('click', function() {
          const masked = valPass.textContent === '••••••••';
          valPass.textContent = masked ? (valPass.getAttribute('data-full-pass') || '(Trống)') : '••••••••';
          btnToggle.textContent = masked ? '🙈 Ẩn' : '👁 Hiện';
        });
        const btnPass = document.createElement('button'); btnPass.className = 'small'; btnPass.type = 'button'; btnPass.textContent = 'Copy Pass';
        btnPass.addEventListener('click', () => copyText(bot.password || ''));
        rowPass.appendChild(valPass); rowPass.appendChild(btnToggle); rowPass.appendChild(btnPass); card.appendChild(rowPass);
      } else {
        const note = document.createElement('div'); note.className = 'note'; note.style.color = 'var(--red)';
        note.textContent = '⚠️ ' + (bot.error || 'Lỗi đọc bot.'); card.appendChild(note);
      }
      box.appendChild(card);
    });
  }catch(err){box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--red);">⚠️ ' + escapeHtml(err.message) + '</div>';}
}

function buildEmptyFleetFilterHtml(totalCount) {
  const n = Math.max(0, Number(totalCount) || 0);
  if (n > 0) {
    return '<div class="panel empty-filter-state" style="grid-column:1/-1;text-align:center;padding:36px 20px;background:var(--card);border:1px dashed var(--border-strong);border-radius:12px;">' +
      '<div style="display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;background:var(--accent-soft);color:var(--accent-text);margin-bottom:10px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>' +
      '<div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">Không có bot nào khớp bộ lọc hiện tại</div>' +
      '<div style="font-size:13px;color:var(--text-muted);max-width:420px;margin:0 auto 16px auto;line-height:1.5;">Hệ thống đang có ' + n + ' bot nhưng bị ẩn bởi từ khóa tìm kiếm, tab trạng thái hoặc nhãn lọc.</div>' +
      '<button type="button" class="small primary empty-filter-reset-btn" onclick="if(typeof resetFleetFilters===\'function\'){resetFleetFilters();}else if(typeof resetBotFilters===\'function\'){resetBotFilters();}">Xóa bộ lọc (' + n + ' bot)</button>' +
      '</div>';
  }
  return '<div class="panel empty-filter-state" style="grid-column:1/-1;text-align:center;padding:36px 20px;background:var(--card);border:1px dashed var(--border);border-radius:12px;">' +
    '<div style="font-size:14.5px;font-weight:600;color:var(--text-primary);margin-bottom:6px;">Chưa có bot nào trong danh sách</div>' +
    '<div style="font-size:12.5px;color:var(--text-muted);max-width:400px;margin:0 auto;line-height:1.5;">Tài khoản hiện chưa được gán bot hoặc chưa khởi tạo worker nào trên hệ thống.</div>' +
    '</div>';
}
window.buildEmptyFleetFilterHtml = buildEmptyFleetFilterHtml;

async function copyText(value){
  try{await navigator.clipboard.writeText(String(value??''));showToast('Đã copy.');}
  catch(_){showToast('Không thể copy trên trình duyệt này.');}
}

function handleBotCardKeydown(event, botId) {
  if (!event || event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (typeof openBot === 'function' && botId) openBot(botId);
  }
}
window.handleBotCardKeydown = handleBotCardKeydown;

(function attachKeyboardAndOfflineResilience() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  function syncOfflineBanner() {
    const banner = document.getElementById('networkOfflineBanner');
    if (!banner || !banner.classList) return;
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (isOffline && typeof banner.classList.remove === 'function') banner.classList.remove('hidden');
    else if (!isOffline && typeof banner.classList.add === 'function') banner.classList.add('hidden');
  }
  syncOfflineBanner();
  document.addEventListener('keydown', (event) => {
    if (!event || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      const openModals = Array.from(document.querySelectorAll('.modal:not(.hidden)'));
      if (openModals.length > 0) {
        const topModal = openModals[openModals.length - 1];
        if (topModal.id === 'commandPaletteModal' && typeof closeCommandPalette === 'function') closeCommandPalette();
        else topModal.classList.add('hidden');
        if (typeof window.__kbotRefreshAppCosmicEngine === 'function') window.__kbotRefreshAppCosmicEngine();
        event.preventDefault();
        return;
      }
      const profileDropdown = document.getElementById('globalUserProfileDropdown');
      if (profileDropdown && !profileDropdown.classList.contains('hidden')) {
        if (typeof closeUserProfileDropdown === 'function') closeUserProfileDropdown();
        else profileDropdown.classList.add('hidden');
        return;
      }
      if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
      return;
    }
    const activeTag = String(document.activeElement?.tagName || '').toUpperCase();
    const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || Boolean(document.activeElement?.isContentEditable);
    if (!isTyping && (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'))) {
      if (typeof openCommandPalette === 'function' && typeof currentUser !== 'undefined' && currentUser) return;
      const searchEl = document.getElementById('searchInput');
      const homeSection = document.getElementById('homePage');
      if (searchEl && homeSection && !homeSection.classList.contains('hidden')) {
        event.preventDefault();
        searchEl.focus();
        searchEl.select?.();
      }
    }
  });
})();

