import { queryOptions } from '@tanstack/react-query'
import type { GeoJsonPolygon } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import type { VoterFileBackendFilters } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { readableInkOnHex } from './statusPresentation'

export const savedListsQueryOptions = queryOptions({
  queryKey: ['door-knocking-saved-lists'],
  queryFn: () =>
    clientRequest('GET /v1/voters/voter-file/filters', {}).then(
      (res) => res.data,
    ),
})

export const turfsQueryOptions = queryOptions({
  queryKey: ['door-knocking-turfs'],
  queryFn: () =>
    clientRequest('GET /v1/door-knocking/turfs', {}).then((res) => res.data),
})

// The exact audience inside a drawn shape, addresses included (ADR 0010).
// Keyed on the polygon and the filter draft, which is what makes the answer
// belong to one shape: move a vertex and the key changes, so a stale preview
// can never be read as describing the ring now on screen.
//
// There is no debounce and nothing refetches on its own. The draw step asks
// for this once, when the candidate presses for it, because the alternative
// is a people-db scan per vertex — see ADR 0010.
export const addressPreviewQueryOptions = (
  geoPoly: GeoJsonPolygon,
  filters: VoterFileBackendFilters,
) =>
  queryOptions({
    queryKey: ['door-knocking-address-preview', geoPoly, filters],
    queryFn: () =>
      clientRequest('POST /v1/door-knocking/address-preview', {
        geoPoly,
        filters,
      }).then((res) => res.data),
    // The shape and the filters are the whole input, so a preview for them
    // cannot go stale while the candidate is still looking at that shape.
    // Back from confirm returns to the same ring and is served from cache
    // rather than billing a second scan.
    staleTime: Infinity,
  })

// Shared by the create flow and the edit dialog so the two can't disagree on
// what a valid name is.
export const MAX_TURF_NAME_LENGTH = 120

// The Lovable palette: distinct, map-legible turf colors.
export const TURF_COLORS = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0d9488',
  '#db2777',
  '#65a30d',
] as const

// The canvas labels each swatch with the colour's name (`'aria-label':opt.label`
// over its `LIST_COLOR_OPTIONS`); both of our pickers labelled them with the hex
// they paint with, so choosing a list colour by keyboard or screen reader meant
// hearing "Turf color number two five six three e b" eight times. The name is
// also what the two pickers have to agree on — the create flow and the edit
// dialog draw the same eight swatches — so it lives beside the palette.
const TURF_COLOR_NAMES: Record<string, string> = {
  '#2563eb': 'Blue',
  '#16a34a': 'Green',
  '#d97706': 'Amber',
  '#dc2626': 'Red',
  '#7c3aed': 'Purple',
  '#0d9488': 'Teal',
  '#db2777': 'Pink',
  '#65a30d': 'Lime',
}

// Falls back to the hex for a colour saved before this map existed, which is
// still a worse label than a name and still better than nothing.
export const turfColorLabel = (color: string): string =>
  TURF_COLOR_NAMES[color] ?? color

// The tick that marks the chosen swatch sits ON the swatch, so it inverts with
// it — the same rule and the same crossover as the walk list's stop numeral on
// its status circle, which is why the helper is shared rather than copied. A
// fixed white tick failed on four of these eight (green, amber, teal and lime
// all land above the crossover), which is the mark meant to make the choice
// legible being the thing that isn't.
export const turfColorTick = (color: string): string => readableInkOnHex(color)

// Shared by WalkView (list rail) and the page (map pins): same key, so
// React Query serves one fetch to both.
export const routeQueryOptions = (turfId: number) =>
  queryOptions({
    queryKey: ['door-knocking-route', turfId],
    queryFn: () =>
      clientRequest('GET /v1/door-knocking/turfs/:id/route', {
        id: String(turfId),
      }).then((res) => res.data),
  })
