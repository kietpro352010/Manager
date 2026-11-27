'use strict';

const MAINTENANCE_SETTING_KEY = 'system_maintenance';
const MAINTENANCE_CACHE_TTL_MS = 30000;
const DEFAULT_GRACE_PERIOD_MS = 6 * 3600 * 1000;
const DEFAULT_MAINTENANCE_MESSAGE =
  'Hệ thống đang bảo trì nâng cấp máy chủ. Tạm khóa thao tác điều khiển worker, vui lòng quay lại sau.';

let localMaintenanceChain = Promise.resolve();

function runWithLocalMaintenanceLock(fn) {
  const next = localMaintenanceChain.then(fn, fn);
  localMaintenanceChain = next.catch(() => {});
  return next;
}

function isMissingLockRpcError(err) {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || '').toLowerCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('does not exist') ||
    (msg.includes('acquire_manager_lock') && msg.includes('http 404'))
  );
}

async function withMaintenanceLock(store, fn) {
  const canUseCloudLock = typeof store?.adapter?.withManagerLock === 'function' &&
    (typeof store.adapter.isEnabled !== 'function' || store.adapter.isEnabled());
  if (!canUseCloudLock) {
    return runWithLocalMaintenanceLock(fn);
  }
  let fnStarted = false;
  try {
    return await store.adapter.withManagerLock('system_maintenance_toggle', async () => {
      fnStarted = true;
      return fn();
    }, 30);
  } catch (err) {
    if (!fnStarted && isMissingLockRpcError(err)) {
      return runWithLocalMaintenanceLock(fn);
    }
    throw err;
  }
}

function normalizeMaintenanceState(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const cleanedMsg = String(obj.message || '').trim().slice(0, 600);
  const rawCompMs = Number(obj.lastCompensationMs);
  const rawCompUsers = Number(obj.compensatedUsers);
  const partialCompensatedIds = Array.isArray(obj.partialCompensatedIds)
    ? [...new Set(obj.partialCompensatedIds.map((id) => String(id || '').trim()).filter(Boolean))]
    : [];
  return {
    enabled: Boolean(obj.enabled),
    message: cleanedMsg || DEFAULT_MAINTENANCE_MESSAGE,
    startedAt: obj.startedAt ? String(obj.startedAt) : null,
    lastCompensatedAt: obj.lastCompensatedAt ? String(obj.lastCompensatedAt) : null,
    lastCompensationMs: Number.isFinite(rawCompMs) && rawCompMs >= 0 ? Math.round(rawCompMs) : 0,
    compensatedUsers: Number.isFinite(rawCompUsers) && rawCompUsers >= 0 ? Math.round(rawCompUsers) : 0,
    partialAnchorIso: obj.partialAnchorIso ? String(obj.partialAnchorIso) : null,
    partialCompensatedIds,
    updatedAt: obj.updatedAt ? String(obj.updatedAt) : null,
    updatedBy: obj.updatedBy ? String(obj.updatedBy) : null
  };
}

function sanitizeMaintenanceForSession(maintenance, session = null) {
  if (!maintenance || typeof maintenance !== 'object') return null;
  const normalized = normalizeMaintenanceState(maintenance);
  if (session && session.role === 'admin') {
    return normalized;
  }
  return {
    enabled: Boolean(normalized.enabled),
    message: normalized.message,
    startedAt: normalized.startedAt,
    lastCompensatedAt: normalized.lastCompensatedAt,
    lastCompensationMs: normalized.lastCompensationMs,
    updatedAt: normalized.updatedAt
  };
}

function resolveMaintenanceAnchorMs(maintenance) {
  if (!maintenance || typeof maintenance !== 'object') return NaN;
  const rawAnchor = maintenance.lastCompensatedAt || maintenance.startedAt || maintenance.updatedAt || '';
  return rawAnchor ? Date.parse(String(rawAnchor)) : NaN;
}

function computeEffectiveExpiresAt(rawExpiresAt, maintenance, nowMs = Date.now()) {
  if (!rawExpiresAt || !maintenance?.enabled) return rawExpiresAt;
  const anchorMs = resolveMaintenanceAnchorMs(maintenance);
  const expMs = Date.parse(String(rawExpiresAt));
  if (
    Number.isFinite(anchorMs) &&
    Number.isFinite(expMs) &&
    Number.isFinite(nowMs) &&
    nowMs > anchorMs &&
    expMs > anchorMs
  ) {
    return new Date(expMs + (nowMs - anchorMs)).toISOString();
  }
  return rawExpiresAt;
}

