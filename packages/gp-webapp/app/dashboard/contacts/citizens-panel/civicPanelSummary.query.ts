import { queryOptions } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'

// One key for the Constituent Data section and the built-in list row, so the
// page reads the panel summary once.
export const civicPanelSummaryQueryOptions = (orgSlug: string | undefined) =>
  queryOptions({
    queryKey: ['civic-panel-summary', orgSlug],
    queryFn: async () => {
      const { data } = await clientRequest('GET /v1/contacts/civic-panel', {})
      return data
    },
  })
