import { z } from 'zod';

const MEAL_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date in the canonical meal-date wire format. */
const MealDateSchema = z
  .string()
  .regex(MEAL_DATE_FORMAT, 'Meal date must use YYYY-MM-DD')
  .refine(
    (value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    },
    { message: 'Meal date is invalid' },
  );

export const RegistrationStatusSchema = z.enum(['ACTIVE', 'CANCELLED']);
export type RegistrationStatus = z.infer<typeof RegistrationStatusSchema>;

export const BatchRegistrationItemSchema = z
  .object({
    mealDate: MealDateSchema,
    status: RegistrationStatusSchema,
  })
  .strict();
export type BatchRegistrationItem = z.infer<typeof BatchRegistrationItemSchema>;

export const BatchRegistrationRequestSchema = z
  .object({
    registrations: z.array(BatchRegistrationItemSchema),
  })
  .strict();
export type BatchRegistrationRequest = z.infer<
  typeof BatchRegistrationRequestSchema
>;

export const BatchRegistrationResultSchema = z
  .object({
    date: MealDateSchema,
    success: z.boolean(),
    reason: z.string().optional(),
  })
  .strict();
export type BatchRegistrationResult = z.infer<
  typeof BatchRegistrationResultSchema
>;

export const BatchRegistrationResponseSchema = z.array(
  BatchRegistrationResultSchema,
);
export type BatchRegistrationResponse = z.infer<
  typeof BatchRegistrationResponseSchema
>;
