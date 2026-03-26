'use strict';

const { DEFAULT_SYNC_PAGE_SIZE } = require('../../../utils/constants');
const { nowIso, parseStringList } = require('../../../utils/helpers');
const pluginId = require('../../../plugin-id');

module.exports = ({ strapi }) => ({
  defaults() {
    return {
      defaultQueryString: '',
      protectedAssets: false,
      blockGetMode: 'no',
      collectionSyncPerPage: DEFAULT_SYNC_PAGE_SIZE,
      autoSyncFrequency: 'hourly',
      includeContentTypes: [],
      manualRoutes: [],
      lastDiscoveryAt: '',
      lastSyncAt: '',
      lastAutoSyncAt: '',
      debounceMs: 5000,
    };
  },

  store() {
    return strapi.store({
      type: 'plugin',
      name: pluginId,
      key: 'api-accelerator-settings',
    });
  },

  sanitize(payload = {}, current = this.defaults()) {
    const defaults = this.defaults();
    const merged = {
      ...defaults,
      ...current,
      ...payload,
    };

    const collectionSyncPerPage = Number(merged.collectionSyncPerPage) || DEFAULT_SYNC_PAGE_SIZE;
    const debounceMs = Number(merged.debounceMs) || 5000;

    return {
      defaultQueryString: String(merged.defaultQueryString || '').trim().replace(/^\?+/, ''),
      protectedAssets: Boolean(merged.protectedAssets),
      blockGetMode: ['no', 'all', 'synced'].includes(String(merged.blockGetMode))
        ? String(merged.blockGetMode)
        : 'no',
      collectionSyncPerPage: [10, 25, 50, 100].includes(collectionSyncPerPage)
        ? collectionSyncPerPage
        : DEFAULT_SYNC_PAGE_SIZE,
      autoSyncFrequency: ['hourly', 'daily', 'weekly', 'off'].includes(String(merged.autoSyncFrequency))
        ? String(merged.autoSyncFrequency)
        : 'hourly',
      includeContentTypes: parseStringList(merged.includeContentTypes),
      manualRoutes: parseStringList(merged.manualRoutes),
      lastDiscoveryAt: String(merged.lastDiscoveryAt || '').trim(),
      lastSyncAt: String(merged.lastSyncAt || '').trim(),
      lastAutoSyncAt: String(merged.lastAutoSyncAt || '').trim(),
      debounceMs: Math.max(500, debounceMs),
    };
  },

  async get() {
    const stored = (await this.store().get()) || {};
    return this.sanitize(stored);
  },

  async getResolved(overrides = {}) {
    const coreSettings = await strapi.plugin('smoothcdn').service('core-settings').get();
    const moduleSettings = await this.get();
    return {
      ...coreSettings,
      ...moduleSettings,
      ...(overrides || {}),
    };
  },

  async update(payload = {}) {
    const current = await this.get();
    const next = this.sanitize(payload, current);
    await this.store().set({ value: next });
    return next;
  },

  async touch(key) {
    return this.update({
      [key]: nowIso(),
    });
  },
});
