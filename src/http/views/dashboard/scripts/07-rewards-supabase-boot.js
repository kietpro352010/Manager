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
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.filter = 'none';
      btn.style.cursor = 'pointer';
      btn.style.pointerEvents = 'auto';
      btn.innerHTML = '<span>⚡</span> Vượt link +12h <span id="link4mUsageBadge" style="font-size:11px;background:rgba(56,189,248,0.25);padding:2px 6px;border-radius:4px;color:#fff;">' + countText + '</span>';
      btn.title = 'Vượt link nhận thêm 12h thời gian sử dụng bot (' + countText + ')';
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

async function openLink4mConfigModal() {
  try {
    const res = await requestJson('/api/manager/settings/system');
    if (res.ok && res.data?.settings) {
      const s = res.data.settings;
      const enabledCb = document.getElementById('link4mModalEnabled');
      if (enabledCb) enabledCb.checked = s.link4mRewardEnabled === true;
      const modeSel = document.getElementById('link4mModalMode');
      if (modeSel) modeSel.value = s.link4mMode || 'custom_url';
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
    }
  } catch (_) {}
  const modal = document.getElementById('link4mSettingsModal');
  if (modal) modal.classList.remove('hidden');
}

function closeLink4mConfigModal() {
  const modal = document.getElementById('link4mSettingsModal');
  if (modal) modal.classList.add('hidden');
}

function updateLink4mModalFields() {
  const mode = document.getElementById('link4mModalMode')?.value || 'custom_url';
  const customGrp = document.getElementById('link4mCustomUrlGroup');
  const apiGrp = document.getElementById('link4mApiTokenGroup');
  if (customGrp) customGrp.style.display = mode === 'custom_url' ? 'block' : 'none';
  if (apiGrp) apiGrp.style.display = mode === 'api' ? 'block' : 'none';
}