async function getMaintenanceState(store) {
  const cacheFresh = store && store.cachedMaintenance !== undefined && (
    !store.cachedMaintenanceAt || (Date.now() - Number(store.cachedMaintenanceAt) < MAINTENANCE_CACHE_TTL_MS)
  );
  if (cacheFresh) {
    return normalizeMaintenanceState(store.cachedMaintenance);
  }
  if (typeof store?.getSetting === 'function') {
    const raw = await Promise.resolve(store.getSetting(MAINTENANCE_SETTING_KEY)).catch(() => null);
    const normalized = normalizeMaintenanceState(raw);
    if (store && typeof store === 'object') {
      store.cachedMaintenance = normalized;
      store.cachedMaintenanceAt = Date.now();
    }
    return normalized;
  }
  return normalizeMaintenanceState(null);
}

async function persistMaintenanceRecord(store, nextRecord) {
  if (typeof store?.setSetting === 'function') {
    await store.setSetting(MAINTENANCE_SETTING_KEY, nextRecord);
  }
  store?.invalidateCache?.();
  if (store && typeof store === 'object') {
    store.cachedMaintenance = nextRecord;
    store.cachedMaintenanceAt = Date.now();
  }
  return nextRecord;
}

async function flushMaintenanceCompensation(
  store,
  {
    toMs = Date.now(),
    gracePeriodMs = DEFAULT_GRACE_PERIOD_MS,
    turnOff = false,
    nextMessage,
    actor = 'admin',
    logger = null,
    _patchEnabled = undefined,
    _fromSetState = false,
    _flushCheckpoint = false
  } = {}
) {
  return withMaintenanceLock(store, async () => {
    const safeToMs = Number.isFinite(Number(toMs)) ? Number(toMs) : Date.now();
    const nowIso = new Date(safeToMs).toISOString();
    const safeGraceMs = Number.isFinite(Number(gracePeriodMs)) && Number(gracePeriodMs) >= 0
      ? Number(gracePeriodMs)
      : DEFAULT_GRACE_PERIOD_MS;
    const cleanActor = String(actor || 'admin').trim().slice(0, 64) || 'admin';

    let rawCurrent = null;
    if (typeof store?.getSetting === 'function') {
      rawCurrent = await Promise.resolve(store.getSetting(MAINTENANCE_SETTING_KEY, { bypassCache: true }))
        .catch(() => (store?.cachedMaintenance !== undefined ? store.cachedMaintenance : null));
    } else if (store?.cachedMaintenance !== undefined) {
      rawCurrent = store.cachedMaintenance;
    }
    const current = normalizeMaintenanceState(rawCurrent);
    const resolvedMessage = nextMessage !== undefined
      ? (String(nextMessage || '').trim().slice(0, 600) || DEFAULT_MAINTENANCE_MESSAGE)
      : current.message;

    const desiredEnabled = _patchEnabled !== undefined
      ? Boolean(_patchEnabled)
      : (turnOff ? false : current.enabled);
    const messageOnlyWhenEnabled = Boolean(_fromSetState && current.enabled && desiredEnabled && !_flushCheckpoint);

    // 1. false -> false: no-op compensation (deltaMs = 0)
    if (!current.enabled && !desiredEnabled) {
      if (!_fromSetState && nextMessage === undefined) {
        return current;
      }
      const next = normalizeMaintenanceState({
        enabled: false,
        message: resolvedMessage,
        startedAt: null,
        lastCompensatedAt: null,
        lastCompensationMs: 0,
        compensatedUsers: 0,
        partialAnchorIso: null,
        partialCompensatedIds: [],
        updatedAt: nowIso,
        updatedBy: cleanActor
      });
      return persistMaintenanceRecord(store, next);
    }

    // 2. false -> true: start maintenance freeze window
    if (!current.enabled && desiredEnabled) {
      const next = normalizeMaintenanceState({
        enabled: true,
        message: resolvedMessage,
        startedAt: nowIso,
        lastCompensatedAt: nowIso,
        lastCompensationMs: 0,
        compensatedUsers: 0,
        partialAnchorIso: null,
        partialCompensatedIds: [],
        updatedAt: nowIso,
        updatedBy: cleanActor
      });
      return persistMaintenanceRecord(store, next);
    }

    // 3. true -> true (message update only): preserve startedAt, lastCompensatedAt & any partial checkpoint
    if (current.enabled && desiredEnabled && messageOnlyWhenEnabled) {
      const next = normalizeMaintenanceState({
        enabled: true,
        message: resolvedMessage,
        startedAt: current.startedAt || nowIso,
        lastCompensatedAt: current.lastCompensatedAt || current.startedAt || current.updatedAt || nowIso,
        lastCompensationMs: current.lastCompensationMs,
        compensatedUsers: current.compensatedUsers,
        partialAnchorIso: current.partialAnchorIso,
        partialCompensatedIds: current.partialCompensatedIds,
        updatedAt: nowIso,
        updatedBy: cleanActor
      });
      return persistMaintenanceRecord(store, next);
    }

    // 4. Checkpoint flush (true -> true) or turn-off (true -> false)
    const effectiveTurnOff = !desiredEnabled || Boolean(turnOff);
    const anchorMs = resolveMaintenanceAnchorMs(current);
    const anchorIso = Number.isFinite(anchorMs) ? new Date(anchorMs).toISOString() : null;
    const deltaMs = Number.isFinite(anchorMs) ? Math.max(0, Math.round(safeToMs - anchorMs)) : 0;
    const alreadyDone = new Set(
      anchorIso && current.partialAnchorIso === anchorIso && Array.isArray(current.partialCompensatedIds)
        ? current.partialCompensatedIds
        : []
    );
    let compensatedUsers = deltaMs > 0 ? alreadyDone.size : 0;
    let failedErr = null;

    if (deltaMs > 0 && typeof store?.listAccess === 'function') {
      store.invalidateCache?.();
      const users = await store.listAccess();
      if (Array.isArray(users)) {
        for (const u of users) {
          if (!u || u.isPermanent) continue;
          const uStatus = String(u.status || '').toLowerCase();
          if (uStatus === 'disabled' || !u.expiresAt) continue;
          const expMs = Date.parse(String(u.expiresAt));
          if (!Number.isFinite(expMs)) continue;
          const isEligible = expMs > anchorMs || (uStatus === 'grace_period' && (expMs + safeGraceMs) > anchorMs);
          if (!isEligible) continue;
          const targetUserId = String(u.userId || u.id || u.username || '').trim();
          if (!targetUserId) continue;
          if (alreadyDone.has(targetUserId)) continue;
          const newExpiresAt = new Date(expMs + deltaMs).toISOString();
          try {
            await store.setAccess(targetUserId, { ...u, expiresAt: newExpiresAt }, 'system:maintenance_compensation');
            alreadyDone.add(targetUserId);
            compensatedUsers += 1;
          } catch (userErr) {
            failedErr = failedErr || userErr;
          }
        }
      }
    }

    if (failedErr) {
      const checkpoint = normalizeMaintenanceState({
        ...current,
        message: resolvedMessage,
        partialAnchorIso: anchorIso,
        partialCompensatedIds: [...alreadyDone],
        updatedAt: nowIso,
        updatedBy: cleanActor
      });
      if (store && typeof store === 'object') {
        store.cachedMaintenance = checkpoint;
        store.cachedMaintenanceAt = Date.now();
      }
      await persistMaintenanceRecord(store, checkpoint);
      throw failedErr;
    }

    const preservedStartedAt = current.startedAt || (anchorIso || nowIso);
    const next = normalizeMaintenanceState({
      enabled: !effectiveTurnOff,
      message: resolvedMessage,
      startedAt: effectiveTurnOff ? null : preservedStartedAt,
      lastCompensatedAt: effectiveTurnOff ? null : nowIso,
      lastCompensationMs: deltaMs,
      compensatedUsers,
      partialAnchorIso: null,
      partialCompensatedIds: [],
      updatedAt: nowIso,
      updatedBy: cleanActor
    });

    await persistMaintenanceRecord(store, next);
    if (deltaMs > 0 || effectiveTurnOff) {
      logger?.info?.('maintenance_compensation_flushed', {
        turnOff: effectiveTurnOff,
        deltaMs,
        compensatedUsers,
        actor: cleanActor
      });
    }
    return next;
  });
}

async function setMaintenanceState(store, patch = {}, actor = 'admin', options = {}) {
  const patchObj = patch && typeof patch === 'object' ? patch : {};
  const opts = options && typeof options === 'object' ? options : {};
  const hasExplicitEnabled = patchObj.enabled !== undefined;
  const hasExplicitMessage = patchObj.message !== undefined;

  return flushMaintenanceCompensation(store, {
    toMs: opts.toMs ?? Date.now(),
    gracePeriodMs: opts.gracePeriodMs,
    turnOff: hasExplicitEnabled ? !Boolean(patchObj.enabled) : false,
    nextMessage: hasExplicitMessage ? patchObj.message : undefined,
    actor,
    logger: opts.logger || null,
    _patchEnabled: hasExplicitEnabled ? Boolean(patchObj.enabled) : undefined,
    _fromSetState: true,
    _flushCheckpoint: Boolean(opts.flushCheckpoint)
  });
}

module.exports = {
  MAINTENANCE_SETTING_KEY,
  DEFAULT_MAINTENANCE_MESSAGE,
  normalizeMaintenanceState,
  sanitizeMaintenanceForSession,
  computeEffectiveExpiresAt,
  flushMaintenanceCompensation,
  getMaintenanceState,
  setMaintenanceState
};
