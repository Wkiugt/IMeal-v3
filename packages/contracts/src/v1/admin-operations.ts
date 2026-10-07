import { z } from 'zod';
import { PagePaginationMetaSchema, PagePaginationRequestSchema } from './pagination';
import { MealDateSchema } from './registrations';

const UtcDateTimeSchema = z
  .string()
  .datetime({ offset: false })
  .refine((value) => value.endsWith('Z'), {
    message: 'Timestamp must be an ISO-8601 UTC instant ending in Z',
  });

const OpaqueIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,80}$/);
const ActionSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/);
const ResultSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{0,63}$/);
const ResourceTypeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/);
const SafeTextSchema = z.string().max(500);
const SafeAuditValueSchema = z.union([
  SafeTextSchema,
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const AdminAuditQuerySchema = PagePaginationRequestSchema.extend({
  action: ActionSchema.optional(),
  actorUserId: OpaqueIdSchema.optional(),
  targetUserId: OpaqueIdSchema.optional(),
  result: ResultSchema.optional(),
  resourceType: ResourceTypeSchema.optional(),
  from: UtcDateTimeSchema.optional(),
  to: UtcDateTimeSchema.optional(),
}).strict();
export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>;

export const AdminAuditEntrySchema = z
  .object({
    id: z.string().min(1),
    action: ActionSchema,
    actorUserId: OpaqueIdSchema.nullable(),
    targetUserId: OpaqueIdSchema.nullable(),
    result: ResultSchema.nullable(),
    resourceType: ResourceTypeSchema.nullable(),
    createdAt: UtcDateTimeSchema,
    details: z.record(z.string().max(80), SafeAuditValueSchema).nullable(),
    redacted: z.boolean(),
  })
  .strict();
export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>;

export const AdminAuditListResponseSchema = z
  .object({
    items: z.array(AdminAuditEntrySchema),
    pagination: PagePaginationMetaSchema,
  })
  .strict();
export type AdminAuditListResponse = z.infer<typeof AdminAuditListResponseSchema>;

export const AdminServingRegistrationStatusSchema = z.enum([
  'ACTIVE',
  'CANCELLED',
  'SERVED',
  'NO_SHOW',
]);
export type AdminServingRegistrationStatus = z.infer<
  typeof AdminServingRegistrationStatusSchema
>;

export const AdminServingReceiverTypeSchema = z.enum(['SELF', 'PROXY']);

export const AdminServingAuditQuerySchema = PagePaginationRequestSchema.extend({
  mealDate: MealDateSchema.optional(),
  employeeCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  locationId: OpaqueIdSchema.optional(),
  ownerUserId: OpaqueIdSchema.optional(),
  registrationStatus: AdminServingRegistrationStatusSchema.optional(),
}).strict();
export type AdminServingAuditQuery = z.infer<typeof AdminServingAuditQuerySchema>;

export const AdminServingAuditItemSchema = z
  .object({
    servingId: z.string().min(1),
    servedAt: UtcDateTimeSchema,
    mealDate: MealDateSchema.nullable(),
    registrationId: z.string().min(1),
    registrationStatus: AdminServingRegistrationStatusSchema,
    ownerUserId: OpaqueIdSchema.nullable(),
    ownerName: SafeTextSchema.nullable(),
    employeeCode: z.string().max(64).nullable(),
    locationId: OpaqueIdSchema.nullable(),
    locationShortCode: z.string().max(32).nullable(),
    locationName: SafeTextSchema.nullable(),
    menuRevisionId: OpaqueIdSchema.nullable(),
    menuName: SafeTextSchema.nullable(),
    menuDescription: SafeTextSchema.nullable(),
    checkInSessionId: OpaqueIdSchema.nullable(),
    authenticatedActorUserId: OpaqueIdSchema.nullable(),
    presenterUserId: OpaqueIdSchema.nullable(),
    receiverType: AdminServingReceiverTypeSchema.nullable(),
    delegationId: OpaqueIdSchema.nullable(),
    pickupSessionId: OpaqueIdSchema.nullable(),
    historicalProxy: z.boolean(),
  })
  .strict();
export type AdminServingAuditItem = z.infer<typeof AdminServingAuditItemSchema>;

export const AdminServingAuditResponseSchema = z
  .object({
    items: z.array(AdminServingAuditItemSchema),
    pagination: PagePaginationMetaSchema,
  })
  .strict();
export type AdminServingAuditResponse = z.infer<
  typeof AdminServingAuditResponseSchema
>;

export const AdminHealthStateSchema = z.enum(['ok', 'down', 'not_configured']);
export type AdminHealthState = z.infer<typeof AdminHealthStateSchema>;

export const AdminJobFamilySchema = z.enum([
  'no_show',
  'registration_reminder',
  'pickup_reminder',
  'cutoff_lock',
  'otp_delivery',
  'notification_dispatch',
  'other',
]);
export type AdminJobFamily = z.infer<typeof AdminJobFamilySchema>;

export const AdminJobStatusSchema = z.enum(['RUNNING', 'COMPLETED', 'FAILED']);

export const AdminJobsQuerySchema = PagePaginationRequestSchema.extend({
  family: AdminJobFamilySchema.optional(),
  status: AdminJobStatusSchema.optional(),
}).strict();
export type AdminJobsQuery = z.infer<typeof AdminJobsQuerySchema>;

export const AdminJobRunSchema = z
  .object({
    id: z.string().min(1),
    jobName: z.string().min(1).max(120),
    family: AdminJobFamilySchema,
    status: AdminJobStatusSchema,
    startedAt: UtcDateTimeSchema,
    completedAt: UtcDateTimeSchema.nullable(),
    failureCode: ResultSchema.nullable(),
    failureMessage: z.string().min(1).max(200).nullable(),
    successCount: z.number().int().nonnegative().nullable(),
    failureCount: z.number().int().nonnegative().nullable(),
    releaseVersion: z.string().regex(/^[A-Za-z0-9._:+-]{1,80}$/).nullable(),
  })
  .strict();
export type AdminJobRun = z.infer<typeof AdminJobRunSchema>;

export const AdminJobsResponseSchema = z
  .object({
    api: z
      .object({
        status: z.enum(['ok', 'error']),
        release: z.string().regex(/^[A-Za-z0-9._:+-]{1,80}$/).nullable(),
        checks: z
          .object({
            environment: AdminHealthStateSchema,
            database: AdminHealthStateSchema,
            migration: AdminHealthStateSchema,
            draining: AdminHealthStateSchema,
          })
          .strict(),
      })
      .strict(),
    worker: z
      .object({
        status: z.enum(['ok', 'error', 'unavailable', 'not_configured']),
        release: z.string().regex(/^[A-Za-z0-9._:+-]{1,80}$/).nullable(),
        checks: z
          .object({
            environment: AdminHealthStateSchema,
            database: AdminHealthStateSchema,
            migration: AdminHealthStateSchema,
            scheduler: AdminHealthStateSchema,
            draining: AdminHealthStateSchema,
            lastLoop: AdminHealthStateSchema,
          })
          .strict()
          .nullable(),
      })
      .strict(),
    knownFamilies: z
      .array(
        z
          .object({
            family: AdminJobFamilySchema,
            persisted: z.boolean(),
          })
          .strict(),
      )
      .max(8),
    items: z.array(AdminJobRunSchema),
    pagination: PagePaginationMetaSchema,
    retryAvailable: z.literal(false),
  })
  .strict();
export type AdminJobsResponse = z.infer<typeof AdminJobsResponseSchema>;
