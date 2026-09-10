import { z } from 'zod';

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
