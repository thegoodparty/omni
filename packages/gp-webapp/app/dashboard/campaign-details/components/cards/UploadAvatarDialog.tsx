'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@styleguide'
import { ImageIcon, X } from 'lucide-react'
import { apiRoutes } from 'gpApi/routes'
import { clientFetch } from 'gpApi/clientFetch'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'

const MAX_FILE_SIZE = 5 * 1000 * 1000 // 5MB

interface UploadAvatarResponse {
  avatar?: string
}

interface UploadAvatarDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentImage?: string | null
  // Called with the new avatar URL after a successful upload.
  onSave: (avatarUrl: string) => void
}

export default function UploadAvatarDialog({
  open,
  onOpenChange,
  currentImage,
  onSave,
}: UploadAvatarDialogProps): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPreview(currentImage ?? null)
      setFile(null)
      setError(null)
    }
  }, [open, currentImage])

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_FILE_SIZE) {
      setError(`Max file size allowed: ${MAX_FILE_SIZE / 1000 / 1000}MB`)
      return
    }
    setError(null)
    setFile(f)
    const reader = new FileReader()
    reader.onload = (ev) => setPreview(ev.target?.result as string)
    reader.readAsDataURL(f)
  }

  const removeImage = (): void => {
    setPreview(null)
    setFile(null)
  }

  const handleSave = async (): Promise<void> => {
    if (!file) {
      onOpenChange(false)
      return
    }
    trackEvent(EVENTS.Settings.PersonalInfo.ClickUpload)
    setSaving(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file, file.name)
      const resp = await clientFetch<UploadAvatarResponse>(
        apiRoutes.user.uploadAvatar,
        formData,
        { revalidate: 3600 },
      )
      if (resp.data?.avatar) {
        onSave(resp.data.avatar)
        onOpenChange(false)
      } else {
        setError('Upload failed. Please try again.')
      }
    } catch {
      setError('Upload failed. Please try again.')
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Image</DialogTitle>
          <DialogDescription>
            Accepted file types: JPG, PNG or GIF.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {preview ? (
            <div className="relative mx-auto w-[200px]">
              <button
                type="button"
                onClick={removeImage}
                aria-label="Remove image"
                className="absolute right-2 top-2 z-10 flex size-9 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
              >
                <X className="size-5" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Avatar preview"
                className="h-[200px] w-full rounded-lg object-cover"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border px-4 py-8 transition-colors hover:bg-muted/30"
            >
              <ImageIcon className="size-6 text-foreground" />
              <p className="m-0 font-medium text-foreground">
                Click to add image
              </p>
              <p className="m-0 text-center text-sm text-muted-foreground">
                We recommend using a photo of yourself for credibility and
                legitimacy.
              </p>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleSelect}
          />
        </div>

        {error && <p className="m-0 text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={saving}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
