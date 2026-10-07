import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import appConfig, { androidVersionCodeFromAppVersion } from '../app.config';

const RELEASE_ENV_KEYS = [
  'EAS_BUILD_PROFILE',
  'IMEAL_MOBILE_RELEASE',
  'EXPO_PUBLIC_EAS_PROJECT_ID',
  'EXPO_PUBLIC_API_URL',
  'IMEAL_ANDROID_VERSION_CODE',
  'IMEAL_IOS_BUILD_NUMBER',
] as const;

const originalReleaseEnv = Object.fromEntries(
  RELEASE_ENV_KEYS.map((key) => [key, process.env[key]]),
);

const PUBLIC_API_URL = 'https://api.example.com/api';
const FAKE_PROJECT_ID = 'not-a-real-eas-project';
const DISALLOWED_PRODUCTION_API_URLS = [
  '',
  '   ',
  'http://localhost:3000/api',
  'https://localhost/api',
  'https://127.0.0.1/api',
  'https://127.0.0.1:3000/api',
  'https://[::1]/api',
  'https://10.1.2.3/api',
  'https://172.16.0.4/api',
  'https://172.31.255.1/api',
  'https://192.168.1.10/api',
  'https://169.254.1.1/api',
  'http://api.example.com/api',
  'https://demo.ngrok.io/api',
  'https://demo.ngrok-free.app/api',
  'https://api.example.com',
  'https://api.example.com/v1',
];

function clearReleaseEnv(): void {
  for (const key of RELEASE_ENV_KEYS) {
    delete process.env[key];
  }
}

function evaluate() {
  return appConfig({ config: {} } as never);
}

beforeEach(() => {
  clearReleaseEnv();
});

afterEach(() => {
  for (const key of RELEASE_ENV_KEYS) {
    const value = originalReleaseEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('mobile location permission configuration', () => {
  it('declares foreground-only location permission copy', () => {
    const config = evaluate();
    const locationPlugin = config.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-location',
    );

    expect(locationPlugin).toEqual([
      'expo-location',
      {
        locationWhenInUsePermission:
          'IMeal uses your foreground location to verify your meal check-in location.',
        locationAlwaysPermission: false,
        locationAlwaysAndWhenInUsePermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
        isAndroidMotionActivityEnabled: false,
        motionUsagePermission: false,
      },
    ]);
    expect(config.android?.permissions ?? []).not.toContain(
      'android.permission.ACCESS_BACKGROUND_LOCATION',
    );
    expect(config.android?.blockedPermissions ?? []).toContain(
      'android.permission.ACCESS_BACKGROUND_LOCATION',
    );
  });
});

describe('mobile release identifiers', () => {
  it('uses the same stable namespace and one imea scheme on both platforms', () => {
    const config = evaluate();

    expect(config.version).toBe('1.0.0');
    expect(config.scheme).toBe('imeal');
    expect(config.android?.package).toBe('vn.iec.imeal');
    expect(config.ios?.bundleIdentifier).toBe('vn.iec.imeal');
    expect(config.android?.scheme ?? config.scheme).toBe('imeal');
    expect(config.ios?.scheme ?? config.scheme).toBe('imeal');
    expect(config.plugins).toContain('expo-secure-store');
    expect(config.plugins).toContainEqual([
      'expo-camera',
      {
        cameraPermission:
          'IMeal uses your camera to scan meal check-in QR codes.',
        recordAudioAndroid: false,
      },
    ]);
    expect(config.plugins).toContainEqual([
      'expo-notifications',
      { enableBackgroundRemoteNotifications: false },
    ]);
    expect(config.android?.permissions).toContain(
      'android.permission.POST_NOTIFICATIONS',
    );
    expect(config.android?.permissions ?? []).not.toContain(
      'android.permission.RECORD_AUDIO',
    );
  });

  it('derives a positive Android versionCode and iOS buildNumber from 1.0.0', () => {
    const config = evaluate();

    expect(config.android?.versionCode).toBe(10000);
    expect(config.android?.versionCode).toBeGreaterThan(0);
    expect(config.ios?.buildNumber).toBe('1.0.0');
  });

  it('honors explicit versionCode and buildNumber overrides', () => {
    process.env.IMEAL_ANDROID_VERSION_CODE = '42';
    process.env.IMEAL_IOS_BUILD_NUMBER = '99';

    const config = evaluate();

    expect(config.android?.versionCode).toBe(42);
    expect(config.ios?.buildNumber).toBe('99');
  });

  it('rejects a zero Android versionCode override', () => {
    process.env.IMEAL_ANDROID_VERSION_CODE = '0';

    expect(evaluate).toThrow(/IMEAL_ANDROID_VERSION_CODE/);
  });

  it('derives monotonic versionCodes from major.minor.patch', () => {
    expect(androidVersionCodeFromAppVersion('1.0.0')).toBe(10000);
    expect(androidVersionCodeFromAppVersion('1.2.3')).toBe(10203);
    expect(androidVersionCodeFromAppVersion('2.0.1')).toBe(20001);
    expect(() => androidVersionCodeFromAppVersion('0.0.0')).toThrow(
      /versionCode/,
    );
  });
});

describe('production mobile config fails closed', () => {
  it('requires an EAS project id when the EAS profile is production', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.EXPO_PUBLIC_API_URL = PUBLIC_API_URL;

    expect(evaluate).toThrow(/EXPO_PUBLIC_EAS_PROJECT_ID/);
  });

  it('requires an EAS project id when the release flag is production', () => {
    process.env.IMEAL_MOBILE_RELEASE = 'production';
    process.env.EXPO_PUBLIC_API_URL = PUBLIC_API_URL;

    expect(evaluate).toThrow(/EXPO_PUBLIC_EAS_PROJECT_ID/);
  });

  it.each(DISALLOWED_PRODUCTION_API_URLS)(
    'rejects production API URL %j',
    (apiUrl) => {
      process.env.EAS_BUILD_PROFILE = 'production';
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID = FAKE_PROJECT_ID;
      process.env.EXPO_PUBLIC_API_URL = apiUrl;

      expect(evaluate).toThrow(/EXPO_PUBLIC_API_URL/);
    },
  );

  it('accepts a public HTTPS API URL ending in /api with a project id', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID = `  ${FAKE_PROJECT_ID}  `;
    process.env.EXPO_PUBLIC_API_URL = `${PUBLIC_API_URL}/`;

    const config = evaluate();

    expect(config.extra?.eas?.projectId).toBe(FAKE_PROJECT_ID);
    expect(config.android?.package).toBe('vn.iec.imeal');
    expect(config.ios?.bundleIdentifier).toBe('vn.iec.imeal');
    expect(config.scheme).toBe('imeal');
    expect(config.android?.versionCode).toBeGreaterThan(0);
  });

  it('does not treat development or preview as production', () => {
    process.env.EAS_BUILD_PROFILE = 'preview';
    process.env.IMEAL_MOBILE_RELEASE = 'preview';
    process.env.EXPO_PUBLIC_API_URL = 'http://localhost:3000/api';

    expect(evaluate().scheme).toBe('imeal');

    process.env.EAS_BUILD_PROFILE = 'development';
    process.env.IMEAL_MOBILE_RELEASE = 'development';
    delete process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

    expect(evaluate().extra?.eas?.projectId).toBeUndefined();
  });
});

