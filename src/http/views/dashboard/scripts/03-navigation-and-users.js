// ============================================================================
// V12.1 COMMERCIAL ENTERPRISE EDITION — ROUTER & USER MANAGEMENT CONTROLLER
// ============================================================================

let currentEditingUserId = null;
let userManagementBotOwnership = {};
let currentUserStatusFilter = 'all';
let userFilterSearchTimer = null;
let pendingBotReassignCallback = null;
let currentNavPage = 'dashboard';

// Điều hướng trang lớn (Full-Page Navigation Router)
function navigateTo(pageName, options = {}) {
  if (pageName === 'users' || pageName === 'audit' || pageName === 'backup') {
    if (!currentUser || currentUser.role !== 'admin') {
      pageName = 'dashboard';
    }
  }
  currentNavPage = pageName;
  closeGlobalProfileDropdown();

  const pages = {
    dashboard: document.getElementById('homePage'),
    users: document.getElementById('userManagementPage'),
    audit: document.getElementById('auditPage'),
    backup: document.getElementById('backupPage'),
    detail: document.getElementById('detailPage')
  };

  const navPills = {
    dashboard: document.getElementById('navPillHome'),
    users: document.getElementById('navPillUsers'),
    audit: document.getElementById('navPillAudit'),
    backup: document.getElementById('navPillBackup')
  };

  // Ẩn tất cả trang và tắt active nav pill
  Object.keys(pages).forEach(k => {
    if (pages[k]) pages[k].classList.add('hidden');
    if (navPills[k]) navPills[k]?.classList.remove('active');
  });

  if (pageName !== 'detail') {
    selectedBotId = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('bot');
    url.searchParams.delete('botUrl');
    if (['users', 'audit', 'backup'].includes(pageName)) {
      url.searchParams.set('page', pageName);
    } else {
      url.searchParams.delete('page');
    }
    const nextUrl = url.pathname + url.search;
    const currentUrl = window.location.pathname + window.location.search;
    if (!options.skipHistory && nextUrl !== currentUrl) {
      if (options.replace) history.replaceState({ page: pageName }, '', nextUrl);
      else history.pushState({ page: pageName }, '', nextUrl);
    }
  }

  const targetPage = pages[pageName] || pages.dashboard;
  if (targetPage) targetPage.classList.remove('hidden');
  if (navPills[pageName]) navPills[pageName]?.classList.add('active');

  const sidebarActivePage = pageName === 'detail' ? 'dashboard' : pageName;
  document.querySelectorAll('[data-sidebar-page]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-sidebar-page') === sidebarActivePage);
  });

  // Kích hoạt nạp dữ liệu cho trang đích
  if (pageName === 'dashboard') {
    refreshHome();
  } else if (pageName === 'users') {
    refreshUserManagementPage();
  } else if (pageName === 'audit') {
    refreshAuditLogs(1);
  } else if (pageName === 'backup') {
    refreshBackupList();
  }
}
window.navigateTo = navigateTo;

function fitGlobalProfileDropdownHeight() {
  const dropdown = document.getElementById('globalUserProfileDropdown');
  const btn = document.getElementById('globalUserProfileBtn');
  if (!dropdown || dropdown.classList.contains('hidden')) return;
  const viewportH = window.innerHeight || document.documentElement?.clientHeight || 720;
  const btnBottom = btn && typeof btn.getBoundingClientRect === 'function'
    ? btn.getBoundingClientRect().bottom
    : 60;
  const maxHeightPx = Math.max(200, Math.floor(viewportH - btnBottom - 16));
  dropdown.style.maxHeight = maxHeightPx + 'px';
  dropdown.style.overflowY = 'auto';
  dropdown.style.overflowX = 'hidden';
}

function toggleGlobalProfileDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('globalUserProfileDropdown');
  const btn = document.getElementById('globalUserProfileBtn');
  if (!dropdown) return;
  const isNowHidden = dropdown.classList.toggle('hidden');
  if (btn) btn.setAttribute('aria-expanded', String(!isNowHidden));
  if (!isNowHidden) {
    fitGlobalProfileDropdownHeight();
  }
}
window.toggleGlobalProfileDropdown = toggleGlobalProfileDropdown;
window.addEventListener('resize', fitGlobalProfileDropdownHeight, { passive: true });
window.addEventListener('orientationchange', fitGlobalProfileDropdownHeight, { passive: true });

function closeGlobalProfileDropdown() {
  const dropdown = document.getElementById('globalUserProfileDropdown');
  const btn = document.getElementById('globalUserProfileBtn');
  if (dropdown) dropdown.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
window.closeGlobalProfileDropdown = closeGlobalProfileDropdown;

// ⌨️ ACCESSIBILITY: MODAL FOCUS TRAPPING, ESCAPE LISTENER & FOCUS RESTORATION (G5-02)
const MODAL_FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getVisibleFocusableElements(container) {
  if (!container) return [];
  const all = Array.from(container.querySelectorAll(MODAL_FOCUSABLE_SELECTOR));
  return all.filter(el => {
    if (el.disabled || el.hidden || el.type === 'hidden') return false;
    if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) return false;
    if (typeof el.closest === 'function' && el.closest('.hidden, [hidden]')) return false;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const cs = window.getComputedStyle(el);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
      } catch (_) {}
    }
    if (typeof el.getClientRects === 'function') {
      try {
        if (el.getClientRects().length === 0) return false;
      } catch (_) {}
    }
    return true;
  });
}

