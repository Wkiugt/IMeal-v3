import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import childProcess from 'node:child_process';

import { safeDiagnostic } from '../staging/staging-lib.mjs';
import {
  createBackup,
  logEvent,
  rehearseBackup,
  restoreBackup,
  verifyBackup,
} from './lib.mjs';

function defaultCommandRunner(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = childProcess.spawn(command, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolvePromise({ stdout, stderr, exitCode }));
  });
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing option ${name}`);
  return value;
}

export async function runCli(argv = process.argv.slice(2), environment = process.env, deps = {}) {
  const [command, ...rest] = argv;
  const commandRunner = deps.commandRunner ?? defaultCommandRunner;
  const logger = deps.logger ?? ((event, fields) => logEvent(process.stderr, event, fields));
  try {
    if (command === 'backup') {
      await createBackup({
        environment,
        outputDirectory: option(rest, '--output'),
        commandRunner,
        logger,
      });
      return 0;
    }
    if (command === 'verify') {
      await verifyBackup({
        manifestPath: option(rest, '--manifest'),
        outputDirectory: option(rest, '--output'),
        commandRunner,
        logger,
      });
      return 0;
    }
    if (command === 'restore' || command === 'rehearsal') {
      const run = command === 'rehearsal' ? rehearseBackup : restoreBackup;
      await run({
        manifestPath: option(rest, '--manifest'),
        outputDirectory: option(rest, '--output'),
        environment,
        commandRunner,
        logger,
      });
      return 0;
    }
    throw new Error(`unknown backup command: ${command ?? '(missing)'}`);
  } catch (error) {
    const message = safeDiagnostic(error, environment.IMEAL_BACKUP_DATABASE_URL);
    logger('backup.fail', { command: command ?? 'unknown', reason: message });
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
