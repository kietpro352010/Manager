// --- CLIENT-SIDE LINK4M REWARD & ADMIN SETTINGS CONTROLLER ---
var link4mCooldownTimer = null;
var link4mCooldownEnd = 0;

async function loadLink4mStatus() {
  try {
    const res = await requestJson('/api/rewards/link4m/status');
    if (!res.ok) return;
    const data = res.data;
    const badge = document.getElementById('link4mUsageBadge');
    const expiredBadge = document.getElementById('expiredLink4mUsageBadge');
    const btn = document.getElementById('btnUserLink4mReward');
    const expBtn = document.getElementById('btnExpiredLink4mReward');

    if (!data.enabled) {
      if (btn) btn.style.display = 'none';
      if (expBtn) expBtn.style.display = 'none';
      return;
    }

    if (btn) btn.style.display = 'inline-flex';
    if (expBtn) expBtn.style.display = 'inline-flex';

    if (link4mCooldownTimer) {
      clearInterval(link4mCooldownTimer);
      link4mCooldownTimer = null;
    }

    const usedTodayCount = Number(data.todayCount ?? data.usedToday ?? 0) || 0;
    const dailyLimitVal = Number(data.dailyLimit || 2) || 2;
    const remainingVal = data.remainingAttempts !== undefined
      ? Number(data.remainingAttempts)
      : (data.remainingToday !== undefined ? Number(data.remainingToday) : Math.max(0, dailyLimitVal - usedTodayCount));
    const countText = usedTodayCount + '/' + dailyLimitVal + ' lượt';

    // 1. Trường hợp đã vượt đủ 2/2 lần hôm nay
    if (usedTodayCount >= dailyLimitVal || (Number.isFinite(remainingVal) && remainingVal <= 0)) {
      var maxLabel = '<span>✅</span> Đã đạt giới hạn (' + (usedTodayCount || dailyLimitVal) + '/' + dailyLimitVal + ')';
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.55';
        btn.style.filter = 'grayscale(35%)';
        btn.style.cursor = 'not-allowed';
        btn.style.pointerEvents = 'none';
        btn.innerHTML = maxLabel;
        btn.title = 'Bạn đã dùng hết ' + (data.dailyLimit || 2) + '/' + (data.dailyLimit || 2) + ' lượt vượt link hôm nay. Làm mới lúc 00:00 VN.';
      }
      if (expBtn) {
        expBtn.disabled = true;
        expBtn.style.opacity = '0.55';
        expBtn.style.cursor = 'not-allowed';
        expBtn.style.pointerEvents = 'none';
        expBtn.innerHTML = maxLabel;
        expBtn.title = 'Bạn đã dùng hết lượt vượt link hôm nay.';
      }
      return;
    }

    // 2. Trường hợp đang trong thời gian Cooldown 2 tiếng
    var cooldownMs = Number(data.cooldownRemainingMs) || 0;
    if (cooldownMs > 0) {
      link4mCooldownEnd = Date.now() + cooldownMs;

      var renderCooldown = function() {
        var remaining = Math.max(0, link4mCooldownEnd - Date.now());
        if (remaining <= 0) {
          if (link4mCooldownTimer) {
            clearInterval(link4mCooldownTimer);
            link4mCooldownTimer = null;
          }
          void loadLink4mStatus();
          return;
        }

        var totalSec = Math.ceil(remaining / 1000);
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        var timeStr = '';
        if (h > 0) {
          timeStr = h + 'h ' + (m < 10 ? '0' : '') + m + 'm ' + (s < 10 ? '0' : '') + s + 's';
        } else {
          timeStr = m + 'm ' + (s < 10 ? '0' : '') + s + 's';
        }

        var label = '<span>⏳</span> Khả dụng lại sau ' + timeStr;
        var tip = 'Vui lòng chờ khoảng cách 2 tiếng giữa 2 lần vượt link. Còn lại: ' + timeStr;

        if (btn) {
          btn.disabled = true;
          btn.style.opacity = '0.55';
          btn.style.filter = 'grayscale(35%)';
          btn.style.cursor = 'not-allowed';
          btn.style.pointerEvents = 'none';
          btn.innerHTML = label + ' <span id="link4mUsageBadge" style="font-size:11px;background:rgba(0,0,0,0.35);padding:2px 6px;border-radius:4px;color:#cbd5e1;margin-left:4px;">' + countText + '</span>';
          btn.title = tip;
        }
        if (expBtn) {
          expBtn.disabled = true;
          expBtn.style.opacity = '0.55';
          expBtn.style.cursor = 'not-allowed';
          expBtn.style.pointerEvents = 'none';
          expBtn.innerHTML = label + ' <span id="expiredLink4mUsageBadge" style="font-size:11px;background:rgba(0,0,0,0.35);padding:2px 6px;border-radius:4px;margin-left:4px;">' + countText + '</span>';
          expBtn.title = tip;
        }
      };

      renderCooldown();
      link4mCooldownTimer = setInterval(renderCooldown, 1000);
      return;
    }

    // 3. Trường hợp sẵn sàng vượt link (Nút sáng bình thường, click được)
    const isPermanentUser = Boolean(
      data.isPermanent ||
      data.supportMode ||
      (typeof currentUser !== 'undefined' && currentUser?.isPermanent === true)
    );
    const rewardHoursVal = Number(data.rewardHours || 12) || 12;
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.filter = 'none';
      btn.style.cursor = 'pointer';
      btn.style.pointerEvents = 'auto';
      if (isPermanentUser) {
        btn.innerHTML = '<span>❤️</span> Vượt link ủng hộ Admin <span id="link4mUsageBadge" style="font-size:11px;background:rgba(56,189,248,0.25);padding:2px 6px;border-radius:4px;color:#fff;">' + countText + '</span>';
        btn.title = 'Tài khoản VIP Vĩnh Viễn không cộng thêm thời gian — vượt link để ủng hộ Admin (' + countText + ')';
      } else {
        btn.innerHTML = '<span>⚡</span> Vượt link +' + rewardHoursVal + 'h <span id="link4mUsageBadge" style="font-size:11px;background:rgba(56,189,248,0.25);padding:2px 6px;border-radius:4px;color:#fff;">' + countText + '</span>';
        btn.title = 'Vượt link nhận thêm ' + rewardHoursVal + 'h thời gian sử dụng bot (' + countText + ')';
      }
    }
    if (expBtn) {
      expBtn.disabled = false;
      expBtn.style.opacity = '1';
      expBtn.style.filter = 'none';
      expBtn.style.cursor = 'pointer';
      expBtn.style.pointerEvents = 'auto';
      expBtn.innerHTML = '<span>⚡</span> Vượt link +12h hồi sinh tài khoản <span id="expiredLink4mUsageBadge" style="font-size:11px;background:rgba(0,0,0,0.35);padding:2px 6px;border-radius:4px;margin-left:4px;">' + countText + '</span>';
      expBtn.title = 'Vượt link nhận thêm 12h thời gian sử dụng bot (' + countText + ')';
    }
  } catch (_) {}
}

async function startLink4mReward(btn) {
  if (btn && (btn.disabled || btn.style.pointerEvents === 'none')) {
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.setAttribute('data-original-html', btn.innerHTML);
    btn.innerHTML = '<span>⏳</span> Đang tạo liên kết...';
  }

  try {
    const res = await requestJson('/api/rewards/link4m/start', { method: 'POST', body: {} });
    const targetRedirectUrl = res.data?.redirectUrl || res.data?.providerUrl || '';
    if (!res.ok || !targetRedirectUrl) {
      showToast(res.data?.error || res.data?.message || 'Không thể tạo liên kết vượt link.');
      void loadLink4mStatus();
      return;
    }

    showToast('Đang chuyển hướng tới trang vượt link...');
    setTimeout(function() {
      window.location.href = targetRedirectUrl;
    }, 400);
  } catch (err) {
    showToast('Lỗi: ' + err.message);
    void loadLink4mStatus();
  }
}

// Admin Link4M settings
async function loadLink4mAdminSetting() {
  try {
    const res = await requestJson('/api/manager/settings/system');
    if (res.ok && res.data?.settings) {
      const s = res.data.settings;
      const isEnabled = s.link4mRewardEnabled === true;
      const badge = document.getElementById('link4mStatusBadge');
      if (badge) {
        badge.textContent = isEnabled ? 'BẬT' : 'TẮT';
        badge.style.color = isEnabled ? '#4ade80' : '#f87171';
      }
    }
  } catch (_) {}
}

