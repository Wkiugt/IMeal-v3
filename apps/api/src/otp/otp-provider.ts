import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

export type OtpPurpose = 'SESSION_LOGIN';

export type OtpProviderInput = {
  destination: string;
  code: string;
  purpose: OtpPurpose;
};

export type OtpProviderPayload = OtpProviderInput;

export interface OtpProvider {
  send(input: OtpProviderInput): Promise<void>;
}

const PAYLOAD_VERSION = 'v1';
const PAYLOAD_AAD = 'imeal:otp-delivery:v1';
const MIN_SECRET_LENGTH = 32;

function encryptionKey(secret: string): Buffer {
  if (secret.trim().length < MIN_SECRET_LENGTH) {
    throw new Error(
      'OTP_DELIVERY_ENCRYPTION_KEY must contain at least 32 characters',
    );
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid encoding');
  return Buffer.from(value, 'base64url');
}

function assertPayload(payload: OtpProviderPayload): void {
  if (
    typeof payload.destination !== 'string' ||
    payload.destination.trim().length === 0 ||
    /[\r\n]/.test(payload.destination) ||
    !/^\d{6}$/.test(payload.code) ||
    payload.purpose !== 'SESSION_LOGIN'
  ) {
    throw new Error('Invalid OTP provider payload');
  }
}

/**
 * Encrypts the provider payload before it crosses the database boundary.
 * The resulting reference is safe to persist, but must never be logged.
 */
export function encryptOtpProviderPayload(
  payload: OtpProviderPayload,
  secret: string,
): string {
  assertPayload(payload);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(PAYLOAD_AAD, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return [
    PAYLOAD_VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Decrypts a provider payload only in the worker immediately before send.
 */
export function decryptOtpProviderPayload(
  reference: string,
  secret: string,
): OtpProviderPayload {
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext] =
      reference.split('.');
    if (
      version !== PAYLOAD_VERSION ||
      !encodedIv ||
      !encodedTag ||
      !encodedCiphertext
    ) {
      throw new Error('invalid payload');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(secret),
      decodeBase64Url(encodedIv),
    );
    decipher.setAuthTag(decodeBase64Url(encodedTag));
    decipher.setAAD(Buffer.from(PAYLOAD_AAD, 'utf8'));
    const plaintext = Buffer.concat([
      decipher.update(decodeBase64Url(encodedCiphertext)),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plaintext) as OtpProviderPayload;
    assertPayload(payload);
    return payload;
  } catch {
    throw new Error('Invalid OTP provider payload');
  }
}

export function otpDeliveryEncryptionSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.OTP_DELIVERY_ENCRYPTION_KEY?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === 'test') {
    return 'test-only-otp-delivery-encryption-secret';
  }
  throw new Error('OTP_DELIVERY_ENCRYPTION_KEY is not configured');
}
