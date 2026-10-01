import { queryOptions } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'

/**
 * Nothing found means nothing sent yet, so a 404 resolves to null instead of
 * throwing. `retry: false` because the default config retries twice, and
 * waiting out two backoffs to learn "not sent" is the common path.
 */
export const proposalOutreachQueryOptions = (proposalKey: string) =>
  queryOptions({
    queryKey: ['chat-card-proposal-outreach', proposalKey] as const,
    retry: false,
    queryFn: async () => {
      try {
        const res = await clientRequest(
          'GET /v1/outreach/by-proposal-key/:proposalKey',
          { proposalKey },
        )
        return res.data
      } catch (error) {
        if (error instanceof FetchError && error.status === 404) return null
        throw error
      }
    },
  })

// Priorities is a Serve surface, so the org-scoped read is the only correct
// one here: the campaign-scoped sibling would 404 for an org with no campaign.
export const pastOutreachQueryOptions = (outreachId: number) =>
  queryOptions({
    queryKey: ['chat-card-past-outreach', outreachId] as const,
    queryFn: () =>
      clientRequest('GET /v1/outreach/serve/:id', {
        id: String(outreachId),
      }).then((res) => res.data),
  })

export const cardContactQueryOptions = (contactId: string) =>
  queryOptions({
    queryKey: ['chat-card-contact', contactId] as const,
    queryFn: () =>
      clientRequest('GET /v1/contacts/:id', { id: contactId }).then(
        (res) => res.data,
      ),
  })
