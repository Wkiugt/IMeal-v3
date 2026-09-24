import { z } from 'zod';

const UtcDateTimeSchema = z.string().datetime({ offset: false }).refine((value) => value.endsWith('Z'), {
  message: 'Timestamp must be an ISO-8601 UTC instant ending in Z',
});

export const PresenterLocationEvidenceSchema = z.object({
  capturedAt: UtcDateTimeSchema,
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().nonnegative(),
}).strict();
export type PresenterLocationEvidence = z.infer<typeof PresenterLocationEvidenceSchema>;

export const LocationPolicySchema = z.object({
  locationId: z.string().min(1),
  shortCode: z.string().min(1),
  timeZone: z.literal('Asia/Ho_Chi_Minh'),
  geofenceRadiusMeters: z.number().finite().positive(),
  maxFixAgeSeconds: z.number().finite().nonnegative(),
  maxAccuracyMeters: z.number().finite().nonnegative(),
}).strict();
export type LocationPolicy = z.infer<typeof LocationPolicySchema>;

export const RosterImportRowSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  employeeCode: z.string().min(1),
  isActive: z.boolean(),
  role: z.string().min(1),
  serviceLocationCode: z.string().min(1),
  effectiveFrom: UtcDateTimeSchema,
  effectiveTo: UtcDateTimeSchema.nullable(),
}).strict();
export type RosterImportRow = z.infer<typeof RosterImportRowSchema>;