async function saveLink4mConfigModal() {
  const enabled = document.getElementById('link4mModalEnabled')?.checked === true;
  const mode = document.getElementById('link4mModalMode')?.value || 'custom_url';
  const url = document.getElementById('link4mModalUrl')?.value || '';
  const apiToken = document.getElementById('link4mModalApiToken')?.value || '';
  const hours = parseInt(document.getElementById('link4mModalHours')?.value, 10) || 12;
  const dailyLimit = parseInt(document.getElementById('link4mModalDailyLimit')?.value, 10) || 2;
  const secretKey = document.getElementById('link4mModalSecretKey')?.value || '';

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
    const added = params.get('added') || '12h';
    showToast('🎉 Chúc mừng! Bạn đã vượt link thành công và được cộng thêm ' + added + ' sử dụng!');
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
            showToast('🎉 Xác nhận từ Link4M thành công! Đã cộng +' + (res.data.rewardHours || 12) + 'h vào tài khoản!');
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

window.toggleTrialGiftSetting = toggleTrialGiftSetting;
window.saveTrialDaysSetting = saveTrialDaysSetting;

function updateDetailUptime(){
  const st = String(detailBot?.status || '').toLowerCase();
  if(!detailBot || !['online', 'afk'].includes(st)) return;
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
      if (urlInput) urlInput.value = res.data.url || '';
      if (keyInput) keyInput.value = res.data.hasKey ? '••••••••••••••••' : '';

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

  const url = (document.getElementById('supabaseUrlInput')?.value || '').trim();
  const key = (document.getElementById('supabaseKeyInput')?.value || '').trim();

  if (!url) {
    if (alertBox) {
      alertBox.textContent = '⚠️ Vui lòng nhập Supabase Project URL.';
      alertBox.className = 'login-alert error';
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang test...'; }
  if (alertBox) alertBox.className = 'login-alert hidden';

  try {
    const res = await requestJson('/api/manager/supabase/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, key })
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
  const btn = document.getElementById('supabaseSaveBtn');
  const alertBox = document.getElementById('supabaseAlertBox');
  const badge = document.getElementById('supabaseStatusBadge');
  const statusMsg = document.getElementById('supabaseStatusMsg');

  const url = (document.getElementById('supabaseUrlInput')?.value || '').trim();
  const key = (document.getElementById('supabaseKeyInput')?.value || '').trim();

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang lưu...'; }
  if (alertBox) alertBox.className = 'login-alert hidden';

  try {
    const res = await requestJson('/api/manager/supabase/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, key })
    });

    if (res.ok) {
      if (alertBox) {
        alertBox.textContent = '✅ ' + (res.data?.message || 'Đã lưu cấu hình Supabase!');
        alertBox.className = 'login-alert success';
      }
      if (badge) {
        if (res.data.connected) {
          badge.innerHTML = '🟢 Đã kết nối';
          badge.style.background = 'rgba(34,197,94,0.2)';
          badge.style.color = '#4ade80';
          badge.style.borderColor = 'rgba(34,197,94,0.4)';
        } else {
          badge.innerHTML = '🟡 Đã lưu (Chưa ping)';
          badge.style.background = 'rgba(234,179,8,0.2)';
          badge.style.color = '#eab308';
          badge.style.borderColor = 'rgba(234,179,8,0.4)';
        }
      }
      if (statusMsg) statusMsg.textContent = res.data?.message || 'Cấu hình đã được lưu.';
      showToast('✅ Đã lưu cấu hình Supabase Cloud!');
    } else {
      if (alertBox) {
        alertBox.textContent = '⚠️ ' + (res.data?.error || 'Lưu cấu hình thất bại.');
        alertBox.className = 'login-alert error';
      }
    }
  } catch (err) {
    if (alertBox) {
      alertBox.textContent = '⚠️ Lỗi: ' + err.message;
      alertBox.className = 'login-alert error';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Lưu cấu hình'; }
  }
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
  const saveBtn = document.getElementById('supabaseSaveBtn');
  const alertBox = document.getElementById('supabaseAlertBox');
  if (btn?.disabled) return;

  const isUpload = endpoint.includes('upload');

  if (btn) {
    btn.disabled = true;
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-sm"></span> ' + escapeHtml(busyText);
  }
  if (otherBtn) otherBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;

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
    if (saveBtn) saveBtn.disabled = false;
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
window.openBroadcastModal = openBroadcastModal;
window.closeBroadcastModal = closeBroadcastModal;
window.submitBroadcast = submitBroadcastCommand;
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
window.openBroadcastModal = openBroadcastModal;
window.closeBroadcastModal = closeBroadcastModal;
window.submitBroadcastCommand = submitBroadcastCommand;
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
      applyUserRoleUI();
      hideLoginGate();
      const routed = await resolveRouteFromUrl();
      if (!routed) await refreshHome();
      scheduleNextManagerPoll();
      checkAndShowAnnouncement();
      loadDiscordLinkStatus({ silent: true });
      if (typeof checkRewardQueryParams === 'function') checkRewardQueryParams();
    } else if (res.status === 401) {
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

let lastUserActivityAt = Date.now();
['mousemove', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
  window.addEventListener(evt, () => { lastUserActivityAt = Date.now(); }, { passive: true });
});

// managerPollTimerId declared at top of client script
function scheduleNextManagerPoll() {
  if (managerPollTimerId) {
    clearTimeout(managerPollTimerId);
    managerPollTimerId = null;
  }
  if (!currentUser) return;
  const isIdle = Date.now() - lastUserActivityAt > 90 * 1000;
  const delay = document.hidden ? 30000 : (isIdle ? 20000 : 5000); // 5s active poll, 20s idle (>90s), 30s guard while hidden
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
    if (managerPollTimerId) {
      clearTimeout(managerPollTimerId);
      managerPollTimerId = null;
    }
    return;
  }
  lastUserActivityAt = Date.now();
  lastHomeSig = ''; // Force immediate fresh reconciliation on tab focus
  if (selectedBotId === null) void refreshHome();
  else void refreshDetail(true);
  scheduleNextManagerPoll();
});

// Network-Aware Sync Engine (Online / Offline non-intrusive banner)
window.addEventListener('offline', () => {
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
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.style.display = 'none';
  if (!currentUser) return;
  showToast('✅ Đã kết nối lại mạng — Đồng bộ thành công!');
  lastUserActivityAt = Date.now();
  if (selectedBotId === null) refreshHome();
  else refreshDetail(true);
  scheduleNextManagerPoll();
});

// Dirty-Form & Active Focus Guard (bảo vệ ô đang nhập không bị đồng bộ ngầm ghi đè)
document.addEventListener('input', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    e.target.setAttribute('data-dirty', 'true');
  }
}, { passive: true });

document.addEventListener('change', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    e.target.setAttribute('data-dirty', 'true');
  }
}, { passive: true });

setInterval(() => { if (!document.hidden) updateDetailUptime(); }, 1000);
setInterval(() => { if (!document.hidden) updateUserHeaderCountdown(); }, 5000);
setInterval(() => { if (!document.hidden) updateCardGraceCountdowns(); }, 1000);
