'use strict';

const MAINTENANCE_SETTING_KEY = 'system_maintenance';
const DEFAULT_MAINTENANCE_MESSAGE =
  'Hệ thống đang bảo trì nâng cấp máy chủ. Tạm khóa thao tác điều khiển worker, vui lòng quay lại sau.';

function normalizeMaintenanceState(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const cleanedMsg = String(obj.message || '').trim().slice(0, 600);
  return {
    enabled: Boolean(obj.enabled),
    message: cleanedMsg || DEFAULT_MAINTENANCE_MESSAGE,
    updatedAt: obj.updatedAt ? String(obj.updatedAt) : null,
    updatedBy: obj.updatedBy ? String(obj.updatedBy) : null
  };
}

async function getMaintenanceState(store) {
  if (store && store.cachedMaintenance !== undefined) {
    return normalizeMaintenanceState(store.cachedMaintenance);
  }
  if (typeof store?.getSetting === 'function') {
    const raw = await Promise.resolve(store.getSetting(MAINTENANCE_SETTING_KEY)).catch(() => null);
    const normalized = normalizeMaintenanceState(raw);
    if (store && typeof store === 'object') {
      store.cachedMaintenance = normalized;
    }
    return normalized;
  }
  return normalizeMaintenanceState(null);
}

async function setMaintenanceState(store, patch = {}, actor = 'admin') {
  const current = await getMaintenanceState(store);
  const patchObj = patch && typeof patch === 'object' ? patch : {};
  const enabled = patchObj.enabled !== undefined ? Boolean(patchObj.enabled) : current.enabled;
  const rawMessage = patchObj.message !== undefined
    ? String(patchObj.message || '').trim().slice(0, 600)
    : current.message;
  const next = normalizeMaintenanceState({
    enabled,
    message: rawMessage || DEFAULT_MAINTENANCE_MESSAGE,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actor || 'admin').trim().slice(0, 64)
  });
  if (typeof store?.setSetting === 'function') {
    await store.setSetting(MAINTENANCE_SETTING_KEY, next);
  }
  if (store && typeof store === 'object') {
    store.cachedMaintenance = next;
  }
  return next;
}

module.exports = {
  MAINTENANCE_SETTING_KEY,
  DEFAULT_MAINTENANCE_MESSAGE,
  normalizeMaintenanceState,
  getMaintenanceState,
  setMaintenanceState
};
