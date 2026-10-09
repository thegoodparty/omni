'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { clientRequest } from 'gpApi/typed-request'
import { useSetOrganizationSlug } from '@shared/organization-picker'
import { clearElectionResultDismissed } from 'app/dashboard/election-result/dismissal'
import type {
  CreateTestOrganizationRequest,
  ApplyTestModeRequest,
  TestModeState,
} from '@goodparty_org/contracts'

export const TEST_MODE_QUERY_KEY = ['test-mode']

export const useTestMode = () => {
  const queryClient = useQueryClient()
  const router = useRouter()
  const setSelectedSlug = useSetOrganizationSlug()

  const query = useQuery<TestModeState>({
    queryKey: TEST_MODE_QUERY_KEY,
    queryFn: async () => {
      const { data } = await clientRequest('GET /v1/test-mode', {})
      return data
    },
  })

  const createMutation = useMutation({
    mutationFn: async (request: CreateTestOrganizationRequest) => {
      const { data } = await clientRequest(
        'POST /v1/test-mode/organizations',
        request,
      )
      return data
    },
    onSuccess: async (data, request) => {
      // Full invalidation — test-mode creates change both the org list and
      // eligibility, which the org-picker's setSelectedSlug deliberately
      // skips. A full invalidateQueries() covers both.
      await queryClient.invalidateQueries()
      setSelectedSlug(data.slug)
      // A not-onboarded elected office lands on serve onboarding; every
      // other creation goes to post-auth-redirect.
      if (
        request.type === 'elected_office' &&
        request.onboarding === 'not_started'
      ) {
        router.push('/serve/onboarding')
      } else {
        router.push('/post-auth-redirect')
      }
    },
  })

  const applyMutation = useMutation({
    mutationFn: async (request: ApplyTestModeRequest) => {
      await clientRequest('POST /v1/test-mode/apply', request)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      clearElectionResultDismissed()
      router.refresh()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (slug: string) => {
      await clientRequest('DELETE /v1/test-mode/organizations/:slug', { slug })
    },
    onSuccess: async (_data, deletedSlug) => {
      await queryClient.invalidateQueries()
      const orgs = query.data?.organizations ?? []
      const remaining = orgs.filter((o) => o.slug !== deletedSlug)
      const firstRemaining = remaining[0]
      if (firstRemaining) {
        setSelectedSlug(firstRemaining.slug)
      }
      router.push('/post-auth-redirect')
    },
  })

  return { query, createMutation, applyMutation, deleteMutation }
}
