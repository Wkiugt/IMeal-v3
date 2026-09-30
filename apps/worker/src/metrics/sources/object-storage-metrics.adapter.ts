import type {
  MetricEvidenceMetadata,
  MetricFreshness,
} from '@imeal/observability';
import {
  authoritativeFailure,
  authoritativeResult,
  AUTHORITATIVE_CONTRACT_REVISION,
  createAuthoritativeSample,
  hasOnlyKeys,
  isCanonicalTimestamp,
  isFiniteNonnegative,
  isSha256Digest,
  type AuthoritativeMetricsResult,
} from '../authoritative-metrics.js';

export interface ObjectStorageMetricsConfig {
  readonly sourceBinding: string;
  readonly capacitySourceBinding: string;
  readonly targetFingerprint: string;
}

export interface ObjectStorageOperationErrorRecord {
  readonly operation: 'health' | 'read' | 'write';
  readonly count: number;
}

export interface ObjectStorageMetricsInput {
  readonly observedAt: string;
  readonly freshness: MetricFreshness;
  readonly evidence: MetricEvidenceMetadata;
  readonly targetScope: 'imeal_private_storage';
  readonly usableCapacityBytes?: number;
  readonly operationErrors?: readonly ObjectStorageOperationErrorRecord[];
}

const SOURCE = 'object_storage_authoritative' as const;
const SOURCE_BINDING = 'approved_object_storage_source';
const CAPACITY_SOURCE_BINDING = 'approved_object_storage_capacity_source';

export class ObjectStorageMetricsAdapter {
  constructor(private readonly config?: ObjectStorageMetricsConfig) {}

  collect(input?: ObjectStorageMetricsInput): AuthoritativeMetricsResult {
    if (!this.validConfig()) {
      return authoritativeFailure(SOURCE, 'collector_failure', 'configuration_missing');
    }
    if (!input) {
      return authoritativeFailure(SOURCE, 'collector_failure', 'source_unavailable');
    }
    try {
      this.validateInput(input);
      if (input.freshness === 'unknown' || input.freshness === 'collector_failure') {
        return authoritativeFailure(SOURCE, input.freshness, 'source_unavailable');
      }
      const suppliedOperationErrors = input.operationErrors!;
      const operationErrors =
        suppliedOperationErrors.length === 0
          ? (['health', 'read', 'write'] as const).map((operation) => ({
              operation,
              count: 0,
            }))
          : suppliedOperationErrors;
      const samples = [
        createAuthoritativeSample({
          metricName: 'imeal_object_storage_capacity_bytes',
          labels: {},
          value: input.usableCapacityBytes!,
          observedAt: input.observedAt,
          source: SOURCE,
          freshness: input.freshness,
          evidence: input.evidence,
        }),
        ...operationErrors.map((record) =>
          createAuthoritativeSample({
            metricName: 'imeal_object_storage_errors_total',
            labels: { operation: record.operation },
            value: record.count,
            observedAt: input.observedAt,
            source: SOURCE,
            freshness: input.freshness,
            evidence: input.evidence,
          }),
        ),
      ];
      return authoritativeResult(SOURCE, input.freshness, samples);
    } catch {
      return authoritativeFailure(SOURCE, 'collector_failure', 'source_malformed');
    }
  }

  private validConfig(): boolean {
    const config = this.config;
    return Boolean(
      config &&
        config.sourceBinding === SOURCE_BINDING &&
        config.capacitySourceBinding === CAPACITY_SOURCE_BINDING &&
        isSha256Digest(config.targetFingerprint),
    );
  }

  private validateInput(input: ObjectStorageMetricsInput): void {
    if (
      !hasOnlyKeys(input, [
        'observedAt',
        'freshness',
        'evidence',
        'targetScope',
        'usableCapacityBytes',
        'operationErrors',
      ]) ||
      !isCanonicalTimestamp(input.observedAt) ||
      input.targetScope !== 'imeal_private_storage' ||
      !input.evidence ||
      input.evidence.source !== SOURCE ||
      input.evidence.observedAt !== input.observedAt ||
      input.evidence.freshness !== input.freshness ||
      input.evidence.contractRevision !== AUTHORITATIVE_CONTRACT_REVISION ||
      input.evidence.sourceKind !== 'authoritative' ||
      input.evidence.sourceBinding !== this.config?.sourceBinding ||
      input.evidence.capacitySourceBinding !== this.config?.capacitySourceBinding ||
      input.evidence.targetFingerprint !== this.config?.targetFingerprint
    ) {
      throw new Error('object storage source input is malformed');
    }
    if (!['fresh', 'stale', 'unknown', 'collector_failure'].includes(input.freshness)) {
      throw new Error('object storage freshness is malformed');
    }
    if (
      !isFiniteNonnegative(input.usableCapacityBytes) ||
      !Number.isInteger(input.usableCapacityBytes) ||
      !Array.isArray(input.operationErrors) ||
      input.operationErrors.length > 3 ||
      !input.operationErrors.every((record) =>
        hasOnlyKeys(record, ['operation', 'count']) &&
        ['health', 'read', 'write'].includes(record.operation) &&
        isFiniteNonnegative(record.count) &&
        Number.isSafeInteger(record.count),
      ) ||
      new Set(input.operationErrors.map((record) => record.operation)).size !==
        input.operationErrors.length
    ) {
      throw new Error('object storage source record is malformed');
    }
  }
}
