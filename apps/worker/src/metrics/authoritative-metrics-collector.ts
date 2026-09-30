import {
  AUTHORITATIVE_OBSERVATION_INTERVAL_SECONDS,
  type MetricFreshness,
} from '@imeal/observability';
import {
  type AuthoritativeMetricsFailureReason,
  type AuthoritativeMetricsResult,
  type AuthoritativeSnapshotSink,
  type AuthoritativeSourceIdentity,
} from './authoritative-metrics.js';
import {
  validateMetricsEnvironment,
  type WorkerMetricsEnvironment,
} from './metrics-environment.js';
import {
  PostgresMetricsAdapter,
  type PostgresMetricsInput,
} from './sources/postgres-metrics.adapter.js';
import {
  ObjectStorageMetricsAdapter,
  type ObjectStorageMetricsInput,
} from './sources/object-storage-metrics.adapter.js';
import {
  BackupRestoreMetricsAdapter,
  type BackupRestoreMetricsInput,
} from './sources/backup-restore-metrics.adapter.js';
import {
  SecurityBoundaryMetricsAdapter,
  type SecurityBoundaryMetricsInput,
} from './sources/security-boundary-metrics.adapter.js';

export interface AuthoritativeMetricsCollectorConfig {
  readonly sourceReferences: WorkerMetricsEnvironment;
  readonly targetFingerprint: string;
  readonly release: string;
}

export interface AuthoritativeMetricsSourceProvider<Input> {
  collect(reference: string, observedAt: string): Promise<Input | undefined>;
}

export interface AuthoritativeMetricsCollectorProviders {
  readonly postgres?: AuthoritativeMetricsSourceProvider<PostgresMetricsInput>;
  readonly objectStorage?: AuthoritativeMetricsSourceProvider<ObjectStorageMetricsInput>;
  readonly backupRestore?: AuthoritativeMetricsSourceProvider<BackupRestoreMetricsInput>;
  readonly securityBoundary?: AuthoritativeMetricsSourceProvider<SecurityBoundaryMetricsInput>;
}

export interface AuthoritativeMetricsCollectorScheduler {
  setInterval(callback: () => void, intervalMs: number): NodeJS.Timeout;
  clearInterval(handle: NodeJS.Timeout): void;
}

const DEFAULT_SCHEDULER: AuthoritativeMetricsCollectorScheduler = {
  setInterval: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
  clearInterval: (handle) => globalThis.clearInterval(handle),
};

const FAILURE_FRESHNESS: MetricFreshness = 'collector_failure';
const FIXED_INTERVAL_MS = AUTHORITATIVE_OBSERVATION_INTERVAL_SECONDS * 1000;

export function createAuthoritativeMetricsCollectorFromEnvironment(options: {
  readonly providers: AuthoritativeMetricsCollectorProviders;
  readonly sink: AuthoritativeSnapshotSink;
  readonly targetFingerprint: string;
  readonly release: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly scheduler?: AuthoritativeMetricsCollectorScheduler;
}): AuthoritativeMetricsCollector {
  return new AuthoritativeMetricsCollector(
    {
      sourceReferences: validateMetricsEnvironment(options.env),
      targetFingerprint: options.targetFingerprint,
      release: options.release,
    },
    options.providers,
    options.sink,
    options.scheduler,
  );
}

export class AuthoritativeMetricsCollector {
  private readonly postgres: PostgresMetricsAdapter;
  private readonly objectStorage: ObjectStorageMetricsAdapter;
  private readonly backupRestore: BackupRestoreMetricsAdapter;
  private readonly securityBoundary: SecurityBoundaryMetricsAdapter;
  private readonly scheduler: AuthoritativeMetricsCollectorScheduler;
  private intervalHandle?: NodeJS.Timeout;
  private collectionInFlight = false;

  constructor(
    private readonly config: AuthoritativeMetricsCollectorConfig,
    private readonly providers: AuthoritativeMetricsCollectorProviders,
    private readonly sink: AuthoritativeSnapshotSink,
    scheduler: AuthoritativeMetricsCollectorScheduler = DEFAULT_SCHEDULER,
  ) {
    this.postgres = new PostgresMetricsAdapter({
      sourceBinding: 'approved_postgres_source',
      queryExporterBinding: 'approved_postgres_query_or_exporter',
      targetFingerprint: config.targetFingerprint,
    });
    this.objectStorage = new ObjectStorageMetricsAdapter({
      sourceBinding: 'approved_object_storage_source',
      capacitySourceBinding: 'approved_object_storage_capacity_source',
      targetFingerprint: config.targetFingerprint,
    });
    this.backupRestore = new BackupRestoreMetricsAdapter({
      sourceBinding: 'approved_backup_restore_evidence',
      targetFingerprint: config.targetFingerprint,
      release: config.release,
    });
    this.securityBoundary = new SecurityBoundaryMetricsAdapter({
      sourceBinding: 'approved_security_boundary_source',
      securityTaxonomyRevision: 'security-taxonomy-v1',
      deduplicationWindow: 'PT1M',
    });
    this.scheduler = scheduler;
  }

