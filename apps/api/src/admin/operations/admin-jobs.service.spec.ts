import { describe, expect, it, vi } from 'vitest';
import { AdminJobsService, workerHealthEndpoint } from './admin-jobs.service.js';

describe('AdminJobsService', () => {
  it('derives a private worker health URL without keeping credentials', () => {
    expect(
      workerHealthEndpoint({
        WORKER_METRICS_TRANSPORT_URL:
          'http://worker:3001/metrics/application-snapshot?token=secret',
      }),
    ).toBe('http://worker:3001/health/ready');
    expect(
      workerHealthEndpoint({
        WORKER_METRICS_TRANSPORT_URL: 'http://user:secret@worker:3001/metrics',
      }),
    ).toBeUndefined();
  });

  it('returns sanitized health and job rows without a retry operation', async () => {
    const prisma = {
      jobRun: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'job-1',
            jobName: 'no_show_worker_2026-10-06',
            status: 'FAILED',
            startedAt: new Date('2026-10-06T06:45:00.000Z'),
            completedAt: new Date('2026-10-06T06:46:00.000Z'),
            failureCode: 'REGISTRATION_FAILURE',
            failureMessage: 'One or more registrations failed',
            successCount: 3,
            failureCount: 1,
            releaseVersion: 'release-1',
          },
          {
            id: 'job-2',
            jobName: 'otp_delivery_secret',
            status: 'FAILED',
            startedAt: new Date('2026-10-06T06:47:00.000Z'),
            completedAt: null,
            failureCode: 'not a code',
            failureMessage: 'bearer secret token',
            successCount: -1,
            failureCount: 1.5,
            releaseVersion: 'has space',
          },
        ]),
        count: vi.fn().mockResolvedValue(2),
      },
    };
    const health = {
      ready: vi.fn().mockResolvedValue({
        body: {
          status: 'ok',
          release: 'release-1',
          checks: {
            environment: 'ok',
            database: 'ok',
            migration: 'ok',
            draining: 'ok',
          },
        },
      }),
    };
    const reader = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        service: 'worker',
        release: 'release-1',
        requestId: 'private-request',
        checks: {
          environment: 'ok',
          database: 'ok',
          migration: 'ok',
          scheduler: 'ok',
          draining: 'ok',
          lastLoop: 'ok',
        },
        endpoint: 'http://worker:3001/metrics',
      }),
    });
    const service = new AdminJobsService(prisma as never, health as never, reader);

    const page = await service.list({ page: 1, limit: 20 });

    expect(page.retryAvailable).toBe(false);
    expect(page.api.status).toBe('ok');
    expect(page.worker).toMatchObject({ status: 'ok', release: 'release-1' });
    expect(page.items[0]).toMatchObject({
      family: 'no_show',
      failureCode: 'REGISTRATION_FAILURE',
      successCount: 3,
      failureCount: 1,
    });
    expect(page.items[1]).toMatchObject({
      family: 'otp_delivery',
      failureCode: null,
      failureMessage: null,
      successCount: null,
      failureCount: null,
      releaseVersion: null,
    });
    expect(page.knownFamilies).toEqual(
      expect.arrayContaining([
        { family: 'otp_delivery', persisted: true },
        { family: 'notification_dispatch', persisted: true },
      ]),
    );
    expect(JSON.stringify(page)).not.toMatch(/private-request|bearer secret|metrics/i);
  });
});
