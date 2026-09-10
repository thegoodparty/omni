/**
 * The surfaced community issues, read client-side.
 *
 * The Community Issues page server-fetches the same endpoint in its `page.tsx`;
 * the onboarding step needs it on the client so it can re-read after the
 * official commits one.
 */

'use client'

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import type { CommunityIssueCard } from 'gpApi/api-endpoints'

export const COMMUNITY_ISSUES_KEY = [
  'chief-of-staff',
  'community-issues',
] as const

// The onboarding step offers a handful of choices, not the whole feed. The
// endpoint returns every non-archived row for the list (the 5-item cap lives in
// the agent manifest, not the API), so the slice is ours to make.
const OFFERED = 5

export const useTopCommunityIssues = (): UseQueryResult<CommunityIssueCard[]> =>
  useQuery({
    queryKey: COMMUNITY_ISSUES_KEY,
    queryFn: async () => {
      const { data } = await clientRequest('GET /v1/community-issues', {
        list: 'top_community',
      })
      // Already ordered by `rank` ascending server-side.
      return data.issues.slice(0, OFFERED)
    },
  })
