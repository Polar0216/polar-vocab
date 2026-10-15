import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export const schemaVersionSchema = z.literal(SCHEMA_VERSION);
export const uuidSchema = z.uuid();
export const utcDateTimeSchema = z.iso.datetime({ precision: undefined });
export const languageSchema = z.enum(['en', 'de']);
export const originSchema = z.enum(['manual', 'clipboard', 'ios-csv', 'windows', 'web']);

/** Validate without rewriting the user's original spelling or punctuation. */
export const nonBlankText = (maximumLength: number) =>
  z.string().min(1).max(maximumLength).refine((value) => value.trim().length > 0, '文本不可全为空白');

export const recordFields = {
  id: uuidSchema,
  schemaVersion: schemaVersionSchema,
  revisionId: uuidSchema,
  parentRevisionIds: z.array(uuidSchema),
  createdAt: utcDateTimeSchema,
  updatedAt: utcDateTimeSchema,
  deletedAt: utcDateTimeSchema.nullable().optional(),
};

export function validateRevision(
  record: { revisionId: string; parentRevisionIds: string[] },
  context: z.RefinementCtx,
) {
  if (record.parentRevisionIds.includes(record.revisionId)) {
    context.addIssue({ code: 'custom', path: ['parentRevisionIds'], message: '修订不能以自身为父修订' });
  }
  if (new Set(record.parentRevisionIds).size !== record.parentRevisionIds.length) {
    context.addIssue({ code: 'custom', path: ['parentRevisionIds'], message: '父修订 ID 不可重复' });
  }
}

export type UUID = z.infer<typeof uuidSchema>;
export type Language = z.infer<typeof languageSchema>;
export type CaptureOrigin = z.infer<typeof originSchema>;
