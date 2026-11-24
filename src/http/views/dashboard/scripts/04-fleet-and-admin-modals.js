const _inFlightQuickActions = new Set();
async function quickBotAction(event, id, action) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  const lockInfo = (typeof getWorkerLockInfo === 'function') ? getWorkerLockInfo() : { locked: false };
  if (lockInfo && lockInfo.locked) {
    if (typeof showToast === 'function') {
      const prefix = lockInfo.reason === 'maintenance' ? '🛠️ Hệ thống đang bảo trì: ' : '⚠️ ';
      showToast(prefix + lockInfo.message, 'warning', 4500);
    }
    return;
  }
  const btn = event?.currentTarget || (event?.target && typeof event.target.closest === 'function' ? event.target.closest('button') : null);
  const actionKey = String(id) + ':' + String(action);
  if (_inFlightQuickActions.has(actionKey) || btn?.dataset?.inFlight === 'true') {
    return;
  }
  _inFlightQuickActions.add(actionKey);
  if (btn) {
    btn.dataset.inFlight = 'true';
    btn.disabled = true;
    btn.classList.add('is-busy');
  }

  try {
    var targetBot = bots.find(function(b) { return String(b.workerId||b.id) === String(id); });
    if (action === 'start' && (!targetBot?.username || targetBot.username === 'Chưa đặt')) {
      showToast('⚠️ Bot chưa cài đặt tài khoản Minecraft! Đang mở bảng Chi tiết để cài đặt...', 'warning', 4000);
      openBot(id);
      return;
    }
    if (targetBot) {
      if (action === 'start') {
        targetBot.status = 'waking';
        targetBot.manuallyStopped = false;
        targetBot.available = true;
      } else if (action === 'stop') {
        targetBot.status = 'offline';
        targetBot.manuallyStopped = true;
      }
      renderHome();
    }
    showToast('Đang gửi lệnh ' + action + ' tới Bot ' + id + '...');
    try {
      const res = await requestJson('/api/manager/bot/' + id + '/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (res.ok) {
        showToast('Đã thực hiện ' + action + ' Bot ' + id + ' thành công!', 'success');
        lastHomeSig = '';
        void refreshHome();
        setTimeout(() => { lastHomeSig = ''; void refreshHome(); }, 800);
        setTimeout(() => { lastHomeSig = ''; void refreshHome(); }, 2000);
      } else {
        var errText = res.data?.error || ('Lỗi khi ' + action + ' bot.');
        if (errText.indexOf('username') !== -1 || errText.indexOf('password') !== -1 || errText.indexOf('chưa có') !== -1) {
          showToast('⚠️ ' + errText + ' Đang mở Chi tiết để cài đặt...', 'warning', 4000);
          openBot(id);
        } else {
          showToast(errText, 'error');
          lastHomeSig = '';
          void refreshHome();
        }
      }
    } catch (err) {
      showToast(err.message || 'Lỗi kết nối.', 'error');
      lastHomeSig = '';
      void refreshHome();
    }
  } finally {
    _inFlightQuickActions.delete(actionKey);
    if (btn) {
      delete btn.dataset.inFlight;
      btn.disabled = false;
      btn.classList.remove('is-busy');
    }
  }
}
window._inFlightQuickActions = _inFlightQuickActions;
window.quickBotAction = quickBotAction;

let activeStatusFilter = 'all';
const MINECRAFT_ONLINE_STATES = new Set(['online', 'waking', 'connecting', 'authenticating', 'entering']);
const MINECRAFT_ACTIVE_STATES = new Set([...MINECRAFT_ONLINE_STATES, 'afk']);
function isMinecraftOffline(bot) {
  const status = String(bot?.status || '').toLowerCase();
  return bot?.available === true && !MINECRAFT_ACTIVE_STATES.has(status);
}

function setStatusFilter(filter) {
  activeStatusFilter = filter;
  ['all','online','connecting','offline','unreachable'].forEach(k => {
    const el = document.getElementById('tab' + k.charAt(0).toUpperCase() + k.slice(1));
    if (el) el.classList.toggle('active', k === filter);
  });
  filterBots();
}
window.setStatusFilter = setStatusFilter;

function resetBotFilters() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  activeTagFilter = '';
  if (typeof updateTagPills === 'function') updateTagPills();
  setStatusFilter('all');
}
window.resetBotFilters = resetBotFilters;

let soundAlertEnabled = localStorage.getItem('kingmc_mgr_sound') === '1';
let previousOfflineSet = new Set();

let _sharedAudioCtx = null;
function getSharedAudioContext() {
  if (!_sharedAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) _sharedAudioCtx = new AudioCtx();
  }
  if (_sharedAudioCtx && _sharedAudioCtx.state === 'suspended') {
    _sharedAudioCtx.resume().catch(() => {});
  }
  return _sharedAudioCtx;
}

function playAlertTone(type = 'warn') {
  if (!soundAlertEnabled) return;
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type === 'danger' ? 'sawtooth' : 'sine';
    const now = ctx.currentTime;
    if (type === 'danger') {
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.35);
    } else {
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);
    }
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc.start(now);
    osc.stop(now + 0.35);
  } catch (_) {}
}

function toggleSoundAlert() {
  soundAlertEnabled = !soundAlertEnabled;
  localStorage.setItem('kingmc_mgr_sound', soundAlertEnabled ? '1' : '0');
  updateSoundAlertButton();
  if (soundAlertEnabled) playAlertTone('info');
}

function updateSoundAlertButton() {
  const btn = document.getElementById('soundAlertBtn');
  if (!btn) return;
  if (soundAlertEnabled) {
    btn.className = 'small sound-btn active';
    btn.innerHTML = '🔔 Cảnh báo: BẬT';
  } else {
    btn.className = 'small sound-btn';
    btn.innerHTML = '🔕 Cảnh báo: TẮT';
  }
}
window.toggleSoundAlert = toggleSoundAlert;

function exportBotList() {
  const exportData = bots.map(b => ({
    id: b.id,
    label: b.label,
    url: b.url || '',
    ...(b.provider ? { provider: b.provider } : {}),
    ...(b.renderServiceId ? { renderServiceId: b.renderServiceId } : (b.serviceId ? { serviceId: b.serviceId } : {}))
  }));
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = 'kingmc_bots_backup.json';
  a.click();
  setTimeout(() => { try { URL.revokeObjectURL(objectUrl); } catch (_) {} }, 1000);
  showToast('Đã xuất danh sách bot ra file JSON!');
}
window.exportBotList = exportBotList;

function triggerImport() {
  const input = document.getElementById('importFileInput');
  if (input) input.click();
}
window.triggerImport = triggerImport;

async function handleImportFile(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  event.target.value = '';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('File JSON không đúng định dạng danh sách bot.');
    showToast('Đang khôi phục ' + data.length + ' bot từ file...');
    const botsToImport = data.map(item => {
      const rawUrl = String(item.url || item.endpoint || item.sourceUrl || '').trim();
      const provider = String(item.provider || '').trim() || undefined;
      const serviceId = String(item.renderServiceId || item.serviceId || '').trim() || undefined;
      return {
        ...(item.id !== undefined ? { id: item.id } : {}),
        url: rawUrl ? normalizeClientBotUrl(rawUrl) : '',
        label: String(item.label || item.name || '').trim(),
        ...(provider ? { provider } : {}),
        ...(serviceId ? { serviceId } : {}),
        secretKey: item.secretKey ? String(item.secretKey).trim() : undefined
      };
    }).filter(b => Boolean(b.url || b.serviceId || (b.provider && b.provider !== 'render')));

    if (!botsToImport.length) {
      showToast('Không tìm thấy cấu hình bot hợp lệ nào trong file JSON.');
      return;
    }

    const BATCH_SIZE = 50;
    let totalAdded = 0;
    let totalSkipped = 0;
    let lastError = '';
    for (let i = 0; i < botsToImport.length; i += BATCH_SIZE) {
      const batch = botsToImport.slice(i, i + BATCH_SIZE);
      const res = await requestJson('/api/manager/bots/batch-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bots: batch })
      });
      if (!res.ok) {
        lastError = res.data?.error || 'Thao tác không thành công.';
        break;
      }
      const payload = res.data || {};
      totalAdded += payload.addedCount || (payload.bots || []).length || 0;
      totalSkipped += payload.skippedCount || (payload.skipped || []).length || 0;
    }

    if (!lastError) {
      showToast('Đã khôi phục thành công ' + totalAdded + ' bot mới!' + (totalSkipped ? ' (Bỏ qua ' + totalSkipped + ')' : ''));
      lastHomeSig = '';
      await refreshHome();
    } else {
      showToast('Lỗi nhập bot' + (totalAdded ? ' (đã nhập ' + totalAdded + ')' : '') + ': ' + lastError);
      if (totalAdded > 0) {
        lastHomeSig = '';
        await refreshHome();
      }
    }
  } catch (err) {
    showToast('Lỗi đọc file: ' + (err.message || 'Không thể khôi phục.'));
  }
}
window.handleImportFile = handleImportFile;

