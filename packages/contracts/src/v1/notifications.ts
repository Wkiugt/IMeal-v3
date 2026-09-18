import { z } from 'zod';
import { MealDateSchema } from './registrations';

const UtcTimestampSchema = z
  .string()
  .datetime({ offset: false })
  .refine((value) => value.endsWith('Z'), {
    message: 'Timestamp must be an ISO-8601 UTC instant ending in Z',
  });

export const NotificationTimestampSchema = UtcTimestampSchema;
export const NotificationIdSchema = z.string().uuid();

export const NotificationKindSchema = z.enum([
  'LEGACY_MESSAGE',
  'REGISTRATION_OPENED',
  'REGISTRATION_REMINDER',
  'PICKUP_REMINDER',
  'DELEGATION_REQUESTED',
  'DELEGATION_ACCEPTED',
  'DELEGATION_DECLINED',
  'DELEGATION_REVOKED',
  'PROXY_PICKUP_COMPLETED',
  'REGISTERED_MENU_CHANGED',
  'NO_SHOW_PENALTY_CREATED',
]);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

const NonEmptyTextSchema = z.string().min(1);

export const NotificationCopyLocaleSchema = z
  .object({
    title: NonEmptyTextSchema,
    body: z.string(),
  })
  .strict();

export const NotificationCopySchema = z
  .object({
    vi: NotificationCopyLocaleSchema,
    en: NotificationCopyLocaleSchema,
  })
  .strict();

export const LegacyMessagePayloadSchema = z.object({}).strict();

export const RegistrationOpenedPayloadSchema = z
  .object({
    weekStart: MealDateSchema,
    weekEnd: MealDateSchema,
  })
  .strict();

export const RegistrationReminderPayloadSchema = z
  .object({
    weekStart: MealDateSchema,
    weekEnd: MealDateSchema,
    remainingMealDates: z.array(MealDateSchema),
  })
  .strict();

export const PickupReminderPayloadSchema = z
  .object({
    mealDate: MealDateSchema,
    registrationIds: z.array(NotificationIdSchema),
    registrationCount: z.number().int().nonnegative(),
  })
  .strict()
  .refine((payload) => payload.registrationCount === payload.registrationIds.length, {
    message: 'registrationCount must equal registrationIds length',
    path: ['registrationCount'],
  });

const DelegationPayloadBaseSchema = {
  delegationId: NotificationIdSchema,
  registrationId: NotificationIdSchema,
  mealDate: MealDateSchema,
  counterpartName: NonEmptyTextSchema,
};

export const DelegationRequestedPayloadSchema = z
  .object(DelegationPayloadBaseSchema)
  .strict();
export const DelegationAcceptedPayloadSchema = z
  .object(DelegationPayloadBaseSchema)
  .strict();
export const DelegationDeclinedPayloadSchema = z
  .object(DelegationPayloadBaseSchema)
  .strict();

export const DelegationRevokedReasonSchema = z.enum([
  'OWNER_REVOKED',
  'REGISTRATION_CANCELLED',
]);
export type DelegationRevokedReason = z.infer<
  typeof DelegationRevokedReasonSchema
>;

export const DelegationRevokedPayloadSchema = z
  .object({
    ...DelegationPayloadBaseSchema,
    reason: DelegationRevokedReasonSchema,
  })
  .strict();

export const ProxyPickupCompletedPayloadSchema = z
  .object({
    servingId: NotificationIdSchema,
    registrationId: NotificationIdSchema,
    mealDate: MealDateSchema,
    delegateName: NonEmptyTextSchema,
  })
  .strict();

export const RegisteredMenuChangedPayloadSchema = z
  .object({
    dailyMenuRevisionId: NotificationIdSchema,
    mealDate: MealDateSchema,
  })
  .strict();

export const NoShowPenaltyCreatedPayloadSchema = z
  .object({
    penaltyId: NotificationIdSchema,
    registrationId: NotificationIdSchema,
    mealDate: MealDateSchema,
    amount: z.number().int().positive(),
  })
  .strict();

