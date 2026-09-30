export const AUTHORITATIVE_METRICS_ENV = Object.freeze({
  postgresSource: 'WORKER_METRICS_POSTGRES_SOURCE',
  objectStorageSource: 'WORKER_METRICS_OBJECT_STORAGE_SOURCE',
  backupEvidenceSource: 'WORKER_METRICS_BACKUP_EVIDENCE_SOURCE',
  securityBoundarySource: 'WORKER_METRICS_SECURITY_BOUNDARY_SOURCE',
} as const);

export interface WorkerMetricsEnvironment {
  readonly postgresSource: string | null;
  readonly objectStorageSource: string | null;
  readonly backupEvidenceSource: string | null;
  readonly securityBoundarySource: string | null;
}

const SOURCE_NAMES = Object.values(AUTHORITATIVE_METRICS_ENV);
const CREDENTIAL_PATTERN = /(?:password|secret|token|api[_-]?key)\s*[:=]|:\S+@/i;

function sourceReference(
  env: NodeJS.ProcessEnv,
  name: string,
): string | null {
  const value = env[name]?.trim();
  return value || null;
}

function isSafeSourceReference(value: string): boolean {
  return (
    value.length <= 256 &&
    !/\s/.test(value) &&
    !CREDENTIAL_PATTERN.test(value)
  );
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
