import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { isSha256Digest } from './authoritative-metrics.js';
import {
  AuthoritativeMetricsCollector,
  type AuthoritativeMetricsCollectorProviders,
  type AuthoritativeMetricsCollectorScheduler,
} from './authoritative-metrics-collector.js';
import { WorkerMetricsService } from './metrics.service.js';
import type { WorkerMetricsEnvironment } from './metrics-environment.js';
import { validateMetricsEnvironment } from './metrics-environment.js';

export const WORKER_METRICS_POSTGRES_SOURCE_PROVIDER = Symbol(
  'WORKER_METRICS_POSTGRES_SOURCE_PROVIDER',
);
export const WORKER_METRICS_OBJECT_STORAGE_SOURCE_PROVIDER = Symbol(
  'WORKER_METRICS_OBJECT_STORAGE_SOURCE_PROVIDER',
);
export const WORKER_METRICS_BACKUP_RESTORE_SOURCE_PROVIDER = Symbol(
  'WORKER_METRICS_BACKUP_RESTORE_SOURCE_PROVIDER',
);
export const WORKER_METRICS_SECURITY_BOUNDARY_SOURCE_PROVIDER = Symbol(
  'WORKER_METRICS_SECURITY_BOUNDARY_SOURCE_PROVIDER',
);
export const WORKER_METRICS_COLLECTOR_SCHEDULER = Symbol(
  'WORKER_METRICS_COLLECTOR_SCHEDULER',
);
export const WORKER_METRICS_RUNTIME_ENVIRONMENT = Symbol(
  'WORKER_METRICS_RUNTIME_ENVIRONMENT',
);
export const WORKER_METRICS_SOURCE_TRANSPORT = Symbol(
  'WORKER_METRICS_SOURCE_TRANSPORT',
);
export type AuthoritativeMetricsRuntimeScheduler = AuthoritativeMetricsCollectorScheduler;

type RuntimeConfiguration = {
  readonly sourceReferences: WorkerMetricsEnvironment;
  readonly targetFingerprint: string;
  readonly release: string;
};

const EMPTY_SOURCE_REFERENCES: WorkerMetricsEnvironment = Object.freeze({
  postgresSource: null,
  objectStorageSource: null,
  backupEvidenceSource: null,
  securityBoundarySource: null,
});
const RELEASE_PATTERN = /^release-[a-z0-9][a-z0-9.-]{0,63}$/;

function readRuntimeConfiguration(env: NodeJS.ProcessEnv): RuntimeConfiguration {
  let sourceReferences: WorkerMetricsEnvironment;
  try {
    sourceReferences = validateMetricsEnvironment(env);
  } catch {
    sourceReferences = EMPTY_SOURCE_REFERENCES;
  }
  const targetFingerprint = env.WORKER_METRICS_TARGET_FINGERPRINT?.trim() ?? '';
  const release = env.RELEASE_VERSION?.trim() ?? '';
  const complete =
    sourceReferences.postgresSource !== null &&
    sourceReferences.objectStorageSource !== null &&
    sourceReferences.backupEvidenceSource !== null &&
    sourceReferences.securityBoundarySource !== null &&
    isSha256Digest(targetFingerprint) &&
    RELEASE_PATTERN.test(release);
  if (!complete) {
    return {
      sourceReferences: EMPTY_SOURCE_REFERENCES,
      targetFingerprint: '',
      release: '',
    };
  }
  return { sourceReferences, targetFingerprint, release };
}

@Injectable()
export class AuthoritativeMetricsRuntimeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly collector: AuthoritativeMetricsCollector;

  constructor(
    private readonly metrics: WorkerMetricsService,
    @Optional()
    @Inject(WORKER_METRICS_POSTGRES_SOURCE_PROVIDER)
    postgres?: AuthoritativeMetricsCollectorProviders['postgres'],
    @Optional()
    @Inject(WORKER_METRICS_OBJECT_STORAGE_SOURCE_PROVIDER)
    objectStorage?: AuthoritativeMetricsCollectorProviders['objectStorage'],
    @Optional()
    @Inject(WORKER_METRICS_BACKUP_RESTORE_SOURCE_PROVIDER)
    backupRestore?: AuthoritativeMetricsCollectorProviders['backupRestore'],
    @Optional()
    @Inject(WORKER_METRICS_SECURITY_BOUNDARY_SOURCE_PROVIDER)
    securityBoundary?: AuthoritativeMetricsCollectorProviders['securityBoundary'],
    @Optional()
    @Inject(WORKER_METRICS_COLLECTOR_SCHEDULER)
    scheduler?: AuthoritativeMetricsRuntimeScheduler,
    @Optional()
    @Inject(WORKER_METRICS_RUNTIME_ENVIRONMENT)
    environment: NodeJS.ProcessEnv = process.env,
  ) {
    const configuration = readRuntimeConfiguration(environment);
    this.collector = new AuthoritativeMetricsCollector(
      configuration,
      { postgres, objectStorage, backupRestore, securityBoundary },
      this.metrics,
      scheduler,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.collector.collectOnce();
    this.collector.start();
  }

  onModuleDestroy(): void {
    this.collector.stop();
  }
}

