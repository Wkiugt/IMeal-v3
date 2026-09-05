import { z } from 'zod';

export const StandardHeadersSchema = z.object({
  'x-request-id': z.string().uuid().optional(),
  'idempotency-key': z.string().min(1).max(100).optional(),
  authorization: z.string().optional(),
  'x-client-version': z.string().optional(),
  'x-client-platform': z.enum(['ios', 'android', 'web']).optional(),
});

export type StandardHeaders = z.infer<typeof StandardHeadersSchema>;
