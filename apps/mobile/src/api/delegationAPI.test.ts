import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiConfig', () => ({ API_BASE: 'https://api.example.test' }));

import { delegationAPI } from './delegationAPI';
import { MobileApiError } from './mobileApiError';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('delegationAPI', () => {
  it('rejects non-contract IDs and timestamps as INVALID_RESPONSE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      id: 'delegation-1',
      registrationId: 'registration-1',
      delegateUserId: 'delegate-1',
      status: 'PENDING',
      createdAt: 'not-a-timestamp',
      updatedAt: 'not-a-timestamp',
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(delegationAPI.getDelegations('token', 'outgoing')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
    } satisfies Partial<MobileApiError>);
  });
});
