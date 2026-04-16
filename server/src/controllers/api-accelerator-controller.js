'use strict';

const pluginId = require('../plugin-id');

function plugin(strapi) {
  return strapi.plugin(pluginId);
}

async function ensureEnabled(strapi, ctx) {
  const enabled = await plugin(strapi).service('module-registry').isEnabled('api-accelerator');
  if (enabled) {
    return true;
  }

  ctx.status = 400;
  ctx.body = {
    error: {
      message: 'Enable the API Accelerator module first.',
    },
  };

  return false;
}

module.exports = ({ strapi }) => ({
  async updateSettings(ctx) {
    const settingsService = plugin(strapi).service('api-accelerator-settings');
    const previousSettings = await settingsService.get();
    const settings = await settingsService.update(ctx.request.body || {});
    const enabled = await plugin(strapi).service('module-registry').isEnabled('api-accelerator');
    const protectedAssetsChanged = previousSettings.protectedAssets !== settings.protectedAssets;
    const collectionPageSizeChanged =
      Number(previousSettings.collectionSyncPerPage) !== Number(settings.collectionSyncPerPage);
    let discoveryResult = null;
    let syncResult = null;

    if (enabled && (protectedAssetsChanged || collectionPageSizeChanged)) {
      await plugin(strapi).service('api-accelerator-sync').forceResetSyncState(
        'Sync state was reset after API Accelerator settings changed.'
      );
    }

    if (enabled && collectionPageSizeChanged) {
      discoveryResult = await plugin(strapi).service('api-accelerator-discovery').discover();
    }

    if (enabled && (protectedAssetsChanged || collectionPageSizeChanged)) {
      syncResult = await plugin(strapi).service('api-accelerator-sync').startManualSyncJob([], {
        trigger: 'settings_change',
        forceUpload: protectedAssetsChanged,
      });
    }

    const endpoints = enabled
      ? await plugin(strapi).service('api-accelerator-repository').all()
      : [];

    ctx.body = {
      data: {
        settings,
        endpoints,
        discoveryResult,
        syncJob: syncResult?.job || null,
        syncTriggered: Boolean(syncResult?.success && syncResult?.job),
        scanTriggered: Boolean(discoveryResult),
      },
    };
  },

  async discover(ctx) {
    if (!(await ensureEnabled(strapi, ctx))) {
      return;
    }

    const result = await plugin(strapi).service('api-accelerator-discovery').discover({
      contentTypes: ctx.request.body?.contentTypes || [],
    });
    const endpoints = await plugin(strapi).service('api-accelerator-repository').all();

    ctx.body = {
      data: {
        result,
        endpoints,
      },
    };
  },

  async sync(ctx) {
    if (!(await ensureEnabled(strapi, ctx))) {
      return;
    }

    const result = await plugin(strapi).service('api-accelerator-sync').startManualSyncJob(ctx.request.body?.routes || [], {
      trigger: 'manual',
      restrictContentTypes: ctx.request.body?.contentTypes || [],
    });

    ctx.body = {
      data: {
        result,
        job: result.job || null,
      },
    };
    ctx.status = result.success ? 202 : result.busy ? 409 : 400;
  },

  async syncStatus(ctx) {
    if (!(await ensureEnabled(strapi, ctx))) {
      return;
    }

    const job = await plugin(strapi).service('api-accelerator-sync').getSyncJobStatus();

    ctx.body = {
      data: {
        job,
      },
    };
  },

  async setSyncable(ctx) {
    if (!(await ensureEnabled(strapi, ctx))) {
      return;
    }

    const route = ctx.request.body?.route;
    const routes = Array.isArray(ctx.request.body?.routes) ? ctx.request.body.routes : [];
    const syncable = Boolean(ctx.request.body?.syncable);
    const normalizedRoutes = Array.from(
      new Set(
        [...routes, route]
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      )
    );

    if (normalizedRoutes.length === 0) {
      ctx.status = 400;
      ctx.body = {
        error: {
          message: 'Provide at least one endpoint route.',
        },
      };
      return;
    }

    if (!syncable) {
      const purgeResult = await plugin(strapi).service('api-accelerator-sync').purgeRoutes(normalizedRoutes);

      if (!purgeResult.success) {
        ctx.status = 400;
        ctx.body = {
          error: {
            message: purgeResult.message || 'Could not delete synced assets from Smooth CDN.',
          },
          data: {
            result: purgeResult,
            endpoints: await plugin(strapi).service('api-accelerator-repository').all(),
          },
        };
        return;
      }
    }

    const entries = await plugin(strapi).service('api-accelerator-repository').setSyncableMany(normalizedRoutes, syncable);

    if (entries.length === 0) {
      ctx.status = 404;
      ctx.body = {
        error: {
          message: 'Endpoint not found.',
        },
      };
      return;
    }

    ctx.body = {
      data: {
        entries,
      },
    };
  },

  async purge(ctx) {
    if (!(await ensureEnabled(strapi, ctx))) {
      return;
    }

    const routes = ctx.request.body?.routes || [];
    const result = await plugin(strapi).service('api-accelerator-sync').purgeRoutes(routes);
    const endpoints = await plugin(strapi).service('api-accelerator-repository').all();

    ctx.body = {
      data: {
        result,
        endpoints,
      },
    };
    ctx.status = result.success ? 200 : 400;
  },
});
