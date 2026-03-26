'use strict';

const { nowIso } = require('../../utils/helpers');
const pluginId = require('../../plugin-id');

module.exports = ({ strapi }) => ({
  defaults() {
    return {
      accessToken: '',
      connected: false,
      authKeyId: '',
      authVerificationUrl: '',
      authSessionStatus: 'idle',
      authMode: '',
      projectId: '',
      projectSlug: '',
      projectType: '',
      userSlug: '',
      userName: '',
      userEmail: '',
      userPlan: -1,
      userPlanLabel: '',
      guestName: '',
      publicBaseUrl: '',
      lastConnectionAt: '',
      lastStatusSyncAt: '',
      lastProjectCreationAt: '',
      lastAuthStartedAt: '',
    };
  },

  store() {
    return strapi.store({
      type: 'plugin',
      name: pluginId,
      key: 'core-settings',
    });
  },

  sanitize(payload = {}, current = this.defaults()) {
    const defaults = this.defaults();
    const merged = {
      ...defaults,
      ...current,
      ...payload,
    };
    const accessToken = String(merged.accessToken || merged.apiKey || '').trim();

    return {
      accessToken,
      connected: Boolean(merged.connected),
      authKeyId: String(merged.authKeyId || '').trim(),
      authVerificationUrl: String(merged.authVerificationUrl || '').trim(),
      authSessionStatus: ['idle', 'pending', 'active', 'expired', 'already_active', 'invalid', 'error'].includes(
        String(merged.authSessionStatus || '')
      )
        ? String(merged.authSessionStatus)
        : 'idle',
      authMode: ['browser', 'guest', ''].includes(String(merged.authMode || '')) ? String(merged.authMode) : '',
      projectId: String(merged.projectId || '').trim(),
      projectType: String(merged.projectType || '').trim(),
      projectSlug: String(merged.projectSlug || '').trim(),
      userSlug: String(merged.userSlug || '').trim(),
      userName: String(merged.userName || '').trim(),
      userEmail: String(merged.userEmail || '').trim(),
      userPlan: Number.isFinite(Number(merged.userPlan)) ? Number(merged.userPlan) : -1,
      userPlanLabel: String(merged.userPlanLabel || '').trim(),
      guestName: String(merged.guestName || '').trim(),
      publicBaseUrl: String(merged.publicBaseUrl || '').trim().replace(/\/+$/, ''),
      lastConnectionAt: String(merged.lastConnectionAt || '').trim(),
      lastStatusSyncAt: String(merged.lastStatusSyncAt || '').trim(),
      lastProjectCreationAt: String(merged.lastProjectCreationAt || '').trim(),
      lastAuthStartedAt: String(merged.lastAuthStartedAt || '').trim(),
    };
  },

  async get() {
    const stored = (await this.store().get()) || {};
    return this.sanitize(stored);
  },

  async update(payload = {}, options = {}) {
    const current = await this.get();
    const nextPayload = { ...payload };

    if (options.preserveAccessToken !== false && Object.prototype.hasOwnProperty.call(nextPayload, 'accessToken')) {
      const candidate = String(nextPayload.accessToken || '').trim();
      if (!candidate && current.accessToken) {
        delete nextPayload.accessToken;
      }
    }

    const next = this.sanitize(nextPayload, current);

    if (!next.accessToken) {
      next.connected = false;
      next.authKeyId = '';
      next.authVerificationUrl = '';
      next.authSessionStatus = 'idle';
      next.authMode = '';
      next.projectId = '';
      next.projectSlug = '';
      next.projectType = '';
      next.userSlug = '';
      next.userName = '';
      next.userEmail = '';
      next.userPlan = -1;
      next.userPlanLabel = '';
    }

    await this.store().set({ value: next });
    return next;
  },

  async markPendingAuth(payload = {}) {
    return this.update({
      authKeyId: payload.authKeyId || payload.keyId || '',
      authVerificationUrl: payload.authVerificationUrl || payload.verificationUrl || '',
      authSessionStatus: payload.authSessionStatus || payload.status || 'pending',
      authMode: payload.authMode || payload.mode || '',
      lastAuthStartedAt: nowIso(),
    });
  },

  async clearPendingAuth(status = 'idle') {
    return this.update({
      authKeyId: '',
      authVerificationUrl: '',
      authSessionStatus: status,
      authMode: '',
    });
  },

  async markConnected(connection = {}) {
    return this.update({
      ...connection,
      connected: true,
      authKeyId: '',
      authVerificationUrl: '',
      authSessionStatus: 'idle',
      authMode: '',
      lastConnectionAt: nowIso(),
    });
  },

  async markStatus(payload = {}) {
    return this.update({
      ...payload,
      lastStatusSyncAt: nowIso(),
    });
  },

  async markProjectCreated(payload = {}) {
    return this.update({
      ...payload,
      lastProjectCreationAt: nowIso(),
    });
  },

  async markDisconnected() {
    return this.update({
      accessToken: '',
      connected: false,
      authKeyId: '',
      authVerificationUrl: '',
      authSessionStatus: 'idle',
      authMode: '',
      projectId: '',
      projectSlug: '',
      projectType: '',
      userSlug: '',
      userName: '',
      userEmail: '',
      userPlan: -1,
      userPlanLabel: '',
    });
  },

  async isConnected() {
    const settings = await this.get();
    return Boolean(settings.accessToken && settings.connected);
  },
});
