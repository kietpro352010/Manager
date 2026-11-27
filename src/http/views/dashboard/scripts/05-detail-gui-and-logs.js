function recordAndRenderSessionTrail(bot) {
  if (!bot) return '';
  const botId = String(bot.workerId || bot.id || selectedBotId || '');
  if (!botId) return '';
  const map = (typeof _detailSessionTrailMap !== 'undefined' && _detailSessionTrailMap) ? _detailSessionTrailMap : null;
  if (!map) return '';
  const pos = bot.position || bot.roundedLocation;
  const hasPos = pos && [pos.x, pos.y, pos.z].every(v => v !== null && v !== '' && Number.isFinite(Number(v)));
  const posText = hasPos ? (Math.round(Number(pos.x)) + ', ' + Math.round(Number(pos.y)) + ', ' + Math.round(Number(pos.z))) : '--';
  const locText = (typeof humanizeBotLocationVi === 'function' ? humanizeBotLocationVi(bot.locationState || bot.locationKind, bot.dimension) : '') || 'Chưa vào thế giới';
  const stRaw = String(bot.status || 'offline').toLowerCase();
  const stLabelMap = {
    afk: 'Đang treo AFK', online: 'Đang trong game', entering: 'Đang vào cụm', authenticating: 'Đang đăng nhập',
    connecting: 'Đang kết nối', waking: 'Đang đánh thức', stopped: 'Đã dừng', offline: 'Ngoại tuyến',
    error: 'Mất kết nối', kicked: 'Vừa bị kick', maintenance: 'Bảo trì'
  };
  const stText = stLabelMap[stRaw] || stRaw;
  const sig = stText + '|' + locText + '|' + posText;
  const list = map.get(botId) || [];
  if (!list.length || list[0].sig !== sig) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    list.unshift({ time: hh + ':' + mm + ':' + ss, status: stText, loc: locText, pos: posText, sig });
    if (list.length > 10) list.length = 10;
    map.set(botId, list);
  }
  return list;
}

function renderDetailLifecycleAndTrail() {
  if (!detailBot) return;
  const stageInfo = typeof describeBotOperationalStage === 'function'
    ? describeBotOperationalStage(detailBot)
    : null;
  const stepperEl = document.getElementById('detailLifecycleStepper');
  if (stepperEl && stageInfo && Array.isArray(stageInfo.steps)) {
    stepperEl.innerHTML = stageInfo.steps.map(step => (
      '<div class="lifecycle-step is-' + escapeHtml(step.state) + '">' +
        '<div class="lifecycle-step-head">' +
          '<span class="lifecycle-step-index">' + (step.state === 'done' ? '✓' : step.state === 'error' ? '!' : step.stepNum) + '</span>' +
          '<span class="lifecycle-step-label">' + escapeHtml(step.label) + '</span>' +
        '</div>' +
        '<div class="lifecycle-step-sub" title="' + escapeHtml(step.sub) + '">' + escapeHtml(step.sub) + '</div>' +
      '</div>'
    )).join('');
  }
  const explainEl = document.getElementById('detailStatusExplain');
  if (explainEl && stageInfo) {
    const canChangeAccount = currentUser?.role === 'admin' || currentUser?.allowAccountChange !== false;
    const toneClass = stageInfo.tone === 'ok' ? 'is-ok' : (stageInfo.tone === 'error' ? 'is-error' : (stageInfo.tone === 'warn' ? 'is-warn' : ''));
    explainEl.className = 'detail-status-explain ' + toneClass;
    explainEl.innerHTML =
      '<div style="min-width:0;flex:1 1 220px;">' +
        '<div class="detail-status-explain-title">' + escapeHtml(stageInfo.headlineVi) + '</div>' +
        (stageInfo.hintVi ? ('<div class="detail-status-explain-hint">' + escapeHtml(stageInfo.hintVi) + '</div>') : '') +
      '</div>' +
      (stageInfo.needsAccountSetup && canChangeAccount
        ? '<button type="button" class="small primary" onclick="document.getElementById(\'detailUsernameInput\')?.scrollIntoView?.({behavior:\'smooth\',block:\'center\'});document.getElementById(\'detailUsernameInput\')?.focus?.();">Cài tài khoản ngay</button>'
        : '');
  }
  const histEl = document.getElementById('detailPositionHistory');
  if (histEl) {
    const prots = typeof summarizeBotProtections === 'function' ? summarizeBotProtections(detailBot) : [];
    const protHtml = prots.length
      ? ('<div class="session-prot-chips">' + prots.map(p => '<span class="session-prot-chip' + (p.enabled ? ' is-on' : '') + '">' + (p.enabled ? '✓ ' : '• ') + escapeHtml(p.label) + '</span>').join('') + '</div>')
      : '';
    const trail = recordAndRenderSessionTrail(detailBot) || [];
    const trailHtml = trail.length
      ? ('<div class="session-trail-list">' + trail.map(item => (
          '<div class="session-trail-row">' +
            '<span>' + escapeHtml(item.time) + ' • ' + escapeHtml(item.status) + ' (' + escapeHtml(item.loc) + ')</span>' +
            '<span>' + escapeHtml(item.pos) + '</span>' +
          '</div>'
        )).join('') + '</div>')
      : '<div style="color:var(--text-muted);font-size:11.5px;">Chưa có thay đổi vị trí mới trong phiên xem này.</div>';
    histEl.innerHTML = protHtml + trailHtml;
  }
}
window.renderDetailLifecycleAndTrail = renderDetailLifecycleAndTrail;

function detailStatusHtml() {
  if(!detailBot) return;
  if (typeof updateLiveSyncIndicators === 'function') updateLiveSyncIndicators('ok');
  const isAdmin = Boolean(currentUser && currentUser.role === 'admin');
  const numId = detailBot.botNumber || selectedBotId || detailBot.id;
  const workerIdArg = JSON.stringify(String(detailBot.workerId || detailBot.id || selectedBotId || ''));
  const [color,label,errorType]=statusMeta(detailBot.status,detailBot.available,!!detailBot.manuallyStopped,detailBot);
  let statusDetailHtml = '<span class="dot '+color+'"></span>'+escapeHtml(label);
  if (!detailBot.available) {
    if (errorType === 'secret_mismatch') {
      statusDetailHtml += '<div style="font-size:12px;color:#fb923c;margin-top:8px;font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
        '<span>⚠️ Worker từ chối lệnh do lệch Secret Key (409).</span>' +
        (isAdmin ? '<button type="button" class="small warning-btn" onclick="openEditSecretModal(' + escapeHtml(workerIdArg) + ')" style="padding:2px 8px;font-size:11px;">🔑 Cập nhật Key</button>' : '') +
      '</div>';
    } else if (errorType === 'render_sleep') {
      statusDetailHtml += '<div style="font-size:12px;color:#c084fc;margin-top:8px;font-weight:600;">' +
        '💤 Máy chủ Cloud (Render) đang ngủ đông (503) hoặc timeout. Đang thử kết nối lại...' +
      '</div>';
    } else if (errorType === 'not_found') {
      statusDetailHtml += '<div style="font-size:12px;color:#f87171;margin-top:8px;font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
        '<span>❌ Địa chỉ bot trả về 404 Not Found (URL sai hoặc app bị xoá).</span>' +
        (isAdmin ? '<button type="button" class="small danger" onclick="deleteBot(event,' + escapeHtml(workerIdArg) + ')" style="padding:2px 8px;font-size:11px;">🗑 Xoá Bot</button>' +
        '<button type="button" class="small" onclick="editBot(event,' + escapeHtml(workerIdArg) + ')" style="padding:2px 8px;font-size:11px;">✏️ Sửa URL</button>' : '') +
      '</div>';
    } else if (errorType === 'unreachable') {
      const isWispbyte = String(detailBot.provider || detailBot.platform || 'wispbyte').toLowerCase() === 'wispbyte' || !detailBot.url;
      const humanizedErr = (typeof humanizeBotErrorForUser === 'function'
        ? humanizeBotErrorForUser(detailBot.lastError || detailBot.error || '')
        : '') || 'Bot hiện chưa phản hồi.';
      const reasonText = isWispbyte
        ? '⚠️ Container trên Wispbyte đang tắt (Stopped) hoặc vừa tự dừng do chạm giới hạn CPU/RAM. Hãy bật lại container trên Wispbyte.'
        : ('⚠️ ' + humanizedErr);
      statusDetailHtml += '<div style="font-size:12px;color:#fb923c;margin-top:8px;font-weight:600;">' + escapeHtml(reasonText) + '</div>';
    }
  }
  document.getElementById('detailStatus').innerHTML=statusDetailHtml;
  const rawLbl = String(detailBot.label || '').trim();
  const hasCustom = rawLbl && rawLbl !== ('Bot ' + numId) && rawLbl !== ('bot' + numId) && rawLbl !== ('Bot #' + numId);
  const detailTitle = hasCustom ? ('Bot #' + numId + ' (' + rawLbl + ')') : ('Bot #' + numId);
  document.getElementById('detailTitle').textContent = detailTitle;
  document.getElementById('detailBotId').textContent = detailBot.workerId || detailBot.id || selectedBotId || '-';
  document.getElementById('detailUsername').textContent=detailBot.username||'Chưa đặt';
  document.getElementById('detailServer').textContent = detailBot.server || detailBot.serverHost || 'kingmc.vn';
  const pingEl = document.getElementById('detailPing');
  const pingRaw = detailBot.ping;
  const pingVal = (pingRaw === null || pingRaw === undefined || String(pingRaw).trim() === '') ? NaN : Number(pingRaw);
  if (pingEl) {
    pingEl.textContent = (Number.isFinite(pingVal) && pingVal >= 0)
      ? (pingVal + ' ms')
      : ((!detailBot.available || detailBot.status === 'offline') ? '-- ms (Bot đang tắt)' : '--');
  }
  const tpsEl = document.getElementById('detailTps');
  if (tpsEl) {
    const tpsRaw = detailBot.tps ?? detailBot.serverTps;
    const tpsVal = (tpsRaw === null || tpsRaw === undefined || String(tpsRaw).trim() === '') ? NaN : Number(tpsRaw);
    const hasTps = Number.isFinite(tpsVal) && tpsVal >= 0;
    tpsEl.textContent = hasTps ? tpsVal.toFixed(1) : ((!detailBot.available || detailBot.status === 'offline') ? '-- (Bot đang tắt)' : '--');
    tpsEl.style.color = !hasTps ? 'var(--muted)' : (tpsVal >= 18.5 ? 'var(--green)' : (tpsVal >= 14.0 ? 'var(--yellow)' : 'var(--red)'));
  }
  // 1. Hiển thị tọa độ bot
  const pos = detailBot.position || detailBot.roundedLocation;
  const positionEl = document.getElementById('detailPosition');
  if (positionEl) {
    const validPosition = pos && [pos.x, pos.y, pos.z].every(v => v !== null && v !== '' && Number.isFinite(Number(v)));
    positionEl.textContent = validPosition
      ? ('X: ' + Math.round(Number(pos.x)) + ', Y: ' + Math.round(Number(pos.y)) + ', Z: ' + Math.round(Number(pos.z)))
      : '--';
  }
  // 2. Hiển thị Dimension và trạng thái vị trí
  const dimensionEl = document.getElementById('detailDimension');
  if (dimensionEl) {
    const locState = String(detailBot.locationState || detailBot.locationKind || '').trim().toLowerCase();
    const placeName = typeof humanizeBotLocationVi === 'function' ? humanizeBotLocationVi(locState, detailBot.dimension) : '';
    dimensionEl.textContent = placeName || '--';
  }
  const platformPillEl = document.getElementById('detailPlatformPill');
  if (platformPillEl) {
    const prov = String(detailBot.provider || detailBot.platform || 'wispbyte').toLowerCase();
    platformPillEl.textContent = prov === 'render' ? 'RENDER CLOUD' : 'WISPBYTE';
  }
  const lastSeenEl = document.getElementById('detailLastSeen');
  if (lastSeenEl) {
    const seenIso = detailBot.lastSeen;
    const seenMs = seenIso ? Date.parse(seenIso) : NaN;
    lastSeenEl.textContent = typeof formatRelativeAgeVi === 'function'
      ? formatRelativeAgeVi(seenIso)
      : (Number.isFinite(seenMs) ? new Date(seenMs).toLocaleTimeString('vi-VN', { hour12: false }) : 'Chưa ghi nhận');
    if (Number.isFinite(seenMs)) {
      lastSeenEl.title = 'Đồng bộ lần cuối: ' + new Date(seenMs).toLocaleString('vi-VN');
    }
  }
  const rawDetailIp = String(detailBot.ipAddress || '').trim();
  const isDetailLoopback = rawDetailIp === '127.0.0.1' || rawDetailIp === 'localhost' || rawDetailIp === '0.0.0.0' || rawDetailIp === '::1';
  const detailIpEl = document.getElementById('detailIp');
  if (detailIpEl) {
    detailIpEl.textContent = (isAdmin && !isDetailLoopback && rawDetailIp) ? rawDetailIp : (isAdmin && detailBot.host ? detailBot.host : '-');
  }

  const offlineOrStopped = typeof isDetailBotOfflineOrStopped === 'function' ? isDetailBotOfflineOrStopped(detailBot) : !detailBot.available;
  const hw = detailBot.hostHardware;
  const botRamMb = Number(hw?.botRssMb || detailBot.ramRss || detailBot.rssMb || detailBot.memory?.rssMb || 0);

  // 1. RAM Máy Host
  const hostRamEl = document.getElementById('detailHostRam');
  if (hostRamEl) {
    if (hw && hw.ramTotalMb > 0) {
      hostRamEl.textContent = formatHardwareMetric(hw.ramUsedMb) + ' / ' + formatHardwareMetric(hw.ramTotalMb) + ' MB (' + formatHardwareMetric(hw.ramPercent) + '%)';
      hostRamEl.style.color = hw.ramPercent > 85 ? 'var(--red)' : hw.ramPercent > 70 ? 'var(--yellow)' : 'var(--green)';
    } else {
      hostRamEl.textContent = '--';
    }
  }

  // 2. CPU Máy Host
  const hostCpuEl = document.getElementById('detailHostCpu');
  if (hostCpuEl) {
    if (offlineOrStopped) {
      hostCpuEl.textContent = '-- (Bot đang tắt)';
      hostCpuEl.style.color = 'var(--muted)';
    } else if (hw) {
      hostCpuEl.textContent = formatHardwareMetric(hw.cpuPercent) + '% (' + (hw.cpuCores || 1) + ' vCPU)';
      hostCpuEl.style.color = hw.cpuPercent > 85 ? 'var(--red)' : hw.cpuPercent > 60 ? 'var(--yellow)' : '#38bdf8';
    } else {
      hostCpuEl.textContent = '--';
    }
  }

  // 3. Lưu lượng mạng
  const hostNetEl = document.getElementById('detailHostNet');
  if (hostNetEl) {
    if (offlineOrStopped) {
      hostNetEl.textContent = '-- (Bot đang tắt)';
    } else if (hw) {
      hostNetEl.textContent = '↓ ' + formatHardwareMetric(hw.netDownKb) + ' KB/s • ↑ ' + formatHardwareMetric(hw.netUpKb) + ' KB/s';
    } else {
      hostNetEl.textContent = '--';
    }
  }

  // 4. RAM Bot con
  const ramEl = document.getElementById('detailRam');
  if (ramEl) {
    ramEl.textContent = botRamMb > 0 ? (formatHardwareMetric(botRamMb) + ' MB RSS') : '--';
  }

  // 5. Uptime & Reconnects
  const uptimeEl = document.getElementById('detailUptime');
  if (uptimeEl) {
    const sec = Math.max(0, Math.floor(Number(detailBot.uptimeSeconds || 0)));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    uptimeEl.textContent = sec > 0 ? (h + 'h ' + m + 'm ' + s + 's') : (offlineOrStopped ? '-- (Bot đang tắt)' : '0h 0m 0s');
  }
  const recEl = document.getElementById('detailReconnects');
  if (recEl) {
    const attempts = Number(detailBot.reconnectAttempts || 0);
    const totalCount = Number(detailBot.reconnectCount || 0);
    if (attempts > 0) {
      recEl.textContent = attempts + ' lần (đang thử lại)';
    } else if (totalCount > 0) {
      recEl.textContent = totalCount + ' lần';
    } else {
      recEl.textContent = offlineOrStopped ? '0 lần' : '0 lần (ổn định)';
    }
  }

  // 6. Phân quyền đổi tài khoản Minecraft theo allowAccountChange
  const canChangeAccount = currentUser?.role === 'admin' || currentUser?.allowAccountChange !== false;
  const accountPanel = document.getElementById('detailAccountPanel');
  if (accountPanel) {
    accountPanel.style.display = canChangeAccount ? 'block' : 'none';
  }

  // BUG-19: Ẩn #detailProxyPanel và #botProxyPanel trên giao diện theo role và quyền (allowAccountChange === false)
  const canManageProxy = currentUser?.role === 'admin' && canChangeAccount;
  const proxyPanels = document.querySelectorAll('#detailProxyPanel, #botProxyPanel');
  proxyPanels.forEach(panel => {
    panel.style.display = canManageProxy ? 'block' : 'none';
  });

  // Render Proxy riêng của Bot (masked {enabled} từ snapshot; admin nạp chi tiết sau)
  if (canManageProxy) {
    renderDetailProxy(detailBot.settings?.proxy);
    void loadFullSettingsForAdmin();
  }

  // 7. Render Remote GUI Inspector (tự ẩn menu GUI khi bot đã dừng/ngoại tuyến)
  renderDetailRemoteGui(offlineOrStopped ? null : detailBot.currentWindow);

  const lockInfo = (typeof getWorkerLockInfo === 'function')
    ? getWorkerLockInfo()
    : { locked: false, message: '' };
  const isLockedUser = Boolean(lockInfo && lockInfo.locked);
  ['detailStartButton', 'detailStopButton', 'detailRestartButton'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = isLockedUser;
      if (isLockedUser) {
        btn.style.opacity = '0.45';
        btn.style.cursor = 'not-allowed';
        btn.title = lockInfo.reason === 'maintenance'
          ? ('Hệ thống đang bảo trì: ' + lockInfo.message)
          : 'Tính năng bị vô hiệu hóa do tài khoản đã hết hạn. Hãy gia hạn key để sử dụng.';
      } else {
        btn.style.opacity = '';
        btn.style.cursor = '';
        btn.title = '';
      }
    }
  });
  if (typeof renderDetailLifecycleAndTrail === 'function') renderDetailLifecycleAndTrail();
  if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
}

