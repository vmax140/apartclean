import type { ExpoConfig } from 'expo/config';

// Ikone, splash ekran i objašnjenja dozvola stižu u Fazi 4 (SPEC sekcija 10).
const config: ExpoConfig = {
  name: 'ApartClean',
  slug: 'apartclean',
  scheme: 'apartclean',
  version: '0.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'rs.apartclean.app',
  },
  android: {
    package: 'rs.apartclean.app',
  },
  web: {
    bundler: 'metro',
    output: 'static',
  },
  plugins: ['expo-router', 'expo-status-bar'],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
