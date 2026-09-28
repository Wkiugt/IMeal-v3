import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { readMigrationEvidence } from '@imeal/observability';
import { PrismaService } from './common/prisma.service.js';

const DATABASE_CHECK_TIMEOUT_MS = 2_000;

export type WorkerHealthCheckState = 'ok' | 'down' | 'not_configured';

export type WorkerHealthBody = {
  status: 'ok' | 'error';
  service: 'worker';
  release: string | null;
  checks: {
    environment: WorkerHealthCheckState;
    database: WorkerHealthCheckState;
    migration: WorkerHealthCheckState;
    scheduler: WorkerHealthCheckState;
    draining: WorkerHealthCheckState;
    lastLoop: WorkerHealthCheckState;
  };
  requestId: string;
};

export type WorkerHealthResult = {
  statusCode: 200 | 503;
  body: WorkerHealthBody;
};

export interface WorkerShutdownCoordinatorLike {
  isDraining(): boolean;
}

export const WORKER_HEALTH_SHUTDOWN_COORDINATOR = Symbol(
  'WORKER_HEALTH_SHUTDOWN_COORDINATOR',
);
export const WORKER_HEALTH_ENVIRONMENT_VALIDATED = Symbol(
  'WORKER_HEALTH_ENVIRONMENT_VALIDATED',
);

@Injectable()
export class HealthService implements OnModuleInit {
  private readonly logger = new Logger(HealthService.name);
  private schedulerInitialized = false;
  private lastLoop: WorkerHealthCheckState = 'not_configured';

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(WORKER_HEALTH_SHUTDOWN_COORDINATOR)
    private readonly shutdown?: WorkerShutdownCoordinatorLike,
    @Optional()
    @Inject(WORKER_HEALTH_ENVIRONMENT_VALIDATED)
    private readonly environmentValidated = true,
  ) {}

  onModuleInit(): void {
    this.schedulerInitialized = true;
  }

  markSchedulerInitialized(): void {
    this.schedulerInitialized = true;
  }

  setLastLoopState(state: WorkerHealthCheckState): void {
    this.lastLoop = state;
  }

  live(requestId: string): WorkerHealthResult {
    const draining = this.isDraining();
    return this.result(
      requestId,
      {
        environment: 'not_configured',
        database: 'not_configured',
        migration: 'not_configured',
        scheduler: 'not_configured',
        draining: draining ? 'down' : 'ok',
        lastLoop: 'not_configured',
      },
      draining ? 503 : 200,
      false,
    );
  }

  async ready(requestId: string): Promise<WorkerHealthResult> {
    const environment: WorkerHealthCheckState = this.environmentValidated
      ? 'ok'
      : 'down';
    const [database, migration] = await Promise.all([
      environment === 'ok'
        ? this.checkDatabase()
        : Promise.resolve('not_configured' as const),
      Promise.resolve(this.checkMigration()),
    ]);
    const scheduler: WorkerHealthCheckState = this.schedulerInitialized
      ? 'ok'
      : 'down';
    const draining: WorkerHealthCheckState = this.isDraining() ? 'down' : 'ok';
    const checks = {
      environment,
      database,
      migration,
      scheduler,
      draining,
      lastLoop: this.lastLoop,
    };
    const healthy = [
      environment,
      database,
      migration,
      scheduler,
      draining,
    ].every((state) => state === 'ok');
    if (!healthy) {
      this.logFailure(requestId, checks);
    }
    return this.result(requestId, checks, healthy ? 200 : 503);
  }

  private async checkDatabase(): Promise<WorkerHealthCheckState> {
    if (typeof this.prisma.isReady === 'function' && !this.prisma.isReady()) {
      return 'down';
    }

    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('database health check timed out')),
            DATABASE_CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return 'ok';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timeout);
    }
  }

  private checkMigration(): WorkerHealthCheckState {
    const release = process.env.RELEASE_VERSION?.trim();
    const evidencePath = process.env.MIGRATION_EVIDENCE_PATH?.trim();
    const targetSchema = process.env.MIGRATION_TARGET_IDENTITY?.trim();
    if (!release || !evidencePath || !targetSchema) {
      return 'not_configured';
    }

    return readMigrationEvidence(evidencePath, release, targetSchema).ok
      ? 'ok'
      : 'down';
  }

  private isDraining(): boolean {
    try {
      return this.shutdown?.isDraining() ?? false;
    } catch {
      return true;
    }
  }

  private result(
    requestId: string,
    checks: WorkerHealthBody['checks'],
    statusCode: 200 | 503,
    includeRelease = true,
  ): WorkerHealthResult {
    return {
      statusCode,
      body: {
        status: statusCode === 200 ? 'ok' : 'error',
        service: 'worker',
        release: includeRelease
          ? process.env.RELEASE_VERSION?.trim() || null
          : null,
        checks,
        requestId,
      },
    };
  }

  private logFailure(
    requestId: string,
    checks: WorkerHealthBody['checks'],
  ): void {
    for (const [check, state] of Object.entries(checks)) {
      if (state !== 'ok') {
        this.logger.warn(
          `health.not_ready service=worker check=${check} state=${state} requestId=${requestId}`,
        );
      }
    }
  }
}
