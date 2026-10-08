import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';

const BACKFILL_SQL = readFileSync(
  new URL(
    '../prisma/migrations/20260928000000_phase0_domain_correctness/backfill.sql',
    import.meta.url,
  ),
  'utf8',
);
const PREFLIGHT_SQL = readFileSync(
  new URL(
    '../prisma/migrations/20260928000000_phase0_domain_correctness/preflight.sql',
    import.meta.url,
  ),
  'utf8',
);

async function connectTestClient() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schema = new URL(process.env.DATABASE_URL ?? '').searchParams.get(
    'schema',
  );
  if (!schema) {
    await client.end();
    throw new Error('test database URL must include schema');
  }
  await client.query('SELECT set_config($1, $2, false)', [
    'search_path',
    `"${schema}"`,
  ]);
  return client;
}

async function readBusinessDate(): Promise<Date> {
  const client = await connectTestClient();
  try {
    const result = await client.query<{ business_date: string }>(
      `SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS business_date`,
    );
    if (result.rows.length !== 1) {
      throw new Error('database did not return a business date');
    }
    const businessDate = new Date(`${result.rows[0].business_date}T00:00:00.000Z`);
    if (!Number.isFinite(businessDate.getTime())) {
      throw new Error(`database returned an invalid business date: ${result.rows[0].business_date}`);
    }
    return businessDate;
  } finally {
    await client.end();
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}


async function runBackfill() {
  const client = await connectTestClient();
  try {
    await client.query(BACKFILL_SQL);
  } finally {
    await client.end();
  }
}

async function runPreflight() {
  const client = await connectTestClient();
  try {
    const response = await client.query(PREFLIGHT_SQL);
    const results = Array.isArray(response) ? response : [response];
    const report = results.find((result) =>
      result.fields.some((field: { name: string }) => field.name === 'check_name'),
    );
    if (!report) throw new Error('preflight report result was not returned');
    return report.rows as Array<{
      check_name: string;
      affected_count: number;
    }>;
  } finally {
    await client.end();
  }
}


const TEST_DATE = new Date('2026-09-24T00:00:00.000Z');

async function createUser(email: string) {
  return prisma.user.create({ data: { email, name: email.split('@')[0] } });
}

async function createLocation(
  shortCode: string,
  effectiveFrom: Date = TEST_DATE,
) {
  return prisma.location.create({
    data: {
      shortCode,
      displayName: `Test ${shortCode}`,
      servingPointName: `Counter ${shortCode}`,
      address: `${shortCode} test address`,
      building: 'Test building',
      floor: '1',
      roomOrCounter: `Counter ${shortCode}`,
      localContact: 'Test contact',
      timeZone: 'Asia/Ho_Chi_Minh',
      isActive: true,
      effectiveFrom,
    },
  });
}

describe('Task 2 persistence boundaries', () => {
  it('has no location or employee rows after migration', async () => {
    expect(await prisma.location.count()).toBe(0);
    expect(await prisma.employeeLocationAssignment.count()).toBe(0);
  });

  it('requires one unique active session hash and one serving per registration', async () => {
    const user = await createUser('session@example.test');
    const tokenHash = 'session-hash';

    await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash,
        purpose: 'SESSION_LOGIN',
        authMethod: 'EMAIL_OTP',
        absoluteExpiresAt: new Date('2026-09-25T00:00:00.000Z'),
      },
    });

    await expect(
      prisma.authSession.create({
        data: {
          userId: user.id,
          tokenHash,
          purpose: 'SESSION_LOGIN',
          authMethod: 'EMAIL_OTP',
          absoluteExpiresAt: new Date('2026-09-25T00:00:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const registration = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: TEST_DATE,
        status: 'ACTIVE',
      },
    });
    await prisma.mealServing.create({
      data: { registrationId: registration.id },
    });

    await expect(
      prisma.mealServing.create({
        data: { registrationId: registration.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('retains registration service-location snapshot after assignment changes', async () => {
    const user = await createUser('employee@example.test');
    const firstLocation = await createLocation('TEST-A');
    const secondLocation = await createLocation('TEST-B');
    const assignment = await prisma.employeeLocationAssignment.create({
      data: {
        userId: user.id,
        normalizedEmail: user.email,
        employeeName: 'Test Employee',
        employeeCode: 'EMP-001',
        isActive: true,
        role: 'staff',
        serviceLocationCode: firstLocation.shortCode,
        locationId: firstLocation.id,
        effectiveFrom: TEST_DATE,
      },
    });

    const registration = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: TEST_DATE,
        status: 'ACTIVE',
        serviceLocationId: firstLocation.id,
        serviceLocationAssignmentId: assignment.id,
        serviceLocationCode: firstLocation.shortCode,
        serviceLocationName: firstLocation.displayName,
        serviceLocationAddress: firstLocation.address,
        serviceLocationSnapshotAt: TEST_DATE,
      },
    });

    await prisma.employeeLocationAssignment.update({
      where: { id: assignment.id },
      data: {
        locationId: secondLocation.id,
        serviceLocationCode: secondLocation.shortCode,
        effectiveFrom: new Date('2026-09-25T00:00:00.000Z'),
      },
    });

    const persisted = await prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(persisted.serviceLocationId).toBe(firstLocation.id);
    expect(persisted.serviceLocationAssignmentId).toBe(assignment.id);
    expect(persisted.serviceLocationCode).toBe(firstLocation.shortCode);
    expect(persisted.serviceLocationName).toBe(firstLocation.displayName);
    expect(persisted.serviceLocationAddress).toBe(firstLocation.address);
    expect(persisted.serviceLocationSnapshotAt).toEqual(TEST_DATE);
  });

  it('rejects a duplicate employee code across all active assignments', async () => {
    const user = await createUser('active-code@example.test');
    const firstLocation = await createLocation('TEST-C');
    const secondLocation = await createLocation('TEST-D');

    await prisma.employeeLocationAssignment.create({
      data: {
        userId: user.id,
        normalizedEmail: user.email,
        employeeName: 'Active Code Employee',
        employeeCode: 'EMP-ACTIVE',
        isActive: true,
        role: 'staff',
        serviceLocationCode: firstLocation.shortCode,
        locationId: firstLocation.id,
        effectiveFrom: TEST_DATE,
        effectiveTo: new Date('2026-09-25T00:00:00.000Z'),
      },
    });

    await expect(
      prisma.employeeLocationAssignment.create({
        data: {
          userId: user.id,
          normalizedEmail: user.email,
          employeeName: 'Active Code Employee',
          employeeCode: 'EMP-ACTIVE',
          isActive: true,
          role: 'staff',
          serviceLocationCode: secondLocation.shortCode,
          locationId: secondLocation.id,
          effectiveFrom: new Date('2026-09-25T00:00:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('requires finite accuracy for a valid serving verification', async () => {
    const user = await createUser('verification@example.test');
    const location = await createLocation('TEST-E');

    await expect(
      prisma.servingVerification.create({
        data: {
          presenterUserId: user.id,
          locationId: location.id,
          result: 'VALID',
          capturedAt: TEST_DATE,
          safeVerificationCode: 'GPS_VALID',
          accuracyMeters: null,
        },
      }),
    ).rejects.toThrow(/serving_verifications_accuracy_check/);
  });

  it('keeps serving verification IDs unique', async () => {
    const user = await createUser('verification-id@example.test');
    const location = await createLocation('TEST-F');
    const verificationId = 'verification-id';

    await prisma.servingVerification.create({
      data: {
        id: verificationId,
        presenterUserId: user.id,
        locationId: location.id,
        result: 'GPS_UNAVAILABLE',
        capturedAt: TEST_DATE,
        safeVerificationCode: 'GPS_UNAVAILABLE',
      },
    });

    await expect(
      prisma.servingVerification.create({
        data: {
          id: verificationId,
          presenterUserId: user.id,
          locationId: location.id,
          result: 'GPS_STALE',
          capturedAt: TEST_DATE,
          safeVerificationCode: 'GPS_STALE',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
  it('requires_complete_registration_snapshots_for_new_operational_rows', async () => {
    const user = await createUser('complete-registration@example.test');
    const location = await createLocation('COMPLETE');
    const assignment = await prisma.employeeLocationAssignment.create({
      data: {
        userId: user.id,
        normalizedEmail: user.email,
        employeeName: 'Complete Registration Owner',
        employeeCode: 'COMPLETE-001',
        isActive: true,
        role: 'staff',
        serviceLocationCode: location.shortCode,
        locationId: location.id,
        effectiveFrom: TEST_DATE,
      },
    });
    const weeklyMenu = await prisma.weeklyMenu.create({
      data: {
        startDate: TEST_DATE,
        endDate: new Date('2026-09-30T00:00:00.000Z'),
      },
    });
    const dailyMenu = await prisma.dailyMenu.create({
      data: {
        weeklyMenuId: weeklyMenu.id,
        date: TEST_DATE,
      },
    });
    const revision = await prisma.dailyMenuRevision.create({
      data: {
        dailyMenuId: dailyMenu.id,
        revision: 1,
        mealName: 'Complete menu',
        content: 'legacy content retained',
      },
    });

    await expect(
      prisma.registration.create({
        data: {
          userId: user.id,
          mealDate: TEST_DATE,
          status: 'ACTIVE',
          registeredAt: TEST_DATE,
        },
      }),
    ).rejects.toThrow(/registration_lifecycle_snapshot_complete/);

    const registration = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: TEST_DATE,
        status: 'ACTIVE',
        menuRevisionId: revision.id,
        ownerNameSnapshot: assignment.employeeName,
        employeeCodeSnapshot: assignment.employeeCode,
        menuNameSnapshot: revision.mealName,
        serviceLocationId: location.id,
        serviceLocationAssignmentId: assignment.id,
        serviceLocationCode: location.shortCode,
        serviceLocationName: location.displayName,
        serviceLocationAddress: location.address,
        serviceLocationEffectiveFrom: location.effectiveFrom,
        serviceLocationSnapshotAt: TEST_DATE,
        registeredAt: TEST_DATE,
      },
    });

    const serving = await prisma.mealServing.create({
      data: { registrationId: registration.id },
    });
    expect(serving.registrationId).toBe(registration.id);
    await expect(
      prisma.mealServing.create({
        data: { registrationId: registration.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(
      await prisma.registration.findUniqueOrThrow({
        where: { id: registration.id },
        select: { status: true, mealServing: { select: { id: true } } },
      }),
    ).toMatchObject({ status: 'ACTIVE', mealServing: { id: serving.id } });
  });

  it('enforces_serving_consistency_on_serving_side_mutations', async () => {
    const noShowUser = await createUser('serving-trigger-no-show@example.test');
    const noShowRegistration = await prisma.registration.create({
      data: {
        userId: noShowUser.id,
        mealDate: TEST_DATE,
        status: 'NO_SHOW',
      },
    });
    await expect(
      prisma.mealServing.create({
        data: { registrationId: noShowRegistration.id },
      }),
    ).rejects.toThrow(/state is inconsistent/);

    const servedUser = await createUser('serving-trigger-served@example.test');
    const servedRegistration = await prisma.registration.create({
      data: {
        userId: servedUser.id,
        mealDate: TEST_DATE,
        status: 'ACTIVE',
      },
    });
    await prisma.mealServing.create({
      data: { registrationId: servedRegistration.id },
    });
    await prisma.registration.update({
      where: { id: servedRegistration.id },
      data: { status: 'SERVED' },
    });
    await expect(
      prisma.mealServing.delete({
        where: { registrationId: servedRegistration.id },
      }),
    ).rejects.toThrow(/state is inconsistent/);
  });
  it('serializes_concurrent_serving_and_registration_transition', async () => {
    const user = await createUser('serving-concurrency@example.test');
    const registration = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: TEST_DATE,
        status: 'ACTIVE',
      },
    });
    const servingClient = await connectTestClient();
    const transitionClient = await connectTestClient();
    try {
      await servingClient.query('BEGIN');
      await servingClient.query(
        `INSERT INTO meal_servings (id, registration_id)
         VALUES ($1, $2)`,
        [randomUUID(), registration.id],
      );

      await transitionClient.query('BEGIN');
      const transition = transitionClient.query(
        `UPDATE registrations
         SET status = 'NO_SHOW'::"RegistrationStatus"
         WHERE id = $1`,
        [registration.id],
      );

      // The serving transaction holds the registration row lock. The
      // transition is issued before the serving commit and must serialize
      // behind it rather than commit an invalid NO_SHOW + serving state.
      await servingClient.query('COMMIT');
      await expect(transition).rejects.toMatchObject({
        code: '23514',
        constraint: 'registration_serving_consistency',
      });
      await transitionClient.query('ROLLBACK');

      await expect(
        prisma.registration.findUniqueOrThrow({
          where: { id: registration.id },
          select: { status: true, mealServing: { select: { id: true } } },
        }),
      ).resolves.toMatchObject({
        status: 'ACTIVE',
        mealServing: { id: expect.any(String) },
      });
    } finally {
      await servingClient.query('ROLLBACK').catch(() => undefined);
      await transitionClient.query('ROLLBACK').catch(() => undefined);
      await servingClient.end();
      await transitionClient.end();
    }
  });


  it('backfills_only_verified_evidence_and_is_idempotent', async () => {
    const businessDate = await readBusinessDate();
    const validDate = addDays(businessDate, 7);
    const ambiguousDate = addDays(validDate, 7);
    const invalidDate = addDays(ambiguousDate, 7);
    const absentDate = addDays(invalidDate, 7);
    const duplicateDate = addDays(absentDate, 7);
    const createRevision = async (
      date: Date,
      endDate: Date,
      content: string,
    ) => {
      const weeklyMenu = await prisma.weeklyMenu.create({
        data: { startDate: date, endDate },
      });
      const dailyMenu = await prisma.dailyMenu.create({
        data: { weeklyMenuId: weeklyMenu.id, date },
      });
      return prisma.dailyMenuRevision.create({
        data: { dailyMenuId: dailyMenu.id, content },
      });
    };

    const validRevision = await createRevision(
      validDate,
      addDays(validDate, 6),
      JSON.stringify({
        revision: 1,
        mealName: '  Verified historical menu  ',
        description: 'Verified historical description',
        imageUrl: null,
      }),
    );
    const ambiguousRevisionOne = await createRevision(
      ambiguousDate,
      addDays(ambiguousDate, 6),
      JSON.stringify({
        revision: 1,
        mealName: 'Ambiguous revision one',
        description: null,
        imageUrl: null,
      }),
    );
    const ambiguousRevisionTwo = await prisma.dailyMenuRevision.create({
      data: {
        dailyMenuId: ambiguousRevisionOne.dailyMenuId,
        content: JSON.stringify({
          revision: 2,
          mealName: 'Ambiguous revision two',
          description: null,
          imageUrl: null,
        }),
      },
    });
    const invalidRevision = await createRevision(
      invalidDate,
      addDays(invalidDate, 6),
      'legacy text without a verified structure',
    );

    const validUser = await createUser('backfill-valid@example.test');
    const validLocation = await createLocation('BACKFILL', validDate);
    const validAssignment = await prisma.employeeLocationAssignment.create({
      data: {
        userId: validUser.id,
        normalizedEmail: validUser.email,
        employeeName: 'Backfill Owner',
        employeeCode: 'BACKFILL-001',
        isActive: true,
        role: 'staff',
        serviceLocationCode: validLocation.shortCode,
        locationId: validLocation.id,
        effectiveFrom: validDate,
      },
    });
    const mismatchUser = await createUser('backfill-mismatch@example.test');
    const mismatchAssignment =
      await prisma.employeeLocationAssignment.create({
        data: {
          userId: mismatchUser.id,
          normalizedEmail: mismatchUser.email,
          employeeName: 'Mismatch Owner',
          employeeCode: 'BACKFILL-002',
          isActive: true,
          role: 'staff',
          serviceLocationCode: validLocation.shortCode,
          locationId: validLocation.id,
          effectiveFrom: validDate,
        },
      });
    const completeMismatchRegistration = await prisma.registration.create({
      data: {
        userId: mismatchUser.id,
        mealDate: validDate,
        status: 'ACTIVE',
        menuRevisionId: validRevision.id,
        menuNameSnapshot: 'Verified historical menu',
        menuDescriptionSnapshot: 'Verified historical description',
        menuImageSnapshot: null,
        registeredAt: TEST_DATE,
        ownerNameSnapshot: mismatchAssignment.employeeName,
        employeeCodeSnapshot: mismatchAssignment.employeeCode,
        serviceLocationId: validLocation.id,
        serviceLocationAssignmentId: mismatchAssignment.id,
        serviceLocationCode: validLocation.shortCode,
        serviceLocationName: validLocation.displayName,
        serviceLocationAddress: validLocation.address,
        serviceLocationEffectiveFrom: mismatchAssignment.effectiveFrom,
        serviceLocationSnapshotAt: TEST_DATE,
      },
    });
    const validRegistration = await prisma.registration.create({
      data: {
        userId: validUser.id,
        mealDate: validDate,
        status: 'ACTIVE',
        menuNameSnapshot: 'Existing verified name',
      },
    });
    const ambiguousUser = await createUser('backfill-ambiguous@example.test');
    const ambiguousRegistration = await prisma.registration.create({
      data: {
        userId: ambiguousUser.id,
        mealDate: ambiguousDate,
        status: 'ACTIVE',
      },
    });
    const invalidUser = await createUser('backfill-invalid@example.test');
    const invalidRegistration = await prisma.registration.create({
      data: {
        userId: invalidUser.id,
        mealDate: invalidDate,
        status: 'ACTIVE',
      },
    });
    const absentUser = await createUser('backfill-absent@example.test');
    const absentRegistration = await prisma.registration.create({
      data: {
        userId: absentUser.id,
        mealDate: absentDate,
        status: 'ACTIVE',
      },
    });
    const duplicatePenaltyRegistration = await prisma.registration.create({
      data: {
        userId: validUser.id,
        mealDate: duplicateDate,
        status: 'ACTIVE',
      },
    });

    const validPenalty = await prisma.penalty.create({
      data: {
        userId: validUser.id,
        amount: 50000,
        reason: `NO_SHOW_PENALTY_${validDate.toISOString().slice(0, 10)}_${validRegistration.id}`,
      },
    });
    const invalidPenalty = await prisma.penalty.create({
      data: {
        userId: validUser.id,
        amount: 50000,
        reason: 'NO_SHOW_PENALTY_not-an-exact-identity',
      },
    });
    const duplicatePenaltyOne = await prisma.penalty.create({
      data: {
        userId: validUser.id,
        amount: 50000,
        reason: `NO_SHOW_PENALTY_${duplicateDate.toISOString().slice(0, 10)}_${duplicatePenaltyRegistration.id}`,
      },
    });
    const duplicatePenaltyTwo = await prisma.penalty.create({
      data: {
        userId: validUser.id,
        amount: 50000,
        reason: `NO_SHOW_PENALTY_${duplicateDate.toISOString().slice(0, 10)}_${duplicatePenaltyRegistration.id}`,
      },
    });
    const readStates = async () => ({
      registrations: await prisma.registration.findMany({
        where: {
          id: {
            in: [
              validRegistration.id,
              completeMismatchRegistration.id,
              ambiguousRegistration.id,
              invalidRegistration.id,
              absentRegistration.id,
            ],
          },
        },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          menuRevisionId: true,
          menuNameSnapshot: true,
          menuDescriptionSnapshot: true,
          menuImageSnapshot: true,
          ownerNameSnapshot: true,
          employeeCodeSnapshot: true,
          serviceLocationId: true,
          serviceLocationAssignmentId: true,
          serviceLocationCode: true,
          serviceLocationName: true,
          serviceLocationAddress: true,
          serviceLocationEffectiveFrom: true,
          serviceLocationSnapshotAt: true,
          registeredAt: true,
        },
      }),
      penalties: await prisma.penalty.findMany({
        where: {
          id: {
            in: [
              validPenalty.id,
              invalidPenalty.id,
              duplicatePenaltyOne.id,
              duplicatePenaltyTwo.id,
            ],
          },
        },
        orderBy: { id: 'asc' },
        select: { id: true, registrationId: true, mealDate: true },
      }),
    });

    const preflightReport = await runPreflight();
    const futureActiveCheck = preflightReport.find(
      (check) => check.check_name === 'future_active_snapshot_incomplete',
    );
    const preflightAffectedCount = futureActiveCheck?.affected_count ?? 0;
    expect(preflightAffectedCount).toBeGreaterThan(0);

    await runBackfill();
    const firstStates = await readStates();
    await runBackfill();
    const secondStates = await readStates();
    expect(secondStates).toEqual(firstStates);
    const postBackfillReport = await runPreflight();
    const postBackfillFutureActiveCheck = postBackfillReport.find(
      (check) => check.check_name === 'future_active_snapshot_incomplete',
    );
    expect(postBackfillFutureActiveCheck?.affected_count).toBeLessThan(
      preflightAffectedCount,
    );

    const validState = firstStates.registrations.find(
      (row) => row.id === validRegistration.id,
    );
    expect(validState).toMatchObject({
      menuRevisionId: validRevision.id,
      menuNameSnapshot: '  Verified historical menu  ',
      menuDescriptionSnapshot: 'Verified historical description',
      menuImageSnapshot: null,
      ownerNameSnapshot: validAssignment.employeeName,
      employeeCodeSnapshot: validAssignment.employeeCode,
      serviceLocationId: validLocation.id,
      serviceLocationAssignmentId: validAssignment.id,
      serviceLocationCode: validLocation.shortCode,
      serviceLocationName: validLocation.displayName,
      serviceLocationAddress: validLocation.address,
      serviceLocationEffectiveFrom: validLocation.effectiveFrom,
      serviceLocationSnapshotAt: null,
      registeredAt: null,
    });

    const completeMismatchState = firstStates.registrations.find(
      (row) => row.id === completeMismatchRegistration.id,
    );
    expect(completeMismatchState).toMatchObject({
      menuRevisionId: validRevision.id,
      menuNameSnapshot: '  Verified historical menu  ',
      menuDescriptionSnapshot: 'Verified historical description',
      menuImageSnapshot: null,
      ownerNameSnapshot: mismatchAssignment.employeeName,
      employeeCodeSnapshot: mismatchAssignment.employeeCode,
      serviceLocationId: validLocation.id,
      serviceLocationAssignmentId: mismatchAssignment.id,
      serviceLocationCode: validLocation.shortCode,
      serviceLocationName: validLocation.displayName,
      serviceLocationAddress: validLocation.address,
      serviceLocationEffectiveFrom: mismatchAssignment.effectiveFrom,
      serviceLocationSnapshotAt: TEST_DATE,
      registeredAt: TEST_DATE,
    });

    for (const registrationId of [
      ambiguousRegistration.id,
      invalidRegistration.id,
      absentRegistration.id,
    ]) {
      const state = firstStates.registrations.find(
        (row) => row.id === registrationId,
      );
      expect(state).toMatchObject({
        menuRevisionId: null,
        menuNameSnapshot: null,
        menuDescriptionSnapshot: null,
        menuImageSnapshot: null,
      });
    }

    const invalidRevisionState =
      await prisma.dailyMenuRevision.findUniqueOrThrow({
        where: { id: invalidRevision.id },
        select: {
          revision: true,
          mealName: true,
          description: true,
          imageUrl: true,
        },
      });
    expect(invalidRevisionState).toEqual({
      revision: null,
      mealName: null,
      description: null,
      imageUrl: null,
    });
    expect(
      await prisma.dailyMenuRevision.findUniqueOrThrow({
        where: { id: ambiguousRevisionOne.id },
        select: { revision: true, mealName: true },
      }),
    ).toMatchObject({ revision: 1, mealName: 'Ambiguous revision one' });
    expect(
      await prisma.dailyMenuRevision.findUniqueOrThrow({
        where: { id: ambiguousRevisionTwo.id },
        select: { revision: true, mealName: true },
      }),
    ).toMatchObject({ revision: 2, mealName: 'Ambiguous revision two' });

    const validPenaltyState = firstStates.penalties.find(
      (row) => row.id === validPenalty.id,
    );
    expect(validPenaltyState).toMatchObject({
      registrationId: validRegistration.id,
      mealDate: validDate,
    });
    for (const penaltyId of [
      invalidPenalty.id,
      duplicatePenaltyOne.id,
      duplicatePenaltyTwo.id,
    ]) {
      expect(
        firstStates.penalties.find((row) => row.id === penaltyId),
      ).toMatchObject({ registrationId: null, mealDate: null });
    }
  });

  it('retains_legacy_null_snapshots_without_fabricating_values', async () => {
    const user = await createUser('legacy-registration@example.test');
    const registration = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: TEST_DATE,
        status: 'ACTIVE',
      },
    });

    const persisted = await prisma.registration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(persisted.registeredAt).toBeNull();
    expect(persisted.menuRevisionId).toBeNull();
    expect(persisted.ownerNameSnapshot).toBeNull();
    expect(persisted.employeeCodeSnapshot).toBeNull();
    expect(persisted.serviceLocationId).toBeNull();
    expect(persisted.serviceLocationSnapshotAt).toBeNull();
  });

  it('rejects_duplicate_penalty_registration_id', async () => {
    const user = await createUser('penalty-registration@example.test');
    const registration = await prisma.registration.create({
      data: {
        userId: user.id,
        mealDate: TEST_DATE,
        status: 'ACTIVE',
      },
    });

    await prisma.penalty.create({
      data: {
        userId: user.id,
        registrationId: registration.id,
        mealDate: TEST_DATE,
        amount: 50000,
        reason: 'NO_SHOW',
      },
    });
    await expect(
      prisma.penalty.create({
        data: {
          userId: user.id,
          registrationId: registration.id,
          mealDate: TEST_DATE,
          amount: 50000,
          reason: 'NO_SHOW',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects_served_status_without_meal_serving', async () => {
    const user = await createUser('served-without-serving@example.test');
    await expect(
      prisma.registration.create({
        data: {
          userId: user.id,
          mealDate: TEST_DATE,
          status: 'SERVED',
        },
      }),
    ).rejects.toThrow(/registration_serving_consistency/);
  });

});
