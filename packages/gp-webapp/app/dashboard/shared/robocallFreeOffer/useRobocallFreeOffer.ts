import { useQuery } from '@tanstack/react-query'
import type { RobocallFreeOfferResponse } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'

export const ROBOCALL_FREE_OFFER_QUERY_KEY = 'robocall-free-offer'

// The free election-eve robocall offer, as gp-api decides it for this
// campaign: every surface that shows the offer reads this one answer, so a
// campaign never sees it in one place and not another. gp-api checks the
// flag and eligibility; the webapp only renders. Loading and errors read as
// "no offer", so nothing renders until gp-api has said yes.
export const useRobocallFreeOffer = (): {
  offer: RobocallFreeOfferResponse | null
} => {
  const orgSlug = useOrganization()?.slug

  const query = useQuery({
    queryKey: [ROBOCALL_FREE_OFFER_QUERY_KEY, orgSlug],
    queryFn: async () => {
      const { data } = await clientRequest(
        'GET /v1/campaigns/mine/robocall-offer',
        {},
      )
      return data
    },
    enabled: !!orgSlug,
    refetchOnWindowFocus: false,
    retry: false,
  })

  return { offer: query.data?.eligible ? query.data : null }
}
