import { describe, expect, it, vi } from 'vitest';
import type {
  MetricEvidenceMetadata,
  MetricFreshness,
  MetricSourceSnapshot,
} from '@imeal/observability';
import {
  AuthoritativeMetricsCollector,
  type AuthoritativeMetricsCollectorProviders,
  type AuthoritativeMetricsCollectorConfig,
} from './authoritative-metrics-collector.js';
import type { PostgresMetricsInput } from './sources/postgres-metrics.adapter.js';
import type { ObjectStorageMetricsInput } from './sources/object-storage-metrics.adapter.js';
import type { BackupRestoreMetricsInput } from './sources/backup-restore-metrics.adapter.js';
import type { SecurityBoundaryMetricsInput } from './sources/security-boundary-metrics.adapter.js';

const digest = `sha256:${'a'.repeat(64)}`;
const observedAt = '2026-09-30T00:00:00.000Z';
const references = {
  postgresSource: 'postgres-exporter-private',
  objectStorageSource: 'minio-capacity-private',
  backupEvidenceSource: 'backup-evidence-private',
  securityBoundarySource: 'security-feed-private',
} as const;
const config: AuthoritativeMetricsCollectorConfig = {
  sourceReferences: references,
  targetFingerprint: digest,
  release: 'release-staging-1',
};

function evidence(
  source: MetricEvidenceMetadata['source'],
  freshness: MetricFreshness = 'fresh',
): MetricEvidenceMetadata {
  const base: MetricEvidenceMetadata = {
    release: config.release,
    source,
    observedAt,
    contractRevision: '2026-09-30',
    freshness,
    sha256Digest: digest,
    sourceKind: 'authoritative',
    targetFingerprint: digest,
    sourceBinding:
      source === 'postgres_authoritative'
        ? 'approved_postgres_source'
        : source === 'object_storage_authoritative'
          ? 'approved_object_storage_source'
          : source === 'backup_restore_evidence'
            ? 'approved_backup_restore_evidence'
            : 'approved_security_boundary_source',
  };
  if (source === 'postgres_authoritative') {
    Object.assign(base, {
      queryExporterBinding: 'approved_postgres_query_or_exporter',
      querySchemaRevision: 'query-schema-v1',
    });
  } else if (source === 'object_storage_authoritative') {
    Object.assign(base, {
      capacitySourceBinding: 'approved_object_storage_capacity_source',
      operationTaxonomyRevision: 'operation-taxonomy-v1',
    });
  } else if (source === 'backup_restore_evidence') {
    Object.assign(base, {
      manifestDigest: digest,
      manifestCompletionTimestamp: observedAt,
      rehearsalDigest: digest,
      verificationResult: 'passed',
    });
  } else {
    Object.assign(base, {
      securityTaxonomyRevision: 'security-taxonomy-v1',
      deduplicationWindow: 'PT1M',
    });
  }
  return base;
}

function postgresInput(): PostgresMetricsInput {
  return {
    observedAt,
    freshness: 'fresh',
    evidence: evidence('postgres_authoritative'),
    targetScope: 'imeal_postgres',
    connectionUsage: [
      { pool: 'pgbouncer_client', usedConnections: 2, configuredMaximum: 10 },
      { pool: 'postgres_backend', usedConnections: 1, configuredMaximum: 5 },
    ],
    transactionErrors: 0,
    lockWaits: 0,
    diskUsedBytes: 4,
    diskCapacityBytes: 10,
  };
}

function objectStorageInput(): ObjectStorageMetricsInput {
  return {
    observedAt,
    freshness: 'fresh',
    evidence: evidence('object_storage_authoritative'),
    targetScope: 'imeal_private_storage',
    usableCapacityBytes: 10,
    operationErrors: [
      { operation: 'health', count: 0 },
      { operation: 'read', count: 0 },
      { operation: 'write', count: 0 },
    ],
  };
}

