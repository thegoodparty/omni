import { z } from 'zod'

// CallHub audio formats accepted by /v1/media/upload/ (mp3/wav/ogg), ≤40 min.
export const CALLHUB_MEDIA_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
] as const

// The upload response carries the uploaded file's id + a playback URL. The id
// is kept as a STRING: CallHub ids exceed JS's safe-integer range (a phonebook
// came back as 3966566468442653936), so a numeric parse would corrupt it.
const MediaBodySchema = z.object({
  media_file_id: z.coerce.string(),
  media_url: z.string().nullish(),
})

// The docs show the fields under a `data` wrapper, but that's unconfirmed —
// accept both a flat body and a `{ data: ... }` envelope, unwrapping to the
// inner shape. Confirm against a live upload before relying on it.
export const CreateMediaResponseSchema = z.union([
  MediaBodySchema,
  z.object({ data: MediaBodySchema }).transform((o) => o.data),
])
export type CreateMediaResponse = z.infer<typeof CreateMediaResponseSchema>
