import { z } from 'zod'

// CallHub CSV column indices for the bulk_create `mapping` (field_id ->
// column_index). Only the ones a robocall audience needs; CONTACT is the phone.
export const CALLHUB_CONTACT_FIELD = {
  CONTACT: 0,
  MOBILE: 1,
  LAST_NAME: 2,
  FIRST_NAME: 3,
  ZIPCODE: 9,
} as const

// bulk_create is asynchronous and returns no job id — only a queued-message
// acknowledgement (completion arrives by email; callers poll the phonebook
// contact count to detect load). Parse leniently.
export const BulkImportResponseSchema = z.object({
  message: z.string().nullish(),
})
export type BulkImportResponse = z.infer<typeof BulkImportResponseSchema>
