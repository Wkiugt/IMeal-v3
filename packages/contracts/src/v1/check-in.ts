import { z } from 'zod';
import { MealChoiceSchema, MealDateSchema } from './registrations';
import { PresenterLocationEvidenceSchema } from './locations';

const UtcDateTimeSchema = z
  .string()
  .datetime({ offset: false })
  .refine((value) => value.endsWith('Z'), {
    message: 'Timestamp must be an ISO-8601 UTC instant ending in Z',
  });

const NonEmptyTextSchema = z.string().min(1);

export const CheckInErrorCodeSchema = z.enum([
  'INVALID_QR',
  'INACTIVE_CHECKIN_SESSION',
  'NO_REGISTRATION',
  'REGISTRATION_CANCELLED',
  'ALREADY_CHECKED_IN',
  'OUTSIDE_CHECKIN_WINDOW',
  'LOCATION_MISMATCH',
  'GPS_REQUIRED',
  'GPS_STALE',
  'GPS_INACCURATE',
  'OUTSIDE_GEOFENCE',
  'IDEMPOTENCY_CONFLICT',
]);
export type CheckInErrorCode = z.infer<typeof CheckInErrorCodeSchema>;

export const CheckInWindowSchema = z
  .object({
    opensAt: UtcDateTimeSchema,
    closesAt: UtcDateTimeSchema,
    timeZone: z.literal('Asia/Ho_Chi_Minh'),
  })
  .strict();
export type CheckInWindow = z.infer<typeof CheckInWindowSchema>;

export const CheckInLocationSchema = z
  .object({
    id: NonEmptyTextSchema,
    shortCode: NonEmptyTextSchema,
    displayName: NonEmptyTextSchema,
    servingPointName: NonEmptyTextSchema,
    address: NonEmptyTextSchema,
  })
  .strict();
export type CheckInLocation = z.infer<typeof CheckInLocationSchema>;

export const CheckInMenuSchema = z
  .object({
    name: NonEmptyTextSchema,
    description: z.string().nullable(),
    imageUrl: z.string().nullable(),
  })
  .strict();
export type CheckInMenu = z.infer<typeof CheckInMenuSchema>;

export const CheckInEmployeeSchema = z
  .object({
    id: NonEmptyTextSchema,
    name: NonEmptyTextSchema,
    employeeCode: NonEmptyTextSchema,
  })
  .strict();
export type CheckInEmployee = z.infer<typeof CheckInEmployeeSchema>;

