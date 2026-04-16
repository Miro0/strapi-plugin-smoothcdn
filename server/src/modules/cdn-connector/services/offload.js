'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const CACHE_TTL_MS = 5000;

function plugin(strapi) {
  return strapi.plugin('smoothcdn');
}

function normalizeFileId(value) {
  return String(value || '').trim();
}

function normalizePath(value) {
  return String(value || '/').trim() || '/';
}

function resolvePublicDirectory(strapi) {
  const configuredPublicDir = strapi.dirs?.static?.public || strapi.dirs?.public;
  const appRoot = strapi.dirs?.app?.root || process.cwd();
  return path.resolve(configuredPublicDir || path.join(appRoot, 'public'));
}

function toLocalPublicFilePath(publicDirectory, value) {
  const normalized = String(value || '').trim();

  if (!normalized || /^https?:\/\//i.test(normalized) || normalized.startsWith('data:')) {
    return '';
  }

  const withoutQuery = normalized.split('?')[0].split('#')[0].trim();
  if (!withoutQuery) {
    return '';
  }

  const normalizedUrlPath = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  const absolutePath = path.resolve(publicDirectory, `.${normalizedUrlPath}`);
  const protectedPrefix = publicDirectory.endsWith(path.sep) ? publicDirectory : `${publicDirectory}${path.sep}`;

  if (absolutePath !== publicDirectory && !absolutePath.startsWith(protectedPrefix)) {
    return '';
  }

  return absolutePath;
}

function collectSyncedEntries(entry = {}) {
  return Array.isArray(entry.syncedEntries) ? entry.syncedEntries.filter((item) => item?.filename) : [];
}

function findOriginalSyncedEntry(entry = {}) {
  const syncedEntries = collectSyncedEntries(entry);

  return syncedEntries.find((item) => String(item?.key || '').trim() === 'original') || syncedEntries[0] || null;
}

function buildLocalFilePaths(fileEntry = {}, publicDirectory) {
  const sources = [fileEntry?.url];
  const formats = fileEntry?.formats && typeof fileEntry.formats === 'object' ? fileEntry.formats : {};

  for (const variant of Object.values(formats)) {
    sources.push(variant?.url);
  }

  return Array.from(
    new Set(
      sources
        .map((source) => toLocalPublicFilePath(publicDirectory, source))
        .filter(Boolean)
    )
  );
}

function isUploadFilePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  return (
    Object.prototype.hasOwnProperty.call(payload, 'id') &&
    (Object.prototype.hasOwnProperty.call(payload, 'url') || Object.prototype.hasOwnProperty.call(payload, 'formats'))
  );
}

function rewriteArrayPayload(items, state, rewriteFilePayload) {
  let changed = false;
  const nextItems = items.map((item) => {
    const nextItem = rewriteFilePayload(item, state);
    if (nextItem !== item) {
      changed = true;
    }

    return nextItem;
  });

  return changed ? nextItems : items;
}

function isImageLikeFilePayload(file = {}) {
  const mime = String(file?.mime || '').trim().toLowerCase();
  if (mime.startsWith('image/')) {
    return true;
  }

  const ext = String(file?.ext || '').trim().toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg'].includes(ext);
}

function stripUpdatedAtParamFromUrl(urlValue) {
  const normalized = String(urlValue || '').trim();

  if (!normalized || !normalized.includes('updatedAt=')) {
    return normalized;
  }

  try {
    const resolved = /^https?:\/\//i.test(normalized)
      ? new URL(normalized)
      : new URL(normalized, 'http://smoothcdn-local');

    resolved.searchParams.delete('updatedAt');
    const next = resolved.toString();

    if (/^https?:\/\//i.test(normalized)) {
      return next;
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch (error) {
    return normalized
      .replace(/([?&])updatedAt=[^&#]*(&?)/, (match, leading, trailing) => {
        if (leading === '?' && trailing) {
          return '?';
        }

        return trailing ? leading : '';
      })
      .replace(/\?$/, '')
      .replace(/\?&/, '?');
  }
}

function stripUpdatedAtParamFromFilePayload(file = {}) {
  if (!isUploadFilePayload(file) || !isImageLikeFilePayload(file)) {
    return file;
  }

  let changed = false;
  const nextFile = {
    ...file,
  };

  if (typeof file.url === 'string') {
    const nextUrl = stripUpdatedAtParamFromUrl(file.url);
    if (nextUrl !== file.url) {
      changed = true;
      nextFile.url = nextUrl;
    }
  }

  if (file.formats && typeof file.formats === 'object') {
    let formatChanged = false;
    const nextFormats = { ...file.formats };

    for (const [variantKey, variantValue] of Object.entries(file.formats)) {
      if (!variantValue || typeof variantValue !== 'object' || typeof variantValue.url !== 'string') {
        continue;
      }

      const nextVariantUrl = stripUpdatedAtParamFromUrl(variantValue.url);
      if (nextVariantUrl === variantValue.url) {
        continue;
      }

      formatChanged = true;
      nextFormats[variantKey] = {
        ...variantValue,
        url: nextVariantUrl,
      };
    }

    if (formatChanged) {
      changed = true;
      nextFile.formats = nextFormats;
    }
  }

  return changed ? nextFile : file;
}

function stripUpdatedAtParamFromSignedPayload(payload) {
  if (!payload) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => stripUpdatedAtParamFromFilePayload(item));
  }

  return stripUpdatedAtParamFromFilePayload(payload);
}

