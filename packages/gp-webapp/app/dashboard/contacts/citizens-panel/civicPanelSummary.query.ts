import { queryOptions } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'

// One key for the Constituents section and the built-in list row, so the
// page reads the panel summary once.
export const civicPanelSummaryQueryOptions = (orgSlug: string | undefined) =>
  queryOptions({
    queryKey: ['civic-panel-summary', orgSlug],
    queryFn: async () => {
      const { data } = await clientRequest('GET /v1/contacts/civic-panel', {})
      return data
    },
  })

// Where the panel stands toward its goal, for the Constituents section's
// progress bar. Reading the plan is what moves it, as on the panel page.
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
