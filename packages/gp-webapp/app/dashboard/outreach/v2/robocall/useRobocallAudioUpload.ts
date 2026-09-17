'use client'

import { useCallback, useState } from 'react'
import { ROBOCALL_AUDIO_ALLOWED_MIME_TYPES } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'

type AllowedMime = (typeof ROBOCALL_AUDIO_ALLOWED_MIME_TYPES)[number]

// MediaRecorder reports types like 'audio/webm;codecs=opus'; strip the codecs
// suffix and confirm the container is one the presign endpoint accepts.
const normalizeMime = (blobType: string): AllowedMime | null => {
  const base = (blobType.split(';')[0] ?? '').trim().toLowerCase()
  const allowed: readonly string[] = ROBOCALL_AUDIO_ALLOWED_MIME_TYPES
  return allowed.includes(base) ? (base as AllowedMime) : null
}

export interface RobocallAudioUpload {
  // Uploads the blob to S3 via a presigned POST; resolves the stored object
  // key + the content type it was uploaded with on success (so the caller can
  // chain the compliance check without a stale-state read), or null on failure
  // (with `error` set).
  uploadAudio: (
    blob: Blob,
  ) => Promise<{ key: string; contentType: AllowedMime } | null>
  isUploading: boolean
  error: string | null
  key: string | null
  // The normalized MIME the object was uploaded with, held so the compliance
  // check can declare the same content type. Set alongside `key` on success.
  contentType: AllowedMime | null
  reset: () => void
}

export const useRobocallAudioUpload = (): RobocallAudioUpload => {
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)
  const [contentType, setContentType] = useState<AllowedMime | null>(null)

  const reset = useCallback(() => {
    setIsUploading(false)
    setError(null)
    setKey(null)
    setContentType(null)
  }, [])

  const uploadAudio = useCallback(async (blob: Blob) => {
    setError(null)
    const mime = normalizeMime(blob.type)
    if (!mime) {
      setError("We couldn't read that audio format. Try re-recording.")
      return null
    }
    setIsUploading(true)
    try {
      const { data } = await clientRequest(
        'POST /v1/outreach/robocall/audio/presign',
        { contentType: mime },
      )
      // S3 presigned POST: submit the policy fields, then the file last.
      const form = new FormData()
      Object.entries(data.fields).forEach(([k, v]) => form.append(k, v))
      form.append('file', blob)
      const res = await fetch(data.url, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`)
      setKey(data.key)
      setContentType(mime)
      return { key: data.key, contentType: mime }
    } catch {
      setError("We couldn't upload your recording. Try again.")
      return null
    } finally {
      setIsUploading(false)
    }
  }, [])

  return { uploadAudio, isUploading, error, key, contentType, reset }
}
