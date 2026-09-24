import { TURF_COLORS } from './turfQueries'

// Sibling-aware default color for a new turf: the first palette slot the
// campaign's siblings do not already carry. Once every slot is spoken for
// the palette wraps by count, so a candidate cutting a ninth turf gets
// `TURF_COLORS[0]` again rather than a disabled control — the design memo's
// "sequential auto-palette" (NGP VAN reference), plus the papercut it names
// for a picker at creation ("everyone picks purple"): the wrap has to keep
// producing a different hue instead of settling on the last one used.
//
// Case-insensitive on the way in: the palette is lowercase but a saved row
// could have been stored uppercase by an older client, and two turfs with
// `#7C3AED` and `#7c3aed` are the same colour to the canvas — treating
// them as different would let the assigner return a "new" hue that already
// paints a sibling next to it.
export const assignNextColor = (existingColors: string[]): string => {
  const used = new Set(existingColors.map((color) => color.toLowerCase()))
  const unused = TURF_COLORS.find((color) => !used.has(color))
  if (unused) return unused
  return TURF_COLORS[existingColors.length % TURF_COLORS.length] as string
}
