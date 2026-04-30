'use strict';

const { randomUUID } = require('node:crypto');
const { extname } = require('node:path');
const { URL } = require('node:url');

const { CDN_CONNECTOR_UPLOAD_BATCH_SIZE } = require('../../../utils/constants');
const { nowIso, parseIntervalFrequency } = require('../../../utils/helpers');

function plugin(strapi) {
  return strapi.plugin('smoothcdn');
}

function normalizeMediaId(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

function formatVariantLabel(key) {
  const normalized = String(key || '').trim();

  if (!normalized || normalized === 'original') {
    return 'Original';
  }

  return normalized
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function resolveExt(value, fallbackUrl = '', mime = '') {
  const direct = String(value || '').trim();
  if (direct) {
    return direct.startsWith('.') ? direct : `.${direct}`;
  }

  const fromUrl = extname(String(fallbackUrl || '').split('?')[0] || '');
  if (fromUrl) {
    return fromUrl;
  }

  switch (String(mime || '').trim()) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/avif':
      return '.avif';
    case 'image/gif':
      return '.gif';
    case 'image/svg+xml':
      return '.svg';
    default:
      return '';
  }
}

function normalizeTimestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeFocusAxis(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const normalized = Number.parseFloat(raw.replace('%', ''));
  if (!Number.isFinite(normalized)) {
    return null;
  }

  const usesPercentSyntax = raw.includes('%');
  const percentValue = !usesPercentSyntax && normalized >= 0 && normalized <= 1 ? normalized * 100 : normalized;

  return Math.round(Math.max(0, Math.min(100, percentValue)));
}

function normalizeFocusPoint(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const x = normalizeFocusAxis(value[0]);
    const y = normalizeFocusAxis(value[1]);

    if (x === null || y === null) {
      return null;
    }

    return {
      x,
      y,
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const x = normalizeFocusAxis(
    value.x ??
    value.left ??
    value.leftPercent ??
    value.leftPercentage ??
    value.percentX ??
    value.percentageX ??
    value.focusX ??
    value.focus_x ??
    value.cx
  );
  const y = normalizeFocusAxis(
    value.y ??
    value.top ??
    value.topPercent ??
    value.topPercentage ??
    value.percentY ??
    value.percentageY ??
    value.focusY ??
    value.focus_y ??
    value.cy
  );

  if (x === null || y === null) {
    return null;
  }

  return {
    x,
    y,
  };
}

function parseJsonObject(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

function extractFocusPointFromUnknownValue(value) {
  if (!value) {
    return null;
  }

  const direct = normalizeFocusPoint(value);
  if (direct) {
    return direct;
  }

  const parsedObject = parseJsonObject(value);
  if (parsedObject) {
    return extractFocusPointFromUnknownValue(parsedObject);
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const nestedCandidates = [
    value.focus,
    value.focalPoint,
    value.focusPoint,
    value.focus_point,
    value.focal_point,
  ];

  for (const candidate of nestedCandidates) {
    const normalized = extractFocusPointFromUnknownValue(candidate);
    if (normalized) {
      return normalized;
    }
  }

  for (const nestedValue of Object.values(value)) {
    if (!nestedValue || typeof nestedValue !== 'object') {
      continue;
    }

    const normalized = extractFocusPointFromUnknownValue(nestedValue);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function resolveFocusPoint(signedFile = {}, rawFile = {}) {
  const candidates = [
    signedFile?.focalPoint,
    rawFile?.focalPoint,
    signedFile?.focusPoint,
    rawFile?.focusPoint,
    signedFile?.focus,
    rawFile?.focus,
    signedFile?.metadata?.focus,
    rawFile?.metadata?.focus,
    signedFile?.metadata,
    rawFile?.metadata,
    signedFile?.provider_metadata?.focus,
    rawFile?.provider_metadata?.focus,
    signedFile?.provider_metadata,
    rawFile?.provider_metadata,
    signedFile?.formats,
    rawFile?.formats,
    signedFile,
    rawFile,
  ];

  for (const candidate of candidates) {
    const normalized = extractFocusPointFromUnknownValue(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function buildUploadTargetFromSourceUrl(sourceUrl = '', fallbackFilename = 'asset') {
  const normalizedUrl = String(sourceUrl || '').trim();

  if (!normalizedUrl) {
    return {
      route: `/${fallbackFilename.replace(/^\/+/, '')}`,
      path: '/',
      filename: fallbackFilename,
    };
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    const pathname = decodeURIComponent(String(parsedUrl.pathname || '').trim()) || `/${fallbackFilename}`;
    const segments = pathname.split('/').filter(Boolean);
    const filename = segments[segments.length - 1] || fallbackFilename;
    const path = segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : '/';

    return {
      route: pathname.startsWith('/') ? pathname : `/${pathname}`,
      path,
      filename,
    };
  } catch (error) {
    const fallbackPath = String(normalizedUrl.split('?')[0] || '').trim();
    const normalizedPath = fallbackPath.startsWith('/') ? fallbackPath : `/${fallbackPath}`;
    const segments = normalizedPath.split('/').filter(Boolean);
    const filename = segments[segments.length - 1] || fallbackFilename;
    const path = segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : '/';

    return {
      route: normalizedPath,
      path,
      filename,
    };
  }
}

function buildUploadFailureMessage(upload = {}, assets = []) {
  const results = upload && typeof upload === 'object' && upload.results && typeof upload.results === 'object'
    ? upload.results
    : {};
  const messages = [];

  for (const asset of Array.isArray(assets) ? assets : []) {
    const route = String(asset?.route || '').trim();
    const result = route ? results[route] : null;
    const message = String(result?.message || result?.details || '').trim();

    if (!route || !message) {
      continue;
    }

    messages.push(`${route}: ${message}`);
  }

  if (messages.length > 0) {
    return Array.from(new Set(messages)).join(' ');
  }

  return String(upload?.message || '').trim() || 'Could not upload media assets to Smooth CDN.';
}

function findSyncedEntryByKey(currentEntry = {}, key = '') {
  const entries = Array.isArray(currentEntry?.syncedEntries) ? currentEntry.syncedEntries : [];
  const normalizedKey = String(key || '').trim();

  if (normalizedKey) {
    const matched = entries.find((entry) => String(entry?.key || '').trim() === normalizedKey);
    if (matched) {
      return matched;
    }
  }

  if (!normalizedKey || normalizedKey === 'original') {
    return entries.find((entry) => String(entry?.key || '').trim() === 'original') || entries[0] || null;
  }

  return null;
}

function isSyncableEntry(entry = {}) {
  return Boolean(entry?.syncable);
}

module.exports = ({ strapi }) => {
  let schedulerHandle = null;
  let activeSyncPromise = null;

  function defaultSyncJob() {
    return {
      id: '',
      status: 'idle',
      trigger: '',
      totalItems: 0,
      processedItems: 0,
      syncedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      currentItem: '',
      startedAt: '',
      finishedAt: '',
      errorMessage: '',
      failedEntries: [],
    };
  }

  async function updateSyncJob(jobId, patch = {}) {
    if (!jobId) {
      return null;
    }

    const runtimeState = plugin(strapi).service('cdn-connector-runtime-state');
    const state = await runtimeState.update((current) => {
      const existing = current.syncJob || defaultSyncJob();

      if (existing.id && existing.id !== jobId && existing.status === 'running') {
        return {};
      }

      return {
        syncJob: {
          ...existing,
          id: jobId,
          ...(patch || {}),
        },
      };
    });

    return state.syncJob || null;
  }

  async function reconcileStaleSyncState() {
    const runtimeState = plugin(strapi).service('cdn-connector-runtime-state');
    const state = await runtimeState.get();
    const currentJob = state.syncJob || null;

    if (currentJob?.status !== 'running' || activeSyncPromise) {
      return {
        state,
        staleCleared: false,
      };
    }

    const nextState = await runtimeState.update((current) => ({
      syncJob: {
        ...(current.syncJob || currentJob),
        status: 'failed',
        finishedAt: nowIso(),
        currentItem: '',
        errorMessage: 'Previous sync timed out or was interrupted.',
      },
    }));

    return {
      state: nextState,
      staleCleared: true,
    };
  }

  async function isModuleEnabled() {
    return plugin(strapi).service('module-registry').isEnabled('cdn-connector');
  }

  function buildBaseUrl(settings = {}) {
    const configuredServerUrl = String(strapi.config.get('server.url') || '').trim().replace(/\/+$/, '');
    const configuredHost = String(strapi.config.get('server.host') || '127.0.0.1').trim();
    const resolvedHost =
      configuredHost && !['0.0.0.0', '::', '[::]'].includes(configuredHost) ? configuredHost : '127.0.0.1';
    const port = strapi.config.get('server.port') || 1337;

    if (settings.publicBaseUrl) {
      return String(settings.publicBaseUrl).replace(/\/+$/, '');
    }

    if (configuredServerUrl) {
      if (/^https?:\/\//i.test(configuredServerUrl)) {
        return configuredServerUrl;
      }

      return `http://${resolvedHost}:${port}${
        configuredServerUrl.startsWith('/') ? configuredServerUrl : `/${configuredServerUrl}`
      }`;
    }

    return `http://${resolvedHost}:${port}`;
  }

  function resolveAssetUrl(url, settings = {}) {
    const normalizedUrl = String(url || '').trim();

    if (!normalizedUrl) {
      return '';
    }

    if (/^https?:\/\//i.test(normalizedUrl)) {
      return normalizedUrl;
    }

    return new URL(normalizedUrl, `${buildBaseUrl(settings)}/`).toString();
  }

  async function listSourceMediaItems(filterIds = null) {
    const signedFileService = strapi.plugin('upload').service('file');
    const settings = await plugin(strapi).service('cdn-connector-settings').getResolved();
    const rawFiles = await strapi.db.query('plugin::upload.file').findMany({
      orderBy: {
        updatedAt: 'desc',
      },
    });
    const filterSet = filterIds instanceof Set ? filterIds : null;
    const items = [];

    for (const rawFile of Array.isArray(rawFiles) ? rawFiles : []) {
      const fileId = normalizeMediaId(rawFile?.id);
      if (!fileId) {
        continue;
      }

      if (filterSet && !filterSet.has(fileId)) {
        continue;
      }

      const signedFile = await signedFileService.signFileUrls(rawFile, {
        __smoothcdnBypassRewrite: true,
      });
      const formats = signedFile?.formats && typeof signedFile.formats === 'object' ? signedFile.formats : {};
      const signatureFormats = rawFile?.formats && typeof rawFile.formats === 'object' ? rawFile.formats : formats;
      const focusPoint = resolveFocusPoint(signedFile, rawFile);
      const isImage = String(signedFile?.mime || '').toLowerCase().startsWith('image/');
      const sourceSignature = JSON.stringify({
        updatedAt: rawFile?.updatedAt || signedFile?.updatedAt || '',
        hash: rawFile?.hash || signedFile?.hash || '',
        url: rawFile?.url || signedFile?.url || '',
        formats: signatureFormats,
        focusPoint: focusPoint || null,
      });

      items.push({
        id: `media:${fileId}`,
        fileId,
        name: String(signedFile?.name || rawFile?.name || '').trim(),
        alternativeText: String(signedFile?.alternativeText || rawFile?.alternativeText || '').trim(),
        mime: String(signedFile?.mime || rawFile?.mime || '').trim(),
        ext: resolveExt(signedFile?.ext || rawFile?.ext, signedFile?.url || rawFile?.url, signedFile?.mime || rawFile?.mime),
        size: Math.max(0, Number(signedFile?.size ?? rawFile?.size ?? 0) || 0),
        width: Math.max(0, Number(signedFile?.width ?? rawFile?.width ?? 0) || 0),
        height: Math.max(0, Number(signedFile?.height ?? rawFile?.height ?? 0) || 0),
        updatedAt: String(signedFile?.updatedAt || rawFile?.updatedAt || '').trim(),
        createdAt: String(signedFile?.createdAt || rawFile?.createdAt || '').trim(),
        sourceUrl: resolveAssetUrl(signedFile?.url || rawFile?.url || '', settings),
        isImage,
        focusPoint,
        formatCount: isImage ? Object.keys(formats).length : 0,
        formats,
        sourceSignature,
      });
    }

    return items.sort((left, right) => normalizeTimestamp(right.updatedAt) - normalizeTimestamp(left.updatedAt));
  }

  function buildSyncPlan(mediaItem, settings = {}) {
    const variants = [
      {
        key: 'original',
        label: 'Original',
        sourceUrl: mediaItem.sourceUrl,
        mime: mediaItem.mime,
        width: mediaItem.width,
        height: mediaItem.height,
        size: mediaItem.size,
        ext: mediaItem.ext,
        meta: mediaItem.isImage && mediaItem.focusPoint
          ? {
              focus: mediaItem.focusPoint,
            }
          : null,
      },
    ];

    if (mediaItem.isImage) {
      for (const [variantKey, variant] of Object.entries(mediaItem.formats || {})) {
        if (!variant || typeof variant !== 'object' || !variant.url) {
          continue;
        }

        variants.push({
          key: String(variantKey || '').trim(),
          label: formatVariantLabel(variantKey),
          sourceUrl: resolveAssetUrl(variant.url, settings),
          mime: String(variant.mime || mediaItem.mime || '').trim(),
          width: Math.max(0, Number(variant.width) || 0),
          height: Math.max(0, Number(variant.height) || 0),
          size: Math.max(0, Number(variant.size) || 0),
          ext: resolveExt(variant.ext || mediaItem.ext, variant.url, variant.mime || mediaItem.mime),
          meta: mediaItem.isImage && mediaItem.focusPoint
            ? {
                focus: mediaItem.focusPoint,
              }
            : null,
        });
      }
    }

    return variants.map((variant) => {
      const uploadTarget = buildUploadTargetFromSourceUrl(
        variant.sourceUrl,
        `${variant.key || 'asset'}${variant.ext || ''}`
      );

      return {
        key: variant.key,
        label: variant.label,
        sourceUrl: variant.sourceUrl,
        mime: variant.mime || 'application/octet-stream',
        width: variant.width,
        height: variant.height,
        size: variant.size,
        meta: variant.meta,
        route: uploadTarget.route,
        path: uploadTarget.path,
        filename: uploadTarget.filename,
      };
    });
  }

  async function fetchBinaryAsset(url) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        return {
          success: false,
          message: `Could not fetch ${url}.`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();

      return {
        success: true,
        body: Buffer.from(arrayBuffer),
        contentType: String(response.headers.get('content-type') || '').trim(),
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || `Could not fetch ${url}.`,
      };
    }
  }

  async function mergeMediaItems(sourceItems) {
    const settings = await plugin(strapi).service('cdn-connector-settings').getResolved();
    const repository = plugin(strapi).service('cdn-connector-repository');
    const storedEntries = await repository.all();
    const storedById = new Map(storedEntries.map((entry) => [entry.fileId, entry]));

    return sourceItems.map((item) => {
      const stored = storedById.get(item.fileId) || null;

      return {
        id: item.id,
        fileId: item.fileId,
        syncable: Boolean(stored?.syncable),
        protected: Boolean(stored?.protected),
        name: item.name,
        alternativeText: item.alternativeText,
        mime: item.mime,
        ext: item.ext,
        size: item.size,
        width: item.width,
        height: item.height,
        updatedAt: item.updatedAt,
        createdAt: item.createdAt,
        sourceUrl: item.sourceUrl,
        isImage: item.isImage,
        formatCount: item.formatCount,
        syncStatus: stored?.syncStatus || 'not_synced',
        lastSyncedAt: stored?.lastSyncedAt || '',
        lastError: stored?.lastError || '',
        syncedEntries: Array.isArray(stored?.syncedEntries)
          ? stored.syncedEntries.map((entry) => ({
              ...entry,
              publicUrl: plugin(strapi).service('smooth-client').buildPublicUrlForUploadTarget(
                entry.path,
                entry.filename,
                settings
              ),
            }))
          : [],
      };
    });
  }

  async function reconcileRemovedItems(currentItems = []) {
    const repository = plugin(strapi).service('cdn-connector-repository');
    const offloadService = plugin(strapi).service('cdn-connector-offload');
    const currentIds = new Set(currentItems.map((item) => item.fileId));
    const removedEntries = (await repository.all()).filter((entry) => !currentIds.has(entry.fileId));

    if (removedEntries.length === 0) {
      return {
        removed: 0,
      };
    }

    const targets = removedEntries.flatMap((entry) =>
      (Array.isArray(entry.syncedEntries) ? entry.syncedEntries : [])
        .filter((asset) => asset.filename)
        .map((asset) => ({
          path: asset.path,
          filename: asset.filename,
        }))
    );

    if (targets.length > 0) {
      await plugin(strapi).service('smooth-client').deleteAssets(targets, 'cdn-connector');
    }

    await repository.removeMany(removedEntries.map((entry) => entry.fileId));
    offloadService.invalidateCache();

    return {
      removed: removedEntries.length,
    };
  }

  async function performSync(jobId, mediaIds = [], options = {}) {
    if (!(await isModuleEnabled())) {
      await updateSyncJob(jobId, {
        status: 'failed',
        finishedAt: nowIso(),
        currentItem: '',
        errorMessage: 'Enable the CDN Connector module first.',
      });

      return {
        success: false,
        message: 'Enable the CDN Connector module first.',
      };
    }

    const settingsService = plugin(strapi).service('cdn-connector-settings');
    const offloadService = plugin(strapi).service('cdn-connector-offload');
    const repository = plugin(strapi).service('cdn-connector-repository');
    const smoothClient = plugin(strapi).service('smooth-client');
    const settings = await settingsService.getResolved();
    const normalizedIds = Array.from(
      new Set((Array.isArray(mediaIds) ? mediaIds : [mediaIds]).map(normalizeMediaId).filter(Boolean))
    );
    const filterSet = normalizedIds.length > 0 ? new Set(normalizedIds) : null;
    const sourceItems = await listSourceMediaItems(filterSet);
    const storedEntries = await repository.all();
    const storedById = new Map(storedEntries.map((entry) => [entry.fileId, entry]));
    const markSyncable = Boolean(options.markSyncable);
    const hasProtectedOverride = Object.prototype.hasOwnProperty.call(options, 'protectedOverride');

    if (normalizedIds.length === 0) {
      await reconcileRemovedItems(sourceItems);
    }

    if (markSyncable) {
      const targetIds = normalizedIds.length > 0 ? normalizedIds : sourceItems.map((item) => item.fileId).filter(Boolean);

      if (targetIds.length > 0) {
        await repository.upsertMany(
          targetIds.map((fileId) => ({
            fileId,
            syncable: true,
          }))
        );

        for (const fileId of targetIds) {
      const current = storedById.get(fileId) || { fileId };
      storedById.set(fileId, {
        ...current,
        syncable: true,
        protected: hasProtectedOverride ? Boolean(options.protectedOverride) : Boolean(current.protected),
      });
    }
      }
    }

    const sourceCandidates = sourceItems.filter((item) => {
      if (markSyncable) {
        return true;
      }

      return isSyncableEntry(storedById.get(item.fileId));
    });

    await updateSyncJob(jobId, {
      totalItems: sourceCandidates.length,
      processedItems: 0,
      syncedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      currentItem: '',
      errorMessage: '',
      failedEntries: [],
    });

    if (sourceCandidates.length === 0) {
      if (options.trigger === 'scheduled') {
        await settingsService.touch('lastAutoSyncAt');
        await settingsService.touch('lastSyncAt');
      } else {
        await settingsService.touch('lastSyncAt');
      }

      await updateSyncJob(jobId, {
        status: 'completed',
        processedItems: 0,
        syncedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        currentItem: '',
        finishedAt: nowIso(),
        errorMessage: '',
        failedEntries: [],
      });

      return {
        success: true,
        synced: 0,
        skipped: 0,
        failed: 0,
      };
    }

    let synced = 0;
    let skipped = 0;
    let failed = 0;
    const failures = [];
    const pendingBatch = [];

    const markFailedItem = async (item, failureMessage) => {
      failed += 1;
      failures.push({
        fileId: item.fileId,
        message: failureMessage,
      });

      await repository.upsert({
        fileId: item.fileId,
        syncable: true,
        protected: hasProtectedOverride ? Boolean(options.protectedOverride) : Boolean(storedById.get(item.fileId)?.protected),
        syncStatus: 'upload_failed',
        lastError: failureMessage,
      });
      offloadService.invalidateCache();

      await updateSyncJob(jobId, {
        processedItems: synced + failed + skipped,
        failedItems: failed,
        failedEntries: failures,
      });
    };

    const markUploadedItem = async (batchEntry, upload) => {
      const uploadResults = upload && typeof upload.results === 'object' ? upload.results : {};
      const nextSyncedEntries = batchEntry.syncPlan.map((entry) => {
        return {
          key: entry.key,
          label: entry.label,
          path: entry.path,
          filename: entry.filename,
          mime: entry.mime,
          width: entry.width,
          height: entry.height,
          size: entry.size,
        };
      });
      const previousTargets = Array.isArray(batchEntry.current?.syncedEntries) ? batchEntry.current.syncedEntries : [];
      const nextTargetKeys = new Set(nextSyncedEntries.map((entry) => `${entry.path}:${entry.filename}`));
      const obsoleteTargets = previousTargets
        .filter((entry) => entry.filename && !nextTargetKeys.has(`${entry.path}:${entry.filename}`))
        .map((entry) => ({
          path: entry.path,
          filename: entry.filename,
        }));

      if (obsoleteTargets.length > 0) {
        await smoothClient.deleteAssets(obsoleteTargets, 'cdn-connector');
      }

      await repository.upsert({
        fileId: batchEntry.item.fileId,
        syncable: true,
        protected: Boolean(batchEntry.protected),
        syncStatus: 'uploaded',
        lastSyncedAt: nowIso(),
        lastSourceSignature: batchEntry.syncSignature,
        lastError: '',
        syncedEntries: nextSyncedEntries,
      });
      offloadService.invalidateCache();

      if (settings.offloadLocalFiles) {
        const offloadResult = await offloadService.offloadLocalMediaFile(batchEntry.item.fileId, {
          settings,
        });

        if (!offloadResult.success) {
          strapi.log.warn(
            `[smoothcdn] CDN Connector offload could not remove local files for media ${batchEntry.item.fileId}: ${
              offloadResult.message || 'Unknown error.'
            }`
          );
        }
      }

      synced += 1;
      await updateSyncJob(jobId, {
        processedItems: synced + failed + skipped,
        syncedItems: synced,
      });
    };

    const flushPendingBatch = async () => {
      if (pendingBatch.length === 0) {
        return;
      }

      const currentBatch = pendingBatch.splice(0, pendingBatch.length);
      const batchAssets = currentBatch.flatMap((entry) => entry.uploadAssets);
      const upload = await smoothClient.uploadAssets(batchAssets, 'cdn-connector', {
        batchSize: CDN_CONNECTOR_UPLOAD_BATCH_SIZE,
      });

      for (const entry of currentBatch) {
        await updateSyncJob(jobId, {
          currentItem: entry.item.name || entry.item.fileId,
        });

        const hasEntryFailure = entry.uploadAssets.some((asset) => {
          const result = upload?.results?.[asset.route];
          return !result || result.success !== true;
        });

        if (hasEntryFailure) {
          await markFailedItem(entry.item, buildUploadFailureMessage(upload, entry.uploadAssets));
          continue;
        }

        await markUploadedItem(entry, upload);
      }
    };

    for (const item of sourceCandidates) {
      await updateSyncJob(jobId, {
        currentItem: item.name || item.fileId,
      });

      const current = storedById.get(item.fileId) || null;
      const targetProtected = hasProtectedOverride ? Boolean(options.protectedOverride) : Boolean(current?.protected);
      const syncPlan = buildSyncPlan(item, settings);
      const syncSignature = JSON.stringify({
        source: item.sourceSignature,
        protectedAssets: targetProtected,
        syncAllFormats: Boolean(settings.syncAllFormats),
        entries: syncPlan.map((entry) => `${entry.key}:${entry.filename}:${JSON.stringify(entry.meta || {})}`),
      });

      if (!options.force && current?.syncStatus === 'uploaded' && current.lastSourceSignature === syncSignature) {
        skipped += 1;
        await updateSyncJob(jobId, {
          processedItems: synced + failed + skipped,
          skippedItems: skipped,
        });
        continue;
      }

      const uploadAssets = [];
      let failureMessage = '';

      for (const plannedEntry of syncPlan) {
        if (!plannedEntry.sourceUrl) {
          failureMessage = 'The source media URL is missing.';
          break;
        }

        let fetched = await fetchBinaryAsset(plannedEntry.sourceUrl);

        if (!fetched.success && settings.offloadLocalFiles && current?.syncStatus === 'uploaded') {
          const previousSyncedEntry = findSyncedEntryByKey(current, plannedEntry.key);
          const fallbackSourceUrl = previousSyncedEntry?.filename
            ? smoothClient.buildPublicUrlForUploadTarget(previousSyncedEntry.path, previousSyncedEntry.filename, settings)
            : '';

          if (fallbackSourceUrl && fallbackSourceUrl !== plannedEntry.sourceUrl) {
            const fallbackFetched = await fetchBinaryAsset(fallbackSourceUrl);

            if (fallbackFetched.success) {
              fetched = fallbackFetched;
            } else {
              fetched = {
                success: false,
                message: `${fetched.message || 'Could not fetch the source media file.'} ${
                  fallbackFetched.message || ''
                }`.trim(),
              };
            }
          }
        }

        if (!fetched.success) {
          failureMessage = fetched.message || 'Could not fetch the source media file.';
          break;
        }

        uploadAssets.push({
          route: plannedEntry.route,
          uploadTarget: {
            path: plannedEntry.path,
            filename: plannedEntry.filename,
          },
          filename: plannedEntry.filename,
          protected: targetProtected,
          meta: plannedEntry.meta || null,
          body: fetched.body,
          contentType: plannedEntry.mime || fetched.contentType || 'application/octet-stream',
        });
      }

      if (failureMessage) {
        await markFailedItem(item, failureMessage);
        continue;
      }

      pendingBatch.push({
        item,
        current,
        protected: targetProtected,
        syncPlan,
        syncSignature,
        uploadAssets,
      });

      if (pendingBatch.length >= CDN_CONNECTOR_UPLOAD_BATCH_SIZE) {
        await flushPendingBatch();
      }
    }

    await flushPendingBatch();

    if (options.trigger === 'scheduled') {
      await settingsService.touch('lastAutoSyncAt');
      await settingsService.touch('lastSyncAt');
    } else {
      await settingsService.touch('lastSyncAt');
    }

    const result = {
      success: failed === 0,
      synced,
      skipped,
      failed,
      failures,
      message:
        failed > 0
          ? `Synced ${synced} media item${synced === 1 ? '' : 's'}, ${failed} failed.`
          : `Synced ${synced} media item${synced === 1 ? '' : 's'}.`,
    };

    await updateSyncJob(jobId, {
      status: failed > 0 ? 'failed' : 'completed',
      processedItems: synced + failed + skipped,
      syncedItems: synced,
      failedItems: failed,
      skippedItems: skipped,
      currentItem: '',
      finishedAt: nowIso(),
      errorMessage: failed > 0 ? result.message : '',
      failedEntries: failures,
    });

    return result;
  }

  return {
    async listMediaItems() {
      const sourceItems = await listSourceMediaItems();
      return mergeMediaItems(sourceItems);
    },

    async removeDeletedMediaItems(fileIds = []) {
      const normalizedIds = Array.from(
        new Set((Array.isArray(fileIds) ? fileIds : [fileIds]).map(normalizeMediaId).filter(Boolean))
      );

      if (normalizedIds.length === 0) {
        return {
          success: true,
          deleted: 0,
        };
      }

      const repository = plugin(strapi).service('cdn-connector-repository');
      const offloadService = plugin(strapi).service('cdn-connector-offload');
      const entries = await Promise.all(normalizedIds.map((fileId) => repository.get(fileId)));
      const targets = entries.flatMap((entry) =>
        (Array.isArray(entry?.syncedEntries) ? entry.syncedEntries : [])
          .filter((asset) => asset.filename)
          .map((asset) => ({
            path: asset.path,
            filename: asset.filename,
          }))
      );

      if (targets.length > 0) {
        const deletion = await plugin(strapi).service('smooth-client').deleteAssets(targets, 'cdn-connector');

        if (!deletion.success) {
          return {
            success: false,
            message: deletion.message || 'Could not delete synced media assets from Smooth CDN.',
            deleted: 0,
          };
        }
      }

      await repository.removeMany(normalizedIds);
      offloadService.invalidateCache();

      return {
        success: true,
        deleted: normalizedIds.length,
      };
    },

    async unsyncMediaItems(fileIds = [], options = {}) {
      if (!(await isModuleEnabled())) {
        return {
          success: false,
          message: 'Enable the CDN Connector module first.',
          unsynced: 0,
        };
      }

      const normalizedIds = Array.from(
        new Set((Array.isArray(fileIds) ? fileIds : [fileIds]).map(normalizeMediaId).filter(Boolean))
      );
      const settings = await plugin(strapi).service('cdn-connector-settings').getResolved();
      const repository = plugin(strapi).service('cdn-connector-repository');
      const offloadService = plugin(strapi).service('cdn-connector-offload');
      const syncJobId = String(options.syncJobId || '').trim();
      const requestedEntries = normalizedIds.length > 0
        ? await Promise.all(normalizedIds.map((fileId) => repository.get(fileId)))
        : await repository.all();
      const entries = requestedEntries.filter((entry) => entry && isSyncableEntry(entry));
      const uploadedEntries = entries.filter((entry) => String(entry.syncStatus || '').trim() === 'uploaded');

      if (entries.length === 0) {
        return {
          success: true,
          message: 'No selected media items to unsync.',
          unsynced: 0,
        };
      }

      if (syncJobId) {
        await updateSyncJob(syncJobId, {
          totalItems: entries.length,
          processedItems: 0,
          syncedItems: 0,
          failedItems: 0,
          skippedItems: 0,
          currentItem: '',
          errorMessage: '',
          failedEntries: [],
        });
      }

      const restoreFailures = [];
      let processedItems = 0;

      const markProcessed = async (entry, failureMessage = '') => {
        processedItems += 1;

        if (!syncJobId) {
          return;
        }

        const patch = {
          processedItems,
          currentItem: entry?.fileId || '',
        };

        if (failureMessage) {
          patch.failedItems = restoreFailures.length;
          patch.failedEntries = restoreFailures;
          patch.errorMessage = failureMessage;
        }

        await updateSyncJob(syncJobId, patch);
      };

      for (const entry of uploadedEntries) {
        if (syncJobId) {
          await updateSyncJob(syncJobId, {
            currentItem: entry.fileId,
          });
        }

        const restoreResult = await offloadService.restoreLocalMediaFile(entry.fileId, {
          settings,
          repositoryEntry: entry,
        });

        if (!restoreResult.success) {
          restoreFailures.push({
            fileId: entry.fileId,
            message: restoreResult.message || 'Could not restore local media files from Smooth CDN.',
          });
          await markProcessed(entry, restoreResult.message || 'Could not restore local media files from Smooth CDN.');
          continue;
        }

        await markProcessed(entry);
      }

      if (restoreFailures.length > 0) {
        if (syncJobId) {
          await updateSyncJob(syncJobId, {
            status: 'failed',
            finishedAt: nowIso(),
            currentItem: '',
            processedItems,
            failedItems: restoreFailures.length,
            failedEntries: restoreFailures,
            errorMessage: restoreFailures[0].message,
          });
        }

        return {
          success: false,
          message: restoreFailures[0].message,
          unsynced: 0,
          failures: restoreFailures,
        };
      }

      const targets = uploadedEntries.flatMap((entry) =>
        (Array.isArray(entry?.syncedEntries) ? entry.syncedEntries : [])
          .filter((asset) => asset.filename)
          .map((asset) => ({
            path: asset.path,
            filename: asset.filename,
          }))
      );

      if (targets.length > 0) {
        const deletion = await plugin(strapi).service('smooth-client').deleteAssets(targets, 'cdn-connector');

        if (!deletion.success) {
          if (syncJobId) {
            await updateSyncJob(syncJobId, {
              status: 'failed',
              finishedAt: nowIso(),
              currentItem: '',
              processedItems,
              failedItems: 1,
              failedEntries: [
                {
                  fileId: uploadedEntries[0]?.fileId || '',
                  message: deletion.message || 'Could not delete synced media assets from Smooth CDN.',
                },
              ],
              errorMessage: deletion.message || 'Could not delete synced media assets from Smooth CDN.',
            });
          }

          return {
            success: false,
            message: deletion.message || 'Could not delete synced media assets from Smooth CDN.',
            unsynced: 0,
          };
        }
      }

      await repository.upsertMany(
        entries.map((entry) => ({
          fileId: entry.fileId,
          syncable: false,
          protected: false,
          syncStatus: 'not_synced',
          lastSyncedAt: '',
          lastSourceSignature: '',
          lastError: '',
          syncedEntries: [],
        }))
      );
      offloadService.invalidateCache();

      if (syncJobId) {
        await updateSyncJob(syncJobId, {
          status: 'completed',
          finishedAt: nowIso(),
          currentItem: '',
          processedItems: entries.length,
          syncedItems: entries.length,
          failedItems: 0,
          skippedItems: 0,
          errorMessage: '',
          failedEntries: [],
        });
      }

      return {
        success: true,
        message:
          entries.length === 1
            ? 'Media item was removed from Smooth CDN.'
            : `${entries.length} media items were removed from Smooth CDN.`,
        unsynced: entries.length,
      };
    },

    async startUnsyncJob(fileIds = [], options = {}) {
      await reconcileStaleSyncState();
      const runtimeState = plugin(strapi).service('cdn-connector-runtime-state');
      const currentJob = (await runtimeState.get()).syncJob || defaultSyncJob();

      if (currentJob.status === 'running') {
        return {
          success: false,
          busy: true,
          message: 'Media sync is already running.',
          job: currentJob,
        };
      }

      const jobId = randomUUID();
      const initialJob = await updateSyncJob(jobId, {
        status: 'running',
        trigger: String(options.trigger || 'unsync').trim(),
        totalItems: 0,
        processedItems: 0,
        syncedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        currentItem: '',
        startedAt: nowIso(),
        finishedAt: '',
        errorMessage: '',
        failedEntries: [],
      });

      const jobPromise = this.unsyncMediaItems(fileIds, {
        ...options,
        syncJobId: jobId,
      }).catch(async (error) => {
        await updateSyncJob(jobId, {
          status: 'failed',
          finishedAt: nowIso(),
          currentItem: '',
          errorMessage: error.message || 'Media unsync failed.',
        });

        throw error;
      }).finally(() => {
        activeSyncPromise = null;
      });
      activeSyncPromise = jobPromise;

      setImmediate(() => {
        jobPromise.catch(() => null);
      });

      return {
        success: true,
        job: initialJob,
      };
    },

    async syncMediaItems(mediaIds = [], options = {}) {
      if (activeSyncPromise) {
        return {
          success: false,
          busy: true,
          message: 'Media sync is already running.',
        };
      }

      const jobId = randomUUID();

      await updateSyncJob(jobId, {
        status: 'running',
        trigger: String(options.trigger || '').trim(),
        totalItems: 0,
        processedItems: 0,
        syncedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        currentItem: '',
        startedAt: nowIso(),
        finishedAt: '',
        errorMessage: '',
        failedEntries: [],
      });

      const jobPromise = performSync(jobId, mediaIds, options).catch(async (error) => {
        await updateSyncJob(jobId, {
          status: 'failed',
          finishedAt: nowIso(),
          currentItem: '',
          errorMessage: error.message || 'Media sync failed.',
        });

        throw error;
      });
      activeSyncPromise = jobPromise;

      try {
        return await jobPromise;
      } finally {
        activeSyncPromise = null;
      }
    },

    async startSyncJob(mediaIds = [], options = {}) {
      await reconcileStaleSyncState();
      const runtimeState = plugin(strapi).service('cdn-connector-runtime-state');
      const currentJob = (await runtimeState.get()).syncJob || defaultSyncJob();

      if (currentJob.status === 'running') {
        return {
          success: false,
          busy: true,
          message: 'Media sync is already running.',
          job: currentJob,
        };
      }

      const jobId = randomUUID();
      const initialJob = await updateSyncJob(jobId, {
        status: 'running',
        trigger: String(options.trigger || '').trim(),
        totalItems: 0,
        processedItems: 0,
        syncedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        currentItem: '',
        startedAt: nowIso(),
        finishedAt: '',
        errorMessage: '',
        failedEntries: [],
      });

      const jobPromise = performSync(jobId, mediaIds, options).catch(async (error) => {
        await updateSyncJob(jobId, {
          status: 'failed',
          finishedAt: nowIso(),
          currentItem: '',
          errorMessage: error.message || 'Media sync failed.',
        });

        throw error;
      }).finally(() => {
        activeSyncPromise = null;
      });
      activeSyncPromise = jobPromise;

      setImmediate(() => {
        jobPromise.catch(() => null);
      });

      return {
        success: true,
        job: initialJob,
      };
    },

    async getSyncJobStatus() {
      const result = await reconcileStaleSyncState();
      return result.state?.syncJob || defaultSyncJob();
    },

    async runScheduledSync() {
      await reconcileStaleSyncState();
      if (!(await isModuleEnabled())) {
        return;
      }

      const settings = await plugin(strapi).service('cdn-connector-settings').get();
      const intervalMs = parseIntervalFrequency(settings.autoSyncFrequency);

      if (!intervalMs) {
        return;
      }

      const lastRun = settings.lastAutoSyncAt ? new Date(settings.lastAutoSyncAt).getTime() : 0;

      if (Date.now() - lastRun < intervalMs) {
        return;
      }

      await this.syncMediaItems([], {
        trigger: 'scheduled',
      });
    },

    startScheduler() {
      if (schedulerHandle) {
        return;
      }

      schedulerHandle = setInterval(() => {
        this.runScheduledSync().catch((error) => {
          strapi.log.error(`[smoothcdn] CDN Connector scheduled sync failed: ${error.message}`);
        });
      }, 60 * 1000);
    },

    stopScheduler() {
      if (schedulerHandle) {
        clearInterval(schedulerHandle);
        schedulerHandle = null;
      }
    },
  };
};
