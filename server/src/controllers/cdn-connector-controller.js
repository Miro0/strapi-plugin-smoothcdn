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
    const syncService = plugin(strapi).service('cdn-connector-sync');
    const offloadService = plugin(strapi).service('cdn-connector-offload');
    const previousSettings = await settingsService.get();
    const settings = await settingsService.update(ctx.request.body || {});
    const enabled = await plugin(strapi).service('module-registry').isEnabled('cdn-connector');
    const shouldResync =
      previousSettings.protectedAssets !== settings.protectedAssets ||
      previousSettings.syncAllFormats !== settings.syncAllFormats ||
      (previousSettings.offloadLocalFiles !== settings.offloadLocalFiles && settings.offloadLocalFiles);
    let syncResult = null;

    offloadService.invalidateCache();

    if (enabled && shouldResync) {
      syncResult = await syncService.startSyncJob([], {
        trigger: 'settings_change',
        force: true,
      });
    }

    ctx.body = {
      data: {
        settings,
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
