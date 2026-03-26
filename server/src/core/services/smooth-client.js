'use strict';

const {
  CDN_API_BASE_URL,
  CDN_PUBLIC_HOST,
  CDN_UPLOAD_URL,
} = require('../../utils/constants');
const { nowIso } = require('../../utils/helpers');
const {
  buildUploadTarget,
  buildUploadTargetsForRouteAssets,
  normalizeRoute,
  safeJsonParse,
  slugify,
} = require('../../utils/helpers');

function extractSlugCandidates(payload = {}) {
  return [
    payload.slug,
    payload.user_slug,
    payload.project_slug,
    payload?.user?.slug,
    payload?.user?.user_slug,
    payload?.project?.slug,
    payload?.project?.project_slug,
    payload?.currentProject?.slug,
    payload?.currentProject?.project_slug,
  ]
    .map((value) => slugify(value || ''))
    .filter(Boolean);
}

function extractUserSlug(payload = {}) {
  return extractSlugCandidates({
    slug: payload.user_slug,
    user: payload.user,
  })[0] || '';
}

function extractProjectSlug(payload = {}) {
  return extractSlugCandidates({
    project_slug: payload.project_slug,
    project: payload.project,
    currentProject: payload.currentProject,
  })[0] || '';
}

function planLabel(plan) {
  switch (Number(plan)) {
    case 0:
      return 'FREE';
    case 1:
      return 'STARTER';
    case 2:
      return 'PRO';
    default:
      return '';
  }
}

