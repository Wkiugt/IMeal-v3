import { z } from 'zod';

export const KitchenDashboardCountersSchema = z.object({
  totalRegistered: z.number().int().nonnegative(),
  servedTotal: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  noShowTotal: z.number().int().nonnegative(),
});

export const ServingLogItemSchema = z.object({
  id: z.string(),
  registrationId: z.string(),
  userId: z.string(),
  userName: z.string(),
  userEmail: z.string(),
  servedAt: z.string(),
  isProxy: z.boolean().default(false),
});

export const KitchenRegistrationItemSchema = z.object({
  registrationId: z.string(),
  userId: z.string(),
  userName: z.string(),
  userEmail: z.string(),
  isServed: z.boolean(),
  servedAt: z.string().nullable().optional(),
});

export const KitchenDashboardSnapshotSchema = z.object({
  date: z.string(),
  isServingReady: z.boolean(),
  counters: KitchenDashboardCountersSchema,
  recentLogs: z.array(ServingLogItemSchema),
  lists: z.object({
    served: z.array(KitchenRegistrationItemSchema),
    pending: z.array(KitchenRegistrationItemSchema),
    all: z.array(KitchenRegistrationItemSchema),
    noShow: z.array(KitchenRegistrationItemSchema).default([]),
  }),
});

export type KitchenDashboardCounters = z.infer<
  typeof KitchenDashboardCountersSchema
>;
export type ServingLogItem = z.infer<typeof ServingLogItemSchema>;
export type KitchenRegistrationItem = z.infer<
  typeof KitchenRegistrationItemSchema
>;
export type KitchenDashboardSnapshot = z.infer<
  typeof KitchenDashboardSnapshotSchema
>;
