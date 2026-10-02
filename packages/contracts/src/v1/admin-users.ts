import { z } from 'zod';
import {
  PagePaginationMetaSchema,
  PagePaginationRequestSchema,
} from './pagination';
import { MealDateSchema } from './registrations';

const UtcDateTimeSchema = z
  .string()
  .datetime({ offset: false })
  .refine((value) => value.endsWith('Z'), {
    message: 'Timestamp must be an ISO-8601 UTC instant ending in Z',
  });

const QueryBooleanSchema = z.union([
  z.boolean(),
  z.literal('true').transform(() => true),
  z.literal('false').transform(() => false),
]);

export const AdminManagedRoleSchema = z.enum(['staff', 'kitchen']);
export type AdminManagedRole = z.infer<typeof AdminManagedRoleSchema>;

export const AdminUserStatusFilterSchema = z.enum([
  'ALL',
  'ACTIVE',
  'DISABLED',
]);
export type AdminUserStatusFilter = z.infer<typeof AdminUserStatusFilterSchema>;

export const AdminUserRoleFilterSchema = z.enum([
  'ALL',
  'staff',
  'kitchen',
  'admin',
  'unmanaged',
]);
export type AdminUserRoleFilter = z.infer<typeof AdminUserRoleFilterSchema>;

export const AdminSafeLocationSummarySchema = z
  .object({
    id: z.string().min(1),
    shortCode: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();
export type AdminSafeLocationSummary = z.infer<
  typeof AdminSafeLocationSummarySchema
>;

export const AdminUserAuditActionSchema = z.enum([
  'USER_ROLES_UPDATED',
  'USER_DISABLED',
  'USER_ENABLED',
  'USER_SESSIONS_REVOKED',
]);
export type AdminUserAuditAction = z.infer<typeof AdminUserAuditActionSchema>;

const SafeAuditScalarSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const SafeAuditValueSchema = z.union([
  SafeAuditScalarSchema,
  z.array(AdminManagedRoleSchema).max(2),
]);

const SafeAuditDetailsSchema = z
  .record(z.string().max(80), SafeAuditValueSchema)
  .superRefine((details, context) => {
    const unsafeKey = Object.keys(details).find((key) =>
      /(token|hash|secret|password|otp|gps|coordinate|provider|authorization)/i.test(
        key,
      ),
    );
    if (unsafeKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [unsafeKey],
        message: 'Audit details contain a secret-bearing key',
      });
    }
  });

export const AdminUserAuditEntrySchema = z
  .object({
    id: z.string().min(1),
    action: AdminUserAuditActionSchema,
    actorUserId: z.string().min(1).nullable(),
    targetUserId: z.string().min(1),
    createdAt: UtcDateTimeSchema,
    details: SafeAuditDetailsSchema,
  })
  .strict();
export type AdminUserAuditEntry = z.infer<typeof AdminUserAuditEntrySchema>;

export const AdminUserListQuerySchema = PagePaginationRequestSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: AdminUserStatusFilterSchema.default('ALL'),
  role: AdminUserRoleFilterSchema.default('ALL'),
}).strict();
export type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;

export const AdminUserListItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().email(),
    isActive: z.boolean(),
    managedRoles: z.array(AdminManagedRoleSchema),
    employeeCode: z.string().nullable(),
    effectiveServiceLocation: AdminSafeLocationSummarySchema.nullable(),
    activeSessionCount: z.number().int().nonnegative(),
  })
  .strict();
export type AdminUserListItem = z.infer<typeof AdminUserListItemSchema>;

export const AdminUserListResponseSchema = z
  .object({
    items: z.array(AdminUserListItemSchema),
    pagination: PagePaginationMetaSchema,
  })
  .strict();
export type AdminUserListResponse = z.infer<typeof AdminUserListResponseSchema>;

export const AdminUserRosterAssignmentSchema = z
  .object({
    id: z.string().min(1),
    employeeCode: z.string().min(1),
    rosterRole: z.string().min(1),
    isActive: z.boolean(),
    effectiveFrom: UtcDateTimeSchema,
    effectiveTo: UtcDateTimeSchema.nullable(),
    serviceLocation: AdminSafeLocationSummarySchema.nullable(),
  })
  .strict();