async function reconnectOfflineBots() {
  const lockInfo = typeof getWorkerLockInfo === 'function' ? getWorkerLockInfo() : { locked: false, message: '' };
  if (lockInfo.locked) {
    showToast(lockInfo.message || 'Hệ thống đang tạm khóa điều khiển worker.', 'warning');
    return;
  }
  const offlineList = bots.filter(b => (!b.available || b.status === 'offline' || b.status === 'kicked' || b.status === 'error') && !b.manuallyStopped);
  if (!offlineList.length) {
    showToast('Tất cả bot đều đang hoạt động tốt!');
    return;
  }
  if (!confirm('Kết nối lại ' + offlineList.length + ' bot đang Offline / Lỗi?')) return;
  showToast('Đang kết nối lại ' + offlineList.length + ' bot...');
  if (currentUser?.role === 'admin') {
    try {
      const res = await requestJson('/api/manager/all/reconnect', { method: 'POST', timeoutMs: 30000 });
      if (res.ok) {
        showToast(res.data?.message || ('Đã gửi lệnh kết nối lại các bot lỗi!'), 'success');
        await refreshHome();
        return;
      }
    } catch (_) {}
  }
  let success = 0;
  for (const b of offlineList) {
    try {
      const res = await requestJson('/api/manager/bot/' + encodeURIComponent(String(b.workerId || b.id)) + '/start', {
        method: 'POST',
        timeoutMs: 15000
      });
      if (res.ok) success++;
    } catch (_) {}
  }
  showToast('Đã kích hoạt kết nối lại ' + success + '/' + offlineList.length + ' bot!');
  await refreshHome();
}
window.reconnectOfflineBots = reconnectOfflineBots;

let currentSortMode = 'default';
function changeBotSort(mode) {
  currentSortMode = mode || 'default';
  filterBots();
}
window.changeBotSort = changeBotSort;

function updateKpis() {
  const total = bots.length;
  const online = bots.filter(b => b.available && (b.status === 'online' || b.status === 'afk' || b.online)).length;
  const connecting = bots.filter(b => b.available && ['waking', 'connecting', 'authenticating', 'entering'].includes(String(b.status || '').toLowerCase()) && b.status !== 'online' && b.status !== 'afk').length;
  const offline = bots.filter(isMinecraftOffline).length;
  const unreachable = bots.filter(b => b.available !== true).length;

  const tEl = document.getElementById('kpiTotal'); if(tEl) tEl.textContent = String(total);
  const oEl = document.getElementById('kpiOnline'); if(oEl) oEl.textContent = String(online);
  const cEl = document.getElementById('kpiConnecting'); if(cEl) cEl.textContent = String(connecting);
  const fEl = document.getElementById('kpiOffline'); if(fEl) fEl.textContent = String(offline);
  const uEl = document.getElementById('kpiUnreachable'); if(uEl) uEl.textContent = String(unreachable);

  updateTagPills();

  // Cập nhật Fleet Resource Bar (Eco & RAM Fleet & Host Hardware Aggregation)
  const ecoCount = bots.filter(b => b.available && b.settings?.ecoMode !== false && b.ecoMode !== false).length;
  const activeBots = bots.filter(b => b.available && b.status !== 'offline' && b.status !== 'kicked');
  const totalFleetRam = bots.reduce((sum, b) => sum + Number(b.hostHardware?.botRssMb || b.ramRss || b.rssMb || b.memory?.rssMb || 0), 0);
  const avgFleetRam = activeBots.length > 0 ? totalFleetRam / activeBots.length : 0;

  // Tính tổng RAM đã dùng / Tổng RAM được cấp, Trung bình % CPU và Tổng băng thông toàn bộ bot
  const botsWithHw = activeBots.filter(b => b.hostHardware && Number(b.hostHardware.ramTotalMb) > 0);
  let fleetRamUsedMb = 0;
  let fleetRamTotalMb = 0;
  let fleetCpuSum = 0;
  let fleetRxKbps = 0;
  let fleetTxKbps = 0;

  for (const b of botsWithHw) {
    fleetRamUsedMb += Number(b.hostHardware.ramUsedMb || b.hostHardware.botRssMb || 0);
    fleetRamTotalMb += Number(b.hostHardware.ramTotalMb || 0);
    fleetCpuSum += Number(b.hostHardware.cpuPercent || 0);
    fleetRxKbps += Number(b.hostHardware.netDownKb || 0);
    fleetTxKbps += Number(b.hostHardware.netUpKb || 0);
  }

  const fleetRamPercent = fleetRamTotalMb > 0 ? Math.round((fleetRamUsedMb / fleetRamTotalMb) * 1000) / 10 : 0;
  const avgFleetCpu = botsWithHw.length > 0 ? Math.round((fleetCpuSum / botsWithHw.length) * 10) / 10 : 0;

  const ecoCountEl = document.getElementById('fleetEcoCount'); if(ecoCountEl) ecoCountEl.textContent = String(ecoCount);
  const ecoTotalEl = document.getElementById('fleetEcoTotal'); if(ecoTotalEl) ecoTotalEl.textContent = String(total);
  const totalRamEl = document.getElementById('fleetTotalRam');
  if (totalRamEl) {
    if (fleetRamTotalMb > 0) {
      totalRamEl.textContent = formatHardwareMetric(fleetRamUsedMb) + ' / ' + formatHardwareMetric(fleetRamTotalMb) + ' MB (' + formatHardwareMetric(fleetRamPercent) + '%)';
    } else {
      totalRamEl.textContent = formatHardwareMetric(totalFleetRam) + ' MB RSS';
    }
  }
  const avgRamEl = document.getElementById('fleetAvgRam'); if(avgRamEl) avgRamEl.textContent = formatHardwareMetric(avgFleetRam) + ' MB RSS';
  const cpuSavedEl = document.getElementById('fleetCpuSaved');
  if (cpuSavedEl) {
    if (botsWithHw.length > 0) {
      cpuSavedEl.textContent = formatHardwareMetric(avgFleetCpu) + '% TB' + (fleetRxKbps > 0 || fleetTxKbps > 0 ? ' • ↓' + formatHardwareMetric(fleetRxKbps) + ' ↑' + formatHardwareMetric(fleetTxKbps) + ' KB/s' : '');
    } else {
      cpuSavedEl.textContent = ecoCount > 0 ? '~80%' : '0%';
    }
  }

  // Cập nhật số đếm trên các Tab Bộ lọc
  const cAll = document.getElementById('countAll'); if(cAll) cAll.textContent = String(total);
  const cOn = document.getElementById('countOnline'); if(cOn) cOn.textContent = String(online);
  const cConn = document.getElementById('countConnecting'); if(cConn) cConn.textContent = String(connecting);
  const cOff = document.getElementById('countOffline'); if(cOff) cOff.textContent = String(offline);
  const cUn = document.getElementById('countUnreachable'); if(cUn) cUn.textContent = String(unreachable);

  // Âm thanh cảnh báo nếu có bot vừa mất kết nối
  const currentOfflineIds = new Set(bots.filter(b => (!b.available || b.status === 'offline' || b.status === 'kicked') && !b.manuallyStopped).map(b => b.id));
  if (previousOfflineSet.size > 0) {
    for (const id of currentOfflineIds) {
      if (!previousOfflineSet.has(id)) {
        playAlertTone('danger');
        break;
      }
    }
  }
  previousOfflineSet = currentOfflineIds;
}

let activeTagFilter = '';
function filterByTag(tag) {
  const normalized = String(tag || '').trim().toLowerCase();
  // Nếu bấm lại vào tag đang chọn -> tự động bỏ lọc (quay về Tất cả)
  if (activeTagFilter === normalized) {
    activeTagFilter = '';
  } else {
    activeTagFilter = normalized;
  }
  updateTagPills();
  filterBots();
}
window.filterByTag = filterByTag;

