import type { PostgresMetricsInput } from './postgres-metrics.adapter.js';
import type { AuthoritativeMetricsSourceProvider } from '../authoritative-metrics-collector.js';
import {
  hasExactKeys,
  isAuthoritativeEvidence,
  isFreshness,
  isNonnegativeNumber,
  isRecord,
} from './authoritative-source-schema.js';
import { isSha256Digest } from '../authoritative-metrics.js';
import type {
  AuthoritativeSourceSchema,
  AuthoritativeSourceTransport,
} from './authoritative-source-transport.js';

const SOURCE = 'postgres_authoritative';
const SOURCE_BINDING = 'approved_postgres_source';
const QUERY_EXPORTER_BINDING = 'approved_postgres_query_or_exporter';
const QUERY_SCHEMA_REVISION = 'query-schema-v1';
const INPUT_KEYS = [
  'observedAt',
  'freshness',
  'evidence',
  'targetScope',
  'connectionUsage',
  'transactionErrors',
  'lockWaits',
  'diskUsedBytes',
  'diskCapacityBytes',
] as const;

export interface PostgresAuthoritativeSourceProviderConfig {
  readonly transport?: AuthoritativeSourceTransport;
  readonly targetFingerprint: string;
}

export class PostgresAuthoritativeSourceProvider
  implements AuthoritativeMetricsSourceProvider<PostgresMetricsInput>
{
  constructor(private readonly config?: PostgresAuthoritativeSourceProviderConfig) {}

  async collect(reference: string, observedAt: string): Promise<PostgresMetricsInput | undefined> {
    if (!this.config?.transport || !isSha256Digest(this.config.targetFingerprint)) {
      return undefined;
    }
    return this.config.transport.requestJson(
      reference,
      { observedAt },
      postgresInputSchema(this.config.targetFingerprint, observedAt),
    );
  }
}

export function createPostgresAuthoritativeSourceProvider(
  config?: PostgresAuthoritativeSourceProviderConfig,
): PostgresAuthoritativeSourceProvider {
  return new PostgresAuthoritativeSourceProvider(config);
}

function postgresInputSchema(
  targetFingerprint: string,
  expectedObservedAt: string,
): AuthoritativeSourceSchema<PostgresMetricsInput> {
  return (value: unknown): value is PostgresMetricsInput => {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, INPUT_KEYS) ||
      value.observedAt !== expectedObservedAt ||
      typeof value.observedAt !== 'string' ||
      !isFreshness(value.freshness) ||
      value.targetScope !== 'imeal_postgres'
    ) {
      return false;
    }
    if (
      !isAuthoritativeEvidence(
        value.evidence,
        SOURCE,
        value.observedAt,
        value.freshness,
        ['targetFingerprint', 'sourceBinding', 'queryExporterBinding', 'querySchemaRevision'],
      )
    ) {
      return false;
    }
    if (
      value.evidence.targetFingerprint !== targetFingerprint ||
      value.evidence.sourceBinding !== SOURCE_BINDING ||
      value.evidence.queryExporterBinding !== QUERY_EXPORTER_BINDING ||
      value.evidence.querySchemaRevision !== QUERY_SCHEMA_REVISION ||
      !Array.isArray(value.connectionUsage) ||
      value.connectionUsage.length !== 2 ||
      !isNonnegativeNumber(value.transactionErrors) ||
      !isNonnegativeNumber(value.lockWaits) ||
      !isNonnegativeNumber(value.diskUsedBytes) ||
      !isNonnegativeNumber(value.diskCapacityBytes) ||
      value.diskCapacityBytes <= 0 ||
      value.diskUsedBytes > value.diskCapacityBytes
    ) {
      return false;
    }
    const pools = new Set<string>();
    for (const record of value.connectionUsage) {
      if (
        !isRecord(record) ||
        !hasExactKeys(record, ['pool', 'usedConnections', 'configuredMaximum']) ||
        (record.pool !== 'pgbouncer_client' && record.pool !== 'postgres_backend') ||
        !isNonnegativeNumber(record.usedConnections) ||
        !isNonnegativeNumber(record.configuredMaximum) ||
        record.configuredMaximum <= 0 ||
        record.usedConnections > record.configuredMaximum
      ) {
        return false;
      }
      pools.add(record.pool);
    }
    return pools.size === 2;
  };
}