function trapModalFocus(modalEl) {
  if (!modalEl) return;
  if (!modalEl.hasAttribute('role')) modalEl.setAttribute('role', 'dialog');
  if (!modalEl.hasAttribute('aria-modal')) modalEl.setAttribute('aria-modal', 'true');
  if (!modalEl.hasAttribute('aria-labelledby') && !modalEl.hasAttribute('aria-label')) {
    const heading = modalEl.querySelector('h1, h2, h3, h4, .modal-title');
    if (heading) {
      if (!heading.id) heading.id = 'modalTitle_' + Math.random().toString(36).slice(2, 9);
      modalEl.setAttribute('aria-labelledby', heading.id);
    } else {
      modalEl.setAttribute('aria-label', 'Hộp thoại');
    }
  }

  if (modalEl._hasModalFocusTrap) return;
  modalEl._hasModalFocusTrap = true;

  modalEl.addEventListener('keydown', function(e) {
    if (e.key !== 'Tab') return;
    const focusable = getVisibleFocusableElements(modalEl);
    if (!focusable.length) {
      e.preventDefault();
      modalEl.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || document.activeElement === modalEl || !modalEl.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !modalEl.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

function openAccessibleModal(modalEl) {
  if (!modalEl) return;
  if (typeof closeGlobalProfileDropdown === 'function') closeGlobalProfileDropdown();
  const stack = (document._kbotOpenModalStack = document._kbotOpenModalStack || []);
  const idx = stack.indexOf(modalEl);
  if (idx !== -1) stack.splice(idx, 1);
  stack.push(modalEl);
  modalEl._previousActiveElement = document.activeElement;
  modalEl.classList.remove('hidden');
  trapModalFocus(modalEl);
  setTimeout(() => {
    const focusable = getVisibleFocusableElements(modalEl);
    if (focusable.length > 0) {
      const primaryInput = focusable.find((el) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && el.type !== 'hidden');
      (primaryInput || focusable[0]).focus();
    } else {
      if (!modalEl.hasAttribute('tabindex')) modalEl.setAttribute('tabindex', '-1');
      modalEl.focus();
    }
  }, 10);
}

function closeAccessibleModal(modalEl) {
  if (!modalEl) return;
  const stack = (document._kbotOpenModalStack = document._kbotOpenModalStack || []);
  const idx = stack.indexOf(modalEl);
  if (idx !== -1) stack.splice(idx, 1);
  modalEl.classList.add('hidden');
  if (modalEl._previousActiveElement && typeof modalEl._previousActiveElement.focus === 'function') {
    try { modalEl._previousActiveElement.focus(); } catch (_) {}
    modalEl._previousActiveElement = null;
  }
}

function setupAccessibleModals() {
  const modals = document.querySelectorAll('.modal, .account-restriction-overlay');
  modals.forEach(modal => {
    trapModalFocus(modal);
    if (typeof MutationObserver !== 'undefined' && !modal._hasModalObserver) {
      modal._hasModalObserver = true;
      let wasHidden = modal.classList.contains('hidden') || (modal.style && modal.style.display === 'none');
      const observer = new MutationObserver(() => {
        const isHidden = modal.classList.contains('hidden') || (modal.style && modal.style.display === 'none');
        const stack = (document._kbotOpenModalStack = document._kbotOpenModalStack || []);
        if (wasHidden && !isHidden) {
          if (typeof closeGlobalProfileDropdown === 'function') closeGlobalProfileDropdown();
          const idx = stack.indexOf(modal);
          if (idx !== -1) stack.splice(idx, 1);
          stack.push(modal);
          // Modal opened: record previous active element and focus primary input or first interactive element
          modal._previousActiveElement = document.activeElement;
          setTimeout(() => {
            const focusable = getVisibleFocusableElements(modal);
            if (focusable.length > 0) {
              const primaryInput = focusable.find((el) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && el.type !== 'hidden');
              (primaryInput || focusable[0]).focus();
            } else {
              if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
              modal.focus();
            }
          }, 10);
        } else if (!wasHidden && isHidden) {
          const idx = stack.indexOf(modal);
          if (idx !== -1) stack.splice(idx, 1);
          // Modal closed: restore focus
          if (modal._previousActiveElement && typeof modal._previousActiveElement.focus === 'function') {
            try { modal._previousActiveElement.focus(); } catch (_) {}
            modal._previousActiveElement = null;
          }
        }
        wasHidden = isHidden;
      });
      observer.observe(modal, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    }
  });
}

window.trapModalFocus = trapModalFocus;
window.openAccessibleModal = openAccessibleModal;
window.closeAccessibleModal = closeAccessibleModal;
window.setupAccessibleModals = setupAccessibleModals;

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAccessibleModals);
  } else {
    setTimeout(setupAccessibleModals, 0);
  }
}

// ⌨️ ACCESSIBILITY: Đóng menu/cổng/modal khi nhấn phím Escape và khôi phục focus (KHÔNG đóng màn hình khóa tài khoản)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const dropdown = document.getElementById('globalUserProfileDropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    closeGlobalProfileDropdown();
    document.getElementById('globalUserProfileBtn')?.focus();
    return;
  }
  const loginGate = document.getElementById('loginGate');
  if (loginGate && !loginGate.classList.contains('hidden')) {
    if (currentUser) hideLoginGate();
    return;
  }
  const stack = Array.isArray(document._kbotOpenModalStack) ? document._kbotOpenModalStack : [];
  let modal = null;
  for (let i = stack.length - 1; i >= 0; i--) {
    const candidate = stack[i];
    if (candidate && !candidate.classList.contains('hidden')) {
      modal = candidate;
      break;
    }
  }
  if (!modal) {
    const openModals = Array.from(document.querySelectorAll('.modal:not(.hidden)'));
    if (openModals.length > 0) modal = openModals[openModals.length - 1];
  }
  if (modal) {
    e.preventDefault();
    if (modal.id === 'userAnnouncementModal' && typeof dismissUserAnnouncement === 'function') {
      dismissUserAnnouncement();
      closeAccessibleModal(modal);
    } else if (modal.id === 'reassignBotConfirmModal' && typeof closeReassignBotConfirmModal === 'function') {
      closeReassignBotConfirmModal(false);
    } else {
      closeAccessibleModal(modal);
    }
  }
});

// Chuyển tab Đăng nhập / Đăng ký tại Login Gate
function switchLoginGateTab(tab) {
  if (tab === 'register') {
    window.location.href = '/login?tab=register';
    return;
  }
  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registerForm');
  const btnLogin = document.getElementById('tabBtnLogin');
  const btnReg = document.getElementById('tabBtnRegister');
  const alertEl = document.getElementById('loginAlert');
  if (alertEl) { alertEl.classList.add('hidden'); alertEl.textContent = ''; }

  if (loginForm) loginForm.style.display = 'flex';
  if (regForm) regForm.style.display = 'none';
  if (btnLogin) {
    btnLogin.setAttribute('aria-selected', 'true');
    btnLogin.style.background = 'rgba(56,189,248,0.2)';
    btnLogin.style.color = '#38bdf8';
    btnLogin.style.borderColor = 'rgba(56,189,248,0.4)';
  }
  if (btnReg) {
    btnReg.setAttribute('aria-selected', 'false');
    btnReg.style.background = 'transparent';
    btnReg.style.color = '#94a3b8';
    btnReg.style.borderColor = 'transparent';
  }
}
window.switchLoginGateTab = switchLoginGateTab;

function getInAppDeviceFingerprint() {
  try {
    const parts = [
      screen.width || 0,
      screen.height || 0,
      screen.colorDepth || 0,
      navigator.hardwareConcurrency || 1,
      navigator.languages ? navigator.languages.join(',') : (navigator.language || ''),
      Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    ];
    const raw = parts.join(';');
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return 'dfp_' + (h >>> 0).toString(16);
  } catch (_) {
    return 'dfp_unknown';
  }
}

async function refreshInAppRegisterCaptcha() {
  const wrap = document.getElementById('inAppRegCaptchaWrap');
  const container = document.getElementById('inAppRegCaptchaImgContainer');
  const tokenInput = document.getElementById('inAppRegCaptchaToken');
  const answerInput = document.getElementById('inAppRegCaptchaAnswer');
  if (!wrap || !container) return;
  if (answerInput) answerInput.value = '';
  try {
    const res = await requestJson('/api/auth/captcha');
    if (res.ok && res.data && res.data.token && res.data.svg) {
      wrap.style.display = 'block';
      if (tokenInput) tokenInput.value = res.data.token;
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(res.data.svg, 'image/svg+xml');
      if (svgDoc.documentElement) container.replaceChildren(svgDoc.documentElement);
    }
  } catch (_) {}
}
window.refreshInAppRegisterCaptcha = refreshInAppRegisterCaptcha;

// Xử lý tự đăng ký tài khoản mới trên In-App Login Gate
async function handleInAppRegisterSubmit(event) {
  if (event) event.preventDefault();
  const alertEl = document.getElementById('loginAlert');
  const submitBtn = document.getElementById('regSubmitBtn');
  const username = String(document.getElementById('regUsername')?.value || '').trim();
  const password = String(document.getElementById('regPassword')?.value || '');
  const confirmPassword = String(document.getElementById('regConfirmPassword')?.value || '');
  const licenseKey = String(document.getElementById('regLicenseKey')?.value || '').trim().toUpperCase();
  const captchaToken = String(document.getElementById('inAppRegCaptchaToken')?.value || '');
  const captchaAnswer = String(document.getElementById('inAppRegCaptchaAnswer')?.value || '').trim();

  if (alertEl) { alertEl.classList.add('hidden'); alertEl.textContent = ''; }

  if (!username) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Vui lòng nhập tên đăng nhập.'; alertEl.classList.remove('hidden'); }
    return;
  }
  if (password.length < 6) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Mật khẩu phải có ít nhất 6 ký tự.'; alertEl.classList.remove('hidden'); }
    return;
  }
  if (password !== confirmPassword) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Mật khẩu xác nhận không khớp!'; alertEl.classList.remove('hidden'); }
    return;
  }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Đang khởi tạo tài khoản...'; }

  try {
    const res = await requestJson('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        confirmPassword,
        key: licenseKey,
        licenseKey,
        deviceFingerprint: getInAppDeviceFingerprint(),
        ...(captchaToken ? { captchaToken, captchaAnswer } : {})
      })
    });

    if (!res.ok) {
      throw new Error(res.data?.message || res.data?.error || 'Đăng ký tài khoản thất bại.');
    }

    const data = res.data || {};
    currentUser = data.user || null;

    if (alertEl) {
      alertEl.textContent = '🎉 ' + (data.message || 'Đăng ký thành công! Đang vào hệ thống...');
      alertEl.className = 'login-alert success';
      alertEl.classList.remove('hidden');
    }
    showToast('🎉 ' + (data.message || 'Đăng ký thành công! Chào mừng ' + username + '.'));

    setTimeout(async () => {
      hideLoginGate();
      applyUserRoleUI();
      await refreshHome();
      scheduleNextManagerPoll();
      checkAndShowAnnouncement();
      if (typeof checkRewardQueryParams === 'function') checkRewardQueryParams();
    }, 350);
  } catch (err) {
    void refreshInAppRegisterCaptcha();
    if (alertEl) {
      alertEl.className = 'login-alert error';
      alertEl.textContent = '⚠️ ' + err.message;
      alertEl.classList.remove('hidden');
    }
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '📝 TẠO TÀI KHOẢN & VÀO HỆ THỐNG'; }
  }
}
window.handleInAppRegisterSubmit = handleInAppRegisterSubmit;