export const AdminUserDetailSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().email(),
    isActive: z.boolean(),
    managedRoles: z.array(AdminManagedRoleSchema),
    allRoles: z.array(z.string().min(1)),
    employeeCode: z.string().nullable(),
    effectiveServiceLocation: AdminSafeLocationSummarySchema.nullable(),
    rosterAssignment: AdminUserRosterAssignmentSchema.nullable(),
    allowlist: z
      .object({
        state: z.enum(['ACTIVE', 'DISABLED']),
        effectiveFrom: UtcDateTimeSchema,
        effectiveTo: UtcDateTimeSchema.nullable(),
      })
      .strict()
      .nullable(),
    sessions: z
      .object({
        activeCount: z.number().int().nonnegative(),
        totalCount: z.number().int().nonnegative(),
      })
      .strict(),
    lifecycle: z
      .object({
        createdAt: UtcDateTimeSchema,
        updatedAt: UtcDateTimeSchema,
        lastRoleChangeAt: UtcDateTimeSchema.nullable(),
        lastDisableAt: UtcDateTimeSchema.nullable(),
        lastEnableAt: UtcDateTimeSchema.nullable(),
        lastSessionRevokeAt: UtcDateTimeSchema.nullable(),
      })
      .strict(),
    auditSummary: z
      .object({
        recent: z.array(AdminUserAuditEntrySchema).max(25),
        actionCounts: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict(),
  })
  .strict();
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;

export const AdminUserRolesUpdateRequestSchema = z
  .object({
    roles: z
      .array(AdminManagedRoleSchema)
      .max(2)
      .superRefine((roles, context) => {
        if (new Set(roles).size !== roles.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Duplicate managed role',
          });
        }
      }),
  })
  .strict();
export type AdminUserRolesUpdateRequest = z.infer<
  typeof AdminUserRolesUpdateRequestSchema
>;

export const AdminUserRolesUpdateResponseSchema = z
  .object({
    userId: z.string().min(1),
    managedRoles: z.array(AdminManagedRoleSchema),
    allRoles: z.array(z.string().min(1)),
    changed: z.boolean(),
    updatedAt: UtcDateTimeSchema,
  })
  .strict();
export type AdminUserRolesUpdateResponse = z.infer<
  typeof AdminUserRolesUpdateResponseSchema
>;

export const AdminUserDisablePreviewItemSchema = z
  .object({
    id: z.string().min(1),
    mealDate: MealDateSchema,
    serviceLocation: AdminSafeLocationSummarySchema.nullable(),
  })
  .strict();

const AdminUserDelegationPreviewItemSchema = z
  .object({
    id: z.string().min(1),
    registrationId: z.string().min(1),
    mealDate: MealDateSchema,
    status: z.enum(['PENDING', 'ACCEPTED']),
  })
  .strict();

export const AdminUserDisablePreviewResponseSchema = z
  .object({
    userId: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().email(),
    isActive: z.boolean(),
    managedRoles: z.array(AdminManagedRoleSchema),
    allRoles: z.array(z.string().min(1)),
    activeSessionCount: z.number().int().nonnegative(),
    actionableFromDate: MealDateSchema,
    generatedAt: UtcDateTimeSchema,
    registrations: z
      .object({
        count: z.number().int().nonnegative(),
        items: z.array(AdminUserDisablePreviewItemSchema).max(25),
      })
      .strict(),
    outgoingDelegations: z
      .object({
        count: z.number().int().nonnegative(),
        items: z.array(AdminUserDelegationPreviewItemSchema).max(25),
      })
      .strict(),
    incomingDelegations: z
      .object({
        count: z.number().int().nonnegative(),
        items: z.array(AdminUserDelegationPreviewItemSchema).max(25),
      })
      .strict(),
  })
  .strict();
export type AdminUserDisablePreviewResponse = z.infer<
  typeof AdminUserDisablePreviewResponseSchema
>;

export const AdminUserDisableRequestSchema = z
  .object({ confirm: z.literal(true) })
  .strict();
