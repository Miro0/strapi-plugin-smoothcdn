# Smooth CDN for Strapi

A modular Strapi plugin for Smooth CDN.

## Current scope

- `core`: browser-based Smooth CDN authentication, guest login support, auth polling, and account status sync
- `API Accelerator`: Content API discovery, JSON snapshot sync, purge, and automatic resync
- `CDN Connector`: placeholder module
- `CWV Pipeline`: placeholder module

All modules are disabled by default. The first time any module is enabled, the plugin creates a Smooth CDN project automatically if one does not exist yet.

## Install as a local plugin

1. Place this repository in `src/plugins/smoothcdn`.
2. Enable the plugin in `config/plugins.js`:

```js
module.exports = {
  smoothcdn: {
    enabled: true,
    resolve: './src/plugins/smoothcdn',
  },
};
```

3. Restart Strapi and open the `Smooth CDN` plugin from the admin sidebar.

## Linked-folder setup

If the plugin is linked into `src/plugins` from a directory outside the Strapi app:

1. enable it in `config/plugins.ts` or `config/plugins.js`
2. make sure the plugin repository can resolve the app dependencies, for example with a local symlink such as `node_modules -> ../playground/strapi/node_modules`

Without that extra dependency resolution step, the admin build may fail to resolve packages such as `react`, `@strapi/strapi`, or `@strapi/icons`.

## Architecture

- `server/src/core` contains shared Smooth CDN authentication, status sync, and project management services
- `server/src/modules/api-accelerator` contains the implemented module 1 backend
- `CDN Connector` and `CWV Pipeline` are currently placeholders in both the backend registry and admin UI