async function detailGet(path) {
  if(selectedBotId===null) throw new Error('Chưa chọn bot.');
  const result=await requestJson('/api/manager/bot/'+encodeURIComponent(String(selectedBotId))+path);
  if(!result.ok){const error=new Error(result.data?.error||'Không thể lấy dữ liệu bot.');error.status=result.status;error.data=result.data||{};throw error;}
  return result.data||{};
}

// ----------------------------------------------------------------------------
// COMMERCIAL SAAS FRONTEND FUNCTIONS
// ----------------------------------------------------------------------------

function openRenewModal() {
  const inputEl = document.getElementById('renewKeyInput');
  const box = document.getElementById('renewResultBox');
  if (inputEl) inputEl.value = '';
  if (box) box.style.display = 'none';
  if (typeof syncRenewModalDiscordGate === 'function') syncRenewModalDiscordGate();
  document.getElementById('renewModal')?.classList.remove('hidden');
  if (typeof loadDiscordLinkStatus === 'function') void loadDiscordLinkStatus({ silent: true });
}

function closeRenewModal() {
  document.getElementById('renewModal')?.classList.add('hidden');
}

async function submitRenewKey() {
  const key = String(document.getElementById('renewKeyInput')?.value || '').trim().toUpperCase();
  const box = document.getElementById('renewResultBox');
  if (currentUser?.role !== 'admin' && typeof currentDiscordLinkState === 'object' && currentDiscordLinkState.loaded && !currentDiscordLinkState.linked) {
    if (box) {
      box.style.display = 'block';
      box.style.background = 'rgba(245,158,11,0.18)';
      box.style.color = 'var(--yellow)';
      box.textContent = 'Bắt buộc liên kết tài khoản Discord (/login trên Discord) trước khi nhập mã Key.';
    }
    return;
  }
  if (!key) {
    box.style.display = 'block';
    box.style.background = 'rgba(239,68,68,0.2)';
    box.style.color = 'var(--red)';
    box.textContent = 'Vui lòng nhập mã Key!';
    return;
  }
  box.style.display = 'block';
  box.style.background = 'rgba(56,189,248,0.2)';
  box.style.color = '#38bdf8';
  box.textContent = 'Đang kích hoạt Key...';
  try {
    const res = await requestJson('/api/manager/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    if (res.ok) {
      const partial = res.data?.partial === true;
      box.style.background = partial ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)';
      box.style.color = partial ? 'var(--yellow)' : 'var(--green)';
      box.textContent = (partial ? '⚠️ ' : '') + (res.data?.warning || res.data?.message || 'Gia hạn thành công!');
      showToast((partial ? '⚠️ ' : '🎉 ') + (res.data?.warning || 'Kích hoạt Key gia hạn thành công!'));
      if (currentUser && (res.data.expiresAt !== undefined || res.data.isPermanent)) {
        currentUser.isPermanent = Boolean(res.data.isPermanent);
        if (res.data.expiresAt !== undefined) currentUser.expiresAt = res.data.expiresAt;
        if (res.data.planName) currentUser.planName = res.data.planName;
        if (Array.isArray(res.data.assignedBotIds)) currentUser.assignedBotIds = res.data.assignedBotIds;
        currentUser.status = 'active';
        applyUserRoleUI();
        updateUserHeaderCountdown();
      }
      lastHomeSig = '';
      await refreshHome();
      if (selectedBotId !== null) {
        await refreshDetail(true);
      }
      setTimeout(closeRenewModal, partial ? 2600 : 1800);
    } else {
      if (res.data?.requiresDiscordLink || res.data?.code === 'DISCORD_LINK_REQUIRED') {
        if (typeof currentDiscordLinkState === 'object') {
          currentDiscordLinkState.linked = false;
          currentDiscordLinkState.loaded = true;
        }
        if (typeof syncRenewModalDiscordGate === 'function') syncRenewModalDiscordGate();
      }
      box.style.background = 'rgba(239,68,68,0.2)';
      box.style.color = 'var(--red)';
      box.textContent = res.data?.error || 'Kích hoạt thất bại.';
    }
  } catch (e) {
    box.style.background = 'rgba(239,68,68,0.2)';
    box.style.color = 'var(--red)';
    box.textContent = e.message || 'Lỗi kết nối.';
  }
}

async function openKeyManagementModal() {
  document.getElementById('keyManagementModal').classList.remove('hidden');
  await refreshKeysTable();
}

function closeKeyManagementModal() {
  document.getElementById('keyManagementModal').classList.add('hidden');
}

