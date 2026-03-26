'use strict';

const pluginId = require('../../../plugin-id');

function toTimestamp(value) {
  const timestamp = Number(value) || 0;
  return timestamp > 0 ? timestamp : 0;
}

module.exports = ({ strapi }) => ({
  defaults() {
    return {
      pendingContentTypes: [],
      pendingFlushAfter: 0,
      schedulerLock: {
        owner: '',
        expiresAt: 0,
      },
      syncLock: {
        owner: '',
        expiresAt: 0,
      },
    };
  },

  store() {
    return strapi.store({
      type: 'plugin',
      name: pluginId,
      key: 'api-accelerator-runtime-state',
    });
  },

  sanitize(payload = {}) {
    const defaults = this.defaults();
    const schedulerLock = payload.schedulerLock && typeof payload.schedulerLock === 'object'
      ? payload.schedulerLock
      : defaults.schedulerLock;
    const syncLock = payload.syncLock && typeof payload.syncLock === 'object'
      ? payload.syncLock
      : defaults.syncLock;

    return {
      pendingContentTypes: Array.from(
        new Set(
          (Array.isArray(payload.pendingContentTypes) ? payload.pendingContentTypes : [])
            .map((uid) => String(uid || '').trim())
            .filter(Boolean)
        )
      ),
      pendingFlushAfter: toTimestamp(payload.pendingFlushAfter),
      schedulerLock: {
        owner: String(schedulerLock.owner || '').trim(),
        expiresAt: toTimestamp(schedulerLock.expiresAt),
      },
      syncLock: {
        owner: String(syncLock.owner || '').trim(),
        expiresAt: toTimestamp(syncLock.expiresAt),
      },
    };
  },

  async get() {
    const stored = (await this.store().get()) || {};
    return this.sanitize(stored);
  },

  async save(nextState) {
    const sanitized = this.sanitize(nextState);
    await this.store().set({ value: sanitized });
    return sanitized;
  },

  async update(updater) {
    const current = await this.get();
    const patch = typeof updater === 'function' ? await updater(current) : updater;

    return this.save({
      ...current,
      ...(patch || {}),
    });
  },

  async queueContentTypes(uids = [], delayMs = 5000) {
    const normalizedDelay = Math.max(500, Number(delayMs) || 5000);
    const normalizedUids = Array.from(
      new Set(
        (Array.isArray(uids) ? uids : [])
          .map((uid) => String(uid || '').trim())
          .filter((uid) => uid.startsWith('api::'))
      )
    );

    if (normalizedUids.length === 0) {
      return this.get();
    }

    return this.update((current) => ({
      pendingContentTypes: Array.from(new Set([...current.pendingContentTypes, ...normalizedUids])),
      pendingFlushAfter: Date.now() + normalizedDelay,
    }));
  },

  async takeDuePendingContentTypes(now = Date.now()) {
    const current = await this.get();

    if (current.pendingContentTypes.length === 0 || current.pendingFlushAfter > now) {
      return [];
    }

    const queued = [...current.pendingContentTypes];
    await this.save({
      ...current,
      pendingContentTypes: [],
      pendingFlushAfter: 0,
    });

    return queued;
  },

  async requeueContentTypes(uids = [], delayMs = 5000) {
    return this.queueContentTypes(uids, delayMs);
  },

  async claimLock(lockKey, owner, ttlMs) {
    const normalizedLockKey = String(lockKey || '').trim();
    if (!['schedulerLock', 'syncLock'].includes(normalizedLockKey)) {
      return false;
    }

    const normalizedOwner = String(owner || '').trim();
    const normalizedTtl = Math.max(1000, Number(ttlMs) || 1000);
    const now = Date.now();
    const current = await this.get();
    const existing = current[normalizedLockKey] || { owner: '', expiresAt: 0 };

    if (existing.owner && existing.owner !== normalizedOwner && existing.expiresAt > now) {
      return false;
    }

    await this.save({
      ...current,
      [normalizedLockKey]: {
        owner: normalizedOwner,
        expiresAt: now + normalizedTtl,
      },
    });

    const confirmed = await this.get();
    return confirmed[normalizedLockKey]?.owner === normalizedOwner;
  },

  async refreshLock(lockKey, owner, ttlMs) {
    const normalizedLockKey = String(lockKey || '').trim();
    const normalizedOwner = String(owner || '').trim();
    const normalizedTtl = Math.max(1000, Number(ttlMs) || 1000);
    const current = await this.get();
    const existing = current[normalizedLockKey] || { owner: '', expiresAt: 0 };

    if (existing.owner !== normalizedOwner) {
      return false;
    }

    await this.save({
      ...current,
      [normalizedLockKey]: {
        owner: normalizedOwner,
        expiresAt: Date.now() + normalizedTtl,
      },
    });

    return true;
  },

  async releaseLock(lockKey, owner) {
    const normalizedLockKey = String(lockKey || '').trim();
    const normalizedOwner = String(owner || '').trim();
    const current = await this.get();
    const existing = current[normalizedLockKey] || { owner: '', expiresAt: 0 };

    if (existing.owner && existing.owner !== normalizedOwner) {
      return false;
    }

    await this.save({
      ...current,
      [normalizedLockKey]: {
        owner: '',
        expiresAt: 0,
      },
    });

    return true;
  },
});
