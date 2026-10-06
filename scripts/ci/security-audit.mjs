import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { yarnArgs } from './checks.mjs';

const EXPIRY = '2026-11-06T00:00:00.000Z';

export const AUDIT_EXCEPTIONS = Object.freeze([
  Object.freeze({
    packageName: 'braces',
    version: '3.0.3',
    advisoryId: 1240992,
    ghsa: 'GHSA-vfj7-8cjw-p6xm',
    severity: 'high',
    vulnerableVersions: '<=3.0.3',
    expiresAt: EXPIRY,
  }),
  Object.freeze({
    packageName: 'node-forge',
    version: '1.4.0',
    advisoryId: 1240912,
    ghsa: 'GHSA-86w9-cpqp-85rv',
    severity: 'high',
    vulnerableVersions: '<=1.4.0',
    expiresAt: EXPIRY,
  }),
]);

function advisoryUrl(ghsa) {
  return `https://github.com/advisories/${ghsa}`;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonLines(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).filter((line) => line.length > 0);
  const entries = [];
  for (const [index, line] of lines.entries()) {
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`audit output line ${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(value) || typeof value.value !== 'string' || value.value.length === 0 || !isRecord(value.children)) {
      throw new Error(`audit output line ${index + 1} is incomplete`);
    }
    entries.push(value);
  }
  return entries;
}

function childrenVersions(children) {
  const versions = children['Tree Versions'];
  if (!Array.isArray(versions) || versions.length === 0 || versions.some((version) => typeof version !== 'string' || version.length === 0)) {
    throw new Error('audit finding has incomplete Tree Versions');
  }
  return versions;
}

function findingDetails(entry) {
  const children = entry.children;
  const packageName = entry.value;
  const id = children.ID;
  const severity = children.Severity;
  const url = children.URL;
  const vulnerableVersions = children['Vulnerable Versions'];
  const versions = childrenVersions(children);
  if (typeof id !== 'number' || !Number.isInteger(id) || typeof severity !== 'string' || severity.length === 0 || typeof url !== 'string' || url.length === 0) {
    throw new Error(`audit finding for ${packageName} is incomplete`);
  }
  if (typeof vulnerableVersions !== 'string' || vulnerableVersions.length === 0) {
    throw new Error(`audit finding for ${packageName} has incomplete Vulnerable Versions`);
  }
  return { packageName, id, severity, url, vulnerableVersions, versions };
}

function exceptionMatch(details, now) {
  const exception = AUDIT_EXCEPTIONS.find((candidate) => candidate.packageName === details.packageName);
  if (!exception) return { accepted: false, reason: `unapproved ${details.severity} advisory for ${details.packageName}` };
  if (details.id !== exception.advisoryId || details.url !== advisoryUrl(exception.ghsa)) {
    return { accepted: false, reason: `advisory mismatch for ${details.packageName}; expected ${exception.ghsa} (${exception.advisoryId})` };
  }
  if (details.severity !== exception.severity || details.vulnerableVersions !== exception.vulnerableVersions || details.versions.length !== 1 || details.versions[0] !== exception.version) {
    return { accepted: false, reason: `version or severity mismatch for ${details.packageName}; expected ${exception.version} ${exception.severity}` };
  }
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    return { accepted: false, reason: 'audit exception clock is invalid' };
  }
  if (now.valueOf() >= Date.parse(exception.expiresAt)) {
    return { accepted: false, reason: `audit exception for ${details.packageName}@${exception.version} expired at ${exception.expiresAt}` };
  }
  return { accepted: true, reason: `accepted ${details.packageName}@${exception.version} ${exception.ghsa} until ${exception.expiresAt}` };
}

export function evaluateAudit({ stdout = '', stderr = '', exitCode, now = new Date() } = {}) {
  if (!Number.isInteger(exitCode) || ![0, 1].includes(exitCode)) {
    return { accepted: false, messages: [`audit process exited with unsupported code ${String(exitCode)}`], findings: [] };
  }
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    return { accepted: false, messages: ['audit exception clock is invalid'], findings: [] };
  }
  if (typeof stderr !== 'string' || stderr.trim().length > 0) {
    return { accepted: false, messages: ['audit process wrote unexpected stderr; refusing a partial report'], findings: [] };
  }
  let entries;
  try {
    entries = parseJsonLines(stdout);
  } catch (error) {
    return { accepted: false, messages: [error instanceof Error ? error.message : String(error)], findings: [] };
  }
  const messages = [];
  const findings = [];
  for (const entry of entries) {
    let details;
    try {
      details = findingDetails(entry);
    } catch (error) {
      return { accepted: false, messages: [error instanceof Error ? error.message : String(error)], findings };
    }
    findings.push(details);
    const match = exceptionMatch(details, now);
    messages.push(match.reason);
    if (!match.accepted) return { accepted: false, messages, findings };
  }
  if (exitCode !== 0 && entries.length === 0) {
    return { accepted: false, messages: ['audit process failed without a machine-readable report'], findings };
  }
  return { accepted: true, messages, findings };
}

function runProcess({ command, args, cwd, env, spawnImpl }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }
    const stdout = [];
    const stderr = [];
    let settled = false;
    child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(Object.assign(error, { stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ code, signal, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() });
    });
  });
}

export async function runAudit({ cwd = process.cwd(), environment = process.env, now = new Date(), spawnImpl = spawn, writeOut = process.stdout.write.bind(process.stdout), writeErr = process.stderr.write.bind(process.stderr) } = {}) {
  const argv = yarnArgs('npm', 'audit', '--all', '--recursive', '--no-deprecations', '--json');
  let result;
  try {
    result = await runProcess({ command: argv[0], args: argv.slice(1), cwd, env: environment, spawnImpl });
  } catch (error) {
    if (error?.stdout) writeOut(error.stdout);
    if (error?.stderr) writeErr(error.stderr);
    writeErr(`security-audit: audit process failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if (result.stdout) writeOut(result.stdout);
  if (result.stderr) writeErr(result.stderr);
  const decision = evaluateAudit({ stdout: result.stdout, stderr: result.stderr, exitCode: result.code, now });
  for (const message of decision.messages) writeErr(`security-audit: ${message}\n`);
  if (result.signal) {
    writeErr(`security-audit: audit process terminated by ${result.signal}\n`);
    return 1;
  }
  if (!decision.accepted) {
    writeErr('security-audit: qualification failed closed\n');
    return 1;
  }
  writeOut(`security-audit: qualification accepted ${decision.findings.length} report(s); underlying Yarn exit ${result.code}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runAudit().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`security-audit: wrapper failure: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