async function refreshKeysTable() {
  const tbody = document.getElementById('keysTableBody');
  const fullTbody = document.getElementById('keysFullTableBody');
  if (!tbody && !fullTbody) return;
  const loadingHtml = '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--muted);">Đang tải danh sách Key / Giftcode...</td></tr>';
  if (tbody) tbody.innerHTML = loadingHtml;
  if (fullTbody) fullTbody.innerHTML = loadingHtml;

  try {
    const res = await requestJson('/api/manager/keys');
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi tải danh sách key');
    const keys = res.data?.keys || [];
    const countBadge = document.getElementById('keyMgmtTotalCount');
    if (countBadge) countBadge.textContent = keys.length;

    if (!keys.length) {
      const emptyHtml = '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--muted);">Chưa có mã Key / Giftcode nào. Sử dụng bảng phát hành phía trên để tạo mới.</td></tr>';
      if (tbody) tbody.innerHTML = emptyHtml;
      if (fullTbody) fullTbody.innerHTML = emptyHtml;
      return;
    }

    const rowsHtml = keys.map(k => {
      // Client-side scope: normalize independently from the server helper.
      // 0 = không giới hạn; invalid/missing values fall back to 1.
      const rawMaxUses = Number(k.maxUses);
      const maxUses = Number.isSafeInteger(rawMaxUses) && rawMaxUses >= 0 ? rawMaxUses : 1;
      const usedCount = Number(k.usedCount) || (k.used ? 1 : (Array.isArray(k.usedUsers) ? k.usedUsers.length : 0));
      const isExpired = k.expiresAt && Date.now() > Date.parse(k.expiresAt);
      const isExhausted = maxUses > 0 && usedCount >= maxUses;

      let statusBadge = '';
      if (isExpired) {
        statusBadge = '<span style="color:#f59e0b;background:rgba(245,158,11,0.15);padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;">Hết hạn</span>';
      } else if (isExhausted) {
        statusBadge = '<span style="color:var(--red);background:rgba(239,68,68,0.15);padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;">Hết lượt (' + usedCount + '/' + maxUses + ')</span>';
      } else if (usedCount > 0) {
        statusBadge = '<span style="color:#38bdf8;background:rgba(56,189,248,0.15);padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;">Đang dùng (' + usedCount + '/' + (maxUses > 0 ? maxUses : '∞') + ')</span>';
      } else {
        statusBadge = '<span style="color:var(--green);background:rgba(16,185,129,0.15);padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;">Khả dụng (0/' + (maxUses > 0 ? maxUses : '∞') + ')</span>';
      }

      const usersText = Array.isArray(k.usedUsers) && k.usedUsers.length > 0
        ? k.usedUsers.join(', ')
        : (k.usedBy ? String(k.usedBy) : '-');

      const expText = k.expiresAt
        ? new Date(k.expiresAt).toLocaleDateString('vi-VN')
        : 'Vô thời hạn';

      return '<tr style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:8px 10px;font-family:monospace;font-weight:750;color:#38bdf8;">' + escapeHtml(k.key) + '</td>' +
        '<td style="padding:8px 10px;">' + escapeHtml(k.planName || ((k.days === -1 || k.isPermanent) ? 'VIP Vĩnh Viễn' : (k.days + ' Ngày'))) + ' • <span style="color:#a78bfa;font-weight:700;">' + (k.botCount || 1) + ' Bot</span></td>' +
        '<td style="padding:8px 10px;">' + statusBadge + '</td>' +
        '<td style="padding:8px 10px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(usersText) + '">' + escapeHtml(usersText) + '</td>' +
        '<td style="padding:8px 10px;color:var(--muted);font-size:12px;">' + escapeHtml(expText) + '</td>' +
        '<td style="padding:8px 10px;text-align:right;">' +
          '<button type="button" class="small btn-copy-key" data-key="' + escapeHtml(k.key) + '" style="margin-right:6px;">📋 Copy</button>' +
          '<button type="button" class="small danger btn-delete-key" data-key="' + escapeHtml(k.key) + '">🗑 Xóa</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    function attachDelegation(el) {
      if (!el || el._delegationInit) return;
      el._delegationInit = true;
      el.addEventListener('click', function(e) {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.classList.contains('btn-copy-key')) {
          copyToClipboard(btn.getAttribute('data-key'), 'Mã Key', btn);
        } else if (btn.classList.contains('btn-delete-key')) {
          deleteLicenseKey(btn.getAttribute('data-key'));
        }
      });
    }

    if (tbody) {
      tbody.innerHTML = rowsHtml;
      attachDelegation(tbody);
    }
    if (fullTbody) {
      fullTbody.innerHTML = rowsHtml;
      attachDelegation(fullTbody);
    }
  } catch(e) {
    const errHtml = '<tr><td colspan="6" style="padding:12px;text-align:center;color:var(--red);">' + escapeHtml(e.message) + '</td></tr>';
    if (tbody) tbody.innerHTML = errHtml;
    if (fullTbody) fullTbody.innerHTML = errHtml;
  }
}

const keyMutationState = { creating: false, deleting: new Set() };

async function submitCreateKeys() {
  if (keyMutationState.creating) return;
  const daysSelect = document.getElementById('createKeyDays')?.value;
  const customInp = document.getElementById('createKeyCustomDays');
  const isPermanent = daysSelect === 'lifetime';
  let days = 7;
  if (isPermanent) {
    days = -1;
  } else if (daysSelect === 'custom') {
    const customVal = parseInt(customInp?.value, 10);
    if (!Number.isFinite(customVal) || customVal < 1) {
      showToast('Vui lòng nhập số ngày hợp lệ (tối thiểu 1 ngày).', 'error');
      if (customInp) customInp.focus();
      return;
    }
    days = Math.min(customVal, 3650);
  } else {
    days = Number(daysSelect) || 7;
  }
  const defaultPlanName = isPermanent ? 'VIP Vĩnh Viễn' : ('Gói ' + days + ' Ngày');
  const planName = document.getElementById('createKeyPlan')?.value.trim() || defaultPlanName;
  const customKey = document.getElementById('createKeyCustomKey')?.value.trim();
  const validDays = Number(document.getElementById('createKeyValidDays')?.value) || 0;
  const count = Number(document.getElementById('createKeyCount')?.value) || 1;
  const botCount = Number(document.getElementById('createKeyBotCount')?.value) || 1;
  const rawMaxUses = document.getElementById('createKeyMaxUses')?.value;
  const maxUses = rawMaxUses === '' || rawMaxUses === undefined ? 1 : Number(rawMaxUses);
  if (!Number.isSafeInteger(maxUses) || maxUses < 0) {
    showToast('Số lượt dùng phải là số nguyên không âm; 0 = không giới hạn.', 'error');
    return;
  }
  keyMutationState.creating = true;
  try {
    const res = await requestJson('/api/manager/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        days, permanent: isPermanent, isPermanent, setPermanent: isPermanent,
        planName, count, botCount, maxUses,
        customKey: customKey || undefined,
        validDays: validDays > 0 ? validDays : undefined
      })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi tạo key');
    showToast(res.data?.message || 'Đã tạo key thành công!');
    if (document.getElementById('createKeyCustomKey')) document.getElementById('createKeyCustomKey').value = '';
    await refreshKeysTable();
  } catch(e) {
    showToast(e.message || 'Lỗi tạo key');
  } finally {
    keyMutationState.creating = false;
  }
}

async function deleteLicenseKey(key) {
  if (!confirm('Bạn có chắc chắn muốn xóa mã Key ' + key + ' không?')) return;
  const keyId = String(key || '');
  if (!keyId || keyMutationState.deleting.has(keyId)) return;
  keyMutationState.deleting.add(keyId);
  try {
    const res = await requestJson('/api/manager/keys/' + encodeURIComponent(key), { method: 'DELETE' });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi xóa key');
    showToast('Đã xóa key ' + key);
    await refreshKeysTable();
  } catch(e) {
    showToast(e.message || 'Lỗi xóa key');
  } finally {
    keyMutationState.deleting.delete(keyId);
  }
}

async function quickAddUserDays(username, days) {
  const label = days === -1 ? 'Vĩnh viễn' : ('+' + days + ' ngày');
  if (!confirm('Cộng ' + label + ' hạn thuê cho tài khoản ' + username + '?')) return;
  try {
    const res = await requestJson('/api/manager/user/' + encodeURIComponent(username) + '/add-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi cập nhật');
    showToast(res.data?.message || 'Đã cộng ngày thuê!');
    lastHomeSig = '';
    await Promise.allSettled([
      typeof refreshUserManagementPage === 'function' ? refreshUserManagementPage() : Promise.resolve(),
      refreshHome()
    ]);
  } catch(e) {
    showToast(e.message || 'Lỗi cộng ngày thuê');
  }
}

async function resetCustomerBot() {
  if (!selectedBotId) return;
  if (!confirm('⚠️ BẠN CÓ CHẮC CHẮN MUỐN RESET BÀN GIAO BOT?\n\nThao tác này sẽ:\n1. Dừng bot ngay lập tức\n2. Xóa sạch tài khoản Minecraft cũ trên bot\n3. Xóa toàn bộ lịch sử Chat và Event Log\n4. Tắt toàn bộ lịch hẹn giờ và auto-chat\n\nSẵn sàng 100% để giao cho khách thuê mới!')) return;
  try {
    invalidateDetailReads();
    const res = await requestJson('/api/manager/bot/' + selectedBotId + '/reset-customer', { method: 'POST' });
    if (!res.ok) throw new Error((res.data?.warning ? res.data.warning + ' ' : '') + (res.data?.error || 'Lỗi reset bot'));
    if (res.data?.partial === true) {
      showToast('⚠️ Bot đã reset một phần: ' + (res.data?.warning || res.data?.message || 'Chưa thu hồi/xóa đủ dữ liệu Cloud. Kiểm tra log và thử lại.'));
    } else {
      showToast(res.data?.message || 'Đã reset bàn giao bot thành công!');
    }
    if (detailBot) {
      detailBot.username = '';
      detailBot.status = 'offline';
      detailBot.manuallyStopped = true;
    }
    const uInput = document.getElementById('detailUsernameInput'); if (uInput) uInput.value = '';
    const pInput = document.getElementById('detailPasswordInput'); if (pInput) pInput.value = '';
    const dChat = document.getElementById('detailChatLogs'); if (dChat) dChat.innerHTML = '<div style="color:var(--muted);padding:8px;">Chưa có tin nhắn nào.</div>';
    const dLog = document.getElementById('detailEventLogs'); if (dLog) dLog.innerHTML = '<div style="color:var(--muted);padding:8px;">Chưa có nhật ký nào.</div>';
    detailStatusHtml();
    renderDetailAutoChatSchedules([]);
    renderDetailBotSchedules([]);
    const botIdx = bots.findIndex(b => String(b.workerId||b.id) === String(selectedBotId));
    if (botIdx !== -1) {
      bots[botIdx].username = '';
      bots[botIdx].status = 'offline';
      bots[botIdx].manuallyStopped = true;
    }
    await refreshDetail(true);
  } catch(e) {
    showToast(e.message || 'Lỗi reset bàn giao');
  }
}

function getItemInitials(name) {
  if (!name || typeof name !== 'string') return 'IT';
  var words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }
  var clean = words[0].replace(/[^a-zA-Z0-9]/g, '');
  if (clean.length >= 2) {
    return clean.slice(0, 2).toUpperCase();
  }
  return (clean || 'IT').toUpperCase();
}
window.getItemInitials = getItemInitials;

function resolveItemTexture(item) {
  if (!item || typeof item !== 'object') {
    return { primary: '/textures/3d/AIR.png', secondary: '/textures/item/air.png', count: 0, label: '(Trống)' };
  }
  var rawName = String(item.name || '').trim();
  if (rawName.startsWith('minecraft:')) {
    rawName = rawName.slice(10);
  }
  var cleanName = rawName.toLowerCase();
  var disp = String(item.displayName || rawName || '(Trống)').trim();
  var dispLower = disp.toLowerCase();
  var count = Number(item.count) || 1;

  var mappedBase = cleanName;

  // Custom Item Keyword Mapping (displayName has priority)
  if (/khóa|key/i.test(dispLower)) {
    mappedBase = 'tripwire_hook';
  } else if (/vé|ticket/i.test(dispLower)) {
    mappedBase = 'paper';
  } else if (/túi|backpack|ba lô/i.test(dispLower)) {
    mappedBase = 'chest';
  } else if (/pha lê|crystal|đá|ngọc/i.test(dispLower)) {
    mappedBase = 'amethyst_shard';
  } else if (/xu|coin|tiền/i.test(dispLower)) {
    mappedBase = 'sunflower';
  }

  var safeMappedBase = String(mappedBase || 'stone').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64) || 'stone';
  var upperName = safeMappedBase.toUpperCase();
  var lowerName = safeMappedBase.toLowerCase();

  var isBlock = /stone|dirt|cobblestone|wood|log|plank|ore|sand|gravel|glass|brick|obsidian|bedrock/i.test(cleanName);

  return {
    primary: '/textures/3d/' + upperName + '.png',
    secondary: isBlock ? '/textures/block/' + lowerName + '.png' : '/textures/item/' + lowerName + '.png',
    tertiary: isBlock ? '/textures/item/' + lowerName + '.png' : '/textures/block/' + lowerName + '.png',
    count: count,
    label: disp
  };
}
window.resolveItemTexture = resolveItemTexture;

function handleItemTextureError(imgEl) {
  if (!imgEl) return;
  var stage = imgEl.dataset ? imgEl.dataset.fallbackStage : 'primary';
  if (stage === 'primary') {
    if (imgEl.dataset && imgEl.dataset.secondarySrc) {
      imgEl.src = imgEl.dataset.secondarySrc;
      imgEl.dataset.fallbackStage = 'secondary';
      return;
    }
    stage = 'secondary';
  }
  if (stage === 'secondary') {
    if (imgEl.dataset && imgEl.dataset.tertiarySrc) {
      imgEl.src = imgEl.dataset.tertiarySrc;
      imgEl.dataset.fallbackStage = 'tertiary';
      return;
    }
    stage = 'tertiary';
  }
  if (stage === 'tertiary') {
    if (imgEl.dataset && imgEl.dataset.cdnSrc && imgEl.src !== imgEl.dataset.cdnSrc) {
      imgEl.src = imgEl.dataset.cdnSrc;
      imgEl.dataset.fallbackStage = 'cdn';
      return;
    }
    stage = 'cdn';
  }
  if (stage === 'cdn' || stage === 'exhausted') {
    imgEl.style.display = 'none';
    imgEl.onerror = null;
    if (imgEl.dataset) imgEl.dataset.fallbackStage = 'exhausted';
    var parent = imgEl.parentNode;
    if (parent) {
      var existing = parent.querySelector ? (parent.querySelector('.slot-initials-badge') || parent.querySelector('.slot-text-fallback')) : null;
      if (!existing) {
        var badge = (typeof document !== 'undefined' && typeof document.createElement === 'function')
          ? document.createElement('span')
          : { tagName: 'SPAN', className: 'slot-initials-badge', textContent: '', style: {} };
        badge.className = 'slot-initials-badge';
        badge.textContent = (imgEl.dataset && imgEl.dataset.initials) ? imgEl.dataset.initials : 'IT';
        badge.style.fontSize = '11px';
        badge.style.fontWeight = '800';
        badge.style.color = 'var(--text)';
        parent.appendChild(badge);
      }
    }
  }
}
window.handleItemTextureError = handleItemTextureError;