module.exports = ({ strapi }) => ({
  async requestJson(method, path, options = {}) {
    const response = await fetch(`${CDN_API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: method === 'GET' ? undefined : JSON.stringify(options.payload || {}),
    });

    const text = await response.text();
    const payload = safeJsonParse(text, {});

    return {
      success: response.ok,
      status: response.status,
      data: payload?.data && typeof payload.data === 'object' ? payload.data : payload,
      payload,
      message: payload?.message || payload?.error?.message || '',
      details: payload?.details || '',
    };
  },

  buildProjectName(baseUrl) {
    try {
      const url = new URL(baseUrl);
      return `${url.hostname} strapi`;
    } catch (error) {
      return 'strapi smoothcdn';
    }
  },

  buildLoginLabel() {
    const host = strapi.config.get('server.host') || 'strapi';
    return `strapi-${host}`;
  },

  buildGuestPayload(options = {}, current = {}) {
    const nameCandidate = String(options.name || current.guestName || 'Strapi Guest').trim();
    const urlCandidate = String(options.url || current.publicBaseUrl || strapi.config.get('server.url') || '').trim();

    return {
      guest: true,
      name: nameCandidate || 'Strapi Guest',
      url: urlCandidate,
    };
  },

  async startLogin(options = {}) {
    const settingsService = strapi.plugin('smoothcdn').service('core-settings');
    const current = await settingsService.get();
    const guestMode = options.guest === true;
    const payload = {
      label: this.buildLoginLabel(),
      ...(guestMode ? this.buildGuestPayload(options, current) : {}),
    };

    const response = await this.requestJson('POST', '/api/auth/cli', {
      payload,
    });

    if (!response.success) {
      return {
        success: false,
        message: response.message || 'Could not start the Smooth CDN login flow.',
      };
    }

    const data = response.data && typeof response.data === 'object' ? response.data : {};
    const keyId = String(data.key_id || data.keyId || '').trim();
    const verificationUrl = String(data.verification_url || data.verificationUrl || '').trim();
    const status = String(data.status || (guestMode ? 'active' : 'pending')).trim() || 'pending';

    if (!keyId) {
      return {
        success: false,
        message: 'Smooth CDN did not return a valid login key.',
      };
    }

    const nextSettings = await settingsService.markPendingAuth({
      authKeyId: keyId,
      authVerificationUrl: verificationUrl,
      authSessionStatus: status,
      authMode: guestMode ? 'guest' : 'browser',
      guestName: payload.name || current.guestName,
    });

    return {
      success: true,
      keyId,
      verificationUrl,
      status,
      settings: nextSettings,
    };
  },

  async pollLogin(keyId) {
    const settingsService = strapi.plugin('smoothcdn').service('core-settings');
    const current = await settingsService.get();
    const resolvedKeyId = String(keyId || current.authKeyId || '').trim();

    if (!resolvedKeyId) {
      return {
        success: false,
        message: 'Missing login session key.',
      };
    }

    const response = await this.requestJson('POST', '/api/auth/cli/poll', {
      payload: {
        keyId: resolvedKeyId,
      },
    });

    if (!response.success) {
      return {
        success: false,
        message: response.message || 'Could not poll the Smooth CDN login session.',
      };
    }

    const data = response.data && typeof response.data === 'object' ? response.data : {};
    const status = String(data.status || '').trim();

    if (!status || ['pending'].includes(status)) {
      await settingsService.update({
        authSessionStatus: status || 'pending',
      });

      return {
        success: true,
        status: status || 'pending',
      };
    }

    if (['expired', 'already_active', 'invalid', 'unknown_state'].includes(status)) {
      await settingsService.clearPendingAuth(status === 'unknown_state' ? 'error' : status);

      return {
        success: false,
        status,
        message:
          status === 'expired'
            ? 'The login session expired. Start a new login session.'
            : status === 'already_active'
              ? 'This login session has already been used.'
              : 'The login session is no longer valid.',
      };
    }

    if (status !== 'active') {
      await settingsService.update({
        authSessionStatus: 'error',
      });
      return {
        success: false,
        status,
        message: 'Smooth CDN returned an unexpected login status.',
      };
    }

    const accessToken = String(data.api_key || data.apiKey || '').trim();
    if (!accessToken) {
      return {
        success: false,
        status: 'error',
        message: 'Smooth CDN did not return an access token.',
      };
    }

    await settingsService.markConnected({
      accessToken,
    });
    const synced = await this.syncStatus();

    return {
      success: synced.success,
      status: 'active',
      settings: synced.settings || (await settingsService.get()),
      message: synced.success ? 'Connected to Smooth CDN.' : synced.message,
    };
  },

  async syncStatus() {
    const settingsService = strapi.plugin('smoothcdn').service('core-settings');
    const current = await settingsService.get();
    const token = String(current.accessToken || '').trim();

    if (!token) {
      return {
        success: false,
        message: 'Connect to Smooth CDN first.',
      };
    }

    const response = await this.requestJson('GET', '/api/status', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.success) {
      if ([401, 403].includes(response.status)) {
        await settingsService.markDisconnected();
      }

      return {
        success: false,
        message: response.message || 'Could not fetch account metadata from Smooth CDN.',
      };
    }

    const data = response.data && typeof response.data === 'object' ? response.data : {};
    const projects = Array.isArray(data.projects) ? data.projects : [];
    const currentProject = projects.find((project) => String(project.id || '').trim() === String(current.projectId || '').trim());

    const nextSettings = await settingsService.markStatus({
      connected: true,
      userSlug: extractUserSlug(data) || String(data.slug || '').trim(),
      userName: String(data.name || '').trim(),
      userEmail: String(data.email || '').trim(),
      userPlan: Number.isFinite(Number(data.plan)) ? Number(data.plan) : -1,
      userPlanLabel: planLabel(data.plan),
      projectSlug: currentProject ? String(currentProject.slug || '').trim() : current.projectSlug,
      projectType: currentProject ? String(currentProject.type || '').trim() : current.projectType,
    });

    return {
      success: true,
      settings: nextSettings,
      status: {
        name: nextSettings.userName,
        email: nextSettings.userEmail,
        slug: nextSettings.userSlug,
        plan: nextSettings.userPlan,
        planLabel: nextSettings.userPlanLabel,
        projects,
      },
    };
  },

  async disconnect() {
    const settings = await strapi.plugin('smoothcdn').service('core-settings').markDisconnected();

    return {
      success: true,
      settings,
    };
  },

  async ensureProject(moduleId) {
    const settingsService = strapi.plugin('smoothcdn').service('core-settings');
    const registry = strapi.plugin('smoothcdn').service('module-registry');
    const current = await settingsService.get();
    const definition = await registry.getDefinition(moduleId);

    if (!definition) {
      return {
        success: false,
        message: 'Unknown Smooth CDN module.',
      };
    }

    if (!current.connected || !current.accessToken) {
      return {
        success: false,
        message: 'Connect to Smooth CDN before enabling a module.',
      };
    }

    if (current.projectId) {
      return {
        success: true,
        created: false,
        settings: current,
      };
    }

    const projectResponse = await this.requestJson('POST', '/api/projects', {
      headers: {
        Authorization: `Bearer ${current.accessToken}`,
      },
      payload: {
        name: this.buildProjectName(current.publicBaseUrl || strapi.config.get('server.url') || 'strapi'),
        type: definition.projectType || 'basic',
        blockBots: false,
        blockHeadless: false,
        failIfExist: false,
      },
    });

    if (!projectResponse.success) {
      return {
        success: false,
        message: projectResponse.message || 'Could not create a Smooth CDN project.',
      };
    }

    const projectData = projectResponse.data && typeof projectResponse.data === 'object' ? projectResponse.data : {};
    const projectId = String(projectData.id || projectData.project_id || projectData?.project?.id || '').trim();
    const projectSlug = extractProjectSlug(projectData) || String(projectData.slug || '').trim();
    const projectType = String(projectData.type || definition.projectType || '').trim();

    if (!projectId) {
      return {
        success: false,
        message: 'Smooth CDN project creation did not return a valid project ID.',
      };
    }

    const nextSettings = await settingsService.markProjectCreated({
      projectId,
      projectSlug,
      projectType,
    });

    return {
      success: true,
      created: projectResponse.status === 201,
      settings: nextSettings,
    };
  },

  async uploadAssets(assets = []) {
    const settings = await strapi.plugin('smoothcdn').service('core-settings').get();
    if (!settings.connected || !settings.accessToken || !settings.projectId) {
      return {
        success: false,
        message: 'Connect to Smooth CDN and create a project first.',
        results: {},
      };
    }

    const results = {};

    for (const asset of assets) {
      const route = normalizeRoute(asset.route);
      if (!route || !asset.json) {
        continue;
      }

      const target = asset.uploadTarget || buildUploadTarget(route);
      const form = new FormData();
      form.set('projectId', settings.projectId);
      form.set('path', String(target.path || '/'));
      form.set('protected', asset.protected ? '1' : '0');
      form.set('force', '0');
      form.append(
        'assets',
        new Blob([asset.json], { type: 'application/json' }),
        String(target.filename || 'asset.json')
      );

      const response = await fetch(CDN_UPLOAD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.accessToken}`,
        },
        body: form,
      });

      const text = await response.text();
      const payload = safeJsonParse(text, {});
      results[route] = {
        success: response.ok,
        message: payload?.message || payload?.error?.message || '',
        details: payload?.details || '',
      };
    }

    return {
      success: Object.values(results).every((result) => result.success),
      results,
    };
  },

  async deleteRouteAssets(routes = []) {
    const settings = await strapi.plugin('smoothcdn').service('core-settings').get();
    if (!settings.connected || !settings.accessToken || !settings.projectId) {
      return {
        success: false,
        message: 'Connect to Smooth CDN and create a project first.',
      };
    }

    const repository = strapi.plugin('smoothcdn').service('api-accelerator-repository');
    const targets = [];

    for (const route of routes) {
      const entry = await repository.get(route);
      const fileCount = Math.max(1, Number(entry?.syncedFileCount || 1));
      const uploadTargets = buildUploadTargetsForRouteAssets(route, fileCount);

      for (const target of uploadTargets) {
        targets.push({
          path: target.path,
          filename: target.filename,
        });
      }
    }

    if (targets.length === 0) {
      return {
        success: true,
        deleted: 0,
      };
    }

    const response = await this.requestJson(
      'DELETE',
      `/api/projects/${encodeURIComponent(settings.projectId)}/assets/bulk`,
      {
        headers: {
          Authorization: `Bearer ${settings.accessToken}`,
        },
        payload: {
          assets: targets,
        },
      }
    );

    return {
      success: response.success,
      deleted: targets.length,
      message: response.message,
    };
  },

  buildPublicUrlForUploadTarget(path, filename, settings) {
    if (!settings.userSlug || !settings.projectSlug || !filename) {
      return '';
    }

    const normalizedPath = String(path || '/').trim() === '/'
      ? ''
      : `/${String(path || '').trim().replace(/^\/+|\/+$/g, '')}`;

    return `${CDN_PUBLIC_HOST}/${encodeURIComponent(settings.userSlug)}/${encodeURIComponent(
      settings.projectSlug
    )}${normalizedPath}/${encodeURIComponent(filename)}`;
  },
});
