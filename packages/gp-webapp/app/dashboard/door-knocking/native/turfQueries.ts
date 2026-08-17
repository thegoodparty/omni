import { queryOptions } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'

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
