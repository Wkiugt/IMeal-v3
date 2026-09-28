import { z } from 'zod';
import { MealDateSchema } from './registrations';

export const PenaltyStatusSchema = z.enum(['PENDING', 'PAID', 'WAIVED']);
export type PenaltyStatus = z.infer<typeof PenaltyStatusSchema>;

export const PenaltyItemDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string().nullable().optional(),
  userEmail: z.string().optional(),
  userDepartment: z.string().nullable().optional(),
  amount: z.number().int().nonnegative(),
  reason: z.string(),
  status: PenaltyStatusSchema,
  paidAt: z.string().nullable().optional(),
  waivedAt: z.string().nullable().optional(),
  waiveReason: z.string().nullable().optional(),
  waivedByUserId: z.string().nullable().optional(),
  registrationId: z.string().nullable(),
  mealDate: MealDateSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PenaltyItemDto = z.infer<typeof PenaltyItemDtoSchema>;

export const PenaltyMetricsDtoSchema = z.object({
  totalInvoiced: z.number().int().nonnegative(),
  outstandingAmount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  paidCount: z.number().int().nonnegative(),
  waivedCount: z.number().int().nonnegative(),
  paidAmount: z.number().int().nonnegative().optional(),
  waivedAmount: z.number().int().nonnegative().optional(),
});
export type PenaltyMetricsDto = z.infer<typeof PenaltyMetricsDtoSchema>;

export const PenaltyListResponseDtoSchema = z.object({
  items: z.array(PenaltyItemDtoSchema),
  metrics: PenaltyMetricsDtoSchema,
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type PenaltyListResponseDto = z.infer<
  typeof PenaltyListResponseDtoSchema
>;

export const WaivePenaltyDtoSchema = z.object({
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters long'),
});
export type WaivePenaltyDto = z.infer<typeof WaivePenaltyDtoSchema>;

export const PenaltyListQuerySchema = z.object({
  status: z.enum(['ALL', 'PENDING', 'PAID', 'WAIVED']).optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().positive().default(1).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20).optional(),
});
export type PenaltyListQueryDto = z.infer<typeof PenaltyListQuerySchema>;
