'use strict';

const { randomUUID } = require('node:crypto');

const {
  MAX_SYNC_PAGES,
  SCHEDULER_POLL_MS,
} = require('../../../utils/constants');
const {
  buildUploadTarget,
  md5,
  nowIso,
  parseIntervalFrequency,
} = require('../../../utils/helpers');

module.exports = ({ strapi }) => {
  const instanceId = randomUUID();
  let schedulerHandle = null;
  let isRunning = false;

  async function isModuleEnabled() {
    return strapi.plugin('smoothcdn').service('module-registry').isEnabled('api-accelerator');
  }

  function collectionPageTarget(route, page) {
    const manifestTarget = buildUploadTarget(route);
    const baseName = manifestTarget.filename.replace(/\.json$/i, '');
    const pagePath = manifestTarget.path === '/'
      ? `/${baseName}`
      : `${manifestTarget.path}/${baseName}`;

    return {
      path: pagePath,
      filename: `page-${page}.json`,
    };
  }

  async function buildCollectionAssets(entry, settings) {
    const originFetcher = strapi.plugin('smoothcdn').service('api-accelerator-origin-fetcher');
    const smoothClient = strapi.plugin('smoothcdn').service('smooth-client');
    const pageSize = settings.collectionSyncPerPage;
    const pages = [];
    const pageUrls = [];

    for (let page = 1; page <= MAX_SYNC_PAGES; page += 1) {
      const response = await originFetcher.fetchJson(entry.route, {
        settings,
        query: {
          'pagination[page]': page,
          'pagination[pageSize]': pageSize,
        },
      });

      if (!response.success) {
        return {
          success: false,
          message: response.errorMessage || `Could not fetch ${entry.route}.`,
          httpStatus: response.status,
        };
      }

      const data = Array.isArray(response.data) ? response.data : [];
      if (data.length === 0) {
        break;
      }

      const target = collectionPageTarget(entry.route, page);

      pages.push({
        route: `${entry.route}#page-${page}`,
        uploadTarget: target,
        json: JSON.stringify(response.raw ?? { data, meta: response.meta }, null, 2),
      });

      const publicUrl = smoothClient.buildPublicUrlForUploadTarget(target.path, target.filename, settings);
      pageUrls.push(publicUrl || `${target.path}/${target.filename}`);

      const pageCount = Number(response.meta?.pagination?.pageCount || 1);
      if (page >= pageCount || data.length < pageSize) {
        break;
      }
    }

    if (pages.length === 0) {
      return {
        success: false,
        message: `Collection ${entry.route} returned no data.`,
        httpStatus: 404,
      };
    }

    const manifestTarget = buildUploadTarget(entry.route);
    const manifest = JSON.stringify(
      {
        per_page: pageSize,
        total_pages: pages.length,
        pages: pageUrls,
      },
      null,
      2
    );

    return {
      success: true,
      httpStatus: 200,
      assets: [
        {
          route: entry.route,
          uploadTarget: manifestTarget,
          json: manifest,
        },
        ...pages,
      ],
      jsonHash: md5([manifest, ...pages.map((asset) => asset.json)].join(':')),
      jsonSize: pages.reduce((sum, asset) => sum + Buffer.byteLength(asset.json), Buffer.byteLength(manifest)),
      syncedFileCount: pages.length + 1,
    };
  }

  async function buildSingleAsset(entry, settings) {
    const originFetcher = strapi.plugin('smoothcdn').service('api-accelerator-origin-fetcher');
    const response = await originFetcher.fetchJson(entry.route, { settings });

    if (!response.success) {
      return {
        success: false,
        message: response.errorMessage || `Could not fetch ${entry.route}.`,
        httpStatus: response.status,
      };
    }

    const json = JSON.stringify(response.raw ?? { data: response.data, meta: response.meta }, null, 2);

    return {
      success: true,
      httpStatus: response.status,
      assets: [
        {
          route: entry.route,
          uploadTarget: buildUploadTarget(entry.route),
          json,
        },
      ],
      jsonHash: md5(json),
      jsonSize: Buffer.byteLength(json),
      syncedFileCount: 1,
    };
  }

  async function purgeRemovedRoutes(discoverySummary) {
    const uploadedRemovedRoutes = (discoverySummary.removed || [])
      .filter((entry) => entry.syncStatus === 'uploaded')
      .map((entry) => entry.route);

    if (uploadedRemovedRoutes.length === 0) {
      return;
    }

    await strapi.plugin('smoothcdn').service('smooth-client').deleteRouteAssets(uploadedRemovedRoutes);
  }

  return {
    async discoverAndSync(options = {}) {
      if (!(await isModuleEnabled())) {
        return {
          success: false,
          message: 'Enable the API Accelerator module first.',
          processed: 0,
          synced: 0,
          failed: 0,
        };
      }

      const discovery = await strapi.plugin('smoothcdn').service('api-accelerator-discovery').discover(options);
      await purgeRemovedRoutes(discovery);
      return this.syncRoutes([], {
        ...options,
        trigger: options.trigger || 'manual',
        restrictContentTypes: options.contentTypes || [],
      });
    },

    async syncRoutes(routes = [], options = {}) {
      if (!(await isModuleEnabled())) {
        return {
          success: false,
          message: 'Enable the API Accelerator module first.',
          processed: 0,
          synced: 0,
          failed: 0,
        };
      }

      if (isRunning) {
        return {
          success: false,
          message: 'Sync is already running.',
          processed: 0,
          synced: 0,
          failed: 0,
        };
      }

      const runtimeState = strapi.plugin('smoothcdn').service('api-accelerator-runtime-state');
      const lockOwner = `${instanceId}:sync:${Date.now()}`;
      const lockClaimed = await runtimeState.claimLock('syncLock', lockOwner, 15 * 60 * 1000);

      if (!lockClaimed) {
        return {
          success: false,
          busy: true,
          message: 'Sync is already running.',
          processed: 0,
          synced: 0,
          failed: 0,
        };
      }

      isRunning = true;

      try {
        const settings = await strapi.plugin('smoothcdn').service('api-accelerator-settings').getResolved();
        const repository = strapi.plugin('smoothcdn').service('api-accelerator-repository');
        const smoothClient = strapi.plugin('smoothcdn').service('smooth-client');

        if (!settings.connected) {
          return {
            success: false,
            message: 'Connect to Smooth CDN first.',
            processed: 0,
            synced: 0,
            failed: 0,
          };
        }

        const requestedRoutes = Array.isArray(routes) ? routes.filter(Boolean) : [];
        let candidates = await repository.findSyncable({
          routes: requestedRoutes.length > 0 ? requestedRoutes : undefined,
        });

        if (Array.isArray(options.restrictContentTypes) && options.restrictContentTypes.length > 0) {
          const allowed = new Set(options.restrictContentTypes);
          candidates = candidates.filter((entry) => allowed.has(entry.contentTypeUid));
        }

        const summary = {
          success: true,
          processed: candidates.length,
          synced: 0,
          failed: 0,
          skipped: 0,
        };

        for (const entry of candidates) {
          await runtimeState.refreshLock('syncLock', lockOwner, 15 * 60 * 1000);

          const result = entry.kind === 'collection'
            ? await buildCollectionAssets(entry, settings)
            : await buildSingleAsset(entry, settings);

          if (!result.success) {
            await repository.upsert({
              ...entry,
              status: 'error',
              syncStatus: 'fetch_failed',
              httpStatus: result.httpStatus || 500,
              lastError: result.message,
            });
            summary.failed += 1;
            summary.success = false;
            continue;
          }

          if (entry.lastSyncedHash && entry.lastSyncedHash === result.jsonHash) {
            await repository.upsert({
              ...entry,
              status: 'ready',
              syncStatus: 'uploaded',
              httpStatus: result.httpStatus,
              jsonSize: result.jsonSize,
              syncedFileCount: result.syncedFileCount,
              lastError: '',
            });
            summary.skipped += 1;
            continue;
          }

          const upload = await smoothClient.uploadAssets(
            result.assets.map((asset) => ({
              ...asset,
              protected: settings.protectedAssets,
            }))
          );

          if (!upload.success) {
            await repository.upsert({
              ...entry,
              status: 'error',
              syncStatus: 'upload_failed',
              httpStatus: result.httpStatus,
              jsonSize: result.jsonSize,
              syncedFileCount: result.syncedFileCount,
              lastError: upload.message || 'Could not upload assets to Smooth CDN.',
            });
            summary.failed += 1;
            summary.success = false;
            continue;
          }

          await repository.upsert({
            ...entry,
            status: 'ready',
            syncStatus: 'uploaded',
            httpStatus: result.httpStatus,
            jsonSize: result.jsonSize,
            syncedFileCount: result.syncedFileCount,
            lastSyncedHash: result.jsonHash,
            lastSyncedAt: nowIso(),
            lastError: '',
          });
          summary.synced += 1;
        }

        await strapi.plugin('smoothcdn').service('api-accelerator-settings').update({
          lastSyncAt: nowIso(),
          ...(options.trigger === 'scheduled' ? { lastAutoSyncAt: nowIso() } : {}),
        });

        return summary;
      } finally {
        isRunning = false;
        await runtimeState.releaseLock('syncLock', lockOwner);
      }
    },

    async queueContentType(uid) {
      if (!(await isModuleEnabled())) {
        return;
      }

      const normalizedUid = String(uid || '').trim();
      if (!normalizedUid.startsWith('api::')) {
        return;
      }

      const settings = await strapi.plugin('smoothcdn').service('api-accelerator-settings').get();
      await strapi.plugin('smoothcdn').service('api-accelerator-runtime-state').queueContentTypes(
        [normalizedUid],
        settings.debounceMs
      );
    },

    async flushPendingContentChanges() {
      if (!(await isModuleEnabled())) {
        return {
          processed: 0,
        };
      }

      const settings = await strapi.plugin('smoothcdn').service('api-accelerator-settings').getResolved();
      const runtimeState = strapi.plugin('smoothcdn').service('api-accelerator-runtime-state');
      const contentTypes = await runtimeState.takeDuePendingContentTypes();

      if (contentTypes.length === 0) {
        return {
          processed: 0,
        };
      }

      try {
        const discovery = await strapi.plugin('smoothcdn').service('api-accelerator-discovery').discover({
          settings,
          contentTypes,
        });
        await purgeRemovedRoutes(discovery);

        const syncResult = await this.syncRoutes([], {
          trigger: 'content_change',
          restrictContentTypes: contentTypes,
        });

        if (syncResult.busy) {
          await runtimeState.requeueContentTypes(contentTypes, settings.debounceMs);
        }

        return {
          processed: contentTypes.length,
          syncResult,
        };
      } catch (error) {
        await runtimeState.requeueContentTypes(contentTypes, settings.debounceMs);
        throw error;
      }
    },

    async runScheduledSync() {
      if (!(await isModuleEnabled())) {
        return;
      }

      const settings = await strapi.plugin('smoothcdn').service('api-accelerator-settings').getResolved();
      const intervalMs = parseIntervalFrequency(settings.autoSyncFrequency);

      if (!intervalMs) {
        return;
      }

      const lastRun = settings.lastAutoSyncAt ? new Date(settings.lastAutoSyncAt).getTime() : 0;
      if (Date.now() - lastRun < intervalMs) {
        return;
      }

      const discovery = await strapi.plugin('smoothcdn').service('api-accelerator-discovery').discover({ settings });
      await purgeRemovedRoutes(discovery);
      await this.syncRoutes([], {
        trigger: 'scheduled',
      });
    },

    async tickScheduler() {
      if (!(await isModuleEnabled())) {
        return;
      }

      const runtimeState = strapi.plugin('smoothcdn').service('api-accelerator-runtime-state');
      const lockOwner = `${instanceId}:scheduler:${Date.now()}`;
      const lockClaimed = await runtimeState.claimLock(
        'schedulerLock',
        lockOwner,
        Math.max(5000, SCHEDULER_POLL_MS - 1000)
      );

      if (!lockClaimed) {
        return;
      }

      try {
        await this.flushPendingContentChanges();
        await this.runScheduledSync();
      } finally {
        await runtimeState.releaseLock('schedulerLock', lockOwner);
      }
    },

    startScheduler() {
      if (schedulerHandle) {
        return;
      }

      schedulerHandle = setInterval(() => {
        this.tickScheduler().catch((error) => {
          strapi.log.error(`[smoothcdn] Scheduled sync failed: ${error.message}`);
        });
      }, SCHEDULER_POLL_MS);

      this.tickScheduler().catch((error) => {
        strapi.log.error(`[smoothcdn] Initial scheduler tick failed: ${error.message}`);
      });
    },

    stopScheduler() {
      if (schedulerHandle) {
        clearInterval(schedulerHandle);
        schedulerHandle = null;
      }
    },

    async purgeRoutes(routes = []) {
      if (!(await isModuleEnabled())) {
        return {
          success: false,
          message: 'Enable the API Accelerator module first.',
          deleted: 0,
        };
      }

      const repository = strapi.plugin('smoothcdn').service('api-accelerator-repository');
      const normalizedRoutes = Array.isArray(routes) ? routes.filter(Boolean) : [];
      const deletion = await strapi.plugin('smoothcdn').service('smooth-client').deleteRouteAssets(normalizedRoutes);

      for (const route of normalizedRoutes) {
        const current = await repository.get(route);
        if (!current) {
          continue;
        }

        await repository.upsert({
          ...current,
          syncStatus: 'detected',
          syncedFileCount: 0,
          lastSyncedHash: '',
          lastSyncedAt: '',
          lastError: '',
        });
      }

      return deletion;
    },
  };
};