function renderDetailRemoteGui(win) {
  const card = document.getElementById('detailRemoteGuiCard');
  if (!card) return;
  const placeholder = document.getElementById('detailRemoteGuiPlaceholder');
  const content = document.getElementById('detailRemoteGuiContent');
  const badge = document.getElementById('detailRemoteGuiBadge');
  const closeBtn = document.getElementById('detailRemoteGuiCloseBtn');
  const titleEl = document.getElementById('detailRemoteGuiTitle');

  if (!win || !win.slots || win.slots.length === 0) {
    if (placeholder) placeholder.style.display = 'block';
    if (content) content.style.display = 'none';
    if (badge) badge.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'none';
    if (titleEl) titleEl.textContent = '🖥️ Cửa Sổ GUI / Menu Ingame';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';
  if (content) content.style.display = 'block';
  if (badge) badge.style.display = 'inline-block';
  if (closeBtn) closeBtn.style.display = 'inline-block';
  if (titleEl) titleEl.textContent = '🖥️ ' + (win.title || 'GUI Sảnh / Máy Chủ Đang Mở');

  const container = document.getElementById('detailRemoteGuiSlots');
  if (!container) return;

  const rawSlots = Array.isArray(win.slots) ? win.slots : [];
  // Ensure container displays exact rows of 9 slots (e.g. 9, 18, 27, 36, 45, 54)
  const totalSlots = rawSlots.length > 0 ? rawSlots.length : (Number(win.totalSlots) || 27);
  const slotsToRender = [];
  for (let i = 0; i < totalSlots; i++) {
    slotsToRender.push(rawSlots[i] || null);
  }

  container.innerHTML = slotsToRender.map(function(item, idx) {
    if (!item || !item.name) {
      return '<div class="gui-slot-cell is-empty" role="button" tabindex="0" onclick="clickDetailGuiSlot(' + idx + ')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();clickDetailGuiSlot(' + idx + ');}" aria-label="Ô GUI #' + idx + ': (Trống)" title="Ô #' + idx + ' (Trống - Bấm để click)">' +
        '<span style="opacity:0.5;font-size:9.5px;">#' + idx + '</span>' +
        '</div>';
    }
    const tex = resolveItemTexture(item);
    const safeName = escapeHtml(tex.label);
    const cdnRel = (tex.secondary || '').startsWith('/textures/') ? tex.secondary.slice(10) : ('item/' + String(item.name || 'stone').replace(/^minecraft:/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '') + '.png');
    const cdnSrc = 'https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.20.1/assets/minecraft/textures/' + cdnRel;
    const initials = (typeof getItemInitials === 'function') ? getItemInitials(tex.label) : (tex.label ? tex.label.slice(0, 2).toUpperCase() : 'IT');
    const ariaLabel = 'Ô GUI #' + idx + ': ' + safeName + (tex.count > 1 ? ' x' + tex.count : '');
    return '<div class="gui-slot-cell has-item" role="button" tabindex="0" onclick="clickDetailGuiSlot(' + idx + ')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();clickDetailGuiSlot(' + idx + ');}" aria-label="' + escapeHtml(ariaLabel) + '" title="Ô #' + idx + ': ' + safeName + ' (Click để chọn)">' +
      '<img src="' + escapeHtml(tex.primary) + '" data-fallback-stage="primary" data-secondary-src="' + escapeHtml(tex.secondary) + '" data-tertiary-src="' + escapeHtml(tex.tertiary || tex.secondary) + '" data-cdn-src="' + escapeHtml(cdnSrc) + '" data-initials="' + escapeHtml(initials) + '" onerror="handleItemTextureError(this)" style="width:28px;height:28px;object-fit:contain;image-rendering:pixelated;" alt="' + safeName + '">' +
      '<span class="slot-text-name" style="font-size:9px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;line-height:1.1;max-width:100%;word-break:break-word;margin-top:1px;">' + safeName + '</span>' +
      (tex.count > 1 ? '<span style="position:absolute;bottom:2px;right:2px;font-size:9.5px;font-weight:600;font-family:var(--font-mono);background:var(--bg-elevated);border:1px solid var(--border-strong);padding:0 4px;border-radius:4px;color:var(--accent-text);">x' + tex.count + '</span>' : '') +
      '</div>';
  }).join('');
}

const _inFlightGuiSlotClicks = new Set();
async function clickDetailGuiSlot(slot) {
  if (!selectedBotId) return;
  const lockInfo = (typeof getWorkerLockInfo === 'function') ? getWorkerLockInfo() : { locked: false };
  if (lockInfo && lockInfo.locked) {
    if (typeof showToast === 'function') {
      const prefix = lockInfo.reason === 'maintenance' ? '🛠️ Hệ thống đang bảo trì: ' : '⚠️ ';
      showToast(prefix + lockInfo.message, 'warning', 4500);
    }
    return;
  }
  if (_inFlightGuiSlotClicks.has(slot)) return;
  _inFlightGuiSlotClicks.add(slot);
  if (typeof setDetailActionFeedback === 'function') {
    setDetailActionFeedback({ busy: true, tone: 'info', title: 'Đang bấm ô Menu #' + slot + '...', detail: 'Đang gửi thao tác click cửa sổ GUI tới bot.' });
  }
  try {
    const res = await requestJson('/api/manager/bot/' + selectedBotId + '/window/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, mouseButton: 0 }),
      timeoutMs: 8000
    });
    if (!res.ok) {
      if (typeof setDetailActionFeedback === 'function') {
        setDetailActionFeedback({ busy: false, tone: 'error', title: 'Không bấm được ô Menu #' + slot, detail: res.data?.error || 'Lỗi click GUI' });
      }
      showToast(res.data?.error || 'Lỗi click GUI', 'error');
    } else {
      if (typeof setDetailActionFeedback === 'function') {
        setDetailActionFeedback({ busy: false, tone: 'success', title: 'Đã bấm ô Menu #' + slot, detail: 'Đang cập nhật giao diện GUI mới nhất.' });
      }
      showToast('Đã click ô ' + slot, 'success');
      await refreshDetail(true);
    }
  } catch(e) {
    if (typeof setDetailActionFeedback === 'function') {
      setDetailActionFeedback({ busy: false, tone: 'error', title: 'Lỗi gửi click ô Menu #' + slot, detail: e?.message || 'Lỗi kết nối.' });
    }
    showToast('Lỗi gửi click GUI', 'error');
  } finally {
    _inFlightGuiSlotClicks.delete(slot);
  }
}
window._inFlightGuiSlotClicks = _inFlightGuiSlotClicks;

async function closeDetailGuiWindow() {
  if (!selectedBotId) return;
  const lockInfo = (typeof getWorkerLockInfo === 'function') ? getWorkerLockInfo() : { locked: false };
  if (lockInfo && lockInfo.locked) {
    if (typeof showToast === 'function') {
      const prefix = lockInfo.reason === 'maintenance' ? '🛠️ Hệ thống đang bảo trì: ' : '⚠️ ';
      showToast(prefix + lockInfo.message, 'warning', 4500);
    }
    return;
  }
  try {
    const res = await requestJson('/api/manager/bot/' + selectedBotId + '/window/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!res.ok) {
      showToast(res.data?.error || 'Không thể đóng GUI.');
      return;
    }
    showToast(res.data?.message || 'Đã đóng GUI.');
    await refreshDetail(true);
  } catch (_) {
    showToast('Lỗi gửi yêu cầu đóng GUI.');
  }
}

function formatFullDateTime(isoString) {
  if (!isoString) return 'Vĩnh Viễn';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return 'Không xác định';
  const pad = function(n) { return String(n).padStart(2, '0'); };
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  return hours + ':' + minutes + ' - ' + day + '/' + month + '/' + year;
}

