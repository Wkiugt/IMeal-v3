import { z } from 'zod';
import {
  MealChoiceSchema,
  MealDateSchema,
  RegistrationRecordStatusSchema,
} from './registrations';
import { PenaltyStatusSchema } from './penalties';
import {
  PagePaginationMetaSchema,
  PagePaginationRequestSchema,
} from './pagination';

const UtcDateTimeSchema = z
  .string()
  .datetime({ offset: false })
  .refine((value) => value.endsWith('Z'), {
    message: 'Timestamp must be an ISO-8601 UTC instant ending in Z',
  });

const NullableUtcDateTimeSchema = UtcDateTimeSchema.nullable();

const RegistrationActivityFields = {
  id: z.string(),
  mealDate: MealDateSchema,
  status: RegistrationRecordStatusSchema,
  mealChoice: MealChoiceSchema,
  menuRevisionId: z.string().nullable(),
  menuNameSnapshot: z.string().nullable(),
  menuDescriptionSnapshot: z.string().nullable(),
  menuImageSnapshot: z.string().nullable(),
  serviceLocationId: z.string().nullable(),
  serviceLocationAssignmentId: z.string().nullable(),
  serviceLocationCode: z.string().nullable(),
  serviceLocationName: z.string().nullable(),
  serviceLocationAddress: z.string().nullable(),
  serviceLocationEffectiveFrom: NullableUtcDateTimeSchema,
  serviceLocationSnapshotAt: NullableUtcDateTimeSchema,
  registeredAt: NullableUtcDateTimeSchema,
  cancelledAt: NullableUtcDateTimeSchema,
  noShowAt: NullableUtcDateTimeSchema,
  servedAt: NullableUtcDateTimeSchema,
  createdAt: UtcDateTimeSchema,
  updatedAt: UtcDateTimeSchema,
} as const;

export const EmployeeRegistrationActivityBaseSchema = z
  .object(RegistrationActivityFields)
  .strict();
export type EmployeeRegistrationActivityBase = z.infer<
  typeof EmployeeRegistrationActivityBaseSchema
>;

export const EmployeePenaltySummarySchema = z
  .object({
    id: z.string(),
    amount: z.number().int().nonnegative(),
    status: PenaltyStatusSchema,
    createdAt: UtcDateTimeSchema,
    paidAt: NullableUtcDateTimeSchema,
    waivedAt: NullableUtcDateTimeSchema,
  })
  .strict();
export type EmployeePenaltySummary = z.infer<
  typeof EmployeePenaltySummarySchema
>;

export const EmployeeRegistrationActivitySchema = z
  .object({
    ...RegistrationActivityFields,
    penalties: z.array(EmployeePenaltySummarySchema),
  })
  .strict();
export type EmployeeRegistrationActivity = z.infer<
  typeof EmployeeRegistrationActivitySchema
>;

export const SelfPenaltyRegistrationContextSchema =
  EmployeeRegistrationActivityBaseSchema;
export type SelfPenaltyRegistrationContext = z.infer<
  typeof SelfPenaltyRegistrationContextSchema
>;

export const SelfPenaltySchema = z
  .object({
    id: z.string(),
    amount: z.number().int().nonnegative(),
    reason: z.string(),
    status: PenaltyStatusSchema,
    mealDate: MealDateSchema.nullable(),
    createdAt: UtcDateTimeSchema,
    paidAt: NullableUtcDateTimeSchema,
    waivedAt: NullableUtcDateTimeSchema,
    waiveReason: z.string().nullable(),
    registration: SelfPenaltyRegistrationContextSchema.nullable(),
  })
  .strict();
export type SelfPenalty = z.infer<typeof SelfPenaltySchema>;

export const RegistrationHistoryQuerySchema = PagePaginationRequestSchema;
export type RegistrationHistoryQuery = z.infer<
  typeof RegistrationHistoryQuerySchema
>;

export const SelfPenaltyListQuerySchema = PagePaginationRequestSchema.extend({
  status: PenaltyStatusSchema.optional(),
}).strict();
export type SelfPenaltyListQuery = z.infer<typeof SelfPenaltyListQuerySchema>;

const EmployeeActivityPaginationSchema = z
  .object({ pagination: PagePaginationMetaSchema })
  .strict();

const EmployeeActivityPaginatedResponseSchema = <T extends z.ZodTypeAny>(
  itemSchema: T,
) =>
  z
    .object({
      data: z.array(itemSchema),
      meta: EmployeeActivityPaginationSchema,
    })
    .strict();

export const RegistrationHistoryResponseSchema =
  EmployeeActivityPaginatedResponseSchema(EmployeeRegistrationActivitySchema);
export type RegistrationHistoryResponse = z.infer<
  typeof RegistrationHistoryResponseSchema
>;

export const RegistrationStatsQuerySchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must use YYYY-MM')
      .optional(),
  })
  .strict();
export type RegistrationStatsQuery = z.infer<
  typeof RegistrationStatsQuerySchema
>;

export const RegistrationStatsPeriodSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    startDate: MealDateSchema,
    endDate: MealDateSchema,
  })
  .strict();
export type RegistrationStatsPeriod = z.infer<
  typeof RegistrationStatsPeriodSchema
>;

export const RegistrationStatsSchema = z
  .object({
    period: RegistrationStatsPeriodSchema,
    booked: z.number().int().nonnegative(),
    enjoyed: z.number().int().nonnegative(),
  })
  .strict();
export type RegistrationStats = z.infer<typeof RegistrationStatsSchema>;

export const RegistrationStatsResponseSchema = z
  .object({ data: RegistrationStatsSchema })
  .strict();
export type RegistrationStatsResponse = z.infer<
  typeof RegistrationStatsResponseSchema
>;

export const SelfPenaltyListResponseSchema =
  EmployeeActivityPaginatedResponseSchema(SelfPenaltySchema);
export type SelfPenaltyListResponse = z.infer<
  typeof SelfPenaltyListResponseSchema
>;

export const SelfPenaltyDetailResponseSchema = z
  .object({ data: SelfPenaltySchema })
  .strict();
export type SelfPenaltyDetailResponse = z.infer<
  typeof SelfPenaltyDetailResponseSchema
>;
