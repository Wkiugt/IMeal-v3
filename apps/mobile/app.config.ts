import type { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'IMealMobile',
  slug: 'imeal-mobile',
  version: '1.0.0',
  scheme: 'imeal',
  platforms: ['ios', 'android', 'web'],
  plugins: [
    ...(config.plugins ?? []),
    'expo-notifications',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'IMeal uses your foreground location to verify your meal check-in location.',
      },
    ],
  ],
  extra: {
    ...config.extra,
    eas: {
      ...config.extra?.eas,
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined,
    },
  },
});