function formatRentalCountdown(isoString) {
  if (!isoString) return { expired: false, frozen: false, text: 'Vĩnh viễn', rawCountdown: 'Vĩnh viễn', color: 'var(--green)' };
  const rawMs = Date.parse(isoString);
  if (isNaN(rawMs)) return { expired: false, frozen: false, text: 'Không xác định', rawCountdown: 'Không xác định', color: 'var(--muted)' };
  const maint = (typeof getSystemMaintenanceInfo === 'function') ? getSystemMaintenanceInfo() : (window.systemMaintenance || {});
  const nowMs = Date.now();
  const anchorRaw = maint.enabled ? (maint.lastCompensatedAt || maint.startedAt || maint.updatedAt || '') : '';
  const anchorMs = anchorRaw ? Date.parse(anchorRaw)
    : ((maint.enabled && typeof _localMaintFreezeAtMs === 'number' && _localMaintFreezeAtMs > 0) ? _localMaintFreezeAtMs : NaN);
  const isFrozen = Boolean(maint.enabled && ((Number.isFinite(anchorMs) && rawMs > anchorMs) || (!Number.isFinite(anchorMs) && rawMs > nowMs)));
  const diffMs = (isFrozen && Number.isFinite(anchorMs) && nowMs > anchorMs && rawMs > anchorMs) ? (rawMs - anchorMs) : (rawMs - nowMs);
  if (diffMs <= 0 && !isFrozen) return { expired: true, frozen: false, text: 'ĐÃ HẾT HẠN', rawCountdown: '0 phút', color: 'var(--red)' };
  const safeMs = Math.max(0, diffMs);
  const totalHours = Math.floor(safeMs / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = Math.floor((safeMs % 3600000) / 60000);
  const rawCountdown = days > 0 ? (days + ' ngày ' + hours + ' giờ ' + minutes + ' phút')
    : (hours > 0 ? (hours + ' giờ ' + minutes + ' phút') : (minutes + ' phút'));
  const text = isFrozen ? ('⏸️ Bảo trì · Tạm dừng trừ giờ (Còn ' + rawCountdown + ')') : ('Còn ' + rawCountdown);
  const color = isFrozen ? '#fbbf24' : (days < 1 ? 'var(--red)' : (days < 3 ? 'var(--yellow)' : 'var(--green)'));
  return { expired: false, frozen: isFrozen, text, rawCountdown, color };
}

function updateUserHeaderCountdown() {
  let badge = document.getElementById('userRentalCountdownBadge');
  const banner = document.getElementById('userRentalDashboardBanner');
  if (!currentUser || currentUser.role === 'admin') {
    if (badge) badge.style.display = 'none';
    if (banner) banner.style.display = 'none';
    return;
  }
  const headerContainer = document.querySelector('.global-header-right') || document.querySelector('.top-actions');
  if (!badge && headerContainer) {
    badge = document.createElement('div');
    badge.id = 'userRentalCountdownBadge';
    Object.assign(badge.style, { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '4px 10px', borderRadius: '20px', marginRight: '8px' });
    const roleBadge = headerContainer.querySelector('#globalUserRoleBadge');
    headerContainer.insertBefore(badge, roleBadge || headerContainer.firstChild);
  }
  const setBadgeStyle = (bg, color, border, html) => {
    if (!badge) return;
    Object.assign(badge.style, { display: 'inline-flex', background: bg, color, border });
    if (badge.innerHTML !== html) badge.innerHTML = html;
  };
  const bannerIcon = document.getElementById('userRentalBannerIcon');
  const bannerPlan = document.getElementById('userRentalBannerPlan');
  const bannerExactTime = document.getElementById('userRentalBannerExactTime');
  const bannerCountdown = document.getElementById('userRentalBannerCountdown');
  if (banner) {
    banner.style.display = 'flex';
    if (bannerPlan) bannerPlan.textContent = currentUser.planName || 'Gói thường';
  }
  if (currentUser.isPermanent === true) {
    setBadgeStyle('rgba(16,185,129,0.15)', 'var(--green)', '1px solid rgba(16,185,129,0.3)', '<span>👑 Hạn thuê: <b>VIP Vĩnh Viễn</b></span>');
    if (banner) {
      if (bannerIcon) bannerIcon.textContent = '👑';
      if (bannerExactTime) bannerExactTime.textContent = 'Vĩnh Viễn';
      if (bannerCountdown) { bannerCountdown.textContent = 'Không giới hạn thời gian'; bannerCountdown.style.color = 'var(--green)'; }
      banner.style.background = 'rgba(16,185,129,0.1)';
      banner.style.borderColor = 'rgba(16,185,129,0.3)';
    }
    return;
  }
  const baseExpIso = currentUser.rawExpiresAt || currentUser.expiresAt || currentUser.effectiveExpiresAt || null;
  if (!baseExpIso) {
    setBadgeStyle('rgba(148,163,184,0.15)', '#cbd5e1', '1px solid rgba(148,163,184,0.35)', '<span>⚪ <b>Chưa kích hoạt gói</b></span><button class="small primary" onclick="openRenewModal()" style="margin-left:6px;">🔑 Nhập Key kích hoạt</button>');
    if (banner) {
      if (bannerIcon) bannerIcon.textContent = '🔑';
      if (bannerExactTime) bannerExactTime.textContent = 'Chưa kích hoạt';
      if (bannerCountdown) { bannerCountdown.textContent = 'Nhập mã Key để kích hoạt gói thuê bot'; bannerCountdown.style.color = '#cbd5e1'; }
      banner.style.background = 'rgba(30,41,59,0.65)';
      banner.style.borderColor = 'rgba(148,163,184,0.35)';
    }
    return;
  }
  const effectiveExpIso = (typeof getEffectiveUserExpiresAt === 'function') ? getEffectiveUserExpiresAt(baseExpIso) : baseExpIso;
  const exactFormatted = formatFullDateTime(effectiveExpIso);
  const countdown = formatRentalCountdown(baseExpIso);
  const userExp = (typeof getUserExpirationInfo === 'function') ? getUserExpirationInfo() : { isExpired: false };
  if ((countdown.expired || userExp.isExpired) && !countdown.frozen && !userExp.frozenByMaintenance) {
    if (userExp.inGracePeriod) {
      const remainingMin = Math.max(1, Math.round(userExp.remainingGraceMs / 60000));
      const hours = Math.floor(remainingMin / 60);
      const mins = remainingMin % 60;
      const graceText = (hours > 0 ? (hours + 'h ') : '') + mins + 'm';
      setBadgeStyle('rgba(245,158,11,0.2)', '#fbbf24', '1px solid rgba(245,158,11,0.45)', '<span>⏳ Hạn thuê: <b>ĐANG ÂN HẠN 6H (còn ' + graceText + ')</b></span><button class="small primary" onclick="openRenewModal()" style="margin-left:4px;">🎁 Gia Hạn Ngay</button>');
      if (banner) {
        if (bannerIcon) bannerIcon.textContent = '⏳';
        if (bannerExactTime) bannerExactTime.textContent = exactFormatted;
        if (bannerCountdown) { bannerCountdown.textContent = 'ĐANG ÂN HẠN 6H (Bot vẫn chạy, còn ' + graceText + ')'; bannerCountdown.style.color = '#fbbf24'; }
        banner.style.background = 'rgba(245,158,11,0.15)';
        banner.style.borderColor = 'rgba(245,158,11,0.4)';
      }
      return;
    }
    setBadgeStyle('rgba(239,68,68,0.2)', 'var(--red)', '1px solid rgba(239,68,68,0.4)', '<span>⚠️ Hạn thuê: <b>ĐÃ HẾT HẠN (' + exactFormatted + ')</b></span><button class="small primary" onclick="openRenewModal()" style="margin-left:4px;">🎁 Gia Hạn Ngay</button>');
    if (banner) {
      if (bannerIcon) bannerIcon.textContent = '⛔';
      if (bannerExactTime) bannerExactTime.textContent = exactFormatted;
      if (bannerCountdown) { bannerCountdown.textContent = 'ĐÃ HẾT HẠN (Bot dừng an toàn sau 6h ân hạn)'; bannerCountdown.style.color = 'var(--red)'; }
      banner.style.background = 'rgba(239,68,68,0.15)';
      banner.style.borderColor = 'rgba(239,68,68,0.4)';
    }
    return;
  }
  if (countdown.frozen) {
    setBadgeStyle('rgba(245,158,11,0.18)', '#fbbf24', '1px solid rgba(245,158,11,0.42)', '<span><b>' + countdown.text + '</b></span><button class="small" onclick="openRenewModal()" style="margin-left:4px;">🎁 Gia Hạn</button>');
    if (banner) {
      if (bannerIcon) bannerIcon.textContent = '⏸️';
      if (bannerExactTime) bannerExactTime.textContent = exactFormatted;
      if (bannerCountdown) { bannerCountdown.textContent = countdown.text; bannerCountdown.style.color = '#fbbf24'; }
      banner.style.background = 'rgba(245,158,11,0.12)';
      banner.style.borderColor = 'rgba(245,158,11,0.38)';
    }
    return;
  }
  setBadgeStyle(
    countdown.color === 'var(--green)' ? 'rgba(16,185,129,0.15)' : (countdown.color === 'var(--yellow)' ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.2)'),
    countdown.color,
    '1px solid ' + (countdown.color === 'var(--green)' ? 'rgba(16,185,129,0.3)' : (countdown.color === 'var(--yellow)' ? 'rgba(234,179,8,0.3)' : 'rgba(239,68,68,0.4)')),
    '<span>⏳ Hạn thuê: <b>' + countdown.text + '</b> (' + exactFormatted + ')</span><button class="small" onclick="openRenewModal()" style="margin-left:4px;">🎁 Gia Hạn</button>'
  );
  if (banner) {
    if (bannerIcon) bannerIcon.textContent = '⏳';
    if (bannerExactTime) bannerExactTime.textContent = exactFormatted;
    if (bannerCountdown) { bannerCountdown.textContent = countdown.text; bannerCountdown.style.color = countdown.color; }
    banner.style.background = 'rgba(30,41,59,0.7)';
    banner.style.borderColor = 'rgba(59,130,246,0.35)';
  }
}
window.formatFullDateTime = formatFullDateTime;
window.formatRentalCountdown = formatRentalCountdown;
window.updateUserHeaderCountdown = updateUserHeaderCountdown;
window.updateRentalCountdownUI = updateUserHeaderCountdown;

let detailLastRevMap = new Map();
let detailRequestPromise = null;
let detailQueuedPromise = null;
let detailQueuedResolve = null;

async function refreshDetail(force=false) {
  if(selectedBotId===null) return;
  if(detailRequestInFlight){
    if(force) {
      detailRefreshQueued=true;
      if(!detailQueuedPromise){
        detailQueuedPromise = new Promise(resolve => { detailQueuedResolve = resolve; });
      }
      return detailQueuedPromise;
    }
    return detailRequestPromise;
  }

  const requestGeneration = detailRefreshGeneration;
  const requestBotId = selectedBotId;
  detailRequestInFlight=true;

  const isCurrentRequest = () =>
    requestGeneration === detailRefreshGeneration &&
    requestBotId === selectedBotId;

  const runPromise = (async () => {
    try {
      const lastRev = detailLastRevMap.get(requestBotId);
      const snapshotPath = (!force && lastRev)
        ? ('/snapshot?rev=' + encodeURIComponent(lastRev))
        : '/snapshot';
      const snapshot=await detailGet(snapshotPath);
      if(!isCurrentRequest()) return;
      if (snapshot && snapshot.maintenance && typeof syncSystemMaintenanceState === 'function') {
        syncSystemMaintenanceState(snapshot.maintenance, { rerender: true });
      }

      if(snapshot && snapshot.unchanged){
        uptimeSyncAt=Date.now();
        updateDetailUptime();
        const snapLogRev = (snapshot.logRevision !== undefined && snapshot.logRevision !== null) ? Number(snapshot.logRevision) : null;
        const snapChatRev = (snapshot.chatLogRevision !== undefined && snapshot.chatLogRevision !== null) ? Number(snapshot.chatLogRevision) : null;
        if (detailBot && snapLogRev !== null && Number.isFinite(snapLogRev)) detailBot.logRevision = snapLogRev;
        if (detailBot && snapChatRev !== null && Number.isFinite(snapChatRev)) detailBot.chatLogRevision = snapChatRev;
        if (force || (snapLogRev !== null && Number.isFinite(snapLogRev) && snapLogRev !== lastEventRevision)) {
          await loadDetailLogs(force, requestGeneration, requestBotId);
          if(!isCurrentRequest()) return;
        }
        if (force || (snapChatRev !== null && Number.isFinite(snapChatRev) && snapChatRev !== lastChatRevision)) {
          await loadDetailChat(force, requestGeneration, requestBotId);
        }
        if (typeof updateLiveSyncIndicators === 'function') updateLiveSyncIndicators('ok');
        return;
      }

      if(snapshot && snapshot.rev){
        detailLastRevMap.set(requestBotId, snapshot.rev);
      }

      if(snapshot && snapshot.bot){
        detailBot=snapshot.bot;
        detailInventory=snapshot.inventory||null;
        if(!detailSettingsDirty && snapshot.settings) renderDetailSettings(snapshot.settings);
        const dUser = document.getElementById('detailUsernameInput');
        const dPass = document.getElementById('detailPasswordInput');
        const resolvedMcUser = snapshot.settings?.mcUsername || detailBot.mcUsername || (detailBot.username && detailBot.username !== 'Chưa đặt' ? detailBot.username : '');
        const resolvedMcPass = snapshot.settings?.mcPassword ?? detailBot.mcPassword ?? '';
        if (dUser && document.activeElement !== dUser && dUser.getAttribute('data-dirty') !== 'true' && resolvedMcUser) {
          dUser.value = resolvedMcUser;
        }
        if (dPass && document.activeElement !== dPass && dPass.getAttribute('data-dirty') !== 'true' && typeof resolvedMcPass === 'string' && resolvedMcPass.length > 0) {
          dPass.value = resolvedMcPass;
        }
        if(!detailAutoChatDirty && Array.isArray(snapshot.autoChatSchedules)) renderDetailAutoChatSchedules(snapshot.autoChatSchedules);
        if(!detailBotScheduleDirty && Array.isArray(snapshot.botSchedules)) renderDetailBotSchedules(snapshot.botSchedules);
      } else {
        const fallbackBot=await detailGet('/state');
        if(!isCurrentRequest()) return;
        const fallbackInventory=await detailGet('/inventory');
        if(!isCurrentRequest()) return;
        const settingsData=await detailGet('/settings');
        if(!isCurrentRequest()) return;
        const autoChatData=await detailGet('/autoChat');
        if(!isCurrentRequest()) return;
        const scheduleData=await detailGet('/botSchedules');
        if(!isCurrentRequest()) return;
        detailBot=fallbackBot;
        detailInventory=fallbackInventory?.inventory||fallbackInventory;
        if(!detailSettingsDirty) renderDetailSettings(settingsData);
        if(!detailAutoChatDirty) renderDetailAutoChatSchedules(autoChatData.autoChatSchedules||[]);
        if(!detailBotScheduleDirty) renderDetailBotSchedules(scheduleData.botSchedules||[]);
      }

      if(!isCurrentRequest()) return;
      if (detailBot) {
        const bIdx = bots.findIndex(b => String(b.workerId||b.id) === String(requestBotId));
        if (bIdx !== -1) {
          bots[bIdx] = { ...bots[bIdx], ...detailBot };
          const homeEl = typeof document !== 'undefined' ? document.getElementById('homePage') : null;
          if (!homeEl || !homeEl.classList || !homeEl.classList.contains('hidden')) {
            if (typeof renderHome === 'function') renderHome();
          }
        }
      }
      uptimeSyncAt=Date.now();
      detailStatusHtml();
      renderDetailInventory();
      await loadDetailLogs(force, requestGeneration, requestBotId);
      if(!isCurrentRequest()) return;
      await loadDetailChat(force, requestGeneration, requestBotId);
      if(!isCurrentRequest()) return;
      if (force) {
        await loadDetailPositionHistory(false, requestGeneration, requestBotId);
      }
      if (typeof updateLiveSyncIndicators === 'function') updateLiveSyncIndicators('ok');
    } catch(err) {
      if (typeof updateLiveSyncIndicators === 'function') updateLiveSyncIndicators('error', err?.message || 'Không tải được dữ liệu bot');
      if(!isCurrentRequest()) return;
      if(err && (err.status===403 || err.status===401 || err.status===404)){
        showToast(err.data?.error || (err.status===404 ? 'Bot này không còn tồn tại trong Manager.' : 'Bạn không có quyền quản lý bot này.'), 'warning', 4000);
        goHome();
        return;
      }
      if (err && err.status === 503 && err.data && err.data.label) {
        detailBot = err.data;
        uptimeSyncAt = Date.now();
        detailStatusHtml();
      }
    } finally {
      detailRequestInFlight=false;
      if(detailRequestPromise === runPromise) detailRequestPromise = null;
      if(detailRefreshQueued && selectedBotId!==null){
        detailRefreshQueued=false;
        const queuedResolve = detailQueuedResolve;
        detailQueuedPromise = null;
        detailQueuedResolve = null;
        const nextPromise = refreshDetail(true);
        if(queuedResolve) Promise.resolve(nextPromise).then(queuedResolve, queuedResolve);
      } else if(detailQueuedResolve){
        const queuedResolve = detailQueuedResolve;
        detailQueuedPromise = null;
        detailQueuedResolve = null;
        queuedResolve();
      }
    }
  })();
  detailRequestPromise = runPromise;
  return runPromise;
}

function nearBottom(box){return !!(box && (box.scrollHeight-box.scrollTop-box.clientHeight<48));}

let _rawDetailEventEntries = [];
let _detailEventFilterType = 'all';
let _detailEventSearchText = '';
let _rawDetailChatEntries = [];
let _detailChatFilterType = 'all';
let _detailChatSearchText = '';
let _cachedRawEventsRef = null;
let _cachedRawEventsLen = -1;
let _cachedGroupedDetailEvents = [];
let _cachedRawChatRef = null;
let _cachedRawChatLen = -1;
let _cachedChatBotUsername = '';
let _cachedParsedDetailChats = [];
let _eventSearchDebounceTimer = null;
let _chatSearchDebounceTimer = null;

function ensureLogScrollWatcher(boxId, btnId) {
  if (typeof document === 'undefined') return;
  const box = document.getElementById(boxId);
  const btn = document.getElementById(btnId);
  if (!box || box.dataset?.scrollWatched === '1' || typeof box.addEventListener !== 'function') return;
  if (box.dataset) box.dataset.scrollWatched = '1';
  box.addEventListener('scroll', () => {
    if (btn && btn.classList && nearBottom(box)) {
      btn.classList.add('hidden');
    }
  }, { passive: true });
}

function resumeLogAutoScroll(kind) {
  const isChat = kind === 'chat';
  const box = document.getElementById(isChat ? 'detailChatLogs' : 'detailEventLogs');
  const btn = document.getElementById(isChat ? 'detailChatScrollBtn' : 'detailEventScrollBtn');
  if (box) box.scrollTop = box.scrollHeight;
  if (btn && btn.classList) btn.classList.add('hidden');
}
window.resumeLogAutoScroll = resumeLogAutoScroll;

function resetDetailLogFilters() {
  _rawDetailEventEntries = [];
  _detailEventFilterType = 'all';
  _detailEventSearchText = '';
  _rawDetailChatEntries = [];
  _detailChatFilterType = 'all';
  _detailChatSearchText = '';
  _cachedRawEventsRef = null;
  _cachedRawEventsLen = -1;
  _cachedGroupedDetailEvents = [];
  _cachedRawChatRef = null;
  _cachedRawChatLen = -1;
  _cachedChatBotUsername = '';
  _cachedParsedDetailChats = [];
  if (_eventSearchDebounceTimer) { clearTimeout(_eventSearchDebounceTimer); _eventSearchDebounceTimer = null; }
  if (_chatSearchDebounceTimer) { clearTimeout(_chatSearchDebounceTimer); _chatSearchDebounceTimer = null; }
  if (typeof document === 'undefined') return;
  const cIn = document.getElementById('detailChatFilterInput'); if (cIn) cIn.value = '';
  const eIn = document.getElementById('detailEventFilterInput'); if (eIn) eIn.value = '';
  document.querySelectorAll?.('[data-chat-filter]').forEach?.(btn => {
    const on = btn.dataset?.chatFilter === 'all';
    btn.classList?.toggle('active', on);
    btn.setAttribute?.('aria-pressed', on ? 'true' : 'false');
  });
  document.querySelectorAll?.('[data-event-filter]').forEach?.(btn => {
    const on = btn.dataset?.eventFilter === 'all';
    btn.classList?.toggle('active', on);
    btn.setAttribute?.('aria-pressed', on ? 'true' : 'false');
  });
  document.getElementById('detailChatScrollBtn')?.classList?.add('hidden');
  document.getElementById('detailEventScrollBtn')?.classList?.add('hidden');
}
window.resetDetailLogFilters = resetDetailLogFilters;

function formatDetailLogTime(rawTs) {
  if (!rawTs) return '--:--:--';
  const d = new Date(rawTs);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
}

function formatDetailLogEntryText(entry, includeTypeTag = false) {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return '';
  const emptyEventFallback = {
    window_open: 'Mở cửa sổ menu trong game.',
    window_close: 'Đã đóng cửa sổ menu trong game.',
    window_click: 'Đã chọn ô trên menu GUI.',
    stopped: 'Bot đã dừng hoạt động.',
    connecting: 'Đang kết nối tới máy chủ Minecraft...',
    spawn: 'Bot đã vào sảnh máy chủ.',
    online: 'Đã vào khu vực chơi / AFK.',
    connection_error: 'Tạm mất kết nối tới máy chủ Minecraft.',
    kicked: 'Bot bị ngắt kết nối khỏi máy chủ.',
    maintenance: 'Máy chủ đang bảo trì.',
    maintenance_window: 'Tạm nghỉ khung giờ bảo trì định kỳ (04:30 – 05:30 VN).'
  };
  const typeLower = String(entry.type || '').trim().toLowerCase();
  const msg = String(entry.message || entry.reason || entry.text || entry.line || '').trim()
    || (includeTypeTag ? (emptyEventFallback[typeLower] || '') : '');
  if (!msg) return '';
  let timePrefix = '';
  const rawTs = entry.occurredAt || entry.timestamp || entry.createdAt;
  if (rawTs && !/^\d{2}:\d{2}:\d{2}\b/.test(msg)) {
    const formattedTs = formatDetailLogTime(rawTs);
    if (formattedTs !== '--:--:--') timePrefix = formattedTs;
  }
  const typeTag = includeTypeTag && entry.type && !msg.startsWith('[')
    ? '[' + String(entry.type).trim() + ']'
    : '';
  return [timePrefix, typeTag, msg].filter(Boolean).join(' ');
}

function classifyEventEntry(entry) {
  const line = formatDetailLogEntryText(entry, true);
  if (!line) return null;

  let timeText = '--:--:--';
  let rest = line;
  const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2})\s+(.*)$/);
  if (timeMatch) {
    timeText = timeMatch[1];
    rest = timeMatch[2];
  }

  let rawTag = '';
  let bodyText = rest;
  const tagMatch = rest.match(/^\[([^\]]{1,24})\]\s*(.*)$/);
  if (tagMatch) {
    rawTag = tagMatch[1].trim();
    bodyText = tagMatch[2].trim() || rawTag;
  }

  if (typeof humanizeBotErrorForUser === 'function') {
    const humanized = humanizeBotErrorForUser(bodyText);
    if (humanized) bodyText = humanized;
  }

  const tagLabelMap = {
    connecting: 'KẾT NỐI', spawn: 'VÀO SẢNH', online: 'VÀO GAME', kicked: 'NGẮT KẾT NỐI', stopped: 'ĐÃ DỪNG',
    host_switch: 'ĐỔI MÁY CHỦ', window_open: 'MỞ MENU', window_close: 'ĐÓNG MENU', window_click: 'CHỌN MENU',
    respawn: 'HỒI SINH', totem_popped: 'DÙNG TOTEM', connection_error: 'LỖI KẾT NỐI', credentials_missing: 'THIẾU TÀI KHOẢN',
    reconnect_exhausted: 'DỪNG THỬ LẠI', afk_kicked: 'VĂNG AFK', afk_recovered: 'VÀO LẠI AFK',
    maintenance_window: 'BẢO TRÌ', maintenance: 'BẢO TRÌ', bot_death: 'HẠ GỤC', auth_failed: 'ĐĂNG NHẬP',
    invalid_proxy: 'PROXY', ip_limited: 'GIỚI HẠN IP', banned: 'BỊ KHÓA',
    info: 'THÔNG TIN', warn: 'CẢNH BÁO', warning: 'CẢNH BÁO', error: 'LỖI', worker_event: 'HỆ THỐNG'
  };
  const lowerTag = rawTag.toLowerCase();
  const mappedPill = tagLabelMap[lowerTag] || '';

  const lower = (rawTag + ' ' + bodyText).toLowerCase();
  let kind = 'info';
  let pillLabel = mappedPill || (rawTag ? rawTag.slice(0, 14).toUpperCase() : 'HỆ THỐNG');
  if (lower.includes('lỗi') || lower.includes('error') || lower.includes('❌') || lower.includes('disconnect') || lower.includes('kicked') || lower.includes('ngắt kết nối') || lower.includes('mất kết nối') || lower.includes('văng afk') || lower.includes('bị khóa')) {
    kind = 'error';
    if (!rawTag && !mappedPill) pillLabel = 'LỖI';
  } else if (lower.includes('cảnh báo') || lower.includes('warn') || lower.includes('⚠') || lower.includes('phản hồi chậm') || lower.includes('bảo trì') || lower.includes('hạ gục')) {
    kind = 'warn';
    if (!rawTag && !mappedPill) pillLabel = 'CẢNH BÁO';
  } else if (lower.includes('totem') || lower.includes('vào cụm') || lower.includes('flow') || lower.includes('gui') || lower.includes('menu') || lower.includes('hồi sinh') || lower.includes('đổi máy chủ')) {
    kind = 'flow';
    if (!rawTag && !mappedPill) pillLabel = 'LUỒNG';
  } else if (lower.includes('thành công') || lower.includes('connected') || lower.includes('spawn') || lower.includes('vào game') || lower.includes('vào sảnh') || lower.includes('✅') || lower.includes('🎉') || lower.includes('bình thường')) {
    kind = 'success';
    if (!rawTag && !mappedPill) pillLabel = 'HOÀN TẤT';
  } else if (lower.includes('chat') || lower.includes('tin nhắn')) {
    kind = 'chat';
    if (!rawTag && !mappedPill) pillLabel = 'CHAT';
  }

  const repeatCount = Math.max(1, Number(entry?.repeatCount) || 1);
  const firstTimeRaw = entry?.firstOccurredAt ? formatDetailLogTime(entry.firstOccurredAt) : '';
  const firstTimeText = firstTimeRaw && firstTimeRaw !== '--:--:--' ? firstTimeRaw : '';

  return {
    kind,
    timeText,
    firstTimeText,
    pillLabel,
    bodyText,
    repeatCount,
    groupKey: kind + '|' + pillLabel + '|' + bodyText,
    searchBlob: (timeText + ' ' + pillLabel + ' ' + rawTag + ' ' + bodyText).toLowerCase()
  };
}