  start(): void {
    if (this.intervalHandle !== undefined) return;
    this.intervalHandle = this.scheduler.setInterval(() => {
      if (this.collectionInFlight) return;
      this.collectionInFlight = true;
      void this.collectOnce().finally(() => {
        this.collectionInFlight = false;
      });
    }, FIXED_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalHandle === undefined) return;
    this.scheduler.clearInterval(this.intervalHandle);
    this.intervalHandle = undefined;
  }

  async collectOnce(clock: () => Date = () => new Date()): Promise<void> {
    const observedAt = clock().toISOString();
    await Promise.all([
      this.collectPostgres(observedAt),
      this.collectObjectStorage(observedAt),
      this.collectBackupRestore(observedAt),
      this.collectSecurityBoundary(observedAt),
    ]);
  }

  private async collectPostgres(observedAt: string): Promise<void> {
    const source: AuthoritativeSourceIdentity = 'postgres_authoritative';
    const reference = this.config.sourceReferences.postgresSource;
    const provider = this.providers.postgres;
    if (!reference || !provider) {
      await this.reportFailure(source, 'configuration_missing');
      return;
    }
    await this.collectWithProvider(
      source,
      () => provider.collect(reference, observedAt),
      (input) => this.postgres.collect(input),
    );
  }

  private async collectObjectStorage(observedAt: string): Promise<void> {
    const source: AuthoritativeSourceIdentity = 'object_storage_authoritative';
    const reference = this.config.sourceReferences.objectStorageSource;
    const provider = this.providers.objectStorage;
    if (!reference || !provider) {
      await this.reportFailure(source, 'configuration_missing');
      return;
    }
    await this.collectWithProvider(
      source,
      () => provider.collect(reference, observedAt),
      (input) => this.objectStorage.collect(input),
    );
  }

  private async collectBackupRestore(observedAt: string): Promise<void> {
    const source: AuthoritativeSourceIdentity = 'backup_restore_evidence';
    const reference = this.config.sourceReferences.backupEvidenceSource;
    const provider = this.providers.backupRestore;
    if (!reference || !provider) {
      await this.reportFailure(source, 'configuration_missing');
      return;
    }
    await this.collectWithProvider(
      source,
      () => provider.collect(reference, observedAt),
      (input) => this.backupRestore.collect(input),
    );
  }

  private async collectSecurityBoundary(observedAt: string): Promise<void> {
    const source: AuthoritativeSourceIdentity = 'security_boundary_evidence';
    const reference = this.config.sourceReferences.securityBoundarySource;
    const provider = this.providers.securityBoundary;
    if (!reference || !provider) {
      await this.reportFailure(source, 'configuration_missing');
      return;
    }
    await this.collectWithProvider(
      source,
      () => provider.collect(reference, observedAt),
      (input) => this.securityBoundary.collect(input),
    );
  }

  private async collectWithProvider<Input>(
    source: AuthoritativeSourceIdentity,
    read: () => Promise<Input | undefined>,
    collect: (input?: Input) => AuthoritativeMetricsResult,
  ): Promise<void> {
    let input: Input | undefined;
    try {
      input = await read();
    } catch {
      await this.reportFailure(source, 'source_unavailable');
      return;
    }
    if (input === undefined) {
      await this.reportFailure(source, 'source_unavailable');
      return;
    }

    const result = collect(input);
    if (!result.snapshot) {
      await this.reportFailure(source, result.reason ?? 'source_malformed');
      return;
    }
    try {
      await this.sink.acceptAuthoritativeSnapshot(result.snapshot);
    } catch {
      await this.reportFailure(source, 'sink_rejected');
    }
  }

  private async reportFailure(
    source: AuthoritativeSourceIdentity,
    reason: AuthoritativeMetricsFailureReason,
  ): Promise<void> {
    try {
      await this.sink.acceptAuthoritativeFailure?.(source, FAILURE_FRESHNESS, reason);
    } catch {
      // A failed sink cannot be made healthy by a fallback value.
    }
  }
}
