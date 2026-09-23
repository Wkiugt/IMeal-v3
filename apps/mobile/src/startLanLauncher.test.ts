import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const mobileProjectRoot = fileURLToPath(new URL('..', import.meta.url));
const expoCliPath = require.resolve('expo/bin/cli');
type NetworkAddress = {
  address: string;
  netmask: string;
  family: string | number;
  mac: string;
  internal: boolean;
  cidr: string;
  scopeid?: number;
};

const { resolveExpoCliEntrypoint, resolveLanHost, startExpo } = require('../../../scripts/start-imeal-lan.js') as {
  resolveExpoCliEntrypoint: () => string;
  resolveLanHost: (env: NodeJS.ProcessEnv, interfaces: Record<string, NetworkAddress[]>) => string;
  startExpo: (options: {
    env: NodeJS.ProcessEnv;
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
    { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: '127.0.0.1/8' },
  ],
  WiFi: [
    { address: '192.168.1.44', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '192.168.1.44/24' },
    { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '', internal: false, scopeid: 4, cidr: 'fe80::1/64' },
  ],
};

describe('start:lan launcher', () => {
  it('resolves the Expo CLI entrypoint from the mobile project root', () => {
    expect(resolveExpoCliEntrypoint()).toBe(
      require.resolve('expo/bin/cli', { paths: [mobileProjectRoot] }),
    );
  });
  it('preserves an explicit host override before inspecting network interfaces', () => {
    expect(resolveLanHost({ IMEAL_LAN_HOST: '10.0.0.25' }, interfaces)).toBe('10.0.0.25');
    expect(resolveLanHost({ REACT_NATIVE_PACKAGER_HOSTNAME: '10.0.0.26' }, interfaces)).toBe('10.0.0.26');
  });

  it('prefers IMEAL_LAN_HOST when both host environment variables are set', () => {
    expect(resolveLanHost({
      IMEAL_LAN_HOST: '10.0.0.25',
      REACT_NATIVE_PACKAGER_HOSTNAME: '10.0.0.26',
    }, interfaces)).toBe('10.0.0.25');
  });

  it('selects the only usable non-loopback IPv4 address', () => {
    expect(resolveLanHost({}, interfaces)).toBe('192.168.1.44');
  });

  it('reports how to override the host when no usable non-loopback IPv4 exists', () => {
    expect(() => resolveLanHost({}, {
      Loopback: interfaces.Loopback,
      IPv6: [interfaces.WiFi[1]],
    })).toThrow(/Could not determine a usable LAN IPv4 address.*IMEAL_LAN_HOST/i);
  });

  it('rejects ambiguous interfaces with an actionable override message', () => {
    expect(() => resolveLanHost({}, {
      WiFi: interfaces.WiFi,
      Ethernet: [
        { address: '10.0.0.44', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '10.0.0.44/24' },
      ],
    })).toThrow(/multiple LAN IPv4 addresses.*10\.0\.0\.44.*192\.168\.1\.44.*IMEAL_LAN_HOST/i);
  });

  it('starts Expo in LAN mode with the selected host and propagates status and signals', () => {
    const signalChild = Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
    const statusChild = Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(signalChild)
      .mockReturnValueOnce(statusChild);
    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const processApi = {
      pid: 123,
      once: vi.fn((signal: NodeJS.Signals, listener: () => void) => signalHandlers.set(signal, listener)),
      removeListener: vi.fn(),
      kill: vi.fn(),
      exitCode: undefined as number | undefined,
    };

    startExpo({
      env: {},
      networkInterfaces: interfaces,
      platform: 'win32',
      spawnProcess,
      processApi,
    });

    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      [expoCliPath, 'start', '--lan'],
      expect.objectContaining({
        shell: false,
        stdio: 'inherit',
        env: expect.objectContaining({ REACT_NATIVE_PACKAGER_HOSTNAME: '192.168.1.44' }),
      }),
    );

    signalHandlers.get('SIGINT')?.();
    expect(signalChild.kill).toHaveBeenCalledWith('SIGINT');

    signalChild.emit('exit', null, 'SIGTERM');
    expect(processApi.kill).toHaveBeenCalledWith(123, 'SIGTERM');
    expect(processApi.removeListener).toHaveBeenCalledTimes(3);
    expect(processApi.removeListener.mock.calls.map(([signal]) => signal)).toEqual([
      'SIGINT',
      'SIGTERM',
      'SIGHUP',
    ]);

    startExpo({
      env: {},
      networkInterfaces: interfaces,
      platform: 'win32',
      spawnProcess,
      processApi,
    });
    statusChild.emit('exit', 7, null);
    expect(processApi.exitCode).toBe(7);
    expect(processApi.removeListener).toHaveBeenCalledTimes(6);
  });

  it('uses the unqualified Expo command on non-Windows platforms', () => {
    const child = Object.assign(new EventEmitter(), { killed: false, kill: vi.fn() });
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

    expect(spawnProcess).toHaveBeenCalledWith(
      'expo',
      ['start', '--lan'],
      expect.objectContaining({ shell: false, stdio: 'inherit' }),
    );
  });
});
