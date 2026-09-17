import { z } from 'zod'

// CallHub audio formats accepted by /v1/media/upload/ (mp3/wav/ogg), ≤40 min.
export const CALLHUB_MEDIA_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
] as const

// The upload response carries the uploaded file's id + a playback URL under a
// `data` wrapper (confirmed live). The id is kept as a STRING: CallHub ids
// exceed JS's safe-integer range (a live upload returned 3971671023417296254),
// so a numeric parse would corrupt it.
const MediaBodySchema = z.object({
  media_file_id: z.coerce.string(),
  media_url: z.string().nullish(),
})

export const CreateMediaResponseSchema = z
  .object({ data: MediaBodySchema })
  .transform((o) => o.data)
export type CreateMediaResponse = z.infer<typeof CreateMediaResponseSchema>
