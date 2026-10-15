import { z } from 'zod';
import { recordFields, validateRevision } from './common';

export const themeSchema = z.enum(['light', 'dark', 'system']);
export const appSettingsSchema = z.strictObject({
  ...recordFields,
  theme: themeSchema,
  dailyNew: z.strictObject({ en: z.number().int().min(0).max(1_000), de: z.number().int().min(0).max(1_000) }),
  reviewEnabled: z.strictObject({ en: z.boolean(), de: z.boolean() }),
  desiredRetention: z.number().gt(0).lt(1),
}).superRefine(validateRevision);

export type Theme = z.infer<typeof themeSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
