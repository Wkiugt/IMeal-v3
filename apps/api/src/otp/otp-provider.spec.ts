import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConfiguredOtpProvider,
  decryptOtpProviderPayload,
  encryptOtpProviderPayload,
  type OtpProviderPayload,
} from './otp-provider.js';

const PAYLOAD: OtpProviderPayload = {
  destination: 'employee@example.test',
  code: '123456',
  purpose: 'SESSION_LOGIN',
};
const SECRET = 'delivery-encryption-secret-that-is-at-least-32-bytes';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  process.env = { ...process.env, NODE_ENV: 'test' };
  delete process.env.OTP_PROVIDER_URL;
  delete process.env.OTP_PROVIDER_API_KEY;
  delete process.env.OTP_PROVIDER_FROM;
});

describe('OTP provider payload encryption', () => {
  it('round-trips an encrypted payload without exposing clear OTP data', () => {
    const reference = encryptOtpProviderPayload(PAYLOAD, SECRET);

    expect(reference).not.toContain(PAYLOAD.code);
    expect(reference).not.toContain(PAYLOAD.destination);
    expect(decryptOtpProviderPayload(reference, SECRET)).toEqual(PAYLOAD);
  });

  it('rejects a tampered provider payload', () => {
    const reference = encryptOtpProviderPayload(PAYLOAD, SECRET);
    const tampered = `${reference.slice(0, -1)}${reference.endsWith('A') ? 'B' : 'A'}`;

    expect(() => decryptOtpProviderPayload(tampered, SECRET)).toThrow(
      'Invalid OTP provider payload',
    );
  });
});

describe('ConfiguredOtpProvider', () => {
  it('sends only minimal verification copy at the final provider boundary', async () => {
    process.env.OTP_PROVIDER_URL = 'https://provider.example.test/send';
    process.env.OTP_PROVIDER_API_KEY = 'provider-key';
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock;

    await new ConfiguredOtpProvider().send(PAYLOAD);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://provider.example.test/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer provider-key' }),
        body: expect.any(String),
      }),
    );
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(request).toEqual({
      to: PAYLOAD.destination,
      message: 'Your verification code is 123456. It expires soon.',
    });
    expect(JSON.stringify(request)).not.toContain('meal');
  });

  it('fails closed when production provider configuration is incomplete', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OTP_PROVIDER_URL;
    delete process.env.OTP_PROVIDER_API_KEY;

    expect(() => new ConfiguredOtpProvider()).toThrow('OTP provider configuration');
  });
});
