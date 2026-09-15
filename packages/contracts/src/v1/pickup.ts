import { z } from 'zod';
import { MealChoiceSchema, MealDateSchema } from './registrations';

const UtcDateTimeSchema = z
  .string()
  .datetime({ offset: false })
  .refine((value) => value.endsWith('Z'), {
    message: 'Timestamp must be an ISO-8601 UTC instant ending in Z',
  });

const PickupOwnerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  })
  .strict();

const PickupOptionFields = {
  registrationId: z.string(),
  mealDate: MealDateSchema,
  mealChoice: MealChoiceSchema,
};

export const PickupOptionSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...PickupOptionFields,
      type: z.literal('OWN'),
    })
    .strict(),
  z
    .object({
      ...PickupOptionFields,
      type: z.literal('DELEGATED'),
      delegationId: z.string(),
      owner: PickupOwnerSchema,
    })
    .strict(),
]);
export type PickupOption = z.infer<typeof PickupOptionSchema>;

export const PickupOptionsResponseSchema = z
  .object({
    options: z.array(PickupOptionSchema),
  })
  .strict();
export type PickupOptionsResponse = z.infer<typeof PickupOptionsResponseSchema>;

export const ServingIntentItemSchema = z
  .object({
    id: z.string(),
    itemName: z.string(),
    quantity: z.number().int().positive(),
    mealChoice: MealChoiceSchema,
  })
  .strict();
export type ServingIntentItem = z.infer<typeof ServingIntentItemSchema>;

const PickupSessionSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    registrationIds: z.array(z.string()),
    expiresAt: UtcDateTimeSchema,
    createdAt: UtcDateTimeSchema,
  })
  .strict();

const ServingIntentSchema = z
  .object({
    userId: z.string(),
    items: z.array(ServingIntentItemSchema),
    totalCount: z.number().int().nonnegative(),
    isProxy: z.boolean(),
  })
  .strict();

export const ResolveServingResponseSchema = z
  .object({
    session: PickupSessionSchema,
    items: z.array(PickupOptionSchema),
    pickupSessionToken: z.string(),
    intent: ServingIntentSchema,
  })
  .strict();
export type ResolveServingResponse = z.infer<typeof ResolveServingResponseSchema>;

export const PickupAvailabilityCodeSchema = z.enum([
  'PICKUP_WINDOW_CLOSED',
  'PICKUP_NOT_READY',
]);

const PickupAvailabilityDetailsSchema = z
  .object({
    availableFrom: z.literal('10:30'),
    availableUntil: z.literal('13:30'),
    timeZone: z.literal('Asia/Ho_Chi_Minh'),
  })
  .strict();

export const PickupAvailabilityErrorSchema = z
  .object({
    code: PickupAvailabilityCodeSchema,
    message: z.string(),
    details: PickupAvailabilityDetailsSchema,
  })
  .strict();

export type PickupAvailabilityCode = z.infer<
  typeof PickupAvailabilityCodeSchema
>;
export type PickupAvailabilityError = z.infer<
  typeof PickupAvailabilityErrorSchema
>;
