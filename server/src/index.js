'use strict';

const bootstrap = require('./bootstrap');
const destroy = require('./destroy');
const register = require('./register');

module.exports = {
  register,
  bootstrap,
  destroy,
  config: {
    default: {},
    validator() {},
  },
  controllers: {
    core: require('./controllers/core-controller'),
    apiAccelerator: require('./controllers/api-accelerator-controller'),
  },
  routes: {
    admin: {
      type: 'admin',
      routes: require('./routes/admin'),
    },
  },
  services: {
    'core-settings': require('./core/services/settings'),
    'module-registry': require('./core/services/module-registry'),
    'smooth-client': require('./core/services/smooth-client'),
    'api-accelerator-settings': require('./modules/api-accelerator/services/settings'),
    'api-accelerator-discovery': require('./modules/api-accelerator/services/discovery'),
    'api-accelerator-origin-blocker': require('./modules/api-accelerator/services/origin-blocker'),
    'api-accelerator-origin-fetcher': require('./modules/api-accelerator/services/origin-fetcher'),
    'api-accelerator-repository': require('./modules/api-accelerator/services/repository'),
    'api-accelerator-runtime-state': require('./modules/api-accelerator/services/runtime-state'),
    'api-accelerator-sync': require('./modules/api-accelerator/services/sync'),
  },
};