// Kích hoạt mã Key từ màn hình thông báo Hết hạn (Blur Overlay)
async function redeemKeyFromExpiredOverlay() {
  const keyInput = document.getElementById('expiredKeyInput');
  const alertEl = document.getElementById('expiredKeyAlert');
  const redeemBtn = document.getElementById('expiredRedeemBtn');
  const key = String(keyInput?.value || '').trim().toUpperCase();

  if (alertEl) { alertEl.classList.add('hidden'); alertEl.textContent = ''; }

  if (!key) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Vui lòng nhập mã Key gia hạn.'; alertEl.classList.remove('hidden'); }
    return;
  }

  if (redeemBtn) redeemBtn.disabled = true;
  try {
    const res = await requestJson('/api/manager/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, licenseKey: key })
    });
    if (!res.ok) {
      throw new Error(res.data?.error || 'Mã Key không hợp lệ hoặc đã qua sử dụng.');
    }
    showToast((res.data?.partial ? '⚠️ ' : '🎉 ') + (res.data?.warning || 'Kích hoạt Key thành công! Đang tải lại phiên làm việc...'));
    setTimeout(() => { window.location.reload(); }, res.data?.partial ? 1800 : 800);
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'login-alert error';
      alertEl.textContent = '⚠️ ' + err.message;
      alertEl.classList.remove('hidden');
    }
  } finally {
    if (redeemBtn) redeemBtn.disabled = false;
  }
}
window.redeemKeyFromExpiredOverlay = redeemKeyFromExpiredOverlay;

// Chuyển Sub-Tab giữa User List, Key List và Whitelist IP trên trang Quản lý User
function switchUserMgmtSubTab(subTab) {
  const panelUsers = document.getElementById('subPanelUsers');
  const panelKeys = document.getElementById('subPanelKeys');
  const panelWhitelist = document.getElementById('subPanelWhitelist');
  const tabUsers = document.getElementById('subTabUsers');
  const tabKeys = document.getElementById('subTabKeys');
  const tabWhitelist = document.getElementById('subTabWhitelist');

  if (panelUsers) panelUsers.classList.add('hidden');
  if (panelKeys) panelKeys.classList.add('hidden');
  if (panelWhitelist) panelWhitelist.classList.add('hidden');
  if (tabUsers) { tabUsers.classList.remove('active'); tabUsers.setAttribute('aria-selected', 'false'); }
  if (tabKeys) { tabKeys.classList.remove('active'); tabKeys.setAttribute('aria-selected', 'false'); }
  if (tabWhitelist) { tabWhitelist.classList.remove('active'); tabWhitelist.setAttribute('aria-selected', 'false'); }

  if (subTab === 'keys') {
    if (panelKeys) panelKeys.classList.remove('hidden');
    if (tabKeys) { tabKeys.classList.add('active'); tabKeys.setAttribute('aria-selected', 'true'); }
    refreshKeysTable();
  } else if (subTab === 'whitelist') {
    if (panelWhitelist) panelWhitelist.classList.remove('hidden');
    if (tabWhitelist) { tabWhitelist.classList.add('active'); tabWhitelist.setAttribute('aria-selected', 'true'); }
    refreshWhitelistTable();
  } else {
    if (panelUsers) panelUsers.classList.remove('hidden');
    if (tabUsers) { tabUsers.classList.add('active'); tabUsers.setAttribute('aria-selected', 'true'); }
    refreshUserManagementPage();
  }
}
window.switchUserMgmtSubTab = switchUserMgmtSubTab;

async function refreshWhitelistTable() {
  const tbody = document.getElementById('whitelistFullTableBody');
  const countEl = document.getElementById('whitelistTotalCount');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted);">Đang tải danh sách Whitelist...</td></tr>';
  }
  try {
    const res = await requestJson('/api/admin/ip-whitelist');
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tải danh sách Whitelist.');
    const list = Array.isArray(res.data?.whitelist) ? res.data.whitelist : [];
    if (countEl) countEl.textContent = list.length;

    if (!list.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--muted);">Chưa có IP nào trong Whitelist. Thêm IP ở trên để bỏ qua giới hạn tạo acc.</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = list.map(item => {
        const ipEsc = escapeHtml(item.ip);
        const reasonEsc = escapeHtml(item.reason || '—');
        const byEsc = escapeHtml(item.created_by || 'admin');
        const timeEsc = item.created_at ? new Date(item.created_at).toLocaleString('vi-VN') : '—';
        return '<tr>' +
          '<td><strong style="font-family:var(--font-mono);color:#38bdf8;">' + ipEsc + '</strong></td>' +
          '<td>' + reasonEsc + '</td>' +
          '<td><span class="chip" style="font-size:11px;">' + byEsc + '</span></td>' +
          '<td style="font-size:12px;color:var(--muted);">' + timeEsc + '</td>' +
          '<td style="text-align:right;">' +
            '<button type="button" class="small danger btn-delete-ip-whitelist" data-delete-ip="' + ipEsc + '" style="padding:4px 8px;font-size:11px;">🗑 Xóa</button>' +
          '</td>' +
        '</tr>';
      }).join('');
      if (!tbody._ipDeleteDelegated) {
        tbody._ipDeleteDelegated = true;
        tbody.addEventListener('click', (ev) => {
          const btn = ev.target && ev.target.closest ? ev.target.closest('[data-delete-ip]') : null;
          if (!btn) return;
          const targetIp = btn.getAttribute('data-delete-ip');
          if (targetIp) void deleteIpWhitelist(targetIp);
        });
      }
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--red);padding:24px;">Lỗi: ' + escapeHtml(err.message) + '</td></tr>';
  }
}
window.refreshWhitelistTable = refreshWhitelistTable;

async function submitAddIpWhitelist() {
  const ipInput = document.getElementById('newWhitelistIp');
  const reasonInput = document.getElementById('newWhitelistReason');
  const ip = String(ipInput?.value || '').trim();
  const reason = String(reasonInput?.value || '').trim();

  if (!ip) {
    showToast('Vui lòng nhập địa chỉ IP cần thêm vào Whitelist.', 'warning');
    return;
  }

  try {
    const res = await requestJson('/api/admin/ip-whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { ip, reason }
    });
    if (!res.ok) throw new Error(res.data?.error || 'Thêm IP thất bại.');
    showToast(res.data?.message || 'Đã thêm IP vào Whitelist thành công!', 'success');
    if (ipInput) ipInput.value = '';
    if (reasonInput) reasonInput.value = '';
    refreshWhitelistTable();
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
}
window.submitAddIpWhitelist = submitAddIpWhitelist;