function updateTagPills() {
  const container = document.getElementById('tagPillsContainer');
  if (!container) return;

  const totalCount = (bots || []).length;
  // Đếm 3 nhóm trạng thái thuê:
  // 1. Cho thuê (Sẵn sàng / Trống): rentable !== false && không có người thuê
  const countRentable = (bots || []).filter(b => b.rentable !== false && !b.assignedUsername).length;
  // 2. Đang được thuê: có người thuê
  const countRented = (bots || []).filter(b => Boolean(b.assignedUsername)).length;
  // 3. Không cho thuê: rentable === false
  const countNotRentable = (bots || []).filter(b => b.rentable === false).length;

  // Thu thập danh sách tag riêng tự tạo từ b.tags
  const tagMap = new Map();
  (bots || []).forEach(b => {
    if (Array.isArray(b.tags)) {
      b.tags.forEach(t => {
        const clean = String(t || '').trim().replace(/^#/, '');
        if (!clean) return;
        const lower = clean.toLowerCase();
        if (!tagMap.has(lower)) {
          tagMap.set(lower, { display: clean, count: 0 });
        }
        tagMap.get(lower).count++;
      });
    }
  });

  let html = '';

  // 1. Nút Tất cả
  const isAllAct = !activeTagFilter;
  html += '<button type="button" class="tab-btn ' + (isAllAct ? 'active' : '') + '" onclick="filterByTag(\'\')" style="padding:4px 10px;font-size:11px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;" title="Xem toàn bộ bot">';
  html += '<span>🌐 Tất cả</span> <span style="opacity:0.75;font-size:11px;">(' + totalCount + ')</span>';
  html += '</button>';

  // 2. Nhóm trạng thái thuê:
  // Cho thuê
  const isRentableAct = activeTagFilter === 'sys:rentable' || activeTagFilter === 'rentable' || activeTagFilter === 'cho-thue';
  html += '<button type="button" class="tab-btn ' + (isRentableAct ? 'active' : '') + '" onclick="filterByTag(\'sys:rentable\')" style="padding:4px 10px;font-size:11px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;' + (isRentableAct ? 'border-color:#38bdf8;' : '') + '" title="Lọc bot sẵn sàng cho thuê (chưa ai thuê)">';
  html += '<span>✨ Cho thuê</span> <span style="opacity:0.85;font-size:11px;color:' + (isRentableAct ? '#7dd3fc' : 'var(--green)') + ';">(' + countRentable + ')</span>';
  html += '</button>';

  // Đang được thuê
  const isRentedAct = activeTagFilter === 'sys:rented' || activeTagFilter === 'rented' || activeTagFilter === 'dang-thue';
  html += '<button type="button" class="tab-btn ' + (isRentedAct ? 'active' : '') + '" onclick="filterByTag(\'sys:rented\')" style="padding:4px 10px;font-size:11px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;' + (isRentedAct ? 'border-color:#a855f7;' : '') + '" title="Lọc bot hiện đang được khách thuê">';
  html += '<span>👤 Đang thuê</span> <span style="opacity:0.85;font-size:11px;color:' + (isRentedAct ? '#d8b4fe' : '#c084fc') + ';">(' + countRented + ')</span>';
  html += '</button>';

  // Không cho thuê
  const isNotRentableAct = activeTagFilter === 'sys:not-rentable' || activeTagFilter === 'not-rentable' || activeTagFilter === 'khong-cho-thue';
  html += '<button type="button" class="tab-btn ' + (isNotRentableAct ? 'active' : '') + '" onclick="filterByTag(\'sys:not-rentable\')" style="padding:4px 10px;font-size:11px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;' + (isNotRentableAct ? 'border-color:#f59e0b;' : '') + '" title="Lọc bot không cho thuê (dùng riêng / nội bộ)">';
  html += '<span>🚫 Không cho thuê</span> <span style="opacity:0.85;font-size:11px;color:' + (isNotRentableAct ? '#fde047' : 'var(--muted)') + ';">(' + countNotRentable + ')</span>';
  html += '</button>';

  // Vạch phân cách nếu có tag riêng tự tạo
  if (tagMap.size > 0) {
    html += '<span style="color:var(--border);margin:0 2px;user-select:none;font-size:13px;align-self:center;">|</span>';
  }

  // 3. Danh sách tag riêng tự tạo
  const sortedTags = Array.from(tagMap.values()).sort((a, b) => a.display.localeCompare(b.display));
  sortedTags.forEach(t => {
    const isAct = activeTagFilter === t.display.toLowerCase();
    html += '<button type="button" class="tab-btn ' + (isAct ? 'active' : '') + '" data-tag="' + escapeHtml(t.display) + '" onclick="filterByTag(this.dataset.tag)" style="padding:4px 10px;font-size:11px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;' + (isAct ? 'border-color:#ec4899;' : '') + '" title="Lọc theo tag #' + escapeHtml(t.display) + '">';
    html += '<span>#' + escapeHtml(t.display) + '</span> <span style="opacity:0.75;font-size:11px;">(' + t.count + ')</span>';
    html += '</button>';
  });

  container.innerHTML = html;
}
window.updateTagPills = updateTagPills;

function editBotTags(id) {
  editBot(null, id);
  setTimeout(() => {
    const input = document.getElementById('editBotTags');
    if (input) {
      input.focus();
      input.select();
    }
  }, 100);
}
window.editBotTags = editBotTags;

function filterBots() {
  const query = String(document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const grid = document.getElementById('botGrid');
  if(!grid) return;
  const isAdmin = Boolean(currentUser && currentUser.role === 'admin');
  const filtered = bots.filter(b => {
    // 1. Lọc theo Tab trạng thái
    const status = String(b.status || '').toLowerCase();
    if (activeStatusFilter === 'online' && !(b.available && (status === 'online' || status === 'afk' || b.online))) return false;
    if (activeStatusFilter === 'connecting' && !(b.available && ['waking', 'connecting', 'authenticating', 'entering'].includes(status) && status !== 'online' && status !== 'afk')) return false;
    if (activeStatusFilter === 'offline' && !isMinecraftOffline(b)) return false;
    if (activeStatusFilter === 'unreachable' && b.available === true) return false;

    // 2. Lọc theo Tag phân loại & Trạng thái thuê
    if (activeTagFilter) {
      if (activeTagFilter === 'sys:rentable' || activeTagFilter === 'rentable' || activeTagFilter === 'cho-thue') {
        if (b.rentable === false || b.assignedUsername) return false;
      } else if (activeTagFilter === 'sys:rented' || activeTagFilter === 'rented' || activeTagFilter === 'dang-thue') {
        if (!b.assignedUsername) return false;
      } else if (activeTagFilter === 'sys:not-rentable' || activeTagFilter === 'not-rentable' || activeTagFilter === 'khong-cho-thue') {
        if (b.rentable !== false) return false;
      } else {
        const bTags = Array.isArray(b.tags) ? b.tags.map(t => String(t).toLowerCase().replace(/^#/, '')) : [];
        if (!bTags.includes(activeTagFilter)) return false;
      }
    }

    // 3. Lọc theo Từ khóa tìm kiếm
    if(!query) return true;
    return (b.label && b.label.toLowerCase().includes(query)) ||
      (b.username && b.username.toLowerCase().includes(query)) ||
      (isAdmin && b.ipAddress && b.ipAddress.toLowerCase().includes(query)) ||
      (b.status && b.status.toLowerCase().includes(query));
  });

  // 3. Sắp xếp theo chế độ được chọn
  if (currentSortMode === 'status') {
    const order = { online: 1, afk: 1, entering: 2, authenticating: 3, connecting: 4, waking: 5, offline: 6, kicked: 7 };
    filtered.sort((a, b) => (order[a.status] || 99) - (order[b.status] || 99));
  } else if (currentSortMode === 'uptime') {
    filtered.sort((a, b) => (b.uptimeSeconds || 0) - (a.uptimeSeconds || 0));
  } else if (currentSortMode === 'totem') {
    filtered.sort((a, b) => (b.totemCount || 0) - (a.totemCount || 0));
  } else if (currentSortMode === 'name') {
    filtered.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
  }

  if(!filtered.length){
    const emptyHtml = '<div class="panel empty-filter-state" style="grid-column:1/-1;text-align:center;padding:42px 20px;background:rgba(15,23,42,0.65);border:1px dashed rgba(255,255,255,0.12);border-radius:16px;">' +
      '<div style="font-size:36px;margin-bottom:10px;opacity:0.85;">🔍</div>' +
      '<div style="font-size:15px;font-weight:750;color:var(--text);margin-bottom:6px;">Không tìm thấy bot nào</div>' +
      '<div style="font-size:13px;color:var(--muted);max-width:380px;margin:0 auto 16px auto;line-height:1.5;">Không có bot nào khớp với tiêu chí tìm kiếm hoặc bộ lọc hiện tại.</div>' +
      '<button type="button" class="btn btn-secondary" onclick="resetBotFilters()" style="padding:7px 16px;font-size:12px;font-weight:700;border-radius:8px;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.3);color:#38bdf8;cursor:pointer;">' +
      '🔄 Xóa bộ lọc &amp; Hiện tất cả' +
      '</button>' +
      '</div>';
    if(grid.innerHTML!==emptyHtml) grid.innerHTML=emptyHtml;
    return;
  }
  if (draggedBotId !== null) return;
  reconcileBotCards(filtered);
}

function computeBotCardSig(b) {
  const userExp = (typeof getUserExpirationInfo === 'function') ? getUserExpirationInfo() : null;
  const expKey = userExp && userExp.isExpired ? (userExp.inGracePeriod ? 'grace' : 'expired') : 'ok';
  const maintKey = window.systemMaintenance?.enabled ? ('maint:' + (window.systemMaintenance.message || '')) : 'ok';
  const pos = b.position || b.roundedLocation || null;
  const posStr = pos && Number.isFinite(Number(pos.x)) ? `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}` : '';
  return JSON.stringify([
    b.status, b.available, !!b.manuallyStopped, b.label, b.username,
    b.ping !== null && b.ping !== undefined ? Math.round(Number(b.ping) / 10) : null,
    b.tps !== null && b.tps !== undefined ? Number(b.tps).toFixed(1) : null,
    b.health, b.totemCount, Math.floor(Number(b.uptimeSeconds || 0) / 60),
    posStr, b.ecoMode, b.rentable, b.assignedUsername, b.lastError, b.lastKickReason,
    b.ipAddress, b.tags,
    b.hostHardware?.botRssMb ?? b.hardware?.botRamMb ?? null,
    b.hostHardware?.cpuPercent ?? b.hardware?.hostCpuPercent ?? null,
    currentUser?.role || '', expKey, maintKey
  ]);
}

function reconcileBotCards(filtered) {
  const grid = document.getElementById('botGrid');
  if (!grid || draggedBotId !== null) return;

  // Remove non-card elements (such as empty filter state)
  Array.from(grid.children).forEach(child => {
    if (!child.classList.contains('bot-card')) {
      child.remove();
    }
  });

  const currentCards = Array.from(grid.querySelectorAll('.bot-card'));
  const currentMap = new Map();
  currentCards.forEach(c => {
    const id = c.getAttribute('data-bot-id');
    if (id) currentMap.set(id, c);
  });

  const nextIds = new Set(filtered.map(b => String(b.workerId || b.id)));

  // Remove cards that no longer exist
  for (const [id, card] of currentMap.entries()) {
    if (!nextIds.has(id)) card.remove();
  }

  // Update existing cards or insert new cards in exact sorted order
  filtered.forEach((b, idx) => {
    const id = String(b.workerId || b.id);
    const existing = currentMap.get(id);
    const cardSig = computeBotCardSig(b);

    if (existing) {
      if (existing.dataset.cardSig !== cardSig) {
        let newHtml = '';
        try { newHtml = botCardHtml(b); } catch (_) { return; }
        const temp = document.createElement('div');
        temp.innerHTML = newHtml;
        const fresh = temp.firstElementChild;
        if (fresh) {
          const activeEl = document.activeElement;
          const hasFocusInside = activeEl && existing.contains(activeEl);
          const dirtyEls = existing.querySelectorAll ? Array.from(existing.querySelectorAll('[data-dirty="true"]')) : [];
          const hasDirtyInput = dirtyEls.some(el => {
            if (String(el.value || '').trim() === '' && !el.dataset.originalValue) {
              el.removeAttribute('data-dirty');
              return false;
            }
            return true;
          });
          if (!hasFocusInside && !hasDirtyInput) {
            if (existing.innerHTML !== fresh.innerHTML) {
              existing.innerHTML = fresh.innerHTML;
            }
            if (existing.className !== fresh.className) {
              existing.className = fresh.className;
            }
            existing.dataset.cardSig = cardSig;
          }
        }
      }
      const refNode = grid.children[idx] || null;
      if (refNode !== existing) {
        grid.insertBefore(existing, refNode);
      }
    } else {
      let newHtml = '';
      try { newHtml = botCardHtml(b); } catch (_) { return; }
      const temp = document.createElement('div');
      temp.innerHTML = newHtml;
      const fresh = temp.firstElementChild;
      if (fresh) {
        fresh.dataset.cardSig = cardSig;
        const refNode = grid.children[idx] || null;
        grid.insertBefore(fresh, refNode);
      }
    }
  });
}

function renderHome() {
  updateKpis();
  filterBots();
}

let currentUserAnnouncement = null;

function renderAnnouncementHtml(text) {
  if (!text) return '';
  const lines = String(text).split('\n');
  let html = '';
  let inList = false;

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) { html += '<ul style="margin:6px 0 10px;padding-left:20px;">'; inList = true; }
      const itemContent = escapeHtml(trimmed.slice(2));
      html += '<li style="margin-bottom:4px;">' + itemContent + '</li>';
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (!trimmed) {
        html += '<div style="height:8px;"></div>';
      } else {
        html += '<p style="margin:0 0 8px;">' + escapeHtml(line) + '</p>';
      }
    }
  }
  if (inList) html += '</ul>';
  return html;
}

async function checkAndShowAnnouncement() {
  if (!currentUser) return;
  try {
    const res = await requestJson('/api/manager/announcement');
    if (!res.ok || !res.data?.announcement) return;
    const ann = res.data.announcement;
    if (!ann.enabled || !ann.content?.trim()) return;

    const now = new Date();
    const todayStr = now.toLocaleDateString('sv-SE'); // YYYY-MM-DD
    const annId = ann.id || 'default';

    if (ann.mode === 'daily') {
      const dismissedDate = localStorage.getItem('kingmc_ann_dismiss_daily_' + annId);
      if (dismissedDate === todayStr) {
        return; // Đã đóng trong ngày hôm nay!
      }
    } else if (ann.mode === 'every_login') {
      const sessionDismissed = sessionStorage.getItem('kingmc_ann_dismiss_session_' + annId);
      if (sessionDismissed) {
        return; // Đã đóng trong phiên làm việc này!
      }
    } else if (ann.mode === 'time_range') {
      if (ann.startDate && new Date(ann.startDate + 'T00:00:00') > now) return;
      if (ann.endDate && new Date(ann.endDate + 'T23:59:59') < now) return;
      const dismissedDate = localStorage.getItem('kingmc_ann_dismiss_range_' + annId);
      if (dismissedDate === todayStr) {
        return;
      }
    } else {
      const sessionDismissed = sessionStorage.getItem('kingmc_ann_dismiss_session_' + annId);
      if (sessionDismissed) {
        return;
      }
    }

    showUserAnnouncement(ann);
  } catch (_) {}
}

function showUserAnnouncement(ann) {
  if (!ann) return;
  currentUserAnnouncement = ann;
  const titleEl = document.getElementById('userAnnouncementTitle');
  const bodyEl = document.getElementById('userAnnouncementBody');
  const timeEl = document.getElementById('userAnnouncementTime');
  const freqEl = document.getElementById('userAnnouncementFreqNote');

  if (titleEl) titleEl.textContent = ann.title || 'THÔNG BÁO HỆ THỐNG';
  if (bodyEl) bodyEl.innerHTML = renderAnnouncementHtml(ann.content || '');
  if (timeEl) {
    const d = ann.updatedAt ? new Date(ann.updatedAt) : new Date();
    timeEl.textContent = 'Cập nhật: ' + d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN');
  }
  if (freqEl) {
    if (ann.mode === 'daily') {
      freqEl.innerHTML = '🗓️ <span>Thông báo xuất hiện 1 lần mỗi ngày khi truy cập</span>';
    } else if (ann.mode === 'every_login') {
      freqEl.innerHTML = '⚡ <span>Thông báo xuất hiện mỗi phiên đăng nhập</span>';
    } else if (ann.mode === 'time_range') {
      freqEl.innerHTML = '⏳ <span>Áp dụng từ ' + escapeHtml(ann.startDate || '...') + ' đến ' + escapeHtml(ann.endDate || '...') + '</span>';
    }
  }

  document.getElementById('userAnnouncementModal')?.classList.remove('hidden');
}

function dismissUserAnnouncement() {
  document.getElementById('userAnnouncementModal')?.classList.add('hidden');
  if (!currentUserAnnouncement) return;
  const ann = currentUserAnnouncement;
  const annId = ann.id || 'default';
  const todayStr = new Date().toLocaleDateString('sv-SE');

  if (ann.mode === 'daily') {
    localStorage.setItem('kingmc_ann_dismiss_daily_' + annId, todayStr);
  } else if (ann.mode === 'every_login') {
    sessionStorage.setItem('kingmc_ann_dismiss_session_' + annId, '1');
  } else if (ann.mode === 'time_range') {
    localStorage.setItem('kingmc_ann_dismiss_range_' + annId, todayStr);
  } else {
    sessionStorage.setItem('kingmc_ann_dismiss_session_' + annId, '1');
  }
}

async function openAnnouncementAdminModal() {
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền cài đặt thông báo.');
    return;
  }
  try {
    const res = await requestJson('/api/manager/announcement');
    const ann = (res.ok && res.data?.announcement) ? res.data.announcement : {};
    const enabledEl = document.getElementById('announcementEnabled');
    const titleEl = document.getElementById('announcementTitle');
    const contentEl = document.getElementById('announcementContent');
    const modeEl = document.getElementById('announcementMode');
    const startEl = document.getElementById('announcementStartDate');
    const endEl = document.getElementById('announcementEndDate');

    if (enabledEl) enabledEl.checked = ann.enabled !== false;
    if (titleEl) titleEl.value = ann.title || '📢 THÔNG BÁO TỪ QUẢN TRỊ VIÊN';
    if (contentEl) contentEl.value = ann.content || '';
    if (modeEl) modeEl.value = ann.mode || 'daily';
    if (startEl) startEl.value = ann.startDate || '';
    if (endEl) endEl.value = ann.endDate || '';

    handleAnnouncementModeChange();
    document.getElementById('announcementAdminModal')?.classList.remove('hidden');
  } catch (err) {
    showToast('Lỗi tải thông báo: ' + err.message);
  }
}

