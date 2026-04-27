# Smooth CDN for Strapi

Smooth CDN for Strapi is a modular plugin that connects Strapi media and API assets with Smooth CDN for faster delivery, optimization, and scalable asset pipelines.

## Features

- **CDN Connector**
  - Sync Strapi media assets with Smooth CDN
  - Sync image variants
  - Generate direct Smooth CDN delivery links


- **API Accelerator**
  - Discover Strapi Content API endpoints
  - Sync JSON snapshots to Smooth CDN
  - Automatically resync snapshots when content changes

## Requirements

- Strapi 5
- Node.js 18 or newer

## Installation

Install the plugin in your Strapi project:

```
npm install strapi-plugin-smoothcdn
```

Enable the plugin in config/plugins.js:

```js
module.exports = {
  smoothcdn: {
    enabled: true,
  },
};
```

Or in config/plugins.ts:

```js
export default () => ({
  smoothcdn: {
    enabled: true,
  },
});
```

Restart Strapi and open the Smooth CDN plugin from the admin sidebar.

## License

MIT
