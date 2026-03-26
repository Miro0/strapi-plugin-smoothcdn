'use strict';

module.exports = ({ strapi }) => {
  strapi.plugin('smoothcdn').service('api-accelerator-sync').startScheduler();
};
