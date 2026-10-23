'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useMutation } from '@tanstack/react-query'
import imageCompression from 'browser-image-compression'
import { cn } from '@styleguide'
import {
  ImageIcon,
  Loader2Icon,
  XMarkIcon,
} from '@styleguide/components/ui/icons'
import { uploadFileToS3 } from '@shared/utils/s3Upload'
import { apiRoutes } from 'gpApi/routes'
import { SERVE_POLL_QUESTION_COPY } from './pollCopy'

const IMAGE_TYPES = ['image/png', 'image/jpeg']
const MAX_SIZE_KB = 500

interface PollImageDropzoneProps {
  imageUrl: string | undefined
  onImageChange: (imageUrl: string | undefined) => void
}

// The SMS compose step's dropzone and preview, uploading the way the legacy
// poll upload did: straight to S3, compressed, because the poll create takes
// an uploaded imageUrl rather than a file.
export const PollImageDropzone = ({
  imageUrl,
  onImageChange,
}: PollImageDropzoneProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const downsized = await imageCompression(file, {
        maxSizeMB: MAX_SIZE_KB / 1024,
        useWebWorker: true,
      })
      return uploadFileToS3(downsized, apiRoutes.polls.imageUploadUrl)
    },
    onSuccess: (url) => onImageChange(url),
    onError: () => setError(SERVE_POLL_QUESTION_COPY.imageUploadError),
  })

  const handleFile = (file: File | undefined) => {
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) {
      setError(SERVE_POLL_QUESTION_COPY.imageTypeError)
      return
    }
    setError(null)
    upload.mutate(file)
  }

  return (
    <div className="mb-4 space-y-2">
      {imageUrl ? (
        <div className="relative">
          <Image
            src={imageUrl}
            alt="Poll image preview"
            width={800}
            height={450}
            className="max-h-56 w-full rounded-xl border border-border object-cover"
          />
          <button
            type="button"
            aria-label="Remove image"
            onClick={() => onImageChange(undefined)}
            className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-foreground/80 text-background hover:bg-foreground"
          >
            <XMarkIcon className="size-3.5" />
          </button>
        </div>
      ) : (
        // globals.css forces flex-row on data-slot-less flex buttons (legacy
        // link/button normalization); the slot opts out so the dropzone
        // stacks like the SMS one.
        <button
          type="button"
          data-slot="poll-image-dropzone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            handleFile(e.dataTransfer.files[0])
          }}
          disabled={upload.isPending}
          aria-invalid={error !== null || undefined}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-10 transition-colors hover:border-primary/50 hover:bg-muted disabled:cursor-wait',
            error && 'border-destructive',
          )}
        >
          {upload.isPending ? (
            <>
              <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {SERVE_POLL_QUESTION_COPY.imageUploading}
              </span>
            </>
          ) : (
            <>
              <ImageIcon className="size-6 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {SERVE_POLL_QUESTION_COPY.imageTitle}
              </span>
              <span className="text-xs text-muted-foreground">
                {SERVE_POLL_QUESTION_COPY.imageHint}
              </span>
            </>
          )}
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
