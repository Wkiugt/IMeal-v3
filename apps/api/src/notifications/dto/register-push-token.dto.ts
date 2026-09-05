import { z } from 'zod';

export const RegisterPushTokenSchema = z.object({
  token: z.string().min(1, 'Push token is required'),
});

export type RegisterPushTokenDto = z.infer<typeof RegisterPushTokenSchema>;
