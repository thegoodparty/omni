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
