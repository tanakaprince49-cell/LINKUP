const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// shared/ lives at the repo root (outside the mobile project) so the Vercel
// functions in api/ and the app can import the same price list instead of
// drifting apart. Metro refuses to bundle outside its root unless the folder
// is watched and treated as a module root.
const sharedRoot = path.resolve(__dirname, '..', 'shared');
config.watchFolders = [...(config.watchFolders || []), sharedRoot];
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [
    ...(config.resolver?.nodeModulesPaths || []),
    path.resolve(__dirname, 'node_modules'),
  ],
};

config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  }),
};

module.exports = config;