async function deleteIpWhitelist(ip) {
  if (!confirm('Bạn có chắc chắn muốn xóa IP ' + ip + ' khỏi Whitelist?')) return;
  try {
    const res = await requestJson('/api/admin/ip-whitelist/' + encodeURIComponent(ip), {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error(res.data?.error || 'Xóa IP thất bại.');
    showToast(res.data?.message || 'Đã xóa IP khỏi Whitelist.', 'success');
    refreshWhitelistTable();
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
}
window.deleteIpWhitelist = deleteIpWhitelist;

async function openUserManagementModal() {
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền mở quản lý user.');
    return;
  }
  navigateTo('users');
}
window.openUserManagementModal = openUserManagementModal;

function closeUserManagementModal() {
  navigateTo('dashboard');
}
window.closeUserManagementModal = closeUserManagementModal;

// Tải dữ liệu toàn bộ User và Bot Ownership
async function refreshUserManagementPage() {
  void loadTrialGiftSetting();
  if (typeof loadMaintenanceAdminSetting === 'function') {
    void loadMaintenanceAdminSetting();
  }
  const tbodyFull = document.getElementById('userFullTableBody');
  const placeholders = [tbodyFull].filter(Boolean);
  placeholders.forEach(tb => {
    tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">⏳ Đang làm mới dữ liệu người dùng...</td></tr>';
  });

  try {
    const res = await requestJson('/api/manager/users');
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tải danh sách user.');
    userManagementList = (Array.isArray(res.data?.users) ? res.data.users : [])
      .map(u => ({ ...u, id: u.id || u.userId }))
      .filter(u => u.role !== 'admin' && String(u.username || '').toLowerCase() !== 'admin');
    userManagementAvailableBots = Array.isArray(res.data?.availableBots) ? res.data.availableBots : [];
    userManagementBotOwnership = (res.data?.botOwnership && typeof res.data.botOwnership === 'object') ? res.data.botOwnership : {};

    // Cập nhật các thống kê số liệu (UX-01: chỉ tính Vĩnh Viễn khi isPermanent === true)
    const total = userManagementList.length;
    const now = Date.now();
    const activeCount = userManagementList.filter(u => u.status === 'active' && (u.isPermanent === true || (u.expiresAt && Date.parse(u.expiresAt) > now))).length;
    const disabledCount = userManagementList.filter(u => u.status === 'disabled').length;
    const expiredCount = userManagementList.filter(u => u.isPermanent !== true && (u.status === 'expired' || (u.expiresAt && Date.parse(u.expiresAt) <= now))).length;
    const lifetimeCount = userManagementList.filter(u => u.isPermanent === true).length;

    const elTotal = document.getElementById('userMgmtTotalCount'); if (elTotal) elTotal.textContent = total;
    const elStatAll = document.getElementById('statUserAll'); if (elStatAll) elStatAll.textContent = total;
    const elStatAct = document.getElementById('statUserActive'); if (elStatAct) elStatAct.textContent = activeCount;
    const elStatDis = document.getElementById('statUserDisabled'); if (elStatDis) elStatDis.textContent = disabledCount;
    const elStatExp = document.getElementById('statUserExpired'); if (elStatExp) elStatExp.textContent = expiredCount;
    const elStatLife = document.getElementById('statUserLifetime'); if (elStatLife) elStatLife.textContent = lifetimeCount;

    renderUserTable();
  } catch (err) {
    placeholders.forEach(tb => {
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--red);padding:24px;">Lỗi: ' + escapeHtml(err.message) + '</td></tr>';
    });
  }
}
window.refreshUserManagementPage = refreshUserManagementPage;
window.refreshUserManagementList = refreshUserManagementPage;

function setUserStatusFilter(status) {
  currentUserStatusFilter = status;
  const chipMap = {
    all: document.getElementById('userFilterAll'),
    active: document.getElementById('userFilterActive'),
    disabled: document.getElementById('userFilterDisabled'),
    expired: document.getElementById('userFilterExpired'),
    lifetime: document.getElementById('userFilterLifetime')
  };
  Object.keys(chipMap).forEach(k => {
    if (chipMap[k]) {
      chipMap[k].classList.toggle('active', k === status);
      chipMap[k].setAttribute('aria-pressed', k === status ? 'true' : 'false');
    }
  });
  renderUserTable();
}
window.setUserStatusFilter = setUserStatusFilter;

function debounceUserFilter() {
  if (userFilterSearchTimer) clearTimeout(userFilterSearchTimer);
  userFilterSearchTimer = setTimeout(() => { renderUserTable(); }, 200);
}
window.debounceUserFilter = debounceUserFilter;

// Bật / tắt hiển thị mật khẩu người dùng (Toggle Peek - On-Demand)
async function toggleUserPasswordPeek(userId) {
  const key = String(userId);
  const u = userManagementList.find(x => String(x.id) === key);
  if (!userPassPeekMap[key]) {
    const storedPass = u && typeof u.password === 'string' ? u.password : '';
    const needsReveal = !storedPass || /^(enc:v|aes256\$|enc\$|scrypt\$)/i.test(storedPass);
    if (u && needsReveal) {
      try {
        const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId) + '/reveal-password', { method: 'POST' });
        const pass = res.data?.password ?? res.password;
        if (res.ok && typeof pass === 'string' && pass.length > 0) {
          u.password = pass;
        } else if (!res.ok) {
          showToast(res.data?.error || 'Không thể lấy mật khẩu người dùng.', 'error');
          return;
        } else {
          u.password = pass || '(trống)';
        }
      } catch (err) {
        showToast('Không thể lấy mật khẩu: ' + (err.message || err), 'error');
        return;
      }
    }
    userPassPeekMap[key] = true;
  } else {
    userPassPeekMap[key] = false;
  }
  renderUserTable();
}
window.toggleUserPasswordPeek = toggleUserPasswordPeek;
window.togglePassPeek = (userId) => toggleUserPasswordPeek(userId);

function attachUserTableDelegation(tbody) {
  if (!tbody || tbody._userDelegationInit) return;
  tbody._userDelegationInit = true;
  tbody.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-user-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-user-action');
    const userId = btn.getAttribute('data-user-id');
    const u = userId ? userManagementList.find(x => String(x.id) === String(userId)) : null;
    const username = u ? u.username : (btn.getAttribute('data-username') || '');
    if (action === 'copy-pass') {
      if (u && u.password && u.password !== '—' && u.password !== '(trống)') {
        copyToClipboard(u.password, 'Mật khẩu');
      }
    } else if (action === 'peek') {
      if (userId) toggleUserPasswordPeek(userId);
    } else if (action === 'quick-renew') {
      const days = Number(btn.getAttribute('data-days'));
      if (userId && Number.isFinite(days)) quickRenewUser(userId, days);
    } else if (action === 'set-lifetime') {
      if (userId) quickSetLifetimeUser(userId);
    } else if (action === 'custom-renew') {
      if (userId) openCustomRenewModal(userId, username);
    } else if (action === 'unlock') {
      if (userId) unlockUser(userId);
    } else if (action === 'lock') {
      if (userId) promptLockUser(userId, username);
    } else if (action === 'edit') {
      if (userId) openEditUserModal(userId);
    } else if (action === 'delete') {
      if (userId) deleteUserPrompt(userId, username);
    }
  });
}

