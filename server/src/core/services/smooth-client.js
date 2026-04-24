'use strict';

const path = require('node:path');

const {
  CDN_API_BASE_URL,
  CDN_AUTH_API_BASE_URL,
  CDN_DELETE_URL,
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

function normalizeCustomSubdomain(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) {
    return '';
  }

  const hostCandidate = normalized
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.smoothcdn\.com$/i, '')
    .replace(/^\.+|\.+$/g, '');

  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostCandidate) ? hostCandidate : '';
}

function extractCustomSubdomain(payload = {}) {
  return normalizeCustomSubdomain(
    payload.customSubdomain ||
      payload.custom_subdomain ||
      payload?.project?.customSubdomain ||
      payload?.project?.custom_subdomain ||
      payload?.currentProject?.customSubdomain ||
      payload?.currentProject?.custom_subdomain ||
      ''
  );
}

function planLabel(plan) {
  switch (Number(plan)) {
    case -1:
      return 'GUEST';
    case 0:
      return 'FREE';
    case 1:
      return 'STARTER';
    case 2:
      return 'PRO';
    case 3:
      return 'ENTERPRISE';
    default:
      return '';
  }
}

function pushMessage(messages, value) {
  const normalized = String(value || '').trim();
  if (normalized) {
    messages.push(normalized);
  }
}

function pushAnyMessage(messages, value) {
  if (typeof value === 'string') {
    pushMessage(messages, value);
    return;
  }

  if (value && typeof value === 'object') {
    pushMessage(messages, value.message);
    pushMessage(messages, value.detail);
    pushMessage(messages, value.title);
  }
}

function extractResponseMessage(payload = {}, status) {
  const messages = [];

  pushMessage(messages, payload?.message);
  pushAnyMessage(messages, payload?.error);
  pushMessage(messages, payload?.error?.message);
  pushMessage(messages, payload?.data?.message);
  pushAnyMessage(messages, payload?.data?.error);
  pushMessage(messages, payload?.data?.error?.message);
  pushMessage(messages, payload?.details);
  pushMessage(messages, payload?.error?.details?.message);
  pushMessage(messages, payload?.data?.details);
  pushMessage(messages, payload?.data?.error?.details?.message);

  const errorLists = [
    payload?.errors,
    payload?.details?.errors,
    payload?.error?.details?.errors,
    payload?.data?.errors,
    payload?.data?.details?.errors,
    payload?.data?.error?.details?.errors,
  ];

  for (const entries of errorLists) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      if (typeof entry === 'string') {
        pushMessage(messages, entry);
        continue;
      }

      if (entry && typeof entry === 'object') {
        pushMessage(messages, entry.message);
        pushMessage(messages, entry.detail);
        pushMessage(messages, entry.title);
      }
    }
  }

  const uniqueMessages = Array.from(new Set(messages));

  if (uniqueMessages.length > 0) {
    return uniqueMessages.join(' ');
  }

  return status ? `Smooth CDN request failed (${status}).` : '';
}

function reconcileModuleProjects(moduleProjects = {}, projects = []) {
  const nextModuleProjects = {};

  for (const [moduleId, project] of Object.entries(moduleProjects || {})) {
    const currentProject = project && typeof project === 'object' ? project : {};
    const matchingProject = projects.find(
      (entry) => String(entry.id || '').trim() === String(currentProject.projectId || '').trim()
    );

    nextModuleProjects[moduleId] = {
      projectId: String(currentProject.projectId || '').trim(),
      projectSlug: matchingProject
        ? String(matchingProject.slug || currentProject.projectSlug || '').trim()
        : String(currentProject.projectSlug || '').trim(),
      projectType: matchingProject
        ? String(matchingProject.type || currentProject.projectType || '').trim()
        : String(currentProject.projectType || '').trim(),
      assetsCount: matchingProject ? Math.max(0, Number(matchingProject.assetsCount) || 0) : 0,
      customSubdomain: matchingProject
        ? extractCustomSubdomain(matchingProject) || String(currentProject.customSubdomain || '').trim()
        : String(currentProject.customSubdomain || '').trim(),
    };
  }

  return nextModuleProjects;
}