async function toggleLink4mSetting() {
  const badge = document.getElementById('link4mStatusBadge');
  const currentEnabled = badge ? badge.textContent.trim() === 'BẬT' : false;
  const newEnabled = !currentEnabled;

  try {
    const res = await requestJson('/api/manager/settings/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { link4mRewardEnabled: newEnabled }
    });
    if (res.ok) {
      if (badge) {
        badge.textContent = newEnabled ? 'BẬT' : 'TẮT';
        badge.style.color = newEnabled ? '#4ade80' : '#f87171';
      }
      showToast('Đã ' + (newEnabled ? 'BẬT' : 'TẮT') + ' tính năng Vượt Link +12h!');
      void loadLink4mStatus();
    } else {
      showToast('Lỗi cập nhật: ' + (res.data?.error || ''));
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}

var savingLink4mConfig = false;

async function openLink4mConfigModal() {
  try {
    const res = await requestJson('/api/manager/settings/system');
    if (!res.ok || !res.data?.settings) {
      showToast(res.data?.error || 'Không thể tải cấu hình Link4M từ máy chủ, vui lòng thử lại.');
      return;
    }
    const s = res.data.settings;
    const enabledCb = document.getElementById('link4mModalEnabled');
    if (enabledCb) enabledCb.checked = s.link4mRewardEnabled === true;
    const modeSel = document.getElementById('link4mModalMode');
    if (modeSel) modeSel.value = s.link4mMode || 'api';
    const urlInp = document.getElementById('link4mModalUrl');
    if (urlInp) urlInp.value = s.link4mUrl || '';
    const apiTokenInp = document.getElementById('link4mModalApiToken');
    if (apiTokenInp) apiTokenInp.value = s.link4mApiToken || '';
    const hoursInp = document.getElementById('link4mModalHours');
    if (hoursInp) hoursInp.value = s.link4mRewardHours || 12;
    const limitInp = document.getElementById('link4mModalDailyLimit');
    if (limitInp) limitInp.value = s.link4mDailyLimit || 2;
    const secretInp = document.getElementById('link4mModalSecretKey');
    if (secretInp) secretInp.value = s.link4mSecretKey || '';
    updateLink4mModalFields();
    if (s.link4mTokenDecryptionFailed) {
      showToast('Không thể giải mã API Token Link4M cũ, vui lòng nhập lại API Token và bấm Lưu.');
    }
  } catch (err) {
    showToast('Không thể tải cấu hình Link4M: ' + (err?.message || 'Lỗi kết nối'));
    return;
  }
  const modal = document.getElementById('link4mSettingsModal');
  if (modal) modal.classList.remove('hidden');
}

function closeLink4mConfigModal() {
  const modal = document.getElementById('link4mSettingsModal');
  if (modal) modal.classList.add('hidden');
}

function updateLink4mModalFields() {
  const mode = document.getElementById('link4mModalMode')?.value || 'api';
  const customGrp = document.getElementById('link4mCustomUrlGroup');
  const apiGrp = document.getElementById('link4mApiTokenGroup');
  if (customGrp) customGrp.style.display = mode === 'custom_url' ? 'block' : 'none';
  if (apiGrp) apiGrp.style.display = mode === 'api' ? 'block' : 'none';
}

async function saveLink4mConfigModal() {
  if (savingLink4mConfig) return;
  const enabled = document.getElementById('link4mModalEnabled')?.checked === true;
  const mode = document.getElementById('link4mModalMode')?.value || 'api';
  const url = document.getElementById('link4mModalUrl')?.value || '';
  const apiToken = document.getElementById('link4mModalApiToken')?.value || '';
  const hours = parseInt(document.getElementById('link4mModalHours')?.value, 10) || 12;
  const dailyLimit = parseInt(document.getElementById('link4mModalDailyLimit')?.value, 10) || 2;
  const secretKey = document.getElementById('link4mModalSecretKey')?.value || '';

  if (enabled && mode === 'api' && !apiToken.trim()) {
    showToast('Vui lòng nhập Link4M Publisher API Token khi bật chế độ API!');
    return;
  }
  if (enabled && mode === 'custom_url' && !url.trim()) {
    showToast('Vui lòng nhập đường dẫn Link4M cố định khi bật chế độ Link cố định!');
    return;
  }

  savingLink4mConfig = true;
  try {
    const res = await requestJson('/api/manager/settings/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        link4mRewardEnabled: enabled,
        link4mMode: mode,
        link4mUrl: url,
        link4mApiToken: apiToken,
        link4mRewardHours: hours,
        link4mDailyLimit: dailyLimit,
        link4mSecretKey: secretKey
      }
    });
    if (res.ok) {
      showToast('Đã lưu cấu hình Link4M thành công!');
      closeLink4mConfigModal();
      void loadLink4mAdminSetting();
      void loadLink4mStatus();
    } else {
      showToast('Lỗi: ' + (res.data?.error || 'Không thể lưu cài đặt'));
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  } finally {
    savingLink4mConfig = false;
  }
}

async function loadMaintenanceAdminSetting() {
  try {
    const res = await requestJson('/api/manager/maintenance');
    if (res.ok && res.data?.maintenance && typeof syncSystemMaintenanceState === 'function') {
      syncSystemMaintenanceState(res.data.maintenance, { rerender: false });
    }
  } catch (_) {}
}

