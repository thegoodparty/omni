import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'

// The global universes for the voter data page: no channel, so no
// contactability cut and no price (docs/features/recommended-lists.md).
// Every card is one warehouse aggregate, so the default staleTime stands and
// window focus never refetches.
export const useRecommendedLists = (enabled: boolean) => {
  const orgSlug = useOrganization()?.slug

  const query = useQuery({
    queryKey: ['recommended-lists', orgSlug, 'global'],
    queryFn: async () => {
      const { data } = await clientRequest(
        'GET /v1/campaigns/mine/recommended-lists',
        {},
      )
      return data
    },
    enabled,
    refetchOnWindowFocus: false,
  })

  return {
    recommendations: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