function buildGroupedEventHtml(item) {
  let repeatBadgeHtml = '';
  if (item.repeatCount > 1) {
    const rangeTip = item.firstTimeText && item.firstTimeText !== item.timeText
      ? ('Lặp lại ' + item.repeatCount + ' lần (' + item.firstTimeText + ' → ' + item.timeText + ')')
      : ('Lặp lại ' + item.repeatCount + ' lần');
    repeatBadgeHtml = '<span class="log-repeat-badge" title="' + escapeHtml(rangeTip) + '">×' + item.repeatCount + '</span>';
  }
  return '<div class="log-row log-row-' + item.kind + '">' +
    '<span class="log-time">' + escapeHtml(item.timeText) + '</span>' +
    '<span class="log-pill log-pill-' + item.kind + '">' + escapeHtml(item.pillLabel) + '</span>' +
    '<span class="log-body">' + escapeHtml(item.bodyText) + repeatBadgeHtml + '</span>' +
  '</div>';
}

function getGroupedDetailEvents() {
  const list = Array.isArray(_rawDetailEventEntries) ? _rawDetailEventEntries : [];
  if (_cachedRawEventsRef === list && _cachedRawEventsLen === list.length) {
    return _cachedGroupedDetailEvents;
  }
  const grouped = [];
  for (let i = 0; i < list.length; i++) {
    const item = classifyEventEntry(list[i]);
    if (!item) continue;
    const prev = grouped.length > 0 ? grouped[grouped.length - 1] : null;
    if (prev && prev.groupKey === item.groupKey) {
      if (!prev.firstTimeText) prev.firstTimeText = prev.timeText;
      prev.timeText = item.timeText;
      prev.repeatCount += item.repeatCount;
      if (item.timeText && !prev.searchBlob.includes(item.timeText)) {
        prev.searchBlob += ' ' + item.timeText.toLowerCase();
      }
    } else {
      grouped.push(item);
    }
  }
  for (let i = 0; i < grouped.length; i++) {
    grouped[i].html = buildGroupedEventHtml(grouped[i]);
  }
  _cachedRawEventsRef = list;
  _cachedRawEventsLen = list.length;
  _cachedGroupedDetailEvents = grouped;
  return grouped;
}

