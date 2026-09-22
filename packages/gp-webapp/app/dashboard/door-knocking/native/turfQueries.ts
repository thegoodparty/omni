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

// The prefix every rail cache entry shares. Invalidating on it clears both
// surfaces' entries at once, which is what every mutation below wants: they
// are all reached by turf id from whichever rail is on screen, and a write
// that only refreshed the surface it was made from would leave the other one
// stale for a dual-role org.
export const TURFS_QUERY_KEY = ['door-knocking-turfs'] as const

// The prefix every campaign-turf entry hangs off, for invalidation. A
// constant rather than a literal at each writer: the key is per-anchor, so
// every mutation has to invalidate by PREFIX to reach the entry it just
// invalidated the rail for, and four hand-typed copies of a string is how
// one of them ends up not matching.
export const CAMPAIGN_TURFS_QUERY_KEY = [
  'door-knocking-campaign-turfs',
] as const

// One rail, two surfaces. `serve` is not derived here or anywhere below the
// page: an org that holds both a Campaign and an ElectedOffice would derive
// Win from the Campaign it happens to hold and show its Win lists on the Serve
// rail, which is the ENG-10976 leak. The page decides, once, and hands the
// answer down through `DoorKnockingSurfaceContext`.
//
// The two endpoints are written out rather than selected into one
// `clientRequest` call because the typed client keys off a literal.
export const turfsQueryOptions = (serve: boolean) =>
  queryOptions({
    queryKey: [...TURFS_QUERY_KEY, serve ? 'serve' : 'win'],
    queryFn: () =>
      (serve
        ? clientRequest('GET /v1/door-knocking/serve/turfs', {})
        : clientRequest('GET /v1/door-knocking/turfs', {})
      ).then((res) => res.data),
  })

// Every turf in a door-knocking campaign — the anchor Outreach plus every
// row pointing at it via `campaignOutreachId`. Keyed off the anchor id so
// the drawer's fetch and any later "add another turf" open share one entry;
// invalidated alongside `TURFS_QUERY_KEY` because the mutations that touch
// this list are the same ones (create, rename, archive, delete) that
// refresh the rail.
export const campaignTurfsQueryOptions = (anchorOutreachId: number) =>
  queryOptions({
    queryKey: [...CAMPAIGN_TURFS_QUERY_KEY, anchorOutreachId],
    queryFn: () =>
      clientRequest('GET /v1/door-knocking/campaigns/:anchorId', {
        anchorId: String(anchorOutreachId),
      }).then((res) => res.data),
  })

// Both daily allowances, read before the create flow opens rather than at the
// press that spends them. The campaign count is the one that has to be known
// this early: it refuses the whole flow rather than one shape, so discovering
// it at the paid press would mean throwing away a boundary and a name the
// candidate had already committed to.
//
// Not scoped by Win/Serve — both allowances belong to the organization, and a
// dual-role org shares one of each across its two rails.
export const quotaQueryOptions = queryOptions({
  queryKey: ['door-knocking-quota'],
  queryFn: () =>
    clientRequest('GET /v1/door-knocking/quota', {}).then((res) => res.data),
})

// Whether the list the who step is on keeps anybody at all.
//
// Keyed on the filters alone, because that is the whole input — no polygon is
// sent and none is relevant. Two lists cut the same way share one entry, and
// stepping back to the who step re-reads the answer rather than re-asking.
//
// Unlike the address preview below, this may fire on a pick rather than on a
// press: it resolves person-id sets out of Postgres and reads no voter data,
// so ADR 0010's reason for making the preview explicit does not apply to it.
//
// Nothing is kept. This is the one answer on the flow that must not outlive
// the mount that asked for it, because the only answer it can give is one
// that tells the candidate to go and change it: an empty audience prints
// "edit it in your contacts", and editing the list — or logging the knocks
// that move a support status — is exactly what makes the cached `true` a lie.
// A held answer would then disable Continue for a list that now keeps people,
// which is the false block this gate exists to prevent and worse than the bug
// it fixes. `gcTime: 0` drops the entry when the surface unmounts, so leaving
// for contacts and coming back re-asks from nothing; `staleTime: 0` covers
// editing in a second tab, where the surface never unmounts at all.
//
// This is also what makes keying on the filters alone sound. The answer is
// per-organization and the key does not say so — no key in this file does,
// since switching orgs invalidates the cache wholesale (organization-picker)
// — but an entry that cannot survive the unmount an org switch forces cannot
// be read under the wrong org in the first place.
//
// The round trips this costs are the ones the endpoint was made cheap to
// afford: no voter data is read and no vendor credit is spent, so re-asking
// is the affordable half of the trade and staleness is not.
export const audienceCheckQueryOptions = (filters: VoterFileBackendFilters) =>
  queryOptions({
    queryKey: ['door-knocking-audience-check', filters],
    queryFn: () =>
      clientRequest('POST /v1/door-knocking/audience-check', { filters }).then(
        (res) => res.data,
      ),
    staleTime: 0,
    gcTime: 0,
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
  '#0891b2',
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
  '#0891b2': 'Cyan',
  // Off the palette, still named. Lime sat one slot from Green and the two
  // read as the same colour in a row of eight swatches and as the same ring
  // on a map. Cyan took the slot because the only real hue gaps left in the
  // set are teal-to-blue and purple-to-pink, and the first has the clearer
  // margin: cyan is a light blue-cyan against teal's dark green-cyan, where
  // a magenta would sit between two brights. Turfs cut in lime before the
  // swap keep it — the label is what stops such a turf announcing itself as
  // "six five a three zero d".
  //
  // Eight maximally distinct hues is genuinely hard, and this is the second
  // attempt at the eighth. If cyan reads as teal in use, the honest fix is
  // SEVEN colours rather than a third hue nobody can name.
  '#65a30d': 'Lime',
}

// Falls back to the hex for a colour saved before this map existed, which is
// still a worse label than a name and still better than nothing.
export const turfColorLabel = (color: string): string =>
  TURF_COLOR_NAMES[color] ?? color

// The tick that marks the chosen swatch sits ON the swatch, so it inverts with
// it — the same rule and the same crossover as the walk list's stop numeral on
// its status circle, which is why the helper is shared rather than copied. A
// fixed white tick failed on three of these eight (green, amber and teal all
// land above the crossover), which is the mark meant to make the choice
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
