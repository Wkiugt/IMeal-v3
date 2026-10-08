import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
type NetworkAddress = {
  address: string;
  netmask: string;
  family: string | number;
  mac: string;
  internal: boolean;
  cidr: string;
  scopeid?: number;
};
type LauncherEnvironment = Omit<NodeJS.ProcessEnv, 'NODE_ENV'> & {
  NODE_ENV?: NodeJS.ProcessEnv['NODE_ENV'];
};

const { resolveLanHost, startExpo } =
  require('../../../scripts/start-imeal-lan.js') as {
    resolveLanHost: (
      env: LauncherEnvironment,
      interfaces: Record<string, NetworkAddress[]>,
    ) => string;
    startExpo: (options: {
      env: LauncherEnvironment;
      networkInterfaces: Record<string, NetworkAddress[]>;
      platform: NodeJS.Platform;
      spawnProcess: (...args: unknown[]) => EventEmitter;
      processApi: {
        pid: number;
        once: (signal: NodeJS.Signals, listener: () => void) => void;
        removeListener: (signal: NodeJS.Signals, listener: () => void) => void;
        kill: (pid: number, signal: NodeJS.Signals) => void;
        exitCode?: number;
      };
    }) => EventEmitter;
  };

const interfaces = {
  Loopback: [
    {
      address: '127.0.0.1',
      netmask: '255.0.0.0',
      family: 'IPv4',
      mac: '',
      internal: true,
      cidr: '127.0.0.1/8',
    },
  ],
  WiFi: [
    {
      address: '192.168.1.44',
      netmask: '255.255.255.0',
      family: 'IPv4',
      mac: '',
      internal: false,
      cidr: '192.168.1.44/24',
    },
    {
      address: 'fe80::1',
      netmask: 'ffff:ffff:ffff:ffff::',
      family: 'IPv6',
      mac: '',
      internal: false,
      scopeid: 4,
      cidr: 'fe80::1/64',
    },
  ],
};

describe('start:lan launcher', () => {
  it('preserves an explicit host override before inspecting network interfaces', () => {
    expect(resolveLanHost({ IMEAL_LAN_HOST: '10.0.0.25' }, interfaces)).toBe(
      '10.0.0.25',
    );
    expect(
      resolveLanHost(
        { REACT_NATIVE_PACKAGER_HOSTNAME: '10.0.0.26' },
        interfaces,
      ),
    ).toBe('10.0.0.26');
  });

  it('prefers IMEAL_LAN_HOST when both host environment variables are set', () => {
    expect(
      resolveLanHost(
        {
          IMEAL_LAN_HOST: '10.0.0.25',
          REACT_NATIVE_PACKAGER_HOSTNAME: '10.0.0.26',
        },
        interfaces,
      ),
    ).toBe('10.0.0.25');
  });

  it('selects the only usable non-loopback IPv4 address', () => {
    expect(resolveLanHost({}, interfaces)).toBe('192.168.1.44');
  });

  it('rejects when no usable LAN IPv4 address exists', () => {
    expect(() =>
      resolveLanHost(
        {},
        {
          Loopback: interfaces.Loopback,
          IPv6: [interfaces.WiFi[1]],
        },
      ),
    ).toThrowError(Error);
  });

  it('rejects ambiguous LAN interfaces', () => {
    expect(() =>
      resolveLanHost(
        {},
        {
          WiFi: interfaces.WiFi,
          Ethernet: [
            {
              address: '10.0.0.44',
              netmask: '255.255.255.0',
              family: 'IPv4',
              mac: '',
              internal: false,
              cidr: '10.0.0.44/24',
            },
          ],
        },
      ),
    ).toThrowError(Error);
  });

  it('sets process exit status when Expo exits with a code', () => {
    const child = new EventEmitter();
    const spawnProcess = vi.fn(() => child);
    const processApi = {
      pid: 123,
      once: vi.fn(),
      removeListener: vi.fn(),
      kill: vi.fn(),
      exitCode: undefined as number | undefined,
    };

    startExpo({
      env: { IMEAL_LAN_HOST: '192.168.1.44' },
      networkInterfaces: {},
      platform: 'linux',
      spawnProcess,
      processApi,
    });

    child.emit('exit', 7, null);
    expect(processApi.exitCode).toBe(7);
  });
});
