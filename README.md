# Smooth CDN for Strapi

Smooth CDN for Strapi is a modular plugin that connects Strapi media and API assets with Smooth CDN for faster delivery, optimization, and scalable asset pipelines.

## Features

- **Core connection**
  - Browser-based Smooth CDN authentication
  - Guest login support
  - Auth polling
  - Account status sync
  - Automatic Smooth CDN project creation

- **CDN Connector**
  - Sync Strapi media assets with Smooth CDN
  - Sync image variants
  - Generate direct Smooth CDN delivery links
  - Optional local-file offload

- **API Accelerator**
  - Discover Strapi Content API endpoints
  - Sync JSON snapshots to Smooth CDN
  - Purge generated snapshots
  - Automatically resync snapshots when content changes

All modules are disabled by default. The first time any module is enabled, the plugin creates a Smooth CDN project automatically if one does not exist yet.

## Requirements

- Strapi 5
- Node.js 18 or newer
- A Smooth CDN account or guest session

## Installation

Install the plugin in your Strapi project:

npm install strapi-plugin-smoothcdn

Enable the plugin in config/plugins.js:

module.exports = {
smoothcdn: {
enabled: true,
},
};

Or in config/plugins.ts:

export default {
smoothcdn: {
enabled: true,
},
};

Restart Strapi and open the Smooth CDN plugin from the admin sidebar.

## Local development setup

To use the plugin as a local plugin, place this repository in:

src/plugins/smoothcdn

Then enable it in config/plugins.js:

module.exports = {
smoothcdn: {
enabled: true,
resolve: './src/plugins/smoothcdn',
},
};

Restart Strapi and open the Smooth CDN plugin from the admin sidebar.

## Linked-folder setup

If the plugin is linked into src/plugins from a directory outside the Strapi app, make sure the plugin repository can resolve the app dependencies.

For example, you can create a local symlink:

node_modules -> ../playground/strapi/node_modules

Without this dependency resolution step, the admin build may fail to resolve packages such as react, @strapi/strapi, or @strapi/icons.

## Architecture

- server/src/core contains shared Smooth CDN authentication, status sync, and project management services.
- server/src/modules/cdn-connector contains the CDN Connector backend.
- server/src/modules/api-accelerator contains the API Accelerator backend.

## License

MIT
