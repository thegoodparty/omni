'use client'

import { type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { Button, Label } from '@goodparty_org/styleguide'

type ImageUploadFieldProps = {
  label: string
  buttonLabel: string
  /** Preview node (cover strip, avatar circle, etc.). */
  preview: ReactNode
}

// GAP: no image/cover/avatar upload control in styleguide.
export const ImageUploadField = ({
  label,
  buttonLabel,
  preview,
}: ImageUploadFieldProps) => (
  <div className="space-y-2">
    <Label>{label}</Label>
    {preview}
    <Button variant="neutral" size="small">
      <Upload className="size-4" />
      {buttonLabel}
    </Button>
  </div>
)
