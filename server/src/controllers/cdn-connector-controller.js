'use strict';

const pluginId = require('../plugin-id');

function plugin(strapi) {
  return strapi.plugin(pluginId);
}

async function ensureEnabled(strapi, ctx) {
  const enabled = await plugin(strapi).service('module-registry').isEnabled('cdn-connector');

  if (enabled) {
    return true;
  }

  ctx.status = 400;
  ctx.body = {
    error: {
      message: 'Enable the CDN Connector module first.',
    },
  };

  return false;
}

module.exports = ({ strapi }) => ({
  async updateSettings(ctx) {
    const settingsService = plugin(strapi).service('cdn-connector-settings');
    const coreSettingsService = plugin(strapi).service('core-settings');
    const smoothClient = plugin(strapi).service('smooth-client');
    const syncService = plugin(strapi).service('cdn-connector-sync');
    const offloadService = plugin(strapi).service('cdn-connector-offload');
    const payload = ctx.request.body || {};
    const previousSettings = await settingsService.get();
    const previousProject = await coreSettingsService.getProject('cdn-connector');
    const nextCustomSubdomain = String(payload.customSubdomain || '').trim();
    const customSubdomainChanged = nextCustomSubdomain !== String(previousProject.customSubdomain || '').trim();

    if (customSubdomainChanged) {
      const projectResult = await smoothClient.updateProjectCustomSubdomain('cdn-connector', nextCustomSubdomain);

      if (!projectResult.success) {
        ctx.status = 400;
        ctx.body = {
          error: {
            message: projectResult.message || 'Could not update the Smooth CDN project subdomain.',
          },
        };
        return;
      }
    }

    const settings = await settingsService.update(payload);
    const enabled = await plugin(strapi).service('module-registry').isEnabled('cdn-connector');
    const shouldResync =
      previousSettings.protectedAssets !== settings.protectedAssets ||
      (previousSettings.offloadLocalFiles !== settings.offloadLocalFiles && settings.offloadLocalFiles);
    let syncResult = null;

    offloadService.invalidateCache();

    if (enabled && shouldResync) {
      syncResult = await syncService.startSyncJob([], {
        trigger: 'settings_change',
        force: true,
      });
    }

    const project = await coreSettingsService.getProject('cdn-connector');

    ctx.body = {
      data: {
        settings: {
          ...settings,
          customSubdomain: project.customSubdomain || '',
        },
        project,
        mediaItems: await syncService.listMediaItems(),
        syncResult,
        syncJob: syncResult?.job || null,
        syncTriggered: Boolean(syncResult?.success && syncResult?.job),
      },
    };
  },

  async sync(ctx) {
    if (!(await ensureEnabled(strapi, ctx))) {
      return;
    }

    const fileIds = Array.isArray(ctx.request.body?.fileIds)
      ? ctx.request.body.fileIds
      : ctx.request.body?.fileId
        ? [ctx.request.body.fileId]
        : [];
    const result = await plugin(strapi).service('cdn-connector-sync').startSyncJob(fileIds, {
      trigger: 'manual',
      force: Boolean(ctx.request.body?.force),
    });

    ctx.body = {
      data: {
        result,
        job: result.job || null,
        mediaItems: await plugin(strapi).service('cdn-connector-sync').listMediaItems(),
      },
    };
    ctx.status = result.success ? 202 : result.busy ? 409 : 400;
  },

  async unsync(ctx) {
    if (!(await ensureEnabled(strapi, ctx))) {
      return;
    }

    const fileIds = Array.isArray(ctx.request.body?.fileIds)
      ? ctx.request.body.fileIds
      : ctx.request.body?.fileId
        ? [ctx.request.body.fileId]
        : [];
    const result = await plugin(strapi).service('cdn-connector-sync').unsyncMediaItems(fileIds);

    ctx.body = {
      data: {
        result,
        mediaItems: await plugin(strapi).service('cdn-connector-sync').listMediaItems(),
      },
    };
    ctx.status = result.success ? 200 : 400;
  },

  async syncStatus(ctx) {
    if (!(await ensureEnabled(strapi, ctx))) {
      return;
    }

    const job = await plugin(strapi).service('cdn-connector-sync').getSyncJobStatus();

    ctx.body = {
      data: {
        job,
      },
    };
  },
});
