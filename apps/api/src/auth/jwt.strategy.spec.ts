import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JwtStrategy } from './jwt.strategy.js';
interface JwtStrategyInternals {
  _jwtFromRequest(request: {
    headers: Record<string, string>;
    url: string;
  }): string | null;
}

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ENTRA_CLIENT_ID = 'test-client-id';
    process.env.ENTRA_TENANT_ID = 'test-tenant-id';
    strategy = new JwtStrategy();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  it('extracts JWT token from Authorization Bearer header', () => {
    const extractor = (strategy as unknown as JwtStrategyInternals)
      ._jwtFromRequest;
    expect(extractor).toBeDefined();

    const req = {
      headers: {
        authorization: 'Bearer bearer-token-123',
      },
      url: '/v1/kitchen/events',
    };

    const token = extractor(req);
    expect(token).toBe('bearer-token-123');
  });

  it('rejects JWT tokens from URL query parameters', () => {
    const extractor = (strategy as unknown as JwtStrategyInternals)
      ._jwtFromRequest;
    expect(extractor).toBeDefined();

    const req = {
      headers: {},
      url: '/v1/kitchen/days/2026-09-03/events?token=query-token-456',
    };

    const token = extractor(req);
    expect(token).toBeNull();
  });

  it('validates and maps decoded JWT payload to request user object', async () => {
    const payload = {
      oid: 'entra-user-999',
      tid: 'test-tenant-id',
      name: 'Chef Kitchen',
      preferred_username: 'chef@company.com',
    };

    const user = await strategy.validate(payload);
    expect(user).toEqual({
      userId: 'entra-user-999',
      name: 'Chef Kitchen',
      email: 'chef@company.com',
      tenantId: 'test-tenant-id',
    });
  });

  it('rejects identities from another tenant', () => {
    expect(() =>
      strategy.validate({
        oid: 'entra-user-999',
        tid: 'other-tenant',
        preferred_username: 'chef@company.com',
      }),
    ).toThrow('Invalid Microsoft Entra tenant');
  });
});
