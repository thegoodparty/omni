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

// The panel GoodParty builds for the office: null until the official
// approves its invite.
export const managedCivicPanelQueryOptions = (orgSlug: string | undefined) =>
  queryOptions({
    queryKey: ['civic-panel-managed', orgSlug],
    queryFn: async () => {
      const { data } = await clientRequest(
        'GET /v1/contacts/civic-panel/managed',
        {},
      )
      return data.panel
    },
  })
