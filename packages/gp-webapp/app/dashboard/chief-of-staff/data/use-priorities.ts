/**
 * The official's priorities, and the two ways one gets created: picking a
 * surfaced community issue, or writing their own.
 *
 * Client-side rather than server-fetched (which is how the community-issues
 * page reads its data) because the onboarding step has to re-read after a
 * write to decide which step it is on.
 */

'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import type { Priority, PriorityStage } from '@goodparty_org/contracts'

export const PRIORITIES_KEY = ['chief-of-staff', 'priorities'] as const

export const usePriorities = (): UseQueryResult<Priority[]> =>
  useQuery({
    queryKey: PRIORITIES_KEY,
    queryFn: async () => {
      const { data } = await clientRequest('GET /v1/priorities', {})
      return data
    },
  })

// Both writes invalidate the same three caches: the priorities list (the step
// the home is on is derived from it), the community-issues feed (a prioritized
// issue flips its `prioritized` flag), and the onboarding cards (whose status
// is derived server-side from the priority count).
const useInvalidateAfterWrite = () => {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: PRIORITIES_KEY })
    void queryClient.invalidateQueries({
      queryKey: ['chief-of-staff', 'community-issues'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['chief-of-staff', 'onboarding-cards'],
    })
  }
}

/**
 * Commits a surfaced community issue as a priority. Idempotent server-side —
 * `sourceCommunityIssueId` is unique, so a double-submit returns the existing
 * row rather than a second priority.
 */
export const usePrioritizeIssue = () => {
  const invalidate = useInvalidateAfterWrite()
  return useMutation({
    mutationFn: async (id: string): Promise<Priority> => {
      const { data } = await clientRequest(
        'POST /v1/community-issues/:id/prioritize',
        { id },
      )
      return data
    },
    onSuccess: invalidate,
    onError: (err) =>
      reportErrorToSentry(err, {
        surface: 'chief-of-staff-onboarding',
        phase: 'prioritize-issue',
      }),
  })
}

/**
 * Records how far along the official is. Persisted rather than remembered
 * locally so the agent reads it through `crud_priorities` on its next turn and
 * does not ask again.
 */
export const useSetPriorityStage = () => {
  const invalidate = useInvalidateAfterWrite()
  return useMutation({
    mutationFn: async ({
      id,
      stage,
    }: {
      id: string
      stage: PriorityStage
    }): Promise<Priority> => {
      const { data } = await clientRequest('PUT /v1/priorities/:id', {
        id,
        stage,
      })
      return data
    },
    onSuccess: invalidate,
    onError: (err) =>
      reportErrorToSentry(err, {
        surface: 'chief-of-staff-onboarding',
        phase: 'set-priority-stage',
      }),
  })
}

/**
 * Creates a priority from what the official typed. `description` is required by
 * the contract, and one line of free text is all we asked for, so the same
 * text carries both — better than inventing a description they did not write.
 */
export const useCreatePriority = () => {
  const invalidate = useInvalidateAfterWrite()
  return useMutation({
    mutationFn: async (title: string): Promise<Priority> => {
      const { data } = await clientRequest('POST /v1/priorities', {
        title,
        description: title,
      })
      return data
    },
    onSuccess: invalidate,
    onError: (err) =>
      reportErrorToSentry(err, {
        surface: 'chief-of-staff-onboarding',
        phase: 'create-priority',
      }),
  })
}