function renderFilteredDetailEvents(shouldAutoScroll = false) {
  const box = document.getElementById('detailEventLogs');
  const countEl = document.getElementById('detailEventCount');
  const scrollBtn = document.getElementById('detailEventScrollBtn');
  if (!box) return;
  ensureLogScrollWatcher('detailEventLogs', 'detailEventScrollBtn');

  const allParsed = getGroupedDetailEvents();
  const rawTotal = allParsed.reduce((sum, item) => sum + (item.repeatCount || 1), 0);
  const query = String(_detailEventSearchText || '').toLowerCase().trim();
  const filtered = allParsed.filter(item => {
    if (_detailEventFilterType === 'error' && item.kind !== 'error' && item.kind !== 'warn') return false;
    if (_detailEventFilterType === 'flow' && item.kind !== 'flow' && item.kind !== 'success') return false;
    if (query && !item.searchBlob.includes(query)) return false;
    return true;
  });

  if (countEl) {
    if (_detailEventFilterType !== 'all' || query) {
      countEl.textContent = filtered.length + '/' + allParsed.length + ' sự kiện';
    } else if (rawTotal > allParsed.length) {
      countEl.textContent = allParsed.length + ' dòng (' + rawTotal + ' lần)';
    } else {
      countEl.textContent = allParsed.length + ' sự kiện';
    }
  }

  const newHtml = filtered.length > 0
    ? filtered.map(item => item.html).join('')
    : ('<div class="log-empty">' + (allParsed.length ? 'Không có sự kiện nào khớp bộ lọc hiện tại.' : 'Chưa có nhật ký sự kiện nào.') + '</div>');

  const changed = box.innerHTML !== newHtml;
  if (changed) box.innerHTML = newHtml;
  if (shouldAutoScroll) {
    box.scrollTop = box.scrollHeight;
    if (scrollBtn && scrollBtn.classList) scrollBtn.classList.add('hidden');
  } else if (changed && !nearBottom(box) && scrollBtn && scrollBtn.classList) {
    scrollBtn.classList.remove('hidden');
  }
}

function onDetailEventSearchInput(value) {
  if (_eventSearchDebounceTimer) clearTimeout(_eventSearchDebounceTimer);
  _eventSearchDebounceTimer = setTimeout(() => {
    _eventSearchDebounceTimer = null;
    setDetailEventFilter(null, value);
  }, 120);
}
window.onDetailEventSearchInput = onDetailEventSearchInput;

function setDetailEventFilter(category, searchText) {
  if (category !== null && category !== undefined) {
    _detailEventFilterType = String(category);
    document.querySelectorAll?.('[data-event-filter]').forEach?.(btn => {
      const on = btn.dataset?.eventFilter === _detailEventFilterType;
      btn.classList?.toggle('active', on);
      btn.setAttribute?.('aria-pressed', on ? 'true' : 'false');
    });
  }
  if (searchText !== null && searchText !== undefined) {
    _detailEventSearchText = String(searchText);
  }
  renderFilteredDetailEvents(true);
}
window.setDetailEventFilter = setDetailEventFilter;

let eventLoadingToken = 0;
async function loadDetailLogs(force=false, expectedGeneration=detailRefreshGeneration, expectedBotId=selectedBotId) {
  const targetGen = (expectedGeneration !== null && expectedGeneration !== undefined) ? Number(expectedGeneration) : detailRefreshGeneration;
  if(eventLoading && eventLoadingGen === targetGen && !force) return;
  const currentBotRev = (detailBot && detailBot.logRevision !== undefined && detailBot.logRevision !== null)
    ? Number(detailBot.logRevision)
    : null;
  if(!force && currentBotRev !== null && Number.isFinite(currentBotRev) && lastEventRevision === currentBotRev) return;
  eventLoading=true;
  eventLoadingGen=targetGen;
  const reqToken = ++eventLoadingToken;
  try {
    const data=await detailGet('/logs');
    if(reqToken !== eventLoadingToken) return;
    if(!currentUser || (expectedGeneration!==null && (expectedGeneration!==detailRefreshGeneration || expectedBotId!==selectedBotId))) return;
    const box=document.getElementById('detailEventLogs');
    const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!force && sel && sel.rangeCount > 0 && !sel.isCollapsed && box?.contains(sel.anchorNode)) {
      return;
    }
    const keep=nearBottom(box);
    _rawDetailEventEntries = Array.isArray(data?.logs) ? data.logs : [];
    renderFilteredDetailEvents(keep);
    lastEventRevision = (currentBotRev !== null && Number.isFinite(currentBotRev))
      ? currentBotRev
      : Number(data.revision || 0);
  } finally {
    if(reqToken === eventLoadingToken) eventLoading=false;
  }
}

function classifyChatEntry(entry) {
  const line = formatDetailLogEntryText(entry, false);
  if (!line) return null;
  let cls = 'chat-row-item';
  let category = 'server';
  const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2})\s*(.*)$/);
  const timePart = timeMatch ? timeMatch[1] : '--:--:--';
  const rest = timeMatch ? timeMatch[2] : line;

  const srcLower = (entry && typeof entry === 'object' && entry.source) ? String(entry.source).trim().toLowerCase() : '';
  const botNameRaw = (typeof detailBot !== 'undefined' && detailBot?.username) ? String(detailBot.username).trim() : '';
  const botNameLower = botNameRaw && botNameRaw !== 'Chưa đặt' ? botNameRaw.toLowerCase() : '';
  const botBracketMatch = botNameLower && rest.toLowerCase().startsWith('[' + botNameLower + '] ');
  const isOutgoingSource = ['outgoing', 'scheduled_chat', 'spawn_command', 'auto_chat'].includes(srcLower);
  const SYSTEM_CHAT_TAG_RE = /^(!|server|kingmc|system|hệ thống|he thong|thông báo|thong bao|console|admin|broadcast|cảnh báo|notice)$/i;

  let bodyHtml = '';
  if (isOutgoingSource || rest.startsWith('→') || rest.includes('→ /') || botBracketMatch) {
    cls += ' chat-row-outgoing';
    category = 'outgoing';
    let cleanCmd = rest.replace(/^→\s*/, '');
    if (botBracketMatch) {
      cleanCmd = cleanCmd.slice(botNameRaw.length + 3).replace(/^→\s*/, '');
    }
    const isAuto = srcLower === 'auto_chat' || srcLower === 'scheduled_chat';
    bodyHtml = '<span class="chat-dir-pill' + (isAuto ? ' is-auto' : '') + '">' + (isAuto ? 'AUTO CHAT →' : 'BOT →') + '</span><code class="chat-cmd-text">' + escapeHtml(cleanCmd) + '</code>';
  } else if (/^\[?([^\]|]+)[\]|]\s*([A-Za-z0-9_]{1,16})\s*[:»]\s*(.+)$/u.test(rest)) {
    const m = rest.match(/^\[?([^\]|]+)[\]|]\s*([A-Za-z0-9_]{1,16})\s*[:»]\s*(.+)$/u);
    category = 'player';
    bodyHtml = '<span class="chat-badge">' + escapeHtml(m[1].trim()) + '</span>' +
               '<span class="chat-sender">' + escapeHtml(m[2].trim()) + ':</span> ' +
               '<span class="chat-text">' + escapeHtml(m[3].trim()) + '</span>';
  } else if (/^<([A-Za-z0-9_]{1,16})>\s*(.+)$/u.test(rest)) {
    const m = rest.match(/^<([A-Za-z0-9_]{1,16})>\s*(.+)$/u);
    category = 'player';
    bodyHtml = '<span class="chat-sender">' + escapeHtml(m[1].trim()) + ':</span> ' +
               '<span class="chat-text">' + escapeHtml(m[2].trim()) + '</span>';
  } else if (/^\[([^\]]{1,40})\]\s+(.+)$/u.test(rest)) {
    const m = rest.match(/^\[([^\]]{1,40})\]\s+(.+)$/u);
    const tag = m[1].trim();
    const content = m[2].trim();
    if (SYSTEM_CHAT_TAG_RE.test(tag)) {
      cls += ' chat-row-server';
      category = 'server';
      bodyHtml = '<span class="chat-server-badge">' + escapeHtml(tag.toUpperCase() === '!' ? 'HỆ THỐNG' : tag.toUpperCase()) + '</span>' +
                 '<span class="chat-server-text">' + escapeHtml(content) + '</span>';
    } else {
      category = 'player';
      bodyHtml = '<span class="chat-sender">' + escapeHtml(tag) + ':</span> ' +
                 '<span class="chat-text">' + escapeHtml(content) + '</span>';
    }
  } else {
    cls += ' chat-row-server';
    category = 'server';
    const cleanMsg = rest.replace(/^(Server:)\s*/i, '');
    bodyHtml = '<span class="chat-server-badge">HỆ THỐNG</span>' +
               '<span class="chat-server-text">' + escapeHtml(cleanMsg) + '</span>';
  }

  return {
    category,
    searchBlob: line.toLowerCase(),
    html: '<div class="' + cls + '">' +
      '<span class="log-time">' + escapeHtml(timePart) + '</span>' +
      '<div class="chat-body">' + bodyHtml + '</div>' +
    '</div>'
  };
}

function getParsedDetailChats() {
  const list = Array.isArray(_rawDetailChatEntries) ? _rawDetailChatEntries : [];
  const curBotName = (typeof detailBot !== 'undefined' && detailBot?.username) ? String(detailBot.username) : '';
  if (_cachedRawChatRef === list && _cachedRawChatLen === list.length && _cachedChatBotUsername === curBotName) {
    return _cachedParsedDetailChats;
  }
  const parsed = [];
  for (let i = 0; i < list.length; i++) {
    const item = classifyChatEntry(list[i]);
    if (item) parsed.push(item);
  }
  _cachedRawChatRef = list;
  _cachedRawChatLen = list.length;
  _cachedChatBotUsername = curBotName;
  _cachedParsedDetailChats = parsed;
  return parsed;
}

function renderFilteredDetailChat(shouldAutoScroll = false) {
  const box = document.getElementById('detailChatLogs');
  const countEl = document.getElementById('detailChatCount');
  const scrollBtn = document.getElementById('detailChatScrollBtn');
  if (!box) return;
  ensureLogScrollWatcher('detailChatLogs', 'detailChatScrollBtn');

  const allParsed = getParsedDetailChats();
  const query = String(_detailChatSearchText || '').toLowerCase().trim();
  const filtered = allParsed.filter(item => {
    if (_detailChatFilterType === 'player' && item.category !== 'player') return false;
    if (_detailChatFilterType === 'outgoing' && item.category !== 'outgoing') return false;
    if (_detailChatFilterType === 'server' && item.category !== 'server') return false;
    if (query && !item.searchBlob.includes(query)) return false;
    return true;
  });

  if (countEl) {
    countEl.textContent = (_detailChatFilterType !== 'all' || query)
      ? (filtered.length + '/' + allParsed.length + ' tin')
      : (allParsed.length + ' tin');
  }

  const newHtml = filtered.length > 0
    ? filtered.map(item => item.html).join('')
    : ('<div class="log-empty">' + (allParsed.length ? 'Không có tin nhắn nào khớp bộ lọc hiện tại.' : 'Chưa có tin nhắn chat nào.') + '</div>');

  const changed = box.innerHTML !== newHtml;
  if (changed) box.innerHTML = newHtml;
  if (shouldAutoScroll) {
    box.scrollTop = box.scrollHeight;
    if (scrollBtn && scrollBtn.classList) scrollBtn.classList.add('hidden');
  } else if (changed && !nearBottom(box) && scrollBtn && scrollBtn.classList) {
    scrollBtn.classList.remove('hidden');
  }
}

function onDetailChatSearchInput(value) {
  if (_chatSearchDebounceTimer) clearTimeout(_chatSearchDebounceTimer);
  _chatSearchDebounceTimer = setTimeout(() => {
    _chatSearchDebounceTimer = null;
    setDetailChatFilter(null, value);
  }, 120);
}
window.onDetailChatSearchInput = onDetailChatSearchInput;

function setDetailChatFilter(category, searchText) {
  if (category !== null && category !== undefined) {
    _detailChatFilterType = String(category);
    document.querySelectorAll?.('[data-chat-filter]').forEach?.(btn => {
      const on = btn.dataset?.chatFilter === _detailChatFilterType;
      btn.classList?.toggle('active', on);
      btn.setAttribute?.('aria-pressed', on ? 'true' : 'false');
    });
  }
  if (searchText !== null && searchText !== undefined) {
    _detailChatSearchText = String(searchText);
  }
  renderFilteredDetailChat(true);
}
window.setDetailChatFilter = setDetailChatFilter;

