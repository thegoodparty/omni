import { z } from 'zod'

// CallHub phonebook (the audience container). Its `id` exceeds JS's
// safe-integer range, so we read the string `pk_str` and never the numeric
// `id` (which JSON.parse would already have corrupted). Verified live: a
// phonebook came back as id 3966566468442653936 with pk_str alongside.
// The response's `count` is deliberately NOT modeled: it's a hyperlinked
// `.../numbers_count` sub-resource URL (a string), not an integer, so the
// contact count is fetched from that URL when the send chain polls load.
export const CallhubPhonebookSchema = z.object({
  pk_str: z.string(),
  name: z.string(),
  description: z.string().nullish(),
})
export type CallhubPhonebook = z.infer<typeof CallhubPhonebookSchema>

export const PhonebookPageSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(CallhubPhonebookSchema),
})
export type PhonebookPage = z.infer<typeof PhonebookPageSchema>

// The `.../numbers_count` sub-resource the phonebook's hyperlinked `count`
// field points at. Verified live: it returns loaded-contact counts split by
// number kind — `phonenumber_count` is the calling-number (landline/robocall)
// tally a bulk import fills, `mobilenumber_count` the texting-number tally.
export const PhonebookNumbersCountSchema = z.object({
  phonenumber_count: z.number(),
  mobilenumber_count: z.number().nullish(),
})
export type PhonebookNumbersCount = z.infer<typeof PhonebookNumbersCountSchema>
