import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./apiConfig', () => ({ API_BASE: 'https://api.example.test' }));
import { MobileApiError } from './mobileApiError';
import { registrationAPI } from './registrationAPI';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registrationAPI', () => {
  it('preserves per-date failures returned in a successful batch response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                date: '2026-09-15',
                success: false,
                code: 'CUTOFF_PASSED',
                reason: 'Cutoff time exceeded',
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    await expect(
      registrationAPI.batchRegister(
        [{ mealDate: '2026-09-15', status: 'ACTIVE', mealChoice: 'REGULAR' }],
        'token',
      ),
    ).resolves.toEqual([
      {
        date: '2026-09-15',
        success: false,
        code: 'CUTOFF_PASSED',
        reason: 'Cutoff time exceeded',
      },
    ]);
  });
  it('preserves server weekly eligibility failures for each submitted date', async () => {
    const results = [
      {
        date: '2026-09-15',
        success: false as const,
        code: 'REGISTRATION_WEEK_NOT_OPEN' as const,
        reason: 'Registration week is not open',
      },
      {
        date: '2026-09-16',
        success: false as const,
        code: 'OUTSIDE_REGISTRATION_WINDOW' as const,
        reason: 'Outside registration window',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(results), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    await expect(
      registrationAPI.batchRegister(
        [
          { mealDate: '2026-09-15', status: 'ACTIVE', mealChoice: 'REGULAR' },
          { mealDate: '2026-09-16', status: 'ACTIVE', mealChoice: 'REGULAR' },
        ],
        'token',
      ),
    ).resolves.toEqual(results);
  });

  it('throws INVALID_RESPONSE for an invalid registration payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );

    await expect(
      registrationAPI.batchRegister([], 'token'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      messageKey: 'errors.invalidResponse',
    });
  });
});
