import { queryOptions } from '@tanstack/react-query'
import { decodePack, DecodedPack } from './packDecoder'

// Raw fetch, not clientRequest: the pack is a binary ArrayBuffer and
// clientRequest is JSON-only. The /api/v1 middleware rewrite attaches the
// org-slug header from the cookie, same as every other client call.
const fetchPack = async (): Promise<DecodedPack> => {
  const response = await fetch('/api/v1/door-knocking/pack', {
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error(`pack fetch failed (${response.status})`)
  }
  return decodePack(await response.arrayBuffer())
}

export const voterPackQueryOptions = queryOptions({
  queryKey: ['door-knocking-pack'],
  queryFn: fetchPack,
  // A worst-city pack is tens of MB and tens of seconds — never refetch it
  // behind the user's back within a session.
  staleTime: Infinity,
  gcTime: 10 * 60 * 1000,
  retry: 1,
})