function closeAnnouncementAdminModal() {
  document.getElementById('announcementAdminModal')?.classList.add('hidden');
}

function handleAnnouncementModeChange() {
  const mode = document.getElementById('announcementMode')?.value;
  const rangeGroup = document.getElementById('announcementDateRangeGroup');
  if (rangeGroup) {
    rangeGroup.style.display = (mode === 'time_range') ? 'block' : 'none';
  }
}

async function saveAnnouncementConfig() {
  const enabled = !!document.getElementById('announcementEnabled')?.checked;
  const title = String(document.getElementById('announcementTitle')?.value || '').trim();
  const content = String(document.getElementById('announcementContent')?.value || '').trim();
  const mode = String(document.getElementById('announcementMode')?.value || 'daily');
  const startDate = String(document.getElementById('announcementStartDate')?.value || '').trim();
  const endDate = String(document.getElementById('announcementEndDate')?.value || '').trim();

  if (!title) { showToast('Vui lòng nhập tiêu đề thông báo.'); return; }
  if (enabled && !content) { showToast('Vui lòng nhập nội dung thông báo.'); return; }

  try {
    const res = await requestJson('/api/manager/announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, title, content, mode, startDate, endDate })
    });
    if (res.ok) {
      showToast(res.data?.message || 'Đã lưu cấu hình thông báo!');
      closeAnnouncementAdminModal();
      checkAndShowAnnouncement();
    } else {
      showToast(res.data?.error || 'Lỗi khi lưu thông báo.');
    }
  } catch (err) {
    showToast('Lỗi kết nối: ' + err.message);
  }
}

