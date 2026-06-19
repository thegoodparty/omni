'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { dashboardApi } from './dashboard-api'
import type {
  DashboardCard,
  DashboardCardBucket,
  SupportEstimate,
} from './contracts'

const SUPPORT_ESTIMATE_KEY = ['chief-of-staff', 'support-estimate'] as const

const cardsKey = (bucket: DashboardCardBucket) =>
  ['chief-of-staff', 'cards', bucket] as const

export const useSupportEstimate = (): UseQueryResult<SupportEstimate | null> =>
  useQuery({
    queryKey: SUPPORT_ESTIMATE_KEY,
    queryFn: () => dashboardApi.getSupportEstimate(),
  })

export const useDashboardCards = (
  bucket: DashboardCardBucket,
): UseQueryResult<DashboardCard[]> =>
  useQuery({
    queryKey: cardsKey(bucket),
    queryFn: () => dashboardApi.getCards(bucket),
  })

export const useDismissCard = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => dashboardApi.dismissCard(id),
    onSuccess: () => {
      // A dismissal moves a card between buckets (out of active, into
      // skipped), so refetch every cards list rather than trying to mutate
      // each bucket's cache by hand.
      void queryClient.invalidateQueries({
        queryKey: ['chief-of-staff', 'cards'],
      })
    },
  })
}