function getPrimaryModuleProject(moduleProjects = {}) {
  const entries = Object.entries(moduleProjects || {});

  const preferredEntry = entries.find(
    ([moduleId, project]) => moduleId === 'api-accelerator' && String(project?.projectId || '').trim()
  );

  if (preferredEntry) {
    return preferredEntry[1];
  }

  const firstAvailableEntry = entries.find(([, project]) => String(project?.projectId || '').trim());
  return firstAvailableEntry ? firstAvailableEntry[1] : null;
}

function toAssetArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, entry]) => ({
      key,
      ...(entry && typeof entry === 'object' ? entry : {}),
    }));
  }

  return [];
}

function normalizeUploadedAssetEntry(entry = {}) {
  const responseEntry = entry.response && typeof entry.response === 'object' ? entry.response : {};
  const responseAsset = responseEntry.asset && typeof responseEntry.asset === 'object' ? responseEntry.asset : {};
  const rawPath = String(
    entry.path ||
      entry.uploadPath ||
      entry.upload_path ||
      entry.targetPath ||
      entry.target_path ||
      entry.directory ||
      responseEntry.path ||
      responseEntry.uploadPath ||
      responseEntry.upload_path ||
      responseEntry.targetPath ||
      responseEntry.target_path ||
      responseEntry.directory ||
      responseAsset.path ||
      responseAsset.uploadPath ||
      responseAsset.upload_path ||
      responseAsset.targetPath ||
      responseAsset.target_path ||
      responseAsset.directory ||
      ''
  ).trim();
  const rawFilename = String(
    entry.filename ||
      entry.fileName ||
      entry.file_name ||
      entry.name ||
      entry.originalName ||
      entry.original_name ||
      responseEntry.filename ||
      responseEntry.fileName ||
      responseEntry.file_name ||
      responseEntry.name ||
      responseEntry.originalName ||
      responseEntry.original_name ||
      responseAsset.filename ||
      responseAsset.fileName ||
      responseAsset.file_name ||
      responseAsset.name ||
      responseAsset.originalName ||
      responseAsset.original_name ||
      ''
  ).trim();
  const normalizedPath = rawPath
    ? rawFilename
      ? rawPath
      : path.posix.dirname(rawPath) || '/'
    : '/';

  return {
    assetId: String(
      entry.id ||
        entry.assetId ||
        entry.asset_id ||
        responseEntry.id ||
        responseEntry.assetId ||
        responseEntry.asset_id ||
        responseAsset.id ||
        responseAsset.assetId ||
        responseAsset.asset_id ||
        ''
    ).trim(),
    filename: rawFilename || (rawPath ? path.posix.basename(rawPath) : ''),
    path: normalizedPath === '.' ? '/' : normalizedPath,
    success:
      Object.prototype.hasOwnProperty.call(entry, 'success') || Object.prototype.hasOwnProperty.call(entry, 'ok')
        ? Boolean(entry.success ?? entry.ok)
        : null,
    message: String(
      entry.message ||
        entry.detail ||
        entry.error ||
        responseEntry.message ||
        responseEntry.detail ||
        responseEntry.error ||
        responseAsset.message ||
        responseAsset.detail ||
        responseAsset.error ||
        ''
    ).trim(),
  };
}

function extractUploadedAssetEntries(payload = {}) {
  const buckets = [
    payload.assets,
    payload.data?.assets,
    payload.results,
    payload.data?.results,
    payload.uploaded,
    payload.data?.uploaded,
    payload.files,
    payload.data?.files,
  ];

  const entries = [];

  for (const bucket of buckets) {
    for (const entry of toAssetArray(bucket)) {
      const normalized = normalizeUploadedAssetEntry(entry);

      if (normalized.assetId || normalized.filename) {
        entries.push(normalized);
      }
    }
  }

  return entries;
}

