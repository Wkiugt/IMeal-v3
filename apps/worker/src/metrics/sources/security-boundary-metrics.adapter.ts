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
  isSha256Digest,
  type AuthoritativeMetricsResult,
} from '../authoritative-metrics.js';

export type SecurityBoundaryCategory =
  | 'public_private_service_exposure'
  | 'plaintext_bearer_transport'
  | 'invalid_tls'
  | 'unexpected_cors_origin'
  | 'waf_or_rate_limit_violation'
  | 'unexpected_public_internal_port';

export interface SecurityBoundaryMetricsConfig {
  readonly sourceBinding: string;
  readonly securityTaxonomyRevision: string;
  readonly deduplicationWindow: string;
}

export interface SecurityBoundaryViolationRecord {
  readonly category: SecurityBoundaryCategory;
  readonly eventDigest: string;
}

export interface SecurityBoundaryMetricsInput {
  readonly observedAt: string;
  readonly freshness: MetricFreshness;
  readonly evidence: MetricEvidenceMetadata;
  readonly violations: readonly SecurityBoundaryViolationRecord[];
}

const SOURCE = 'security_boundary_evidence' as const;
const SOURCE_BINDING = 'approved_security_boundary_source';
const SECURITY_TAXONOMY_REVISION = 'security-taxonomy-v1';
const DEDUPLICATION_WINDOW = 'PT1M';
const CATEGORIES: readonly SecurityBoundaryCategory[] = [
  'public_private_service_exposure',
  'plaintext_bearer_transport',
  'invalid_tls',
  'unexpected_cors_origin',
  'waf_or_rate_limit_violation',
  'unexpected_public_internal_port',
];

export class SecurityBoundaryMetricsAdapter {
  constructor(private readonly config?: SecurityBoundaryMetricsConfig) {}

  collect(input?: SecurityBoundaryMetricsInput): AuthoritativeMetricsResult {
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
      const deduplicated = new Map<string, SecurityBoundaryCategory>();
      for (const violation of input.violations) {
        const prior = deduplicated.get(violation.eventDigest);
        if (prior && prior !== violation.category) {
          throw new Error('Security event digest category conflict');
        }
        deduplicated.set(violation.eventDigest, violation.category);
      }
      const counts = new Map<SecurityBoundaryCategory, number>(
        CATEGORIES.map((category) => [category, 0]),
      );
      for (const category of deduplicated.values()) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
      const samples = [...counts.entries()].map(([category, count]) =>
        createAuthoritativeSample({
          metricName: 'imeal_security_boundary_violations_total',
          labels: { category },
          value: count,
          observedAt: input.observedAt,
          source: SOURCE,
          freshness: input.freshness,
          evidence: input.evidence,
        }),
      );
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
        config.securityTaxonomyRevision === SECURITY_TAXONOMY_REVISION &&
        config.deduplicationWindow === DEDUPLICATION_WINDOW,
    );
  }

  private validateInput(input: SecurityBoundaryMetricsInput): void {
    if (
      !hasOnlyKeys(input, ['observedAt', 'freshness', 'evidence', 'violations']) ||
      !isCanonicalTimestamp(input.observedAt) ||
      !Array.isArray(input.violations) ||
      !input.evidence ||
      input.evidence.source !== SOURCE ||
      input.evidence.observedAt !== input.observedAt ||
      input.evidence.freshness !== input.freshness ||
      input.evidence.contractRevision !== AUTHORITATIVE_CONTRACT_REVISION ||
      input.evidence.sourceKind !== 'authoritative' ||
      input.evidence.securityTaxonomyRevision !== this.config?.securityTaxonomyRevision ||
      input.evidence.deduplicationWindow !== this.config?.deduplicationWindow ||
      !['fresh', 'stale', 'unknown', 'collector_failure'].includes(input.freshness) ||
      !input.violations.every(
        (violation) =>
          hasOnlyKeys(violation, ['category', 'eventDigest']) &&
          CATEGORIES.includes(violation.category) &&
          isSha256Digest(violation.eventDigest),
      )
    ) {
      throw new Error('security boundary source input is malformed');
    }
  }
}
