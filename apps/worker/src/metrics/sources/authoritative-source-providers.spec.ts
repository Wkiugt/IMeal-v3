import { describe, expect, it, vi } from 'vitest';
import type { MetricEvidenceMetadata, MetricFreshness } from '@imeal/observability';
import {
  type AuthoritativeSourceTransport,
  createAuthoritativeSourceTransport,
  createAuthoritativeSourceResolver,
} from './authoritative-source-transport.js';
import {
  createPostgresAuthoritativeSourceProvider,
  type PostgresAuthoritativeSourceProviderConfig,
} from './postgres-authoritative-source.provider.js';
import {
  createObjectStorageAuthoritativeSourceProvider,
  type ObjectStorageAuthoritativeSourceProviderConfig,
} from './object-storage-authoritative-source.provider.js';
import {
  createBackupRestoreAuthoritativeSourceProvider,
  type BackupRestoreAuthoritativeSourceProviderConfig,
} from './backup-restore-authoritative-source.provider.js';
import {
  createSecurityBoundaryAuthoritativeSourceProvider,
  type SecurityBoundaryAuthoritativeSourceProviderConfig,
} from './security-boundary-authoritative-source.provider.js';

const observedAt = '2026-09-30T00:00:00.000Z';
const digest = `sha256:${'a'.repeat(64)}`;
const targetFingerprint = `sha256:${'b'.repeat(64)}`;
const rehearsalDigest = `sha256:${'c'.repeat(64)}`;
const release = 'release-test';

type SourcePayload = Record<string, unknown>;

function transportFor(payload: unknown): AuthoritativeSourceTransport {
  return {
    requestJson: async <T>(
      _reference: string,
      _request: { readonly observedAt: string },
      schema: (value: unknown) => value is T,
    ) => {
      if (!schema(payload)) return undefined;
      return payload as T;
    },
  };
}

function evidence(
  source: string,
  freshness: MetricFreshness = 'fresh',
  extra: SourcePayload = {},
): MetricEvidenceMetadata {
  return {
    release,
    source,
    observedAt,
    contractRevision: '2026-09-30',
    freshness,
    sha256Digest: digest,
    sourceKind: 'authoritative',
    ...extra,
  };
}

function postgresPayload(
  overrides: SourcePayload = {},
): SourcePayload {
  return {
    observedAt,
    freshness: 'fresh',
    evidence: evidence('postgres_authoritative', 'fresh', {
      sourceBinding: 'approved_postgres_source',
      queryExporterBinding: 'approved_postgres_query_or_exporter',
      querySchemaRevision: 'query-schema-v1',
      targetFingerprint,
    }),
    targetScope: 'imeal_postgres',
    connectionUsage: [
      { pool: 'pgbouncer_client', usedConnections: 2, configuredMaximum: 10 },
      { pool: 'postgres_backend', usedConnections: 1, configuredMaximum: 5 },
    ],
    transactionErrors: 0,
    lockWaits: 1,
    diskUsedBytes: 3,
    diskCapacityBytes: 10,
    ...overrides,
  };
}

function objectStoragePayload(
  overrides: SourcePayload = {},
): SourcePayload {
  return {
    observedAt,
    freshness: 'fresh',
    evidence: evidence('object_storage_authoritative', 'fresh', {
      sourceBinding: 'approved_object_storage_source',
      capacitySourceBinding: 'approved_object_storage_capacity_source',
      operationTaxonomyRevision: 'operation-taxonomy-v1',
      targetFingerprint,
    }),
    targetScope: 'imeal_private_storage',
    usableCapacityBytes: 10,
    operationErrors: [
      { operation: 'health', count: 0 },
      { operation: 'read', count: 1 },
      { operation: 'write', count: 0 },
    ],
    ...overrides,
  };
}

function backupPayload(overrides: SourcePayload = {}): SourcePayload {
  return {
    observedAt,
    freshness: 'fresh',
    evidence: evidence('backup_restore_evidence', 'fresh', {
      targetFingerprint,
      manifestDigest: digest,
      manifestCompletionTimestamp: '2026-09-29T23:00:00.000Z',
      rehearsalDigest,
      verificationResult: 'passed',
    }),
    targetFingerprint,
    release,
    manifestDigest: digest,
    manifestCompletionTimestamp: '2026-09-29T23:00:00.000Z',
    retentionState: 'retained',
    checksumVerification: 'passed',
    checksumFailures: 0,
    rehearsalDigest,
    rehearsalVerification: 'passed',
    restoreTestFailures: 0,
    ...overrides,
  };
}

function securityPayload(overrides: SourcePayload = {}): SourcePayload {
  return {
    observedAt,
    freshness: 'fresh',
    evidence: evidence('security_boundary_evidence', 'fresh', {
      securityTaxonomyRevision: 'security-taxonomy-v1',
      deduplicationWindow: 'PT1M',
    }),
    violations: [
      { category: 'invalid_tls', eventDigest: digest },
    ],
    ...overrides,
  };
}