describe('EAS build profiles', () => {
  it('keeps signing and API URLs out of the committed profiles', () => {
    const easPath = join(dirname(fileURLToPath(import.meta.url)), '../eas.json');

    expect(existsSync(easPath)).toBe(true);

    const eas = JSON.parse(readFileSync(easPath, 'utf8')) as {
      cli?: { appVersionSource?: string };
      build: Record<string, {
        developmentClient?: boolean;
        distribution?: string;
        channel?: string;
        autoIncrement?: boolean;
        environment?: string;
        env?: Record<string, string>;
        android?: { buildType?: string };
      }>;
    };
    const serialized = JSON.stringify(eas);

    expect(eas.cli?.appVersionSource).toBe('local');
    expect(eas.build.development.developmentClient).toBe(false);
    expect(eas.build.development.distribution).toBe('internal');
    expect(eas.build.development.channel).toBe('development');
    expect(eas.build.development.android?.buildType).toBe('apk');
    expect(eas.build.development.environment).not.toBe('production');
    expect(eas.build.development.env?.IMEAL_MOBILE_RELEASE).toBe(
      'development',
    );
    expect(eas.build.development.env?.EXPO_PUBLIC_API_URL).toBeUndefined();
    expect(eas.build.preview.distribution).toBe('internal');
    expect(eas.build.preview.channel).toBe('preview');
    expect(eas.build.preview.environment).toBe('preview');
    expect(eas.build.preview.env?.EXPO_PUBLIC_API_URL).toBeUndefined();
    expect(eas.build.production.autoIncrement).toBe(false);
    expect(eas.build.production.distribution).toBe('store');
    expect(eas.build.production.channel).toBe('production');
    expect(serialized).not.toMatch(/localhost|127\.0\.0\.1|ngrok|BEGIN |PRIVATE KEY/i);
  });
});
