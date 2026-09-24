import { describe, expect, it } from 'vitest';
import appConfig from '../app.config';

describe('mobile location permission configuration', () => {
  it('declares foreground-only location permission copy', () => {
    const config = appConfig({ config: {} } as never);
    const locationPlugin = config.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-location',
    );

    expect(locationPlugin).toEqual([
      'expo-location',
      {
        locationWhenInUsePermission:
          'IMeal uses your foreground location to verify the presenter pickup site.',
      },
    ]);
  });
});
