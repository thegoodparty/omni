import { z } from 'zod'

// The recorded/uploaded robocall message is stored in S3 (bucket
// ROBOCALL_AUDIO_BUCKET). The browser PUTs the audio directly via a presigned
// URL, so these are the shapes for POST /outreach/robocall/audio/presign.

// Containers the in-browser recorder emits (webm/mp4/ogg) plus the formats the
// upload picker accepts (mp3/wav/m4a/aac). The server sets ContentType on the
// presigned PUT from this value, so it must match what the client uploads.
export const ROBOCALL_AUDIO_ALLOWED_MIME_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/x-m4a',
] as const

// Only contentType is on the request: it becomes a signed header on the
// presigned PUT, so S3 rejects a mismatched upload. Size/duration are enforced
// client-side (60s cap) and re-checked server-side via headObject when the key
// is persisted at ingest — a byte count on the request would sign nothing and
// read as a control it isn't.
export const RobocallAudioPresignRequestSchema = z.object({
  contentType: z.enum(ROBOCALL_AUDIO_ALLOWED_MIME_TYPES),
})
export type RobocallAudioPresignRequest = z.infer<
  typeof RobocallAudioPresignRequestSchema
>

export const RobocallAudioPresignResponseSchema = z.object({
  // Presigned S3 PUT URL the browser uploads the audio to.
  uploadUrl: z.string(),
  // The object key to persist against the send once upload completes.
  key: z.string(),
  // Seconds the presigned URL stays valid.
  expiresIn: z.number().int().positive(),
})
export type RobocallAudioPresignResponse = z.infer<
  typeof RobocallAudioPresignResponseSchema
>
