import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { METRIC_CONTRACT, validateMetricSampleEnvelope } from '@imeal/observability';
import type { MetricSourceSnapshot } from '@imeal/observability';
import request from 'supertest';
import type { Server } from 'node:http';
import { vi } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/common/prisma.service.js';
import { WorkerMetricsService } from './../src/metrics/metrics.service.js';
const DIGEST = `sha256:${'a'.repeat(64)}`;
const SOURCE_BINDINGS: Record<string, string> = {
  api_application: 'approved_api_application_source',
  worker_application: 'approved_worker_application_source',
  postgres_authoritative: 'approved_postgres_source',
  object_storage_authoritative: 'approved_object_storage_source',
  backup_restore_evidence: 'approved_backup_restore_evidence',
  security_boundary_evidence: 'approved_security_boundary_source',
};

function completeSnapshots(observedAt: string): readonly MetricSourceSnapshot[] {
  const grouped = new Map<
    string,
    ReturnType<typeof validateMetricSampleEnvelope>[]
  >();
  for (const row of METRIC_CONTRACT) {
    const evidenceValues: Record<string, string> = {
      release: 'release-test',
      source: row.sourceIdentity,
      observedAt,
      contractRevision: '2026-09-30',
      freshness: 'fresh',
      sha256Digest: DIGEST,
      sourceKind: row.sourceKind,
      sourceBinding: SOURCE_BINDINGS[row.sourceIdentity],
      queryExporterBinding: 'approved_postgres_query_or_exporter',
      capacitySourceBinding: 'approved_object_storage_capacity_source',
      targetFingerprint: DIGEST,
      manifestDigest: DIGEST,
      rehearsalDigest: DIGEST,
      manifestCompletionTimestamp: observedAt,
      verificationResult: 'passed',
      deduplicationWindow: 'PT1M',
      reference: 'ref-test',
      routeTaxonomyRevision: 'route-taxonomy-v1',
      bucketRevision: 'bucket-v1',
      resultTaxonomyRevision: 'result-taxonomy-v1',
      idempotencyBranchRevision: 'idempotency-branch-v1',
      retryPolicyRevision: 'retry-policy-v1',
      failureTaxonomyRevision: 'failure-taxonomy-v1',
      jobTaxonomyRevision: 'job-taxonomy-v1',
      querySchemaRevision: 'query-schema-v1',
      scheduleRevision: 'schedule-v1',
      operationTaxonomyRevision: 'operation-taxonomy-v1',
      securityTaxonomyRevision: 'security-taxonomy-v1',
    };
    const evidence = Object.fromEntries([
      ...row.evidence.map((binding) => [binding, evidenceValues[binding]]),
      ['reference', evidenceValues.reference],
    ]);
    const baseLabels = Object.fromEntries(
      Object.entries(row.labels).map(([key, values]) => [key, values[0]]),
    );
    const labelSets =
      row.name === 'imeal_worker_job_last_success_timestamp_seconds' ||
      row.name === 'imeal_worker_job_lag_seconds'
        ? row.labels.job.map((job) => ({ ...baseLabels, job }))
        : [baseLabels];
    for (const labels of labelSets) {
      const value =
        row.type === 'histogram'
          ? { buckets: row.buckets.map(() => 1), sum: 1, count: 1 }
          : 1;
      const sample = validateMetricSampleEnvelope({
        metricName: row.name,
        type: row.type,
        unit: row.unit,
        labels,
        value,
        observedAt,
        source: row.sourceIdentity,
        freshness: 'fresh',
        evidence,
      });
      const samples = grouped.get(row.sourceIdentity) ?? [];
      samples.push(sample);
      grouped.set(row.sourceIdentity, samples);
    }
  }
  return [...grouped.entries()].map(([source, samples]) => ({
    source: source as MetricSourceSnapshot['source'],
    samples,
  }));
}

describe('AppController (e2e)', () => {
  let app: INestApplication<Server>;

  beforeEach(async () => {
    const prisma = {
      otpDeliveryOutbox: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      jobRun: {
        findFirst: vi.fn().mockResolvedValue({ completedAt: new Date() }),
      },
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
  it('/metrics (GET) fails closed until all source series are available', () => {
    return request(app.getHttpServer()).get('/metrics').expect(503);
  });
  it('/metrics (GET) returns all approved series for a complete bound snapshot', async () => {
    const metrics = app.get(WorkerMetricsService);
    for (const snapshot of completeSnapshots(new Date().toISOString())) {
      if (snapshot.source === 'api_application') {
        metrics.acceptApiApplicationSnapshot(snapshot);
      } else if (snapshot.source === 'worker_application') {
        metrics.acceptWorkerApplicationSnapshot(snapshot);
      } else {
        metrics.acceptAuthoritativeSnapshot(snapshot);
      }
    }

    await request(app.getHttpServer())
      .get('/metrics')
      .expect(200)
      .expect('content-type', /text\/plain/)
      .expect((response) => {
        for (const row of METRIC_CONTRACT) {
          expect(response.text).toContain(row.name);
        }
        expect(response.text).not.toMatch(
          /password|authorization|Bearer|postgresql:/i,
        );
      });
  });
  it('/health/live (GET) remains available alongside metrics', () => {
    return request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect((response) => {
        expect(response.headers['x-request-id']).toBeDefined();
      });
  });
  it('/health/ready (GET) remains 503 before scheduler initialization', () => {
    return request(app.getHttpServer())
      .get('/health/ready')
      .expect(503)
      .expect((response) => {
        expect(response.body.status).toBe('error');
        expect(response.body.checks.scheduler).toBe('down');
        expect(response.headers['x-request-id']).toBeDefined();
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
