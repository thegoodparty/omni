import { z } from 'zod'

// A CallFire contact list is the audience container a voice broadcast dials.
// One is created per send by uploading a CSV, then attached to the broadcast.
// Validation is ASYNCHRONOUS: the upload returns immediately with a list id,
// and CallFire parses/validates the rows in the background — a later slice must
// wait for a terminal status (or the ContactList `validationFinished` /
// `validationFailed` webhook) before the list is safe to dial.
//
// CallFire ids are int64. In practice they sit well inside JS's safe-integer
// range (small, account-scoped sequences, unlike CallHub's giant pk_str), so
// we read the wire value as a number and expose it as a STRING handle at our
// boundary — never doing math on it — per the string-id convention.
export const CALLFIRE_CONTACT_LIST_STATUS = {
  ACTIVE: 'ACTIVE',
  VALIDATING: 'VALIDATING',
  IMPORTING: 'IMPORTING',
  IMPORT_FAILED: 'IMPORT_FAILED',
  ERRORS: 'ERRORS',
  DELETED: 'DELETED',
  PARSE_FAILED: 'PARSE_FAILED',
  COLUMN_TOO_LARGE: 'COLUMN_TOO_LARGE',
} as const

export type CallfireContactListStatus =
  (typeof CALLFIRE_CONTACT_LIST_STATUS)[keyof typeof CALLFIRE_CONTACT_LIST_STATUS]

// The list is safe to dial only in ACTIVE; the two FAILED states and
// PARSE_FAILED are terminal failures a poller stops on. VALIDATING / IMPORTING
// are the still-working states. ERRORS means some rows were rejected but the
// list is usable, and COLUMN_TOO_LARGE is a malformed-CSV terminal failure.
export const CALLFIRE_CONTACT_LIST_TERMINAL_FAILURES: readonly string[] = [
  CALLFIRE_CONTACT_LIST_STATUS.IMPORT_FAILED,
  CALLFIRE_CONTACT_LIST_STATUS.PARSE_FAILED,
  CALLFIRE_CONTACT_LIST_STATUS.COLUMN_TOO_LARGE,
]

// POST /contacts/lists/upload returns a bare ResourceId — just the new list id.
export const ResourceIdSchema = z.object({
  id: z.number(),
})
export type ResourceId = z.infer<typeof ResourceIdSchema>

// GET /contacts/lists/{id}. CallFire returns more (fields, etc.); z.object
// strips them. `status` is the async-validation gate; `size` is the validated
// row count. Optional fields are nullish — a freshly uploaded list may omit
// size/status until parsing starts.
export const ContactListSchema = z.object({
  id: z.number(),
  name: z.string().nullish(),
  size: z.number().nullish(),
  status: z.string().nullish(),
})
export type ContactList = z.infer<typeof ContactListSchema>
