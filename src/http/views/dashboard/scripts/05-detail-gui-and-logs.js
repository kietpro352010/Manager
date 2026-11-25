function detailStatusHtml() {
  if(!detailBot) return;
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

  const pingVal =
      pingRaw === null ||
      pingRaw === undefined ||
      String(pingRaw).trim() === ''
          ? NaN
          : Number(pingRaw);

  if (pingEl) {
      pingEl.textContent =
          Number.isFinite(pingVal) && pingVal >= 0
              ? pingVal + ' ms'
              : ((!detailBot.available || detailBot.status === 'offline') ? '-- ms (Bot đang tắt)' : '--');
  }

  const tpsEl = document.getElementById('detailTps');

  if (tpsEl) {
      const tpsRaw = detailBot.tps ?? detailBot.serverTps;

      const tpsVal =
          tpsRaw === null ||
          tpsRaw === undefined ||
          String(tpsRaw).trim() === ''
              ? NaN
              : Number(tpsRaw);

      const hasTps = Number.isFinite(tpsVal) && tpsVal >= 0;

      tpsEl.textContent = hasTps
          ? tpsVal.toFixed(1)
          : ((!detailBot.available || detailBot.status === 'offline') ? '-- (Bot đang tắt)' : '--');

      tpsEl.style.color = !hasTps
          ? 'var(--muted)'
          : tpsVal >= 18.5
              ? 'var(--green)'
              : tpsVal >= 14.0
                  ? 'var(--yellow)'
                  : 'var(--red)';
  }
  // 1. Hiển thị tọa độ bot
  const pos = detailBot.position || detailBot.roundedLocation;
  const positionEl = document.getElementById('detailPosition');

  if (positionEl) {
    const validPosition = pos &&
      [pos.x, pos.y, pos.z].every(
        v => v !== null && v !== '' && Number.isFinite(Number(v))
      );

    positionEl.textContent = validPosition
      ? ('X: ' + Math.round(Number(pos.x)) + ', Y: ' + Math.round(Number(pos.y)) + ', Z: ' + Math.round(Number(pos.z)))
      : '--';
  }

  // 2. Hiển thị Dimension và trạng thái vị trí
  const dimensionEl = document.getElementById('detailDimension');

  if (dimensionEl) {
    const locState = String(detailBot.locationState || detailBot.locationKind || '').trim().toLowerCase();
    let placeName = '';
    if (locState === 'login') {
      placeName = 'Login';
    } else if (locState === 'lobby') {
      placeName = 'Sảnh';
    } else {
      let rawDim = detailBot.dimension;
      if (typeof rawDim === 'object' && rawDim !== null) {
        rawDim = rawDim.name || rawDim.effects || rawDim.id || '';
      }
      const dim = String(rawDim || '').trim().replace(/^minecraft:/i, '').toLowerCase();
      if (dim === 'the_nether' || dim === 'nether') {
        placeName = 'Nether';
      } else if (dim === 'the_end' || dim === 'end') {
        placeName = 'The End';
      } else if (dim === 'overworld' || dim === 'world') {
        placeName = 'World';
      } else if (dim) {
        placeName = dim.charAt(0).toUpperCase() + dim.slice(1);
      } else if (locState) {
        placeName = locState.charAt(0).toUpperCase() + locState.slice(1);
      }
    }
    dimensionEl.textContent = placeName || '--';
  }
  const rawDetailIp = String(detailBot.ipAddress || '').trim();
  const isDetailLoopback = rawDetailIp === '127.0.0.1' || rawDetailIp === 'localhost' || rawDetailIp === '0.0.0.0' || rawDetailIp === '::1';
  const detailIpEl = document.getElementById('detailIp');
  if (detailIpEl) {
    detailIpEl.textContent = (isAdmin && !isDetailLoopback && rawDetailIp) ? rawDetailIp : (isAdmin && detailBot.host ? detailBot.host : '-');
  }

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
    if (hw) {
      hostCpuEl.textContent = formatHardwareMetric(hw.cpuPercent) + '% / ' + hw.cpuCores + ' Cores';
      hostCpuEl.style.color = hw.cpuPercent > 85 ? 'var(--red)' : hw.cpuPercent > 60 ? 'var(--yellow)' : '#38bdf8';
    } else {
      hostCpuEl.textContent = '--';
    }
  }

  // 3. Lưu lượng mạng
  const hostNetEl = document.getElementById('detailHostNet');
  if (hostNetEl) {
    if (hw) {
      hostNetEl.textContent = '↓ ' + formatHardwareMetric(hw.netDownKb) + ' KB/s • ↑ ' + formatHardwareMetric(hw.netUpKb) + ' KB/s (Tổng: ' + formatHardwareMetric(hw.netTotalRxMb) + ' MB)';
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
    uptimeEl.textContent = h + 'h ' + m + 'm ' + s + 's';
  }
  const recEl = document.getElementById('detailReconnects');
  if (recEl) {
    recEl.textContent = String(detailBot.reconnectAttempts || detailBot.reconnectCount || 0);
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
  const offlineOrStopped = typeof isDetailBotOfflineOrStopped === 'function' ? isDetailBotOfflineOrStopped(detailBot) : false;
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
  document.getElementById('renewKeyInput').value = '';
  document.getElementById('renewResultBox').style.display = 'none';
  document.getElementById('renewModal').classList.remove('hidden');
}

function closeRenewModal() {
  document.getElementById('renewModal').classList.add('hidden');
}

async function submitRenewKey() {
  const key = document.getElementById('renewKeyInput').value.trim().toUpperCase();
  const box = document.getElementById('renewResultBox');
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
          copyToClipboard(btn.getAttribute('data-key'), 'Mã Key');
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
        days,
        permanent: isPermanent,
        isPermanent,
        setPermanent: isPermanent,
        planName,
        count,
        botCount,
        maxUses,
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
      return '<div role="button" tabindex="0" onclick="clickDetailGuiSlot(' + idx + ')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();clickDetailGuiSlot(' + idx + ');}" aria-label="Ô GUI #' + idx + ': (Trống)" style="aspect-ratio:1;min-width:0;overflow:hidden;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.12);border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:10px;font-family:monospace;transition:border-color 0.15s ease,background 0.15s ease;" onmouseenter="this.style.borderColor=\'rgba(56,189,248,0.4)\';this.style.background=\'rgba(56,189,248,0.06)\'" onmouseleave="this.style.borderColor=\'rgba(255,255,255,0.12)\';this.style.background=\'rgba(255,255,255,0.03)\'" title="Ô #' + idx + ' (Trống - Bấm để click)">' +
        '<span style="opacity:0.4;font-size:9.5px;">#' + idx + '</span>' +
        '</div>';
    }
    const tex = resolveItemTexture(item);
    const safeName = escapeHtml(tex.label);
    const cdnRel = (tex.secondary || '').startsWith('/textures/') ? tex.secondary.slice(10) : ('item/' + String(item.name || 'stone').replace(/^minecraft:/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '') + '.png');
    const cdnSrc = 'https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.20.1/assets/minecraft/textures/' + cdnRel;
    const initials = (typeof getItemInitials === 'function') ? getItemInitials(tex.label) : (tex.label ? tex.label.slice(0, 2).toUpperCase() : 'IT');
    const ariaLabel = 'Ô GUI #' + idx + ': ' + safeName + (tex.count > 1 ? ' x' + tex.count : '');
    return '<div role="button" tabindex="0" onclick="clickDetailGuiSlot(' + idx + ')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();clickDetailGuiSlot(' + idx + ');}" aria-label="' + escapeHtml(ariaLabel) + '" style="aspect-ratio:1;min-width:0;overflow:hidden;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.3);border-radius:6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;padding:2px;text-align:center;box-shadow:var(--shadow-sm);transition:transform 0.15s ease,border-color 0.15s ease;" onmouseenter="this.style.transform=\'scale(1.05)\';this.style.borderColor=\'#38bdf8\'" onmouseleave="this.style.transform=\'none\';this.style.borderColor=\'rgba(56,189,248,0.3)\'" title="Ô #' + idx + ': ' + safeName + ' (Click để chọn)">' +
      '<img src="' + escapeHtml(tex.primary) + '" data-fallback-stage="primary" data-secondary-src="' + escapeHtml(tex.secondary) + '" data-tertiary-src="' + escapeHtml(tex.tertiary || tex.secondary) + '" data-cdn-src="' + escapeHtml(cdnSrc) + '" data-initials="' + escapeHtml(initials) + '" onerror="handleItemTextureError(this)" style="width:28px;height:28px;object-fit:contain;image-rendering:pixelated;" alt="' + safeName + '">' +
      '<span class="slot-text-name" style="font-size:9px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;line-height:1.1;max-width:100%;word-break:break-word;margin-top:1px;">' + safeName + '</span>' +
      (tex.count > 1 ? '<span style="position:absolute;bottom:2px;right:2px;font-size:9.5px;font-weight:800;background:var(--bg-elevated);border:1px solid var(--border-strong);padding:0 4px;border-radius:4px;color:var(--accent-text);">x' + tex.count + '</span>' : '') +
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
  try {
    const res = await requestJson('/api/manager/bot/' + selectedBotId + '/window/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, mouseButton: 0 }),
      timeoutMs: 8000
    });
    if (!res.ok) {
      showToast(res.data?.error || 'Lỗi click GUI', 'error');
    } else {
      showToast('Đã click ô ' + slot, 'success');
      await refreshDetail(true);
    }
  } catch(e) {
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
  if (!isoString) return { expired: false, text: 'Vĩnh viễn', color: 'var(--green)' };
  const expTime = Date.parse(isoString);
  if (isNaN(expTime)) return { expired: false, text: 'Không xác định', color: 'var(--muted)' };
  const diffMs = expTime - Date.now();
  if (diffMs <= 0) {
    return { expired: true, text: 'ĐÃ HẾT HẠN', color: 'var(--red)' };
  }
  const totalHours = Math.floor(diffMs / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  let text = '';
  if (days > 0) {
    text = 'Còn ' + days + ' ngày ' + hours + ' giờ ' + minutes + ' phút';
  } else if (hours > 0) {
    text = 'Còn ' + hours + ' giờ ' + minutes + ' phút';
  } else {
    text = 'Còn ' + minutes + ' phút';
  }
  let color = 'var(--green)';
  if (days < 1) color = 'var(--red)';
  else if (days < 3) color = 'var(--yellow)';
  return { expired: false, text: text, color: color };
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
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '8px';
    badge.style.fontSize = '12px';
    badge.style.padding = '4px 10px';
    badge.style.borderRadius = '20px';
    badge.style.marginRight = '8px';
    const roleBadge = headerContainer.querySelector('#globalUserRoleBadge');
    headerContainer.insertBefore(badge, roleBadge || headerContainer.firstChild);
  }
  const setBadgeStyle = (bg, color, border, html) => {
    if (!badge) return;
    badge.style.display = 'inline-flex';
    badge.style.background = bg;
    badge.style.color = color;
    badge.style.border = border;
    badge.innerHTML = html;
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
    setBadgeStyle(
      'rgba(16,185,129,0.15)',
      'var(--green)',
      '1px solid rgba(16,185,129,0.3)',
      '<span>👑 Hạn thuê: <b>VIP Vĩnh Viễn</b></span>'
    );

    if (banner) {
      if (bannerIcon) bannerIcon.textContent = '👑';
      if (bannerExactTime) bannerExactTime.textContent = 'Vĩnh Viễn';
      if (bannerCountdown) {
        bannerCountdown.textContent = 'Không giới hạn thời gian';
        bannerCountdown.style.color = 'var(--green)';
      }
      banner.style.background = 'rgba(16,185,129,0.1)';
      banner.style.borderColor = 'rgba(16,185,129,0.3)';
    }
    return;
  }

  if (!currentUser.expiresAt) {
    setBadgeStyle(
      'rgba(148,163,184,0.15)',
      '#cbd5e1',
      '1px solid rgba(148,163,184,0.35)',
      '<span>⚪ <b>Chưa kích hoạt gói</b></span><button class="small primary" onclick="openRenewModal()" style="margin-left:6px;">🔑 Nhập Key kích hoạt</button>'
    );

    if (banner) {
      if (bannerIcon) bannerIcon.textContent = '🔑';
      if (bannerExactTime) bannerExactTime.textContent = 'Chưa kích hoạt';
      if (bannerCountdown) {
        bannerCountdown.textContent = 'Nhập mã Key để kích hoạt gói thuê bot';
        bannerCountdown.style.color = '#cbd5e1';
      }
      banner.style.background = 'rgba(30,41,59,0.65)';
      banner.style.borderColor = 'rgba(148,163,184,0.35)';
    }
    return;
  }

  const exactFormatted = formatFullDateTime(currentUser.expiresAt);
  const countdown = formatRentalCountdown(currentUser.expiresAt);
  const userExp = (typeof getUserExpirationInfo === 'function') ? getUserExpirationInfo() : { isExpired: false };

  if (countdown.expired || userExp.isExpired) {
    if (userExp.inGracePeriod) {
      const remainingMin = Math.max(1, Math.round(userExp.remainingGraceMs / 60000));
      const hours = Math.floor(remainingMin / 60);
      const mins = remainingMin % 60;
      const graceText = (hours > 0 ? (hours + 'h ') : '') + mins + 'm';

      setBadgeStyle(
        'rgba(245,158,11,0.2)',
        '#fbbf24',
        '1px solid rgba(245,158,11,0.45)',
        '<span>⏳ Hạn thuê: <b>ĐANG ÂN HẠN 6H (còn ' + graceText + ')</b></span><button class="small primary" onclick="openRenewModal()" style="margin-left:4px;">🎁 Gia Hạn Ngay</button>'
      );

      if (banner) {
        if (bannerIcon) bannerIcon.textContent = '⏳';
        if (bannerExactTime) bannerExactTime.textContent = exactFormatted;
        if (bannerCountdown) {
          bannerCountdown.textContent = 'ĐANG ÂN HẠN 6H (Bot vẫn chạy, còn ' + graceText + ')';
          bannerCountdown.style.color = '#fbbf24';
        }
        banner.style.background = 'rgba(245,158,11,0.15)';
        banner.style.borderColor = 'rgba(245,158,11,0.4)';
      }
      return;
    }

    setBadgeStyle(
      'rgba(239,68,68,0.2)',
      'var(--red)',
      '1px solid rgba(239,68,68,0.4)',
      '<span>⚠️ Hạn thuê: <b>ĐÃ HẾT HẠN (' + exactFormatted + ')</b></span><button class="small primary" onclick="openRenewModal()" style="margin-left:4px;">🎁 Gia Hạn Ngay</button>'
    );

    if (banner) {
      if (bannerIcon) bannerIcon.textContent = '⛔';
      if (bannerExactTime) bannerExactTime.textContent = exactFormatted;
      if (bannerCountdown) {
        bannerCountdown.textContent = 'ĐÃ HẾT HẠN (Bot dừng an toàn sau 6h ân hạn)';
        bannerCountdown.style.color = 'var(--red)';
      }
      banner.style.background = 'rgba(239,68,68,0.15)';
      banner.style.borderColor = 'rgba(239,68,68,0.4)';
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
    if (bannerCountdown) {
      bannerCountdown.textContent = countdown.text;
      bannerCountdown.style.color = countdown.color;
    }
    banner.style.background = 'rgba(30,41,59,0.7)';
    banner.style.borderColor = 'rgba(59,130,246,0.35)';
  }
}
window.formatFullDateTime = formatFullDateTime;
window.formatRentalCountdown = formatRentalCountdown;
window.updateUserHeaderCountdown = updateUserHeaderCountdown;

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
    } catch(err) {
      if(!isCurrentRequest()) return;
      if(err && (err.status===403 || err.status===401 || err.status===404)){
        showToast(err.data?.error || (err.status===404 ? 'Bot này không còn tồn tại trong Manager.' : 'Bạn không có quyền quản lý bot này.'), 'warning', 4000);
        goHome();
        return;
      }
      if(
        err &&
        err.status===503 &&
        err.data &&
        err.data.label
      ) {
        detailBot=err.data;
        uptimeSyncAt=Date.now();
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

function nearBottom(box){return !!(box && (box.scrollHeight-box.scrollTop-box.clientHeight<24));}

function formatDetailLogEntryText(entry, includeTypeTag = false) {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return '';
  const msg = String(entry.message || entry.reason || entry.text || entry.line || '').trim();
  if (!msg) return '';
  let timePrefix = '';
  const rawTs = entry.occurredAt || entry.timestamp || entry.createdAt;
  if (rawTs && !/^\d{2}:\d{2}:\d{2}\b/.test(msg)) {
    const d = new Date(rawTs);
    if (!Number.isNaN(d.getTime())) {
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      timePrefix = hh + ':' + mm + ':' + ss;
    }
  }
  const typeTag = includeTypeTag && entry.type && !msg.startsWith('[')
    ? '[' + String(entry.type).trim() + ']'
    : '';
  return [timePrefix, typeTag, msg].filter(Boolean).join(' ');
}

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
    function formatLogLineHtml(entry) {
      const line = formatDetailLogEntryText(entry, true);
      if (!line) return '';

      let timeText = '--:--:--';
      let rest = line;
      const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2})\s+(.*)$/);
      if (timeMatch) {
        timeText = timeMatch[1];
        rest = timeMatch[2];
      }

      const isAdminUser = Boolean(currentUser && currentUser.role === 'admin');
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
        connecting: 'KẾT NỐI',
        spawn: 'VÀO SẢNH',
        online: 'VÀO GAME',
        kicked: 'NGẮT KẾT NỐI',
        stopped: 'ĐÃ DỪNG',
        host_switch: 'ĐỔI MÁY CHỦ',
        window_open: 'MỞ MENU',
        window_close: 'ĐÓNG MENU',
        window_click: 'CLICK MENU',
        respawn: 'HỒI SINH',
        totem_popped: 'DÙNG TOTEM',
        connection_error: 'LỖI KẾT NỐI',
        credentials_missing: 'THIẾU TÀI KHOẢN',
        reconnect_exhausted: 'DỪNG THỬ LẠI',
        afk_kicked: 'VĂNG AFK',
        afk_recovered: 'VÀO LẠI AFK',
        maintenance_window: 'BẢO TRÌ',
        bot_death: 'HẠ GỤC',
        auth_failed: 'ĐĂNG NHẬP',
        invalid_proxy: 'PROXY',
        worker_event: 'HỆ THỐNG'
      };
      const lowerTag = rawTag.toLowerCase();
      const mappedPill = tagLabelMap[lowerTag] || '';

      const lower = (rawTag + ' ' + bodyText).toLowerCase();
      let kind = 'info';
      let pillLabel = mappedPill || (rawTag ? rawTag.slice(0, 14).toUpperCase() : 'HỆ THỐNG');
      if (lower.includes('lỗi') || lower.includes('error') || lower.includes('❌') || lower.includes('disconnect') || lower.includes('kicked') || lower.includes('ngắt kết nối')) {
        kind = 'error';
        if (!rawTag && !mappedPill) pillLabel = 'LỖI';
      } else if (lower.includes('cảnh báo') || lower.includes('warn') || lower.includes('⚠') || lower.includes('phản hồi chậm')) {
        kind = 'warn';
        if (!rawTag && !mappedPill) pillLabel = 'CẢNH BÁO';
      } else if (lower.includes('totem') || lower.includes('vào cụm') || lower.includes('flow') || lower.includes('gui') || lower.includes('menu') || lower.includes('🎯')) {
        kind = 'flow';
        if (!rawTag && !mappedPill) pillLabel = 'LUỒNG';
      } else if (lower.includes('thành công') || lower.includes('connected') || lower.includes('spawn') || lower.includes('✅') || lower.includes('🎉') || lower.includes('bình thường')) {
        kind = 'success';
        if (!rawTag && !mappedPill) pillLabel = 'HOÀN TẤT';
      } else if (lower.includes('chat') || lower.includes('tin nhắn')) {
        kind = 'chat';
        if (!rawTag && !mappedPill) pillLabel = 'CHAT';
      }

      return '<div class="log-row log-row-' + kind + '">' +
        '<span class="log-time">' + escapeHtml(timeText) + '</span>' +
        '<span class="log-pill log-pill-' + kind + '">' + escapeHtml(pillLabel) + '</span>' +
        '<span class="log-body">' + escapeHtml(bodyText) + '</span>' +
      '</div>';
    }
    const lines = Array.isArray(data?.logs) ? data.logs : [];
    const countEl = document.getElementById('detailEventCount');
    if (countEl) countEl.textContent = lines.length + ' sự kiện';
    const newHtml = lines.length > 0
      ? lines.map(formatLogLineHtml).join('')
      : '<div class="log-empty">Chưa có nhật ký sự kiện nào.</div>';
    if (box && box.innerHTML !== newHtml) {
      box.innerHTML = newHtml;
    }
    lastEventRevision = (currentBotRev !== null && Number.isFinite(currentBotRev))
      ? currentBotRev
      : Number(data.revision || 0);
    if(keep && box) box.scrollTop=box.scrollHeight;
  } finally {
    if(reqToken === eventLoadingToken) eventLoading=false;
  }
}

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
    function formatChatLineHtml(entry) {
      const line = formatDetailLogEntryText(entry, false);
      if (!line) return '';
      let cls = 'chat-row-item';
      const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2})\s*(.*)$/);
      const timePart = timeMatch ? timeMatch[1] : '--:--:--';
      const rest = timeMatch ? timeMatch[2] : line;

      let bodyHtml = '';
      // 1. Tin nhắn lệnh / outgoing do bot gửi: "→ /menu"
      if (rest.startsWith('→') || rest.includes('→ /')) {
        cls += ' chat-row-outgoing';
        const cleanCmd = rest.replace(/^→\s*/, '');
        bodyHtml = '<span class="chat-dir-pill">BOT →</span><code class="chat-cmd-text">' + escapeHtml(cleanCmd) + '</code>';
      }
      // 2. Tin nhắn Role | Player: "VIP | Alex: hello" hoặc "[VIP] Alex: hello"
      else if (/^\[?([^\]|]+)[\]|]\s*([A-Za-z0-9_]{1,16})\s*[:»]\s*(.+)$/u.test(rest)) {
        const m = rest.match(/^\[?([^\]|]+)[\]|]\s*([A-Za-z0-9_]{1,16})\s*[:»]\s*(.+)$/u);
        const role = m[1].trim();
        const user = m[2].trim();
        const msg = m[3].trim();
        bodyHtml = '<span class="chat-badge">' + escapeHtml(role) + '</span>' +
                   '<span class="chat-sender">' + escapeHtml(user) + ':</span> ' +
                   '<span class="chat-text">' + escapeHtml(msg) + '</span>';
      }
      // 3. Tin nhắn người chơi chuẩn vanilla: "<Player> hello"
      else if (/^<([A-Za-z0-9_]{1,16})>\s*(.+)$/u.test(rest)) {
        const m = rest.match(/^<([A-Za-z0-9_]{1,16})>\s*(.+)$/u);
        const user = m[1].trim();
        const msg = m[2].trim();
        bodyHtml = '<span class="chat-sender">' + escapeHtml(user) + ':</span> ' +
                   '<span class="chat-text">' + escapeHtml(msg) + '</span>';
      }
      // 4. Tin nhắn hệ thống server: "[HỆ THỐNG] ..." hoặc "[Server] ..."
      else if (rest.startsWith('[HỆ THỐNG]') || rest.startsWith('[Server]') || rest.startsWith('Server:')) {
        cls += ' chat-row-server';
        const cleanMsg = rest.replace(/^(\[HỆ THỐNG\]|\[Server\]|Server:)\s*/, '');
        bodyHtml = '<span class="chat-server-badge">HỆ THỐNG</span>' +
                   '<span class="chat-server-text">' + escapeHtml(cleanMsg) + '</span>';
      }
      // 5. Mặc định
      else {
        bodyHtml = '<span class="chat-text">' + escapeHtml(rest) + '</span>';
      }

      return '<div class="' + cls + '">' +
        '<span class="log-time">' + escapeHtml(timePart) + '</span>' +
        '<div class="chat-body">' + bodyHtml + '</div>' +
      '</div>';
    }
    const lines = Array.isArray(data?.logs) ? data.logs : [];
    const countEl = document.getElementById('detailChatCount');
    if (countEl) countEl.textContent = lines.length + ' tin';
    const newHtml = lines.length > 0
      ? lines.map(formatChatLineHtml).join('')
      : '<div class="log-empty">Chưa có tin nhắn chat nào.</div>';
    if (box && box.innerHTML !== newHtml) {
      box.innerHTML = newHtml;
    }
    lastChatRevision = (currentChatRev !== null && Number.isFinite(currentChatRev))
      ? currentChatRev
      : Number(data.revision || 0);
    if(keep && box) box.scrollTop=box.scrollHeight;
  } finally {
    if(reqToken === chatLoadingToken) chatLoading=false;
  }
}