export const CheckInRegistrationSchema = z
  .object({
    id: NonEmptyTextSchema,
    mealDate: MealDateSchema,
    mealChoice: MealChoiceSchema,
    status: z.enum(['ACTIVE', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW']),
    servedAt: UtcDateTimeSchema.nullable(),
  })
  .strict();
export type CheckInRegistration = z.infer<typeof CheckInRegistrationSchema>;

export const CheckInQrSchema = z
  .object({
    qr: NonEmptyTextSchema,
    date: MealDateSchema,
    location: CheckInLocationSchema,
    activeFrom: UtcDateTimeSchema,
    expiresAt: UtcDateTimeSchema,
  })
  .strict();
export type CheckInQr = z.infer<typeof CheckInQrSchema>;

export const KitchenCheckInQrResponseSchema = z
  .object({ data: CheckInQrSchema })
  .strict();
export type KitchenCheckInQrResponse = z.infer<
  typeof KitchenCheckInQrResponseSchema
>;

export const CheckInStatusSchema = z
  .object({
    date: MealDateSchema,
    window: CheckInWindowSchema,
    employee: CheckInEmployeeSchema,
    location: CheckInLocationSchema.nullable(),
    menu: CheckInMenuSchema.nullable(),
    registration: CheckInRegistrationSchema.nullable(),
    state: z.enum([
      'UNREGISTERED',
      'ACTIVE',
      'CHECKED_IN',
      'CANCELLED',
      'NO_SHOW',
      'OUTSIDE_WINDOW',
    ]),
    canResolve: z.boolean(),
    canConfirm: z.boolean(),
  })
  .strict();
export type CheckInStatus = z.infer<typeof CheckInStatusSchema>;

export const CheckInStatusResponseSchema = z
  .object({ data: CheckInStatusSchema })
  .strict();
export type CheckInStatusResponse = z.infer<
  typeof CheckInStatusResponseSchema
>;

export const ResolveCheckInSchema = z
  .object({
    qr: NonEmptyTextSchema,
    gps: PresenterLocationEvidenceSchema,
  })
  .strict();
export type ResolveCheckInInput = z.infer<typeof ResolveCheckInSchema>;

export const CheckInEligibilitySchema = z
  .object({
    eligible: z.boolean(),
    reasons: z.array(CheckInErrorCodeSchema),
  })
  .strict();
export type CheckInEligibility = z.infer<typeof CheckInEligibilitySchema>;

export const ResolveCheckInDataSchema = z
  .object({
    sessionId: NonEmptyTextSchema,
    intentNonce: NonEmptyTextSchema.max(512).nullable(),
    date: MealDateSchema,
    expiresAt: UtcDateTimeSchema,
    employee: CheckInEmployeeSchema,
    menu: CheckInMenuSchema,
    location: CheckInLocationSchema,
    registration: CheckInRegistrationSchema,
    eligibility: CheckInEligibilitySchema,
  })
  .strict();
export type ResolveCheckInData = z.infer<typeof ResolveCheckInDataSchema>;

export const ResolveCheckInResponseSchema = z
  .object({ data: ResolveCheckInDataSchema })
  .strict();
export type ResolveCheckInResponse = z.infer<
  typeof ResolveCheckInResponseSchema
>;

export const ConfirmCheckInSchema = z
  .object({
    sessionId: NonEmptyTextSchema,
    intentNonce: NonEmptyTextSchema.max(512),
    idempotencyKey: NonEmptyTextSchema.max(200),
    gps: PresenterLocationEvidenceSchema,
  })
  .strict();
export type ConfirmCheckInInput = z.infer<typeof ConfirmCheckInSchema>;

export const ConfirmCheckInDataSchema = z
  .object({
    status: z.literal('CHECKED_IN'),
    registrationId: NonEmptyTextSchema,
    servingId: NonEmptyTextSchema,
    servedAt: UtcDateTimeSchema,
  })
  .strict();
export type ConfirmCheckInData = z.infer<typeof ConfirmCheckInDataSchema>;

export const ConfirmCheckInResponseSchema = z
  .object({ data: ConfirmCheckInDataSchema })
  .strict();
export type ConfirmCheckInResponse = z.infer<
  typeof ConfirmCheckInResponseSchema
>;

export const KitchenCheckInDashboardSchema = z
  .object({
    date: MealDateSchema,
    location: CheckInLocationSchema,
    window: CheckInWindowSchema,
    lastUpdated: UtcDateTimeSchema,
    counts: z
      .object({
        registered: z.number().int().nonnegative(),
        checkedIn: z.number().int().nonnegative(),
        pending: z.number().int().nonnegative(),
        noShow: z.number().int().nonnegative(),
        regular: z.number().int().nonnegative(),
        vegetarian: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.counts.checkedIn + value.counts.pending + value.counts.noShow !==
      value.counts.registered
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['counts'],
        message: 'checkedIn + pending + noShow must equal registered',
      });
    }
    if (
      value.counts.regular + value.counts.vegetarian !==
      value.counts.registered
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['counts'],
        message: 'regular + vegetarian must equal registered',
      });
    }
  });
export type KitchenCheckInDashboard = z.infer<
  typeof KitchenCheckInDashboardSchema
>;

export const KitchenCheckInDashboardResponseSchema = z
  .object({ data: KitchenCheckInDashboardSchema })
  .strict();
export type KitchenCheckInDashboardResponse = z.infer<
  typeof KitchenCheckInDashboardResponseSchema
>;