module.exports = ({ strapi }) => {
  let rewriteCache = {
    refreshedAt: 0,
    enabled: false,
    settings: null,
    entriesByFileId: new Map(),
  };
  let uploadRewriteHookInstalled = false;

  function invalidateCache() {
    rewriteCache = {
      refreshedAt: 0,
      enabled: false,
      settings: null,
      entriesByFileId: new Map(),
    };
  }

  async function getRewriteState(options = {}) {
    const forceRefresh = Boolean(options.force);

    if (!forceRefresh && Date.now() - rewriteCache.refreshedAt < CACHE_TTL_MS) {
      return rewriteCache;
    }

    try {
      const settings = await plugin(strapi).service('cdn-connector-settings').getResolved();
      const offloadEnabled = Boolean(settings.offloadLocalFiles);

      if (!offloadEnabled) {
        invalidateCache();
        rewriteCache.refreshedAt = Date.now();
        rewriteCache.settings = settings;
        return rewriteCache;
      }

      const entries = await plugin(strapi).service('cdn-connector-repository').all();
      const entriesByFileId = new Map();

      for (const entry of entries) {
        if (String(entry?.syncStatus || '').trim() !== 'uploaded') {
          continue;
        }

        const fileId = normalizeFileId(entry?.fileId);
        if (!fileId) {
          continue;
        }

        entriesByFileId.set(fileId, entry);
      }

      rewriteCache = {
        refreshedAt: Date.now(),
        enabled: true,
        settings,
        entriesByFileId,
      };
    } catch (error) {
      strapi.log.warn(`[smoothcdn] CDN Connector URL rewrite cache refresh failed: ${error.message}`);
      invalidateCache();
      rewriteCache.refreshedAt = Date.now();
    }

    return rewriteCache;
  }

  function buildPublicUrlForSyncedEntry(entry, settings) {
    if (!entry?.filename) {
      return '';
    }

    return plugin(strapi).service('smooth-client').buildPublicUrlForUploadTarget(
      normalizePath(entry.path),
      String(entry.filename || '').trim(),
      settings
    );
  }

  function rewriteFilePayload(file, state) {
    if (!isUploadFilePayload(file) || !state?.enabled) {
      return file;
    }

    const fileId = normalizeFileId(file.id);
    const synced = state.entriesByFileId.get(fileId);

    if (!synced) {
      return file;
    }

    const originalEntry = findOriginalSyncedEntry(synced);
    const rewrittenOriginalUrl = buildPublicUrlForSyncedEntry(originalEntry, state.settings);

    if (!rewrittenOriginalUrl) {
      return file;
    }

    const nextFile = {
      ...file,
      url: rewrittenOriginalUrl,
    };

    const currentFormats = file.formats && typeof file.formats === 'object' ? file.formats : null;
    if (!currentFormats) {
      return nextFile;
    }

    const nextFormats = { ...currentFormats };
    let changedFormats = false;
    const syncedEntries = collectSyncedEntries(synced);

    for (const [variantKey, variantValue] of Object.entries(currentFormats)) {
      if (!variantValue || typeof variantValue !== 'object') {
        continue;
      }

      const syncedEntry = syncedEntries.find((item) => String(item?.key || '').trim() === String(variantKey || '').trim());
      const rewrittenVariantUrl = buildPublicUrlForSyncedEntry(syncedEntry, state.settings);

      if (!rewrittenVariantUrl) {
        continue;
      }

      changedFormats = true;
      nextFormats[variantKey] = {
        ...variantValue,
        url: rewrittenVariantUrl,
      };
    }

    if (changedFormats) {
      nextFile.formats = nextFormats;
    }

    return nextFile;
  }

  function rewriteSignedFileUrlsPayload(payload, state) {
    if (!state?.enabled || !payload) {
      return payload;
    }

    if (Array.isArray(payload)) {
      return rewriteArrayPayload(payload, state, rewriteFilePayload);
    }

    if (isUploadFilePayload(payload)) {
      return rewriteFilePayload(payload, state);
    }

    return payload;
  }

  return {
    invalidateCache,

    async installUploadUrlRewriteHook() {
      if (uploadRewriteHookInstalled) {
        return {
          installed: true,
        };
      }

      const uploadPlugin = strapi.plugin('upload');
      const fileService = uploadPlugin?.service('file');

      if (!fileService || typeof fileService.signFileUrls !== 'function') {
        return {
          installed: false,
          reason: 'Upload file service is unavailable.',
        };
      }

      const originalSignFileUrls = fileService.signFileUrls.bind(fileService);

      fileService.signFileUrls = async (payload, ...args) => {
        const bypassRewrite = args.some(
          (arg) => arg && typeof arg === 'object' && arg.__smoothcdnBypassRewrite === true
        );
        const normalizedArgs = args.map((arg) => {
          if (
            !arg ||
            typeof arg !== 'object' ||
            Array.isArray(arg) ||
            !Object.prototype.hasOwnProperty.call(arg, '__smoothcdnBypassRewrite')
          ) {
            return arg;
          }

          const { __smoothcdnBypassRewrite, ...rest } = arg;
          return rest;
        });
        const signed = await originalSignFileUrls(payload, ...normalizedArgs);
        const sanitizedSigned = stripUpdatedAtParamFromSignedPayload(signed);

        if (bypassRewrite) {
          return sanitizedSigned;
        }

        const state = await getRewriteState();

        if (!state.enabled) {
          return sanitizedSigned;
        }

        return rewriteSignedFileUrlsPayload(sanitizedSigned, state);
      };

      uploadRewriteHookInstalled = true;

      return {
        installed: true,
      };
    },

    async offloadLocalMediaFile(fileId, options = {}) {
      const normalizedFileId = normalizeFileId(fileId);

      if (!normalizedFileId) {
        return {
          success: false,
          message: 'Missing media file ID.',
          deletedFiles: 0,
        };
      }

      const settings =
        options.settings && typeof options.settings === 'object'
          ? options.settings
          : await plugin(strapi).service('cdn-connector-settings').getResolved();

      if (!settings.offloadLocalFiles) {
        return {
          success: true,
          skipped: true,
          deletedFiles: 0,
        };
      }

      const fileEntry = await strapi.db.query('plugin::upload.file').findOne({
        where: {
          id: /^\d+$/.test(normalizedFileId) ? Number(normalizedFileId) : normalizedFileId,
        },
      });

      if (!fileEntry) {
        return {
          success: true,
          skipped: true,
          deletedFiles: 0,
        };
      }

      const provider = String(fileEntry?.provider || 'local').trim().toLowerCase();
      if (provider && provider !== 'local') {
        return {
          success: true,
          skipped: true,
          deletedFiles: 0,
        };
      }

      const publicDirectory = resolvePublicDirectory(strapi);
      const localFiles = buildLocalFilePaths(fileEntry, publicDirectory);

      if (localFiles.length === 0) {
        return {
          success: true,
          skipped: true,
          deletedFiles: 0,
        };
      }

      const deletionFailures = [];
      let deletedFiles = 0;

      for (const localFile of localFiles) {
        try {
          await fs.unlink(localFile);
          deletedFiles += 1;
        } catch (error) {
          if (error.code === 'ENOENT') {
            continue;
          }

          deletionFailures.push(localFile);
        }
      }

      if (deletionFailures.length > 0) {
        return {
          success: false,
          message: `Could not delete ${deletionFailures.length} local media file(s).`,
          deletedFiles,
        };
      }

      return {
        success: true,
        deletedFiles,
      };
    },
  };
};
