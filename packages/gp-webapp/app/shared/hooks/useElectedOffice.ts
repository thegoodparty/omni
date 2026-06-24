'use client'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { FetchError } from 'ofetch'
import { useOrganization } from '@shared/organization-picker'

// The org slug is part of the key so a user who owns both a Serve (elected
// office) org and a Win campaign can't read the other org's cached value when
// the active org changes via a path that doesn't run the org picker's
// invalidation (a second tab, a deep link, or a focus refetch all mutate the
// org-slug cookie directly). gpFetch sends the cookie's slug as
// X-Organization-Slug, so an unscoped key would let a Win org serve a stale
// Serve elected-office and render Serve copy on the Win contacts page
// (ENG-10511).
export const electedOfficeQueryOptions = (orgSlug: string | undefined) =>
  queryOptions({
    queryKey: ['electedOffice', orgSlug],
    queryFn: async () => {
      try {
        const res = await clientRequest('GET /v1/elected-office/current', {})
        return res.data
      } catch (e) {
        if (e instanceof FetchError && e.status === 404) return null
        throw e
      }
    },
  })

export const useElectedOffice = () => {
  const organization = useOrganization()
  return useQuery(electedOfficeQueryOptions(organization?.slug))
}