export type AdminUserDisableRequest = z.infer<
  typeof AdminUserDisableRequestSchema
>;

export const AdminUserDisableResponseSchema = z
  .object({
    userId: z.string().min(1),
    isActive: z.literal(false),
    changed: z.boolean(),
    affected: z
      .object({
        registrationsCancelled: z.number().int().nonnegative(),
        delegationsRevoked: z.number().int().nonnegative(),
        sessionsRevoked: z.number().int().nonnegative(),
      })
      .strict(),
    auditCreated: z.boolean(),
    completedAt: UtcDateTimeSchema,
  })
  .strict();
export type AdminUserDisableResponse = z.infer<
  typeof AdminUserDisableResponseSchema
>;

export const AdminUserEnableRequestSchema = z.object({}).strict();
export type AdminUserEnableRequest = z.infer<
  typeof AdminUserEnableRequestSchema
>;

export const AdminUserEnableResponseSchema = z
  .object({
    userId: z.string().min(1),
    isActive: z.literal(true),
    changed: z.boolean(),
    auditCreated: z.boolean(),
    completedAt: UtcDateTimeSchema,
  })
  .strict();
export type AdminUserEnableResponse = z.infer<
  typeof AdminUserEnableResponseSchema
>;

export const AdminUserSessionsQuerySchema = PagePaginationRequestSchema.extend({
  includeRevoked: QueryBooleanSchema.default(true),
}).strict();
export type AdminUserSessionsQuery = z.infer<
  typeof AdminUserSessionsQuerySchema
>;

export const AdminUserSessionRevocationReasonSchema = z.enum([
  'LOGOUT',
  'ACCOUNT_DISABLED',
  'COMPROMISED',
  'OTP_REPLAY',
  'ADMIN_REVOKED',
  'EXPIRED',
]);

export const AdminUserSessionSchema = z
  .object({
    id: z.string().min(1),
    createdAt: UtcDateTimeSchema,
    lastUsedAt: UtcDateTimeSchema.nullable(),
    idleExpiresAt: UtcDateTimeSchema.nullable(),
    absoluteExpiresAt: UtcDateTimeSchema,
    revokedAt: UtcDateTimeSchema.nullable(),
    revokedReason: AdminUserSessionRevocationReasonSchema.nullable(),
    isActive: z.boolean(),
  })
  .strict();
export type AdminUserSession = z.infer<typeof AdminUserSessionSchema>;

export const AdminUserSessionsResponseSchema = z
  .object({
    items: z.array(AdminUserSessionSchema),
    pagination: PagePaginationMetaSchema,
  })
  .strict();
export type AdminUserSessionsResponse = z.infer<
  typeof AdminUserSessionsResponseSchema
>;

export const AdminUserRevokeAllRequestSchema = z.object({}).strict();
export type AdminUserRevokeAllRequest = z.infer<
  typeof AdminUserRevokeAllRequestSchema
>;

export const AdminUserRevokeAllResponseSchema = z
  .object({
    userId: z.string().min(1),
    isActive: z.boolean(),
    revokedCount: z.number().int().nonnegative(),
    reason: z.literal('ADMIN_REVOKED'),
    changed: z.boolean(),
    auditCreated: z.boolean(),
    completedAt: UtcDateTimeSchema,
  })
  .strict();
export type AdminUserRevokeAllResponse = z.infer<
  typeof AdminUserRevokeAllResponseSchema
>;

export const AdminUserAuditQuerySchema = PagePaginationRequestSchema.extend({
  action: AdminUserAuditActionSchema.optional(),
  from: UtcDateTimeSchema.optional(),
  to: UtcDateTimeSchema.optional(),
}).strict();
export type AdminUserAuditQuery = z.infer<typeof AdminUserAuditQuerySchema>;

export const AdminUserAuditResponseSchema = z
  .object({
    items: z.array(AdminUserAuditEntrySchema),
    pagination: PagePaginationMetaSchema,
  })
  .strict();
export type AdminUserAuditResponse = z.infer<
  typeof AdminUserAuditResponseSchema
>;
