import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { assertLocalSeedPlan, buildLocalSeedPlan } from '../src/local-seed/plan.js';
import {
  LocalSeedWriteError,
  writeLocalSeed,
} from '../src/local-seed/writer.js';
import type { LocalSeedConfig, LocalSeedPlan } from '../src/local-seed/types.js';

const CONFIG: LocalSeedConfig = {
  baseEmail: 'seed@example.test',
  weekStart: '2026-09-28',
  serveDate: '2026-09-28',
  dryRun: false,
  databaseUrl: 'postgresql://postgres:secret@localhost:5432/imeal?schema=test_seed',
  target: {
    nodeEnv: 'test',
    host: 'localhost',
    database: 'imeal',
    schema: 'test_seed',
  },
};

const ROLE_IDS = {
  staff: '10000000-0000-4000-8000-000000000001',
  kitchen: '10000000-0000-4000-8000-000000000002',
  admin: '10000000-0000-4000-8000-000000000003',
} as const;

function buildPlan(): LocalSeedPlan {
  const plan = buildLocalSeedPlan(CONFIG);
  assertLocalSeedPlan(plan);
  return plan;
}

type FakeTransaction = Record<string, unknown>;

type TransactionCall = (
  callback: (transaction: FakeTransaction) => Promise<unknown>,
  options: unknown,
) => Promise<unknown>;

function makeClient(transaction: FakeTransaction) {
  const transactionCall = vi.fn<TransactionCall>(async (callback) => callback(transaction));
  return {
    client: { $transaction: transactionCall } as unknown as PrismaClient,
    transactionCall,
  };
}

function makeFailingClient(error: unknown) {
  const transactionCall = vi.fn(async () => {
    throw error;
  });
  return {
    client: { $transaction: transactionCall } as unknown as PrismaClient,
    transactionCall,
  };
}

function codedError(code: string, message = `${code} database failure`) {
  return { code, message };
}

function canonicalRoleTransaction() {
  return {
    role: {
      findUnique: vi.fn(async ({ where }: { where: { name: keyof typeof ROLE_IDS } }) => ({
        id: ROLE_IDS[where.name],
      })),
    },
  };
}

describe('local seed writer boundaries', () => {
  it('caps maxAttempts at three and uses only the 25/50ms P2034 backoff sequence', async () => {
    const plan = buildPlan();
    const { client, transactionCall } = makeFailingClient(codedError('P2034', 'serialization conflict'));
    const sleeps: number[] = [];

    await expect(
      writeLocalSeed(client, plan, {
        maxAttempts: 4,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).rejects.toMatchObject({ code: 'P2034' });

    expect(transactionCall).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([25, 50]);
  });

  it.each([
    ['P2002', 'P2002'],
    ['P2003', 'P2003'],
    ['P2025', 'P2025'],
    ['check constraint', 'P2004'],
    ['validation', 'UNKNOWN'],
  ])('does not retry %s failures', async (_label, code) => {
    const plan = buildPlan();
    const failure = code === 'UNKNOWN' ? new Error('validation failure') : codedError(code);
    const { client, transactionCall } = makeFailingClient(failure);
    const sleeps: number[] = [];

    await expect(
      writeLocalSeed(client, plan, {
        maxAttempts: 3,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).rejects.toMatchObject({ code });

    expect(transactionCall).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('redacts connection, password, token, and QR content from write errors', async () => {
    const plan = buildPlan();
    const failure = codedError(
      'P2002',
      'DATABASE_URL=postgresql://postgres:secret@remote.example/imeal password=secret token=otp-token qr=qr-payload',
    );
    const { client } = makeFailingClient(failure);

    const result = writeLocalSeed(client, plan);
    await expect(result).rejects.toBeInstanceOf(LocalSeedWriteError);
    try {
      await result;
    } catch (error) {
      expect(String(error)).not.toContain('DATABASE_URL');
      expect(String(error)).not.toContain('postgresql://');
      expect(String(error)).not.toContain('password');
      expect(String(error)).not.toContain('secret');
      expect(String(error)).not.toContain('token');
      expect(String(error)).not.toContain('otp-token');
      expect(String(error)).not.toContain('qr-payload');
    }
  });

  it('fails on a missing canonical role without changing role or permission definitions', async () => {
    const plan = buildPlan();
    const definitions = {
      roles: [{ id: ROLE_IDS.staff, name: 'staff' }],
      permissions: [{ id: 'permission-1', name: 'kitchen.serve' }],
      rolePermissions: [{ roleId: ROLE_IDS.staff, permissionId: 'permission-1' }],
    };
    const before = structuredClone(definitions);
    const transaction = {
      role: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async (row: unknown) => definitions.roles.push(row as (typeof definitions.roles)[number])),
      },
      permission: {
        create: vi.fn(async (row: unknown) => definitions.permissions.push(row as (typeof definitions.permissions)[number])),
      },
      rolePermission: {
        create: vi.fn(async (row: unknown) =>
          definitions.rolePermissions.push(row as (typeof definitions.rolePermissions)[number]),
        ),
      },
    };
    const { client, transactionCall } = makeClient(transaction);

    await expect(writeLocalSeed(client, plan)).rejects.toMatchObject({
      code: 'ROLE_MISSING',
      entity: 'roles',
      key: 'staff',
    });

    expect(transactionCall).toHaveBeenCalledTimes(1);
    expect(definitions).toEqual(before);
  });

  it('does not adopt or delete an external short-code conflict', async () => {
    const plan = buildPlan();
    const tinyPlan: LocalSeedPlan = {
      ...plan,
      users: [],
      userRoles: [],
      locations: [plan.locations[0]],
      locationPolicies: [],
      assignments: [],
      allowlists: [],
      dailyMenus: [],
      mealDays: [],
      menuRevisions: [],
      appSettings: [],
      registrations: [],
      delegations: [],
      penalties: [],
      servingVerifications: [],
      pickupSessions: [],
      servingConfirmRequests: [],
      mealServings: [],
      mealEvents: [],
    };
    const state = {
      locations: [{ id: 'external-location', shortCode: 'LOCAL-A' }],
      deleteCalls: 0,
    };
    const transaction = {
      ...canonicalRoleTransaction(),
      location: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => {
          throw codedError('P2002', 'short-code conflict');
        }),
        delete: vi.fn(async () => {
          state.deleteCalls += 1;
        }),
      },
    };
    const { client } = makeClient(transaction);
    const before = structuredClone(state);

    await expect(writeLocalSeed(client, tinyPlan)).rejects.toMatchObject({
      code: 'P2002',
      entity: 'locations',
      key: tinyPlan.locations[0].id,
    });

    expect(state).toEqual(before);
  });
});
