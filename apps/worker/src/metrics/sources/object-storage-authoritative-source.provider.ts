import type { ObjectStorageMetricsInput } from './object-storage-metrics.adapter.js';
import type { AuthoritativeMetricsSourceProvider } from '../authoritative-metrics-collector.js';
import { isSha256Digest } from '../authoritative-metrics.js';
import {
  hasExactKeys,
  isAuthoritativeEvidence,
  isFreshness,
  isNonnegativeSafeInteger,
  isRecord,
} from './authoritative-source-schema.js';
import type {
  AuthoritativeSourceSchema,
  AuthoritativeSourceTransport,
} from './authoritative-source-transport.js';

const SOURCE = 'object_storage_authoritative';
const SOURCE_BINDING = 'approved_object_storage_source';
const CAPACITY_SOURCE_BINDING = 'approved_object_storage_capacity_source';
const OPERATION_TAXONOMY_REVISION = 'operation-taxonomy-v1';
const INPUT_KEYS = [
  'observedAt',
  'freshness',
  'evidence',
  'targetScope',
  'usableCapacityBytes',
  'operationErrors',
] as const;
const OPERATIONS = ['health', 'read', 'write'] as const;

export interface ObjectStorageAuthoritativeSourceProviderConfig {
  readonly transport?: AuthoritativeSourceTransport;
  readonly targetFingerprint: string;
}

export class ObjectStorageAuthoritativeSourceProvider
  implements AuthoritativeMetricsSourceProvider<ObjectStorageMetricsInput>
{
  constructor(private readonly config?: ObjectStorageAuthoritativeSourceProviderConfig) {}

  async collect(
    reference: string,
    observedAt: string,
  ): Promise<ObjectStorageMetricsInput | undefined> {
    if (!this.config?.transport || !isSha256Digest(this.config.targetFingerprint)) {
      return undefined;
    }
    return this.config.transport.requestJson(
      reference,
      { observedAt },
      objectStorageInputSchema(this.config.targetFingerprint, observedAt),
    );
  }
}

export function createObjectStorageAuthoritativeSourceProvider(
  config?: ObjectStorageAuthoritativeSourceProviderConfig,
): ObjectStorageAuthoritativeSourceProvider {
  return new ObjectStorageAuthoritativeSourceProvider(config);
}

function objectStorageInputSchema(
  targetFingerprint: string,
  expectedObservedAt: string,
): AuthoritativeSourceSchema<ObjectStorageMetricsInput> {
  return (value: unknown): value is ObjectStorageMetricsInput => {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, INPUT_KEYS) ||
      value.observedAt !== expectedObservedAt ||
      typeof value.observedAt !== 'string' ||
      !isFreshness(value.freshness) ||
      value.targetScope !== 'imeal_private_storage' ||
      !isAuthoritativeEvidence(
        value.evidence,
        SOURCE,
        value.observedAt,
        value.freshness,
        ['targetFingerprint', 'capacitySourceBinding', 'operationTaxonomyRevision', 'sourceBinding'],
      )
    ) {
      return false;
    }
    if (
      value.evidence.targetFingerprint !== targetFingerprint ||
      value.evidence.sourceBinding !== SOURCE_BINDING ||
      value.evidence.capacitySourceBinding !== CAPACITY_SOURCE_BINDING ||
      value.evidence.operationTaxonomyRevision !== OPERATION_TAXONOMY_REVISION ||
      !isNonnegativeSafeInteger(value.usableCapacityBytes) ||
      !Array.isArray(value.operationErrors) ||
      value.operationErrors.length > OPERATIONS.length
    ) {
      return false;
    }
    const operations = new Set<string>();
    for (const record of value.operationErrors) {
      if (
        !isRecord(record) ||
        !hasExactKeys(record, ['operation', 'count']) ||
        !OPERATIONS.includes(record.operation as (typeof OPERATIONS)[number]) ||
        !isNonnegativeSafeInteger(record.count)
      ) {
        return false;
      }
      operations.add(record.operation as string);
    }
    return operations.size === value.operationErrors.length;
  };
}