function backupInput(): BackupRestoreMetricsInput {
  return {
    observedAt,
    freshness: 'fresh',
    evidence: evidence('backup_restore_evidence'),
    targetFingerprint: digest,
    release: config.release,
    manifestDigest: digest,
    manifestCompletionTimestamp: observedAt,
    retentionState: 'retained',
    checksumVerification: 'passed',
    checksumFailures: 0,
    rehearsalDigest: digest,
    rehearsalVerification: 'passed',
    restoreTestFailures: 0,
  };
}

function securityInput(): SecurityBoundaryMetricsInput {
  return {
    observedAt,
    freshness: 'fresh',
    evidence: evidence('security_boundary_evidence'),
    violations: [],
  };
}

function providers(): AuthoritativeMetricsCollectorProviders {
  return {
    postgres: { collect: vi.fn().mockResolvedValue(postgresInput()) },
    objectStorage: { collect: vi.fn().mockResolvedValue(objectStorageInput()) },
    backupRestore: { collect: vi.fn().mockResolvedValue(backupInput()) },
    securityBoundary: { collect: vi.fn().mockResolvedValue(securityInput()) },
  };
}

describe('AuthoritativeMetricsCollector', () => {
  it('collects all four sources and forwards validated snapshots with source references', async () => {
    const sourceProviders = providers();
    const sink = {
      acceptAuthoritativeSnapshot: vi.fn(),
      acceptAuthoritativeFailure: vi.fn(),
    };
    const collector = new AuthoritativeMetricsCollector(config, sourceProviders, sink);

    await collector.collectOnce(() => new Date(observedAt));

    expect(sink.acceptAuthoritativeSnapshot).toHaveBeenCalledTimes(4);
    expect(sink.acceptAuthoritativeFailure).not.toHaveBeenCalled();
    expect(sourceProviders.postgres?.collect).toHaveBeenCalledWith(
      references.postgresSource,
      observedAt,
    );
    expect(sourceProviders.objectStorage?.collect).toHaveBeenCalledWith(
      references.objectStorageSource,
      observedAt,
    );
    expect(sourceProviders.backupRestore?.collect).toHaveBeenCalledWith(
      references.backupEvidenceSource,
      observedAt,
    );
    expect(sourceProviders.securityBoundary?.collect).toHaveBeenCalledWith(
      references.securityBoundarySource,
      observedAt,
    );
    const snapshots = sink.acceptAuthoritativeSnapshot.mock.calls.map(
      ([snapshot]) => snapshot as MetricSourceSnapshot,
    );
    expect(snapshots.map((snapshot) => snapshot.source).sort()).toEqual([
      'backup_restore_evidence',
      'object_storage_authoritative',
      'postgres_authoritative',
      'security_boundary_evidence',
    ]);
    expect(snapshots.flatMap((snapshot) => snapshot.samples).every((sample) => sample.evidence.sha256Digest === digest)).toBe(true);
  });

  it.each([
    ['postgres', 'postgres_authoritative', 'configuration_missing'],
    ['objectStorage', 'object_storage_authoritative', 'configuration_missing'],
    ['backupRestore', 'backup_restore_evidence', 'configuration_missing'],
    ['securityBoundary', 'security_boundary_evidence', 'configuration_missing'],
  ] as const)('reports collector_failure when %s has no provider', async (provider, source, reason) => {
    const sourceProviders = providers();
    delete sourceProviders[provider];
    const sink = {
      acceptAuthoritativeSnapshot: vi.fn(),
      acceptAuthoritativeFailure: vi.fn(),
    };
    const collector = new AuthoritativeMetricsCollector(config, sourceProviders, sink);

    await collector.collectOnce(() => new Date(observedAt));

    expect(sink.acceptAuthoritativeSnapshot).toHaveBeenCalledTimes(3);
    expect(sink.acceptAuthoritativeFailure).toHaveBeenCalledWith(
      source,
      'collector_failure',
      reason,
    );
  });

  it('reports collector_failure when a provider is unavailable or returns no source data', async () => {
    const sourceProviders = providers();
    sourceProviders.postgres!.collect = vi.fn().mockRejectedValue(new Error('source unavailable'));
    sourceProviders.objectStorage!.collect = vi.fn().mockResolvedValue(undefined);
    const sink = {
      acceptAuthoritativeSnapshot: vi.fn(),
      acceptAuthoritativeFailure: vi.fn(),
    };
    const collector = new AuthoritativeMetricsCollector(config, sourceProviders, sink);

    await collector.collectOnce(() => new Date(observedAt));

    expect(sink.acceptAuthoritativeFailure).toHaveBeenCalledWith(
      'postgres_authoritative',
      'collector_failure',
      'source_unavailable',
    );
    expect(sink.acceptAuthoritativeFailure).toHaveBeenCalledWith(
      'object_storage_authoritative',
      'collector_failure',
      'source_unavailable',
    );
  });

  it('does not substitute zeros or Prisma/application observations when a provider is absent', async () => {
    const sink = {
      acceptAuthoritativeSnapshot: vi.fn(),
      acceptAuthoritativeFailure: vi.fn(),
    };
    const collector = new AuthoritativeMetricsCollector(
      { ...config, sourceReferences: { ...references, postgresSource: null } },
      {},
      sink,
    );

    await collector.collectOnce(() => new Date(observedAt));

    expect(sink.acceptAuthoritativeSnapshot).not.toHaveBeenCalled();
    expect(sink.acceptAuthoritativeFailure).toHaveBeenCalledWith(
      'postgres_authoritative',
      'collector_failure',
      'configuration_missing',
    );
  });

  it('forwards adapter validation failures without publishing a sample', async () => {
    const sourceProviders = providers();
    sourceProviders.postgres!.collect = vi.fn().mockResolvedValue({} as PostgresMetricsInput);
    const sink = {
      acceptAuthoritativeSnapshot: vi.fn(),
      acceptAuthoritativeFailure: vi.fn(),
    };
    const collector = new AuthoritativeMetricsCollector(config, sourceProviders, sink);

    await collector.collectOnce(() => new Date(observedAt));

    expect(sink.acceptAuthoritativeFailure).toHaveBeenCalledWith(
      'postgres_authoritative',
      'collector_failure',
      'source_malformed',
    );
    expect(sink.acceptAuthoritativeSnapshot).toHaveBeenCalledTimes(3);
  });

  it('reports sink rejection as collector_failure instead of retaining a fallback', async () => {
    const sourceProviders = providers();
    const sink = {
      acceptAuthoritativeSnapshot: vi
        .fn()
        .mockRejectedValueOnce(new Error('sink unavailable')),
      acceptAuthoritativeFailure: vi.fn(),
    };
    const collector = new AuthoritativeMetricsCollector(config, sourceProviders, sink);

    await collector.collectOnce(() => new Date(observedAt));

    expect(sink.acceptAuthoritativeFailure).toHaveBeenCalledWith(
      'postgres_authoritative',
      'collector_failure',
      'sink_rejected',
    );
  });

  it('schedules fixed-interval collection without overlapping runs', async () => {
    const sourceProviders = providers();
    let callback!: () => void;
    const scheduler = {
      setInterval: vi.fn((fn: () => void) => {
        callback = fn;
        return 1 as unknown as NodeJS.Timeout;
      }),
      clearInterval: vi.fn(),
    };
    const collector = new AuthoritativeMetricsCollector(
      config,
      sourceProviders,
      {
        acceptAuthoritativeSnapshot: vi.fn(),
        acceptAuthoritativeFailure: vi.fn(),
      },
      scheduler,
    );

    collector.start();
    expect(scheduler.setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    callback();
    callback();
    await Promise.resolve();
    expect(sourceProviders.postgres?.collect).toHaveBeenCalledTimes(1);
    collector.stop();
    expect(scheduler.clearInterval).toHaveBeenCalledWith(1);
  });
});
