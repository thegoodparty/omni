import { z } from 'zod'

// A dated note against a person record (Feature 3 of the CRM TDD). `personId`
// is the opaque people-api Voter.id — gp-api never validates it against
// people-api, so a note can outlive that voter's record in the L2 refresh.
export const ContactNoteSchema = z.object({
  id: z.string(),
  personId: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ContactNote = z.infer<typeof ContactNoteSchema>

// Shared by create and edit: both accept only the note body.
export const ContactNoteInputSchema = z.object({
  body: z.string().min(1).max(10_000),
})

export type ContactNoteInput = z.infer<typeof ContactNoteInputSchema>

export const ContactNoteListResponseSchema = z.object({
  results: z.array(ContactNoteSchema),
})

export type ContactNoteListResponse = z.infer<
  typeof ContactNoteListResponseSchema
>
