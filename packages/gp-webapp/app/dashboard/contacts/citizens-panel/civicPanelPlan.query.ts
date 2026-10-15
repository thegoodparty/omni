import { queryOptions } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'

// The panel's plan as the panel page reads it, for the Chief of Staff's next
// step card. Reading it is what moves the plan, so the card and the page
// always show the same Next line.
export const civicPanelPlanQueryOptions = (orgSlug: string | undefined) =>
  queryOptions({
    queryKey: ['civic-panel-plan', orgSlug],
    queryFn: async () => {
      const { data } = await clientRequest(
        'GET /v1/contacts/civic-panel/plan',
        {},
      )
      return data
    },
  })
