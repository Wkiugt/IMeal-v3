import { describe, expect, it } from 'vitest';
import { AdminAllowlistBulkUpsertRequestSchema } from './admin-allowlist';

const validRequest = {
  emails: ['employee@example.test'],
  state: 'ACTIVE' as const,
  effectiveFrom: '2026-10-01T00:00:00.000Z',
  effectiveTo: null,
  reason: 'migration',
};

describe('AdminAllowlistBulkUpsertRequestSchema', () => {
  it('rejects more than 500 emails and unknown fields', () => {
    expect(
      AdminAllowlistBulkUpsertRequestSchema.safeParse({
        ...validRequest,
        emails: Array.from({ length: 501 }, () => 'employee@example.test'),
      }).success,
    ).toBe(false);
    expect(
      AdminAllowlistBulkUpsertRequestSchema.safeParse({
        ...validRequest,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('requires UTC timestamps and an end after the start', () => {
    expect(
      AdminAllowlistBulkUpsertRequestSchema.safeParse({
        ...validRequest,
        effectiveFrom: '2026-10-01T00:00:00.000+07:00',
      }).success,
    ).toBe(false);
    expect(
      AdminAllowlistBulkUpsertRequestSchema.safeParse({
        ...validRequest,
        effectiveTo: '2026-10-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
