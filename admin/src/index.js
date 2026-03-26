import pluginId from './pluginId';
import PluginIcon from './components/PluginIcon.jsx';

const plugin = {
  register(app) {
    app.addMenuLink({
      to: `/plugins/${pluginId}`,
      icon: PluginIcon,
      intlLabel: {
        id: `${pluginId}.plugin.name`,
        defaultMessage: 'Smooth CDN',
      },
      Component: async () => import('./pages/App'),
    });

    app.registerPlugin({
      id: pluginId,
      name: 'Smooth CDN',
    });
  },
};

export default plugin;
