'use strict';

const pluginId = require('../../plugin-id');

module.exports = ({ strapi }) => ({
  definitions() {
    return [
      {
        id: 'api-accelerator',
        name: 'API Accelerator',
        implemented: true,
        projectType: 'api_accelerator',
        description: 'Discover, sync, and purge Content API snapshots in Smooth CDN.',
      },
      {
        id: 'cdn-connector',
        name: 'CDN Connector',
        implemented: false,
        projectType: 'basic',
        description: 'Placeholder for future asset delivery and CDN routing features.',
      },
      {
        id: 'cwv-pipeline',
        name: 'CWV Pipeline',
        implemented: false,
        projectType: 'basic',
        description: 'Placeholder for a future Core Web Vitals pipeline.',
      },
    ];
  },

  defaults() {
    return {
      modules: this.definitions().reduce((acc, definition) => {
        acc[definition.id] = false;
        return acc;
      }, {}),
    };
  },

  store() {
    return strapi.store({
      type: 'plugin',
      name: pluginId,
      key: 'module-registry',
    });
  },

  sanitize(payload = {}) {
    const defaults = this.defaults();
    const incomingModules = payload.modules && typeof payload.modules === 'object' ? payload.modules : {};
    const modules = {};

    for (const definition of this.definitions()) {
      modules[definition.id] = Boolean(
        Object.prototype.hasOwnProperty.call(incomingModules, definition.id)
          ? incomingModules[definition.id]
          : defaults.modules[definition.id]
      );
    }

    return { modules };
  },

  async getState() {
    const stored = (await this.store().get()) || {};
    return this.sanitize(stored);
  },

  async saveState(nextState) {
    const sanitized = this.sanitize(nextState);
    await this.store().set({ value: sanitized });
    return sanitized;
  },

  async list() {
    const state = await this.getState();
    return this.definitions().map((definition) => ({
      ...definition,
      enabled: Boolean(state.modules[definition.id]),
      stage: definition.implemented ? 'available' : 'placeholder',
    }));
  },

  async getDefinition(moduleId) {
    return this.definitions().find((definition) => definition.id === String(moduleId || '').trim()) || null;
  },

  async isEnabled(moduleId) {
    const state = await this.getState();
    return Boolean(state.modules[String(moduleId || '').trim()]);
  },

  async setEnabled(moduleId, enabled) {
    const definition = await this.getDefinition(moduleId);
    if (!definition) {
      return null;
    }

    const state = await this.getState();
    state.modules[definition.id] = Boolean(enabled);
    await this.saveState(state);
    return {
      ...definition,
      enabled: Boolean(enabled),
      stage: definition.implemented ? 'available' : 'placeholder',
    };
  },
});