let chatLoadingToken = 0;
async function loadDetailChat(force=false, expectedGeneration=detailRefreshGeneration, expectedBotId=selectedBotId) {
  const targetGen = (expectedGeneration !== null && expectedGeneration !== undefined) ? Number(expectedGeneration) : detailRefreshGeneration;
  if(chatLoading && chatLoadingGen === targetGen && !force) return;
  const currentChatRev = (detailBot && detailBot.chatLogRevision !== undefined && detailBot.chatLogRevision !== null)
    ? Number(detailBot.chatLogRevision)
    : null;
  if(!force && currentChatRev !== null && Number.isFinite(currentChatRev) && lastChatRevision >= 0 && lastChatRevision === currentChatRev) return;
  chatLoading=true;
  chatLoadingGen=targetGen;
  const reqToken = ++chatLoadingToken;
  try {
    const data=await detailGet('/chat-logs');
    if(reqToken !== chatLoadingToken) return;
    if(!currentUser || (expectedGeneration!==null && (expectedGeneration!==detailRefreshGeneration || expectedBotId!==selectedBotId))) return;
    const box=document.getElementById('detailChatLogs');
    const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!force && sel && sel.rangeCount > 0 && !sel.isCollapsed && box?.contains(sel.anchorNode)) {
      return;
    }
    const keep=nearBottom(box);
    _rawDetailChatEntries = Array.isArray(data?.logs) ? data.logs : [];
    renderFilteredDetailChat(keep);
    lastChatRevision = (currentChatRev !== null && Number.isFinite(currentChatRev))
      ? currentChatRev
      : Number(data.revision || 0);
  } finally {
    if(reqToken === chatLoadingToken) chatLoading=false;
  }
}

async function loadDetailPositionHistory(force=false, expectedGeneration=detailRefreshGeneration, expectedBotId=selectedBotId) {
  if(!currentUser || (expectedGeneration!==null && (expectedGeneration!==detailRefreshGeneration || expectedBotId!==selectedBotId))) return;
  lastPositionHistoryFetchedAt=Date.now();
  if (typeof renderDetailLifecycleAndTrail === 'function') renderDetailLifecycleAndTrail();
}

function itemLabel(item) {
  if(!item) return '-';
  const name=item.displayName||item.name||'-';
  const count=Number(item.count||0);
  return String(name).replace(/_/g,' ')+(count>1?' x'+count:'');
}

let selectedDetailMoveSlot = null;

function updateDetailTouchHint() {
  if (typeof document === 'undefined') return;
  const hintBox = document.getElementById('detailInventoryInteractHint');
  const dropZone = document.getElementById('detailDropZone');
  const isOfflineBot = typeof isDetailBotOfflineOrStopped === 'function' && isDetailBotOfflineOrStopped(detailBot);

  document.querySelectorAll?.('#detailPage .inventory-slot.selected-for-move, #detailPage .equipment-slot.selected-for-move').forEach?.(el => {
    el.classList?.remove('selected-for-move');
  });
  document.querySelectorAll?.('#detailPage .equipment-slot.ready-target').forEach?.(el => {
    el.classList?.remove('ready-target');
  });
  dropZone?.classList?.remove('ready-target');

  if (!selectedDetailMoveSlot || isOfflineBot) {
    selectedDetailMoveSlot = null;
    if (hintBox) {
      hintBox.className = 'inventory-interact-banner';
      hintBox.innerHTML = '<span>Chạm hoặc bấm 1 lần vào vật phẩm để chọn chuyển ô, mặc giáp, lắp tay phụ hoặc vứt ra ngoài.</span>';
    }
    return;
  }

  if (selectedDetailMoveSlot.kind === 'slot') {
    const slotNum = Number(selectedDetailMoveSlot.slot);
    const activeSlotEl = document.querySelector?.('#detailInventoryPanel .inventory-slot[data-slot="' + slotNum + '"]');
    activeSlotEl?.classList?.add('selected-for-move');
    document.querySelectorAll?.('#detailPage .equipment-slot').forEach?.(el => el.classList?.add('ready-target'));
    dropZone?.classList?.add('ready-target');
    if (hintBox) {
      const label = itemLabel(selectedDetailMoveSlot.item);
      const isHotbar = slotNum >= 36 && slotNum <= 44;
      hintBox.className = 'inventory-interact-banner has-selection';
      hintBox.innerHTML =
        '<span><strong>Đang chọn:</strong> ' + escapeHtml(label) + ' — Bấm ô khác để chuyển, bấm Giáp/Tay phụ để mặc, hoặc bấm Vứt đồ.</span>' +
        '<span style="display:flex;gap:6px;flex-wrap:wrap;">' +
          (isHotbar ? ('<button type="button" class="small primary" onclick="holdSelectedHotbarSlot(' + (slotNum - 36) + ')">Cầm trên tay</button>') : '') +
          '<button type="button" class="small" onclick="cancelDetailSlotSelection(event)">Hủy chọn</button>' +
        '</span>';
    }
  } else if (selectedDetailMoveSlot.kind === 'equip') {
    const boxIdMap = { head: 'equipHeadBox', torso: 'equipTorsoBox', legs: 'equipLegsBox', feet: 'equipFeetBox', 'off-hand': 'equipOffhandBox' };
    const eqEl = document.getElementById(boxIdMap[selectedDetailMoveSlot.dest] || '');
    eqEl?.classList?.add('selected-for-move');
    if (hintBox) {
      const label = itemLabel(selectedDetailMoveSlot.item);
      hintBox.className = 'inventory-interact-banner has-selection';
      hintBox.innerHTML =
        '<span><strong>Đang chọn trang bị:</strong> ' + escapeHtml(label) + ' — Bấm vào một ô trong Kho đồ để tháo vào ô đó.</span>' +
        '<span style="display:flex;gap:6px;flex-wrap:wrap;">' +
          '<button type="button" class="small warning-btn" onclick="unequipSelectedToInventory()">Tháo về kho</button>' +
          '<button type="button" class="small" onclick="cancelDetailSlotSelection(event)">Hủy chọn</button>' +
        '</span>';
    }
  }
}
window.updateDetailTouchHint = updateDetailTouchHint;

async function holdSelectedHotbarSlot(hotbarIndex) {
  cancelDetailSlotSelection();
  await selectDetailHotbar(hotbarIndex);
}
window.holdSelectedHotbarSlot = holdSelectedHotbarSlot;

async function unequipSelectedToInventory() {
  if (!selectedDetailMoveSlot || selectedDetailMoveSlot.kind !== 'equip') return;
  const dest = selectedDetailMoveSlot.dest;
  cancelDetailSlotSelection();
  await unequipDetail(dest);
}
window.unequipSelectedToInventory = unequipSelectedToInventory;

function cancelDetailSlotSelection(e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  selectedDetailMoveSlot = null;
  updateDetailTouchHint();
}

function handleDetailSlotClick(slot, item, e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  if (typeof isDetailBotOfflineOrStopped === 'function' && isDetailBotOfflineOrStopped(detailBot)) {
    cancelDetailSlotSelection();
    return;
  }
  const slotNum = Number(slot);
  if (selectedDetailMoveSlot) {
    if (selectedDetailMoveSlot.kind === 'slot' && Number(selectedDetailMoveSlot.slot) === slotNum) {
      cancelDetailSlotSelection();
      return;
    }
    if (selectedDetailMoveSlot.kind === 'equip') {
      const dest = selectedDetailMoveSlot.dest;
      cancelDetailSlotSelection();
      void unequipAndMove(dest, slotNum);
      return;
    }
    const sourceSlot = Number(selectedDetailMoveSlot.slot);
    cancelDetailSlotSelection();
    void moveDetailItem(sourceSlot, slotNum);
    return;
  }

  if (!item || !item.name) {
    if (slotNum >= 36 && slotNum <= 44) {
      void selectDetailHotbar(slotNum - 36);
      document.querySelectorAll?.('#detailHotbar .inventory-slot')?.forEach?.(function(el, idx) {
        el.classList?.toggle('selected', idx === (slotNum - 36));
      });
    }
    return;
  }

  selectedDetailMoveSlot = { kind: 'slot', slot: slotNum, item };
  updateDetailTouchHint();
}

async function handleDetailEquipmentClick(dest) {
  if (typeof isDetailBotOfflineOrStopped === 'function' && isDetailBotOfflineOrStopped(detailBot)) {
    cancelDetailSlotSelection();
    return;
  }
  if (selectedDetailMoveSlot && selectedDetailMoveSlot.kind === 'slot') {
    const sourceSlot = Number(selectedDetailMoveSlot.slot);
    cancelDetailSlotSelection();
    await equipDetailItem(sourceSlot, dest);
    return;
  }
  if (selectedDetailMoveSlot && selectedDetailMoveSlot.kind === 'equip' && selectedDetailMoveSlot.dest === dest) {
    cancelDetailSlotSelection();
    return;
  }
  const armor = detailInventory?.armor || {};
  const slots = detailInventory?.slots || {};
  const equipItem = dest === 'off-hand' ? (slots['45'] || null) : (armor[dest] || null);
  if (!equipItem || !equipItem.name) {
    showToast('Hãy chọn 1 vật phẩm trong kho đồ trước, rồi bấm vào ô này để mặc / lắp tay phụ.', 'info');
    return;
  }
  selectedDetailMoveSlot = { kind: 'equip', dest, item: equipItem };
  updateDetailTouchHint();
}

async function handleDetailDropZoneClick() {
  if (typeof isDetailBotOfflineOrStopped === 'function' && isDetailBotOfflineOrStopped(detailBot)) {
    cancelDetailSlotSelection();
    return;
  }
  if (!selectedDetailMoveSlot) {
    showToast('Hãy bấm chọn 1 vật phẩm trong kho đồ trước, rồi bấm vào đây để vứt ra ngoài.', 'info');
    return;
  }
  if (selectedDetailMoveSlot.kind === 'equip') {
    const dest = selectedDetailMoveSlot.dest;
    cancelDetailSlotSelection();
    await unequipDetail(dest);
    return;
  }
  const sourceSlot = Number(selectedDetailMoveSlot.slot);
  cancelDetailSlotSelection();
  if (typeof dropDetailSlotDirect === 'function') {
    await dropDetailSlotDirect(sourceSlot);
  }
}

function getMinecraftItemIconUrl(itemName) {
  if (!itemName || typeof itemName !== 'string') return '';
  const clean = itemName.toLowerCase().replace(/^minecraft:/, '').trim();
  return 'https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.20.1/assets/minecraft/textures/item/' + encodeURIComponent(clean) + '.png';
}

function handleItemIconError(img, itemName) {
  if (!img) return;
  const clean = String(itemName || '').toLowerCase().replace(/^minecraft:/, '').trim();
  if (!img.dataset.triedBlock) {
    img.dataset.triedBlock = 'true';
    img.src = 'https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.20.1/assets/minecraft/textures/block/' + encodeURIComponent(clean) + '.png';
  } else {
    img.style.display = 'none';
  }
}

function createDetailSlot(item,slot,selected) {
  const el=document.createElement('div');
  el.className='inventory-slot'+(selected?' selected':'')+(!item?' empty':'');
  el.draggable=!!item;
  if (!el.dataset) el.dataset = {};
  el.dataset.slot=String(slot);
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  const safeName = item ? itemLabel(item) : '(Trống)';
  const countStr = item && Number(item.count || 0) > 1 ? ' x' + item.count : '';
  el.setAttribute('aria-label', 'Ô GUI #' + slot + ': ' + safeName + countStr);
  if (item && item.name) {
    el.setAttribute('title', safeName + countStr);
  }
  el.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleDetailSlotClick(slot, item, e);
    }
  });
  el.ondragstart=function(e){detailDragged={type:'slot',slot};try{e.dataTransfer.setData('text/plain',String(slot));e.dataTransfer.effectAllowed='move';}catch(_) {}};
  el.ondragover=allowDrop;
  el.ondragleave=clearDragOver;
  el.ondrop=function(e){dropDetailInventory(e,slot);};
  el.onclick=function(e){handleDetailSlotClick(slot,item,e);};
  const idx=document.createElement('div');idx.className='slot-index';idx.textContent=slot>=36?String(slot-35):String(slot-8);
  el.appendChild(idx);

  if (item && item.name && typeof getMinecraftItemIconUrl === 'function') {
    const img = document.createElement('img');
    img.className = 'slot-icon-img';
    img.alt = itemLabel(item);
    img.loading = 'lazy';
    const cdnUrl = getMinecraftItemIconUrl(item.name);
    if (img.dataset) img.dataset.cdnSrc = cdnUrl;
    else img.setAttribute?.('data-cdn-src', cdnUrl);
    img.src = cdnUrl;
    img.onerror = function() {
      if (typeof handleItemIconError === 'function') handleItemIconError(this, item.name);
    };
    el.appendChild(img);
  }

  const name=document.createElement('div');name.className='slot-name';name.textContent=itemLabel(item);
  const count=document.createElement('div');count.className='slot-count';count.textContent=item&&Number(item.count||0)>1?String(item.count):'';
  el.appendChild(name);el.appendChild(count);return el;
}
