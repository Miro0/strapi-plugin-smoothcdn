'use strict';

const { URL } = require('node:url');
const { BYPASS_HEADER } = require('../../../utils/constants');
const { normalizeRoute, safeJsonParse } = require('../../../utils/helpers');

function buildAbsoluteBaseUrl(strapi, settings) {
  if (settings.publicBaseUrl) {
    return settings.publicBaseUrl.replace(/\/+$/, '');
  }

  const configuredServerUrl = String(strapi.config.get('server.url') || '').trim().replace(/\/+$/, '');
  if (configuredServerUrl) {
    if (/^https?:\/\//.test(configuredServerUrl)) {
      return configuredServerUrl;
    }

    const host = strapi.config.get('server.host') || '127.0.0.1';
    return `http://${host}:${strapi.config.get('server.port') || 1337}${
      configuredServerUrl.startsWith('/') ? configuredServerUrl : `/${configuredServerUrl}`
    }`;
  }

  const host = strapi.config.get('server.host') || '127.0.0.1';
  const port = strapi.config.get('server.port') || 1337;
  return `http://${host}:${port}`;
}

module.exports = ({ strapi }) => ({
  async buildUrl(route, options = {}) {
    const settings = options.settings || (await strapi.plugin('smoothcdn').service('api-accelerator-settings').getResolved());
    const baseUrl = buildAbsoluteBaseUrl(strapi, settings);
    const url = new URL(`${baseUrl}${normalizeRoute(route)}`);
    const query = new URLSearchParams(settings.defaultQueryString || '');

    for (const [key, value] of Object.entries(options.query || {})) {
      if (value === undefined || value === null || value === '') {
        continue;
      }

      query.set(key, String(value));
    }

    url.search = query.toString();
    return url.toString();
  },

  async fetchJson(route, options = {}) {
    const settings = options.settings || (await strapi.plugin('smoothcdn').service('api-accelerator-settings').getResolved());
    const url = await this.buildUrl(route, {
      settings,
      query: options.query || {},
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          [BYPASS_HEADER]: '1',
        },
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = safeJsonParse(text, null);
      const data = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data')
        ? payload.data
        : payload;
      const meta = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'meta')
        ? payload.meta
        : {};

      return {
        success: response.ok,
        status: response.status,
        data,
        meta,
        raw: payload,
        url,
        errorMessage: response.ok ? '' : (payload && payload.error && payload.error.message) || `Origin returned ${response.status}.`,
      };
    } catch (error) {
      return {
        success: false,
        status: 500,
        data: null,
        meta: {},
        raw: null,
        url,
        errorMessage: error.name === 'AbortError' ? 'Origin request timed out.' : error.message,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
});
