import { z } from 'zod';

const MEAL_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date in the canonical meal-date wire format. */
export const MealDateSchema = z
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

const UtcDateTimeSchema = z
  .string()
  .datetime({ offset: false })
  .refine((value) => value.endsWith('Z'), {
    message: 'Timestamp must be an ISO-8601 UTC instant ending in Z',
  });

export const MealChoiceSchema = z.enum(['REGULAR', 'VEGETARIAN']);
export type MealChoice = z.infer<typeof MealChoiceSchema>;

export const RegistrationStatusSchema = z.enum(['ACTIVE', 'CANCELLED']);
export type RegistrationStatus = z.infer<typeof RegistrationStatusSchema>;

export const BatchRegistrationItemSchema = z.discriminatedUnion('status', [
  z
    .object({
      mealDate: MealDateSchema,
      status: z.literal('ACTIVE'),
      mealChoice: MealChoiceSchema,
    })
    .strict(),
  z
    .object({
      mealDate: MealDateSchema,
      status: z.literal('CANCELLED'),
    })
    .strict(),
]);
export type BatchRegistrationItem = z.infer<typeof BatchRegistrationItemSchema>;

export const BatchRegistrationRequestSchema = z
  .object({
    registrations: z.array(BatchRegistrationItemSchema),
  })
  .strict();
export type BatchRegistrationRequest = z.infer<
  typeof BatchRegistrationRequestSchema
>;

export const RegistrationFailureCodeSchema = z.enum([
  'INVALID_MEAL_DATE',
  'CUTOFF_PASSED',
  'MEAL_CHOICE_UNAVAILABLE',
  'REGISTRATION_FINALIZED',
  'REGISTRATION_FAILED',
]);
export type RegistrationFailureCode = z.infer<
  typeof RegistrationFailureCodeSchema
>;

const BatchRegistrationSuccessSchema = z
  .object({
    date: MealDateSchema,
    success: z.literal(true),
  })
  .strict();

const BatchRegistrationFailureSchema = z
  .object({
    date: MealDateSchema,
    success: z.literal(false),
    code: RegistrationFailureCodeSchema,
    reason: z.string(),
  })
  .strict();

export const BatchRegistrationResultSchema = z.discriminatedUnion('success', [
  BatchRegistrationSuccessSchema,
  BatchRegistrationFailureSchema,
]);
export type BatchRegistrationResult = z.infer<
  typeof BatchRegistrationResultSchema
>;

export const BatchRegistrationResponseSchema = z.array(
  BatchRegistrationResultSchema,
);
export type BatchRegistrationResponse = z.infer<
  typeof BatchRegistrationResponseSchema
>;

export const RegistrationRecordStatusSchema = z.enum([
  'ACTIVE',
  'CANCELLED',
  'SERVED',
  'NO_SHOW',
]);
export type RegistrationRecordStatus = z.infer<
  typeof RegistrationRecordStatusSchema
>;

export const RegistrationRecordSchema = z
  .object({
    id: z.string(),
    mealDate: MealDateSchema,
    status: RegistrationRecordStatusSchema,
    mealChoice: MealChoiceSchema,
    menuRevisionId: z.string().nullable(),
  })
  .strict();
export type RegistrationRecord = z.infer<typeof RegistrationRecordSchema>;

export const LunarDateSchema = z
  .object({
    day: z.number().int().positive(),
    month: z.number().int().positive(),
    year: z.number().int().positive(),
    isLeapMonth: z.boolean(),
  })
  .strict();
export type LunarDate = z.infer<typeof LunarDateSchema>;

export const RegistrationWindowDaySchema = z
  .object({
    mealDate: MealDateSchema,
    cutoffAt: UtcDateTimeSchema,
    editable: z.boolean(),
    lunarDate: LunarDateSchema,
    availableMealChoices: z.array(MealChoiceSchema).min(1),
  })
  .strict();
export type RegistrationWindowDay = z.infer<
  typeof RegistrationWindowDaySchema
>;

export const RegistrationWindowSchema = z
  .object({
    serverNow: UtcDateTimeSchema,
    cutoffAt: UtcDateTimeSchema,
    timeZone: z.literal('Asia/Ho_Chi_Minh'),
    days: z.array(RegistrationWindowDaySchema).length(7),
  })
  .strict();
export type RegistrationWindow = z.infer<typeof RegistrationWindowSchema>;

export const WeekDailyMenuSchema = z
  .object({
    id: z.string(),
    weeklyMenuId: z.string(),
    date: MealDateSchema,
    isHoliday: z.boolean(),
    isEnabled: z.boolean(),
    menuRevisionId: z.string().nullable(),
    mealName: z.string().nullable(),
    description: z.string().nullable(),
    imageUrl: z.string().nullable(),
    createdAt: UtcDateTimeSchema,
  })
  .strict();
export type WeekDailyMenu = z.infer<typeof WeekDailyMenuSchema>;

export const WeekMenuSchema = z
  .object({
    id: z.string(),
    startDate: MealDateSchema,
    endDate: MealDateSchema,
    createdAt: UtcDateTimeSchema,
    updatedAt: UtcDateTimeSchema,
    dailyMenus: z.array(WeekDailyMenuSchema),
  })
  .strict();
export type WeekMenu = z.infer<typeof WeekMenuSchema>;

export const WeekRegistrationResponseSchema = z
  .object({
    menu: WeekMenuSchema.nullable(),
    registrations: z.array(RegistrationRecordSchema),
    registrationWindow: RegistrationWindowSchema,
  })
  .strict();
export type WeekRegistrationResponse = z.infer<
  typeof WeekRegistrationResponseSchema
>;
