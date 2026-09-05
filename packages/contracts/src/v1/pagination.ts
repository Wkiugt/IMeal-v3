import { z } from 'zod';

export const CursorPaginationRequestSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export type CursorPaginationRequest = z.infer<
  typeof CursorPaginationRequestSchema
>;

export const CursorPaginationMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
  totalCount: z.number().int().nonnegative().optional(),
});

export type CursorPaginationMeta = z.infer<typeof CursorPaginationMetaSchema>;

export const PaginatedSuccessEnvelopeSchema = <T extends z.ZodTypeAny>(
  dataSchema: T,
) =>
  z.object({
    success: z.literal(true),
    data: z.array(dataSchema),
    meta: z
      .object({
        pagination: CursorPaginationMetaSchema,
      })
      .and(z.record(z.unknown()).optional()),
  });
