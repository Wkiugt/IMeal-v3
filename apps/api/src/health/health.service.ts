import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { readMigrationEvidence } from '@imeal/observability';
import { PrismaService } from '../common/prisma.service.js';
import {
  HEALTH_ENVIRONMENT_VALIDATED,
  HEALTH_SHUTDOWN_COORDINATOR,
  type ApiHealthChecks,
  type ApiHealthResult,
  type HealthCheckState,
  type ShutdownCoordinatorLike,
} from './health.types.js';

const DATABASE_CHECK_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(HEALTH_SHUTDOWN_COORDINATOR)
    private readonly shutdown?: ShutdownCoordinatorLike,
    @Optional()
    @Inject(HEALTH_ENVIRONMENT_VALIDATED)
    private readonly environmentValidated = true,
  ) {}

  live(requestId: string): ApiHealthResult {
    const draining = this.isDraining();
    const checks: ApiHealthChecks = {
      environment: 'not_configured',
      database: 'not_configured',
      migration: 'not_configured',
      draining: draining ? 'down' : 'ok',
    };
    return this.result(requestId, checks, draining ? 503 : 200, false);
  }

  async ready(requestId: string): Promise<ApiHealthResult> {
    const environment: HealthCheckState = this.environmentValidated
      ? 'ok'
      : 'down';
    const [database, migration] = await Promise.all([
      environment === 'ok'
        ? this.checkDatabase()
        : Promise.resolve('not_configured' as const),
      Promise.resolve(this.checkMigration()),
    ]);
    const checks: ApiHealthChecks = {
      environment,
      database,
      migration,
      draining: this.isDraining() ? 'down' : 'ok',
    };
    const healthy = Object.values(checks).every((state) => state === 'ok');
    if (!healthy) {
      this.logFailure(requestId, checks);
    }
    return this.result(requestId, checks, healthy ? 200 : 503);
  }

  private async checkDatabase(): Promise<HealthCheckState> {
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

  private checkMigration(): HealthCheckState {
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
    checks: ApiHealthChecks,
    statusCode: 200 | 503,
    includeRelease = true,
  ): ApiHealthResult {
    return {
      statusCode,
      body: {
        status: statusCode === 200 ? 'ok' : 'error',
        service: 'api',
        release: includeRelease
          ? process.env.RELEASE_VERSION?.trim() || null
          : null,
        checks,
        requestId,
      },
    };
  }

  private logFailure(requestId: string, checks: ApiHealthChecks): void {
    for (const [check, state] of Object.entries(checks)) {
      if (state !== 'ok') {
        this.logger.warn(
          `health.not_ready service=api check=${check} state=${state} requestId=${requestId}`,
        );
      }
    }
  }
}