function previewAnnouncementModal() {
  const enabled = !!document.getElementById('announcementEnabled')?.checked;
  const title = String(document.getElementById('announcementTitle')?.value || '').trim();
  const content = String(document.getElementById('announcementContent')?.value || '').trim();
  const mode = String(document.getElementById('announcementMode')?.value || 'daily');
  const startDate = String(document.getElementById('announcementStartDate')?.value || '').trim();
  const endDate = String(document.getElementById('announcementEndDate')?.value || '').trim();

  showUserAnnouncement({
    enabled,
    title: title || '📢 THÔNG BÁO XEM TRƯỚC',
    content: content || 'Nội dung thông báo mẫu...',
    mode,
    startDate,
    endDate,
    updatedAt: new Date().toISOString()
  });
}

function openBatchSettingsModal() {
  const tagSelect = document.getElementById('batchTargetTag');
  if (tagSelect) {
    const existingTags = new Set();
    let countRentable = 0;
    let countRented = 0;
    let countNotRentable = 0;
    (bots || []).forEach(b => {
      if (b.rentable === false) countNotRentable++;
      else if (b.assignedUsername) countRented++;
      else countRentable++;

      if (Array.isArray(b.tags)) b.tags.forEach(t => {
        const clean = String(t || '').trim().toLowerCase().replace(/^#/, '');
        if (clean) existingTags.add(clean);
      });
    });

    let html = '<option value="">🌐 Toàn bộ bot trong danh sách (' + (bots || []).length + ' bot)</option>';
    html += '<optgroup label="📋 Nhóm Trạng Thái Thuê">';
    html += '<option value="sys:rentable">✨ Cho thuê (sẵn sàng) (' + countRentable + ' bot)</option>';
    html += '<option value="sys:rented">👤 Đang được thuê (' + countRented + ' bot)</option>';
    html += '<option value="sys:not-rentable">🚫 Không cho thuê (' + countNotRentable + ' bot)</option>';
    html += '</optgroup>';

    if (existingTags.size > 0) {
      html += '<optgroup label="🏷️ Tag riêng tự tạo">';
      Array.from(existingTags).sort().forEach(tag => {
        const count = (bots || []).filter(b => Array.isArray(b.tags) && b.tags.map(x => String(x).toLowerCase().replace(/^#/, '')).includes(tag)).length;
        html += '<option value="' + escapeHtml(tag) + '">🏷️ #' + escapeHtml(tag) + ' (' + count + ' bot)</option>';
      });
      html += '</optgroup>';
    }
    tagSelect.innerHTML = html;
    if (activeTagFilter) {
      tagSelect.value = activeTagFilter.toLowerCase();
    }
  }
  document.getElementById('batchSettingsModal')?.classList.remove('hidden');
}
function closeBatchSettingsModal() {
  document.getElementById('batchSettingsModal')?.classList.add('hidden');
}
function handleBatchScheduleModeChange() {
  const mode = document.getElementById('batchScheduleMode')?.value;
  const isFixed = mode === 'fixed';
  const fixedBox = document.getElementById('batchFixedSettings');
  const cycleBox = document.getElementById('batchCycleSettings');
  if (fixedBox) fixedBox.style.display = isFixed ? 'block' : 'none';
  if (cycleBox) cycleBox.style.display = isFixed ? 'none' : 'block';
}
window.handleBatchScheduleModeChange = handleBatchScheduleModeChange;

async function submitBatchSettings() {
  const targetTag = document.getElementById('batchTargetTag')?.value || '';
  const settings = {
    ecoMode: !!document.getElementById('batchEcoMode')?.checked,
    autoTotem: !!document.getElementById('batchAutoTotem')?.checked,
    antiHungry: !!document.getElementById('batchAntiHungry')?.checked,
    autoReconnect: !!document.getElementById('batchAutoReconnect')?.checked,
    antiAfkKick: !!document.getElementById('batchAntiAfkKick')?.checked
  };

  if (document.getElementById('batchSyncSpawnCommandsEnabled')?.checked) {
    settings.spawnCommands = String(document.getElementById('batchSpawnCommands')?.value || '').trim();
  }

  const syncSchedule = !!document.getElementById('batchSyncScheduleEnabled')?.checked;
  let botSchedules = null;
  if (syncSchedule) {
    const enabled = !!document.getElementById('batchScheduleActive')?.checked;
    const mode = document.getElementById('batchScheduleMode')?.value === 'cycle' ? 'cycle' : 'fixed';
    let items = [];
    if (mode === 'fixed') {
      const stopTime = String(document.getElementById('batchFixedStopTime')?.value || '04:30').trim();
      const startTime = String(document.getElementById('batchFixedStartTime')?.value || '05:30').trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(stopTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
        showToast('Giờ hẹn bật/tắt cố định không hợp lệ.');
        return;
      }
      items = [
        { id: 'batch-stop', action: 'stop', time: stopTime },
        { id: 'batch-start', action: 'start', time: startTime }
      ];
    } else {
      const stopMin = clampClientNumber(document.getElementById('batchCycleStopMinutes')?.value, 120, 1, 43200);
      const startMin = clampClientNumber(document.getElementById('batchCycleStartMinutes')?.value, 300, 1, 43200);
      items = [
        { id: 'batch-stop', action: 'stop', afterMinutes: stopMin },
        { id: 'batch-start', action: 'start', afterMinutes: startMin }
      ];
    }
    botSchedules = [{ id: 'batch-' + Date.now(), enabled, mode, items }];
  }

  showToast('Đang đồng bộ cài đặt' + (syncSchedule ? ' & hẹn giờ' : '') + ' cho các bot...');
  try {
    const payload = { settings, botSchedules };
    if (targetTag) payload.tag = targetTag;
    const res = await requestJson('/api/manager/all/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 25000
    });
    if (res.ok && res.data?.ok && (res.data?.okCount === undefined || res.data?.okCount === res.data?.total)) {
      closeBatchSettingsModal();
      showToast('Đã đồng bộ thành công cho ' + (res.data?.total ?? res.data?.okCount ?? '') + ' bot!');
      await refreshHome();
    } else {
      const failCount = (res.data?.total || 0) - (res.data?.okCount || 0);
      showToast(res.data?.error || ('⚠️ Đồng bộ không hoàn tất: ' + failCount + ' bot thất bại.'));
      await refreshHome();
    }
  } catch(err) {
    showToast(err.message || 'Lỗi kết nối.');
  }
}

async function openWebhookModal() {
  const modal = document.getElementById('webhookModal');
  if(!modal) return;
  modal.classList.remove('hidden');
  try {
    const res = await requestJson('/api/manager/webhook');
    if(res.ok && res.data?.webhook) {
      const w = res.data.webhook;
      document.getElementById('webhookEnabled').checked = !!w.enabled;
      document.getElementById('webhookDiscordUrl').value = w.discordUrl || '';
      document.getElementById('webhookTelegramToken').value = w.telegramToken || '';
      document.getElementById('webhookTelegramChatId').value = w.telegramChatId || '';
      document.getElementById('webhookNotifyOffline').checked = w.notifyOnOffline !== false;
      document.getElementById('webhookNotifyRecover').checked = w.notifyOnRecover !== false;
      document.getElementById('webhookNotifyLowTotem').checked = w.notifyOnLowTotem !== false;
      document.getElementById('webhookNotifyLowHealth').checked = w.notifyOnLowHealth !== false;
      document.getElementById('webhookNotifyDeath').checked = w.notifyOnDeath !== false;
      document.getElementById('webhookOfflineThreshold').value = w.offlineThresholdMinutes || 5;
    }
  } catch(_) {}
}

function closeWebhookModal() {
  document.getElementById('webhookModal')?.classList.add('hidden');
}

async function saveWebhookSettings() {
  const payload = {
    enabled: !!document.getElementById('webhookEnabled')?.checked,
    discordUrl: document.getElementById('webhookDiscordUrl')?.value?.trim() || '',
    telegramToken: document.getElementById('webhookTelegramToken')?.value?.trim() || '',
    telegramChatId: document.getElementById('webhookTelegramChatId')?.value?.trim() || '',
    notifyOnOffline: !!document.getElementById('webhookNotifyOffline')?.checked,
    notifyOnRecover: !!document.getElementById('webhookNotifyRecover')?.checked,
    notifyOnLowTotem: !!document.getElementById('webhookNotifyLowTotem')?.checked,
    notifyOnLowHealth: !!document.getElementById('webhookNotifyLowHealth')?.checked,
    notifyOnDeath: !!document.getElementById('webhookNotifyDeath')?.checked,
    offlineThresholdMinutes: Number(document.getElementById('webhookOfflineThreshold')?.value) || 5
  };
  try {
    const res = await requestJson('/api/manager/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if(!res.ok) throw new Error(res.data?.error || 'Lỗi lưu cấu hình.');
    showToast('✅ Đã lưu cấu hình Webhook thành công!');
    closeWebhookModal();
  } catch(err) {
    showToast('Lỗi: ' + err.message);
  }
}

async function testWebhookSettings() {
  const payload = {
    discordUrl: document.getElementById('webhookDiscordUrl')?.value?.trim() || '',
    telegramToken: document.getElementById('webhookTelegramToken')?.value?.trim() || '',
    telegramChatId: document.getElementById('webhookTelegramChatId')?.value?.trim() || ''
  };
  try {
    showToast('Đang gửi thử tin nhắn Webhook...');
    const res = await requestJson('/api/manager/webhook/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if(!res.ok) throw new Error(res.data?.error || 'Không gửi được test.');
    showToast('✅ ' + (res.data?.message || 'Gửi test thành công!'));
  } catch(err) {
    showToast('Lỗi test: ' + err.message);
  }
}

function generateSparklineSvg(points, strokeColor = '#38bdf8', width = 44, height = 14) {
  const w = Number(width) || 44;
  const h = Number(height) || 14;
  const cleanColor = String(strokeColor || '#38bdf8').replace(/[^a-zA-Z0-9#(),. -]/g, '');
  const midY = Math.round((h / 2) * 10) / 10;

  if (!Array.isArray(points)) {
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:inline-block;vertical-align:middle;margin-left:3px;opacity:0.35;"><line x1="0" y1="' + midY + '" x2="' + w + '" y2="' + midY + '" stroke="' + cleanColor + '" stroke-dasharray="2,2" stroke-width="1"/></svg>';
  }
  const validPts = points.filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if (validPts.length === 0) {
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:inline-block;vertical-align:middle;margin-left:3px;opacity:0.35;"><line x1="0" y1="' + midY + '" x2="' + w + '" y2="' + midY + '" stroke="' + cleanColor + '" stroke-dasharray="2,2" stroke-width="1"/></svg>';
  }
  if (validPts.length === 1) {
    const singleVal = Math.round(validPts[0]);
    const cx = Math.round(w / 2);
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:inline-block;vertical-align:middle;margin-left:3px;opacity:0.85;" title="Điểm đo: ' + singleVal + '"><line x1="0" y1="' + midY + '" x2="' + w + '" y2="' + midY + '" stroke="' + cleanColor + '" stroke-width="1.2" stroke-dasharray="3,2"/><circle cx="' + cx + '" cy="' + midY + '" r="2" fill="' + cleanColor + '"/></svg>';
  }

  const min = Math.min(...validPts);
  const max = Math.max(...validPts);
  const isFlat = min === max;
  const range = isFlat ? 1 : Math.max(1e-6, max - min);
  const step = w / Math.max(1, validPts.length - 1);

  const ptsArr = validPts.map((v, i) => {
    const x = Math.round(i * step * 10) / 10;
    const y = isFlat ? midY : Math.round((h - 2 - ((v - min) / range) * (h - 4)) * 10) / 10;
    return x + ',' + y;
  });

  const pts = ptsArr.join(' ');
  const areaPts = '0,' + h + ' ' + pts + ' ' + w + ',' + h;
  const titleValues = validPts.map(v => Math.round(v)).join(' → ');

  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:inline-block;vertical-align:middle;margin-left:3px;opacity:0.95;overflow:visible;" title="Lịch sử: ' + titleValues + '">' +
    '<polygon fill="' + cleanColor + '" fill-opacity="0.18" points="' + areaPts + '"/>' +
    '<polyline fill="none" stroke="' + cleanColor + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" points="' + pts + '"/>' +
  '</svg>';
}

async function exportBotLogs(event, botId) {
  if(event) event.stopPropagation();
  let url = '';
  try {
    showToast('Đang lấy dữ liệu log của Bot ' + botId + '...');
    const result = await requestJson('/api/manager/bot/' + encodeURIComponent(String(botId)) + '/logs');
    if(!result.ok) throw new Error(result.data?.error || 'Không thể lấy log.');
    const rawLogs = Array.isArray(result.data?.logs) ? result.data.logs : [];
    const formattedLines = rawLogs.map((entry) => {
      if (typeof formatDetailLogEntryText === 'function') {
        const text = formatDetailLogEntryText(entry, true);
        if (text) return text;
      }
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const ts = entry.occurredAt || entry.timestamp || entry.createdAt || entry.time || '';
        const type = entry.type || entry.level || '';
        const msg = entry.message || entry.reason || entry.text || entry.line || JSON.stringify(entry);
        return [ts ? '[' + ts + ']' : '', type ? '[' + String(type).toUpperCase() + ']' : '', msg].filter(Boolean).join(' ');
      }
      return String(entry ?? '');
    }).filter(Boolean);
    const logLines = formattedLines.join('\n') || 'Chưa có dữ liệu log.';
    const blob = new Blob([logLines], { type: 'text/plain;charset=utf-8' });
    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bot-' + botId + '-logs-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('✅ Đã tải file log về máy.');
  } catch(err) {
    showToast('Lỗi tải log: ' + (err.message || 'Không thành công.'));
  } finally {
    if (url) {
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 1000);
    }
  }
}

let lastHomeSig = '';
async function getHomeBots() {
  const url = lastHomeSig ? ('/api/manager/bots?sig=' + encodeURIComponent(lastHomeSig)) : '/api/manager/bots';
  const result = await requestJson(url);
  if(!result.ok){const error=new Error(result.data?.error||('HTTP '+result.status));error.status=result.status;throw error;}
  if(result.data?.sig) lastHomeSig = result.data.sig;
  return result.data||{};
}

async function getRegistryFallback() {
  const result=await requestJson('/api/manager/registry');
  if(!result.ok)throw new Error(result.data?.error||('HTTP '+result.status));
  const data=result.data||{};
  const list=Array.isArray(data.bots)?data.bots:[];
  return {
    ok:true,
    bots:list.map(bot=>({
      id:String(bot.workerId||bot.id),
      workerId:String(bot.workerId||bot.id),
      botNumber:bot.botNumber,
      url:bot.url||'',
      source:bot.source||'unknown',
      botId:String(bot.id),
      label:bot.label||('Bot '+bot.id),
      rentable:bot.rentable!==false,
      configured:!!bot.url,
      available:false,
      username:'',
      status:'offline',
      ready:false,
      ping:null,
      tps:null,
      serverTps:null,
      uptime:'0h 0m 0s',
      uptimeSeconds:0,
      reconnectCount:0,
      host:'',
      port:null,
      position:null,
      dimension:null,
      ipAddress:'',
      locationState:'unknown',
      roundedLocation:null,
      settings:null,
      totemCount:0,
      foodCount:0,
      memory:null,
      rssMb:0,
      heapMb:0,
      error:'Đang chờ bot phản hồi...'
    }))
  };
}

async function refreshHome() {
  if(homeRequestInFlight || selectedBotId!==null) return;
  homeRequestInFlight=true;
  try {
    let data;
    try {
      data=await getHomeBots();
    }catch(primaryError){
      lastHomeSig = '';
      try { data=await getRegistryFallback(); }
      catch(_){ throw primaryError; }
    }
    if (data.currentUser && currentUser) {
      const prevExp = currentUser.expiresAt;
      const prevIsPermanent = currentUser.isPermanent;
      const prevBots = JSON.stringify(currentUser.assignedBotIds || []);
      const prevStatus = currentUser.status;
      const prevPlan = currentUser.planName;
      Object.assign(currentUser, data.currentUser);
      if (prevExp !== currentUser.expiresAt || prevIsPermanent !== currentUser.isPermanent || prevBots !== JSON.stringify(currentUser.assignedBotIds || []) || prevStatus !== currentUser.status || prevPlan !== currentUser.planName) {
        applyUserRoleUI();
        updateUserHeaderCountdown();
      }
    }
    const maintChanged = (data.maintenance && typeof syncSystemMaintenanceState === 'function')
      ? syncSystemMaintenanceState(data.maintenance, { rerender: false })
      : false;
    if (data.unchanged) {
      if (data.managerRamMb) {
        const ramStr = data.managerRamMb + ' MB';
        const r1 = document.getElementById('managerRamUsage');
        const r2 = document.getElementById('detailManagerRamUsage');
        const r3 = document.getElementById('globalManagerRam');
        if (r1) r1.textContent = ramStr;
        if (r2) r2.textContent = ramStr;
        if (r3) r3.textContent = ramStr;
      }
      if (maintChanged) renderHome();
      updateUserHeaderCountdown();
      return;
    }
    bots=Array.isArray(data.bots)?data.bots:[];
    if (data.managerRamMb) {
      const ramStr = data.managerRamMb + ' MB';
      const r1 = document.getElementById('managerRamUsage');
      const r2 = document.getElementById('detailManagerRamUsage');
      const r3 = document.getElementById('globalManagerRam');
      if (r1) r1.textContent = ramStr;
      if (r2) r2.textContent = ramStr;
      if (r3) r3.textContent = ramStr;
    }
    const subtitle=document.getElementById('homeSubtitle');
    if(subtitle) subtitle.textContent='Quản lý tập trung '+bots.length+' bot';
    renderHome();
  updateUserHeaderCountdown();
  } catch(err) {
    const subtitle=document.getElementById('homeSubtitle');
    if(subtitle) subtitle.textContent='Không tải được danh sách bot';
  } finally {
    homeRequestInFlight=false;
  }
}

function updateAddBotUrlCounter() {
  const raw = String(document.getElementById('addBotUrl')?.value || '');
  const tokens = raw.split(/[\r\n\s,]+/).map(s => s.trim()).filter(Boolean);
  const badge = document.getElementById('addBotUrlCountBadge');
  const btn = document.getElementById('confirmAddBotButton');
  if (badge) {
    badge.textContent = tokens.length ? (tokens.length + ' link nhận diện') : 'Wispbyte 2-in-1 (Không cần URL)';
  }
  if (btn) {
    btn.textContent = tokens.length > 1
      ? ('➕ Thêm ' + tokens.length + ' Bot')
      : (tokens.length === 1 ? '➕ Thêm Bot' : '➕ Thêm Cụm Wispbyte (2 Bot)');
  }
}
window.updateAddBotUrlCounter = updateAddBotUrlCounter;

function openAddBotModal() {
  const modal = document.getElementById('addBotModal');
  const formView = document.getElementById('addBotFormView');
  const resultView = document.getElementById('addBotResultView');
  const url = document.getElementById('addBotUrl');
  const label = document.getElementById('addBotLabel');
  if (url) url.value = '';
  if (label) label.value = '';
  if (formView) formView.style.display = 'block';
  if (resultView) resultView.style.display = 'none';
  updateAddBotUrlCounter();
  if (modal) modal.classList.remove('hidden');
  setTimeout(() => url && url.focus(), 50);
}

function closeAddBotModal() {
  const modal = document.getElementById('addBotModal');
  if (modal) modal.classList.add('hidden');
}

function finishAddBotModal() {
  closeAddBotModal();
  lastHomeSig = '';
  refreshHome();
}
window.finishAddBotModal = finishAddBotModal;

async function addBotFromWeb() {
  const button = document.getElementById('confirmAddBotButton');
  const rawInput = String(document.getElementById('addBotUrl')?.value || '').trim();
  const label = String(document.getElementById('addBotLabel')?.value || '').trim();
  const tokens = rawInput.split(/[\r\n\s,]+/).map(s => s.trim()).filter(Boolean);
  if (button) {
    button.disabled = true;
    button.textContent = tokens.length > 1
      ? '⏳ Đang thêm các bot...'
      : (tokens.length === 1 ? '⏳ Đang thêm bot...' : '⏳ Đang tạo cụm Wispbyte...');
  }
  try {
    const bodyPayload = tokens.length
      ? { urls: tokens, url: tokens[0], label }
      : { provider: 'wispbyte', slots: 2, label };
    const result = await requestJson('/api/manager/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    const data = result.data || {};
    if (!result.ok) throw new Error(data.error || 'Không thể thêm bot.');

    if (data.envConfig) {
      const formView = document.getElementById('addBotFormView');
      const resultView = document.getElementById('addBotResultView');
      const envArea = document.getElementById('addBotEnvConfigArea');
      const successTitle = document.getElementById('addBotResultSuccessTitle');
      if (envArea) envArea.value = data.envConfig;
      if (successTitle) successTitle.textContent = '🎉 ' + (data.message || 'Đã thêm Bot thành công!');
      if (formView) formView.style.display = 'none';
      if (resultView) resultView.style.display = 'block';
      showToast(data.message || 'Đã thêm bot thành công!', 'success', 4000);
      lastHomeSig = '';
      await refreshHome();
    } else {
      closeAddBotModal();
      showToast(data.message || 'Đã thêm bot thành công!');
      lastHomeSig = '';
      await refreshHome();
    }
  } catch (err) {
    showToast(err.message || 'Không thể thêm bot.');
  } finally {
    if (button) {
      button.disabled = false;
      updateAddBotUrlCounter();
    }
  }
}

async function deleteBot(event,id) {
  if(event) event.stopPropagation();
  const workerId=String(id);
  const bot=bots.find(x=>String(x.workerId||x.id)===workerId);
  if(!bot) return;
  if(!confirm('Xóa '+(bot.label||('Bot '+id))+' khỏi Manager?')) return;
  try {
    const result=await requestJson('/api/manager/bot/'+encodeURIComponent(workerId),{method:'DELETE'});
    const data=result.data||{};
    if(!result.ok && !data.partial) throw new Error(data.error||'Không thể xóa bot.');
    if(String(selectedBotId)===workerId) goHome();
    showToast(data.message || (data.partial ? ('Đã xóa ' + (bot.label || ('Bot #' + id)) + ' khỏi Supabase & Manager (bot còn lại offline sẽ tự đồng bộ sau).') : 'Đã xóa bot.'));
    bots = bots.filter(x => String(x.workerId||x.id) !== workerId);
    renderHome();
    lastHomeSig = '';
    await refreshHome();
  } catch(err) {
    showToast(err.message||'Không thể xóa bot.');
  }
}

// BUG-26: chỉ 404 có ngữ nghĩa "không còn tồn tại" mới đủ bằng chứng xóa. Các trạng
// thái khác (503 cold start, timeout, DNS, 401/403/409 secret mismatch...) KHÔNG chứng
// minh bot đã bị xóa → chỉ cảnh báo, không nằm trong danh sách xóa hàng loạt.
function classifyUnreachableBotEvidence(b) {
    const status = Number(b.httpStatus);
    const errText = String(b.lastError || b.error || '');
    const lower = errText.toLowerCase();
    if (status === 404 || errText.includes('404') || lower.includes('not found') || errText.includes('không tồn tại')) return '404';
    if (status === 503 || lower.includes('cold start') || lower.includes('waking') || lower.includes('spinning up')) return '503/waking';
    if (status === 401 || status === 403 || lower.includes('secret') || lower.includes('unauthorized') || lower.includes('forbidden')) return '401/403 secret';
    if (status === 409) return '409';
    if (lower.includes('timeout') || lower.includes('abort') || lower.includes('econn') || lower.includes('enotfound') || lower.includes('dns')) return 'timeout/DNS';
    return 'unknown';
}

async function cleanDeadBots() {
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền dọn dẹp bot.', 'error');
    return;
  }
  // Nhóm 1 — bằng chứng mạnh: 404 (endpoint tin cậy xác nhận "không còn tồn tại").
  const deadBots = bots.filter(b => !b.available && classifyUnreachableBotEvidence(b) === '404');
  // Nhóm 2 — chưa xác minh/unreachable: chỉ cảnh báo, tuyệt đối không xóa hàng loạt.
  const unreachables = bots.filter(b => !b.available && classifyUnreachableBotEvidence(b) !== '404');

  if (deadBots.length === 0) {
    if (unreachables.length === 0) {
      showToast('✅ Tất cả bot đang hoạt động ổn định! Không có bot mất kết nối.', 'success', 3500);
      return;
    }
    // BUG-26: không còn mở confirm xóa toàn bộ unreachable. Chỉ cảnh báo kèm bằng
    // chứng từng bot; Admin phải dùng nút Xóa riêng trên từng bot nếu thật sự muốn.
    const msg = '⚠️ Không có bot nào bị xác nhận 404 (đã xoá trên Cloud), nhưng có ' + unreachables.length +
      ' bot đang mất kết nối. Các bot này CHƯA được xác minh là đã bị xóa (có thể do 503 Render cold start, timeout, DNS, hoặc secret mismatch) nên hệ thống KHÔNG tự động xóa:\n' +
      unreachables.map(b => '• #' + b.id + ': ' + b.label + ' — bằng chứng: ' + classifyUnreachableBotEvidence(b) + ' — ' + String(b.lastError || b.error || 'không rõ lỗi').slice(0, 120)).join('\n') +
      '\n\nHãy kiểm tra từng bot (thử Start/Refresh hoặc sửa secret) và chỉ xóa thủ công nếu chắc chắn.';
    showToast(msg.replace(/\n/g, ' '), 'warning', 8000);
    return;
  }

  // Có 404 xác nhận: chỉ đề xuất xóa đúng nhóm 404, đồng thời nêu rõ nhóm unreachable
  // bị loại khỏi danh sách xóa (hai nhóm hiển thị riêng biệt).
  const confirmMsg = 'Phát hiện ' + deadBots.length + ' bot KHÔNG CÒN TỒN TẠI trên Cloud (bằng chứng 404 từ endpoint tin cậy):\n' +
    deadBots.map(b => '• #' + b.id + ': ' + b.label + ' (' + (b.url || 'chưa cấu hình URL') + ')').join('\n') +
    (unreachables.length
      ? '\n\n⚠️ Ngoài ra còn ' + unreachables.length + ' bot chỉ mất kết nối (chưa xác minh 404: ' + unreachables.map(b => '#' + b.id + ' ' + classifyUnreachableBotEvidence(b)).join(', ') + ') — các bot này KHÔNG bị xóa.'
      : '') +
    '\n\nBạn có chắc chắn muốn dọn dẹp và xoá vĩnh viễn CHỈ các bot 404 xác nhận khỏi hệ thống không?';
  if (!confirm(confirmMsg)) return;
  return executeCleanBots(deadBots);
}

async function executeCleanBots(list) {
  showToast('⏳ Đang dọn dẹp ' + list.length + ' bot chết khỏi registry...', 'info', 6000);
  let successCount = 0;
  let failCount = 0;
  for (const b of list) {
    try {
      const res = await requestJson('/api/manager/bot/' + encodeURIComponent(String(b.workerId||b.id)), { method: 'DELETE' });
      if (res.ok || res.data?.partial) successCount++;
      else failCount++;
    } catch (_) {
      failCount++;
    }
  }
  lastHomeSig = '';
  await refreshHome();
  if (failCount === 0) {
    showToast('✅ Đã dọn dẹp thành công ' + successCount + ' bot chết khỏi registry!', 'success', 4500);
  } else {
    showToast('⚠️ Đã xoá ' + successCount + ' bot, có ' + failCount + ' bot gặp lỗi.', 'warning', 4500);
  }
}

function openEditSecretModal(id) {
  editBot(null, id);
  setTimeout(() => {
    const input = document.getElementById('editBotSecretKey');
    if (input) {
      input.focus();
      input.select?.();
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 120);
}

function toggleEditSecretKeyVisibility() {
  const input = document.getElementById('editBotSecretKey');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function openBot(id) {
  const lockInfo = (typeof getWorkerLockInfo === 'function') ? getWorkerLockInfo() : null;
  if (lockInfo && lockInfo.locked && lockInfo.reason === 'maintenance') {
    if (typeof showToast === 'function') showToast('🛠️ Hệ thống đang bảo trì: ' + lockInfo.message, 'warning', 4500);
    return;
  }
  const requestedId=String(id);
  const selected=bots.find(item=>String(item.workerId||item.id)===requestedId)
    || bots.find(item=>String(item.botNumber)===requestedId);
  if (!selected && currentUser && currentUser.role !== 'admin') {
    showToast('⚠️ Bạn không có quyền quản lý bot này.', 'warning', 4000);
    goHome();
    return;
  }
  selectedBotId=String(selected?.workerId||selected?.id||id);
  invalidateDetailReads();
  cancelDetailSlotSelection();
  // Reset all detail UI fields to prevent stale ghost data
  const dChat = document.getElementById('detailChatLogs'); if (dChat) dChat.innerHTML = '<div style="color:var(--muted);padding:8px;">Đang tải lịch sử chat...</div>';
  const dEvt = document.getElementById('detailEventLogs'); if (dEvt) dEvt.innerHTML = '<div style="color:var(--muted);padding:8px;">Đang tải nhật ký sự kiện...</div>';
  const dUser = document.getElementById('detailUsernameInput'); if (dUser) { dUser.value = ''; dUser.removeAttribute('data-dirty'); }
  const dPass = document.getElementById('detailPasswordInput'); if (dPass) { dPass.value = ''; dPass.removeAttribute('data-dirty'); }
  ['detailProxyHost', 'detailProxyPort', 'detailProxyUsername', 'detailProxyPassword'].forEach(pid => {
    const el = document.getElementById(pid);
    if (el) { el.value = ''; if (pid === 'detailProxyPassword') el.placeholder = 'Mật khẩu proxy...'; }
  });
  const dProxyEn = document.getElementById('detailProxyEnabled'); if (dProxyEn) dProxyEn.checked = false;
  const dUp = document.getElementById('detailUptime'); if (dUp) dUp.textContent = '-';
  const dRec = document.getElementById('detailReconnects'); if (dRec) dRec.textContent = '-';
  const dStat = document.getElementById('detailStatus'); if (dStat) dStat.innerHTML = '<span class="dot yellow"></span> Đang tải...';
  const dInv = document.getElementById('detailInventory'); if (dInv) dInv.innerHTML = '';
  const dHot = document.getElementById('detailHotbar'); if (dHot) dHot.innerHTML = '';
  const url=new URL(window.location.href);
  url.searchParams.set('bot',String(selectedBotId));
  url.searchParams.delete('botUrl');
  history.pushState({bot:selectedBotId},'',url);
  document.getElementById('homePage').classList.add('hidden');
  document.getElementById('detailPage').classList.remove('hidden');
  lastEventRevision=-1;
  lastChatRevision=-1;
  lastPositionHistoryRevision=-1;
  lastPositionHistoryFetchedAt=0;
  if (typeof _loadedAdminSettingsBotId !== 'undefined') _loadedAdminSettingsBotId = null;
  detailInventory=null;
  detailSettingsDirty=false;
  detailAutoChatDirty=false;
  detailBotScheduleDirty=false;
  renderDetailRemoteGui(null);
  setTimeout(initDetailChatInputHistory, 50);
  void refreshDetail(true);
}

function goHome() {
  invalidateDetailReads();
  cancelDetailSlotSelection();
  selectedBotId=null;
  const url=new URL(window.location.href);
  url.searchParams.delete('bot');
  url.searchParams.delete('botUrl');
  url.searchParams.delete('botId');
  url.searchParams.delete('id');
  const newSearch = url.searchParams.toString();
  history.replaceState({}, '', url.pathname + (newSearch ? '?' + newSearch : ''));
  document.getElementById('detailPage').classList.add('hidden');
  document.getElementById('homePage').classList.remove('hidden');
  renderHome();
  lastHomeSig = '';
  void refreshHome();
}

async function resolveRouteFromUrl() {
  routeResolving=true;
  try {
    const url=new URL(window.location.href);
    const botIdParam = url.searchParams.get('bot') || url.searchParams.get('botId') || url.searchParams.get('id');
    const identity=normalizeClientBotUrl(url.searchParams.get('botUrl'));
    if(identity || botIdParam){
      try{
        const result=await requestJson('/api/manager/registry');
        const list = result.data?.bots || [];
        const match = botIdParam
          ? (list.find(item => String(item.workerId||item.id) === String(botIdParam)) || list.find(item => String(item.botNumber) === String(botIdParam)))
          : (identity ? list.find(item => item.url && normalizeClientBotUrl(item.url) === identity) : null);
        if(match){
          selectedBotId=String(match.workerId||match.id);
          url.searchParams.set('bot',selectedBotId);
          url.searchParams.delete('botUrl');
          url.searchParams.delete('botId');
          history.replaceState({bot:selectedBotId},'',url);
          invalidateDetailReads();
          document.getElementById('homePage').classList.add('hidden');
          document.getElementById('detailPage').classList.remove('hidden');
          lastEventRevision=-1;
          lastChatRevision=-1;
lastPositionHistoryRevision=-1;
lastPositionHistoryFetchedAt=0;
          detailInventory=null;
          detailSettingsDirty=false;
          detailAutoChatDirty=false;
          detailBotScheduleDirty=false;
          setTimeout(initDetailChatInputHistory, 50);
          await refreshDetail(true);
          return true;
        }
        if (identity) {
          selectedBotId=null;
          document.getElementById('detailPage').classList.add('hidden');
          document.getElementById('homePage').classList.remove('hidden');
          return false;
        }
        // If registry was loaded successfully and the bot is not in the allowed list:
        // Unauthorized or non-existent bot -> Roll back to dashboard URL and homePage
        if (result && result.ok) {
          selectedBotId=null;
          url.searchParams.delete('bot');
          url.searchParams.delete('botUrl');
          url.searchParams.delete('botId');
          url.searchParams.delete('id');
          const newSearch = url.searchParams.toString();
          history.replaceState({}, '', url.pathname + (newSearch ? '?' + newSearch : ''));
          document.getElementById('detailPage').classList.add('hidden');
          document.getElementById('homePage').classList.remove('hidden');
          showToast('⚠️ Bạn không có quyền quản lý bot này.', 'warning', 4000);
          return false;
        }
      }catch(_) {
        // Keep legacy numeric fallback only when the identity lookup itself failed (e.g. network/offline error).
      }
    }

    const id=String(botIdParam||'');
    if(id){
      selectedBotId=id;
      invalidateDetailReads();
      document.getElementById('homePage').classList.add('hidden');
      document.getElementById('detailPage').classList.remove('hidden');
      lastEventRevision=-1;
      lastChatRevision=-1;
lastPositionHistoryRevision=-1;
lastPositionHistoryFetchedAt=0;
      detailInventory=null;
      detailSettingsDirty=false;
      detailAutoChatDirty=false;
      detailBotScheduleDirty=false;
      setTimeout(initDetailChatInputHistory, 50);
      await refreshDetail(true);
      return true;
    }

    selectedBotId=null;
    const pageParam = String(url.searchParams.get('page') || '').trim().toLowerCase();
    if (['users', 'audit', 'backup'].includes(pageParam) && typeof navigateTo === 'function') {
      navigateTo(pageParam, { skipHistory: true });
      return true;
    }
    document.getElementById('detailPage').classList.add('hidden');
    ['userManagementPage', 'auditPage', 'backupPage'].forEach((pid) => {
      const el = document.getElementById(pid);
      if (el) el.classList.add('hidden');
    });
    document.getElementById('homePage').classList.remove('hidden');
    return false;
  } finally {
    routeResolving=false;
  }
}

window.addEventListener('popstate',()=>{
  detailSettingsDirty=false;
  detailAutoChatDirty=false;
  detailBotScheduleDirty=false;
  void resolveRouteFromUrl().then((handled)=>{
    if (!handled && selectedBotId === null) return refreshHome();
  });
});

async function runAllAction(action) {
  const lockInfo = typeof getWorkerLockInfo === 'function' ? getWorkerLockInfo() : { locked: false, message: '' };
  if (lockInfo.locked) {
    showToast(lockInfo.message || 'Hệ thống đang tạm khóa điều khiển worker.', 'warning');
    return;
  }
  if(allLifecycleActionInFlight) return;
  allLifecycleActionInFlight=true;
  const buttonMap={start:'allStartButton',stop:'allStopButton',restart:'allRestartButton'};
  Object.values(buttonMap).forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=true;});
  try {
    const result=await requestJson('/api/manager/all/'+encodeURIComponent(action),{method:'POST',timeoutMs:30000});
    const data=result.data||{};
    if(!result.ok) throw new Error(data.error||'Thao tác thất bại.');
    const items=Array.isArray(data.result?.results)?data.result.results:(Array.isArray(data.results)?data.results:[]);
    const summary=items.map(x=>{
      const label=x.label||(bots.find(b=>String(b.id)===String(x.workerId))?.label)||('Bot '+(x.workerId||'?'));
      const status=x.ok?(x.pending?'PENDING':'OK'):'FAIL';
      return label+': '+status;
    }).join(' | ');
    showToast(summary||data.message||'Đã thực hiện.');
    await refreshHome();
  } catch(err) {
    showToast(err.message||'Không thể thực hiện thao tác.');
  } finally {
    allLifecycleActionInFlight=false;
    Object.values(buttonMap).forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=false;});
    if (typeof renderSystemMaintenanceBanner === 'function') renderSystemMaintenanceBanner();
  }
}

