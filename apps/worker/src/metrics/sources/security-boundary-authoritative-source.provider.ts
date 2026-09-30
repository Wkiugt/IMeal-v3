import type { SecurityBoundaryMetricsInput } from './security-boundary-metrics.adapter.js';
import type { AuthoritativeMetricsSourceProvider } from '../authoritative-metrics-collector.js';
import {
  hasExactKeys,
  isAuthoritativeEvidence,
  isFreshness,
  isRecord,
} from './authoritative-source-schema.js';
import { isSha256Digest } from '../authoritative-metrics.js';
import type {
  AuthoritativeSourceSchema,
  AuthoritativeSourceTransport,
} from './authoritative-source-transport.js';

const SOURCE = 'security_boundary_evidence';
const SECURITY_TAXONOMY_REVISION = 'security-taxonomy-v1';
const DEDUPLICATION_WINDOW = 'PT1M';
const INPUT_KEYS = ['observedAt', 'freshness', 'evidence', 'violations'] as const;
const CATEGORIES = [
  'public_private_service_exposure',
  'plaintext_bearer_transport',
  'invalid_tls',
  'unexpected_cors_origin',
  'waf_or_rate_limit_violation',
  'unexpected_public_internal_port',
] as const;

export interface SecurityBoundaryAuthoritativeSourceProviderConfig {
  readonly transport?: AuthoritativeSourceTransport;
}

export class SecurityBoundaryAuthoritativeSourceProvider
  implements AuthoritativeMetricsSourceProvider<SecurityBoundaryMetricsInput>
{
  constructor(private readonly config?: SecurityBoundaryAuthoritativeSourceProviderConfig) {}

  async collect(
    reference: string,
    observedAt: string,
  ): Promise<SecurityBoundaryMetricsInput | undefined> {
    if (!this.config?.transport) return undefined;
    return this.config.transport.requestJson(
      reference,
      { observedAt },
      securityBoundaryInputSchema(observedAt),
    );
  }
}

export function createSecurityBoundaryAuthoritativeSourceProvider(
  config?: SecurityBoundaryAuthoritativeSourceProviderConfig,
): SecurityBoundaryAuthoritativeSourceProvider {
  return new SecurityBoundaryAuthoritativeSourceProvider(config);
}

function securityBoundaryInputSchema(
  expectedObservedAt: string,
): AuthoritativeSourceSchema<SecurityBoundaryMetricsInput> {
  return (value: unknown): value is SecurityBoundaryMetricsInput => {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, INPUT_KEYS) ||
      value.observedAt !== expectedObservedAt ||
      typeof value.observedAt !== 'string' ||
      !isFreshness(value.freshness) ||
      !isAuthoritativeEvidence(
        value.evidence,
        SOURCE,
        value.observedAt,
        value.freshness,
        ['securityTaxonomyRevision', 'deduplicationWindow'],
      ) ||
      value.evidence.securityTaxonomyRevision !== SECURITY_TAXONOMY_REVISION ||
      value.evidence.deduplicationWindow !== DEDUPLICATION_WINDOW ||
      !Array.isArray(value.violations)
    ) {
      return false;
    }
    for (const violation of value.violations) {
      if (
        !isRecord(violation) ||
        !hasExactKeys(violation, ['category', 'eventDigest']) ||
        !CATEGORIES.includes(violation.category as (typeof CATEGORIES)[number]) ||
        !isSha256Digest(violation.eventDigest)
      ) {
        return false;
      }
    }
    return true;
  };
}