const NotificationItemBaseSchema = {
  id: NotificationIdSchema,
  copy: NotificationCopySchema,
  readAt: UtcTimestampSchema.nullable(),
  createdAt: UtcTimestampSchema,
};

export const LegacyMessageNotificationItemSchema = z
  .object({
    ...NotificationItemBaseSchema,
    kind: z.literal('LEGACY_MESSAGE'),
    payload: LegacyMessagePayloadSchema,
  })
  .strict();

export const RegistrationOpenedNotificationItemSchema = z
  .object({
    ...NotificationItemBaseSchema,
    kind: z.literal('REGISTRATION_OPENED'),
    payload: RegistrationOpenedPayloadSchema,
  })
  .strict();

export const RegistrationReminderNotificationItemSchema = z
  .object({
    ...NotificationItemBaseSchema,
    kind: z.literal('REGISTRATION_REMINDER'),
    payload: RegistrationReminderPayloadSchema,
  })
  .strict();

export const PickupReminderNotificationItemSchema = z
  .object({
    ...NotificationItemBaseSchema,
    kind: z.literal('PICKUP_REMINDER'),
    payload: PickupReminderPayloadSchema,
  })
  .strict();

export const DelegationRequestedNotificationItemSchema = z
  .object({
    ...NotificationItemBaseSchema,
    kind: z.literal('DELEGATION_REQUESTED'),
    payload: DelegationRequestedPayloadSchema,
  })
  .strict();

export const DelegationAcceptedNotificationItemSchema = z
  .object({
    ...NotificationItemBaseSchema,
    kind: z.literal('DELEGATION_ACCEPTED'),
    payload: DelegationAcceptedPayloadSchema,
  })
  .strict();

export const DelegationDeclinedNotificationItemSchema = z
  .object({
    ...NotificationItemBaseSchema,
    kind: z.literal('DELEGATION_DECLINED'),
    payload: DelegationDeclinedPayloadSchema,
  })
  .strict();

export const DelegationRevokedNotificationItemSchema = z
  .object({
    ...NotificationItemBaseSchema,
    kind: z.literal('DELEGATION_REVOKED'),
    payload: DelegationRevokedPayloadSchema,
  })
  .strict();

export const ProxyPickupCompletedNotificationItemSchema = z
  .object({
    ...NotificationItemBaseSchema,
    kind: z.literal('PROXY_PICKUP_COMPLETED'),
    payload: ProxyPickupCompletedPayloadSchema,
  })
  .strict();

export const RegisteredMenuChangedNotificationItemSchema = z
  .object({
    ...NotificationItemBaseSchema,
    kind: z.literal('REGISTERED_MENU_CHANGED'),
    payload: RegisteredMenuChangedPayloadSchema,
  })
  .strict();

export const NoShowPenaltyCreatedNotificationItemSchema = z
  .object({
    ...NotificationItemBaseSchema,
    kind: z.literal('NO_SHOW_PENALTY_CREATED'),
    payload: NoShowPenaltyCreatedPayloadSchema,
  })
  .strict();

export const NotificationItemSchema = z.discriminatedUnion('kind', [
  LegacyMessageNotificationItemSchema,
  RegistrationOpenedNotificationItemSchema,
  RegistrationReminderNotificationItemSchema,
  PickupReminderNotificationItemSchema,
  DelegationRequestedNotificationItemSchema,
  DelegationAcceptedNotificationItemSchema,
  DelegationDeclinedNotificationItemSchema,
  DelegationRevokedNotificationItemSchema,
  ProxyPickupCompletedNotificationItemSchema,
  RegisteredMenuChangedNotificationItemSchema,
  NoShowPenaltyCreatedNotificationItemSchema,
]);
export type NotificationItem = z.infer<typeof NotificationItemSchema>;

