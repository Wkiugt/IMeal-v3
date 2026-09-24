import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

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
const OTP_MESSAGE = (code: string) =>
  `Your verification code is ${code}. It expires soon.`;

function encryptionKey(secret: string): Buffer {
  if (secret.trim().length < MIN_SECRET_LENGTH) {
    throw new Error('OTP_DELIVERY_ENCRYPTION_KEY must contain at least 32 characters');
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
    const [version, encodedIv, encodedTag, encodedCiphertext] = reference.split('.');
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

export function otpProviderConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): { url: string | null; apiKey: string | null; from: string | null } {
  const url = env.OTP_PROVIDER_URL?.trim() || null;
  const apiKey = env.OTP_PROVIDER_API_KEY?.trim() || null;
  const from = env.OTP_PROVIDER_FROM?.trim() || null;
  if (env.NODE_ENV === 'production') {
    if (!url || !apiKey || !from || !/^https:\/\//i.test(url)) {
      throw new Error(
        'OTP provider configuration requires an HTTPS URL, API key and sender identity in production',
      );
    }
  }
  return { url, apiKey, from };
}

export class OtpProviderError extends Error {
  constructor(
    readonly providerCode: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OtpProviderError';
  }
}

@Injectable()
export class ConfiguredOtpProvider implements OtpProvider {
  private readonly config: { url: string | null; apiKey: string | null; from: string | null };

  constructor() {
    this.config = otpProviderConfiguration();
  }

  async send(input: OtpProviderInput): Promise<void> {
    assertPayload(input);
    const { url, apiKey, from } = this.config;
    if (!url || !apiKey) {
      throw new OtpProviderError(
        'CONFIGURATION',
        'OTP provider configuration is incomplete',
      );
    }

    const body: { to: string; message: string; from?: string } = {
      to: input.destination,
      message: OTP_MESSAGE(input.code),
    };
    if (from) body.from = from;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new OtpProviderError(
        'NETWORK',
        'OTP provider request failed before receiving a response',
      );
    }

    if (!response.ok) {
      throw new OtpProviderError(
        `HTTP_${response.status}`,
        `OTP provider returned HTTP ${response.status}`,
        response.status,
      );
    }
  }
}
