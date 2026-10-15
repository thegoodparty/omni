// A received MMS on iOS shows at a fixed width with its height following the
// image, but only between these ratios; past them the phone crops the image.
export const MAX_WIDE_RATIO = 2
export const MAX_TALL_RATIO = 1 / 2

export type ImageAspectWarning = 'tall' | 'wide'

export const getImageAspectWarning = (
  width: number,
  height: number
): ImageAspectWarning | null => {
  if (width <= 0 || height <= 0) return null
  const ratio = width / height
  if (ratio > MAX_WIDE_RATIO) return 'wide'
  if (ratio < MAX_TALL_RATIO) return 'tall'
  return null
}
