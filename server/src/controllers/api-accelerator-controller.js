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
    const settings = await plugin(strapi).service('api-accelerator-settings').update(ctx.request.body || {});
    ctx.body = {
      data: settings,
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

    const result = await plugin(strapi).service('api-accelerator-sync').syncRoutes(ctx.request.body?.routes || [], {
      trigger: 'manual',
      restrictContentTypes: ctx.request.body?.contentTypes || [],
    });
    const endpoints = await plugin(strapi).service('api-accelerator-repository').all();

    ctx.body = {
      data: {
        result,
        endpoints,
      },
    };
    ctx.status = result.success ? 200 : 400;
  },

  async setSyncable(ctx) {
    const route = ctx.request.body?.route;
    const syncable = Boolean(ctx.request.body?.syncable);
    const entry = await plugin(strapi).service('api-accelerator-repository').setSyncable(route, syncable);

    if (!entry) {
      ctx.status = 404;
      ctx.body = {
        error: {
          message: 'Endpoint not found.',
        },
      };
      return;
    }

    ctx.body = {
      data: entry,
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
