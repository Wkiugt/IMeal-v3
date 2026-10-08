import { isIP } from 'node:net';
import type { ConfigContext, ExpoConfig } from 'expo/config';

export const APP_VERSION = '1.0.0';

const ANDROID_PACKAGE = 'vn.iec.imeal';
const IOS_BUNDLE_IDENTIFIER = 'vn.iec.imeal';
const APP_SCHEME = 'imeal';
const POST_NOTIFICATIONS = 'android.permission.POST_NOTIFICATIONS';
const BACKGROUND_LOCATION = 'android.permission.ACCESS_BACKGROUND_LOCATION';
const RECORD_AUDIO = 'android.permission.RECORD_AUDIO';
const NGROK_HOSTS = [
  'ngrok.io',
  'ngrok.app',
  'ngrok.dev',
  'ngrok.pro',
  'ngrok-free.app',
  'ngrok-free.dev',
];

export function androidVersionCodeFromAppVersion(version: string): number {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(
      `App version "${version}" must be major.minor.patch to derive a positive Android versionCode`,
    );
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (minor > 99 || patch > 99) {
    throw new Error(
      `App version "${version}" cannot derive a unique Android versionCode; minor and patch must be 0-99`,
    );
  }

  const versionCode = major * 10000 + minor * 100 + patch;
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
    throw new Error(
      `App version "${version}" derived Android versionCode ${versionCode}, which must be a positive integer`,
    );
  }

  return versionCode;
}

function resolveAndroidVersionCode(
  version: string,
  env: NodeJS.ProcessEnv,
): number {
  const override = env.IMEAL_ANDROID_VERSION_CODE?.trim() ?? '';
  if (!override) {
    return androidVersionCodeFromAppVersion(version);
  }
  if (!/^[1-9]\d*$/.test(override)) {
    throw new Error(
      'IMEAL_ANDROID_VERSION_CODE must be a positive integer and must not be 0',
    );
  }

  const versionCode = Number(override);
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
    throw new Error(
      'IMEAL_ANDROID_VERSION_CODE must be a positive integer and must not be 0',
    );
  }
  return versionCode;
}

function resolveIosBuildNumber(
  version: string,
  env: NodeJS.ProcessEnv,
): string {
  const override = env.IMEAL_IOS_BUILD_NUMBER?.trim() ?? '';
  if (override) {
    return override;
  }
  if (!version.trim()) {
    throw new Error('iOS buildNumber requires a non-empty app version');
  }
  return version;
}

function isPrivateOrLoopbackIpv4(hostname: string): boolean {
  if (isIP(hostname) !== 4) {
    return false;
  }
  const [first, second] = hostname.split('.').map(Number);
  if (first === 0 || first === 10 || first === 127) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  return first === 192 && second === 168;
}

function expandIpv6(hostname: string): number[] | undefined {
  const host = hostname.toLowerCase();
  if (isIP(host) !== 6 || host.includes('.')) {
    return undefined;
  }

  const pieces = host.split('::');
  if (pieces.length > 2) {
    return undefined;
  }
  const [head, tail] = pieces;
  const headParts = head ? head.split(':') : [];
  if (tail === undefined) {
    if (headParts.length !== 8) {
      return undefined;
    }
    return headParts.map((part) => Number.parseInt(part, 16));
  }

  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) {
    return undefined;
  }
  const parts = [...headParts, ...Array<string>(missing).fill('0'), ...tailParts];
  if (
    parts.length !== 8 ||
    parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))
  ) {
    return undefined;
  }
  return parts.map((part) => Number.parseInt(part, 16));
}

function isPrivateOrLoopbackIpv6(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.startsWith('::ffff:')) {
    const mapped = host.slice('::ffff:'.length);
    if (isIP(mapped) === 4) {
      return isPrivateOrLoopbackIpv4(mapped);
    }
  }

  const parts = expandIpv6(host);
  if (!parts) {
    return isIP(host) === 6;
  }
  const [first] = parts;
  if (parts.every((part) => part === 0)) {
    return true;
  }
  if (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) {
    return true;
  }
  if (first >= 0xfe80 && first <= 0xfebf) {
    return true;
  }
  return first >= 0xfc00 && first <= 0xfdff;
}

function isDisallowedProductionHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host.length === 0 ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'host.docker.internal' ||
    host.endsWith('.local') ||
    NGROK_HOSTS.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  ) {
    return true;
  }
  if (isPrivateOrLoopbackIpv4(host)) {
    return true;
  }
  return isIP(host) === 6 && isPrivateOrLoopbackIpv6(host);
}

function productionApiUrlProblem(value: string | undefined): string | null {
  const raw = value?.trim() ?? '';
  if (!raw) {
    return 'EXPO_PUBLIC_API_URL is required for a production mobile release and must be a public HTTPS URL ending in /api';
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.replace(/\/+$/, ''));
  } catch {
    return 'EXPO_PUBLIC_API_URL must be a valid public HTTPS URL ending in /api';
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== '/api' ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    isDisallowedProductionHost(parsed.hostname)
  ) {
    return 'EXPO_PUBLIC_API_URL must be a public HTTPS URL ending in /api; localhost, loopback, private LAN, and ngrok hosts are not allowed';
  }
  return null;
}

function requireProductionProjectId(env: NodeJS.ProcessEnv): string {
  const projectId = env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() ?? '';
  const apiProblem = productionApiUrlProblem(env.EXPO_PUBLIC_API_URL);
  const problems = [
    projectId
      ? undefined
      : 'EXPO_PUBLIC_EAS_PROJECT_ID is required for a production mobile release',
    apiProblem ?? undefined,
  ].filter((problem): problem is string => Boolean(problem));

  if (problems.length > 0) {
    throw new Error(
      `Production mobile config is incomplete: ${problems.join('; ')}`,
    );
  }
  return projectId;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const versionCode = resolveAndroidVersionCode(APP_VERSION, process.env);
  const buildNumber = resolveIosBuildNumber(APP_VERSION, process.env);
  const projectId =
    process.env.EAS_BUILD_PROFILE === 'production' ||
    process.env.IMEAL_MOBILE_RELEASE === 'production'
      ? requireProductionProjectId(process.env)
      : process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() || undefined;

  return {
    ...config,
    name: 'IMealMobile',
    slug: 'imeal-mobile',
    version: APP_VERSION,
    scheme: APP_SCHEME,
    platforms: ['ios', 'android', 'web'],
    android: {
      ...config.android,
      package: ANDROID_PACKAGE,
      versionCode,
      permissions: [
        ...new Set([
          ...(config.android?.permissions ?? []),
          POST_NOTIFICATIONS,
        ]),
      ].filter(
        (permission) =>
          permission !== BACKGROUND_LOCATION && permission !== RECORD_AUDIO,
      ),
      blockedPermissions: [
        ...new Set([
          ...(config.android?.blockedPermissions ?? []),
          BACKGROUND_LOCATION,
          RECORD_AUDIO,
        ]),
      ],
    },
    ios: {
      ...config.ios,
      bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
      buildNumber,
    },
    plugins: [
      ...(config.plugins ?? []),
      [
        'expo-notifications',
        {
          // Android 13+ POST_NOTIFICATIONS is merged from the
          // expo-notifications library manifest. The plugin has no
          // permission key, so the same permission is also declared on
          // android.permissions. Background remote notifications stay off.
          enableBackgroundRemoteNotifications: false,
        },
      ],
      [
        'expo-camera',
        {
          cameraPermission:
            'IMeal uses your camera to scan meal check-in QR codes.',
          recordAudioAndroid: false,
        },
      ],
      [
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
      ],
      'expo-font',
      'expo-secure-store',
      'expo-status-bar',
    ],
    extra: {
      ...config.extra,
      eas: {
        ...config.extra?.eas,
        projectId,
      },
    },
  };
};