// Render bảng User (áp dụng bộ lọc trạng thái và tìm kiếm thời gian thực)
function renderUserTable() {
  const tbodyFull = document.getElementById('userFullTableBody');
  const targets = [tbodyFull].filter(Boolean);
  if (!targets.length) return;
  targets.forEach(attachUserTableDelegation);

  const searchQuery = String(document.getElementById('userFilterSearch')?.value || '').trim().toLowerCase();
  const now = Date.now();

  const filtered = userManagementList
    .filter(u => u.role !== 'admin' && String(u.username || '').toLowerCase() !== 'admin')
    .filter(u => {
    // Lọc theo từ khóa tìm kiếm
    if (searchQuery) {
      const matchUser = String(u.username || '').toLowerCase().includes(searchQuery);
      const matchNote = String(u.note || '').toLowerCase().includes(searchQuery);
      const matchPlan = String(u.planName || '').toLowerCase().includes(searchQuery);
      const matchDiscord = String(u.discordUserId || u.discord_user_id || '').toLowerCase().includes(searchQuery);
      if (!matchUser && !matchNote && !matchPlan && !matchDiscord) return false;
    }

    // Lọc theo trạng thái (UX-01: chỉ coi là Vĩnh Viễn khi isPermanent === true)
    const isLife = u.isPermanent === true;
    const isAct = u.status === 'active' && (isLife || (u.expiresAt && Date.parse(u.expiresAt) > now));
    const isDis = u.status === 'disabled';
    const isExp = !isLife && (u.status === 'expired' || (u.expiresAt && Date.parse(u.expiresAt) <= now));

    if (currentUserStatusFilter === 'active') return isAct;
    if (currentUserStatusFilter === 'disabled') return isDis;
    if (currentUserStatusFilter === 'expired') return isExp;
    if (currentUserStatusFilter === 'lifetime') return isLife;
    return true;
  });

  if (!filtered.length) {
    const emptyHtml = '<tr><td colspan="6" style="text-align:center;padding:36px;color:var(--muted);">' +
      (userManagementList.length ? 'Không có người dùng nào khớp với bộ lọc.' : 'Chưa có người dùng nào. Nhấn "＋ Thêm Người Dùng Mới" để tạo ngay!') +
      '</td></tr>';
    targets.forEach(tb => { tb.innerHTML = emptyHtml; });
    return;
  }

  const rowsHtml = filtered.map(u => {
    const isDis = u.status === 'disabled';
    const isLife = u.isPermanent === true;
    const isExp = !isLife && (u.status === 'expired' || (u.expiresAt && Date.parse(u.expiresAt) <= now));
    const uidAttr = escapeHtml(String(u.id));
    const unameAttr = escapeHtml(String(u.username || ''));

    // Cột 1: Người dùng
    const isAdmin = u.role === 'admin';
    const discordId = String(u.discordUserId || u.discord_user_id || '').trim();
    const discordBadge = discordId
      ? '<div style="font-size:10.5px;color:var(--muted);margin-top:2.5px;display:flex;align-items:center;gap:4px;">' +
          '<span>💬 Discord:</span> ' +
          '<span style="font-family:var(--font-mono);color:#818cf8;background:rgba(99,102,241,0.18);padding:1px 6px;border-radius:4px;border:1px solid rgba(99,102,241,0.3);font-weight:600;" title="Discord Snowflake ID: ' + escapeHtml(discordId) + '">' + escapeHtml(discordId) + '</span>' +
        '</div>'
      : '<div style="font-size:10px;color:#64748b;margin-top:2px;">💬 Discord: <span style="font-style:italic;">Chưa liên kết</span></div>';

    const activeLoginIp = String(u.lastLoginIp || u.last_login_ip || u.registrationIp || u.registration_ip || '').trim();
    const regIp = String(u.registrationIp || u.registration_ip || '').trim();
    const ipDisplay = activeLoginIp
      ? '<div style="font-size:10.5px;color:var(--muted);margin-top:2.5px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' +
          '<span>🌐 IP Đăng nhập:</span> ' +
          '<span style="font-family:var(--font-mono);color:#38bdf8;font-weight:700;">' + escapeHtml(activeLoginIp) + '</span>' +
          (regIp && regIp !== activeLoginIp ? '<span style="font-size:9.5px;color:#64748b;" title="IP đăng ký ban đầu">(ĐK: ' + escapeHtml(regIp) + ')</span>' : '') +
        '</div>'
      : '<div style="font-size:10px;color:#64748b;margin-top:2px;">🌐 IP: <span style="font-style:italic;">Chưa đăng nhập</span></div>';

    const userCol = '<div>' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        '<strong style="font-size:13.5px;color:#fff;">' + (isAdmin ? '👑' : '👤') + ' ' + escapeHtml(u.username) + '</strong>' +
        (isAdmin ? ' <span class="vip-pill-mini">ADMIN</span>' : '') +
      '</div>' +
      (u.note ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">📝 ' + escapeHtml(u.note) + '</div>' : '') +
      (u.planName ? '<div style="font-size:11px;color:#38bdf8;margin-top:1px;font-weight:700;">' + escapeHtml(u.planName) + '</div>' : '') +
      discordBadge +
      ipDisplay +
      (u.deviceFingerprint || u.device_fingerprint
        ? '<div style="font-size:10px;color:var(--muted);margin-top:1px;">📱 FP: <span style="font-family:var(--font-mono);color:#a78bfa;">' + escapeHtml(u.deviceFingerprint || u.device_fingerprint) + '</span></div>'
        : '') +
    '</div>';

    // Cột 2: Mật khẩu (Peek Toggle)
    const isPeek = !!userPassPeekMap[String(u.id)];
    const passDisplay = isPeek ? (u.password || '—') : '••••••••';
    const eyeIcon = isPeek ? '🙈' : '👁';
    const canCopyPass = isPeek && u.password && u.password !== '—' && u.password !== '(trống)';
    const passCol = '<div class="password-cell-wrap">' +
      (canCopyPass
        ? '<button type="button" class="password-text revealed" data-user-action="copy-pass" data-user-id="' + uidAttr + '" style="background:transparent;border:none;padding:0;font:inherit;color:inherit;cursor:pointer;" title="Click để copy mật khẩu">' + escapeHtml(passDisplay) + '</button>'
        : '<span class="password-text ' + (isPeek ? 'revealed' : 'masked') + '">' + escapeHtml(passDisplay) + '</span>') +
      '<button type="button" class="btn-peek" data-user-action="peek" data-user-id="' + uidAttr + '" title="' + (isPeek ? 'Ẩn mật khẩu' : 'Hiện mật khẩu') + '" aria-label="' + (isPeek ? 'Ẩn mật khẩu ' : 'Hiện mật khẩu ') + unameAttr + '" aria-pressed="' + (isPeek ? 'true' : 'false') + '">' + eyeIcon + '</button>' +
    '</div>';

    // Cột 3: Hạn dùng & Gia hạn nhanh
    let expBadge = '';
    if (isLife) {
      expBadge = '<span class="badge-lifetime">👑 Vĩnh Viễn</span>';
    } else if (!u.expiresAt) {
      expBadge = '<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#94a3b8;background:rgba(148,163,184,0.14);border:1px solid rgba(148,163,184,0.3);">⚪ Chưa kích hoạt</span>';
    } else if (isExp) {
      const expExact = typeof formatFullDateTime === 'function' ? formatFullDateTime(u.expiresAt) : new Date(u.expiresAt).toLocaleString('vi-VN');
      expBadge = '<span class="badge-expired" title="Hết hạn: ' + escapeHtml(expExact) + '">⛔ Hết hạn (' + escapeHtml(expExact) + ')</span>';
    } else {
      const diffMs = Date.parse(u.expiresAt) - now;
      const totalHours = Math.floor(diffMs / 3600000);
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;
      const expExact = typeof formatFullDateTime === 'function' ? formatFullDateTime(u.expiresAt) : new Date(u.expiresAt).toLocaleString('vi-VN');
      const timeRemaining = days > 0 ? (days + ' ngày ' + hours + ' giờ') : (totalHours + ' giờ');
      expBadge = '<span class="badge-active" title="Hạn dùng: ' + escapeHtml(expExact) + '">⏳ Còn ' + timeRemaining + ' (' + escapeHtml(expExact) + ')</span>';
    }

    const quickBtns = isAdmin ? '' : '<div class="quick-renew-row">' +
      '<button type="button" class="quick-renew-btn" data-user-action="quick-renew" data-user-id="' + uidAttr + '" data-days="1" title="Cộng 1 ngày">+1N</button>' +
      '<button type="button" class="quick-renew-btn" data-user-action="quick-renew" data-user-id="' + uidAttr + '" data-days="3" title="Cộng 3 ngày">+3N</button>' +
      '<button type="button" class="quick-renew-btn" data-user-action="quick-renew" data-user-id="' + uidAttr + '" data-days="7" title="Cộng 7 ngày">+7N</button>' +
      '<button type="button" class="quick-renew-btn" data-user-action="quick-renew" data-user-id="' + uidAttr + '" data-days="15" title="Cộng 15 ngày">+15N</button>' +
      '<button type="button" class="quick-renew-btn" data-user-action="quick-renew" data-user-id="' + uidAttr + '" data-days="30" title="Cộng 30 ngày">+30N</button>' +
      '<button type="button" class="quick-renew-btn minus" data-user-action="quick-renew" data-user-id="' + uidAttr + '" data-days="-1" title="Trừ 1 ngày">-1N</button>' +
      '<button type="button" class="quick-renew-btn vip" data-user-action="set-lifetime" data-user-id="' + uidAttr + '" title="Đặt VIP Vĩnh viễn">👑 Vĩnh viễn</button>' +
      '<button type="button" class="quick-renew-btn custom" data-user-action="custom-renew" data-user-id="' + uidAttr + '" data-username="' + unameAttr + '" title="Tùy chỉnh ngày" aria-label="Tùy chỉnh hạn dùng cho ' + unameAttr + '">⏱</button>' +
    '</div>';

    const expiryCol = '<div>' + expBadge + quickBtns + '</div>';

    // Cột 4: Trạng thái & Nút Khóa / Mở
    let statusCol = '';
    if (isDis) {
      statusCol = '<div>' +
        '<span style="color:#ef4444;font-weight:750;">🔒 Tạm khóa</span>' +
        (u.lockReason ? '<div style="font-size:10.5px;color:#fca5a5;margin-top:2px;max-width:140px;line-height:1.3;">💬 ' + escapeHtml(u.lockReason) + '</div>' : '') +
        '<div style="margin-top:4px;"><button type="button" class="small" style="background:#059669;border-color:#10b981;color:#fff;padding:2px 8px;font-size:11px;" data-user-action="unlock" data-user-id="' + uidAttr + '">🔓 Mở Khóa</button></div>' +
      '</div>';
    } else if (isExp) {
      statusCol = '<div>' +
        '<span style="color:#ef4444;font-weight:750;">⏳ Hết hạn</span>' +
        (!isAdmin ? '<div style="margin-top:4px;"><button type="button" class="small danger" style="padding:2px 8px;font-size:11px;" data-user-action="lock" data-user-id="' + uidAttr + '" data-username="' + unameAttr + '">🔒 Khóa</button></div>' : '') +
      '</div>';
    } else {
      statusCol = '<div>' +
        '<span style="color:#10b981;font-weight:750;">🟢 Hoạt động</span>' +
        (!isAdmin ? '<div style="margin-top:4px;"><button type="button" class="small danger" style="padding:2px 8px;font-size:11px;" data-user-action="lock" data-user-id="' + uidAttr + '" data-username="' + unameAttr + '">🔒 Tạm Khóa</button></div>' : '') +
      '</div>';
    }

    // Cột 5: Bot được cấp (1-Bot-1-User Exclusive)
    const assignedIds = Array.isArray(u.assignedBotIds) ? u.assignedBotIds : [];
    const botBadges = assignedIds.length
      ? assignedIds.map(id => {
          const workerId = String(id);
          const b = userManagementAvailableBots.find(x => String(x.workerId||x.id) === workerId);
          const name = b ? b.label : ('Bot #' + workerId);
          const mcUser = b ? (b.botMinecraftUser || b.username || '') : '';
          const mcUserBadge = mcUser
            ? '<span style="font-family:var(--font-mono);font-size:10px;color:#cbd5e1;background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;margin-left:4px;border:1px solid rgba(255,255,255,0.12);" title="Tên tài khoản Minecraft của Bot">IGN: ' + escapeHtml(mcUser) + '</span>'
            : '';
          return '<span class="badge-tag" style="background:rgba(56,189,248,0.15);color:#38bdf8;padding:2px 6px;border-radius:4px;margin:2px;display:inline-flex;align-items:center;font-size:11px;font-weight:700;">🤖 ' + escapeHtml(name) + mcUserBadge + '</span>';
        }).join('')
      : '<span style="color:var(--muted);font-style:italic;font-size:11.5px;">Chưa gán bot nào</span>';

    // Cột 6: Thao tác
    const actionsCol = '<div style="text-align:right;white-space:nowrap;">' +
      '<button type="button" class="small" data-user-action="edit" data-user-id="' + uidAttr + '">✏️ Sửa</button> ' +
      (isAdmin ? '' : '<button type="button" class="small danger" data-user-action="delete" data-user-id="' + uidAttr + '" data-username="' + unameAttr + '">🗑 Xóa</button>') +
    '</div>';

    return '<tr>' +
      '<td>' + userCol + '</td>' +
      '<td>' + passCol + '</td>' +
      '<td>' + expiryCol + '</td>' +
      '<td>' + statusCol + '</td>' +
      '<td>' + botBadges + '</td>' +
      '<td>' + actionsCol + '</td>' +
    '</tr>';
  }).join('');

  targets.forEach(tb => { tb.innerHTML = rowsHtml; });
}

// Tạm khóa User kèm lời nhắn gửi đến màn hình của User
function promptLockUser(userId, username) {
  document.getElementById('lockTargetUserId').value = userId;
  document.getElementById('lockTargetUsername').textContent = username;
  document.getElementById('lockReasonInput').value = '';
  document.getElementById('userLockReasonModal')?.classList.remove('hidden');
}
window.promptLockUser = promptLockUser;

function closeUserLockReasonModal() {
  document.getElementById('userLockReasonModal')?.classList.add('hidden');
}
window.closeUserLockReasonModal = closeUserLockReasonModal;

async function submitLockUserWithReason() {
  const userId = document.getElementById('lockTargetUserId')?.value;
  const reason = document.getElementById('lockReasonInput')?.value.trim();
  if (!userId) return;

  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled', lockReason: reason })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tạm khóa người dùng.');
    showToast('🔒 Đã tạm khóa người dùng thành công.');
    closeUserLockReasonModal();
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.submitLockUserWithReason = submitLockUserWithReason;

// Mở khóa người dùng
async function unlockUser(userId) {
  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active', lockReason: '' })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể mở khóa.');
    showToast('🔓 Đã mở khóa tài khoản thành công!');
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi mở khóa: ' + err.message);
  }
}
window.unlockUser = unlockUser;