export const NotificationListQuerySchema = z
  .object({
    cursor: NotificationIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const NotificationListMetaSchema = z
  .object({
    nextCursor: NotificationIdSchema.nullable(),
    hasNextPage: z.boolean(),
    unreadCount: z.number().int().nonnegative(),
  })
  .strict();

export const NotificationListResponseSchema = z
  .object({
    data: z.array(NotificationItemSchema),
    meta: NotificationListMetaSchema,
  })
  .strict();
export type NotificationListResponse = z.infer<
  typeof NotificationListResponseSchema
>;

export const NotificationDetailResponseSchema = z
  .object({ data: NotificationItemSchema })
  .strict();
export const NotificationReadResponseSchema = NotificationDetailResponseSchema;
export type NotificationDetailResponse = z.infer<
  typeof NotificationDetailResponseSchema
>;

export const NotificationLocaleSchema = z.enum(['vi', 'en']);
export type NotificationLocale = z.infer<typeof NotificationLocaleSchema>;

export const NotificationPreferencesSchema = z
  .object({
    remindersEnabled: z.boolean(),
    locale: NotificationLocaleSchema,
  })
  .strict();

export const NotificationPreferencesResponseSchema = z
  .object({ data: NotificationPreferencesSchema })
  .strict();
export type NotificationPreferencesResponse = z.infer<
  typeof NotificationPreferencesResponseSchema
>;

export const NotificationPreferencesRequestSchema = z
  .object({
    remindersEnabled: z.boolean().optional(),
    locale: NotificationLocaleSchema.optional(),
  })
  .strict()
  .refine((value) => value.remindersEnabled !== undefined || value.locale !== undefined, {
    message: 'At least one notification preference is required',
  });
export type NotificationPreferencesRequest = z.infer<
  typeof NotificationPreferencesRequestSchema
>;

export const ExpoPushTokenSchema = z
  .string()
  .regex(/^(?:ExpoPushToken|ExponentPushToken)\[[^\]\r\n]+\]$/, {
    message: 'Invalid Expo push token',
  });

export const PushDevicePlatformSchema = z.enum(['ios', 'android']);
export type PushDevicePlatform = z.infer<typeof PushDevicePlatformSchema>;

export const RegisterPushDeviceRequestSchema = z
  .object({
    token: ExpoPushTokenSchema,
    platform: PushDevicePlatformSchema,
  })
  .strict();
export type RegisterPushDeviceRequest = z.infer<
  typeof RegisterPushDeviceRequestSchema
>;

export const RevokePushDeviceRequestSchema = z
  .object({ token: ExpoPushTokenSchema })
  .strict();
export type RevokePushDeviceRequest = z.infer<
  typeof RevokePushDeviceRequestSchema
>;

// Naming aliases keep the shared contract convenient for API and mobile callers.
export const PushDeviceRegistrationSchema = RegisterPushDeviceRequestSchema;
export const PushDeviceRevocationSchema = RevokePushDeviceRequestSchema;
export const NotificationPreferencesUpdateSchema = NotificationPreferencesRequestSchema;

export type LegacyMessagePayload = z.infer<typeof LegacyMessagePayloadSchema>;
export type RegistrationOpenedPayload = z.infer<
  typeof RegistrationOpenedPayloadSchema
>;
export type RegistrationReminderPayload = z.infer<
  typeof RegistrationReminderPayloadSchema
>;
export type PickupReminderPayload = z.infer<typeof PickupReminderPayloadSchema>;
export type DelegationRequestedPayload = z.infer<
  typeof DelegationRequestedPayloadSchema
>;
export type DelegationAcceptedPayload = z.infer<
  typeof DelegationAcceptedPayloadSchema
>;
export type DelegationDeclinedPayload = z.infer<
  typeof DelegationDeclinedPayloadSchema
>;
export type DelegationRevokedPayload = z.infer<
  typeof DelegationRevokedPayloadSchema
>;
export type ProxyPickupCompletedPayload = z.infer<
  typeof ProxyPickupCompletedPayloadSchema
>;
export type RegisteredMenuChangedPayload = z.infer<
  typeof RegisteredMenuChangedPayloadSchema
>;
export type NoShowPenaltyCreatedPayload = z.infer<
  typeof NoShowPenaltyCreatedPayloadSchema
>;
