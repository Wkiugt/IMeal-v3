export const AUTHORITATIVE_METRICS_ENV = Object.freeze({
  postgresSource: 'WORKER_METRICS_POSTGRES_SOURCE',
  objectStorageSource: 'WORKER_METRICS_OBJECT_STORAGE_SOURCE',
  backupEvidenceSource: 'WORKER_METRICS_BACKUP_EVIDENCE_SOURCE',
  securityBoundarySource: 'WORKER_METRICS_SECURITY_BOUNDARY_SOURCE',
  sourceRegistryUrl: 'WORKER_METRICS_SOURCE_REGISTRY_URL',
  sourceBearerToken: 'WORKER_METRICS_SOURCE_BEARER_TOKEN',
} as const);

export interface WorkerMetricsEnvironment {
  readonly postgresSource: string | null;
  readonly objectStorageSource: string | null;
  readonly backupEvidenceSource: string | null;
  readonly securityBoundarySource: string | null;
}

export interface WorkerMetricsSourceRegistryConfiguration {
  readonly registryUrl: string | null;
  readonly bearerToken: string | null;
}

const SOURCE_NAMES = [
  AUTHORITATIVE_METRICS_ENV.postgresSource,
  AUTHORITATIVE_METRICS_ENV.objectStorageSource,
  AUTHORITATIVE_METRICS_ENV.backupEvidenceSource,
  AUTHORITATIVE_METRICS_ENV.securityBoundarySource,
] as const;
const SOURCE_REGISTRY_URL = AUTHORITATIVE_METRICS_ENV.sourceRegistryUrl;
const SOURCE_BEARER_TOKEN = AUTHORITATIVE_METRICS_ENV.sourceBearerToken;

/**
 * Opaque deployment reference grammar: one ASCII alphanumeric start character,
 * followed by at most 127 ASCII alphanumerics, dots, underscores, or hyphens.
 * URI schemes, host/port forms, paths, queries, credentials, and payload text
 * are intentionally outside this grammar.
 */
const SOURCE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function rawTrimmedValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | null {
  const value = env[name]?.trim();
  return value || null;
}

function sourceReference(
  env: NodeJS.ProcessEnv,
  name: string,
): string | null {
  return rawTrimmedValue(env, name);
}

function isSafeSourceReference(value: string): boolean {
  return SOURCE_REFERENCE_PATTERN.test(value);
}

export function readMetricsEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): WorkerMetricsEnvironment {
  return {
    postgresSource: sourceReference(env, AUTHORITATIVE_METRICS_ENV.postgresSource),
    objectStorageSource: sourceReference(
      env,
      AUTHORITATIVE_METRICS_ENV.objectStorageSource,
    ),
    backupEvidenceSource: sourceReference(
      env,
      AUTHORITATIVE_METRICS_ENV.backupEvidenceSource,
    ),
    securityBoundarySource: sourceReference(
      env,
      AUTHORITATIVE_METRICS_ENV.securityBoundarySource,
    ),
  };
}

export function validateMetricsEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): WorkerMetricsEnvironment {
  const configuration = readMetricsEnvironment(env);
  validateMetricsSourceRegistryConfiguration(env);
  if (env.NODE_ENV?.trim() !== 'production') return configuration;
  const missing = SOURCE_NAMES.filter((name) => !sourceReference(env, name));
  if (missing.length > 0) {
    throw new Error(
      `authoritative metrics source configuration is required: ${missing.join(', ')}`,
    );
  }
  for (const name of SOURCE_NAMES) {
    const value = sourceReference(env, name);
    if (!value || !isSafeSourceReference(value)) {
      throw new Error(`authoritative metrics source configuration is invalid: ${name}`);
    }
  }
  return configuration;
}

export function readMetricsSourceRegistryConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): WorkerMetricsSourceRegistryConfiguration {
  return {
    registryUrl: rawTrimmedValue(env, SOURCE_REGISTRY_URL),
    bearerToken: rawTrimmedValue(env, SOURCE_BEARER_TOKEN),
  };
}

export function validateMetricsSourceRegistryConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): WorkerMetricsSourceRegistryConfiguration {
  const configuration = readMetricsSourceRegistryConfiguration(env);
  const { registryUrl } = configuration;
  if (!registryUrl) {
    return { registryUrl: null, bearerToken: null };
  }

  let parsed: URL;
  try {
    parsed = new URL(registryUrl);
  } catch {
    throw new Error(`invalid protected source registry configuration: ${SOURCE_REGISTRY_URL}`);
  }
  if (
    (env.NODE_ENV?.trim() === 'production' && parsed.protocol !== 'https:') ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.hostname.length === 0
  ) {
    throw new Error(`invalid protected source registry configuration: ${SOURCE_REGISTRY_URL}`);
  }
  return configuration;
}
