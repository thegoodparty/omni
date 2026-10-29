import { z } from 'zod'

export const SERVE_IMPORT_CONTACTS_FLAG = 'serve-import-contacts'

export const CONTACT_UPLOAD_MAX_ROWS = 100_000
export const CONTACT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024
export const CONTACT_UPLOAD_NAME_MAX_LENGTH = 60

export const CONTACT_UPLOAD_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'cellPhone',
  'landline',
  'addressLine',
  'city',
  'zip',
] as const
export type ContactUploadField = (typeof CONTACT_UPLOAD_FIELDS)[number]

export const ContactUploadColumnMappingSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().min(1).nullable(),
  cellPhone: z.string().min(1).nullable(),
  landline: z.string().min(1).nullable(),
  addressLine: z.string().min(1).nullable(),
  city: z.string().min(1).nullable(),
  zip: z.string().min(1).nullable(),
})
export type ContactUploadColumnMapping = z.infer<
  typeof ContactUploadColumnMappingSchema
>

// Multipart fields sent beside the `file` part. columnMapping travels as a
// JSON string because multipart fields are flat.
export const CreateContactUploadFieldsSchema = z.object({
  name: z.string().trim().min(1).max(CONTACT_UPLOAD_NAME_MAX_LENGTH),
  consentAffirmed: z.literal('true'),
  columnMapping: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown
      } catch {
        ctx.addIssue({ code: 'custom', message: 'columnMapping is not JSON' })
        return z.NEVER
      }
    })
    .pipe(ContactUploadColumnMappingSchema),
})
export type CreateContactUploadFields = z.input<
  typeof CreateContactUploadFieldsSchema
>

export const ContactUploadStatusSchema = z.enum([
  'processing',
  'needs_input',
  'complete',
  'failed',
])
export type ContactUploadStatus = z.infer<typeof ContactUploadStatusSchema>

export const ContactUploadMatchOutcomeSchema = z.enum([
  'pending',
  'matched',
  'new',
  'needs_input',
  'resolved',
  'skipped',
  'invalid',
])
export type ContactUploadMatchOutcome = z.infer<
  typeof ContactUploadMatchOutcomeSchema
>

export const ContactUploadSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  name: z.string(),
  fileName: z.string(),
  uploadedBy: z
    .object({ id: z.number(), name: z.string().nullable() })
    .nullable(),
  status: ContactUploadStatusSchema,
  columnMapping: ContactUploadColumnMappingSchema,
  rowCount: z.number(),
  matchedCount: z.number(),
  newCount: z.number(),
  needsInputCount: z.number(),
  skippedCount: z.number(),
  invalidCount: z.number(),
  updatedCount: z.number(),
  unchangedCount: z.number(),
  completedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
})
export type ContactUpload = z.infer<typeof ContactUploadSchema>

export const ListContactUploadsResponseSchema = z.object({
  uploads: z.array(ContactUploadSchema),
})
export type ListContactUploadsResponse = z.infer<
  typeof ListContactUploadsResponseSchema
>

export const ContactUploadCandidateSchema = z.object({
  personId: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  zip: z.string().nullable(),
  age: z.number().nullable(),
})
export type ContactUploadCandidate = z.infer<
  typeof ContactUploadCandidateSchema
>

export const ContactUploadRowSchema = z.object({
  id: z.string(),
  rowIndex: z.number(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  cellPhone: z.string().nullable(),
  landline: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  zip: z.string().nullable(),
  outcome: ContactUploadMatchOutcomeSchema,
  personId: z.string().nullable(),
  isNewPerson: z.boolean(),
  changedFields: z.array(z.string()),
  // Filled only for rows that need input: the people the user can pick from.
  candidates: z.array(ContactUploadCandidateSchema),
  suggestedPersonId: z.string().nullable(),
})
export type ContactUploadRow = z.infer<typeof ContactUploadRowSchema>

export const ListContactUploadRowsQuerySchema = z.object({
  outcome: z
    .enum(['needs_input', 'processed', 'skipped', 'invalid'])
    .default('processed'),
  search: z.string().trim().max(200).optional(),
  cursor: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
})
export type ListContactUploadRowsQuery = z.input<
  typeof ListContactUploadRowsQuerySchema
>

export const ListContactUploadRowsResponseSchema = z.object({
  rows: z.array(ContactUploadRowSchema),
  nextCursor: z.number().nullable(),
  total: z.number(),
})
export type ListContactUploadRowsResponse = z.infer<
  typeof ListContactUploadRowsResponseSchema
>

export const SetContactUploadRowMatchSchema = z.union([
  z.object({ personId: z.string().uuid() }),
  z.object({ newPerson: z.literal(true) }),
  z.object({ skip: z.literal(true) }),
])
export type SetContactUploadRowMatch = z.infer<
  typeof SetContactUploadRowMatchSchema
>

export const AcceptSuggestedMatchesResponseSchema = z.object({
  accepted: z.number(),
  upload: ContactUploadSchema,
})
export type AcceptSuggestedMatchesResponse = z.infer<
  typeof AcceptSuggestedMatchesResponseSchema
>

export const ContactFieldSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('constituent_file') }),
  z.object({
    kind: z.literal('upload'),
    uploadId: z.string(),
    uploadName: z.string(),
    uploadedAt: z.string(),
  }),
])
export type ContactFieldSource = z.infer<typeof ContactFieldSourceSchema>

// Where each contact detail on the person panel came from, plus the upload
// rows pointing at this person (for Change match).
export const ContactSourcesResponseSchema = z.object({
  fields: z.object({
    email: ContactFieldSourceSchema.nullable(),
    cellPhone: ContactFieldSourceSchema.nullable(),
    landline: ContactFieldSourceSchema.nullable(),
    address: ContactFieldSourceSchema.nullable(),
  }),
  uploadRows: z.array(
    z.object({
      rowId: z.string(),
      uploadId: z.string(),
      uploadName: z.string(),
      uploadedAt: z.string(),
    }),
  ),
  // Notes, statuses, interactions or outreach recorded against this person:
  // Change match does not carry them to the new person.
  hasActivity: z.boolean(),
})
export type ContactSourcesResponse = z.infer<
  typeof ContactSourcesResponseSchema
>
