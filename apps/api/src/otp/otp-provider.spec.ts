import { describe, expect, it } from 'vitest';
import {
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
