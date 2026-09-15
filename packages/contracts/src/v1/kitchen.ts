import { z } from 'zod';
import { MealChoiceSchema } from './registrations';

export const KitchenDashboardCountersSchema = z
  .object({
    totalRegistered: z.number().int().nonnegative(),
    regularTotal: z.number().int().nonnegative(),
    vegetarianTotal: z.number().int().nonnegative(),
    servedTotal: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    noShowTotal: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((counters, context) => {
    if (
      counters.regularTotal + counters.vegetarianTotal !==
      counters.totalRegistered
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['regularTotal', 'vegetarianTotal'],
        message:
          'Regular and vegetarian totals must equal total registered count',
      });
    }
  });
export const ServingLogItemSchema = z
  .object({
    id: z.string(),
    registrationId: z.string(),
    userId: z.string(),
    userName: z.string(),
    userEmail: z.string(),
    mealChoice: MealChoiceSchema,
    servedAt: z.string(),
    isProxy: z.boolean().default(false),
  })
  .strict();

export const KitchenRegistrationItemSchema = z
  .object({
    registrationId: z.string(),
    userId: z.string(),
    userName: z.string(),
    mealChoice: MealChoiceSchema,
    userEmail: z.string(),
    isServed: z.boolean(),
    servedAt: z.string().nullable().optional(),
  })
  .strict();
export const KitchenDashboardSnapshotSchema = z
  .object({
    date: z.string(),
    isServingReady: z.boolean(),
    counters: KitchenDashboardCountersSchema,
    recentLogs: z.array(ServingLogItemSchema),
    lists: z
      .object({
        served: z.array(KitchenRegistrationItemSchema),
        pending: z.array(KitchenRegistrationItemSchema),
        all: z.array(KitchenRegistrationItemSchema),
        noShow: z.array(KitchenRegistrationItemSchema).default([]),
      })
      .strict(),
  })
  .strict();

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
