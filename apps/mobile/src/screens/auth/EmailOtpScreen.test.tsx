import { describe, expect, it } from 'vitest';
import { OTP_INPUT_PROPS } from './otpInputRules';

describe('EmailOtpScreen OTP input', () => {
  it('masks the one-time code in the native TextField', () => {
    expect(OTP_INPUT_PROPS).toMatchObject({
      secureTextEntry: true,
    });
  });
});
