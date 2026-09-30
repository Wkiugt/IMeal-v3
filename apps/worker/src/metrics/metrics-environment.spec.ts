import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTHORITATIVE_METRICS_ENV,
  readMetricsEnvironment,
  readMetricsSourceRegistryConfiguration,
  validateMetricsEnvironment,
  validateMetricsSourceRegistryConfiguration,
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

  it('rejects URL, target, credential, and whitespace-shaped source references without echoing values', () => {
    const base = {
      NODE_ENV: 'production',
      WORKER_METRICS_POSTGRES_SOURCE: 'postgres-exporter-private',
      WORKER_METRICS_OBJECT_STORAGE_SOURCE: 'minio-capacity-private',
      WORKER_METRICS_BACKUP_EVIDENCE_SOURCE: 'backup-evidence-private',
      WORKER_METRICS_SECURITY_BOUNDARY_SOURCE: 'security-feed-private',
    };
    const invalidReferences = [
      ['WORKER_METRICS_POSTGRES_SOURCE', 'https://collector'],
      ['WORKER_METRICS_POSTGRES_SOURCE', 'postgres://db'],
      ['WORKER_METRICS_OBJECT_STORAGE_SOURCE', 'collector.internal:9090'],
      ['WORKER_METRICS_BACKUP_EVIDENCE_SOURCE', 'collector/internal/path'],
      ['WORKER_METRICS_SECURITY_BOUNDARY_SOURCE', 'postgres://user:password@db'],
      ['WORKER_METRICS_SECURITY_BOUNDARY_SOURCE', 'security feed private'],
    ] as const;

    for (const [name, value] of invalidReferences) {
      let thrown: unknown;
      try {
        validateMetricsEnvironment({ ...base, [name]: value });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toMatch(/source configuration/i);
      expect(String(thrown)).not.toContain(value);
    }
  });
  it('reads absent optional source bindings as null without mutating process environment', () => {
    expect(readMetricsEnvironment({ NODE_ENV: 'test' })).toEqual({
      postgresSource: null,
      objectStorageSource: null,
      backupEvidenceSource: null,
      securityBoundarySource: null,
    });
  });

  it('reads the single protected source registry configuration without embedding values', () => {
    const env = {
      NODE_ENV: 'production',
      WORKER_METRICS_SOURCE_REGISTRY_URL: 'https://metrics-registry.internal/feed',
      WORKER_METRICS_SOURCE_BEARER_TOKEN: 'protected-test-token',
    };

    expect(readMetricsSourceRegistryConfiguration(env)).toEqual({
      registryUrl: 'https://metrics-registry.internal/feed',
      bearerToken: 'protected-test-token',
    });
  });

  it('allows absent registry configuration so providers can fail closed at collection time', () => {
    expect(
      validateMetricsSourceRegistryConfiguration({ NODE_ENV: 'production' }),
    ).toEqual({
      registryUrl: null,
      bearerToken: null,
    });
  });

  it.each([
    'http://metrics-registry.internal/feed',
    'https://user:password@metrics-registry.internal/feed',
    'https://metrics-registry.internal/feed?token=secret',
    'https://metrics-registry.internal/feed#fragment',
  ])('rejects unsafe production registry URL %s without echoing it', (registryUrl) => {
    let thrown: unknown;
    try {
      validateMetricsSourceRegistryConfiguration({
        NODE_ENV: 'production',
        WORKER_METRICS_SOURCE_REGISTRY_URL: registryUrl,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toContain('WORKER_METRICS_SOURCE_REGISTRY_URL');
    expect(String(thrown)).not.toContain(registryUrl);
  });

});