const postgresConfig = (transport: AuthoritativeSourceTransport): PostgresAuthoritativeSourceProviderConfig => ({
  transport,
  targetFingerprint,
});
const objectStorageConfig = (
  transport: AuthoritativeSourceTransport,
): ObjectStorageAuthoritativeSourceProviderConfig => ({ transport, targetFingerprint });
const backupConfig = (
  transport: AuthoritativeSourceTransport,
): BackupRestoreAuthoritativeSourceProviderConfig => ({ transport, targetFingerprint, release });
const securityConfig = (
  transport: AuthoritativeSourceTransport,
): SecurityBoundaryAuthoritativeSourceProviderConfig => ({ transport });

describe('authoritative source transport', () => {
  it('resolves opaque references through one protected registry/feed endpoint', async () => {
    const resolver = createAuthoritativeSourceResolver({
      registryUrl: 'https://metrics.internal.example/registry',
      privateSource: true,
      accessToken: 'protected-test-token',
      workloadIdentity: { provider: 'test-workload', credentialName: 'test-credential' },
      mutualTls: {
        clientCertificateName: 'test-client-cert',
        clientKeyName: 'test-client-key',
        caCertificateName: 'test-ca',
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ value: 1 }),
    });
    const decorateRequest = vi.fn((_endpoint, init) => ({
      ...init,
      headers: { ...init.headers, 'X-Injected-Identity': 'workload' },
    }));
    const transport = createAuthoritativeSourceTransport(resolver, {
      fetchImpl,
      decorateRequest,
      timeoutMs: 50,
    });

    await expect(
      transport.requestJson('postgres_ref', { observedAt }, (value): value is { value: number } => (
        typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'number'
      )),
    ).resolves.toEqual({ value: 1 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://metrics.internal.example/registry',
      expect.objectContaining({
        body: JSON.stringify({ reference: 'postgres_ref', observedAt }),
        headers: expect.objectContaining({
          Authorization: 'Bearer protected-test-token',
          'X-Injected-Identity': 'workload',
        }),
      }),
    );
    expect(decorateRequest).toHaveBeenCalledTimes(1);
  });

  it('resolves opaque references to private HTTPS endpoints without embedding URLs in references', async () => {
    const resolver = createAuthoritativeSourceResolver({
      postgres_ref: {
        endpoint: 'https://metrics.internal.example/observations',
        privateSource: true,
        accessToken: 'protected-test-token',
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ value: 1 }),
    });
    const transport = createAuthoritativeSourceTransport(resolver, {
      fetchImpl,
      timeoutMs: 50,
    });

    await expect(
      transport.requestJson('postgres_ref', { observedAt }, (value): value is { value: number } => (
        typeof value === 'object' && value !== null && 'value' in value && typeof value.value === 'number'
      )),
    ).resolves.toEqual({ value: 1 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://metrics.internal.example/observations',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer protected-test-token' }) }),
    );
  });

  it('fails closed for missing resolver config, timeout, non-2xx, malformed JSON, or extra schema fields', async () => {
    const missing = createAuthoritativeSourceTransport(
      createAuthoritativeSourceResolver({}),
      { fetchImpl: vi.fn(), timeoutMs: 10 },
    );
    await expect(missing.requestJson('missing', { observedAt }, (_value): _value is unknown => true)).resolves.toBeUndefined();

    const timeout = createAuthoritativeSourceTransport(
      createAuthoritativeSourceResolver({
        ref: { endpoint: 'https://metrics.internal.example', privateSource: true },
      }),
      {
        timeoutMs: 10,
        fetchImpl: vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('timed out')));
        })),
      },
    );
    await expect(timeout.requestJson('ref', { observedAt }, (_value): _value is unknown => true)).resolves.toBeUndefined();

    for (const response of [
      { ok: false, status: 503, json: async () => ({}) },
      { ok: true, status: 200, json: async () => '{not-json' },
      { ok: true, status: 200, json: async () => ({ value: 1, extra: true }) },
    ]) {
      const transport = createAuthoritativeSourceTransport(
        createAuthoritativeSourceResolver({
          ref: { endpoint: 'https://metrics.internal.example', privateSource: true },
        }),
        { fetchImpl: vi.fn().mockResolvedValue(response) },
      );
      await expect(
        transport.requestJson('ref', { observedAt }, (value): value is { value: number } => {
          if (typeof value !== 'object' || value === null || Object.keys(value).join(',') !== 'value') {
            return false;
          }
          return 'value' in value && typeof value.value === 'number';
        }),
      ).resolves.toBeUndefined();
    }
  });
  it('rejects non-HTTPS and public IP endpoints before invoking fetch', async () => {
    for (const endpoint of ['http://metrics.internal.example', 'https://8.8.8.8']) {
      const transport = createAuthoritativeSourceTransport(
        createAuthoritativeSourceResolver({
          ref: { endpoint, privateSource: true },
        }),
        { fetchImpl: vi.fn() },
      );
      await expect(
        transport.requestJson('ref', { observedAt }, (_value): _value is unknown => true),
      ).resolves.toBeUndefined();
    }
  });

});


