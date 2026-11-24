import maplibregl from 'maplibre-gl'
import { reportClientError } from '@shared/observability/reportClientError'

// What a surface shows in the map's place on a machine that cannot draw one.
export const MAP_UNAVAILABLE_MESSAGE =
  'The map could not be drawn on this device. Turn on hardware acceleration in your browser settings to see it.'

// A map is an enhancement, so a browser that cannot make a WebGL context should
// cost the map and not the page. maplibre creates the context in its
// constructor and `_setupPainter` throws when the browser refuses one — a GPU
// path that is turned off, sandboxed or has crashed. Started from an effect,
// that throw happens in React's commit phase, so the nearest error boundary
// takes it: on Voter Data the whole civic panel list page became "Something
// went wrong loading this page" and Try again threw again (ENG-11720).
//
// Every surface that builds a map comes through here, so that answer lives in
// one place instead of four optimistic `new maplibregl.Map()` calls. Null means
// "draw the fallback instead". The error is still reported, because catching it
// also keeps it away from Faro's global handler, and how many machines lose the
// map is the number that says whether this is worth more work.
export const createMap = (
  options: maplibregl.MapOptions,
  surface: string,
): maplibregl.Map | null => {
  try {
    return new maplibregl.Map(options)
  } catch (error) {
    reportClientError(error, { mapSurface: surface })
    return null
  }
}
