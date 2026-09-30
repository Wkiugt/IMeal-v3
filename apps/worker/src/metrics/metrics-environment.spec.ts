import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTHORITATIVE_METRICS_ENV,
  readMetricsEnvironment,
  validateMetricsEnvironment,
} from './metrics-environment.js';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe('authoritative metrics environment', () => {
  it('allows non-production tests to omit external collector bindings', () => {
    const env = { NODE_ENV: 'test' };

    expect(validateMetricsEnvironment(env)).toEqual({
      postgresSource: null,
      objectStorageSource: null,
      backupEvidenceSource: null,
      securityBoundarySource: null,
    });
  });

  it('requires every authoritative source binding in production without exposing values', () => {
    const env = { NODE_ENV: 'production' };

    expect(() => validateMetricsEnvironment(env)).toThrow(
      new RegExp(AUTHORITATIVE_METRICS_ENV.postgresSource),
    );
    expect(() => validateMetricsEnvironment(env)).not.toThrow(/Bearer|password|secret/i);
  });

  it('accepts opaque runtime source references and returns them only to the caller', () => {
    const env = {
      NODE_ENV: 'production',
      WORKER_METRICS_POSTGRES_SOURCE: 'postgres-exporter-private',
      WORKER_METRICS_OBJECT_STORAGE_SOURCE: 'minio-capacity-private',
      WORKER_METRICS_BACKUP_EVIDENCE_SOURCE: 'backup-evidence-private',
      WORKER_METRICS_SECURITY_BOUNDARY_SOURCE: 'security-feed-private',
    };

    expect(validateMetricsEnvironment(env)).toEqual({
      postgresSource: 'postgres-exporter-private',
      objectStorageSource: 'minio-capacity-private',
      backupEvidenceSource: 'backup-evidence-private',
      securityBoundarySource: 'security-feed-private',
    });
  });

  it('rejects source references that contain credentials or unsafe whitespace', () => {
    const base = {
      NODE_ENV: 'production',
      WORKER_METRICS_POSTGRES_SOURCE: 'postgres-exporter-private',
      WORKER_METRICS_OBJECT_STORAGE_SOURCE: 'minio-capacity-private',
      WORKER_METRICS_BACKUP_EVIDENCE_SOURCE: 'backup-evidence-private',
      WORKER_METRICS_SECURITY_BOUNDARY_SOURCE: 'security-feed-private',
    };

    expect(() =>
      validateMetricsEnvironment({
        ...base,
        WORKER_METRICS_POSTGRES_SOURCE: 'postgres://user:password@db',
      }),
    ).toThrow(/source configuration/i);
    expect(() =>
      validateMetricsEnvironment({
        ...base,
        WORKER_METRICS_SECURITY_BOUNDARY_SOURCE: 'security feed private',
      }),
    ).toThrow(/source configuration/i);
  });
  it('reads absent optional source bindings as null without mutating process environment', () => {
    expect(readMetricsEnvironment({ NODE_ENV: 'test' })).toEqual({
      postgresSource: null,
      objectStorageSource: null,
      backupEvidenceSource: null,
      securityBoundarySource: null,
    });
  });

});
