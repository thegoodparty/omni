import { MAX_TALL_RATIO, MAX_WIDE_RATIO } from '@goodparty_org/contracts'
import { IMAGE_MAX_BYTES } from './smsCompose.util'

export type CropBox = {
  x: number
  y: number
  width: number
  height: number
}

const CROP_SCALES = [1, 0.75, 0.5]
const CROP_QUALITIES = [0.9, 0.75, 0.5]

export const clampCropToPhoneRatio = <T extends CropBox>(crop: T): T => {
  if (crop.width <= 0 || crop.height <= 0) return crop
  const ratio = crop.width / crop.height
  if (ratio > MAX_WIDE_RATIO) {
    return { ...crop, width: crop.height * MAX_WIDE_RATIO }
  }
  if (ratio < MAX_TALL_RATIO) {
    return { ...crop, height: crop.width / MAX_TALL_RATIO }
  }
  return crop
}

// Opens inset so the dimmed edge shows what the crop will cut.
const DEFAULT_CROP_SCALE = 0.8

export const defaultCrop = (width: number, height: number): CropBox => {
  const fitted = clampCropToPhoneRatio({ x: 0, y: 0, width, height })
  const boxWidth = fitted.width * DEFAULT_CROP_SCALE
  const boxHeight = fitted.height * DEFAULT_CROP_SCALE
  return {
    x: (width - boxWidth) / 2,
    y: (height - boxHeight) / 2,
    width: boxWidth,
    height: boxHeight,
  }
}

export const coversWholeImage = (
  crop: CropBox,
  width: number,
  height: number,
): boolean =>
  Math.round(crop.x) <= 0 &&
  Math.round(crop.y) <= 0 &&
  Math.round(crop.width) >= width &&
  Math.round(crop.height) >= height

// Rounding to whole pixels can push a box clamped to exactly 2:1 just past it,
// which would trip the preview's crop warning. Floor into the range instead.
export const fitPixelsToPhoneRatio = (width: number, height: number) => {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  return {
    width: Math.max(1, Math.min(w, Math.floor(h * MAX_WIDE_RATIO))),
    height: Math.max(1, Math.min(h, Math.floor(w / MAX_TALL_RATIO))),
  }
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )

// The crop is in the image's natural pixels. The result is a JPEG redrawn
// until it fits the MMS cap, so null only when even the smallest redraw is
// over it.
export const cropImageFile = async (
  file: File,
  image: HTMLImageElement,
  crop: CropBox,
): Promise<File | null> => {
  if (coversWholeImage(crop, image.naturalWidth, image.naturalHeight)) {
    return file
  }
  const { width: sourceWidth, height: sourceHeight } = fitPixelsToPhoneRatio(
    crop.width,
    crop.height,
  )
  for (const scale of CROP_SCALES) {
    const canvas = document.createElement('canvas')
    const size = fitPixelsToPhoneRatio(
      sourceWidth * scale,
      sourceHeight * scale,
    )
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(
      image,
      crop.x,
      crop.y,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    for (const quality of CROP_QUALITIES) {
      const blob = await toBlob(canvas, quality)
      if (blob && blob.size <= IMAGE_MAX_BYTES) {
        const name = file.name.replace(/\.[^.]+$/, '') || 'image'
        return new File([blob], `${name}.jpeg`, { type: 'image/jpeg' })
      }
    }
  }
  return null
}
