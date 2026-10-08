import { z } from 'zod';
import { ErrorDetailSchema } from './errors';

export const SuccessEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    meta: z.record(z.unknown()).optional(),
  });

export const ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: ErrorDetailSchema,
  meta: z.record(z.unknown()).optional(),
});

export const EnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion('success', [
    SuccessEnvelopeSchema(dataSchema),
    ErrorEnvelopeSchema,
  ]);

export type SuccessEnvelope<T> = {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
};

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;