describe('authoritative source providers', () => {
  it('maps valid PostgreSQL/PgBouncer M14-M17 input and preserves explicit zeroes', async () => {
    const provider = createPostgresAuthoritativeSourceProvider(
      postgresConfig(transportFor(postgresPayload({ transactionErrors: 0, lockWaits: 0 }))),
    );
    await expect(provider.collect('opaque-postgres-ref', observedAt)).resolves.toEqual(
      postgresPayload({ transactionErrors: 0, lockWaits: 0 }),
    );
  });
  it('rejects evidence with a release outside the protected release grammar', async () => {
    const validPayload = objectStoragePayload();
    const payload = objectStoragePayload({
      evidence: {
        ...(validPayload.evidence as SourcePayload),
        release: 'staging-release',
      },
    });
    await expect(
      createObjectStorageAuthoritativeSourceProvider(objectStorageConfig(transportFor(payload)))
        .collect('opaque-storage-ref', observedAt),
    ).resolves.toBeUndefined();
  });

  it('maps valid backup/restore M20-M22 evidence and security M23 registry-bound input', async () => {
    const backup = backupPayload();
    const security = securityPayload({ violations: [] });
    await expect(
      createBackupRestoreAuthoritativeSourceProvider(backupConfig(transportFor(backup)))
        .collect('opaque-backup-ref', observedAt),
    ).resolves.toEqual(backup);
    await expect(
      createSecurityBoundaryAuthoritativeSourceProvider(securityConfig(transportFor(security)))
        .collect('opaque-security-ref', observedAt),
    ).resolves.toEqual(security);
  });

  it('returns undefined for missing provider config or transport results and never falls back to zeroes', async () => {
    const provider = createPostgresAuthoritativeSourceProvider({
      transport: undefined,
      targetFingerprint,
    } as unknown as PostgresAuthoritativeSourceProviderConfig);
    await expect(provider.collect('opaque-ref', observedAt)).resolves.toBeUndefined();
    await expect(
      createObjectStorageAuthoritativeSourceProvider(objectStorageConfig(transportFor(undefined)))
        .collect('opaque-ref', observedAt),
    ).resolves.toBeUndefined();
  });

  it('rejects malformed or extra fields and mismatched evidence, target, or request timestamp', async () => {
    const malformed = [
      postgresPayload({ extra: true }),
      postgresPayload({ transactionErrors: undefined }),
      postgresPayload({
        evidence: evidence('object_storage_authoritative', 'fresh', {
          sourceBinding: 'approved_postgres_source',
          queryExporterBinding: 'approved_postgres_query_or_exporter',
          querySchemaRevision: 'query-schema-v1',
          targetFingerprint,
        }),
      }),
      postgresPayload({
        evidence: evidence('postgres_authoritative', 'fresh', {
          sourceBinding: 'approved_postgres_source',
          queryExporterBinding: 'approved_postgres_query_or_exporter',
          querySchemaRevision: 'query-schema-v1',
          targetFingerprint: digest,
        }),
      }),
    ];
    for (const payload of malformed) {
      await expect(
        createPostgresAuthoritativeSourceProvider(postgresConfig(transportFor(payload)))
          .collect('opaque-ref', observedAt),
      ).resolves.toBeUndefined();
    }

    const mismatchedObservedAt = transportFor(postgresPayload());
    await expect(
      createPostgresAuthoritativeSourceProvider(postgresConfig(mismatchedObservedAt))
        .collect('opaque-ref', '2026-09-30T00:01:00.000Z'),
    ).resolves.toBeUndefined();
  });

  it('preserves stale inputs but fails closed for unknown and collector_failure payloads only through adapter semantics', async () => {
    for (const freshness of ['stale', 'unknown', 'collector_failure'] as const) {
      const payload = postgresPayload({
        freshness,
        evidence: evidence('postgres_authoritative', freshness, {
          sourceBinding: 'approved_postgres_source',
          queryExporterBinding: 'approved_postgres_query_or_exporter',
          querySchemaRevision: 'query-schema-v1',
          targetFingerprint,
        }),
      });
      const result = await createPostgresAuthoritativeSourceProvider(
        postgresConfig(transportFor(payload)),
      ).collect('opaque-ref', observedAt);
      expect(result).toEqual(payload);
    }
  });
});
