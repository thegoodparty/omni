import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { vendorBaseUrl } from 'src/shared/util/appEnvironment.util'
import {
  recordGeoapifyCall,
  recordGeoapifyCredits,
} from '../observability/geoapify.metrics'
import {
  ReverseGeocodeResponseSchema,
  type ReverseGeocodeResult,
} from '../schemas/geoapify.schema'

const REVERSE_TIMEOUT_MS = 10_000

// The fields a neighborhood is read from, most specific first.
const NEIGHBORHOOD_FIELDS = [
  'neighbourhood',
  'suburb',
  'quarter',
  'district',
] as const

const same = (a: string, b: string | undefined) =>
  b !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase()

// The first neighborhood field present that is not just the city, the
// county or the road the point sits on. Null when the result names only
// those.
export const neighborhoodOf = (result: ReverseGeocodeResult): string | null => {
  for (const field of NEIGHBORHOOD_FIELDS) {
    const value = result[field]?.trim()
    if (!value) continue
    if (same(value, result.city) || same(value, result.county)) continue
    if (same(value, result.street)) continue
    return value
  }
  return null
}

@Injectable()
export class GeoapifyReverseGeocodeService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(this.constructor.name)
  }

  // The neighborhood at a point: `found` with null when Geoapify answered
  // with no neighborhood (a road-only result), `failed` when the call did
  // not complete, so the caller can try again another time. One credit per
  // call.
  async neighborhoodAt(point: {
    lat: number
    lng: number
  }): Promise<{ status: 'found'; name: string | null } | { status: 'failed' }> {
    const key = process.env.GEOAPIFY_API_KEY
    if (!key) {
      this.logger.warn('GEOAPIFY_API_KEY is not configured; no tract names')
      return { status: 'failed' }
    }
    const url = new URL(
      `${vendorBaseUrl('geoapify', 'https://api.geoapify.com')}/v1/geocode/reverse`,
    )
    url.searchParams.set('lat', String(point.lat))
    url.searchParams.set('lon', String(point.lng))
    url.searchParams.set('format', 'json')
    url.searchParams.set('apiKey', key)

    let body: unknown
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REVERSE_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new Error(`Reverse geocoding answered ${response.status}`)
      }
      body = await response.json()
    } catch (error) {
      recordGeoapifyCall('reverse_geocode', 'failed')
      // Never log the error object: the request URL carries ?apiKey=<key>.
      this.logger.warn(
        { message: error instanceof Error ? error.message : String(error) },
        'Geoapify reverse geocoding failed',
      )
      return { status: 'failed' }
    }
    recordGeoapifyCall('reverse_geocode', 'success')
    recordGeoapifyCredits('reverse_geocode', 1)

    const parsed = ReverseGeocodeResponseSchema.safeParse(body)
    if (!parsed.success) {
      this.logger.warn(
        { err: parsed.error },
        'Geoapify reverse geocoding response failed schema validation',
      )
      return { status: 'found', name: null }
    }
    const [first] = parsed.data.results
    return { status: 'found', name: first ? neighborhoodOf(first) : null }
  }
}