function normalizeUploadFocusPoint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const x = Number(value.x);
  const y = Number(value.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x,
    y,
  };
}

function normalizeUploadMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const focus = normalizeUploadFocusPoint(value.focus);

  if (!focus) {
    return null;
  }

  return {
    focus,
  };
}

module.exports = ({ strapi }) => ({
  async requestJson(method, path, options = {}) {
    try {
      const normalizedPath = String(path || '').trim();
      const resolvedPath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
      const baseUrl = resolvedPath.startsWith('/api/') ? CDN_AUTH_API_BASE_URL : CDN_API_BASE_URL;
      const response = await fetch(`${baseUrl}${resolvedPath}`, {
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
        message: extractResponseMessage(payload, response.status),
        details: payload?.details || '',
      };
    } catch (error) {
      return {
        success: false,
        status: 0,
        data: null,
        payload: null,
        message: String(error?.message || 'Could not reach Smooth CDN.').trim() || 'Could not reach Smooth CDN.',
        details: '',
      };
    }
  },

  getProjectLabel(baseUrl) {
    const configuredName = String(strapi.config.get('info.name') || '').trim();
    if (configuredName) {
      return configuredName;
    }

    try {
      const url = new URL(baseUrl);
      return url.hostname;
    } catch (error) {
      const host = String(strapi.config.get('server.host') || '').trim();
      return host || 'Strapi';
    }
  },

  buildProjectName(baseUrl, moduleName = '') {
    const projectLabel = this.getProjectLabel(baseUrl);
    const normalizedModuleName = String(moduleName || '').trim();

    if (normalizedModuleName === 'API Accelerator') {
      return `API Accelerator - ${projectLabel}`;
    }

    return normalizedModuleName ? `${normalizedModuleName} - ${projectLabel}` : projectLabel;
  },

  buildLoginLabel() {
    const host = strapi.config.get('server.host') || 'strapi';
    return `strapi-${host}`;
  },

  resolveGuestUrl(current = {}, options = {}) {
    const candidate = String(options.url || current.publicBaseUrl || '').trim().replace(/\/+$/, '');
    if (candidate) {
      return candidate;
    }

    const configuredServerUrl = String(strapi.config.get('server.url') || '').trim().replace(/\/+$/, '');
    if (configuredServerUrl) {
      if (/^https?:\/\//i.test(configuredServerUrl)) {
        return configuredServerUrl;
      }

      const host = strapi.config.get('server.host') || '127.0.0.1';
      const port = strapi.config.get('server.port') || 1337;
      return `http://${host}:${port}${configuredServerUrl.startsWith('/') ? configuredServerUrl : `/${configuredServerUrl}`}`;
    }

    const host = strapi.config.get('server.host') || '127.0.0.1';
    const port = strapi.config.get('server.port') || 1337;
    return `http://${host}:${port}`;
  },

  buildGuestPayload(options = {}, current = {}) {
    const nameCandidate = String(options.name || current.guestName || 'Strapi Guest').trim();
    const urlCandidate = this.resolveGuestUrl(current, options);

    return {
      guest: true,
      name: nameCandidate || 'Strapi Guest',
      url: urlCandidate,
    };
  },

  async createApiKey(sessionToken, label = '') {
    const token = String(sessionToken || '').trim();

    if (!token) {
      return {
        success: false,
        message: 'Missing Smooth CDN session token.',
      };
    }

    if (token.startsWith('scdn_')) {
      return {
        success: true,
        apiKey: token,
      };
    }

    const response = await this.requestJson('POST', '/api-keys', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: {
        label: String(label || '').trim() || `strapi-${Date.now()}`,
      },
    });

    if (!response.success) {
      return {
        success: false,
        message: response.message || 'Could not generate a Smooth CDN API key.',
      };
    }

    const data = response.data && typeof response.data === 'object' ? response.data : {};
    const apiKey = String(data.key || data.api_key || data.apiKey || '').trim();

    if (!apiKey) {
      return {
        success: false,
        message: 'Smooth CDN did not return a valid API key.',
      };
    }

    return {
      success: true,
      apiKey,
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
    const accessToken = String(data.accessToken || data.api_key || data.apiKey || '').trim();

    if (accessToken) {
      const apiKeyResult = await this.createApiKey(
        accessToken,
        guestMode ? `${payload.label || 'strapi'}-guest` : `${payload.label || 'strapi'}-browser`
      );

      if (!apiKeyResult.success) {
        return {
          success: false,
          message: apiKeyResult.message || 'Could not generate a Smooth CDN API key.',
        };
      }

      const storedToken = apiKeyResult.apiKey;

      const connectedSettings = await settingsService.markConnected({
        accessToken: storedToken,
      });
      const synced = await this.syncStatus();
      const nextSettings = synced.success ? synced.settings || connectedSettings : connectedSettings;

      return {
        success: true,
        keyId: '',
        verificationUrl,
        status: 'active',
        settings: nextSettings,
        message: synced.success
          ? 'Connected to Smooth CDN.'
          : 'Connected to Smooth CDN. Account details will refresh shortly.',
      };
    }

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

    const apiKeyResult = await this.createApiKey(accessToken, `strapi-browser-${Date.now()}`);
    if (!apiKeyResult.success) {
      return {
        success: false,
        status: 'error',
        message: apiKeyResult.message || 'Could not generate a Smooth CDN API key.',
      };
    }

    const connectedSettings = await settingsService.markConnected({
      accessToken: apiKeyResult.apiKey,
    });
    const synced = await this.syncStatus();
    const nextSettings = synced.success ? synced.settings || connectedSettings : connectedSettings;

    return {
      success: true,
      status: 'active',
      settings: nextSettings,
      message: synced.success
        ? 'Connected to Smooth CDN.'
        : 'Connected to Smooth CDN. Account details will refresh shortly.',
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

    const response = await this.requestJson('GET', '/status', {
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

    const nextSettings = await settingsService.markStatus({
      connected: true,
      userSlug: extractUserSlug(data) || String(data.slug || '').trim(),
      userName: String(data.name || '').trim(),
      userEmail: String(data.email || '').trim(),
      userPlan: Number.isFinite(Number(data.plan)) ? Number(data.plan) : -1,
      userPlanLabel: planLabel(data.plan),
      moduleProjects: reconcileModuleProjects(current.moduleProjects, projects),
      statusSummary: {
        requests: Number(data?.usage?.requests || 0),
        maxRequests: Number(data?.usage?.maxRequests || data?.limits?.maxRequests || 0),
        bandwidth: Number(data?.usage?.bandwidth || 0),
        maxBandwidth: Number(data?.usage?.maxBandwidth || data?.limits?.bandwidth || 0),
        assetsPerProject: Number(data?.limits?.assetsPerProject || 0),
        periodEnd: String(data?.usage?.periodEnd || '').trim(),
      },
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

  async getProjectToken(moduleId) {
    const settingsService = strapi.plugin('smoothcdn').service('core-settings');
    const settings = await settingsService.get();
    const project = await settingsService.getProject(moduleId);

    if (!settings.connected || !settings.accessToken) {
      return {
        success: false,
        message: 'Connect to Smooth CDN first.',
      };
    }

    if (!project.projectId) {
      return {
        success: false,
        message: 'Create the module project first.',
      };
    }

    const response = await this.requestJson('GET', `/projects/${encodeURIComponent(project.projectId)}`, {
      headers: {
        Authorization: `Bearer ${settings.accessToken}`,
      },
    });

    if (!response.success) {
      return {
        success: false,
        message: response.message || 'Could not fetch the project token.',
      };
    }

    const data = response.data && typeof response.data === 'object' ? response.data : {};
    const token = String(data.token || '').trim();

    if (!token) {
      return {
        success: false,
        message: 'Project token is not available.',
      };
    }

    return {
      success: true,
      token,
      projectId: project.projectId,
    };
  },

  async prepareCreateFreeAccount() {
    const settingsService = strapi.plugin('smoothcdn').service('core-settings');
    const settings = await settingsService.get();

    if (!settings.connected || !settings.accessToken) {
      return {
        success: false,
        message: 'Connect to Smooth CDN first.',
      };
    }

    if (Number(settings.userPlan) !== -1) {
      return {
        success: false,
        message: 'Create free account is only available for guest accounts.',
      };
    }

    const apiKeyResult = await this.createApiKey(
      settings.accessToken,
      `strapi-guest-upgrade-${Date.now()}`
    );

    if (!apiKeyResult.success) {
      return {
        success: false,
        message: apiKeyResult.message || 'Could not prepare the Smooth CDN upgrade flow.',
      };
    }
    const apiKey = String(apiKeyResult.apiKey || '').trim();

    if (apiKey && apiKey !== String(settings.accessToken || '').trim()) {
      await settingsService.update({
        accessToken: apiKey,
      });
    }

    return {
      success: true,
      apiKey,
      autoLoginUrl: `${CDN_AUTH_API_BASE_URL}/api/auth/login/auto`,
      next: '/panel/account/plan-billing/upgrade',
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

    const currentProject = await settingsService.getProject(moduleId);

    if (currentProject.projectId) {
      const currentProjectResponse = await this.requestJson(
        'GET',
        `/projects/${encodeURIComponent(currentProject.projectId)}`,
        {
          headers: {
            Authorization: `Bearer ${current.accessToken}`,
          },
        }
      );

      if (currentProjectResponse.success) {
        const existingProjectData =
          currentProjectResponse.data && typeof currentProjectResponse.data === 'object'
            ? currentProjectResponse.data
            : {};
        const nextSettings = await settingsService.markProjectCreated(moduleId, {
          projectId: String(
            existingProjectData.id ||
              existingProjectData.project_id ||
              existingProjectData?.project?.id ||
              currentProject.projectId
          ).trim(),
          projectSlug: extractProjectSlug(existingProjectData) || String(currentProject.projectSlug || '').trim(),
          projectType: String(
            existingProjectData.type ||
              existingProjectData?.project?.type ||
              currentProject.projectType ||
              definition.projectType ||
              ''
          ).trim(),
          assetsCount: Math.max(
            0,
            Number(
              existingProjectData.assetsCount ||
                existingProjectData.assets_count ||
                existingProjectData?.project?.assetsCount ||
                existingProjectData?.project?.assets_count ||
                currentProject.assetsCount ||
                0
              )
          ),
          customSubdomain: extractCustomSubdomain(existingProjectData) || currentProject.customSubdomain || '',
        });

        return {
          success: true,
          created: false,
          settings: nextSettings,
        };
      }

      if (currentProjectResponse.status !== 404) {
        return {
          success: false,
          message: currentProjectResponse.message || 'Could not verify the existing Smooth CDN project.',
        };
      }
    }

    const projectResponse = await this.requestJson('POST', '/projects', {
      headers: {
        Authorization: `Bearer ${current.accessToken}`,
      },
      payload: {
        name: this.buildProjectName(
          current.publicBaseUrl || strapi.config.get('server.url') || 'strapi',
          definition.name
        ),
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
    const customSubdomain = extractCustomSubdomain(projectData);

    if (!projectId) {
      return {
        success: false,
        message: 'Smooth CDN project creation did not return a valid project ID.',
      };
    }

    const nextSettings = await settingsService.markProjectCreated(moduleId, {
      projectId,
      projectSlug,
      projectType,
      customSubdomain,
    });

    return {
      success: true,
      created: projectResponse.status === 201,
      settings: nextSettings,
    };
  },

  async updateProjectCustomSubdomain(moduleId, customSubdomain = '') {
    const settingsService = strapi.plugin('smoothcdn').service('core-settings');
    const settings = await settingsService.get();
    let project = await settingsService.getProject(moduleId);
    const normalizedCustomSubdomain = normalizeCustomSubdomain(customSubdomain);

    if (String(customSubdomain || '').trim() && !normalizedCustomSubdomain) {
      return {
        success: false,
        message: 'Provide a valid Smooth CDN subdomain, for example "my-project".',
      };
    }

    if (!settings.connected || !settings.accessToken) {
      return {
        success: false,
        message: 'Connect to Smooth CDN before updating the project subdomain.',
      };
    }

    if (!project.projectId) {
      const ensureResult = await this.ensureProject(moduleId);

      if (!ensureResult.success) {
        return ensureResult;
      }

      project = await settingsService.getProject(moduleId);
    }

    if (!project.projectId) {
      return {
        success: false,
        message: 'Create the Smooth CDN project before updating the custom subdomain.',
      };
    }

    const response = await this.requestJson(
      'PATCH',
      `/projects/${encodeURIComponent(project.projectId)}`,
      {
        headers: {
          Authorization: `Bearer ${settings.accessToken}`,
        },
        payload: {
          customSubdomain: normalizedCustomSubdomain,
        },
      }
    );

    if (!response.success) {
      return {
        success: false,
        message: response.message || 'Could not update the Smooth CDN project subdomain.',
      };
    }

    const projectData = response.data && typeof response.data === 'object' ? response.data : {};
    const nextSettings = await settingsService.markProjectCreated(moduleId, {
      ...project,
      projectId: String(projectData.id || projectData.project_id || projectData?.project?.id || project.projectId).trim(),
      projectSlug: extractProjectSlug(projectData) || project.projectSlug,
      projectType: String(projectData.type || projectData?.project?.type || project.projectType || '').trim(),
      assetsCount: Math.max(
        0,
        Number(
          projectData.assetsCount ||
            projectData.assets_count ||
            projectData?.project?.assetsCount ||
            projectData?.project?.assets_count ||
            project.assetsCount ||
            0
        )
      ),
      customSubdomain: extractCustomSubdomain(projectData) || normalizedCustomSubdomain,
    });

    return {
      success: true,
      settings: nextSettings,
      customSubdomain: extractCustomSubdomain(projectData) || normalizedCustomSubdomain,
    };
  },

  async uploadAssets(assets = [], moduleId = '', options = {}) {
    const settingsService = strapi.plugin('smoothcdn').service('core-settings');
    const settings = await settingsService.get();
    const project = await settingsService.getProject(moduleId);

    if (!settings.connected || !settings.accessToken || !project.projectId) {
      return {
        success: false,
        message: 'Connect to Smooth CDN and create a project first.',
        results: {},
      };
    }

    const normalizedAssets = (Array.isArray(assets) ? assets : [])
      .map((asset) => {
        const route = normalizeRoute(asset?.route);
        const hasBody = Object.prototype.hasOwnProperty.call(asset || {}, 'body') && asset.body !== undefined && asset.body !== null;

        if (!route || (!hasBody && (typeof asset?.json !== 'string' || !asset.json))) {
          return null;
        }

        const target = asset.uploadTarget || buildUploadTarget(route);

        return {
          route,
          path: String(target.path || '/'),
          filename: String(asset?.filename || target.filename || 'asset.json'),
          protected: Boolean(asset.protected),
          meta: normalizeUploadMeta(asset?.meta),
          body: hasBody ? asset.body : String(asset.json),
          contentType: String(asset?.contentType || (hasBody ? 'application/octet-stream' : 'application/json')).trim(),
        };
      })
      .filter(Boolean);

    const batchSize = Math.max(1, Number(options.batchSize) || normalizedAssets.length || 1);
    const groups = new Map();
    for (const asset of normalizedAssets) {
      const key = `${asset.path}|${asset.protected ? '1' : '0'}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key).push(asset);
    }

    const results = {};

    for (const group of groups.values()) {
      for (let startIndex = 0; startIndex < group.length; startIndex += batchSize) {
        const chunk = group.slice(startIndex, startIndex + batchSize);
        const sample = chunk[0];
        const form = new FormData();
        form.set('projectId', project.projectId);
        form.set('path', sample.path);
        form.set('protected', sample.protected ? '1' : '0');
        form.set('force', '0');

        for (const asset of chunk) {
          form.append(
            'assets',
            new Blob([asset.body], { type: asset.contentType || 'application/octet-stream' }),
            asset.filename
          );
          form.append('meta', JSON.stringify(asset.meta || {}));
        }

        console.log('[smoothcdn] Upload API payload preview', {
          moduleId: String(moduleId || '').trim(),
          projectId: project.projectId,
          path: sample.path,
          protected: sample.protected ? '1' : '0',
          force: '0',
          assets: chunk.map((asset) => ({
            route: asset.route,
            filename: asset.filename,
            contentType: asset.contentType || 'application/octet-stream',
            meta: asset.meta || {},
            size: Buffer.isBuffer(asset.body)
              ? asset.body.length
              : typeof asset.body === 'string'
                ? Buffer.byteLength(asset.body)
                : 0,
          })),
        });

        let response;
        let payload = {};

        try {
          response = await fetch(CDN_UPLOAD_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${settings.accessToken}`,
            },
            body: form,
          });

          const text = await response.text();
          payload = safeJsonParse(text, {});
        } catch (error) {
          response = {
            ok: false,
          };
          payload = {
            message: String(error?.message || 'Could not reach Smooth CDN.').trim(),
          };
        }

        const uploadedEntries = extractUploadedAssetEntries(payload);
        const usedIndexes = new Set();

        for (const [assetIndex, asset] of chunk.entries()) {
          let matchedIndex = uploadedEntries.findIndex(
            (entry, entryIndex) => !usedIndexes.has(entryIndex) && entry.filename === asset.filename
          );

          if (matchedIndex < 0 && uploadedEntries.length === chunk.length) {
            matchedIndex = assetIndex;
          }

          const matchedEntry = matchedIndex >= 0 ? uploadedEntries[matchedIndex] || null : null;

          if (matchedIndex >= 0) {
            usedIndexes.add(matchedIndex);
          }

          results[asset.route] = {
            success: matchedEntry?.success ?? response.ok,
            message:
              String(matchedEntry?.message || '').trim() ||
              payload?.message ||
              payload?.error?.message ||
              '',
            details: payload?.details || '',
            assetId: String(matchedEntry?.assetId || '').trim(),
            responsePayload: payload,
            path: sample.path,
            filename: asset.filename,
          };
        }
      }
    }

    return {
      success: Object.values(results).every((result) => result.success),
      results,
      message: Object.values(results).find((result) => !result.success)?.message || '',
    };
  },

  async deleteAssets(targets = [], moduleId = '') {
    const settingsService = strapi.plugin('smoothcdn').service('core-settings');
    const settings = await settingsService.get();
    const project = await settingsService.getProject(moduleId);

    if (!settings.connected || !settings.accessToken || !project.projectId) {
      return {
        success: false,
        message: 'Connect to Smooth CDN and create a project first.',
      };
    }

    const normalizedTargets = (Array.isArray(targets) ? targets : [])
      .map((entry) => ({
        path: String(entry?.path || '/').trim() || '/',
        filename: String(entry?.filename || '').trim(),
      }))
      .filter((entry) => entry.filename);

    if (normalizedTargets.length === 0) {
      return {
        success: true,
        deleted: 0,
      };
    }

    const groups = new Map();
    for (const target of normalizedTargets) {
      const key = String(target.path || '/').trim() || '/';

      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key).push(target);
    }

    let bulkDeleteSucceeded = true;
    let bulkDeleteMessage = '';

    for (const [groupPath, groupTargets] of groups.entries()) {
      const form = new FormData();
      form.set('projectId', project.projectId);
      form.set('path', groupPath);

      for (const target of groupTargets) {
        form.append('assets', target.filename);
      }

      let response;
      let payload = {};

      try {
        response = await fetch(CDN_DELETE_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${settings.accessToken}`,
          },
          body: form,
        });

        const text = await response.text();
        payload = safeJsonParse(text, {});
      } catch (error) {
        response = {
          ok: false,
          status: 0,
        };
        payload = {
          message: String(error?.message || 'Could not reach Smooth CDN.').trim(),
        };
      }

      if (!response.ok) {
        bulkDeleteSucceeded = false;
        bulkDeleteMessage = extractResponseMessage(payload, response.status) || 'Could not delete assets from Smooth CDN.';
        break;
      }
    }

    if (bulkDeleteSucceeded) {
      return {
        success: true,
        deleted: normalizedTargets.length,
        message: '',
      };
    }

    const response = await this.requestJson(
      'DELETE',
      `/projects/${encodeURIComponent(project.projectId)}/assets/bulk`,
      {
        headers: {
          Authorization: `Bearer ${settings.accessToken}`,
        },
        payload: {
          assets: normalizedTargets,
        },
      }
    );

    return {
      success: response.success,
      deleted: normalizedTargets.length,
      message: response.success ? response.message : (response.message || bulkDeleteMessage),
    };
  },

  async deleteRouteAssets(routes = [], moduleId = '') {
    const repository = strapi.plugin('smoothcdn').service('api-accelerator-repository');
    const targets = [];

    for (const route of routes) {
      const entry = await repository.get(route);
      if (!entry || entry.syncStatus !== 'uploaded') {
        continue;
      }

      const fileCount = Math.max(1, Number(entry?.syncedFileCount || 1));
      const uploadTargets = buildUploadTargetsForRouteAssets(entry?.assetRoute || route, fileCount);

      for (const target of uploadTargets) {
        targets.push({
          path: target.path,
          filename: target.filename,
        });
      }
    }

    return this.deleteAssets(targets, moduleId);
  },

  async optimizeAsset(assetId = '', moduleId = '', options = {}) {
    const settingsService = strapi.plugin('smoothcdn').service('core-settings');
    const settings = await settingsService.get();
    const project = await settingsService.getProject(moduleId);
    const normalizedAssetId = String(assetId || '').trim();

    if (!settings.connected || !settings.accessToken || !project.projectId) {
      return {
        success: false,
        message: 'Connect to Smooth CDN and create a project first.',
      };
    }

    if (!normalizedAssetId) {
      return {
        success: false,
        message: 'Missing Smooth CDN asset ID.',
      };
    }

    const response = await this.requestJson(
      'POST',
      `/projects/${encodeURIComponent(project.projectId)}/assets/${encodeURIComponent(normalizedAssetId)}/optimize`,
      {
        headers: {
          Authorization: `Bearer ${settings.accessToken}`,
        },
        payload: {
          force: options.force === true ? 'true' : 'false',
        },
      }
    );

    return {
      success: response.success,
      message: response.message || '',
      data: response.data || null,
    };
  },

  buildPublicUrlForUploadTarget(path, filename, settings) {
    if (!filename) {
      return '';
    }

    const normalizedPath = String(path || '/').trim() === '/'
      ? ''
      : `/${String(path || '').trim().replace(/^\/+|\/+$/g, '')}`;
    const customSubdomain = normalizeCustomSubdomain(settings.customSubdomain);

    if (customSubdomain) {
      return `https://${customSubdomain}.smoothcdn.com${normalizedPath}/${encodeURIComponent(filename)}`;
    }

    if (!settings.userSlug || !settings.projectSlug) {
      return '';
    }

    return `${CDN_PUBLIC_HOST}/${encodeURIComponent(settings.userSlug)}/${encodeURIComponent(
      settings.projectSlug
    )}${normalizedPath}/${encodeURIComponent(filename)}`;
  },
});
