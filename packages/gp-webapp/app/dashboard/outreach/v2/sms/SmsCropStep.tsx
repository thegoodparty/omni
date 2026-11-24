'use client'

import { useEffect, useRef, useState } from 'react'
import { Cropper } from 'react-advanced-cropper'
import type { CropperRef, CropperState } from 'react-advanced-cropper'
import 'react-advanced-cropper/dist/style.css'
import 'react-advanced-cropper/dist/themes/corners.css'
import { MAX_TALL_RATIO, MAX_WIDE_RATIO } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { CheckIcon, CropIcon } from '@styleguide/components/ui/icons'
import {
  clampCropToPhoneRatio,
  cropImageFile,
  defaultCrop,
  type CropBox,
} from './smsCrop.util'

interface SmsCropStepProps {
  file: File
  // The box chosen last time, so Back from the preview reopens on it.
  initialCrop?: CropBox | null
  onCropChange?: (crop: CropBox) => void
  onCropReady: (file: File | null) => void
  onRemove: () => void
}

const PHONE_RATIO_RANGE = { minimum: MAX_TALL_RATIO, maximum: MAX_WIDE_RATIO }

const ALL_HANDLERS = {
  westNorth: true,
  eastNorth: true,
  westSouth: true,
  eastSouth: true,
  north: true,
  south: true,
  west: true,
  east: true,
}
const NO_HANDLERS = {
  westNorth: false,
  eastNorth: false,
  westSouth: false,
  eastSouth: false,
  north: false,
  south: false,
  west: false,
  east: false,
}
const ALL_LINES = { north: true, south: true, west: true, east: true }
const NO_LINES = { north: false, south: false, west: false, east: false }

export const SmsCropStep = ({
  file,
  initialCrop,
  onCropChange,
  onCropReady,
  onRemove,
}: SmsCropStepProps) => {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Corners show only while cropping, so the image reads as the image.
  const [editing, setEditing] = useState(false)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const latestApply = useRef(0)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  // The cropper draws its own copy; this one is the full-size source the
  // file is cut from, so a re-crop never compounds.
  const sourceImage = async (): Promise<HTMLImageElement | null> => {
    if (imageRef.current?.src === url && imageRef.current.complete) {
      return imageRef.current
    }
    if (!url) return null
    const image = new Image()
    image.src = url
    try {
      await image.decode()
    } catch {
      return null
    }
    imageRef.current = image
    return image
  }

  const apply = async (cropper: CropperRef) => {
    const coordinates = cropper.getCoordinates()
    if (!coordinates || coordinates.width <= 0 || coordinates.height <= 0) {
      return
    }
    const box: CropBox = clampCropToPhoneRatio({
      x: coordinates.left,
      y: coordinates.top,
      width: coordinates.width,
      height: coordinates.height,
    })
    const token = ++latestApply.current
    onCropChange?.(box)
    onCropReady(null)
    const image = await sourceImage()
    const cropped = image ? await cropImageFile(file, image, box) : null
    if (token !== latestApply.current) return
    setFailed(cropped === null)
    onCropReady(cropped)
  }

  if (!url) return null

  return (
    <div className="flex flex-col gap-2">
      <Cropper
        src={url}
        className="h-80 max-h-[60vh] rounded-xl"
        stencilProps={{
          aspectRatio: PHONE_RATIO_RANGE,
          grid: editing,
          movable: editing,
          resizable: editing,
          handlers: editing ? ALL_HANDLERS : NO_HANDLERS,
          lines: editing ? ALL_LINES : NO_LINES,
          // White corners need an edge to read on a white image.
          handlerClassNames: { default: 'drop-shadow-md' },
        }}
        backgroundWrapperProps={{ scaleImage: false, moveImage: false }}
        defaultCoordinates={({ imageSize }: CropperState) => {
          const box =
            initialCrop ?? defaultCrop(imageSize.width, imageSize.height)
          return {
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
          }
        }}
        onReady={(cropper) => void apply(cropper)}
        onInteractionEnd={(cropper) => void apply(cropper)}
      />
      {/* One bar for everything that changes the image. */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="small"
          variant="ghost"
          icon={editing ? <CheckIcon /> : <CropIcon />}
          onClick={() => setEditing((on) => !on)}
        >
          {editing ? 'Done' : 'Crop'}
        </Button>
        <Button type="button" size="small" variant="ghost" onClick={onRemove}>
          Remove image
        </Button>
      </div>
      {editing ? (
        <p className="text-xs text-muted-foreground">
          Drag the corners to choose what voters see.
        </p>
      ) : null}
      {failed ? (
        <p className="text-xs text-destructive" role="alert">
          We couldn&apos;t crop that image. Choose another.
        </p>
      ) : null}
    </div>
  )
}
