import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/common/prisma.service.js';
import { OtpService } from '../src/auth/otp.service.js';
import { decryptOtpProviderPayload } from '../src/otp/otp-provider.js';

const TEST_EMAIL = 'phase-a7-auth@example.test';
const TEST_OTP = '246810';
const OTP_DELIVERY_KEY = 'phase-a7-test-delivery-key-at-least-32-chars';
const OTP_HASH_KEY = 'phase-a7-test-otp-hash-key-at-least-32-chars';
const SESSION_HASH_KEY = 'phase-a7-test-session-hash-key-at-least-32-chars';
const TEST_ENV_VALUES = {
  NODE_ENV: 'test',
  REQUIRE_AUTH: 'true',
  OTP_DELIVERY_ENCRYPTION_KEY: OTP_DELIVERY_KEY,
  OTP_HASH_SECRET: OTP_HASH_KEY,
  SESSION_HASH_SECRET: SESSION_HASH_KEY,
  OTP_RESEND_SECONDS: '0',
} as const;
type TestEnvKey = keyof typeof TEST_ENV_VALUES;

describe('Real authentication lifecycle (e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaService;
  let previousEnv: Record<TestEnvKey, string | undefined>;

  beforeEach(async () => {
    previousEnv = {} as Record<TestEnvKey, string | undefined>;
    for (const key of Object.keys(TEST_ENV_VALUES) as TestEnvKey[]) {
      previousEnv[key] = process.env[key];
      process.env[key] = TEST_ENV_VALUES[key];
    }

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const user = await prisma.user.create({
      data: { email: TEST_EMAIL, name: 'Phase A7 Test User' },
    });
    await prisma.otpAllowlist.create({
      data: {
        normalizedEmail: TEST_EMAIL,
        userId: user.id,
        purpose: 'SESSION_LOGIN',
        state: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 60_000),
      },
    });

    vi.spyOn(app.get(OtpService), 'generateCode').mockReturnValue(TEST_OTP);
  });

  afterEach(async () => {
    try {
      vi.restoreAllMocks();
      await app.close();
    } finally {
      for (const key of Object.keys(TEST_ENV_VALUES) as TestEnvKey[]) {
        const value = previousEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('requests, delivers, verifies, and revokes an OTP session over HTTP', async () => {
    const requestHeaders = { 'user-agent': 'imeal-phase-a7-test' };
    const requested = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .set(requestHeaders)
      .send({ email: TEST_EMAIL, purpose: 'SESSION_LOGIN' });

    expect(requested.status).toBe(201);
    expect(requested.body).toEqual({ accepted: true });

    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { normalizedEmail: TEST_EMAIL, purpose: 'SESSION_LOGIN' },
    });
    const outbox = await prisma.otpDeliveryOutbox.findFirstOrThrow({
      where: { challengeId: challenge.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(outbox.status).toBe('PENDING');
    const delivered = decryptOtpProviderPayload(
      outbox.providerPayloadRef,
      OTP_DELIVERY_KEY,
    );
    expect(delivered).toEqual({
      destination: TEST_EMAIL,
      code: TEST_OTP,
      purpose: 'SESSION_LOGIN',
    });

    const verified = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .set(requestHeaders)
      .send({
        email: TEST_EMAIL,
        purpose: 'SESSION_LOGIN',
        code: delivered.code,
      });

    expect(verified.status).toBe(201);
    expect(verified.body).toMatchObject({
      user: {
        email: TEST_EMAIL,
        name: 'Phase A7 Test User',
      },
      expiresAt: expect.any(String),
    });
    expect(verified.body.sessionToken).toEqual(expect.any(String));
    expect(verified.body.sessionToken).not.toHaveLength(0);
    const authorization = { Authorization: `Bearer ${verified.body.sessionToken}` };

    const profile = await request(app.getHttpServer())
      .get('/auth/me')
      .set(authorization);
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({
      email: TEST_EMAIL,
      name: 'Phase A7 Test User',
      isActive: true,
    });

    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set(authorization);
    expect(logout.status).toBe(201);
    expect(logout.body).toEqual({ revoked: true });

    const invalidatedProfile = await request(app.getHttpServer())
      .get('/auth/me')
      .set(authorization);
    expect(invalidatedProfile.status).toBe(401);
    expect(invalidatedProfile.body).toMatchObject({
      statusCode: 401,
      errorCode: 'SESSION_INVALID',
    });
  });
});
