import { z } from 'zod'

// The recorded/uploaded robocall message is stored in S3 (bucket
// ROBOCALL_AUDIO_BUCKET). The browser uploads the audio directly via a presigned
// POST, so these are the shapes for POST /outreach/robocall/audio/presign.

// Containers the in-browser recorder emits (webm/mp4/ogg) plus the formats the
// upload picker accepts (mp3/wav/m4a). The server pins Content-Type on the
// presigned POST policy from this value, so it must match what the client
// uploads. Every type here must also be transcribable — the compliance gate's
// MEDIA_FORMAT_BY_MIME must map each one, so keep the two lists in sync (raw
// audio/aac is excluded: it isn't an AWS Transcribe MediaFormat).
export const ROBOCALL_AUDIO_ALLOWED_MIME_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/x-m4a',
] as const

// A robocall recording is capped at 60s; even a 60s uncompressed stereo WAV
// stays under this. It's the hard ceiling S3 enforces on the upload via the
// presigned POST's content-length-range condition, so an oversize upload is
// rejected at upload time, not deferred to a later check.
export const ROBOCALL_AUDIO_MAX_BYTES = 15 * 1024 * 1024

// contentType is the only input; it's pinned as an exact condition on the
// presigned POST so the browser can't upload a different type than requested.
export const RobocallAudioPresignRequestSchema = z.object({
  contentType: z.enum(ROBOCALL_AUDIO_ALLOWED_MIME_TYPES),
})
export type RobocallAudioPresignRequest = z.infer<
  typeof RobocallAudioPresignRequestSchema
>

// A presigned S3 POST (not PUT): S3 enforces the size cap and content type via
// the policy, which a presigned PUT URL can't express. The browser POSTs a
// multipart form of `fields` plus the file to `url`.
export const RobocallAudioPresignResponseSchema = z.object({
  url: z.string(),
  fields: z.record(z.string(), z.string()),
  // The object key to persist against the send once upload completes.
  key: z.string(),
  // Seconds the presigned POST stays valid.
  expiresIn: z.number().int().positive(),
})
export type RobocallAudioPresignResponse = z.infer<
  typeof RobocallAudioPresignResponseSchema
>
