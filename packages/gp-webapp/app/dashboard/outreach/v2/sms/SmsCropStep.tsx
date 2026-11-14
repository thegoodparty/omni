'use client'

import { useEffect, useRef, useState } from 'react'
import ReactCrop from 'react-image-crop'
import type { PixelCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import {
  clampCropToPhoneRatio,
  cropImageFile,
  defaultCrop,
  type CropBox,
} from './smsCrop.util'

interface SmsCropStepProps {
  file: File
  onCropReady: (file: File | null) => void
}

const toPixelCrop = (box: CropBox): PixelCrop => ({ ...box, unit: 'px' })

export const SmsCropStep = ({ file, onCropReady }: SmsCropStepProps) => {
  const imgRef = useRef<HTMLImageElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [crop, setCrop] = useState<PixelCrop>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  const apply = async (box: CropBox) => {
    const image = imgRef.current
    if (!image || box.width <= 0 || box.height <= 0) return
    const cropped = await cropImageFile(file, image, box)
    setFailed(cropped === null)
    onCropReady(cropped)
  }

  const handleLoad = () => {
    const image = imgRef.current
    if (!image) return
    const initial = toPixelCrop(defaultCrop(image.width, image.height))
    setCrop(initial)
    void apply(initial)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Drag the box to choose the part voters see on their phone.
      </p>
      {url ? (
        <ReactCrop
          crop={crop}
          onChange={(pixels) => setCrop(clampCropToPhoneRatio(pixels))}
          onComplete={(pixels) => void apply(pixels)}
          keepSelection
          className="self-center"
        >
          <img
            ref={imgRef}
            src={url}
            alt="Your image to crop"
            onLoad={handleLoad}
            className="max-h-[60vh] w-auto max-w-full"
          />
        </ReactCrop>
      ) : null}
      {failed ? (
        <p className="text-xs text-destructive" role="alert">
          We couldn&apos;t crop that image. Go back and choose another.
        </p>
      ) : null}
    </div>
  )
}
