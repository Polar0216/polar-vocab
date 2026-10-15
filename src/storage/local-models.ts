import { z } from 'zod'
import { languageSchema, schemaVersionSchema, utcDateTimeSchema, uuidSchema } from '../domain'

/** Local-only settings; never serialized as AppSettings or sent to another device. */
export const devicePreferencesSchema = z.strictObject({
  id: uuidSchema,
  schemaVersion: schemaVersionSchema,
  deviceId: uuidSchema,
  defaultLanguage: languageSchema,
  updatedAt: utcDateTimeSchema,
})

/** ID is exactly the original CaptureEvent UUID, rather than a second generated ID. */
export const ingestedCaptureSchema = z.strictObject({ id: uuidSchema, schemaVersion: schemaVersionSchema })

export type DevicePreferences = z.infer<typeof devicePreferencesSchema>
export type IngestedCapture = z.infer<typeof ingestedCaptureSchema>
