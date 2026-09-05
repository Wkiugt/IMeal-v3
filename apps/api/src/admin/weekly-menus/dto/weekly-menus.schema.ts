import { z } from 'zod';

export const CreateDraftSchema = z.object({
  startDate: z.string().refine(
    (dateString) => {
      const date = new Date(dateString);
      // 1 is Monday in JS getDay()
      return date.getDay() === 1;
    },
    {
      message: 'Start date must be a Monday',
    },
  ),
});

export const UpdateDailyMenuSchema = z.object({
  isHoliday: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
  mealType: z.string().optional(),
  content: z.string().optional(), // Used for revision content
});
