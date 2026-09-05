import { z } from 'zod';

export const DelegationStatusEnum = z.enum([
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'REVOKED',
]);
export type DelegationStatus = z.infer<typeof DelegationStatusEnum>;

export const CreateDelegationRequestSchema = z.object({
  registrationId: z.string().uuid(),
  delegateUserId: z.string().uuid(),
});

export type CreateDelegationRequest = z.infer<
  typeof CreateDelegationRequestSchema
>;

export const DelegationResponseSchema = z.object({
  id: z.string().uuid(),
  registrationId: z.string().uuid(),
  delegateUserId: z.string().uuid(),
  status: DelegationStatusEnum,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DelegationResponse = z.infer<typeof DelegationResponseSchema>;
