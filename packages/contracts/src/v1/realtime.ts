import { z } from 'zod';

export const RealtimeEventTypeSchema = z.enum([
  'MEAL_REGISTERED',
  'MEAL_CANCELLED',
  'USER_UPDATED',
  'SYSTEM_NOTIFICATION',
  'SERVING_CONFIRMED',
  'KITCHEN_SIGNAL_CHANGED',
]);

export type RealtimeEventType = z.infer<typeof RealtimeEventTypeSchema>;

export const RealtimeEventEnvelopeSchema = <T extends z.ZodTypeAny>(
  payloadSchema: T,
) =>
  z.object({
    eventId: z.string().uuid(),
    type: RealtimeEventTypeSchema,
    timestamp: z.string().datetime(),
    payload: payloadSchema,
  });

export type RealtimeEventEnvelope<T> = {
  eventId: string;
  type: RealtimeEventType;
  timestamp: string;
  payload: T;
};
