'use strict';

module.exports = ({ strapi }) => {
  const plugin = strapi.plugin('smoothcdn');
  const watchedDocumentActions = new Set(['create', 'update', 'delete', 'publish', 'unpublish', 'discardDraft']);
  const watchedLifecycleActions = new Set([
    'afterCreate',
    'afterCreateMany',
    'afterDelete',
    'afterDeleteMany',
    'afterUpdate',
    'afterUpdateMany',
  ]);

  const enqueueContentType = (uid, source) => {
    const normalizedUid = String(uid || '').trim();
    if (!normalizedUid.startsWith('api::')) {
      return;
    }

    Promise.resolve(plugin.service('api-accelerator-sync').queueContentType(normalizedUid)).catch((error) => {
      strapi.log.error(
        `[smoothcdn] Failed to queue content type "${normalizedUid}" from ${source}: ${error.message}`
      );
    });
  };

  strapi.server.use(plugin.service('api-accelerator-origin-blocker').middleware());

  let documentMiddlewareRegistered = false;

  if (strapi.documents && typeof strapi.documents.use === 'function') {
    try {
      strapi.documents.use(async (context, next) => {
        const result = await next();
        if (watchedDocumentActions.has(String(context?.action || '')) && context?.uid) {
          enqueueContentType(context.uid, 'document-service-middleware');
        }

        return result;
      });
      documentMiddlewareRegistered = true;
    } catch (error) {
      strapi.log.warn(
        `[smoothcdn] Could not register document service middleware, falling back to DB lifecycles: ${error.message}`
      );
    }
  }

  if (!documentMiddlewareRegistered && strapi.db?.lifecycles?.subscribe) {
    strapi.db.lifecycles.subscribe((event) => {
      if (!watchedLifecycleActions.has(String(event?.action || ''))) {
        return;
      }

      const uid = event?.model?.uid;
      if (uid) {
        enqueueContentType(uid, 'db-lifecycle');
      }
    });
  }
};