// Gia hạn nhanh (+N / -N ngày)
async function quickRenewUser(userId, days) {
  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId) + '/renew-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: Number(days) })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Gia hạn thất bại.');
    showToast(res.data?.message || 'Đã cập nhật hạn thuê bot!');
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.quickRenewUser = quickRenewUser;

// Đặt VIP vĩnh viễn
async function quickSetLifetimeUser(userId) {
  if (!confirm('Đặt tài khoản này thành VIP Vĩnh Viễn?')) return;
  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId) + '/renew-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPermanent: true, setPermanent: true })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Đặt vĩnh viễn thất bại.');
    showToast(res.data?.message || 'Đã nâng cấp VIP Vĩnh Viễn!');
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.quickSetLifetimeUser = quickSetLifetimeUser;

// Modal Tùy chỉnh hạn dùng
function openCustomRenewModal(userId, username) {
  document.getElementById('customRenewTargetUserId').value = userId;
  document.getElementById('customRenewTargetUser').textContent = username;
  document.getElementById('customRenewMode').value = 'add_days';
  handleCustomRenewModeChange();
  const u = userManagementList.find(x => x.id === userId || x.username === username);
  const planInput = document.getElementById('customRenewPlanNameInput');
  if (planInput) {
    planInput.value = u?.planName || '';
  }
  const dateInput = document.getElementById('customRenewDateInput');
  if (dateInput) {
    if (u && u.expiresAt) {
      const d = new Date(u.expiresAt);
      if (!isNaN(d.getTime())) {
        const pad = function(n) { return String(n).padStart(2, '0'); };
        dateInput.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      } else {
        dateInput.value = '';
      }
    } else {
      dateInput.value = '';
    }
  }
  document.getElementById('customRenewModal')?.classList.remove('hidden');
}
window.openCustomRenewModal = openCustomRenewModal;

function closeCustomRenewModal() {
  document.getElementById('customRenewModal')?.classList.add('hidden');
}
window.closeCustomRenewModal = closeCustomRenewModal;

function handleCustomRenewModeChange() {
  const mode = document.getElementById('customRenewMode')?.value;
  const daysGroup = document.getElementById('customRenewDaysGroup');
  const dateGroup = document.getElementById('customRenewDateGroup');

  if (mode === 'set_date') {
    if (daysGroup) daysGroup.style.display = 'none';
    if (dateGroup) dateGroup.style.display = 'block';
  } else if (mode === 'set_permanent') {
    if (daysGroup) daysGroup.style.display = 'none';
    if (dateGroup) dateGroup.style.display = 'none';
  } else {
    if (daysGroup) daysGroup.style.display = 'block';
    if (dateGroup) dateGroup.style.display = 'none';
  }
}
window.handleCustomRenewModeChange = handleCustomRenewModeChange;