async function toggleMaintenanceSetting() {
  const currentEnabled = Boolean(
    (typeof getSystemMaintenanceInfo === 'function' ? getSystemMaintenanceInfo().enabled : window.systemMaintenance?.enabled)
  );
  const newEnabled = !currentEnabled;
  const existingMsg = (typeof getSystemMaintenanceInfo === 'function' ? getSystemMaintenanceInfo().message : window.systemMaintenance?.message) || '';
  try {
    const res = await requestJson('/api/manager/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { enabled: newEnabled, message: existingMsg }
    });
    if (res.ok && res.data?.maintenance) {
      if (typeof syncSystemMaintenanceState === 'function') {
        syncSystemMaintenanceState(res.data.maintenance, { rerender: true });
      }
      showToast(res.data.message || (newEnabled ? 'Đã BẬT chế độ bảo trì!' : 'Đã TẮT chế độ bảo trì!'));
      if (typeof refreshHome === 'function') void refreshHome();
    } else {
      showToast('Lỗi cập nhật bảo trì: ' + (res.data?.error || 'Không thành công'));
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}

async function openMaintenanceConfigModal() {
  try {
    const res = await requestJson('/api/manager/maintenance');
    const maint = res.ok && res.data?.maintenance
      ? res.data.maintenance
      : (typeof getSystemMaintenanceInfo === 'function' ? getSystemMaintenanceInfo() : window.systemMaintenance);
    if (maint && typeof syncSystemMaintenanceState === 'function') {
      syncSystemMaintenanceState(maint, { rerender: false });
    }
    const cb = document.getElementById('maintenanceModalEnabled');
    const msgEl = document.getElementById('maintenanceModalMessage');
    if (cb) cb.checked = Boolean(maint?.enabled);
    if (msgEl) msgEl.value = maint?.message || '';
  } catch (_) {}
  const modal = document.getElementById('maintenanceSettingsModal');
  if (modal) modal.classList.remove('hidden');
}

function closeMaintenanceConfigModal() {
  const modal = document.getElementById('maintenanceSettingsModal');
  if (modal) modal.classList.add('hidden');
}

async function saveMaintenanceConfigModal() {
  const enabled = document.getElementById('maintenanceModalEnabled')?.checked === true;
  const message = String(document.getElementById('maintenanceModalMessage')?.value || '').trim();
  try {
    const res = await requestJson('/api/manager/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { enabled, message }
    });
    if (res.ok && res.data?.maintenance) {
      if (typeof syncSystemMaintenanceState === 'function') {
        syncSystemMaintenanceState(res.data.maintenance, { rerender: true });
      }
      closeMaintenanceConfigModal();
      showToast(res.data.message || 'Đã lưu cấu hình bảo trì thành công!');
      if (typeof refreshHome === 'function') void refreshHome();
    } else {
      showToast('Lỗi: ' + (res.data?.error || 'Không thể lưu cấu hình bảo trì'));
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}

// BUG-10: loadCurrentUser chưa từng được định nghĩa trong UI script trong khi
// checkRewardQueryParams gọi nó sau khi nhận thưởng Link4M → ReferenceError bị nuốt,
// thông tin thuê bao (giờ còn lại) không refresh. Định nghĩa lại hàm này.
async function loadCurrentUser() {
  try {
    const res = await requestJson('/api/auth/me');
    if (res.ok && res.data?.user) {
      currentUser = res.data.user;
      try { applyUserRoleUI(); } catch (_) {}
      // Chỉ re-render home khi user đang ở giao diện đã đăng nhập (loginGate đã ẩn).
      const loginGate = document.getElementById('loginGate');
      if (loginGate?.classList.contains('hidden') && typeof renderHome === 'function') {
        void renderHome();
      }
    }
    return res.ok;
  } catch (_) {
    return false;
  }
}
window.loadCurrentUser = loadCurrentUser;

// Check reward query param on dashboard load
function checkRewardQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const reward = params.get('reward');
  const attemptId = params.get('attempt') || '';
  if (reward === 'success') {
    const isPerm = Boolean(
      params.get('permanent') === '1' ||
      params.get('support') === '1' ||
      params.get('added') === '0h' ||
      (typeof currentUser !== 'undefined' && currentUser?.isPermanent === true)
    );
    const added = params.get('added') || '12h';
    showToast(isPerm ? '❤️ Cảm ơn bạn đã vượt link ủng hộ Admin!' : ('🎉 Chúc mừng! Bạn đã vượt link thành công và được cộng thêm ' + added + ' sử dụng!'));
    void loadCurrentUser();
    void loadLink4mStatus();
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (reward === 'pending') {
    const msg = params.get('message') || 'Đang chờ máy chủ Link4M gửi xác nhận hoàn tất (Postback)...';
    showToast('⏳ ' + msg);
    window.history.replaceState({}, document.title, window.location.pathname);
    // Poll verify endpoint for up to 30s to see if postback completes in background
    if (attemptId) {
      let pollCount = 0;
      const pollTimer = setInterval(async () => {
        pollCount++;
        if (pollCount > 10) { clearInterval(pollTimer); return; }
        try {
          const res = await requestJson('/api/rewards/link4m/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: { attemptId }
          });
          if (res.ok && res.data?.isRewarded) {
            clearInterval(pollTimer);
            const isPerm = Boolean(
              res.data?.permanent ||
              res.data?.supportAdmin ||
              (typeof currentUser !== 'undefined' && currentUser?.isPermanent === true)
            );
            showToast(isPerm
              ? '❤️ Cảm ơn bạn đã vượt link ủng hộ Admin!'
              : ('🎉 Xác nhận từ Link4M thành công! Đã cộng +' + (res.data.rewardHours || 12) + 'h vào tài khoản!'));
            void loadCurrentUser();
            void loadLink4mStatus();
          }
        } catch (_) {}
      }, 3000);
    }
  } else if (reward === 'already') {
    showToast('⚠️ Phiên vượt link này đã được nhận thưởng trước đó.');
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (reward === 'error') {
    const msg = params.get('message') || 'Xác thực vượt link không thành công.';
    showToast('⚠️ Lỗi nhận thưởng: ' + msg);
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

window.loadLink4mStatus = loadLink4mStatus;
window.startLink4mReward = startLink4mReward;
window.loadLink4mAdminSetting = loadLink4mAdminSetting;
window.toggleLink4mSetting = toggleLink4mSetting;
window.openLink4mConfigModal = openLink4mConfigModal;
window.closeLink4mConfigModal = closeLink4mConfigModal;
window.updateLink4mModalFields = updateLink4mModalFields;
window.saveLink4mConfigModal = saveLink4mConfigModal;
window.loadMaintenanceAdminSetting = loadMaintenanceAdminSetting;
window.toggleMaintenanceSetting = toggleMaintenanceSetting;
window.openMaintenanceConfigModal = openMaintenanceConfigModal;
window.closeMaintenanceConfigModal = closeMaintenanceConfigModal;
window.saveMaintenanceConfigModal = saveMaintenanceConfigModal;

window.toggleTrialGiftSetting = toggleTrialGiftSetting;
window.saveTrialDaysSetting = saveTrialDaysSetting;

function updateDetailUptime(){
  if (typeof selectedBotId === 'undefined' || selectedBotId === null || !detailBot) return;
  const st = String(detailBot?.status || '').toLowerCase();
  if(!['online', 'afk'].includes(st)) return;
  let seconds = 0;
  const connectedMs = detailBot.connectedAt ? Date.parse(detailBot.connectedAt) : NaN;
  if (Number.isFinite(connectedMs) && connectedMs > 0) {
    seconds = Math.max(0, Math.floor((Date.now() - connectedMs) / 1000));
  } else {
    const base = Math.max(0, Math.floor(Number(detailBot.uptimeSeconds || 0)));
    const extra = Math.max(0, Math.floor((Date.now() - uptimeSyncAt) / 1000));
    seconds = base + extra;
  }
  seconds = Math.min(seconds, 3596399);
  const h=Math.floor(seconds/3600);const m=Math.floor((seconds%3600)/60);const s=seconds%60;
  const el=document.getElementById('detailUptime');if(el)el.textContent=h+'h '+m+'m '+s+'s';
}

async function handleRenameClick(btn) {
  if (!btn) return;
  const lockInfo = (typeof getWorkerLockInfo === 'function') ? getWorkerLockInfo() : { locked: false };
  if (lockInfo && lockInfo.locked) {
    const prefix = lockInfo.reason === 'maintenance' ? '🛠️ Hệ thống đang bảo trì: ' : '⚠️ ';
    if (typeof showToast === 'function') showToast(prefix + lockInfo.message, 'warning', 4500);
    return;
  }
  const botId = String(btn.getAttribute('data-bot-id') || '').trim();
  if (!botId) return;
  const currentLabel = btn.getAttribute('data-bot-label') || '';
  await renameBotAlias(botId, currentLabel);
}

function renameBotAlias(botId, currentLabel) {
  editBot(null, botId);
  setTimeout(() => {
    const input = document.getElementById('editBotLabel');
    if (input) {
      input.focus();
      input.select();
    }
  }, 100);
}

async function renameDetailBotAlias() {
  if (!selectedBotId) return;
  const current = detailBot?.label || '';
  await renameBotAlias(selectedBotId, current);
}

async function openSupabaseModal() {
  const modal = document.getElementById('supabaseModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const alertBox = document.getElementById('supabaseAlertBox');
  if (alertBox) {
    alertBox.className = 'login-alert hidden';
    alertBox.textContent = '';
  }

  const badge = document.getElementById('supabaseStatusBadge');
  if (badge) {
    badge.innerHTML = '⏳ Đang kiểm tra...';
    badge.style.background = 'rgba(148,163,184,0.15)';
    badge.style.color = '#94a3b8';
    badge.style.borderColor = 'rgba(148,163,184,0.3)';
  }

  const statusMsg = document.getElementById('supabaseStatusMsg');
  if (statusMsg) statusMsg.textContent = 'Đang truy vấn trạng thái Supabase từ server...';

  try {
    const res = await requestJson('/api/manager/supabase/status');
    if (res.ok && res.data) {
      const urlInput = document.getElementById('supabaseUrlInput');
      const keyInput = document.getElementById('supabaseKeyInput');
      const envEnabled = Boolean(res.data.enabled || res.data.connected);
      if (urlInput) urlInput.value = res.data.url || '';
      if (keyInput) keyInput.value = (res.data.hasKey || envEnabled) ? '••••••••••••••••' : '';

      if (badge) {
        if (res.data.connected) {
          badge.innerHTML = '🟢 Đã kết nối';
          badge.style.background = 'rgba(34,197,94,0.2)';
          badge.style.color = '#4ade80';
          badge.style.borderColor = 'rgba(34,197,94,0.4)';
        } else {
          badge.innerHTML = '🔴 Chưa kết nối';
          badge.style.background = 'rgba(239,68,68,0.2)';
          badge.style.color = '#f87171';
          badge.style.borderColor = 'rgba(239,68,68,0.4)';
        }
      }

      if (statusMsg) {
        statusMsg.textContent = res.data.message || (res.data.connected ? 'Kết nối Supabase Cloud hoạt động tốt.' : 'Chưa kết nối Supabase Cloud.');
      }
    } else {
      if (statusMsg) statusMsg.textContent = res.data?.error || 'Không thể tải trạng thái Supabase.';
    }
  } catch (err) {
    if (statusMsg) statusMsg.textContent = 'Lỗi kết nối: ' + err.message;
  }
}

function closeSupabaseModal() {
  document.getElementById('supabaseModal')?.classList.add('hidden');
}

async function copySupabaseSchemaSql() {
  const btn = document.getElementById('supabaseSchemaBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang lấy SQL...'; }
  try {
    const res = await requestJson('/api/manager/supabase/schema');
    const rawSql = res.data?.sql || res.data?.raw || '';
    if (!res.ok || !rawSql) throw new Error(res.data?.error || 'Không thể lấy SQL schema.');
    const sql = String(rawSql);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(sql);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = sql;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      if (!document.execCommand('copy')) throw new Error('Trình duyệt không cho phép sao chép tự động.');
      textarea.remove();
    }
    showToast('✅ Đã sao chép SQL. Mở Supabase SQL Editor, dán và Run một lần.');
  } catch (err) {
    showToast('⚠️ ' + (err.message || 'Không thể sao chép SQL schema.'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📋 Sao chép SQL tạo bảng'; }
  }
}

async function testSupabaseConnection() {
  const btn = document.getElementById('supabaseTestBtn');
  const alertBox = document.getElementById('supabaseAlertBox');
  const badge = document.getElementById('supabaseStatusBadge');
  const statusMsg = document.getElementById('supabaseStatusMsg');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang test...'; }
  if (alertBox) alertBox.className = 'login-alert hidden';

  try {
    const res = await requestJson('/api/manager/supabase/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (res.ok) {
      if (alertBox) {
        alertBox.textContent = '✅ ' + (res.data?.message || 'Kết nối Supabase thành công!');
        alertBox.className = 'login-alert success';
      }
      if (badge) {
        badge.innerHTML = '🟢 Kết nối OK';
        badge.style.background = 'rgba(34,197,94,0.2)';
        badge.style.color = '#4ade80';
        badge.style.borderColor = 'rgba(34,197,94,0.4)';
      }
      if (statusMsg) statusMsg.textContent = 'Kết nối Supabase Cloud phản hồi ping thành công!';
      showToast('✅ Kết nối Supabase thành công!');
    } else {
      if (alertBox) {
        alertBox.textContent = '⚠️ ' + (res.data?.error || 'Kết nối Supabase thất bại.');
        alertBox.className = 'login-alert error';
      }
      if (badge) {
        badge.innerHTML = '🔴 Lỗi kết nối';
        badge.style.background = 'rgba(239,68,68,0.2)';
        badge.style.color = '#f87171';
        badge.style.borderColor = 'rgba(239,68,68,0.4)';
      }
      if (statusMsg) statusMsg.textContent = res.data?.error || 'Lỗi kết nối Supabase.';
    }
  } catch (err) {
    if (alertBox) {
      alertBox.textContent = '⚠️ Lỗi kiểm tra: ' + err.message;
      alertBox.className = 'login-alert error';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧪 Kiểm tra kết nối'; }
  }
}

async function saveSupabaseConfig() {
  const alertBox = document.getElementById('supabaseAlertBox');
  const statusMsg = document.getElementById('supabaseStatusMsg');
  const msg = 'Cấu hình Supabase chỉ đọc từ biến môi trường server (.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Không thể lưu từ trình duyệt.';
  if (alertBox) {
    alertBox.textContent = 'ℹ️ ' + msg;
    alertBox.className = 'login-alert info';
  }
  if (statusMsg) statusMsg.textContent = msg;
  showToast(msg, 'info');
  return false;
}

function formatSupabaseCounts(counts, isUpload) {
  if (!counts || typeof counts !== 'object') return '';
  const parts = [];
  if (typeof counts.bots === 'number') parts.push(counts.bots + ' bot');
  if (typeof counts.users === 'number') parts.push(counts.users + ' users');
  if (typeof counts.keys === 'number') parts.push(counts.keys + ' keys');
  if (typeof counts.botSettings === 'number' && counts.botSettings > 0) parts.push(counts.botSettings + ' cấu hình');
  if (typeof counts.workersSynced === 'number' && counts.workersSynced > 0) parts.push(counts.workersSynced + ' worker');
  if (parts.length === 0) {
    const fallback = Object.entries(counts)
      .filter(([k, v]) => typeof v === 'number' && v > 0)
      .map(([k, v]) => v + ' ' + k);
    return fallback.join(', ');
  }
  return parts.join(', ');
}

async function runSupabaseSyncAction(buttonId, endpoint, busyText, successPrefix) {
  const btn = document.getElementById(buttonId);
  const otherBtnId = buttonId === 'supabaseSyncBtn' ? 'supabaseSyncDownBtn' : 'supabaseSyncBtn';
  const otherBtn = document.getElementById(otherBtnId);
  const alertBox = document.getElementById('supabaseAlertBox');
  if (btn?.disabled) return;

  const isUpload = endpoint.includes('upload');

  if (btn) {
    btn.disabled = true;
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-sm"></span> ' + escapeHtml(busyText);
  }
  if (otherBtn) otherBtn.disabled = true;

  if (alertBox) {
    alertBox.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span class="spinner-sm"></span><span>' + escapeHtml(busyText) + ' Đang xử lý dữ liệu với Supabase Cloud...</span></div>';
    alertBox.className = 'login-alert info';
  }

  try {
    const res = await requestJson(endpoint, { method: 'POST', timeoutMs: 35000 });
    if (!res.ok) {
      const error = new Error(res.data?.error || 'Thao tác Supabase thất bại.');
      error.counts = res.data?.counts;
      throw error;
    }
    const counts = res.data?.counts;
    const partial = res.data?.partial === true;
    const countSummary = formatSupabaseCounts(counts, isUpload);

    let detailedMsg = '';
    if (countSummary) {
      detailedMsg = isUpload
        ? ('Đã sao lưu thành công ' + countSummary + ' lên Supabase Cloud.')
        : ('Đã tải thành công ' + countSummary + ' từ Supabase Cloud.');
    } else {
      detailedMsg = res.data?.message || 'Hoàn tất đồng bộ Supabase Cloud.';
    }

    if (partial) {
      const warnMsg = '⚠️ ' + (res.data?.message || detailedMsg);
      if (alertBox) {
        alertBox.textContent = warnMsg;
        alertBox.className = 'login-alert error';
      }
      showToast(warnMsg, 'warning', 6000);
    } else {
      if (alertBox) {
        alertBox.textContent = '✅ ' + detailedMsg;
        alertBox.className = 'login-alert success';
      }
      showToast('✅ ' + detailedMsg, 'success', 5000);
    }

    lastHomeSig = '';
    await Promise.allSettled([refreshHome(), refreshUserManagementPage(), refreshKeysTable()]);
    if (selectedBotId !== null) await refreshDetail(true);
  } catch (err) {
    const errCountSummary = formatSupabaseCounts(err.counts, isUpload);
    const message = (err.message || 'Không thể đồng bộ Supabase.') + (errCountSummary ? (' (' + errCountSummary + ')') : '');
    if (alertBox) {
      alertBox.textContent = '⚠️ ' + message;
      alertBox.className = 'login-alert error';
    }
    showToast('⚠️ ' + message, 'error', 6000);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalHtml || (buttonId === 'supabaseSyncBtn' ? '⬆ Tải lên Supabase Cloud' : '⬇ Đồng bộ xuống');
    }
    if (otherBtn) otherBtn.disabled = false;
  }
}
async function syncAllToSupabase() {
  return runSupabaseSyncAction('supabaseSyncBtn', '/api/manager/supabase/upload', '⏳ Đang tải lên...', '⬆ ');
}
async function syncDownFromSupabase() {
  return runSupabaseSyncAction('supabaseSyncDownBtn', '/api/manager/supabase/sync-down', '⏳ Đang tải xuống...', '⬇ ');
}
async function resolveAllPendingResets() {
  if (!confirm('Bạn có chắc chắn muốn dọn dẹp và hoàn tất tất cả các tiến trình reset / xung đột đang treo trên các bot?')) return;
  const btn = document.getElementById('resolveAllResetsBtn');
  if (btn) btn.disabled = true;
  try {
    showToast('⏳ Đang xử lý hoàn tất các reset treo...', 'info', 5000);
    const firstRes = await requestJson('/api/manager/pending-resets/all/resolve', {
      method: 'POST',
      body: { action: 'resume' }
    });
    if (!firstRes.ok) {
      throw new Error(firstRes.data?.error || firstRes.data?.message || 'Không thể xử lý reset treo.');
    }
    const checkRes = await requestJson('/api/manager/pending-resets');
    if (checkRes.ok && checkRes.data && checkRes.data.conflicts > 0) {
      const discardRes = await requestJson('/api/manager/pending-resets/all/resolve', {
        method: 'POST',
        body: { action: 'discard', confirmOwnerCheck: true }
      });
      if (!discardRes.ok) {
        throw new Error(discardRes.data?.error || discardRes.data?.message || 'Không thể xóa xung đột reset.');
      }
    }
    showToast('✅ Đã dọn dẹp và gỡ bỏ xung đột reset thành công!', 'success', 5000);
    await Promise.allSettled([refreshHome(), refreshUserManagementPage()]);
  } catch (err) {
    showToast('⚠️ Lỗi khi dọn dẹp reset: ' + (err.message || 'Thất bại'), 'error', 6000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

window.resolveAllPendingResets = resolveAllPendingResets;

window.handleRenameClick = handleRenameClick;
window.renameBotAlias = renameBotAlias;
window.renameDetailBotAlias = renameDetailBotAlias;
window.addBotFromWeb = addBotFromWeb;
window.addDetailAutoChatSchedule = addDetailAutoChatSchedule;
window.addDetailBotSchedule = addDetailBotSchedule;
window.allowBotDrop = allowBotDrop;
window.clearDetailChat = clearDetailChat;
window.saveDetailProxy = saveDetailProxy;
window.testDetailProxy = testDetailProxy;
window.clearDetailProxy = clearDetailProxy;
window.toggleTrialGiftSetting = toggleTrialGiftSetting;
window.clearDetailLogs = clearDetailLogs;
window.closeAddBotModal = closeAddBotModal;
window.closeAdminModal = closeAdminModal;
window.closeEditBotModal = closeEditBotModal;
window.copyText = copyText;
window.deleteBot = deleteBot;
window.detailAction = detailAction;
window.detailPost = detailPost;
window.detailScheduleModeChanged = detailScheduleModeChanged;
window.dropBot = dropBot;
window.dropDetailInventory = dropDetailInventory;
window.dropDetailItemToWorld = dropDetailItemToWorld;
window.editBot = editBot;
window.equipDetailItem = equipDetailItem;
window.goHome = goHome;
window.loadAdminCredentials = loadAdminCredentials;
window.handleDetailEquipmentClick = handleDetailEquipmentClick;
window.handleDetailDropZoneClick = handleDetailDropZoneClick;
window.cancelDetailSlotSelection = cancelDetailSlotSelection;
window.moveDetailItem = moveDetailItem;
window.openAddBotModal = openAddBotModal;
window.openAdminModal = openAdminModal;
window.hideLoginGate = hideLoginGate;
window.openBatchSettingsModal = openBatchSettingsModal;
window.closeBatchSettingsModal = closeBatchSettingsModal;
window.submitBatchSettings = submitBatchSettings;
window.filterBots = filterBots;
window.updateKpis = updateKpis;
window.openBot = openBot;
window.refreshDetail = refreshDetail;
window.refreshHome = refreshHome;
window.removeDetailAutoChatSchedule = removeDetailAutoChatSchedule;
window.removeDetailBotSchedule = removeDetailBotSchedule;
window.runAllAction = runAllAction;
window.saveDetailAccount = saveDetailAccount;
window.saveDetailAutoChat = saveDetailAutoChat;
window.saveDetailBotSchedules = saveDetailBotSchedules;
window.saveDetailSettings = saveDetailSettings;
window.detailBotScheduleModeChanged = detailBotScheduleModeChanged;
window.saveEditBot = saveEditBot;
window.selectDetailHotbar = selectDetailHotbar;
window.sendDetailMessage = sendDetailMessage;
window.showToast = showToast;
window.startBotDrag = startBotDrag;
window.unequipDetail = unequipDetail;
window.quickBotAction = quickBotAction;
window.setStatusFilter = setStatusFilter;
window.resetBotFilters = resetBotFilters;
window.toggleSoundAlert = toggleSoundAlert;
window.exportBotList = exportBotList;
window.triggerImport = triggerImport;
window.handleImportFile = handleImportFile;
window.reconnectOfflineBots = reconnectOfflineBots;
window.changeBotSort = changeBotSort;
window.quickDetailCommand = quickDetailCommand;
window.copyToClipboard = copyToClipboard;
window.openWebhookModal = openWebhookModal;
window.closeWebhookModal = closeWebhookModal;
window.saveWebhookSettings = saveWebhookSettings;
window.testWebhookSettings = testWebhookSettings;
window.exportBotLogs = exportBotLogs;
window.handleLoginSubmit = handleLoginSubmit;
window.logout = logout;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openUserManagementModal = openUserManagementModal;
window.closeUserManagementModal = closeUserManagementModal;
window.openCreateUserModal = openCreateUserModal;
window.openEditUserModal = openEditUserModal;
window.closeUserEditModal = closeUserEditModal;
window.saveUserForm = saveUserForm;
window.deleteUserPrompt = deleteUserPrompt;
window.toggleSelectAllUserBots = toggleSelectAllUserBots;
window.generateRandomUserPassword = generateRandomUserPassword;
window.togglePassPeek = toggleUserPasswordPeek;
window.openAnnouncementAdminModal = openAnnouncementAdminModal;
window.closeAnnouncementAdminModal = closeAnnouncementAdminModal;
window.saveAnnouncementConfig = saveAnnouncementConfig;
window.previewAnnouncementModal = previewAnnouncementModal;
window.handleAnnouncementModeChange = handleAnnouncementModeChange;
window.dismissUserAnnouncement = dismissUserAnnouncement;
window.toggleUserProfileDropdown = toggleUserProfileDropdown;
window.closeUserProfileDropdown = closeUserProfileDropdown;
window.openChangePasswordModal = openChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.openDiscordLinkModal = openDiscordLinkModal;
window.closeDiscordLinkModal = closeDiscordLinkModal;
window.unlinkDiscordAccount = unlinkDiscordAccount;
window.loadDiscordLinkStatus = loadDiscordLinkStatus;
window.toggleDiscordNotifications = toggleDiscordNotifications;
window.submitChangePassword = submitChangePassword;
window.openChangelogModal = openChangelogModal;
window.closeChangelogModal = closeChangelogModal;
window.openAuditLogModal = openAuditLogModal;
window.closeAuditLogModal = closeAuditLogModal;
window.refreshAuditLogs = refreshAuditLogs;
window.switchAuditLogType = switchAuditLogType;
window.openSupabaseModal = openSupabaseModal;
window.closeSupabaseModal = closeSupabaseModal;
window.copySupabaseSchemaSql = copySupabaseSchemaSql;
window.testSupabaseConnection = testSupabaseConnection;
window.saveSupabaseConfig = saveSupabaseConfig;
window.syncAllToSupabase = syncAllToSupabase;
window.syncDownFromSupabase = syncDownFromSupabase;
window.debounceAuditFilter = debounceAuditFilter;
window.filterAuditLogs = debounceAuditFilter;
window.navigateAuditPage = navigateAuditPage;
window.exportAuditLogs = exportAuditLogs;
window.clearAllAuditLogs = clearAllAuditLogs;
window.openBackupManagerModal = openBackupManagerModal;
window.closeBackupManagerModal = closeBackupManagerModal;
window.refreshBackupList = refreshBackupList;
window.triggerCreateBackup = triggerCreateBackup;
window.openRenewModal = openRenewModal;
window.closeRenewModal = closeRenewModal;
window.submitRenewKey = submitRenewKey;
window.openKeyManagementModal = openKeyManagementModal;
window.closeKeyManagementModal = closeKeyManagementModal;
window.refreshKeysTable = refreshKeysTable;
window.submitCreateKeys = submitCreateKeys;
window.deleteLicenseKey = deleteLicenseKey;
window.quickAddUserDays = quickAddUserDays;
window.resetCustomerBot = resetCustomerBot;
window.resetBotForNewCustomer = resetCustomerBot;
window.renderDetailRemoteGui = renderDetailRemoteGui;
window.clickDetailGuiSlot = clickDetailGuiSlot;
window.closeDetailGuiWindow = closeDetailGuiWindow;
window.saveAndRestartBot = saveAndRestartBot;
window.cleanDeadBots = cleanDeadBots;
window.openEditSecretModal = openEditSecretModal;
window.toggleEditSecretKeyVisibility = toggleEditSecretKeyVisibility;

window.addEventListener('error',event=>{
  try{console.error('[MANAGER UI]',event.error||event.message||'Unknown UI error');}catch(_){}
});
window.addEventListener('unhandledrejection',event=>{
  try{console.error('[MANAGER UI] Unhandled rejection',event.reason);}catch(_){}
});

// ============================================================================
// REALTIME SSE LIVE-SYNC (/api/manager/stream) & COMMAND PALETTE (CTRL+K / /)
// ============================================================================
let _managerSseSource = null;
let _managerSseConnected = false;
let _managerSseReconnecting = false;
let _managerSseLastRev = 0;
let _managerSseReconnectTimer = null;
let _managerSseRetryCount = 0;
let _managerSsePulseDebounceTimer = null;
const _managerSsePendingWorkerIds = new Set();
let _managerSsePendingWildcard = false;

function isManagerSseOpen() {
  return Boolean(_managerSseSource && _managerSseConnected && (_managerSseSource.readyState === 1 || _managerSseSource.readyState === undefined));
}
window.isManagerSseOpen = isManagerSseOpen;
window.getManagerSseLastRev = () => _managerSseLastRev;

function recordManagerSseRev(rawRev, lastEventId) {
  const candidate = rawRev !== undefined && rawRev !== null && rawRev !== '' ? Number(rawRev) : Number(lastEventId);
  if (Number.isFinite(candidate) && candidate > 0) {
    _managerSseLastRev = candidate;
  }
}

const _baseUpdateLiveSyncIndicators = typeof updateLiveSyncIndicators === 'function' ? updateLiveSyncIndicators : null;
if (_baseUpdateLiveSyncIndicators) {
  updateLiveSyncIndicators = function patchedUpdateLiveSyncIndicators(state, customText) {
    if (state === undefined && _managerSseReconnecting && !isManagerSseOpen() && (typeof document === 'undefined' || !document.hidden)) {
      _baseUpdateLiveSyncIndicators('syncing', 'Đang kết nối lại luồng trực tiếp...');
      return;
    }
    _baseUpdateLiveSyncIndicators(state, customText);
    if (isManagerSseOpen() && (typeof document === 'undefined' || !document.hidden)) {
      if (_lastSyncState !== 'paused' && _lastSyncState !== 'error' && _lastSyncState !== 'syncing') {
        [['homeSyncStatusPill', 'homeSyncStatusDot', 'homeSyncStatusText'], ['detailSyncStatusPill', 'detailSyncStatusDot', 'detailSyncStatusText']].forEach(([pillId, dotId, txtId]) => {
          const pill = document.getElementById(pillId);
          const dot = document.getElementById(dotId);
          const txt = document.getElementById(txtId);
          if (pill) pill.className = 'live-sync-pill is-sse';
          if (dot) dot.className = 'pulse-status-dot green';
          if (txt) txt.textContent = '⚡ Trực tiếp (SSE)';
        });
      }
    }
  };
  window.updateLiveSyncIndicators = updateLiveSyncIndicators;
}

function resetFleetFilters() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  const sortSel = document.getElementById('sortBotsSelect');
  if (sortSel && sortSel.value !== 'default') {
    sortSel.value = 'default';
    if (typeof currentSortMode !== 'undefined') currentSortMode = 'default';
  }
  if (typeof resetBotFilters === 'function') {
    resetBotFilters();
  } else if (typeof filterBots === 'function') {
    filterBots();
  }
  if (typeof announceGlobalStatus === 'function') {
    announceGlobalStatus('Đã xóa toàn bộ bộ lọc danh sách bot.');
  }
}
window.resetFleetFilters = resetFleetFilters;

const _baseFilterBotsForEmpty = typeof filterBots === 'function' ? filterBots : null;
if (_baseFilterBotsForEmpty) {
  filterBots = function patchedFilterBotsWithRecovery() {
    _baseFilterBotsForEmpty();
    if (typeof document === 'undefined') return;
    const grid = document.getElementById('botGrid');
    if (!grid || typeof grid.innerHTML !== 'string' || !grid.innerHTML.includes('empty-filter-state')) return;
    const totalCount = Array.isArray(bots) ? bots.length : 0;
    if (typeof buildEmptyFleetFilterHtml === 'function') {
      const nextHtml = buildEmptyFleetFilterHtml(totalCount);
      if (grid.innerHTML !== nextHtml) grid.innerHTML = nextHtml;
    }
  };
  window.filterBots = filterBots;
}

function closeManagerSseStream(resetRetry = true, resetRev = false) {
  if (_managerSseReconnectTimer) {
    clearTimeout(_managerSseReconnectTimer);
    _managerSseReconnectTimer = null;
  }
  if (_managerSsePulseDebounceTimer) {
    clearTimeout(_managerSsePulseDebounceTimer);
    _managerSsePulseDebounceTimer = null;
  }
  _managerSsePendingWorkerIds.clear();
  _managerSsePendingWildcard = false;
  _managerSseConnected = false;
  if (resetRetry) {
    _managerSseRetryCount = 0;
    _managerSseReconnecting = false;
  }
  if (resetRev) {
    _managerSseLastRev = 0;
  }
  if (_managerSseSource) {
    const src = _managerSseSource;
    _managerSseSource = null;
    try { src.close(); } catch (_) {}
  }
}
window.closeManagerSseStream = closeManagerSseStream;

function handleManagerSseAnnouncement(rawPayload) {
  if (!currentUser || !rawPayload || typeof rawPayload !== 'object') return;
  const ann = rawPayload.announcement && typeof rawPayload.announcement === 'object' ? rawPayload.announcement : rawPayload;
  if (ann.enabled === false) {
    document.getElementById('userAnnouncementModal')?.classList?.add('hidden');
    return;
  }
  if (!ann.enabled || !String(ann.content || '').trim()) return;
  const now = new Date();
  if (ann.mode === 'time_range') {
    if (ann.startDate && new Date(ann.startDate + 'T00:00:00') > now) return;
    if (ann.endDate && new Date(ann.endDate + 'T23:59:59') < now) return;
  }
  if (typeof showUserAnnouncement === 'function') {
    showUserAnnouncement(ann);
  } else if (typeof checkAndShowAnnouncement === 'function') {
    void checkAndShowAnnouncement();
  }
}

function scheduleManagerSsePulseFlush() {
  if (_managerSsePulseDebounceTimer) return;
  _managerSsePulseDebounceTimer = setTimeout(async () => {
    _managerSsePulseDebounceTimer = null;
    const pendingIds = new Set(_managerSsePendingWorkerIds);
    const wildcard = _managerSsePendingWildcard;
    _managerSsePendingWorkerIds.clear();
    _managerSsePendingWildcard = false;
    if (!currentUser || (typeof document !== 'undefined' && document.hidden)) return;
    _lastSyncSuccessAt = Date.now();
    if (typeof refreshHome === 'function') {
      void refreshHome();
    }
    if (selectedBotId !== null && typeof refreshDetail === 'function') {
      const selStr = String(selectedBotId);
      const matchDetail = wildcard || pendingIds.size === 0 || pendingIds.has(selStr) ||
        Boolean(detailBot && (
          (detailBot.id !== undefined && pendingIds.has(String(detailBot.id))) ||
          (detailBot.workerId !== undefined && pendingIds.has(String(detailBot.workerId))) ||
          (detailBot.botNumber !== undefined && pendingIds.has(String(detailBot.botNumber)))
        ));
      if (matchDetail) {
        await refreshDetail(false);
      }
    }
    if (typeof isCommandPaletteOpen === 'function' && isCommandPaletteOpen()) {
      renderCommandPaletteResults();
    }
    if (typeof updateLiveSyncIndicators === 'function') updateLiveSyncIndicators('ok');
  }, 250);
}

function connectManagerSseStream() {
  if (typeof EventSource === 'undefined' || !currentUser) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (_managerSseSource && _managerSseSource.readyState !== 2) return;

  closeManagerSseStream(false, false);
  const sseUrl = _managerSseLastRev > 0
    ? ('/api/manager/stream?lastRev=' + encodeURIComponent(String(_managerSseLastRev)))
    : '/api/manager/stream';
  let es = null;
  try {
    es = new EventSource(sseUrl);
  } catch (_) {
    return;
  }
  _managerSseSource = es;

  const markConnected = () => {
    if (_managerSseSource !== es) return;
    _managerSseConnected = true;
    _managerSseReconnecting = false;
    _managerSseRetryCount = 0;
    _lastSyncSuccessAt = Date.now();
    if (typeof updateLiveSyncIndicators === 'function') updateLiveSyncIndicators('ok');
    scheduleNextManagerPoll();
  };

  es.onopen = markConnected;
  es.addEventListener('connected', (ev) => {
    if (_managerSseSource !== es || !currentUser) return;
    markConnected();
    let data = null;
    try { data = ev && ev.data ? JSON.parse(ev.data) : null; } catch (_) { data = null; }
    recordManagerSseRev(data?.rev, ev?.lastEventId);
    if (data && data.maintenance && typeof syncSystemMaintenanceState === 'function') {
      syncSystemMaintenanceState(data.maintenance, { rerender: true });
    }
    if (data && data.missed === true) {
      if (typeof refreshHome === 'function') void refreshHome();
      if (selectedBotId !== null && typeof refreshDetail === 'function') void refreshDetail(false);
    }
  });

  es.addEventListener('fleet_pulse', (ev) => {
    if (_managerSseSource !== es || !currentUser) return;
    let payload = {};
    try { payload = ev && ev.data ? JSON.parse(ev.data) : {}; } catch (_) { payload = {}; }
    recordManagerSseRev(payload?.rev, ev?.lastEventId);
    if (Array.isArray(payload?.workerIds) && payload.workerIds.length > 0) {
      payload.workerIds.forEach((id) => { if (id !== undefined && id !== null && String(id)) _managerSsePendingWorkerIds.add(String(id)); });
    } else if (payload && payload.workerId !== undefined && payload.workerId !== null && String(payload.workerId)) {
      _managerSsePendingWorkerIds.add(String(payload.workerId));
    } else {
      _managerSsePendingWildcard = true;
    }
    scheduleManagerSsePulseFlush();
  });

  es.addEventListener('maintenance', (ev) => {
    if (_managerSseSource !== es || !currentUser) return;
    try {
      const parsed = ev && ev.data ? JSON.parse(ev.data) : null;
      recordManagerSseRev(parsed?.rev, ev?.lastEventId);
      const maint = parsed && typeof parsed === 'object' ? (parsed.maintenance || parsed) : null;
      if (maint && typeof syncSystemMaintenanceState === 'function') {
        syncSystemMaintenanceState(maint, { rerender: true });
      }
      if (typeof isCommandPaletteOpen === 'function' && isCommandPaletteOpen()) {
        renderCommandPaletteResults();
      }
    } catch (_) {}
  });

  es.addEventListener('announcement', (ev) => {
    if (_managerSseSource !== es || !currentUser) return;
    try {
      const parsed = ev && ev.data ? JSON.parse(ev.data) : null;
      recordManagerSseRev(parsed?.rev, ev?.lastEventId);
      if (parsed) handleManagerSseAnnouncement(parsed);
    } catch (_) {}
  });

  es.onerror = () => {
    if (_managerSseSource !== es) return;
    closeManagerSseStream(false, false);
    const isOnlineNow = typeof navigator === 'undefined' || navigator.onLine !== false;
    const isVisibleNow = typeof document === 'undefined' || !document.hidden;
    if (currentUser && isOnlineNow && isVisibleNow) {
      _managerSseReconnecting = true;
      if (typeof updateLiveSyncIndicators === 'function') {
        updateLiveSyncIndicators('syncing', 'Đang kết nối lại luồng trực tiếp...');
      }
    } else if (typeof updateLiveSyncIndicators === 'function') {
      updateLiveSyncIndicators();
    }
    scheduleNextManagerPoll();
    if (!currentUser || !isVisibleNow || !isOnlineNow) return;
    const step = Math.min(5, _managerSseRetryCount++);
    const delayMs = Math.min(30000, 1500 * Math.pow(2, step)) + Math.floor(Math.random() * 400);
    _managerSseReconnectTimer = setTimeout(() => {
      _managerSseReconnectTimer = null;
      connectManagerSseStream();
    }, delayMs);
  };
}
window.connectManagerSseStream = connectManagerSseStream;

const _baseLogoutForSse = typeof logout === 'function' ? logout : null;
if (_baseLogoutForSse) {
  logout = async function wrappedLogoutWithSse() {
    closeManagerSseStream(true, true);
    if (typeof closeCommandPalette === 'function') closeCommandPalette({ restoreFocus: false });
    return _baseLogoutForSse.apply(this, arguments);
  };
  window.logout = logout;
}

// --- QUICK COMMAND & BOT JUMP PALETTE (CTRL+K / /) ---
let _cmdPaletteQuery = '';
let _cmdPaletteActiveIndex = 0;
let _cmdPaletteFilteredItems = [];
let _cmdPaletteReturnFocusEl = null;

function isCommandPaletteOpen() {
  if (typeof document === 'undefined') return false;
  const modal = document.getElementById('commandPaletteModal');
  return Boolean(modal && modal.classList && !modal.classList.contains('hidden'));
}
window.isCommandPaletteOpen = isCommandPaletteOpen;

function buildCommandPaletteItems() {
  const items = [];
  const isAdmin = Boolean(currentUser && currentUser.role === 'admin');
  const safeBots = Array.isArray(bots) ? bots : [];

  for (let i = 0; i < safeBots.length; i++) {
    const b = safeBots[i];
    if (!b || typeof b !== 'object') continue;
    const wid = String(b.workerId ?? b.id ?? '').trim();
    if (!wid) continue;
    const dispNum = b.displayIndex !== undefined ? b.displayIndex : (b.botNumber || wid);
    const numPad = String(dispNum).padStart(2, '0');
    const botLabel = String(b.label || ('Bot #' + dispNum)).trim();
    const mcUser = String(b.username || 'Chưa đặt').trim();
    const [dotColor, rawStLbl, errType] = typeof statusMeta === 'function'
      ? statusMeta(b.status, b.available, Boolean(b.manuallyStopped), b)
      : ['gray', String(b.status || 'OFFLINE'), ''];
    const stVi = typeof humanizeStatusPillVi === 'function'
      ? humanizeStatusPillVi(b.status, rawStLbl, b.available, Boolean(b.manuallyStopped), errType)
      : rawStLbl;
    const tagList = Array.isArray(b.tags) ? b.tags.map((t) => '#' + String(t || '').trim()).filter((t) => t.length > 1) : [];
    const subParts = ['Nhân vật: ' + mcUser, 'ID: ' + wid];
    if (tagList.length) subParts.push(tagList.join(' '));
    items.push({
      id: 'bot:' + wid,
      group: 'bots',
      numBadge: '#' + numPad,
      title: botLabel,
      subtitle: subParts.join(' • '),
      metaText: stVi,
      dotColor: dotColor || 'gray',
      searchBlob: ('#' + numPad + ' ' + numPad + ' ' + String(dispNum) + ' ' + wid + ' ' + botLabel + ' ' + mcUser + ' ' + String(b.status || '') + ' ' + stVi + ' ' + tagList.join(' ') + ' ' + String(b.assignedUsername || '')).toLowerCase(),
      run: () => {
        if (typeof openBot === 'function') openBot(wid);
      }
    });
  }

  const curTheme = typeof getSavedDashboardTheme === 'function' ? getSavedDashboardTheme() : 'deep-galaxy';
  const nextThemeLabel = curTheme === 'moonlight' ? 'Deep Galaxy (Tối)' : 'Moonlight (Sáng)';
  items.push(
    {
      id: 'cmd:refresh',
      group: 'commands',
      title: 'Làm mới dữ liệu ngay',
      subtitle: 'Đồng bộ tức thì trạng thái bot, kho đồ và thông số hệ thống',
      metaText: '↻ Sync',
      iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
      searchBlob: 'lam moi du lieu ngay refresh reload sync dong bo',
      run: () => { if (typeof manualRefreshNow === 'function') void manualRefreshNow(); }
    },
    {
      id: 'cmd:renew',
      group: 'commands',
      title: 'Mở Gia hạn / Nạp Key',
      subtitle: 'Nhập mã License Key hoặc Giftcode để cộng thêm thời gian sử dụng',
      metaText: 'Key',
      iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
      searchBlob: 'mo gia han nap key renew giftcode license kich hoat',
      run: () => { if (typeof openRenewModal === 'function') openRenewModal(); }
    },
    {
      id: 'cmd:theme-toggle',
      group: 'commands',
      title: 'Chuyển giao diện Sáng / Tối',
      subtitle: 'Đổi nhanh sang giao diện ' + nextThemeLabel,
      metaText: curTheme === 'moonlight' ? 'Dark' : 'Light',
      iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
      searchBlob: 'chuyen giao dien sang toi theme dark light moonlight deep galaxy',
      run: () => {
        if (typeof applyDashboardCosmicMode === 'function') {
          const cur = typeof getSavedDashboardTheme === 'function' ? getSavedDashboardTheme() : 'deep-galaxy';
          applyDashboardCosmicMode(cur === 'moonlight' ? 'deep-galaxy' : 'moonlight');
        }
      }
    }
  );

  if (selectedBotId !== null || (typeof currentNavPage === 'string' && currentNavPage !== 'dashboard')) {
    items.push({
      id: 'cmd:go-dashboard',
      group: 'commands',
      title: 'Về Tổng quan Dashboard',
      subtitle: 'Quay lại màn hình danh sách toàn bộ bot',
      metaText: 'Home',
      iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
      searchBlob: 've tong quan dashboard home danh sach bot',
      run: () => { if (typeof navigateTo === 'function') navigateTo('dashboard'); }
    });
  }

  if (isAdmin) {
    const maint = typeof getSystemMaintenanceInfo === 'function' ? getSystemMaintenanceInfo() : { enabled: false };
    items.push(
      {
        id: 'cmd:admin-users',
        group: 'admin',
        title: 'Quản lý Người dùng',
        subtitle: 'Mở trang quản lý tài khoản khách thuê, gán bot và phát hành Key',
        metaText: 'Admin',
        iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
        searchBlob: 'quan ly nguoi dung users khach thue key admin',
        run: () => { if (typeof navigateTo === 'function') navigateTo('users'); }
      },
      {
        id: 'cmd:admin-audit',
        group: 'admin',
        title: 'Nhật ký Audit',
        subtitle: 'Xem lịch sử thao tác quản trị và cảnh báo hạ tầng',
        metaText: 'Admin',
        iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        searchBlob: 'nhat ky audit log lich su quan tri admin',
        run: () => { if (typeof navigateTo === 'function') navigateTo('audit'); }
      },
      {
        id: 'cmd:admin-maintenance',
        group: 'admin',
        title: 'Bật / Tắt Chế độ Bảo trì',
        subtitle: maint.enabled
          ? 'Đang BẬT (giữ nguyên giờ thuê) — Thực thi để mở lại Worker cho khách'
          : 'Đang TẮT — Thực thi để tạm khóa Worker & đóng băng giờ thuê khách',
        metaText: maint.enabled ? 'ĐANG BẬT' : 'ĐANG TẮT',
        iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
        searchBlob: 'bat tat che do bao tri maintenance khoa worker admin',
        run: () => { if (typeof toggleMaintenanceSetting === 'function') void toggleMaintenanceSetting(); }
      }
    );
  }
  return items;
}

function normalizeSearchVi(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

function renderCommandPaletteResults() {
  const listEl = document.getElementById('commandPaletteList');
  const countEl = document.getElementById('commandPaletteCount');
  const inputEl = document.getElementById('commandPaletteInput');
  if (!listEl) return;

  const allItems = buildCommandPaletteItems();
  const qRaw = String(_cmdPaletteQuery || '').toLowerCase().trim();
  const qNorm = normalizeSearchVi(_cmdPaletteQuery);
  const tokens = qNorm ? qNorm.split(/\s+/).filter(Boolean) : [];

  _cmdPaletteFilteredItems = !tokens.length
    ? allItems
    : allItems.filter((item) => {
        const hayRaw = item.searchBlob + ' ' + String(item.title || '').toLowerCase() + ' ' + String(item.subtitle || '').toLowerCase();
        const hayNorm = normalizeSearchVi(hayRaw);
        return tokens.every((tok) => hayNorm.includes(tok) || hayRaw.includes(qRaw));
      });

  if (countEl) {
    countEl.textContent = _cmdPaletteFilteredItems.length + ' mục';
  }
  if (_cmdPaletteActiveIndex >= _cmdPaletteFilteredItems.length) {
    _cmdPaletteActiveIndex = 0;
  }
  if (_cmdPaletteActiveIndex < 0) {
    _cmdPaletteActiveIndex = Math.max(0, _cmdPaletteFilteredItems.length - 1);
  }

  if (!_cmdPaletteFilteredItems.length) {
    if (inputEl) inputEl.removeAttribute('aria-activedescendant');
    listEl.innerHTML = '<div class="cmd-palette-empty">Không tìm thấy bot hoặc lệnh khớp từ khóa <strong>' + escapeHtml(_cmdPaletteQuery) + '</strong>.</div>';
    return;
  }

  const groupTitles = {
    bots: 'Danh sách Bot được cấp',
    commands: 'Lệnh điều khiển nhanh',
    admin: 'Quản trị hệ thống'
  };
  let lastGroup = '';
  let html = '';
  for (let idx = 0; idx < _cmdPaletteFilteredItems.length; idx++) {
    const item = _cmdPaletteFilteredItems[idx];
    if (item.group !== lastGroup) {
      lastGroup = item.group;
      html += '<div class="cmd-palette-group-label" role="presentation">' + escapeHtml(groupTitles[item.group] || 'Mục') + '</div>';
    }
    const isActive = idx === _cmdPaletteActiveIndex;
    const domId = 'cmdPaletteOpt_' + idx;
    if (isActive && inputEl) {
      inputEl.setAttribute('aria-activedescendant', domId);
    }
    const leftVisual = item.group === 'bots'
      ? ('<span class="cmd-palette-item-icon"><span class="pulse-status-dot ' + escapeHtml(item.dotColor || 'gray') + '" aria-hidden="true"></span></span>')
      : ('<span class="cmd-palette-item-icon" aria-hidden="true">' + (item.iconSvg || '') + '</span>');
    html +=
      '<button type="button" id="' + domId + '" role="option" aria-selected="' + (isActive ? 'true' : 'false') + '" class="cmd-palette-item' + (isActive ? ' is-active' : '') + '" data-cmd-idx="' + idx + '" onclick="executeCommandPaletteItem(' + idx + ')" onmousemove="highlightCommandPaletteItem(' + idx + ')">' +
        '<span class="cmd-palette-item-main">' +
          leftVisual +
          '<span class="cmd-palette-item-text">' +
            '<span class="cmd-palette-item-title">' +
              (item.numBadge ? ('<span class="cmd-palette-bot-num">' + escapeHtml(item.numBadge) + '</span>') : '') +
              '<span>' + escapeHtml(item.title) + '</span>' +
            '</span>' +
            '<span class="cmd-palette-item-sub">' + escapeHtml(item.subtitle || '') + '</span>' +
          '</span>' +
        '</span>' +
        '<span class="cmd-palette-item-meta">' + escapeHtml(item.metaText || '') + '</span>' +
      '</button>';
  }
  listEl.innerHTML = html;
}

function highlightCommandPaletteItem(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= _cmdPaletteFilteredItems.length || idx === _cmdPaletteActiveIndex) return;
  _cmdPaletteActiveIndex = idx;
  const listEl = document.getElementById('commandPaletteList');
  const inputEl = document.getElementById('commandPaletteInput');
  listEl?.querySelectorAll?.('.cmd-palette-item')?.forEach?.((el, i) => {
    const active = i === idx;
    el.classList?.toggle('is-active', active);
    el.setAttribute?.('aria-selected', active ? 'true' : 'false');
    if (active && inputEl && el.id) inputEl.setAttribute('aria-activedescendant', el.id);
  });
}
window.highlightCommandPaletteItem = highlightCommandPaletteItem;

function moveCommandPaletteSelection(delta) {
  const len = _cmdPaletteFilteredItems.length;
  if (!len) return;
  _cmdPaletteActiveIndex = (_cmdPaletteActiveIndex + delta + len) % len;
  renderCommandPaletteResults();
  if (typeof document !== 'undefined') {
    const activeEl = document.getElementById('cmdPaletteOpt_' + _cmdPaletteActiveIndex);
    activeEl?.scrollIntoView?.({ block: 'nearest' });
  }
}

function executeCommandPaletteItem(index) {
  const idx = index !== undefined ? Number(index) : _cmdPaletteActiveIndex;
  const item = _cmdPaletteFilteredItems[idx];
  if (!item || typeof item.run !== 'function') return;
  closeCommandPalette({ restoreFocus: false });
  item.run();
}
window.executeCommandPaletteItem = executeCommandPaletteItem;

function onCommandPaletteInput(value) {
  _cmdPaletteQuery = String(value || '');
  _cmdPaletteActiveIndex = 0;
  renderCommandPaletteResults();
}
window.onCommandPaletteInput = onCommandPaletteInput;

function openCommandPalette(initialQuery = '') {
  if (!currentUser || typeof document === 'undefined') return;
  const modal = document.getElementById('commandPaletteModal');
  if (!modal) return;
  if (!isCommandPaletteOpen()) {
    const active = document.activeElement;
    _cmdPaletteReturnFocusEl = (active && active !== document.body && typeof active.focus === 'function')
      ? active
      : document.getElementById('btnOpenCommandPalette');
  }
  if (typeof closeGlobalProfileDropdown === 'function') closeGlobalProfileDropdown();
  _cmdPaletteQuery = typeof initialQuery === 'string' ? initialQuery : '';
  _cmdPaletteActiveIndex = 0;
  modal.classList.remove('hidden');
  if (typeof trapModalFocus === 'function') trapModalFocus(modal);
  const input = document.getElementById('commandPaletteInput');
  if (input) {
    input.value = _cmdPaletteQuery;
    input.focus?.();
    input.select?.();
  }
  renderCommandPaletteResults();
}
window.openCommandPalette = openCommandPalette;

function closeCommandPalette(options = {}) {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('commandPaletteModal');
  if (!modal || (modal.classList && modal.classList.contains('hidden'))) return;
  modal.classList.add('hidden');
  _cmdPaletteQuery = '';
  _cmdPaletteFilteredItems = [];
  const input = document.getElementById('commandPaletteInput');
  if (input) input.value = '';
  const targetFocus = _cmdPaletteReturnFocusEl;
  _cmdPaletteReturnFocusEl = null;
  if (options?.restoreFocus !== false && targetFocus && typeof targetFocus.focus === 'function') {
    try { targetFocus.focus(); } catch (_) {}
  }
  if (typeof window !== 'undefined' && typeof window.__kbotRefreshAppCosmicEngine === 'function') {
    window.__kbotRefreshAppCosmicEngine();
  }
}
window.closeCommandPalette = closeCommandPalette;

(function bindCommandPaletteEvents() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  let backdropPointerDownOutside = false;
  const modal = document.getElementById('commandPaletteModal');
  const card = document.getElementById('commandPaletteDialogCard');
  if (modal && typeof modal.addEventListener === 'function') {
    const isOutsideCard = (e) => {
      if (!card || typeof card.getBoundingClientRect !== 'function') return e.target === modal;
      const r = card.getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) return e.target === modal;
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    modal.addEventListener('pointerdown', (e) => { backdropPointerDownOutside = isOutsideCard(e); });
    modal.addEventListener('pointerup', (e) => {
      if (backdropPointerDownOutside && isOutsideCard(e)) closeCommandPalette();
      backdropPointerDownOutside = false;
    });
  }

  window.addEventListener('keydown', (e) => {
    if (!e) return;
    const open = isCommandPaletteOpen();
    const keyLower = String(e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && keyLower === 'k') {
      if (!currentUser) return;
      e.preventDefault();
      if (open) closeCommandPalette();
      else openCommandPalette();
      return;
    }
    if (open) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeCommandPalette();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveCommandPaletteSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveCommandPaletteSelection(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeCommandPaletteItem(_cmdPaletteActiveIndex);
      }
      return;
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && currentUser) {
      const t = e.target;
      const tag = String(t?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      const anyModalOpen = document.querySelector?.('.modal:not(.hidden), #loginGate:not(.hidden)');
      if (anyModalOpen) return;
      e.preventDefault();
      openCommandPalette();
    }
  });
})();

(async function init(){
  updateSoundAlertButton();
  initDetailChatInputHistory();

  if (currentUser) {
    try {
      applyUserRoleUI();
      hideLoginGate();
    } catch (_) {}
  }

  try {
    try {
      localStorage.removeItem('kingmc_session');
      sessionStorage.removeItem('kingmc_session');
    } catch (_) {}
    const res = await requestJson('/api/auth/me');

    if (res.ok && res.data?.user) {
      currentUser = res.data.user;
      if (res.data?.maintenance && typeof syncSystemMaintenanceState === 'function') {
        syncSystemMaintenanceState(res.data.maintenance, { rerender: false });
      }
      if (typeof normalizeCurrentUserMaintenanceExpiry === 'function') {
        normalizeCurrentUserMaintenanceExpiry(currentUser, res.data?.maintenance);
      }
      applyUserRoleUI();
      hideLoginGate();
      const routed = await resolveRouteFromUrl();
      if (!routed) await refreshHome();
      connectManagerSseStream();
      scheduleNextManagerPoll();
      checkAndShowAnnouncement();
      loadDiscordLinkStatus({ silent: true });
      if (typeof checkRewardQueryParams === 'function') checkRewardQueryParams();
    } else if (res.status === 401) {
      closeManagerSseStream(true);
      currentUser = null;
      bots = [];
      selectedBotId = null;
      detailBot = null;
      if (managerPollTimerId) clearTimeout(managerPollTimerId);
      try {
        localStorage.removeItem('kingmc_session');
        sessionStorage.removeItem('kingmc_session');
        document.cookie = 'kingmc_mgr_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; SameSite=Lax';
      } catch (_) {}
      applyUserRoleUI();
      renderHome();
      showLoginGate();
    } else if (res.status === 403) {
      closeManagerSseStream(true);
      currentUser = null;
      applyUserRoleUI();
      renderHome();
      showLoginGate();
      showToast(res.data?.error || 'Tài khoản không đủ quyền truy cập.');
    } else {
      if (!currentUser) {
        applyUserRoleUI();
        renderHome();
        showLoginGate();
        showToast('⚠️ Không thể xác minh phiên đăng nhập (' + (res.data?.error || 'Lỗi kết nối') + ').');
      }
    }
  } catch (err) {
    if (!currentUser) {
      applyUserRoleUI();
      renderHome();
      showLoginGate();
    }
  }
})();

var lastUserActivityAt = Date.now();
if (typeof window !== 'undefined') window.__kbotLastActivityAt = lastUserActivityAt;
['mousemove', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
  window.addEventListener(evt, () => {
    const wasIdleLong = (Date.now() - lastUserActivityAt) > 90000;
    lastUserActivityAt = Date.now();
    window.__kbotLastActivityAt = lastUserActivityAt;
    if (wasIdleLong && typeof window.__kbotRefreshAppCosmicEngine === 'function') {
      window.__kbotRefreshAppCosmicEngine();
    }
  }, { passive: true });
});

// managerPollTimerId declared at top of client script
function scheduleNextManagerPoll() {
  if (managerPollTimerId) {
    clearTimeout(managerPollTimerId);
    managerPollTimerId = null;
  }
  if (!currentUser) return;
  if (typeof document === 'undefined' || !document.hidden) {
    connectManagerSseStream();
  }
  const idleMs = Date.now() - lastUserActivityAt;
  const sseAlive = isManagerSseOpen();
  const hasActiveGui = selectedBotId !== null && typeof detailBot === 'object' && detailBot && Boolean(detailBot.currentWindow);
  const activeDelay = sseAlive
    ? (hasActiveGui ? 8000 : (selectedBotId !== null ? 12000 : 20000))
    : (hasActiveGui ? 4500 : (selectedBotId !== null ? 6500 : 8000));
  const delay = document.hidden ? 30000 : (idleMs > 180000 ? 30000 : (idleMs > 60000 ? Math.max(activeDelay, 15000) : activeDelay));
  managerPollTimerId = setTimeout(async () => {
    managerPollTimerId = null;
    if (!currentUser || document.hidden) return; // BW-02: pause polling completely while tab is hidden
    try {
      const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
      if (isOnline && !routeResolving && currentUser) {
        if (selectedBotId === null) await refreshHome();
        else await refreshDetail(false);
      }
    } finally {
      if (currentUser && !document.hidden) {
        scheduleNextManagerPoll();
      }
    }
  }, delay);
}

document.addEventListener('visibilitychange', () => {
  if (!currentUser) return;
  if (document.hidden) {
    closeManagerSseStream(true);
    if (typeof updateLiveSyncIndicators === 'function') updateLiveSyncIndicators('paused');
    if (managerPollTimerId) {
      clearTimeout(managerPollTimerId);
      managerPollTimerId = null;
    }
    return;
  }
  if (typeof updateLiveSyncIndicators === 'function') updateLiveSyncIndicators('syncing', 'Đang đồng bộ lại...');
  lastUserActivityAt = Date.now();
  if (typeof window !== 'undefined') window.__kbotLastActivityAt = lastUserActivityAt;
  connectManagerSseStream();
  // Preserve lastHomeSig so unchanged fleet state reconciles in <120B without full DOM teardown
  if (selectedBotId === null) void refreshHome();
  else void refreshDetail(false);
  scheduleNextManagerPoll();
});

// Network-Aware Sync Engine (Online / Offline non-intrusive banner)
window.addEventListener('offline', () => {
  closeManagerSseStream(true);
  const staticBanner = document.getElementById('networkOfflineBanner');
  if (staticBanner) {
    staticBanner.classList.remove('hidden');
    return;
  }
  let banner = document.getElementById('offlineBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:rgba(239,68,68,0.92);color:#fff;text-align:center;padding:9px 16px;font-size:13px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,0.4);backdrop-filter:blur(8px);';
    banner.innerHTML = '⚠️ <strong>Mất kết nối mạng cục bộ</strong> — Đang chờ tự động đồng bộ lại...';
    document.body.prepend(banner);
  } else {
    banner.style.display = 'block';
  }
});

window.addEventListener('online', () => {
  const staticBanner = document.getElementById('networkOfflineBanner');
  if (staticBanner) staticBanner.classList.add('hidden');
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.style.display = 'none';
  if (!currentUser) return;
  showToast('✅ Đã kết nối lại mạng — Đồng bộ thành công!');
  lastUserActivityAt = Date.now();
  if (typeof window !== 'undefined') window.__kbotLastActivityAt = lastUserActivityAt;
  _managerSseRetryCount = 0;
  connectManagerSseStream();
  if (selectedBotId === null) refreshHome();
  else refreshDetail(true);
  scheduleNextManagerPoll();
});

// Dirty-Form & Active Focus Guard (bảo vệ ô đang nhập không bị đồng bộ ngầm ghi đè)
document.addEventListener('input', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    if ((e.target.value || '').trim() === '' && !e.target.dataset.originalValue) {
      e.target.removeAttribute('data-dirty');
    } else {
      e.target.setAttribute('data-dirty', 'true');
    }
  }
}, { passive: true });

document.addEventListener('change', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    if ((e.target.value || '').trim() === '' && !e.target.dataset.originalValue) {
      e.target.removeAttribute('data-dirty');
    } else {
      e.target.setAttribute('data-dirty', 'true');
    }
  }
}, { passive: true });

document.addEventListener('focusout', (e) => {
  if (e.target && e.target.classList?.contains('card-redeem-input') && (e.target.value || '').trim() === '') {
    e.target.removeAttribute('data-dirty');
  }
}, { passive: true });

setInterval(() => {
  if (!document.hidden) {
    updateDetailUptime();
    if (typeof updateLiveSyncIndicators === 'function') updateLiveSyncIndicators();
  }
}, 1000);
setInterval(() => { if (!document.hidden) updateUserHeaderCountdown(); }, 5000);
setInterval(() => { if (!document.hidden) updateCardGraceCountdowns(); }, 1000);
