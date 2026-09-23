'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const LAN_HOST_ENV = 'IMEAL_LAN_HOST';
const PACKAGER_HOST_ENV = 'REACT_NATIVE_PACKAGER_HOSTNAME';
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const MOBILE_PROJECT_ROOT = path.resolve(__dirname, '..', 'apps', 'mobile');

function resolveExpoCliEntrypoint() {
  return require.resolve('expo/bin/cli', { paths: [MOBILE_PROJECT_ROOT] });
}

function valueOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isUsableIpv4(info) {
  if (!info || info.internal || !net.isIPv4(info.address)) return false;
  if (info.family !== 'IPv4' && info.family !== 4) return false;

  const octets = info.address.split('.').map(Number);
  if (octets[0] === 0 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254)) return false;
  if (octets[0] >= 224) return false;
  return true;
}

function addressNumber(address) {
  return address.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
}

function listLanCandidates(networkInterfaces) {
  return Object.entries(networkInterfaces ?? {})
    .flatMap(([name, infos]) => (infos ?? [])
      .filter(isUsableIpv4)
      .map((info) => ({ name, address: info.address })))
    .sort((left, right) => (
      addressNumber(left.address) - addressNumber(right.address)
      || left.name.localeCompare(right.name)
      || left.address.localeCompare(right.address)
    ));
}

function resolveLanHost(env = process.env, networkInterfaces = os.networkInterfaces()) {
  const explicitHost = valueOrEmpty(env[LAN_HOST_ENV]);
  if (explicitHost) return explicitHost;

  const configuredHost = valueOrEmpty(env[PACKAGER_HOST_ENV]);
  if (configuredHost) return configuredHost;

  const candidates = listLanCandidates(networkInterfaces);
  if (candidates.length === 1) return candidates[0].address;

  if (candidates.length === 0) {
    throw new Error(
      'Could not determine a usable LAN IPv4 address. Set IMEAL_LAN_HOST to the address your phone can reach.',
    );
  }

  const formattedCandidates = candidates
    .map(({ name, address }) => `${name}=${address}`)
    .join(', ');
  throw new Error(
    `Multiple LAN IPv4 addresses found (${formattedCandidates}). Set IMEAL_LAN_HOST to the address your phone can reach.`,
  );
}

function launcherEnvironment(env, networkInterfaces) {
  return {
    ...env,
    [PACKAGER_HOST_ENV]: resolveLanHost(env, networkInterfaces),
  };
}

function startExpo({
  env = process.env,
  networkInterfaces = os.networkInterfaces(),
  platform = process.platform,
  spawnProcess = spawn,
  processApi = process,
} = {}) {
  const windows = platform === 'win32';
  const child = spawnProcess(
    windows ? process.execPath : 'expo',
    windows ? [resolveExpoCliEntrypoint(), 'start', '--lan'] : ['start', '--lan'],
    {
      env: launcherEnvironment(env, networkInterfaces),
      stdio: 'inherit',
      shell: false,
    },
  );

  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    for (const signal of FORWARDED_SIGNALS) {
      processApi.removeListener(signal, signalHandlers[signal]);
    }
  };
  const signalHandlers = {};

  for (const signal of FORWARDED_SIGNALS) {
    signalHandlers[signal] = () => {
      if (!child.killed) child.kill(signal);
    };
    processApi.once(signal, signalHandlers[signal]);
  }

  child.once('error', (error) => {
    cleanup();
    console.error(`Unable to start Expo: ${error.message}`);
    processApi.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    cleanup();
    if (signal) {
      try {
        processApi.kill(processApi.pid, signal);
      } catch {
        processApi.exitCode = 1;
      }
      return;
    }
    processApi.exitCode = code ?? 1;
  });

  return child;
}

module.exports = {
  listLanCandidates,
  resolveExpoCliEntrypoint,
  resolveLanHost,
  startExpo,
};

if (require.main === module) {
  try {
    startExpo();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