async function submitCustomRenew() {
  const userId = document.getElementById('customRenewTargetUserId')?.value;
  const mode = document.getElementById('customRenewMode')?.value;
  const daysVal = parseInt(document.getElementById('customRenewDaysInput')?.value, 10);
  const dateVal = document.getElementById('customRenewDateInput')?.value;
  const planName = document.getElementById('customRenewPlanNameInput')?.value?.trim();

  if (!userId) return;

  const payload = {};
  if (planName) {
    payload.planName = planName;
  }
  if (mode === 'set_permanent') {
    payload.isPermanent = true;
    payload.setPermanent = true;
  } else if (mode === 'set_date') {
    if (!dateVal) { showToast('Vui lòng chọn ngày giờ hết hạn!'); return; }
    const parsedDate = new Date(dateVal);
    if (isNaN(parsedDate.getTime())) { showToast('Ngày giờ không hợp lệ!'); return; }
    payload.fixedDate = parsedDate.toISOString();
  } else if (mode === 'add_days') {
    if (isNaN(daysVal) || daysVal <= 0) { showToast('Số ngày không hợp lệ!'); return; }
    payload.days = daysVal;
  } else if (mode === 'subtract_days') {
    if (isNaN(daysVal) || daysVal <= 0) { showToast('Số ngày không hợp lệ!'); return; }
    payload.days = -daysVal;
  }

  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId) + '/renew-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(res.data?.error || 'Cập nhật hạn thất bại.');
    showToast(res.data?.message || 'Đã cập nhật hạn thuê bot!');
    closeCustomRenewModal();
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.submitCustomRenew = submitCustomRenew;

// Quản lý Modal Tạo/Sửa User & Checkbox Bot Độc Quyền (1-Bot-1-User)
function toggleUserFormExpiresAt(isPermanent) {
  const expInp = document.getElementById('userFormExpiresAt');
  if (expInp) {
    expInp.disabled = isPermanent;
    if (isPermanent) expInp.value = '';
  }
}
window.toggleUserFormExpiresAt = toggleUserFormExpiresAt;

function openCreateUserModal() {
  currentEditingUserId = null;
  document.getElementById('userEditModalTitle').textContent = 'Thêm Người Dùng Mới';
  document.getElementById('userFormId').value = '';
  document.getElementById('userFormUsername').value = '';
  document.getElementById('userFormPassword').value = '';
  document.getElementById('userFormPassword').placeholder = 'Tối thiểu 6 ký tự (chữ hoặc số, phân biệt hoa thường)...';
  document.getElementById('userFormStatus').value = 'active';
  if (document.getElementById('userFormPlanName')) document.getElementById('userFormPlanName').value = 'Gói thường';
  if (document.getElementById('userFormIsPermanent')) document.getElementById('userFormIsPermanent').checked = false;
  if (document.getElementById('userFormExpiresAt')) {
    document.getElementById('userFormExpiresAt').disabled = false;
    document.getElementById('userFormExpiresAt').value = '';
  }
  if (document.getElementById('userFormNote')) document.getElementById('userFormNote').value = '';
  if (document.getElementById('userFormAllowAccountChange')) document.getElementById('userFormAllowAccountChange').checked = true;
  if (document.getElementById('userFormDiscordRow')) document.getElementById('userFormDiscordRow').style.display = 'none';
  renderUserFormBotsCheckboxes([], null);
  document.getElementById('userEditModal')?.classList.remove('hidden');
}
window.openCreateUserModal = openCreateUserModal;

function openEditUserModal(userId) {
  const u = userManagementList.find(x => x.id === userId);
  if (!u) return;
  currentEditingUserId = u.id;
  document.getElementById('userEditModalTitle').textContent = 'Sửa Người Dùng: ' + u.username;
  document.getElementById('userFormId').value = u.id;
  document.getElementById('userFormUsername').value = u.username;
  document.getElementById('userFormPassword').value = '';
  document.getElementById('userFormPassword').placeholder = 'Để trống nếu không đổi mật khẩu';
  document.getElementById('userFormStatus').value = u.status || 'active';
  if (document.getElementById('userFormPlanName')) document.getElementById('userFormPlanName').value = u.planName || 'Gói thường';
  const isPerm = u.isPermanent === true;
  if (document.getElementById('userFormIsPermanent')) {
    document.getElementById('userFormIsPermanent').checked = isPerm;
  }
  if (document.getElementById('userFormExpiresAt')) {
    document.getElementById('userFormExpiresAt').disabled = isPerm;
    if (!isPerm && u.expiresAt) {
      const d = new Date(u.expiresAt);
      if (!isNaN(d.getTime())) {
        const pad = n => String(n).padStart(2, '0');
        document.getElementById('userFormExpiresAt').value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      } else {
        document.getElementById('userFormExpiresAt').value = '';
      }
    } else {
      document.getElementById('userFormExpiresAt').value = '';
    }
  }
  if (document.getElementById('userFormNote')) document.getElementById('userFormNote').value = u.note || '';
  if (document.getElementById('userFormAllowAccountChange')) {
    document.getElementById('userFormAllowAccountChange').checked = u.allowAccountChange !== false;
  }
  if (document.getElementById('userFormDiscordRow')) {
    const dRow = document.getElementById('userFormDiscordRow');
    const dVal = document.getElementById('userFormDiscordValue');
    const dId = String(u.discordUserId || u.discord_user_id || '').trim();
    if (dRow && dVal) {
      dRow.style.display = 'block';
      if (dId) {
        dVal.innerHTML = '<span>💬 Discord ID:</span> <strong style="color:#818cf8;font-family:var(--font-mono);background:rgba(99,102,241,0.2);padding:2px 8px;border-radius:4px;border:1px solid rgba(99,102,241,0.35);">' + escapeHtml(dId) + '</strong> <span style="color:#22c55e;font-size:11px;font-weight:600;">(Đã liên kết)</span>';
      } else {
        dVal.innerHTML = '<span style="color:#94a3b8;font-style:italic;">Chưa liên kết tài khoản Discord</span>';
      }
    }
  }
  renderUserFormBotsCheckboxes(u.assignedBotIds || [], u.id);
  document.getElementById('userEditModal')?.classList.remove('hidden');
}
window.openEditUserModal = openEditUserModal;

function closeUserEditModal() {
  currentEditingUserId = null;
  document.getElementById('userEditModal')?.classList.add('hidden');
}
window.closeUserEditModal = closeUserEditModal;

// Render checkbox phân quyền bot theo nguyên tắc 1-Bot-1-User độc quyền
function renderUserFormBotsCheckboxes(selectedIds, targetUserId) {
  const grid = document.getElementById('userFormBotsGrid');
  if (!grid) return;
  if (!userManagementAvailableBots.length) {
    grid.innerHTML = '<div style="color:var(--muted);padding:10px;grid-column:1/-1;">Chưa có bot nào trong Manager. Hãy thêm bot trước.</div>';
    return;
  }
  const set = new Set((selectedIds || []).map(id => String(id)));

  grid.innerHTML = userManagementAvailableBots.map(b => {
    const botId = String(b.workerId||b.id);
    const isChecked = set.has(botId);
    const owner = userManagementBotOwnership[botId] || b.currentOwner;
    const isOccupiedByOther = owner && owner.userId && (!targetUserId || String(owner.userId) !== String(targetUserId));

    const displayName = b.label || ('Bot #' + (b.botNumber || botId));
    const nonRentableBadge = b.rentable === false ? '<span style="font-size:10px;color:#f87171;margin-left:4px;font-weight:600;">[Không cho thuê]</span>' : '';
    if (isOccupiedByOther) {
      return '<label class="bot-check-item bot-occupied" style="position:relative;">' +
        '<input type="checkbox" class="user-bot-chk" value="' + escapeHtml(botId) + '" ' + (isChecked ? 'checked' : '') + ' data-occupied="1" data-bot-id="' + escapeHtml(botId) + '" data-bot-label="' + escapeHtml(displayName) + '" data-owner="' + escapeHtml(owner.username) + '" onclick="handleOccupiedBotClick(event)">' +
        '<div>' +
          '<span><strong style="color:#38bdf8;font-size:13px;">[' + escapeHtml(displayName) + ']</strong>' + nonRentableBadge + '</span>' +
          '<span class="badge-occupied">👤 Đang cấp cho: ' + escapeHtml(owner.username) + '</span>' +
        '</div>' +
      '</label>';
    }

    return '<label class="bot-check-item">' +
      '<input type="checkbox" class="user-bot-chk" value="' + escapeHtml(botId) + '" ' + (isChecked ? 'checked' : '') + '>' +
      '<span><strong style="color:#38bdf8;font-size:13px;">[' + escapeHtml(displayName) + ']</strong>' + nonRentableBadge + '</span>' +
    '</label>';
  }).join('');
}
window.renderUserFormBotsCheckboxes = renderUserFormBotsCheckboxes;

