'use strict';

const { buildProjectDashboardUrl } = require('../utils/helpers');
const pluginId = require('../plugin-id');

function plugin(strapi) {
  return strapi.plugin(pluginId);
}

function buildAccount(settings) {
  return {
    connected: Boolean(settings.connected),
    authKeyId: settings.authKeyId,
    authVerificationUrl: settings.authVerificationUrl,
    authSessionStatus: settings.authSessionStatus,
    authMode: settings.authMode,
    projectId: settings.projectId,
    projectSlug: settings.projectSlug,
    projectType: settings.projectType,
    userSlug: settings.userSlug,
    userName: settings.userName,
    userEmail: settings.userEmail,
    userPlan: settings.userPlan,
    userPlanLabel: settings.userPlanLabel,
    guestName: settings.guestName,
    publicBaseUrl: settings.publicBaseUrl,
    lastConnectionAt: settings.lastConnectionAt,
    lastStatusSyncAt: settings.lastStatusSyncAt,
    lastProjectCreationAt: settings.lastProjectCreationAt,
    lastAuthStartedAt: settings.lastAuthStartedAt,
    dashboardUrl: buildProjectDashboardUrl(settings),
  };
}

module.exports = ({ strapi }) => ({
  async bootstrap(ctx) {
    const coreSettings = await plugin(strapi).service('core-settings').get();
    const modules = await plugin(strapi).service('module-registry').list();
    const apiAcceleratorSettings = await plugin(strapi).service('api-accelerator-settings').get();
    const repository = plugin(strapi).service('api-accelerator-repository');

    ctx.body = {
      data: {
        core: {
          settings: coreSettings,
          account: buildAccount(coreSettings),
        },
        modules,
        apiAccelerator: {
          settings: apiAcceleratorSettings,
          endpoints: await repository.all(),
          stats: await repository.stats(),
        },
      },
    };
  },

  async updateSettings(ctx) {
    const settings = await plugin(strapi).service('core-settings').update(ctx.request.body || {});
    ctx.body = {
      data: {
        settings,
        account: buildAccount(settings),
      },
    };
  },

  async startLogin(ctx) {
    const result = await plugin(strapi).service('smooth-client').startLogin(ctx.request.body || {});
    const nextSettings = result.settings || (await plugin(strapi).service('core-settings').get());

    ctx.body = {
      data: {
        ...result,
        account: buildAccount(nextSettings),
      },
    };
    ctx.status = result.success ? 200 : 400;
  },

  async pollLogin(ctx) {
    const result = await plugin(strapi).service('smooth-client').pollLogin(ctx.request.body?.keyId);
    const nextSettings = result.settings || (await plugin(strapi).service('core-settings').get());

    ctx.body = {
      data: {
        ...result,
        account: buildAccount(nextSettings),
      },
    };
    ctx.status = result.success ? 200 : 400;
  },

  async syncStatus(ctx) {
    const result = await plugin(strapi).service('smooth-client').syncStatus();
    const nextSettings = result.settings || (await plugin(strapi).service('core-settings').get());

    ctx.body = {
      data: {
        ...result,
        account: buildAccount(nextSettings),
      },
    };
    ctx.status = result.success ? 200 : 400;
  },

  async disconnect(ctx) {
    const result = await plugin(strapi).service('smooth-client').disconnect();
    const nextSettings = result.settings || (await plugin(strapi).service('core-settings').get());

    ctx.body = {
      data: {
        ...result,
        account: buildAccount(nextSettings),
      },
    };
  },

  async toggleModule(ctx) {
    const moduleId = String(ctx.params?.moduleId || '').trim();
    const enabled = Boolean(ctx.request.body?.enabled);
    const registry = plugin(strapi).service('module-registry');
    const definition = await registry.getDefinition(moduleId);

    if (!definition) {
      ctx.status = 404;
      ctx.body = {
        error: {
          message: 'Module not found.',
        },
      };
      return;
    }

    if (enabled) {
      const projectResult = await plugin(strapi).service('smooth-client').ensureProject(moduleId);
      if (!projectResult.success) {
        ctx.status = 400;
        ctx.body = {
          error: {
            message: projectResult.message,
          },
        };
        return;
      }

      ctx.state.projectCreated = Boolean(projectResult.created);
    }

    const moduleEntry = await registry.setEnabled(moduleId, enabled);
    const modules = await registry.list();
    const coreSettings = await plugin(strapi).service('core-settings').get();

    ctx.body = {
      data: {
        module: moduleEntry,
        modules,
        account: buildAccount(coreSettings),
        projectCreated: Boolean(ctx.state.projectCreated),
      },
    };
  },
});
