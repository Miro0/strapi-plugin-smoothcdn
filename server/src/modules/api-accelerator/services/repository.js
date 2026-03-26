'use strict';

const pluginId = require('../../../plugin-id');
const { md5, nowIso } = require('../../../utils/helpers');

module.exports = ({ strapi }) => ({
  store() {
    return strapi.store({
      type: 'plugin',
      name: pluginId,
      key: 'api-accelerator-repository',
    });
  },

  normalizeEntry(entry = {}, previous = null) {
    const current = previous || {};
    const route = String(entry.route || current.route || '').trim();

    return {
      id: md5(route),
      route,
      routeTemplate: String(entry.routeTemplate || current.routeTemplate || route).trim(),
      kind: String(entry.kind || current.kind || 'custom').trim(),
      contentTypeUid: String(entry.contentTypeUid || current.contentTypeUid || '').trim(),
      syncable: Object.prototype.hasOwnProperty.call(entry, 'syncable')
        ? Boolean(entry.syncable)
        : Boolean(current.syncable),
      status: String(entry.status || current.status || 'detected').trim(),
      syncStatus: String(entry.syncStatus || current.syncStatus || 'detected').trim(),
      httpStatus: Number(entry.httpStatus ?? current.httpStatus ?? 0) || 0,
      jsonSize: Number(entry.jsonSize ?? current.jsonSize ?? 0) || 0,
      syncedFileCount: Math.max(0, Number(entry.syncedFileCount ?? current.syncedFileCount ?? 0) || 0),
      lastSyncedHash: String(entry.lastSyncedHash || current.lastSyncedHash || '').trim(),
      lastSyncedAt: String(entry.lastSyncedAt || current.lastSyncedAt || '').trim(),
      lastError: String(entry.lastError || current.lastError || '').trim(),
      updatedAt: nowIso(),
    };
  },

  async all() {
    const items = (await this.store().get()) || [];
    if (!Array.isArray(items)) {
      return [];
    }

    return [...items].sort((left, right) => String(left.route || '').localeCompare(String(right.route || '')));
  },

  async save(items) {
    await this.store().set({ value: items });
    return items;
  },

  async get(route) {
    const normalizedRoute = String(route || '').trim();
    return (await this.all()).find((item) => item.route === normalizedRoute) || null;
  },

  async upsert(entry) {
    return this.upsertMany([entry]);
  },

  async upsertMany(entries = []) {
    const items = await this.all();
    const index = new Map(items.map((item, itemIndex) => [item.route, itemIndex]));

    for (const entry of entries) {
      const route = String(entry?.route || '').trim();
      if (!route) {
        continue;
      }

      const itemIndex = index.get(route);
      const previous = typeof itemIndex === 'number' ? items[itemIndex] : null;
      const next = this.normalizeEntry(entry, previous);

      if (typeof itemIndex === 'number') {
        items[itemIndex] = next;
        continue;
      }

      items.push(next);
      index.set(route, items.length - 1);
    }

    await this.save(items);
    return items;
  },

  async setSyncable(route, syncable) {
    const entry = await this.get(route);
    if (!entry) {
      return null;
    }

    const next = this.normalizeEntry(
      {
        ...entry,
        syncable,
      },
      entry
    );

    await this.upsert(next);
    return next;
  },

  async findSyncable(filters = {}) {
    const items = await this.all();
    return items.filter((item) => {
      if (!item.syncable) {
        return false;
      }

      if (filters.contentTypeUid && item.contentTypeUid !== filters.contentTypeUid) {
        return false;
      }

      if (Array.isArray(filters.routes) && filters.routes.length > 0 && !filters.routes.includes(item.route)) {
        return false;
      }

      return true;
    });
  },

  async pruneContentType(uid, keepRoutes = []) {
    const keep = new Set(keepRoutes);
    const items = await this.all();
    const removed = [];
    const next = items.filter((item) => {
      if (item.contentTypeUid !== uid) {
        return true;
      }

      if (keep.has(item.route)) {
        return true;
      }

      removed.push(item);
      return false;
    });

    if (removed.length > 0) {
      await this.save(next);
    }

    return removed;
  },

  async stats() {
    const items = await this.all();
    return {
      total: items.length,
      syncable: items.filter((item) => item.syncable).length,
      uploaded: items.filter((item) => item.syncStatus === 'uploaded').length,
      failed: items.filter((item) => item.status === 'error' || item.syncStatus === 'upload_failed').length,
    };
  },
});