// Bắt sự kiện click bot đã có người dùng khác sở hữu
function handleOccupiedBotClick(event, directBotId, directBotLabel, directOldOwner) {
  const chk = event.target;
  const botId = directBotId !== undefined ? String(directBotId) : String(chk.dataset.botId || chk.value);
  const botLabel = directBotLabel !== undefined ? directBotLabel : (chk.dataset.botLabel || ('Bot #' + botId));
  const oldOwnerName = directOldOwner !== undefined ? directOldOwner : (chk.dataset.owner || '');
  if (chk.checked) {
    // Tạm bỏ check trước khi xác nhận
    chk.checked = false;
    event.preventDefault();

    const msgEl = document.getElementById('reassignBotConfirmMsg');
    if (msgEl) {
      msgEl.innerHTML = '⚠️ Bot <strong>#' + escapeHtml(botId) + ' (' + escapeHtml(botLabel) + ')</strong> hiện đang thuộc về người dùng <strong>' + escapeHtml(oldOwnerName) + '</strong>.<br/><br/>Bạn có chắc chắn muốn hủy bot khỏi <strong>' + escapeHtml(oldOwnerName) + '</strong> để cấp quyền cho người dùng này không?';
    }
    pendingBotReassignCallback = () => {
      chk.checked = true;
      chk.closest('.bot-check-item')?.classList.remove('bot-occupied');
    };
    document.getElementById('reassignBotConfirmModal')?.classList.remove('hidden');
  }
}
window.handleOccupiedBotClick = handleOccupiedBotClick;

function closeReassignBotConfirmModal(confirmed) {
  if (confirmed && typeof pendingBotReassignCallback === 'function') {
    pendingBotReassignCallback();
  }
  pendingBotReassignCallback = null;
  document.getElementById('reassignBotConfirmModal')?.classList.add('hidden');
}
window.closeReassignBotConfirmModal = closeReassignBotConfirmModal;

function toggleSelectAllUserBots(select) {
  document.querySelectorAll('.user-bot-chk').forEach(el => {
    if (select) {
      // Nếu là bot đang bận, bỏ qua không auto chọn hết để tránh cướp bot vô tình
      if (!el.closest('.bot-occupied')) el.checked = true;
    } else {
      el.checked = false;
    }
  });
}
window.toggleSelectAllUserBots = toggleSelectAllUserBots;

function generateRandomUserPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let pass = '';
  for (let i = 0; i < 10; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
  document.getElementById('userFormPassword').value = pass;
}
window.generateRandomUserPassword = generateRandomUserPassword;

async function saveUserForm() {
  const id = document.getElementById('userFormId').value.trim();
  const username = document.getElementById('userFormUsername').value.trim();
  const password = document.getElementById('userFormPassword').value.trim();
  const status = document.getElementById('userFormStatus').value;
  const chks = document.querySelectorAll('.user-bot-chk:checked');
  const assignedBotIds = Array.from(chks).map(el => String(el.value));

  if (!username) { showToast('Vui lòng nhập tên đăng nhập.'); return; }
  const isUpdate = !!id;
  if (!isUpdate && !password) { showToast('Vui lòng nhập mật khẩu.'); return; }

  const btn = document.getElementById('userFormSubmitBtn');
  if (btn) btn.disabled = true;

  try {
    const url = isUpdate ? ('/api/manager/users/' + encodeURIComponent(id)) : '/api/manager/users';
    const method = isUpdate ? 'PUT' : 'POST';
    const planName = document.getElementById('userFormPlanName')?.value.trim() || 'Gói thường';
    const isPermanent = !!document.getElementById('userFormIsPermanent')?.checked;
    const expiresAt = isPermanent ? null : (document.getElementById('userFormExpiresAt')?.value ? new Date(document.getElementById('userFormExpiresAt').value).toISOString() : null);
    const note = document.getElementById('userFormNote')?.value.trim() || '';
    const allowAccountChange = !!document.getElementById('userFormAllowAccountChange')?.checked;

    const payload = { username, status, planName, expiresAt, isPermanent, note, allowAccountChange, assignedBotIds };
    if (password) payload.password = password;

    const res = await requestJson(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi khi lưu user.');
    showToast((res.data?.partial ? '⚠️ ' : '') + (res.data?.warning || res.data?.message || 'Đã lưu người dùng thành công.'));
    closeUserEditModal();
    lastHomeSig = '';
    await Promise.allSettled([refreshUserManagementPage(), refreshHome()]);
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.saveUserForm = saveUserForm;

async function deleteUserPrompt(userId, username) {
  if (!confirm('Bạn có chắc chắn muốn xóa người dùng "' + username + '"? Người dùng này sẽ mất quyền truy cập ngay lập tức.')) return;
  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId), { method: 'DELETE' });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể xóa user.');
    showToast(res.data?.message || 'Đã xóa người dùng.');
    lastHomeSig = '';
    await Promise.allSettled([refreshUserManagementPage(), refreshHome()]);
  } catch (err) {
    showToast('Lỗi xóa user: ' + err.message);
  }
}
window.deleteUserPrompt = deleteUserPrompt;

function onKeyDaysSelectChange(source) {
  if (source === 'mgmt') {
    const sel = document.getElementById('mgmtKeyDays');
    const customInp = document.getElementById('mgmtKeyCustomDays');
    if (sel && customInp) {
      customInp.style.display = sel.value === 'custom' ? 'inline-block' : 'none';
      if (sel.value === 'custom') customInp.focus();
    }
  } else if (source === 'modal') {
    const sel = document.getElementById('createKeyDays');
    const customInp = document.getElementById('createKeyCustomDays');
    if (sel && customInp) {
      customInp.style.display = sel.value === 'custom' ? 'inline-block' : 'none';
      if (sel.value === 'custom') customInp.focus();
    }
  }
}
window.onKeyDaysSelectChange = onKeyDaysSelectChange;

// Phát hành mã Key từ Sub-panel Quản lý Key
async function submitCreateKeysFromMgmt() {
  if (keyMutationState.creating) return;
  const daysVal = document.getElementById('mgmtKeyDays')?.value;
  const customInp = document.getElementById('mgmtKeyCustomDays');
  const planName = document.getElementById('mgmtKeyPlan')?.value.trim();
  const count = parseInt(document.getElementById('mgmtKeyCount')?.value, 10) || 1;
  const botCount = parseInt(document.getElementById('mgmtKeyBotCount')?.value, 10) || 1;

  const isPermanent = daysVal === 'lifetime';
  let days = 7;
  if (isPermanent) {
    days = -1;
  } else if (daysVal === 'custom') {
    const customVal = parseInt(customInp?.value, 10);
    if (!Number.isFinite(customVal) || customVal < 1) {
      showToast('Vui lòng nhập số ngày hợp lệ (tối thiểu 1 ngày).', 'error');
      if (customInp) customInp.focus();
      return;
    }
    days = Math.min(customVal, 3650);
  } else {
    days = parseInt(daysVal, 10) || 7;
  }

  const customKey = document.getElementById('mgmtKeyCustomKey')?.value.trim();
  const maxUsesVal = document.getElementById('mgmtKeyMaxUses')?.value;
  const validDaysVal = document.getElementById('mgmtKeyValidDays')?.value;
  const maxUses = maxUsesVal !== '' ? parseInt(maxUsesVal, 10) : 1;
  const validDays = parseInt(validDaysVal, 10) || 0;

  keyMutationState.creating = true;
  try {
    const res = await requestJson('/api/manager/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        days,
        permanent: isPermanent,
        isPermanent,
        setPermanent: isPermanent,
        planName: planName || (isPermanent ? 'VIP Vĩnh Viễn' : ('Gói ' + days + ' Ngày')),
        count,
        botCount,
        customKey: customKey || undefined,
        maxUses: isNaN(maxUses) ? 1 : maxUses,
        validDays: validDays > 0 ? validDays : undefined
      })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tạo mã Key.');
    showToast('🎉 ' + (res.data?.message || 'Đã tạo ' + count + ' mã Key thành công!'));
    if (document.getElementById('mgmtKeyCustomKey')) document.getElementById('mgmtKeyCustomKey').value = '';
    await refreshKeysTable();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  } finally {
    keyMutationState.creating = false;
  }
}
window.submitCreateKeysFromMgmt = submitCreateKeysFromMgmt;