async function loadDetailPositionHistory(force=false, expectedGeneration=detailRefreshGeneration, expectedBotId=selectedBotId) {
  const box=document.getElementById('detailPositionHistory');
  if(!box) return;
  if(!currentUser || (expectedGeneration!==null && (expectedGeneration!==detailRefreshGeneration || expectedBotId!==selectedBotId))) return;
  // Endpoint /position-logs là stub in-memory; không poll mạng thừa.
  lastPositionHistoryFetchedAt=Date.now();
  box.textContent='Theo dõi tọa độ trực tiếp ở bảng Trạng thái hiện tại (endpoint lịch sử tọa độ không khả dụng).';
}

function itemLabel(item) {
  if(!item) return '-';
  const name=item.displayName||item.name||'-';
  const count=Number(item.count||0);
  return String(name).replace(/_/g,' ')+(count>1?' x'+count:'');
}

let selectedDetailMoveSlot = null;

function updateDetailTouchHint() {
  const hintEl = document.getElementById('detailTouchHint');
  if (hintEl) hintEl.remove();
}

function cancelDetailSlotSelection(e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  selectedDetailMoveSlot = null;
  document.querySelectorAll('#detailPage .inventory-slot.selected-for-move, #detailPage .equipment-slot.selected-for-move').forEach(function(el) {
    el.classList.remove('selected-for-move');
  });
  const hintEl = document.getElementById('detailTouchHint');
  if (hintEl) hintEl.remove();
}

function handleDetailSlotClick(slot, item, e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  // Chọn các item hoặc ô trống ở hot bar (slots 36-44, tương ứng hotbar 0-8) thì lập tức chuyển tay sang ô đó
  if (slot >= 36 && slot <= 44) {
    const hotbarIndex = slot - 36;
    void selectDetailHotbar(hotbarIndex);
    document.querySelectorAll('#detailHotbar .inventory-slot').forEach(function(el, idx) {
      el.classList.toggle('selected', idx === hotbarIndex);
    });
    return;
  }
}

function handleDetailEquipmentClick(dest) {
  // Thao tác trang bị được thực hiện bằng cách Kéo - Thả vào ô trang bị
}

async function handleDetailDropZoneClick() {
  // Thao tác vứt đồ được thực hiện bằng cách Kéo - Thả vào ô vứt đồ
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
