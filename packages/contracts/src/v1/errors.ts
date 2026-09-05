import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_SERVER_ERROR',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorDetailSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
