import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@imeal/core';
import { v1 } from '@imeal/contracts';
import { PrismaService } from '../../common/prisma.service.js';
import { HealthService } from '../../health/health.service.js';
import { pageMeta } from './audit-redaction.js';

const RELEASE = /^[A-Za-z0-9._:+-]{1,80}$/;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SENSITIVE = /(otp|token|secret|password|authorization|bearer|gps|latitude|longitude|qr)/i;
const FAMILY_PREFIXES: Record<v1.AdminJobFamily, readonly string[]> = {
  no_show: ['no_show_worker_', 'no_show_'],
  registration_reminder: ['registration_reminder_'],
  pickup_reminder: ['pickup_reminder_'],
  cutoff_lock: ['cutoff_lock_'],
  otp_delivery: ['otp_delivery_'],
  notification_dispatch: ['notification_dispatch_', 'push_dispatch_'],
  other: [],
};
const KNOWN_FAMILIES: v1.AdminJobsResponse['knownFamilies'] = [
  { family: 'no_show', persisted: true },
  { family: 'registration_reminder', persisted: true },
  { family: 'pickup_reminder', persisted: true },
  { family: 'cutoff_lock', persisted: true },
  { family: 'otp_delivery', persisted: true },
  { family: 'notification_dispatch', persisted: true },
];
const PERSISTED_PREFIXES = KNOWN_FAMILIES.filter((item) => item.persisted).flatMap(
  (item) => FAMILY_PREFIXES[item.family].filter((prefix) => prefix.length > 0),
);

type WorkerHealthReader = (signal: AbortSignal) => Promise<Response>;

export const WORKER_HEALTH_READER = Symbol('WORKER_HEALTH_READER');

const WorkerHealthSchema = z
  .object({
    status: z.enum(['ok', 'error']),
    release: z.string().nullable(),
    checks: z
      .object({
        environment: v1.AdminHealthStateSchema,
        database: v1.AdminHealthStateSchema,
        migration: v1.AdminHealthStateSchema,
        scheduler: v1.AdminHealthStateSchema,
        draining: v1.AdminHealthStateSchema,
        lastLoop: v1.AdminHealthStateSchema,
      })
      .strict(),
  })
  .strip();

function release(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && RELEASE.test(trimmed) ? trimmed : null;
}

function failureMessage(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed.length > 200 || SENSITIVE.test(trimmed)) return null;
  return trimmed;
}

function count(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function familyOf(jobName: string): v1.AdminJobFamily {
  for (const family of v1.AdminJobFamilySchema.options) {
    const prefixes = FAMILY_PREFIXES[family];
    if (prefixes.some((prefix) => prefix.length > 0 && jobName.startsWith(prefix))) {
      return family;
    }
  }
  return 'other';
}

function familyWhere(family: v1.AdminJobFamily | undefined): Prisma.JobRunWhereInput {
  if (!family) return {};
  if (family === 'other') {
    return { NOT: PERSISTED_PREFIXES.map((prefix) => ({ jobName: { startsWith: prefix } })) };
  }
  return {
    OR: FAMILY_PREFIXES[family].map((prefix) => ({ jobName: { startsWith: prefix } })),
  };
}

export function workerHealthEndpoint(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.WORKER_METRICS_TRANSPORT_URL?.trim();
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    return undefined;
  }
  parsed.pathname = '/health/ready';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function defaultWorkerHealthReader(env: NodeJS.ProcessEnv): WorkerHealthReader | undefined {
  const endpoint = workerHealthEndpoint(env);
  if (!endpoint) return undefined;
  return (signal) => fetch(endpoint, { signal, headers: { accept: 'application/json' } });
}

@Injectable()
export class AdminJobsService {
  private readonly readWorkerHealth: WorkerHealthReader | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly health?: HealthService,
    @Optional()
    @Inject(WORKER_HEALTH_READER)
    workerHealthReader?: WorkerHealthReader,
  ) {
    this.readWorkerHealth = workerHealthReader ?? defaultWorkerHealthReader(process.env);
  }

  async list(query: v1.AdminJobsQuery): Promise<v1.AdminJobsResponse> {
    const where: Prisma.JobRunWhereInput = {
      ...familyWhere(query.family),
      ...(query.status ? { status: query.status } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [api, worker, rows, total] = await Promise.all([
      this.apiHealth(),
      this.workerHealth(),
      this.prisma.jobRun.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.jobRun.count({ where }),
    ]);
    const items: v1.AdminJobRun[] = [];
    for (const row of rows) {
      const parsed = v1.AdminJobRunSchema.safeParse({
        id: row.id,
        jobName: row.jobName,
        family: familyOf(row.jobName),
        status: row.status,
        startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
        failureCode:
          typeof row.failureCode === 'string' && FAILURE_CODE.test(row.failureCode)
            ? row.failureCode
            : null,
        failureMessage: failureMessage(row.failureMessage),
        successCount: count(row.successCount),
        failureCount: count(row.failureCount),
        releaseVersion: release(row.releaseVersion),
      });
      if (!parsed.success) throw new Error('Job run failed safe mapping');
      items.push(parsed.data);
    }
    return v1.AdminJobsResponseSchema.parse({
      api,
      worker,
      knownFamilies: KNOWN_FAMILIES,
      items,
      pagination: pageMeta(query.page, query.limit, total),
      retryAvailable: false,
    });
  }

  private async apiHealth(): Promise<v1.AdminJobsResponse['api']> {
    try {
      const result = await this.health?.ready('admin-jobs');
      if (!result) {
        return {
          status: 'error',
          release: null,
          checks: {
            environment: 'not_configured',
            database: 'not_configured',
            migration: 'not_configured',
            draining: 'not_configured',
          },
        };
      }
      return {
        status: result.body.status,
        release: release(result.body.release),
        checks: {
          environment: result.body.checks.environment,
          database: result.body.checks.database,
          migration: result.body.checks.migration,
          draining: result.body.checks.draining,
        },
      };
    } catch {
      return {
        status: 'error',
        release: null,
        checks: {
          environment: 'down',
          database: 'down',
          migration: 'down',
          draining: 'down',
        },
      };
    }
  }

  private async workerHealth(): Promise<v1.AdminJobsResponse['worker']> {
    if (!this.readWorkerHealth) {
      return { status: 'not_configured', release: null, checks: null };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    try {
      const response = await this.readWorkerHealth(controller.signal);
      const payload: unknown = await response.json().catch(() => null);
      const parsed = WorkerHealthSchema.safeParse(payload);
      if (!parsed.success) return { status: 'unavailable', release: null, checks: null };
      return {
        status: response.ok && parsed.data.status === 'ok' ? 'ok' : 'error',
        release: release(parsed.data.release),
        checks: parsed.data.checks,
      };
    } catch {
      return { status: 'unavailable', release: null, checks: null };
    } finally {
      clearTimeout(timeout);
    }
  }
}
