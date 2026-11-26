'use strict';

const fs = require('node:fs');
const path = require('node:path');
const AsyncKeyLock = require('./async-key-lock');

const DAILY_CHECKIN_POINTS = 10;
const STREAK_MILESTONE_INTERVAL = 7;
const STREAK_MILESTONE_BONUS = 30;
const STREAK_RESTORE_COST = 50;
const MESSAGE_POINTS = 1;
const SETTING_KEY = 'discord_points_v1';
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function toNonNegInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

function getVietnamDateKey(dateOrMs = Date.now()) {
  const raw = dateOrMs instanceof Date ? dateOrMs.getTime() : Number(dateOrMs);
  const ms = Number.isFinite(raw) ? raw : Date.now();
  const vn = new Date(ms + VN_OFFSET_MS);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const d = String(vn.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getPreviousDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || '').trim());
  if (!match) return '';
  const prevMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - DAY_MS;
  const prev = new Date(prevMs);
  const y = prev.getUTCFullYear();
  const m = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const d = String(prev.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getEffectiveStreak(record, todayKey = getVietnamDateKey()) {
  const streak = toNonNegInt(record?.streak, 0);
  const lastDate = String(record?.lastCheckinDate || '').trim();
  if (!streak || !lastDate) return 0;
  if (lastDate === todayKey || lastDate === getPreviousDateKey(todayKey)) {
    return streak;
  }
  return 0;
}

function getDaysUntilNextMilestone(streak) {
  const s = toNonNegInt(streak, 0);
  const rem = s % STREAK_MILESTONE_INTERVAL;
  return rem === 0 ? STREAK_MILESTONE_INTERVAL : (STREAK_MILESTONE_INTERVAL - rem);
}

function buildUpcomingStreakRoadmap(currentStreak = 0, days = 10) {
  const start = toNonNegInt(currentStreak, 0);
  const count = Math.max(1, Math.min(30, toNonNegInt(days, 10) || 10));
  const list = [];
  for (let i = 1; i <= count; i++) {
    const streakDay = start + i;
    const isMilestone = streakDay > 0 && streakDay % STREAK_MILESTONE_INTERVAL === 0;
    const basePoints = DAILY_CHECKIN_POINTS;
    const milestoneBonus = isMilestone ? STREAK_MILESTONE_BONUS : 0;
    list.push({
      streakDay,
      isMilestone,
      basePoints,
      milestoneBonus,
      totalPoints: basePoints + milestoneBonus
    });
  }
  return list;
}

function normalizeRecord(userId, raw = {}) {
  return {
    userId: String(userId),
    username: String(raw?.username || '').slice(0, 64),
    points: toNonNegInt(raw?.points, 0),
    streak: toNonNegInt(raw?.streak, 0),
    longestStreak: toNonNegInt(raw?.longestStreak, 0),
    totalCheckins: toNonNegInt(raw?.totalCheckins, 0),
    totalMessages: toNonNegInt(raw?.totalMessages, 0),
    lastCheckinDate: raw?.lastCheckinDate ? String(raw.lastCheckinDate).slice(0, 10) : null,
    updatedAt: raw?.updatedAt ? String(raw.updatedAt) : null
  };
}

class DiscordPointsService {
  constructor({
    store = null,
    localFilePath = null,
    flushIntervalMs = 15000,
    logger = console,
    nowFn = () => Date.now()
  } = {}) {
    this.store = store || null;
    this.localFilePath = localFilePath ? String(localFilePath) : null;
    this.flushIntervalMs = Math.max(250, Number(flushIntervalMs) || 15000);
    this.logger = logger || console;
    this.nowFn = typeof nowFn === 'function' ? nowFn : () => Date.now();

    this.guilds = new Map();
    this.lock = new AsyncKeyLock();
    this.dirty = false;
    this.revision = 0;
    this.flushTimer = null;
    this.loaded = false;
    this._localDirtyKeys = new Set();
    this._lastSyncMs = 0;
    this._lastRemoteUpdatedAt = null;
  }

  _getGuildMap(guildId, create = false) {
    const gId = String(guildId || '').trim();
    if (!gId) throw new Error('guildId is required');
    let map = this.guilds.get(gId);
    if (!map && create) {
      map = new Map();
      this.guilds.set(gId, map);
    }
    return map || null;
  }

  _getOrCreateRecord(guildMap, userId, username = '') {
    const uId = String(userId || '').trim();
    if (!uId) throw new Error('userId is required');
    let record = guildMap.get(uId);
    if (!record) {
      record = normalizeRecord(uId, { username });
      guildMap.set(uId, record);
    } else if (username) {
      record.username = String(username).slice(0, 64);
    }
    return record;
  }

  _hydrateSnapshot(payload) {
    this.guilds.clear();
    if (!payload || typeof payload !== 'object') return;
    if (payload.updatedAt) this._lastRemoteUpdatedAt = String(payload.updatedAt);
    const rawGuilds = payload.guilds && typeof payload.guilds === 'object' ? payload.guilds : {};
    for (const [gId, users] of Object.entries(rawGuilds)) {
      if (!users || typeof users !== 'object') continue;
      const guildMap = new Map();
      for (const [uId, rawRec] of Object.entries(users)) {
        if (!uId || !rawRec || typeof rawRec !== 'object') continue;
        guildMap.set(String(uId), normalizeRecord(uId, rawRec));
      }
      if (guildMap.size > 0) {
        this.guilds.set(String(gId), guildMap);
      }
    }
  }

  _mergeRemoteSnapshot(payload) {
    if (!payload || typeof payload !== 'object') return;
    const rawGuilds = payload.guilds && typeof payload.guilds === 'object' ? payload.guilds : {};
    for (const [gId, users] of Object.entries(rawGuilds)) {
      if (!users || typeof users !== 'object') continue;
      const guildMap = this._getGuildMap(gId, true);
      for (const [uId, rawRec] of Object.entries(users)) {
        if (!uId || !rawRec || typeof rawRec !== 'object') continue;
        const cleanUserId = String(uId);
        const compositeKey = `${gId}:${cleanUserId}`;
        const remoteRec = normalizeRecord(cleanUserId, rawRec);
        const localRec = guildMap.get(cleanUserId);
        if (!localRec) {
          if (!this._localDirtyKeys.has(compositeKey)) {
            guildMap.set(cleanUserId, remoteRec);
          }
          continue;
        }
        if (this._localDirtyKeys.has(compositeKey)) {
          const localTs = localRec.updatedAt ? Date.parse(localRec.updatedAt) : 0;
          const remoteTs = remoteRec.updatedAt ? Date.parse(remoteRec.updatedAt) : 0;
          if (remoteTs > localTs && (!this._lastRemoteUpdatedAt || remoteRec.updatedAt > this._lastRemoteUpdatedAt)) {
            guildMap.set(cleanUserId, remoteRec);
          }
          continue;
        }
        const localTs = localRec.updatedAt ? Date.parse(localRec.updatedAt) : 0;
        const remoteTs = remoteRec.updatedAt ? Date.parse(remoteRec.updatedAt) : 0;
        if (remoteTs >= localTs) {
          guildMap.set(cleanUserId, remoteRec);
        }
      }
    }
    if (payload.updatedAt) this._lastRemoteUpdatedAt = String(payload.updatedAt);
    this._lastSyncMs = this.nowFn();
  }

  async _refreshIfStale({ force = false } = {}) {
    if (!this.store || typeof this.store.getSetting !== 'function') return false;
    const nowMs = this.nowFn();
    if (!force && (this.dirty || (nowMs - this._lastSyncMs) < 5000)) return false;
    try {
      const remote = await this.store.getSetting(SETTING_KEY, { bypassCache: true });
      if (remote && typeof remote === 'object') {
        this._mergeRemoteSnapshot(remote);
      } else {
        this._lastSyncMs = nowMs;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  _markDirty({ immediate = false, guildId = null, userId = null } = {}) {
    this.dirty = true;
    this.revision += 1;
    if (guildId && userId) {
      this._localDirtyKeys.add(`${guildId}:${userId}`);
    }
    if (!immediate) {
      this.scheduleFlush();
    }
  }

  _serializeSnapshot() {
    const guilds = {};
    for (const [gId, guildMap] of this.guilds.entries()) {
      const users = {};
      for (const [uId, rec] of guildMap.entries()) {
        users[uId] = { ...rec };
      }
      guilds[gId] = users;
    }
    return {
      version: 1,
      updatedAt: new Date(this.nowFn()).toISOString(),
      guilds
    };
  }

  async initialize() {
    return this.lock.run('__init__', async () => {
      let raw = null;
      try {
        if (this.store && typeof this.store.getSetting === 'function') {
          raw = await this.store.getSetting(SETTING_KEY, { bypassCache: true });
        } else if (this.localFilePath) {
          const text = await fs.promises.readFile(this.localFilePath, 'utf8').catch((err) => {
            if (err?.code === 'ENOENT') return null;
            throw err;
          });
          if (text) raw = JSON.parse(text);
        }
      } catch (err) {
        this.logger?.warn?.('discord_points_load_failed', { error: err?.message || String(err) });
      }
      if (raw) {
        this._hydrateSnapshot(raw);
      }
      this._localDirtyKeys.clear();
      this._lastSyncMs = this.nowFn();
      this.loaded = true;
      this.dirty = false;
      return true;
    });
  }

  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch((err) => {
        this.logger?.warn?.('discord_points_flush_failed', { error: err?.message || String(err) });
      });
    }, this.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  async flush({ force = false } = {}) {
    if (!this.dirty && !force) return false;
    return this.lock.run('__persist__', async () => {
      if (!this.dirty && !force) return false;
      const targetRev = this.revision;
      try {
        if (this.store && typeof this.store.getSetting === 'function') {
          const remote = await Promise.resolve(this.store.getSetting(SETTING_KEY, { bypassCache: true })).catch(() => null);
          if (remote && typeof remote === 'object') {
            this._mergeRemoteSnapshot(remote);
          }
        }
        const snapshot = this._serializeSnapshot();
        if (this.store && typeof this.store.setSetting === 'function') {
          await this.store.setSetting(SETTING_KEY, snapshot);
        } else if (this.localFilePath) {
          await fs.promises.mkdir(path.dirname(this.localFilePath), { recursive: true });
          const tmpPath = `${this.localFilePath}.${process.pid}.${Date.now()}.tmp`;
          await fs.promises.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8');
          await fs.promises.rename(tmpPath, this.localFilePath);
        }
        this._lastSyncMs = this.nowFn();
        this._lastRemoteUpdatedAt = snapshot.updatedAt;
        if (this.revision === targetRev) {
          this.dirty = false;
          this._localDirtyKeys.clear();
        } else {
          this.scheduleFlush();
        }
        return true;
      } catch (err) {
        this.logger?.warn?.('discord_points_persist_failed', { error: err?.message || String(err) });
        throw err;
      }
    });
  }

  stop() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async checkin({ guildId, userId, username = '', declineRestore = false }) {
    await this._refreshIfStale();
    return this.lock.run(`guild:${guildId}`, async () => {
      const guildMap = this._getGuildMap(guildId, true);
      const record = this._getOrCreateRecord(guildMap, userId, username);
      const nowMs = this.nowFn();
      const todayKey = getVietnamDateKey(nowMs);
      const yesterdayKey = getPreviousDateKey(todayKey);
      const twoDaysAgoKey = getPreviousDateKey(yesterdayKey);

      if (record.lastCheckinDate === todayKey) {
        const effStreak = getEffectiveStreak(record, todayKey);
        return {
          ok: false,
          alreadyCheckedIn: true,
          todayKey,
          pointsEarned: 0,
          basePoints: 0,
          milestoneBonus: 0,
          isMilestone: false,
          streak: effStreak,
          daysToNextMilestone: getDaysUntilNextMilestone(effStreak),
          roadmap: buildUpcomingStreakRoadmap(effStreak, 10),
          record: { ...record }
        };
      }

      const prevStreak = toNonNegInt(record.streak, 0);
      if (!declineRestore && record.lastCheckinDate === twoDaysAgoKey && prevStreak > 0) {
        const currentPoints = toNonNegInt(record.points, 0);
        return {
          ok: false,
          needsRestoreChoice: true,
          todayKey,
          missedDateKey: yesterdayKey,
          previousStreak: prevStreak,
          restoredStreak: prevStreak + 1,
          restoreCost: STREAK_RESTORE_COST,
          currentPoints,
          canAffordRestore: currentPoints >= STREAK_RESTORE_COST,
          record: { ...record }
        };
      }

      const lostPreviousStreak = Boolean(declineRestore && record.lastCheckinDate === twoDaysAgoKey && prevStreak > 0)
        ? prevStreak
        : 0;
      const newStreak = (!declineRestore && record.lastCheckinDate === yesterdayKey)
        ? prevStreak + 1
        : 1;
      const isMilestone = newStreak > 0 && newStreak % STREAK_MILESTONE_INTERVAL === 0;
      const milestoneBonus = isMilestone ? STREAK_MILESTONE_BONUS : 0;
      const pointsEarned = DAILY_CHECKIN_POINTS + milestoneBonus;

      record.points = toNonNegInt(record.points, 0) + pointsEarned;
      record.streak = newStreak;
      record.longestStreak = Math.max(toNonNegInt(record.longestStreak, 0), newStreak);
      record.totalCheckins += 1;
      record.lastCheckinDate = todayKey;
      record.updatedAt = new Date(nowMs).toISOString();

      this._markDirty({ immediate: true, guildId, userId });
      await this.flush();

      return {
        ok: true,
        alreadyCheckedIn: false,
        todayKey,
        pointsEarned,
        basePoints: DAILY_CHECKIN_POINTS,
        milestoneBonus,
        isMilestone,
        streak: newStreak,
        lostPreviousStreak,
        daysToNextMilestone: getDaysUntilNextMilestone(newStreak),
        roadmap: buildUpcomingStreakRoadmap(newStreak, 10),
        record: { ...record }
      };
    });
  }

  async restoreCheckin({ guildId, userId, username = '' }) {
    await this._refreshIfStale();
    return this.lock.run(`guild:${guildId}`, async () => {
      const guildMap = this._getGuildMap(guildId, true);
      const record = this._getOrCreateRecord(guildMap, userId, username);
      const nowMs = this.nowFn();
      const todayKey = getVietnamDateKey(nowMs);
      const yesterdayKey = getPreviousDateKey(todayKey);
      const twoDaysAgoKey = getPreviousDateKey(yesterdayKey);

      if (record.lastCheckinDate === todayKey) {
        const effStreak = getEffectiveStreak(record, todayKey);
        return {
          ok: false,
          alreadyCheckedIn: true,
          todayKey,
          pointsEarned: 0,
          streak: effStreak,
          daysToNextMilestone: getDaysUntilNextMilestone(effStreak),
          roadmap: buildUpcomingStreakRoadmap(effStreak, 10),
          record: { ...record }
        };
      }

      const prevStreak = toNonNegInt(record.streak, 0);
      if (record.lastCheckinDate !== twoDaysAgoKey || prevStreak <= 0) {
        return {
          ok: false,
          reason: 'expired_window',
          todayKey,
          record: { ...record }
        };
      }

      const beforePoints = toNonNegInt(record.points, 0);
      if (beforePoints < STREAK_RESTORE_COST) {
        return {
          ok: false,
          reason: 'insufficient_points',
          restoreCost: STREAK_RESTORE_COST,
          currentPoints: beforePoints,
          previousStreak: prevStreak,
          todayKey,
          record: { ...record }
        };
      }

      const newStreak = prevStreak + 1;
      record.points = Math.max(0, beforePoints - STREAK_RESTORE_COST);
      record.streak = newStreak;
      record.longestStreak = Math.max(toNonNegInt(record.longestStreak, 0), newStreak);
      record.totalCheckins += 1;
      record.lastCheckinDate = todayKey;
      record.updatedAt = new Date(nowMs).toISOString();

      this._markDirty({ immediate: true, guildId, userId });
      await this.flush();

      return {
        ok: true,
        restored: true,
        todayKey,
        pointsSpent: STREAK_RESTORE_COST,
        pointsEarned: 0,
        streak: newStreak,
        daysToNextMilestone: getDaysUntilNextMilestone(newStreak),
        roadmap: buildUpcomingStreakRoadmap(newStreak, 10),
        record: { ...record }
      };
    });
  }

  async recordMessage({ guildId, userId, username = '' }) {
    await this._refreshIfStale();
    return this.lock.run(`guild:${guildId}`, async () => {
      const guildMap = this._getGuildMap(guildId, true);
      const record = this._getOrCreateRecord(guildMap, userId, username);
      record.points = toNonNegInt(record.points, 0) + MESSAGE_POINTS;
      record.totalMessages += 1;
      record.updatedAt = new Date(this.nowFn()).toISOString();
      this._markDirty({ immediate: false, guildId, userId });
      return {
        ok: true,
        points: record.points,
        totalMessages: record.totalMessages
      };
    });
  }

  _sortEntries(guildMap, type, todayKey) {
    const items = [];
    for (const rec of guildMap.values()) {
      const effectiveStreak = getEffectiveStreak(rec, todayKey);
      let metric = rec.points;
      if (type === 'chuoi') metric = effectiveStreak;
      else if (type === 'tinnhan') metric = rec.totalMessages;
      items.push({
        ...rec,
        effectiveStreak,
        metric
      });
    }

    items.sort((a, b) => {
      if (type === 'chuoi') {
        if (b.effectiveStreak !== a.effectiveStreak) return b.effectiveStreak - a.effectiveStreak;
        if (b.longestStreak !== a.longestStreak) return b.longestStreak - a.longestStreak;
        if (b.points !== a.points) return b.points - a.points;
        return a.userId.localeCompare(b.userId);
      }
      if (type === 'tinnhan') {
        if (b.totalMessages !== a.totalMessages) return b.totalMessages - a.totalMessages;
        if (b.points !== a.points) return b.points - a.points;
        return a.userId.localeCompare(b.userId);
      }
      if (b.points !== a.points) return b.points - a.points;
      if (b.effectiveStreak !== a.effectiveStreak) return b.effectiveStreak - a.effectiveStreak;
      if (b.totalMessages !== a.totalMessages) return b.totalMessages - a.totalMessages;
      return a.userId.localeCompare(b.userId);
    });

    return items;
  }

  async getProfile({ guildId, userId, username = '' }) {
    await this._refreshIfStale();
    const gMap = this._getGuildMap(guildId, false);
    const todayKey = getVietnamDateKey(this.nowFn());
    const base = gMap?.get(String(userId)) || normalizeRecord(userId, { username });
    const record = normalizeRecord(userId, {
      ...base,
      ...(username && !base.username ? { username } : {})
    });
    const effectiveStreak = getEffectiveStreak(record, todayKey);
    const checkedInToday = record.lastCheckinDate === todayKey;

    let pointsRank = null;
    let streakRank = null;
    let messagesRank = null;
    let totalUsers = 0;

    if (gMap && gMap.size > 0) {
      totalUsers = gMap.size;
      const byPoints = this._sortEntries(gMap, 'diem', todayKey).filter((x) => x.points > 0);
      const byStreak = this._sortEntries(gMap, 'chuoi', todayKey).filter((x) => x.effectiveStreak > 0);
      const byMessages = this._sortEntries(gMap, 'tinnhan', todayKey).filter((x) => x.totalMessages > 0);

      const pIdx = byPoints.findIndex((x) => x.userId === String(userId));
      const sIdx = byStreak.findIndex((x) => x.userId === String(userId));
      const mIdx = byMessages.findIndex((x) => x.userId === String(userId));

      if (pIdx >= 0) pointsRank = pIdx + 1;
      if (sIdx >= 0) streakRank = sIdx + 1;
      if (mIdx >= 0) messagesRank = mIdx + 1;
    }

    return {
      ...record,
      effectiveStreak,
      checkedInToday,
      todayKey,
      daysToNextMilestone: getDaysUntilNextMilestone(effectiveStreak),
      ranks: {
        pointsRank,
        streakRank,
        messagesRank,
        totalUsers
      }
    };
  }

  async getLeaderboard({ guildId, type = 'diem', limit = 10, viewerUserId = null }) {
    await this._refreshIfStale();
    const safeType = ['diem', 'chuoi', 'tinnhan'].includes(type) ? type : 'diem';
    const safeLimit = Math.max(1, Math.min(25, toNonNegInt(limit, 10) || 10));
    const gMap = this._getGuildMap(guildId, false);
    const todayKey = getVietnamDateKey(this.nowFn());

    if (!gMap || gMap.size === 0) {
      return {
        type: safeType,
        entries: [],
        totalRanked: 0,
        viewerRank: null,
        viewerMetric: 0,
        todayKey
      };
    }

    const sorted = this._sortEntries(gMap, safeType, todayKey).filter((entry) => entry.metric > 0);
    const entries = sorted.slice(0, safeLimit).map((entry, idx) => ({
      rank: idx + 1,
      ...entry
    }));

    let viewerRank = null;
    let viewerMetric = 0;
    if (viewerUserId) {
      const vIdx = sorted.findIndex((entry) => entry.userId === String(viewerUserId));
      if (vIdx >= 0) {
        viewerRank = vIdx + 1;
        viewerMetric = sorted[vIdx].metric;
      }
    }

    return {
      type: safeType,
      entries,
      totalRanked: sorted.length,
      viewerRank,
      viewerMetric,
      todayKey
    };
  }

  async getCombinedLeaderboards({ guildId, limit = 10, viewerUserId = null }) {
    const safeLimit = Math.max(1, Math.min(20, toNonNegInt(limit, 10) || 10));
    const [diem, chuoi, tinnhan] = await Promise.all([
      this.getLeaderboard({ guildId, type: 'diem', limit: safeLimit, viewerUserId }),
      this.getLeaderboard({ guildId, type: 'chuoi', limit: safeLimit, viewerUserId }),
      this.getLeaderboard({ guildId, type: 'tinnhan', limit: safeLimit, viewerUserId })
    ]);
    return {
      limit: safeLimit,
      todayKey: diem.todayKey,
      diem,
      chuoi,
      tinnhan
    };
  }

  async adminAdjustPoints({ guildId, userId, username = '', mode = 'add', amount = 0 }) {
    await this._refreshIfStale({ force: true });
    return this.lock.run(`guild:${guildId}`, async () => {
      const guildMap = this._getGuildMap(guildId, true);
      const record = this._getOrCreateRecord(guildMap, userId, username);
      const beforePoints = toNonNegInt(record.points, 0);
      const safeAmount = toNonNegInt(amount, 0);
      let clampedToZero = false;

      if (mode === 'subtract') {
        clampedToZero = beforePoints < safeAmount;
        record.points = Math.max(0, beforePoints - safeAmount);
      } else if (mode === 'set') {
        record.points = Math.max(0, safeAmount);
      } else {
        record.points = beforePoints + safeAmount;
      }

      record.updatedAt = new Date(this.nowFn()).toISOString();
      this._markDirty({ immediate: true, guildId, userId });
      await this.flush();

      return {
        ok: true,
        mode,
        beforePoints,
        afterPoints: record.points,
        delta: record.points - beforePoints,
        clampedToZero,
        record: { ...record }
      };
    });
  }

  async adminResetUser({ guildId, userId, username = '', scope = 'diem' }) {
    await this._refreshIfStale({ force: true });
    return this.lock.run(`guild:${guildId}`, async () => {
      const guildMap = this._getGuildMap(guildId, true);
      const record = this._getOrCreateRecord(guildMap, userId, username);
      const before = { ...record };
      const safeScope = scope === 'tatca' ? 'tatca' : 'diem';

      record.points = 0;
      if (safeScope === 'tatca') {
        record.streak = 0;
        record.longestStreak = 0;
        record.totalCheckins = 0;
        record.totalMessages = 0;
        record.lastCheckinDate = null;
      }
      record.updatedAt = new Date(this.nowFn()).toISOString();
      this._markDirty({ immediate: true, guildId, userId });
      await this.flush();

      return {
        ok: true,
        scope: safeScope,
        before,
        after: { ...record }
      };
    });
  }
}

async function resolveLoggedInPointsUser(discordUserId, services) {
  const dId = String(discordUserId || '').trim();
  if (!dId || typeof services?.accessStore?.getUserByDiscordId !== 'function') return null;
  const linked = await services.accessStore.getUserByDiscordId(dId);
  if (!linked) return null;
  if (String(linked.status || 'active').toLowerCase() === 'disabled') return null;
  return linked;
}

module.exports = {
  DiscordPointsService,
  DAILY_CHECKIN_POINTS,
  STREAK_MILESTONE_INTERVAL,
  STREAK_MILESTONE_BONUS,
  STREAK_RESTORE_COST,
  MESSAGE_POINTS,
  SETTING_KEY,
  getVietnamDateKey,
  getPreviousDateKey,
  getEffectiveStreak,
  getDaysUntilNextMilestone,
  buildUpcomingStreakRoadmap,
  resolveLoggedInPointsUser
};
