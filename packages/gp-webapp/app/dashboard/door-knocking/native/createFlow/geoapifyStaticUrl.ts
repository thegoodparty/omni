import { NEXT_PUBLIC_GEOAPIFY_TILES_KEY } from 'appEnv'

// Geoapify static-map URL for the district preview on the draw step. Framed
// to the pack's bounding box (packBounds); no polygon overlay because the
// voter pack doesn't carry a district geometry field today. Rendered at 2x
// so the PNG stays crisp on retina.
//
// One HTTP GET per open, no MapLibre chunk cost. Uses the same
// NEXT_PUBLIC_GEOAPIFY_TILES_KEY the live map's tiles already read.
export const geoapifyStaticUrl = ({
  bounds,
  width,
  height,
}: {
  bounds: [[number, number], [number, number]]
  width: number
  height: number
}): string => {
  const [[minLng, minLat], [maxLng, maxLat]] = bounds
  const params = new URLSearchParams({
    style: 'osm-liberty',
    width: String(width * 2),
    height: String(height * 2),
    area: `rect:${minLng},${minLat},${maxLng},${maxLat}`,
    apiKey: NEXT_PUBLIC_GEOAPIFY_TILES_KEY,
  })
  return `https://maps.geoapify.com/v1/staticmap?${params.toString()}`
}
