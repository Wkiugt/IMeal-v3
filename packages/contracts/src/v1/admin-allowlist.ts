import { z } from 'zod';

const UtcDateTimeSchema = z
  .string()
  .datetime({ offset: false })
  .refine((value) => value.endsWith('Z'), {
    message: 'Timestamp must be an ISO-8601 UTC instant ending in Z',
  });

const NormalizedEmailSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim().toLowerCase())
  .pipe(z.string().email());

export const AdminAllowlistBulkUpsertRequestSchema = z
  .object({
    emails: z.array(NormalizedEmailSchema).min(1).max(500),
    state: z.enum(['ACTIVE', 'DISABLED']),
    effectiveFrom: UtcDateTimeSchema,
    effectiveTo: UtcDateTimeSchema.nullable().optional(),
    reason: z.string().max(500).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.effectiveTo) {
      const effectiveFrom = new Date(value.effectiveFrom);
      const effectiveTo = new Date(value.effectiveTo);
      if (effectiveTo <= effectiveFrom) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['effectiveTo'],
          message: 'Effective end must be after effective start.',
        });
      }
    }
  });
export type AdminAllowlistBulkUpsertRequest = z.infer<
  typeof AdminAllowlistBulkUpsertRequestSchema
>;

export const AdminAllowlistBulkUpsertItemSchema = z
  .object({
    normalizedEmail: z.string().email(),
    outcome: z.enum(['CREATED', 'UPDATED']),
    userLink: z.enum(['LINKED', 'UNLINKED']),
  })
  .strict();
export type AdminAllowlistBulkUpsertItem = z.infer<
  typeof AdminAllowlistBulkUpsertItemSchema
>;

export const AdminAllowlistBulkUpsertResponseSchema = z
  .object({
    acceptedCount: z.number().int().nonnegative(),
    createdCount: z.number().int().nonnegative(),
    updatedCount: z.number().int().nonnegative(),
    linkedCount: z.number().int().nonnegative(),
    unlinkedCount: z.number().int().nonnegative(),
    duplicateCount: z.number().int().nonnegative(),
    items: z.array(AdminAllowlistBulkUpsertItemSchema),
  })
  .strict();
export type AdminAllowlistBulkUpsertResponse = z.infer<
  typeof AdminAllowlistBulkUpsertResponseSchema
>;
