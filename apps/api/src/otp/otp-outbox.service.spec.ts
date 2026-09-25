import { describe, expect, it, vi } from 'vitest';
import { OtpOutboxService } from './otp-outbox.service.js';

const NOW = new Date('2026-09-24T03:00:00.000Z');

describe('OtpOutboxService', () => {
  it('atomically claims due rows and returns only delivery-safe fields', async () => {
    const prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: 'outbox-1',
          challenge_id: 'challenge-1',
          provider_payload_ref: 'v1.encrypted',
          claim_token: 'claim-token-1',
          attempt_count: 1,
          destination: 'employee@example.test',
          purpose: 'SESSION_LOGIN',
          expires_at: new Date(NOW.getTime() + 60_000),
        },
      ]),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    const service = new OtpOutboxService(prisma as never);

    const rows = await service.claimBatch(NOW, 10);

    expect(rows).toEqual([
      {
        id: 'outbox-1',
        challengeId: 'challenge-1',
        providerPayloadRef: 'v1.encrypted',
        claimToken: 'claim-token-1',
        attemptCount: 1,
        destination: 'employee@example.test',
        purpose: 'SESSION_LOGIN',
        expiresAt: new Date(NOW.getTime() + 60_000),
      },
    ]);
    expect(JSON.stringify(prisma.$queryRaw.mock.calls)).toContain(
      'SKIP LOCKED',
    );
    expect(JSON.stringify(prisma.$queryRaw.mock.calls)).toContain(
      'otp_delivery_outboxes',
    );
  });

  it('marks successful and failed transitions only from PROCESSING', async () => {
    const prisma = {
      $transaction: vi.fn(),
      otpDeliveryOutbox: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new OtpOutboxService(prisma as never);
    await service.markProcessed('outbox-1', 'claim-token-1', NOW);
    await service.markFailed('outbox-1', 'claim-token-1', NOW, {
      code: 'PROVIDER_TRANSIENT',
      retryAt: new Date(NOW.getTime() + 10_000),
    });

    expect(prisma.otpDeliveryOutbox.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'outbox-1',
        status: 'PROCESSING',
        claimToken: 'claim-token-1',
      },
      data: { status: 'PROCESSED', processedAt: NOW, lastError: null },
    });
    expect(prisma.otpDeliveryOutbox.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'outbox-1',
        status: 'PROCESSING',
        claimToken: 'claim-token-1',
      },
      data: {
        status: 'PENDING',
        processedAt: null,
        nextAttemptAt: new Date(NOW.getTime() + 10_000),
        lastError: 'PROVIDER_TRANSIENT',
      },
    });
  });
});
